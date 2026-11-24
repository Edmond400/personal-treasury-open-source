// Synthetic acceptance only. Deliberately refuses the production Worker URL.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {balance,totals,monthEnd} from '../src/core.mjs';
import {verifyBackup} from '../src/repository.mjs';
const phase=process.argv[2],base=new URL(process.argv[3]);
assert(base.protocol==='https:'&&/^personal-treasury-(verify|restore-check)\.[a-z0-9-]+\.workers\.dev$/.test(base.hostname),'Only named disposable verification Workers are allowed');
const credentials=JSON.parse(await readFile(new URL(phase==='restore'?'../.local/restore-credentials.json':'../.local/verify-credentials.json',import.meta.url),'utf8'));
const log=[],latencies=[];let cookie='',csrf='',state;
const check=(label,condition)=>{assert(condition,label);log.push({label,passed:true});console.log('PASS '+label);};
async function req(path,{method='GET',body,csrfOverride,originOverride,expected=200}={}){
 const started=performance.now();
 const response=await fetch(new URL('/api'+path,base),{method,headers:{Origin:originOverride||base.origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrfOverride??csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 latencies.push({path,ms:Math.round(performance.now()-started),status:response.status});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 assert.equal(response.status,expected,`HTTP status for ${path}; response ${typeof data==='object'?data.error||'JSON':String(data).slice(0,100)}`);
 const c=response.headers.get('Set-Cookie');if(c)cookie=c.split(';')[0];if(data?.csrf)csrf=data.csrf;
 return {data,response};
}
async function cmd(type,payload){const body={expectedRevision:state.revision,requestId:crypto.randomUUID(),command:{type,payload}};state=(await req('/command',{method:'POST',body})).data;return state;}
const initial=(await req('/session')).data;assert.equal(initial.configured,false,'Verification database must be fresh');
await req('/state',{expected:401});check('Unauthenticated ledger access rejected',true);
const registered=await req('/register',{method:'POST',body:credentials});check('Owner registration and secure Cookie',!!csrf&&/HttpOnly/.test(registered.response.headers.get('Set-Cookie'))&&/Secure/.test(registered.response.headers.get('Set-Cookie'))&&/SameSite=Strict/.test(registered.response.headers.get('Set-Cookie')));
check('API responses are no-store',registered.response.headers.get('Cache-Control')==='no-store');
state=(await req('/state')).data;
if(phase==='restore'){
 const backup=JSON.parse(await readFile(new URL('../.local/cloud-backup.json',import.meta.url),'utf8'));
 await req('/restore/verify',{method:'POST',body:{backup}});
 state=(await req('/restore',{method:'POST',body:{backup,password:credentials.password,requestId:crypto.randomUUID(),confirmation:'恢复到空账本'}})).data;
 for(const key of ['accounts','balances','transactions','obligations','policies','settlements'])assert.deepEqual(state[key],backup.state[key]);
 assert.deepEqual(totals(state),totals(backup.state));check('Real D1 JSON recovery preserves every asset, transaction and monthly report version',true);
 const audited=(await req('/audit')).data;check('Imported audit history is retained separately',audited.importedCount>=backup.audit.length);
 await req('/restore',{method:'POST',body:{backup,password:credentials.password,requestId:crypto.randomUUID(),confirmation:'恢复到空账本'},expected:422});check('Restore refuses to replace a nonempty ledger',true);
 const reexport=(await req('/export',{method:'POST',body:{password:credentials.password}})).data;await verifyBackup(reexport);check('Recovered ledger can be backed up and verified again',true);
}else{
 const OPEN='2026-10-01T00:00:00+08:00',AT='2026-10-15T12:00:00+08:00',END=monthEnd('2026-10');
 await cmd('initialize',{at:OPEN});
 const account=async(name,group,amount,kind='cash',restriction='free')=>{await cmd('account.add',{name,platform:name,group,amount,kind,restriction,at:OPEN});return state.accounts.at(-1).id;};
 const liquid=await account('合成微信','liquid',100000),meal=await account('合成饭卡','liquid',0,'prepaid','restricted'),saving=await account('合成储蓄','savings',1500000),product=await account('合成理财','savings',500000,'investment','redeem'),transit=await account('合成在途','savings',0,'transit','restricted');
 check('Independent cash, prepaid, product and transit accounts total correctly',totals(state).net===2100000);
 await cmd('obligation.add',{kind:'receivable',party:'合成借款方',opening:0,at:OPEN});const receivable=state.obligations.at(-1).id;
 await cmd('obligation.add',{kind:'payable',party:'合成出借方',opening:0,at:OPEN});const payable=state.obligations.at(-1).id;
 const tx=x=>cmd('transaction.add',{at:AT,memo:'合成云端验收',...x});
 await tx({kind:'income',toId:liquid,category:'labor',amount:100000});const incomeId=state.transactions.at(-1).id;
 let r=(await req('/report?month=2026-10')).data;check('1000 CNY labor income proposes 100 CNY savings and 900 CNY liquid',r.allocations[0].targetSavings===10000&&r.allocations[0].targetLiquid===90000);
 await tx({kind:'transfer',fromId:liquid,toId:meal,amount:10000});check('Meal-card recharge preserves net assets',totals(state).net===2200000);
 await tx({kind:'lend',fromId:saving,obligationId:receivable,amount:300000});check('3000 CNY loan-out increases receivable without changing net assets',totals(state).receivables===300000&&totals(state).net===2200000);
 await tx({kind:'expense',fromId:saving,amount:40000});const expenseId=state.transactions.at(-1).id;check('400 CNY sponsorship reduces net assets by exactly 400 CNY',totals(state).net===2160000);
 await tx({kind:'invest',fromId:saving,toId:product,amount:100000});await tx({kind:'redeem',fromId:product,toId:saving,amount:50000});await tx({kind:'dividend',fromId:product,toId:saving,amount:5000});
 await tx({kind:'transfer',fromId:saving,toId:liquid,amount:10000});await tx({kind:'borrow',toId:liquid,obligationId:payable,amount:20000});await tx({kind:'repay_debt',fromId:liquid,obligationId:payable,amount:5000});await tx({kind:'repay_receivable',toId:saving,obligationId:receivable,amount:50000});await tx({kind:'transfer',fromId:saving,toId:transit,amount:20000});
 await tx({kind:'transfer',fromId:liquid,toId:saving,amount:10000,purpose:'income_allocation',relatedId:incomeId,at:'2026-10-16T12:00:00+08:00'});
 await cmd('balance.confirm',{items:[{accountId:liquid,asOf:'2026-10-20T23:00:00+08:00',amount:170000}]});
 await tx({kind:'transfer',fromId:liquid,toId:saving,amount:60000,purpose:'month_end',relatedId:'2026-10',at:'2026-10-31T12:00:00+08:00'});
 const values=new Map([[liquid,110000],[meal,10000],[saving,1205000],[product,550000],[transit,20000]]);
 await cmd('balance.confirm',{items:state.accounts.map(a=>({accountId:a.id,asOf:END,amount:values.get(a.id)}))});
 r=(await req('/report?month=2026-10')).data;
 check('Product subscriptions, redemption and paid dividend yield exactly 50 CNY, once',r.investmentGain===5000&&r.income===100000);
 check('Month-end inferred consumption is 350 CNY, surplus 250 CNY and net assets 21300 CNY',r.inferred===35000&&r.surplus===25000&&r.closing.net===2130000);
 check('Principal receipts, borrowing and transit do not become income or consumption',r.closing.receivables===250000&&r.closing.liabilities===15000);
 check('Income and month-end allocation suggestions settle without repeating',r.allocations[0].remaining===0&&r.expectedSweep===60000&&r.actualSweep===60000&&r.sweepRemaining===0);
 check('Exact opening and closing confirmations permit formal month close',r.canClose===true);
 await cmd('month.close',{month:'2026-10',confirmed:true});
 const frozen=structuredClone(state.settlements[0].report),expense=state.transactions.find(x=>x.id===expenseId);
 await cmd('transaction.correct',{...expense,amount:30000,reason:'合成验收：纠正支出'});
 check('Corrections retain original transaction and frozen report',state.transactions.find(x=>x.id===expenseId).history[0].amount===40000&&state.settlements[0].stale&&JSON.stringify(state.settlements[0].report)===JSON.stringify(frozen));
 await cmd('balance.confirm',{items:[{accountId:saving,asOf:END,amount:1215000}]});await cmd('month.close',{month:'2026-10',confirmed:true,reason:'合成云端验收修订'});check('Revised month report creates v2 while preserving v1',state.settlements.length===2&&state.settlements[1].version===2);
 await req('/command',{method:'POST',body:{},csrfOverride:'wrong',expected:403});await req('/command',{method:'POST',body:{},originOverride:'https://invalid.example',expected:403});check('CSRF and Origin checks reject unauthorized writes',true);
 const revision=state.revision,requests=[1,2].map(n=>({expectedRevision:revision,requestId:crypto.randomUUID(),command:{type:'platform.check',payload:{platform:'合成并发'+n,amount:100,asOf:AT}}}));
 const results=await Promise.all(requests.map(async body=>{const response=await fetch(new URL('/api/command',base),{method:'POST',headers:{Origin:base.origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body};}));
 check('Real D1 concurrent revision gate allows one write and rolls back the other',results.filter(x=>x.status===200).length===1&&results.filter(x=>x.status===409).length===1);
 state=(await req('/state')).data;const repeated=results.find(x=>x.status===200).body;await req('/command',{method:'POST',body:repeated});check('HTTP retry is idempotent',((await req('/state')).data).revision===state.revision);
 const backup=(await req('/export',{method:'POST',body:{password:credentials.password}})).data;await verifyBackup(backup);await writeFile(new URL('../.local/cloud-backup.json',import.meta.url),JSON.stringify(backup),{mode:0o600});
 const csv=await req('/export',{method:'POST',body:{password:credentials.password,format:'csv'}});check('JSON backup verifies and CSV exports in real Worker',backup.state.settlements.length===2&&String(csv.data).includes('"balances"'));
 const year=(await req('/annual?year=2026')).data;check('Annual report selects latest month version once',year.months.length===1&&year.surplus===35000);
 await req('/logout',{method:'POST',body:{}});await req('/state',{expected:401});check('Logout invalidates the current session',true);
 await req('/login',{method:'POST',body:{password:credentials.password}});check('Password re-login works on the free Worker',((await req('/session')).data).authenticated===true);
}
const sorted=latencies.map(x=>x.ms).sort((a,b)=>a-b),result={phase,url:base.origin,passed:log.length,checks:log,latency:{requests:latencies.length,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]},completedAt:new Date().toISOString()};
await writeFile(new URL(`../.local/cloud-${phase}-results.json`,import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({phase,passed:result.passed,latency:result.latency}));
