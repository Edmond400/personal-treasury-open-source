import {DomainError,demand} from './core.mjs';
import {hash} from './repository.mjs';
const enc=new TextEncoder();
const hex=bytes=>[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
const fromHex=s=>new Uint8Array(s.match(/../g).map(x=>parseInt(x,16)));
export const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export async function passwordHash(password,salt,pepper){
 const pepperKey=await crypto.subtle.importKey('raw',enc.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const prehash=await crypto.subtle.sign('HMAC',pepperKey,enc.encode(password));
 const key=await crypto.subtle.importKey('raw',prehash,'PBKDF2',false,['deriveBits']);
 return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromHex(salt),iterations:100000,hash:'SHA-256'},key,256)));
}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
export async function rateLimit(db,request){
 const bucket=Math.floor(Date.now()/900000),ip=request.headers.get('CF-Connecting-IP')||'local';const key=await hash(ip+':'+bucket);
 const row=await db.prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,(bucket+1)*900000).first();
 if(row.count>10)throw new DomainError('尝试次数过多，请15分钟后再试',429);
 await db.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(Date.now()-900000).run();
}
export async function owner(db){return db.prepare('SELECT * FROM owner WHERE id=1').first();}
export async function checkPassword(db,password,env){const o=await owner(db);demand(o&&typeof password==='string'&&password.length<=256,'密码不正确');const h=await passwordHash(password,o.salt,env.AUTH_PEPPER||'local-only-development-pepper');demand(equal(h,o.password_hash),'密码不正确');return o;}
export async function session(db,request){const cookie=request.headers.get('Cookie')||'';const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('pt_session='))?.slice(11);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;return db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),Date.now()).first();}
export function originCheck(request){if(!['GET','HEAD'].includes(request.method)){const origin=request.headers.get('Origin');if(origin!==new URL(request.url).origin)throw new DomainError('请求来源校验失败',403);}}
export function csrfCheck(request,s){if(!equal(request.headers.get('X-CSRF-Token'),s.csrf))throw new DomainError('会话校验失败，请重新登录',403);}
export const cookie=(request,token,clear=false)=>`pt_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:604800}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
export async function newSession(db){const token=random(),csrf=random();await db.batch([db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),db.prepare('INSERT INTO sessions(token_hash,csrf,expires_at) VALUES(?,?,?)').bind(await hash(token),csrf,Date.now()+604800000)]);return {token,csrf};}
export const securePassword=p=>demand(typeof p==='string'&&p.length>=12&&p.length<=128,'密码须为12至128位');
