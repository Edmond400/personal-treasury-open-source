import {emptyState,DomainError,now,demand,validateBackupState,uid} from './core.mjs';
const TABLES={accounts:'accounts',balances:'balance_snapshots',transactions:'transactions',obligations:'obligations',policies:'policy_versions',settlements:'monthly_settlements'};
export async function hash(value){const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function load(db){
 const keys=Object.keys(TABLES);const results=await db.batch([db.prepare('SELECT * FROM treasury_meta WHERE id=1'),...keys.map(k=>db.prepare(`SELECT data FROM ${TABLES[k]} ORDER BY rowid`))]);
 const s=emptyState(),meta=results[0].results[0];s.revision=meta.revision;s.setup=JSON.parse(meta.setup_json);
 keys.forEach((k,i)=>{s[k]=results[i+1].results.map(r=>JSON.parse(r.data));});return s;
}
function chunks(rows){const out=[];let part=[],size=0;for(const row of rows){const n=JSON.stringify(row).length;demand(n<500000,'单条数据超出恢复容量');if(size+n>500000){out.push(part);part=[];size=0;}part.push(row);size+=n;}if(part.length)out.push(part);return out;}
export async function audit(db,revision=Number.MAX_SAFE_INTEGER){return (await db.prepare('SELECT * FROM audit_log WHERE revision<=? ORDER BY revision').bind(revision).all()).results;}
export async function commit(db,before,after,command,requestId,{archived=[],summaryOnly=false}={}){
 demand(typeof requestId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(requestId),'请求编号无效');
 const changed=[];
 for(const [key,table] of Object.entries(TABLES)){
  const old=new Map(before[key].map(x=>[x.id,JSON.stringify(x)]));
  for(const row of after[key]){const data=JSON.stringify(row);if(old.get(row.id)!==data)changed.push({table,id:row.id,data,before:old.get(row.id)||null});}
 }
 const at=now();
 // The unique next revision is the concurrency gate. Any collision aborts the entire D1 batch.
 const setupChange=JSON.stringify(before.setup)!==JSON.stringify(after.setup)?{setupBefore:before.setup,setupAfter:after.setup}:{};
 const details={command,...(summaryOnly?{restoredCounts:Object.fromEntries(Object.keys(TABLES).map(k=>[k,after[k].length]))}:{changes:changed.map(x=>({table:x.table,id:x.id,before:x.before,after:x.data}))}),...setupChange};
 const stmts=[db.prepare('INSERT INTO audit_log(revision,request_id,action,recorded_at,before_hash,after_hash,details) VALUES(?,?,?,?,?,?,?)').bind(after.revision,requestId,command.type,at,await hash(before),await hash(after),JSON.stringify(details)),db.prepare('UPDATE treasury_meta SET revision=?,setup_json=? WHERE id=1').bind(after.revision,JSON.stringify(after.setup))];
 // Group projections into bounded JSON inserts, avoiding one query per restored row.
 for(const table of Object.values(TABLES)){
  const rows=changed.filter(x=>x.table===table).map(x=>JSON.parse(x.data));
  for(const chunk of chunks(rows))stmts.push(db.prepare(`INSERT INTO ${table}(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET data=excluded.data`).bind(JSON.stringify(chunk)));
 }
 for(const chunk of chunks(archived))stmts.push(db.prepare("INSERT INTO archived_audit_log(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(?)").bind(JSON.stringify(chunk)));
 demand(stmts.length<=40,'本次操作超出单批恢复容量，请使用数据库级隔离恢复');
 try{await db.batch(stmts);}catch(e){if(/UNIQUE|constraint/i.test(e.message))throw new DomainError('数据已被另一操作更新，请刷新后再试',409);throw e;}
}
export async function replayed(db,id,command){const prior=await db.prepare('SELECT revision,details FROM audit_log WHERE request_id=?').bind(id).first();if(prior&&command)demand(JSON.stringify(JSON.parse(prior.details).command)===JSON.stringify(command),'请求编号已用于不同操作',409);return !!prior;}
export async function backup(db){const s=await load(db);const log=await audit(db,s.revision);const archivedAudit=(await db.prepare('SELECT data FROM archived_audit_log ORDER BY rowid').all()).results.map(x=>JSON.parse(x.data));const data={format:'personal-treasury-backup',version:1,exportedAt:now(),state:s,audit:log,archivedAudit};return {...data,checksum:await hash(data)};}
export async function verifyBackup(b){
 demand(b&&b.format==='personal-treasury-backup'&&b.version===1,'不是有效的Personal Treasury备份');const {checksum,...data}=b;
 demand(typeof checksum==='string'&&await hash(data)===checksum,'备份校验失败：文件可能损坏');validateBackupState(b.state);demand(Array.isArray(b.audit)&&b.audit.length<=100000,'备份缺少审计记录');demand(!b.archivedAudit||Array.isArray(b.archivedAudit),'归档审计格式无效');for(const x of b.audit)demand(Number.isSafeInteger(x.revision)&&typeof x.details==='string'&&typeof x.after_hash==='string','审计记录格式无效');
 return {opening:b.state.setup.at,accounts:b.state.accounts.length,transactions:b.state.transactions.length,settlements:b.state.settlements.length};
}
export async function restore(db,b,requestId){await verifyBackup(b);const before=await load(db);demand(!before.setup&&before.accounts.length===0,'恢复仅允许在空账本执行，以保护现有历史；请在独立环境恢复');
 const after=structuredClone(b.state);after.revision=before.revision+1;const archived=[...(b.archivedAudit||[]),...(after.setup.importedAudit||[]).map((data,i)=>({id:b.checksum+'-legacy-'+i,data})),...b.audit.map(data=>({id:b.checksum+'-'+data.revision,data}))];after.setup.importedAudit=[];
 await commit(db,before,after,{type:'backup.restore',payload:{sourceChecksum:b.checksum,importedRevision:b.state.revision}},requestId,{archived,summaryOnly:true});return after;
}
export function csv(s){const rows=[['实体','编号','名称/说明','北京时间','金额(分)','数据JSON']];for(const [k] of Object.entries(TABLES))for(const x of s[k])rows.push([k,x.id,x.name||x.memo||x.party||x.month||'',x.asOf||x.at||x.closedAt||x.effective||'',x.amount??x.opening??'',JSON.stringify(x)]);
 const cell=v=>{let t=String(v);if(/^[=+\-@\t\r\n]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';};return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
