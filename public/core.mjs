// All monetary values are integer CNY cents. Calendar and valuation times: Asia/Shanghai.
export const DEFAULT_POLICY = Object.freeze({reserve:1500000,retained:30000,low:5000,freeLow:5000,temporaryMin:5000,temporaryMax:40000,laborSavingsBps:1000,sweepBps:4000,otherSavingsBps:0});
export class DomainError extends Error { constructor(message,status=422){super(message);this.status=status;} }
export const demand=(v,m,status=422)=>{if(!v)throw new DomainError(m,status);};
export const uid=()=>crypto.randomUUID();
export const now=()=>new Date(Date.now()+8*3600000).toISOString().replace('Z','+08:00');
export function money(v){demand(Number.isSafeInteger(v)&&Math.abs(v)<=1e12,'金额必须为整数分，且不超过100亿元');return v;}
export function cents(text){demand(/^\d+(\.\d{1,2})?$/.test(String(text)),'请输入最多两位小数的非负金额');const [a,b='']=String(text).split('.');return money(Number(a)*100+Number(b.padEnd(2,'0')));}
export const roundBps=(amount,bps)=>{money(amount);demand(Number.isInteger(bps)&&bps>=0&&bps<=10000,'比例无效');return Number((BigInt(amount)*BigInt(bps)+5000n)/10000n);};
export function time(v){demand(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?\+08:00$/.test(v)&&Number.isFinite(Date.parse(v)),'时间须为有效的北京时间'); const d=new Date(Date.parse(v)+8*3600000).toISOString().slice(0,19);demand(d===v.slice(0,19),'时间不存在');return v;}
export const ms=v=>Date.parse(v);
export function monthEnd(month){demand(/^\d{4}-(0[1-9]|1[0-2])$/.test(month),'月份无效');const [y,m]=month.split('-').map(Number);return `${month}-${new Date(Date.UTC(y,m,0)).getUTCDate()}T23:59:59.999+08:00`;}
export const monthStart=m=>`${m}-01T00:00:00.000+08:00`;
export const previousEnd=m=>new Date(ms(monthStart(m))-1+8*3600000).toISOString().replace('Z','+08:00');
export const inRange=(t,a,b)=>ms(t)>ms(a)&&ms(t)<=ms(b);
const text=(v,label,max=120)=>{demand(typeof v==='string'&&v.trim().length>0&&v.length<=max,`${label}不能为空且不能超过${max}字`);return v.trim();};
export function emptyState(){return {schemaVersion:1,revision:0,setup:null,accounts:[],balances:[],transactions:[],obligations:[],policies:[],settlements:[]};}
export function policyAt(s,at){return s.policies.filter(p=>p.effective<=at.slice(0,10)).sort((a,b)=>a.effective.localeCompare(b.effective)||a.createdAt.localeCompare(b.createdAt)).at(-1);}
export function accountAt(a,at){const h=a.history.filter(h=>ms(h.effectiveAt)<=ms(at)).sort((a,b)=>ms(a.effectiveAt)-ms(b.effectiveAt)).at(-1);return h?{...a,...h}:null;}
export const accountById=(s,id)=>{const a=s.accounts.find(a=>a.id===id);demand(a,'账户不存在');return a;};
export function postings(t){if(t.void)return [];switch(t.kind){case'income':case'borrow':case'repay_receivable':return [[t.toId,t.amount]];case'expense':case'lend':case'repay_debt':return [[t.fromId,-t.amount]];case'transfer':case'invest':case'redeem':case'dividend':return [[t.fromId,-t.amount],[t.toId,t.amount]];case'adjustment':return [[t.accountId,t.direction*t.amount]];case'writeoff':return [];default:throw new DomainError('未知事项类型');}}
export function balance(s,id,at=now()){
 const a=accountById(s,id);if(!accountAt(a,at))return null;
 const snapshot=s.balances.filter(b=>b.accountId===id&&ms(b.asOf)<=ms(at)).sort((a,b)=>ms(a.asOf)-ms(b.asOf)||a.sequence-b.sequence).at(-1);
 if(!snapshot)return {amount:0,asOf:null,estimated:true};
 const delta=s.transactions.filter(t=>inRange(t.at,snapshot.asOf,at)||(snapshot.opening&&ms(t.at)===ms(snapshot.asOf)&&ms(t.at)<=ms(at))).flatMap(postings).filter(([x])=>x===id).reduce((n,[,v])=>n+v,0);
 return {amount:money(snapshot.amount+delta),asOf:snapshot.asOf,estimated:delta!==0||ms(at)-ms(snapshot.asOf)>86400000,snapshot};
}
export function obligationBalance(s,o,at=now()){
 if(ms(o.openedAt)>ms(at))return 0;
 return money(o.opening+s.transactions.filter(t=>!t.void&&t.obligationId===o.id&&ms(t.at)<=ms(at)).reduce((sum,t)=>sum+(['lend','borrow'].includes(t.kind)?t.amount:-t.amount),0));
}
export function totals(s,at=now()){
 const v={liquid:0,savings:0,freeLiquid:0,freeSavings:0,redeemSavings:0,investment:0,receivables:0,liabilities:0,assets:0,net:0};
 for(const a of s.accounts){const h=accountAt(a,at);if(!h)continue;const b=balance(s,a.id,at).amount; v[h.group]+=b; if(h.restriction==='free')v[h.group==='liquid'?'freeLiquid':'freeSavings']+=b;if(h.group==='savings'&&h.restriction==='redeem')v.redeemSavings+=b;if(h.kind==='investment')v.investment+=b;}
 for(const o of s.obligations)v[o.kind==='receivable'?'receivables':'liabilities']+=obligationBalance(s,o,at);
 v.assets=money(v.liquid+v.savings+v.receivables);v.net=money(v.assets-v.liabilities);return v;
}
export function productReport(s,a,start,end){
 const begin=balance(s,a.id,start)?.amount??0, finish=balance(s,a.id,end)?.amount??0;
 const ts=s.transactions.filter(t=>!t.void&&inRange(t.at,start,end));
 const put=ts.filter(t=>t.kind==='invest'&&t.toId===a.id).reduce((n,t)=>n+t.amount,0);
 const take=ts.filter(t=>t.kind==='redeem'&&t.fromId===a.id).reduce((n,t)=>n+t.amount,0);
 const dividend=ts.filter(t=>t.kind==='dividend'&&t.fromId===a.id).reduce((n,t)=>n+t.amount,0);
 return {id:a.id,name:a.name,platform:a.platform,begin,end:finish,put,take,dividend,gain:money(finish-begin-put+take+dividend)};
}
export function allocationAdvice(s,t,until=now()){
 const p=policyAt(s,t.at);const target=roundBps(t.amount,t.category==='labor'?p.laborSavingsBps:t.category==='other'?p.otherSavingsBps:0);
 const received=accountAt(accountById(s,t.toId),t.at).group==='savings'?t.amount:0;
 const actual=s.transactions.filter(x=>!x.void&&x.kind==='transfer'&&ms(x.at)<=ms(until)&&x.purpose==='income_allocation'&&x.relatedId===t.id).reduce((n,x)=>n+(accountAt(accountById(s,x.toId),x.at).group==='savings'?x.amount:-x.amount),0);
 return {incomeId:t.id,targetSavings:target,targetLiquid:t.amount-target,actual,remaining:target-received-actual,policyId:p.id};
}
export function report(s,month){
 demand(s.setup,'请先完成首次建账');const end=monthEnd(month);demand(ms(end)>=ms(s.setup.at),'该月早于建账时间');
 const start=ms(previousEnd(month))<ms(s.setup.at)?s.setup.at:previousEnd(month);
 const opening=totals(s,start),closing=totals(s,end);const ts=s.transactions.filter(t=>!t.void&&inRange(t.at,start,end));
 const incomes=ts.filter(t=>t.kind==='income');const income=incomes.reduce((n,t)=>n+t.amount,0);
 const products=s.accounts.filter(a=>a.kind==='investment'&&ms(a.createdAt)<=ms(end)).map(a=>productReport(s,a,start,end));
 const investmentGain=products.reduce((n,p)=>n+p.gain,0);
 const special=ts.filter(t=>t.kind==='expense'||t.kind==='writeoff').reduce((n,t)=>n+t.amount,0);
 const otherChange=ts.filter(t=>t.kind==='adjustment').reduce((n,t)=>n+t.direction*t.amount,0);
 const inferred=money(opening.net+income+investmentGain+otherChange-special-closing.net);
 const policy=policyAt(s,end);demand(policy,'缺少当期政策');
 const sweeps=ts.filter(t=>t.kind==='transfer'&&t.purpose==='month_end'&&t.relatedId===month);
 const actualSweep=sweeps.reduce((n,t)=>n+t.amount,0);
 const expectedSweep=roundBps(Math.max(0,closing.liquid+actualSweep-policy.retained),policy.sweepBps);
 const required=s.accounts.filter(a=>ms(a.createdAt)<=ms(end));
 const unconfirmed=required.filter(a=>!s.balances.some(b=>b.accountId===a.id&&ms(b.asOf)===ms(end))).map(a=>a.name);
 const unconfirmedOpening=s.accounts.filter(a=>ms(a.createdAt)<=ms(start)&&!s.balances.some(b=>b.accountId===a.id&&ms(b.asOf)===ms(start))).map(a=>a.name);
 const negative=s.accounts.filter(a=>ms(a.createdAt)<=ms(end)&&balance(s,a.id,end).amount<0).map(a=>a.name);
 const warnings=[];
 if(unconfirmed.length)warnings.push(`尚未逐一核验期末余额：${unconfirmed.join('、')}`);
 if(unconfirmedOpening.length)warnings.push(`缺少准确期初快照：${unconfirmedOpening.join('、')}`);
 if(negative.length)warnings.push(`账户出现负余额：${negative.join('、')}`);
 if(inferred<0)warnings.push('推算消费为负数，请核对遗漏收入、估值或特殊事项');
 const investmentAllocations=ts.filter(t=>t.kind==='dividend'&&accountAt(accountById(s,t.toId),t.at).group==='liquid').map(t=>({id:t.id,memo:t.memo,remaining:Math.max(0,t.amount-s.transactions.filter(x=>!x.void&&x.kind==='transfer'&&x.purpose==='investment_allocation'&&x.relatedId===t.id&&ms(x.at)<=ms(end)).reduce((n,x)=>n+x.amount,0))}));
 if(investmentAllocations.some(x=>x.remaining))warnings.push('理财现金收益进入流动账户，存在待归入储蓄的调拨');
 for(const t of incomes)if(t.category==='supplement'&&(t.amount<policyAt(s,t.at).temporaryMin||t.amount>policyAt(s,t.at).temporaryMax))warnings.push('家庭临时补充金额超出当期政策参考范围，请核对实际情况');
 const allocations=incomes.map(t=>allocationAdvice(s,t,end));
 if(allocations.some(a=>a.remaining!==0))warnings.push('存在待执行的收入分配调拨');
 if(closing.savings<policy.reserve)warnings.push('储蓄资产低于储备基准');
 if(closing.liquid<policy.low)warnings.push('流动账户组低于政策预警线');
 if(closing.freeLiquid<policy.freeLow)warnings.push('自由调配资金偏低');
 const savingsUses=ts.filter(t=>t.fromId&&accountAt(accountById(s,t.fromId),t.at)?.group==='savings'&&(['expense','lend','repay_debt'].includes(t.kind)||['transfer','redeem','dividend'].includes(t.kind)&&accountAt(accountById(s,t.toId),t.at)?.group==='liquid'));
 return {month,start,end,incomplete:ms(s.setup.at)>ms(monthStart(month)),opening,closing,income,incomeBreakdown:Object.fromEntries(['family','labor','supplement','other'].map(c=>[c,incomes.filter(t=>t.category===c).reduce((n,t)=>n+t.amount,0)])),special,otherChange,products,investmentGain,inferred,consumption:inferred>=0?inferred:null,surplus:inferred>=0?income-special-inferred:null,consumptionSource:'balance_difference',policyId:policy.id,policy,allocations,investmentAllocations,expectedSweep,actualSweep,sweepRemaining:Math.max(0,expectedSweep-actualSweep),sweepExcess:Math.max(0,actualSweep-expectedSweep),savingsUses,savingsUseAmount:savingsUses.reduce((n,t)=>n+t.amount,0),unconfirmed,unconfirmedOpening,warnings,canClose:unconfirmed.length===0&&unconfirmedOpening.length===0&&negative.length===0&&inferred>=0};
}
export function annualReport(s,year){
 const months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
 const reports=months.map(m=>s.settlements.filter(x=>x.month===m).at(-1)).filter(Boolean);
 const sum=k=>reports.reduce((n,r)=>n+(r.report[k]??0),0);
 const income=sum('income'),expense=sum('special')+sum('consumption');const labor=reports.reduce((n,r)=>n+r.report.incomeBreakdown.labor,0);
 return {year,months:reports.map(r=>({month:r.month,version:r.version,stale:r.stale,...r.report})),income,expense,surplus:sum('surplus'),investmentGain:sum('investmentGain'),labor,laborShare:income?labor/income:null,laborCoverage:expense?labor/expense:null,savingsUseAmount:sum('savingsUseAmount'),savingsUseCount:reports.reduce((n,r)=>n+r.report.savingsUses.length,0),netChange:reports.length?reports.at(-1).report.closing.net-reports[0].report.opening.net:0,savingsChange:reports.length?reports.at(-1).report.closing.savings-reports[0].report.opening.savings:0};
}
function validatePolicy(p){demand(p.reserve>0,'储蓄基准须大于零');for(const k of Object.keys(DEFAULT_POLICY))money(p[k]);for(const k of ['reserve','retained','low','freeLow','temporaryMin','temporaryMax'])demand(p[k]>=0,'政策金额不能为负');for(const k of ['laborSavingsBps','sweepBps','otherSavingsBps'])demand(p[k]>=0&&p[k]<=10000,'比例应为0至100%');demand(p.temporaryMin<=p.temporaryMax,'临时补充范围无效');}
function addBalance(s,b,stamp){accountById(s,b.accountId);time(b.asOf);money(b.amount);demand(b.amount>=0,'余额不能为负');demand(ms(b.asOf)>=ms(accountById(s,b.accountId).createdAt),'核验时间早于账户建立时间');demand(ms(b.asOf)<=ms(stamp),'不能确认未来余额');s.balances.push({id:uid(),accountId:b.accountId,amount:b.amount,asOf:b.asOf,recordedAt:stamp,sequence:s.balances.length+1,confirmed:true,opening:!!b.opening});}
const accountRoles={
 income:{toId:'receipt'},expense:{fromId:'payment'},transfer:{fromId:'transfer',toId:'transfer'},
 lend:{fromId:'loan'},repay_receivable:{toId:'loan'},borrow:{toId:'loan'},repay_debt:{fromId:'loan'},
 invest:{fromId:'investmentCash',toId:'product'},redeem:{fromId:'product',toId:'investmentCash'},
 dividend:{fromId:'product',toId:'investmentCash'},adjustment:{accountId:'adjustment'},writeoff:{}
};
export const transactionAccountSlots=kind=>Object.keys(Object.hasOwn(accountRoles,kind)?accountRoles[kind]:{});
export function validateTransactionTime(s,at,stamp=now()){
 time(at);
 demand(ms(at)>ms(s.setup.at)&&ms(at)<=ms(stamp),'事项时间须晚于首次建账，且不能在未来');
}
export function transactionAccountIssue(s,t,slot,id,prior=null){
 const role=accountRoles[t.kind]?.[slot];
 const account=s.accounts.find(a=>a.id===id);
 if(!account)return id?'账户不存在':'请选择账户';
 const h=accountAt(account,t.at);
 if(!h||ms(t.at)<ms(account.createdAt))return '该时点尚未建立';
 if(h.status!=='active')return h.status==='archived'?'该时点已归档':'该时点已停用';
 if(role==='product')return h.kind==='investment'?'':'此处须选独立理财产品';
 if(h.kind==='investment'){
  if(role==='adjustment')return '理财估值应通过余额核验登记';
  if(slot==='fromId')return '理财资金须先记录赎回';
  return '此处须选实际到账的非理财账户';
 }
 // Existing postings keep their original account capabilities when the account, time and purpose are unchanged.
 const unchanged=prior&&!prior.void&&prior.kind===t.kind&&ms(prior.at)===ms(t.at)&&prior[slot]===id
  &&(prior.purpose||'general')===(t.purpose||'general');
 if(!unchanged&&role!=='adjustment'){
  if(h.restriction==='redeem')return '该资金需要先赎回，请核对实际结算账户与资金限制';
  if(h.kind==='transit'&&role!=='transfer')return '在途资金须先实际到账，再使用到账账户';
  if((role==='loan'||role==='investmentCash')&&h.kind!=='cash')return '此处须选可实际收付的现金账户';
  if(role==='loan'&&h.restriction==='restricted')return '该账户限定用途，不能登记借还本金';
 }
 if(slot==='toId'&&id===t.fromId)return '转出与转入账户不能相同';
 if(t.kind==='transfer'){
  if(t.purpose==='month_end'||t.purpose==='investment_allocation'){
   const required=slot==='fromId'?'liquid':'savings';
   if(h.group!==required)return '本项政策调拨须由流动转入储蓄';
  }
  if(slot==='toId'&&t.purpose==='income_allocation'){
   const from=s.accounts.find(a=>a.id===t.fromId);
   if(from&&accountAt(from,t.at)?.group===h.group)return '收入分配须跨账户组';
  }
 }
 return '';
}
function validateTx(s,t,stamp,prior=null){
 demand(Object.hasOwn(accountRoles,t.kind),'事项类型无效');
 validateTransactionTime(s,t.at,stamp);money(t.amount);demand(t.amount>0,'金额必须大于零');text(t.memo,'事项说明',500);
 for(const slot of transactionAccountSlots(t.kind)){
  const issue=transactionAccountIssue(s,t,slot,t[slot],prior);
  demand(!issue,issue);
 }
 if(['transfer','invest','redeem','dividend'].includes(t.kind)){
  const from=accountAt(accountById(s,t.fromId),t.at),to=accountAt(accountById(s,t.toId),t.at);
  if(t.purpose==='month_end'){demand(t.kind==='transfer'&&from.group==='liquid'&&to.group==='savings','月末调拨须从流动转储蓄');monthEnd(t.relatedId);demand(t.at.slice(0,7)===t.relatedId,'月末调拨月份应与实际发生月份一致');}
  if(t.purpose==='investment_allocation'){const div=s.transactions.find(x=>x.id===t.relatedId&&!x.void&&x.kind==='dividend');demand(div&&ms(t.at)>=ms(div.at),'关联现金分红不存在或时间不符');demand(t.kind==='transfer'&&from.group==='liquid'&&to.group==='savings','理财收益归储蓄须由流动转入储蓄');}
  if(t.purpose==='income_allocation'){const income=s.transactions.find(x=>x.id===t.relatedId&&!x.void&&x.kind==='income');demand(income&&ms(t.at)>=ms(income.at),'关联收入不存在或时间不符');demand(from.group!==to.group,'收入分配须跨账户组');}
 }
 if(t.kind==='income')demand(['family','labor','supplement','other'].includes(t.category),'请选择收入类别');
 if(t.kind==='adjustment')demand(t.direction===1||t.direction===-1,'调整方向无效');
 if(['lend','repay_receivable','borrow','repay_debt','writeoff'].includes(t.kind)){
  const o=s.obligations.find(o=>o.id===t.obligationId);demand(o&&ms(o.openedAt)<=ms(t.at),'债权债务不存在');
  demand(o.kind===(['borrow','repay_debt'].includes(t.kind)?'payable':'receivable'),'债权债务类型不匹配');
 }
}
function validateObligations(s){for(const o of s.obligations){let n=o.opening;for(const t of s.transactions.filter(t=>!t.void&&t.obligationId===o.id).sort((a,b)=>ms(a.at)-ms(b.at))){n+=['lend','borrow'].includes(t.kind)?t.amount:-t.amount;demand(n>=0,'归还或核销金额超过该时点的剩余本金');}}}
const usesAccount=(t,id)=>transactionAccountSlots(t.kind).some(slot=>t[slot]===id);
export function cashCorrectionIssue(s,account){
 if(account.kind!=='investment')return '此操作仅适用于误建成独立理财产品的现金账户';
 if(s.transactions.some(t=>usesAccount(t,account.id)||(t.history||[]).some(h=>usesAccount(h,account.id)))){
  return '该账户已有事项或更正历史。请先导出备份，按实际资金流逐笔核对后做专项更正。';
 }
 const snapshots=s.balances.filter(b=>b.accountId===account.id);
 if(new Set(snapshots.map(b=>b.amount)).size>1){
  return '该账户历史余额有变动。请先导出备份，核清变动来源，以免把历史损益转成普通消费。';
 }
 return '';
}
export function applyCommand(original,command,stamp=now()){
 const s=structuredClone(original);const {type,payload:p={}}=command;let affected=stamp;
 if(type==='initialize'){
  demand(!s.setup,'已经完成首次建账');time(p.at);demand(ms(p.at)<=ms(stamp),'建账时间不能在未来');s.setup={at:p.at,recordedAt:stamp,timezone:'Asia/Shanghai',importedAudit:[]};
  const policy={...DEFAULT_POLICY,...p.policy,id:uid(),effective:p.at.slice(0,10),createdAt:stamp};validatePolicy(policy);s.policies.push(policy);affected=p.at;
 }else{
 demand(s.setup,'请先完成首次建账');
 if(type==='account.add'){
  demand(['liquid','savings'].includes(p.group),'财政归属无效');demand(['cash','prepaid','investment','transit'].includes(p.kind),'资产性质无效');demand(['free','restricted','redeem'].includes(p.restriction),'资金限制无效');
  const at=time(p.at||stamp);demand(ms(at)>=ms(s.setup.at)&&ms(at)<=ms(stamp),'账户建账时间无效');
  if(p.kind==='investment')demand(p.group==='savings','V1.0理财产品归入储蓄体系');
  const id=uid();const a={id,name:text(p.name,'账户名称',60),platform:text(p.platform,'平台',60),kind:p.kind,createdAt:at,productType:p.productType||'',redemption:p.redemption||'',history:[{effectiveAt:at,group:p.group,restriction:p.restriction,status:'active'}]};
  s.accounts.push(a);addBalance(s,{accountId:id,asOf:at,amount:p.amount,opening:true},stamp);affected=at;
  // New wealth after initial setup must have a source, not silently become an opening asset.
  demand(ms(at)===ms(s.setup.at)||p.amount===0,'建账后新增账户须以零余额开始，再记录转入或收入');
 }else if(type==='account.update'){
  const a=accountById(s,p.id);const at=time(p.at||stamp);demand(ms(at)>=ms(a.createdAt)&&ms(at)<=ms(stamp),'变更时间无效');
  a.name=text(p.name||a.name,'账户名称',60);a.platform=text(p.platform||a.platform,'平台',60);
  const prev=accountAt(a,at);const next={...prev,effectiveAt:at,group:p.group||prev.group,restriction:p.restriction||prev.restriction,status:p.status||prev.status};
  demand(['liquid','savings'].includes(next.group)&&['active','inactive','archived'].includes(next.status)&&['free','restricted','redeem'].includes(next.restriction),'账户设置无效');
  if(a.kind==='investment')demand(next.group==='savings','理财产品须留在储蓄体系');
  if(next.status!=='active')demand(balance(s,a.id,at).amount===0,'停用或归档前须确认账户余额为零');
  a.history.push({effectiveAt:at,group:next.group,restriction:next.restriction,status:next.status});a.redemption=p.redemption??a.redemption;affected=at;
  for(const t of s.transactions)if(!t.void&&ms(t.at)>=ms(at)&&usesAccount(t,a.id)){
   for(const slot of transactionAccountSlots(t.kind)){
    const issue=transactionAccountIssue(s,t,slot,t[slot],t);
    demand(!issue,'变更会使已登记的历史事项失效：'+issue);
   }
  }
 }else if(type==='account.kind.correct'){
  const a=accountById(s,p.id);
  const issue=cashCorrectionIssue(s,a);demand(!issue,issue);
  demand(p.confirmed===true,'请确认该账户从建立起就是现金账户');
  text(p.reason,'更正理由',500);
  if(a.history.some(h=>h.restriction==='redeem')){
   demand(['free','restricted'].includes(p.restriction),'请选择现金账户的实际资金限制');
   for(const h of a.history)if(h.restriction==='redeem')h.restriction=p.restriction;
  }
  a.kind='cash';affected=a.createdAt;
 }else if(type==='platform.check'){
  const platform=text(p.platform,'平台名称',60);money(p.amount);demand(p.amount>=0,'参考金额不能为负');time(p.asOf);demand(ms(p.asOf)<=ms(stamp),'参考时点不能在未来');s.setup.platformReferences=[...(s.setup.platformReferences||[]),{id:uid(),platform,amount:p.amount,asOf:p.asOf,recordedAt:stamp}];affected=null;
 }else if(type==='balance.confirm'){
  demand(Array.isArray(p.items)&&p.items.length>0&&p.items.length<=200,'请提交待核验账户');for(const b of p.items){addBalance(s,{...b,opening:false},stamp);if(ms(b.asOf)<ms(affected))affected=b.asOf;}
 }else if(type==='obligation.add'){
  demand(['receivable','payable'].includes(p.kind),'类型无效');money(p.opening);demand(p.opening>=0,'本金不能为负');
  const at=time(p.at||stamp);demand(ms(at)>=ms(s.setup.at)&&ms(at)<=ms(stamp),'建立时间无效');demand(ms(at)===ms(s.setup.at)||p.opening===0,'建账后新增债权债务须通过借出或借入事项增加本金');
  s.obligations.push({id:uid(),kind:p.kind,party:text(p.party,'对方姓名',60),memo:p.memo||'',opening:p.opening,openedAt:at});affected=at;
 }else if(type==='obligation.update'){
  const o=s.obligations.find(x=>x.id===p.id);demand(o,'借还款档案不存在');text(p.reason,'更正理由',500);money(p.opening);demand(p.opening>=0,'期初本金不能为负');demand(ms(o.openedAt)===ms(s.setup.at)||p.opening===0,'期后借款本金只能通过真实借还款事项更新');
  const old={...o,history:undefined};o.history=[...(o.history||[]),{...old,reason:p.reason,correctedAt:stamp}];o.party=text(p.party,'对方姓名',60);o.memo=p.memo||'';o.opening=p.opening;validateObligations(s);affected=o.openedAt;
 }else if(type==='transaction.add'||type==='transaction.correct'){
  let prior=null;if(type==='transaction.correct'){prior=s.transactions.find(t=>t.id===p.id);demand(prior,'原事项不存在');text(p.reason,'更正理由',500);affected=prior.at;}
  const t={id:prior?.id||uid(),kind:p.kind,at:p.at,amount:p.amount,memo:p.memo,fromId:p.fromId||null,toId:p.toId||null,accountId:p.accountId||null,obligationId:p.obligationId||null,category:p.category||null,purpose:p.purpose||null,relatedId:p.relatedId||null,direction:p.direction||1,void:!!p.void,recordedAt:stamp,version:(prior?.version||0)+1,history:prior?[...(prior.history||[]),{...prior,history:undefined,reason:p.reason,correctedAt:stamp}]:[]};
  if(!t.void)validateTx(s,t,stamp,prior);else demand(prior,'新增事项不能直接作废');
  if(prior)s.transactions[s.transactions.indexOf(prior)]=t;else s.transactions.push(t);validateObligations(s);for(const existing of s.transactions)if(existing!==t&&!existing.void)validateTx(s,existing,stamp,existing);if(ms(t.at)<ms(affected))affected=t.at;
 }else if(type==='policy.add'){
  demand(/^\d{4}-\d\d-\d\d$/.test(p.effective),'生效日期无效');time(`${p.effective}T00:00:00+08:00`);demand(p.effective>=stamp.slice(0,10),'新政策不能追溯覆盖历史日期');
  const v={...DEFAULT_POLICY,...p,id:uid(),createdAt:stamp};validatePolicy(v);s.policies.push(v);affected=`${p.effective}T00:00:00+08:00`;
 }else if(type==='month.close'){
  const r=report(s,p.month);demand(ms(r.end)<ms(stamp),'自然月尚未结束');demand(r.canClose,'账户核验或余额差额尚未通过');demand(p.confirmed===true,'请确认特殊事项已核对，推算消费已确认');
  const older=s.settlements.filter(x=>x.month===p.month);if(older.length)text(p.reason,'报表修订理由',500);
  s.settlements.push({id:uid(),month:p.month,version:older.length+1,closedAt:stamp,sourceRevision:s.revision,reason:p.reason||'首次封存',report:r,stale:false});
  // No ledger mutation; frozen earlier reports stay immutable.
  affected=null;
 }else throw new DomainError('未知操作');
 }
 if(affected)for(const r of s.settlements)if(ms(r.report.end)>=ms(affected))r.stale=true;
 s.revision++;return s;
}
export function validateBackupState(s){
 demand(s?.schemaVersion===1&&Number.isSafeInteger(s.revision)&&s.revision>=0&&s.setup,'备份格式不受支持');time(s.setup.at);
 for(const key of ['accounts','balances','transactions','obligations','policies','settlements']){demand(Array.isArray(s[key])&&s[key].length<=100000,'备份数据无效或过大');const ids=s[key].map(x=>x.id);demand(ids.every(x=>typeof x==='string')&&new Set(ids).size===ids.length,'备份包含重复或无效编号');}
 for(const p of s.policies){validatePolicy(p);demand(/^\d{4}-\d\d-\d\d$/.test(p.effective),'备份政策日期无效');}
 demand(s.policies.length>0,'缺少政策');
 for(const a of s.accounts){text(a.name,'账户名称');text(a.platform,'平台');time(a.createdAt);demand(['cash','prepaid','investment','transit'].includes(a.kind),'账户类型无效');demand(Array.isArray(a.history)&&a.history.length>0,'账户缺少历史');for(const h of a.history){time(h.effectiveAt);demand(['liquid','savings'].includes(h.group)&&['free','restricted','redeem'].includes(h.restriction)&&['active','inactive','archived'].includes(h.status),'账户归属无效');}}
 for(const b of s.balances){accountById(s,b.accountId);time(b.asOf);money(b.amount);demand(b.amount>=0&&Number.isSafeInteger(b.sequence),'余额无效');}
 for(const o of s.obligations){demand(['receivable','payable'].includes(o.kind),'债权债务无效');money(o.opening);demand(o.opening>=0,'本金无效');time(o.openedAt);}
 for(const t of s.transactions)if(!t.void)validateTx(s,t,now(),t);validateObligations(s);
 for(const r of s.settlements){monthEnd(r.month);demand(r.report?.month===r.month&&Number.isSafeInteger(r.version),'月结备份无效');}
 return true;
}
