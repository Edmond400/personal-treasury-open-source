import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {hash,verifyBackup} from '../src/repository.mjs';
const origin='https://personal-treasury-verify.310aa6979.workers.dev';
const credentials=JSON.parse(await readFile(new URL('../.local/verify-credentials.json',import.meta.url),'utf8'));
let cookie='',csrf='';
async function call(path,body){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json();assert.equal(r.status,200,`${path}: ${data.error||'request failed'}`);if(r.headers.get('Set-Cookie'))cookie=r.headers.get('Set-Cookie').split(';')[0];if(data.csrf)csrf=data.csrf;return data;}
await call('/login',{password:credentials.password});
for(let i=0;i<2;i++){const s=await call('/state');const [b]=await Promise.all([call('/export',{password:credentials.password}),call('/command',{expectedRevision:s.revision,requestId:crypto.randomUUID(),command:{type:'platform.check',payload:{platform:'备份并发验收'+i,amount:0,asOf:'2026-10-15T12:00:00+08:00'}}})]);await verifyBackup(b);assert(b.audit.every(a=>a.revision<=b.state.revision));assert.equal(b.audit.at(-1).after_hash,await hash(b.state));console.log('PASS Real D1 backup captures matching state and audit prefix during concurrent writes '+(i+1));}
const b=await call('/export',{password:credentials.password});await verifyBackup(b);await writeFile(new URL('../.local/cloud-backup.json',import.meta.url),JSON.stringify(b),{mode:0o600});await writeFile(new URL('../.local/cloud-backup-race-results.json',import.meta.url),JSON.stringify({passed:2,stateRevision:b.state.revision,auditRows:b.audit.length,completedAt:new Date().toISOString()},null,2));console.log('PASS Final cloud backup is internally consistent and ready for isolated recovery');
