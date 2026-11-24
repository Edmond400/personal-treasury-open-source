import {applyCommand,now,report,totals,annualReport,DomainError,demand} from './core.mjs';
import {load,commit,replayed,backup,verifyBackup,restore,csv} from './repository.mjs';
import * as auth from './auth.mjs';
const json=(v,status=200,extra={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
const security={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Strict-Transport-Security':'max-age=31536000'};
async function body(request){demand(Number(request.headers.get('Content-Length')||0)<=8*1024*1024,'请求过大');const reader=request.body?.getReader();demand(reader,'请求不能为空');const chunks=[];let n=0;while(true){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>8*1024*1024){await reader.cancel();throw new DomainError('请求过大',413);}chunks.push(value);}const all=new Uint8Array(n);let p=0;for(const c of chunks){all.set(c,p);p+=c.length;}try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new DomainError('JSON格式无效',400);}}
async function api(request,env){
 const {pathname,searchParams}=new URL(request.url),db=env.DB;
 if(!db)return json({error:'数据库尚未配置'},503);
 if(env.LOCAL_DEV!==true&&(!env.AUTH_PEPPER||env.AUTH_PEPPER.length<32))return json({error:'安全配置尚未完成'},503);
 auth.originCheck(request);
 if(pathname==='/api/session'&&request.method==='GET'){
  const o=await auth.owner(db),s=await auth.session(db,request);return json({configured:!!o,authenticated:!!s,csrf:s?.csrf||null,setupTokenRequired:env.LOCAL_DEV!==true});
 }
 if((pathname==='/api/register'||pathname==='/api/login')&&request.method==='POST'){
  await auth.rateLimit(db,request);const p=await body(request);
  if(pathname==='/api/register'){
   demand(!await auth.owner(db),'管理员已建立');demand(env.LOCAL_DEV===true||env.SETUP_TOKEN&&auth.equal(p.setupToken,env.SETUP_TOKEN),'初始设置码不正确');auth.securePassword(p.password);const salt=auth.random();
   try{await db.prepare('INSERT INTO owner(id,salt,password_hash,created_at) VALUES(1,?,?,?)').bind(salt,await auth.passwordHash(p.password,salt,env.AUTH_PEPPER||'local-only-development-pepper'),now()).run();}catch(e){if(/UNIQUE/.test(e.message))throw new DomainError('管理员已建立',409);throw e;}
  }else await auth.checkPassword(db,p.password,env);
  const s=await auth.newSession(db);return json({csrf:s.csrf},200,{'Set-Cookie':auth.cookie(request,s.token)});
 }
 const sess=await auth.session(db,request);if(!sess)throw new DomainError('请先登录',401);
 if(request.method!=='GET'&&request.method!=='HEAD')auth.csrfCheck(request,sess);
 if(pathname==='/api/logout'&&request.method==='POST'){await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(sess.token_hash).run();return json({ok:true},200,{'Set-Cookie':auth.cookie(request,'',true)});}
 if(pathname==='/api/password'&&request.method==='POST'){
  await auth.rateLimit(db,request);const p=await body(request);await auth.checkPassword(db,p.currentPassword,env);auth.securePassword(p.password);const salt=auth.random(),password=await auth.passwordHash(p.password,salt,env.AUTH_PEPPER||'local-only-development-pepper');
  await db.batch([db.prepare('UPDATE owner SET salt=?,password_hash=? WHERE id=1').bind(salt,password),db.prepare('DELETE FROM sessions')]);return json({ok:true},200,{'Set-Cookie':auth.cookie(request,'',true)});
 }
 if(pathname==='/api/state'&&request.method==='GET')return json(await load(db));
 if(pathname==='/api/report'&&request.method==='GET'){const s=await load(db);return json(report(s,searchParams.get('month')));}
 if(pathname==='/api/annual'&&request.method==='GET'){const y=searchParams.get('year');demand(/^\d{4}$/.test(y),'年份无效');return json(annualReport(await load(db),y));}
 if(pathname==='/api/command'&&request.method==='POST'){
  const p=await body(request);demand(typeof p.requestId==='string','缺少请求编号');if(await replayed(db,p.requestId,p.command))return json(await load(db));
  const before=await load(db);demand(p.expectedRevision===before.revision,'数据版本已变更，请刷新',409);const after=applyCommand(before,p.command);await commit(db,before,after,p.command,p.requestId);return json(after);
 }
 if(pathname==='/api/export'&&request.method==='POST'){
  await auth.rateLimit(db,request);const p=await body(request);await auth.checkPassword(db,p.password,env);
  if(p.format==='csv')return new Response(csv(await load(db)),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="personal-treasury.csv"','Cache-Control':'no-store'}});
  return json(await backup(db),200,{'Content-Disposition':'attachment; filename="personal-treasury-backup.json"'});
 }
 if(pathname==='/api/restore/verify'&&request.method==='POST'){const p=await body(request);const info=await verifyBackup(p.backup);return json({...info,totals:totals(p.backup.state)});}
 if(pathname==='/api/restore'&&request.method==='POST'){
  await auth.rateLimit(db,request);const p=await body(request);await auth.checkPassword(db,p.password,env);demand(p.confirmation==='恢复到空账本','请明确确认恢复到空账本');return json(await restore(db,p.backup,p.requestId));
 }
 if(pathname==='/api/audit'&&request.method==='GET'){
  const s=await load(db);const cursor=Number(searchParams.get('before')||Number.MAX_SAFE_INTEGER);demand(Number.isSafeInteger(cursor)&&cursor>0,'游标无效');
  return json({importedCount:(await db.prepare('SELECT COUNT(*) AS n FROM archived_audit_log').first()).n,rows:(await db.prepare('SELECT revision,action,recorded_at,before_hash,after_hash FROM audit_log WHERE revision<? ORDER BY revision DESC LIMIT 100').bind(cursor).all()).results});
 }
 throw new DomainError('接口不存在',404);
}
export default {async fetch(request,env){if(env.LOCAL_DEV!==true&&new URL(request.url).protocol!=='https:'){const u=new URL(request.url);u.protocol='https:';return Response.redirect(u.toString(),308);}let response;try{const p=new URL(request.url).pathname;response=p.startsWith('/api/')?await api(request,env):env.ASSETS?await env.ASSETS.fetch(request):new Response('Not found',{status:404});}catch(e){response=json({error:e instanceof DomainError?e.message:'服务暂时不可用，请稍后重试'},e instanceof DomainError?e.status:500);}
 const headers=new Headers(response.headers);for(const [k,v]of Object.entries(security))headers.set(k,v);if(new URL(request.url).pathname.startsWith('/api/'))headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});}};
