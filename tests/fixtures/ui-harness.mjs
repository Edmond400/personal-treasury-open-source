// Disposable synthetic UI fixture. Served only by scripts/dev.mjs at /__qa/.
// No login credentials, user data, production route or database access.
import {emptyState,applyCommand,now,monthEnd,report,annualReport} from '/core.mjs';
let s=emptyState();const at='2026-10-01T00:00:00+08:00';const cmd=(type,payload)=>s=applyCommand(s,{type,payload},now());
cmd('initialize',{at});for(const [name,platform,group,kind,restriction,amount] of [['微信A','微信','liquid','cash','free',78000],['校园饭卡','校园一卡通','liquid','prepaid','restricted',21000],['交通卡','上海交通卡','liquid','prepaid','restricted',8000],['中国银行卡','中国银行','savings','cash','free',1200000],['余额宝','支付宝','savings','investment','redeem',500000]])cmd('account.add',{name,platform,group,kind,restriction,amount,at});
const liquid=s.accounts[0].id,savings=s.accounts[3].id,product=s.accounts[4].id;
cmd('transaction.add',{kind:'income',at:'2026-10-15T12:00:00+08:00',amount:100000,toId:liquid,category:'labor',memo:'示例家教报酬'});
cmd('transaction.add',{kind:'expense',at:'2026-10-16T12:00:00+08:00',amount:40000,fromId:savings,memo:'示例活动赞助'});
cmd('obligation.add',{kind:'receivable',party:'示例借款人',opening:0,at});
cmd('transaction.add',{kind:'lend',at:'2026-10-17T12:00:00+08:00',amount:300000,fromId:savings,obligationId:s.obligations[0].id,memo:'示例借出本金'});
cmd('balance.confirm',{items:s.accounts.map((a,i)=>({accountId:a.id,asOf:monthEnd('2026-10'),amount:[85000,16000,6000,860000,505000][i]}))});
cmd('month.close',{month:'2026-10',confirmed:true});
const realFetch=window.fetch.bind(window);
window.fetch=async(url,options={})=>{
 if(!String(url).startsWith('/api/'))return realFetch(url,options);
 const u=new URL(url,location.origin),path=u.pathname.slice(4),p=options.body?JSON.parse(options.body):{};
 let result,status=200;
 try{
  if(path==='/session')result={configured:true,authenticated:true,csrf:'non-secret-ui-fixture'};
  else if(path==='/state')result=s;
  else if(path==='/command'){if(p.expectedRevision!==s.revision)throw new Error('数据版本已变化');cmd(p.command.type,p.command.payload);result=s;}
  else if(path==='/report')result=report(s,u.searchParams.get('month'));
  else if(path==='/annual')result=annualReport(s,u.searchParams.get('year'));
  else if(path==='/audit')result={rows:[],importedCount:0};
  else throw new Error('UI合成数据环境不执行认证、导出或恢复。真实接口已由自动化集成测试验证。');
 }catch(e){result={error:e.message};status=422;}
 return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
};
const note=document.createElement('div');note.textContent='界面验收 · 合成数据 · 刷新即重置';note.setAttribute('role','note');note.className='qa-fixture-note';document.body.prepend(note);
