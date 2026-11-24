import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,applyCommand,totals,balance,report,monthEnd,DEFAULT_POLICY,allocationAdvice,obligationBalance,cents,roundBps,annualReport} from '../src/core.mjs';
const STAMP='2026-11-10T12:00:00+08:00',OPEN='2026-10-01T00:00:00+08:00',T='2026-10-12T12:00:00+08:00',END=monthEnd('2026-10');
function fixture(){let s=emptyState();const cmd=(type,payload)=>{s=applyCommand(s,{type,payload},STAMP);return s;};cmd('initialize',{at:OPEN});const acc=(name,group,amount,kind='cash',restriction='free')=>{cmd('account.add',{name,platform:name,group,amount,kind,restriction,at:OPEN});return s.accounts.at(-1).id;};const liquid=acc('微信A','liquid',100000),savings=acc('中国银行卡','savings',1000000),meal=acc('饭卡','liquid',0,'prepaid','restricted'),product=acc('余额宝','savings',500000,'investment','redeem');const tx=(x)=>cmd('transaction.add',{at:T,memo:'测试事项',...x});const confirm=(changes={})=>cmd('balance.confirm',{items:s.accounts.map(a=>({accountId:a.id,asOf:END,amount:changes[a.id]??balance(s,a.id,END).amount}))});return {get s(){return s;},cmd,acc,tx,confirm,liquid,savings,meal,product};}
test('整数分与四舍五入，拒绝浮点精度与超限值',()=>{assert.equal(cents('0.01'),1);assert.equal(cents('1000.10'),100010);assert.throws(()=>cents('1.001'));assert.throws(()=>cents('-1'));assert.equal(roundBps(1,5000),1);assert.equal(roundBps(101,1000),10);});
test('多账户自动汇总且理财只计一次',()=>{const f=fixture();assert.deepEqual([totals(f.s).liquid,totals(f.s).savings,totals(f.s).net],[100000,1500000,1600000]);});
test('饭卡充值100元是资产内部转移，无消费',()=>{const f=fixture();f.tx({kind:'transfer',fromId:f.liquid,toId:f.meal,amount:10000});f.confirm();const r=report(f.s,'2026-10');assert.equal(r.inferred,0);assert.equal(r.closing.liquid,100000);assert.equal(balance(f.s,f.meal,END).amount,10000);});
test('家教1000元生成100元储蓄和900元流动的待执行建议',()=>{const f=fixture();f.tx({kind:'income',toId:f.liquid,amount:100000,category:'labor'});const a=allocationAdvice(f.s,f.s.transactions.at(-1),END);assert.equal(a.targetSavings,10000);assert.equal(a.targetLiquid,90000);assert.equal(a.remaining,10000);assert.equal(balance(f.s,f.savings,END).amount,1000000);});
test('收入到账储蓄时建议向流动调出90%，按政策时点分配',()=>{const f=fixture();f.tx({kind:'income',toId:f.savings,amount:100000,category:'labor'});assert.equal(allocationAdvice(f.s,f.s.transactions.at(-1),END).remaining,-90000);});
test('家庭收入全部流动，投资损益不触发劳动分成',()=>{const f=fixture();f.tx({kind:'income',toId:f.savings,amount:20000,category:'family'});assert.equal(allocationAdvice(f.s,f.s.transactions.at(-1),END).remaining,-20000);f.confirm({[f.product]:505000});assert.equal(report(f.s,'2026-10').income,20000);assert.equal(report(f.s,'2026-10').investmentGain,5000);});
test('已完成收入分配后不重复建议',()=>{const f=fixture();f.tx({kind:'income',toId:f.liquid,amount:100000,category:'labor'});const id=f.s.transactions.at(-1).id;f.tx({kind:'transfer',fromId:f.liquid,toId:f.savings,amount:10000,purpose:'income_allocation',relatedId:id});assert.equal(allocationAdvice(f.s,f.s.transactions[0],END).remaining,0);});
test('储蓄借出3000：现金下降，债权上升，净资产不变',()=>{const f=fixture();f.cmd('obligation.add',{kind:'receivable',party:'家长',opening:0,at:OPEN});const o=f.s.obligations.at(-1);f.tx({kind:'lend',fromId:f.savings,amount:300000,obligationId:o.id});f.confirm();const r=report(f.s,'2026-10');assert.equal(r.closing.net,1600000);assert.equal(r.closing.receivables,300000);assert.equal(r.closing.savings,1200000);assert.equal(r.special,0);assert.equal(r.surplus,0);});
test('赞助400是特殊支出，不把借出3000一起当赤字',()=>{const f=fixture();f.cmd('obligation.add',{kind:'receivable',party:'家长',opening:0,at:OPEN});f.tx({kind:'lend',fromId:f.savings,amount:300000,obligationId:f.s.obligations.at(-1).id});f.tx({kind:'expense',fromId:f.savings,amount:40000});f.confirm();const r=report(f.s,'2026-10');assert.equal(r.special,40000);assert.equal(r.inferred,0);assert.equal(r.surplus,-40000);assert.equal(r.closing.net,1560000);});
test('借入与还债仅改变构成，不是收入消费',()=>{const f=fixture();f.cmd('obligation.add',{kind:'payable',party:'朋友',opening:0,at:OPEN});const id=f.s.obligations.at(-1).id;f.tx({kind:'borrow',toId:f.liquid,amount:30000,obligationId:id});f.tx({kind:'repay_debt',fromId:f.liquid,amount:10000,obligationId:id});f.confirm();const r=report(f.s,'2026-10');assert.equal(r.income,0);assert.equal(r.inferred,0);assert.equal(r.closing.net,1600000);assert.equal(r.closing.liabilities,20000);});
test('流动账户借出与本金收回不会混进普通消费或收入',()=>{const f=fixture();f.cmd('obligation.add',{kind:'receivable',party:'同学',opening:0,at:OPEN});const id=f.s.obligations.at(-1).id;f.tx({kind:'lend',fromId:f.liquid,amount:10000,obligationId:id});f.tx({kind:'repay_receivable',toId:f.liquid,amount:5000,obligationId:id});f.confirm();assert.equal(report(f.s,'2026-10').inferred,0);assert.equal(report(f.s,'2026-10').income,0);});
test('归还超过本金和倒序超额归还都被拒绝',()=>{const f=fixture();f.cmd('obligation.add',{kind:'receivable',party:'同学',opening:0,at:OPEN});const id=f.s.obligations.at(-1).id;assert.throws(()=>f.tx({kind:'repay_receivable',toId:f.liquid,amount:1,obligationId:id}));f.tx({kind:'lend',fromId:f.liquid,amount:10000,obligationId:id});assert.throws(()=>f.tx({kind:'repay_receivable',toId:f.liquid,amount:11000,obligationId:id}));});
test('债权核销记费用，净资产减少',()=>{const f=fixture();f.cmd('obligation.add',{kind:'receivable',party:'同学',opening:5000,at:OPEN});f.tx({kind:'writeoff',amount:5000,obligationId:f.s.obligations.at(-1).id});f.confirm();const r=report(f.s,'2026-10');assert.equal(r.special,5000);assert.equal(r.inferred,0);assert.equal(r.surplus,-5000);});
test('理财5000到5050，无进出时收益50',()=>{const f=fixture();f.confirm({[f.product]:505000});assert.equal(report(f.s,'2026-10').investmentGain,5000);assert.equal(report(f.s,'2026-10').inferred,0);});
test('申购1000不算收益；示例5000+1000-500到5550收益50',()=>{const f=fixture();f.tx({kind:'invest',fromId:f.savings,toId:f.product,amount:100000});f.tx({kind:'redeem',fromId:f.product,toId:f.savings,amount:50000});f.confirm({[f.product]:555000});const r=report(f.s,'2026-10');assert.equal(r.investmentGain,5000);assert.equal(r.inferred,0);});
test('分红进入其他现金账户，收益只计算一次',()=>{const f=fixture();f.tx({kind:'dividend',fromId:f.product,toId:f.savings,amount:10000});f.confirm({[f.product]:500000});const r=report(f.s,'2026-10');assert.equal(r.investmentGain,10000);assert.equal(r.income,0);assert.equal(r.closing.net,1610000);assert.equal(r.inferred,0);});
test('两只产品独立统计，亏损与收益正确加总',()=>{const f=fixture();const p2=f.acc('基金','savings',100000,'investment','redeem');f.confirm({[f.product]:505000,[p2]:98000});const r=report(f.s,'2026-10');assert.equal(r.products.length,2);assert.equal(r.investmentGain,3000);});
test('不允许普通转账误入理财，防止收益计算失真',()=>{const f=fixture();assert.throws(()=>f.tx({kind:'transfer',fromId:f.savings,toId:f.product,amount:10000}));assert.throws(()=>f.tx({kind:'income',toId:f.product,category:'labor',amount:10000}));});
test('跨组调拨不计收入支出，不改变净资产',()=>{const f=fixture();f.tx({kind:'transfer',fromId:f.savings,toId:f.liquid,amount:10000});f.confirm();const r=report(f.s,'2026-10');assert.equal(r.inferred,0);assert.equal(r.income,0);assert.equal(r.savingsUses.length,1);});
test('未知流动消费通过期初期末推算，须逐账户确认后结算',()=>{const f=fixture();f.confirm({[f.liquid]:65000});const r=report(f.s,'2026-10');assert.equal(r.inferred,35000);assert.equal(r.canClose,true);f.cmd('month.close',{month:'2026-10',confirmed:true});assert.equal(f.s.settlements.length,1);assert.equal(f.s.transactions.length,0);});
test('负差额提示核对，不能强行结算或创建虚假消费',()=>{const f=fixture();f.confirm({[f.liquid]:110000});const r=report(f.s,'2026-10');assert.equal(r.consumption,null);assert.equal(r.canClose,false);assert.throws(()=>f.cmd('month.close',{month:'2026-10',confirmed:true}));assert.equal(f.s.transactions.length,0);});
test('未逐一确认账户，不得正式结算',()=>{const f=fixture();assert.equal(report(f.s,'2026-10').canClose,false);assert.throws(()=>f.cmd('month.close',{month:'2026-10',confirmed:true}));});
test('后补期末余额保留所属时点和录入时间，拒绝未来余额',()=>{const f=fixture();f.confirm();const b=f.s.balances.at(-1);assert.equal(b.asOf,END);assert.equal(b.recordedAt,STAMP);assert.throws(()=>f.cmd('balance.confirm',{items:[{accountId:f.liquid,asOf:'2026-12-01T00:00:00+08:00',amount:1}]}));});
test('月末调拨加回计算基数，完成后不会重新建议',()=>{const f=fixture();f.tx({kind:'transfer',fromId:f.liquid,toId:f.savings,amount:28000,purpose:'month_end',relatedId:'2026-10'});f.confirm();const r=report(f.s,'2026-10');assert.equal(r.expectedSweep,28000);assert.equal(r.actualSweep,28000);assert.equal(r.sweepRemaining,0);});
test('历史政策不会被新政策改写',()=>{const f=fixture(),old=report(f.s,'2026-10').policyId;f.cmd('policy.add',{...DEFAULT_POLICY,effective:'2026-11-11',reserve:2000000});assert.equal(report(f.s,'2026-10').policyId,old);assert.equal(report(f.s,'2026-10').policy.reserve,1500000);assert.throws(()=>f.cmd('policy.add',{...DEFAULT_POLICY,effective:'2026-09-01'}));});
test('历史事项更正保留原值，原封存报表不变且标记待修订',()=>{const f=fixture();f.tx({kind:'expense',fromId:f.savings,amount:40000});f.confirm();f.cmd('month.close',{month:'2026-10',confirmed:true});const original=structuredClone(f.s.settlements[0].report),t=f.s.transactions[0];f.cmd('transaction.correct',{...t,amount:30000,reason:'金额录入错误'});assert.equal(f.s.transactions[0].history[0].amount,40000);assert.deepEqual(f.s.settlements[0].report,original);assert.equal(f.s.settlements[0].stale,true);f.cmd('month.close',{month:'2026-10',confirmed:true,reason:'更正支出'});assert.equal(f.s.settlements.length,2);assert.equal(f.s.settlements[1].version,2);});
test('跨月在途资产完整保留，避免误判为消费',()=>{const f=fixture();const transit=f.acc('在途','savings',0,'transit','restricted');f.tx({kind:'transfer',fromId:f.savings,toId:transit,amount:100000});f.confirm();assert.equal(report(f.s,'2026-10').inferred,0);assert.equal(report(f.s,'2026-10').closing.net,1600000);});
test('平台参考值不参与资产加总',()=>{const f=fixture();const before=totals(f.s).net;f.cmd('platform.check',{platform:'支付宝',amount:999999999,asOf:T});assert.equal(totals(f.s).net,before);});
test('储蓄基准包含理财，债权与自由可用资金单独展示',()=>{const f=fixture(),t=totals(f.s);assert.equal(t.savings,1500000);assert.equal(t.freeSavings,1000000);assert.equal(t.redeemSavings,500000);});
test('饭卡330+微信20：不触发50流动线，但自由资金不足',()=>{const f=fixture();f.confirm({[f.liquid]:2000,[f.meal]:33000});const r=report(f.s,'2026-10');assert.equal(r.closing.liquid,35000);assert.ok(r.warnings.some(x=>x.includes('自由调配')));assert.ok(!r.warnings.some(x=>x.includes('流动账户组低于')));});
test('新建账户/债权不得凭空带入期后本金，归档非零拒绝',()=>{const f=fixture();assert.throws(()=>f.cmd('account.add',{name:'新',platform:'银行',group:'savings',kind:'cash',restriction:'free',at:T,amount:10000}));assert.throws(()=>f.cmd('obligation.add',{party:'新',kind:'receivable',at:T,opening:10000}));assert.throws(()=>f.cmd('account.update',{id:f.savings,status:'archived',at:T}));});
test('更改账户组保留历史归属，不改变历史净资产',()=>{const f=fixture();f.cmd('account.update',{id:f.liquid,group:'savings',at:'2026-11-05T12:00:00+08:00'});assert.equal(totals(f.s,END).liquid,100000);assert.equal(totals(f.s,STAMP).liquid,0);});
test('首个非完整自然月明确标识，月初零点起算则完整',()=>{const f=fixture();assert.equal(report(f.s,'2026-10').incomplete,false);let s=applyCommand(emptyState(),{type:'initialize',payload:{at:'2026-10-15T12:00:00+08:00'}},STAMP);assert.equal(report(s,'2026-10').incomplete,true);});
test('缺少准确期初快照的后续月份不能正式结算',()=>{const f=fixture();const end=monthEnd('2026-11');const later='2026-12-02T12:00:00+08:00';const s=applyCommand(f.s,{type:'balance.confirm',payload:{items:f.s.accounts.map(a=>({accountId:a.id,asOf:end,amount:balance(f.s,a.id,end).amount}))}},later);assert.equal(report(s,'2026-11').canClose,false);});
test('年度报告只汇总每月最新封存版本',()=>{const f=fixture();f.confirm();f.cmd('month.close',{month:'2026-10',confirmed:true});f.cmd('month.close',{month:'2026-10',confirmed:true,reason:'复核'});assert.equal(annualReport(f.s,'2026').months.length,1);});
test('新账户建立时点恰有转入，不会被零余额期初快照吞掉',()=>{const f=fixture();f.cmd('account.add',{name:'新钱包',platform:'银行',group:'liquid',kind:'cash',restriction:'free',amount:0,at:T});const id=f.s.accounts.at(-1).id;f.tx({kind:'transfer',fromId:f.liquid,toId:id,amount:10000});assert.equal(balance(f.s,id,END).amount,10000);assert.equal(totals(f.s,END).net,1600000);});
test('更正有政策调拨关联的收入为作废时，必须先处理依赖记录',()=>{const f=fixture();f.tx({kind:'income',toId:f.liquid,amount:100000,category:'labor'});const t=f.s.transactions.at(-1);f.tx({kind:'transfer',fromId:f.liquid,toId:f.savings,amount:10000,purpose:'income_allocation',relatedId:t.id});assert.throws(()=>f.cmd('transaction.correct',{...t,void:true,reason:'误记'}),/关联收入/);});
test('理财现金分红进入流动时生成归储蓄待办，执行后不重复建议',()=>{const f=fixture();f.tx({kind:'dividend',fromId:f.product,toId:f.liquid,amount:10000});const id=f.s.transactions.at(-1).id;assert.equal(report(f.s,'2026-10').investmentAllocations[0].remaining,10000);f.tx({kind:'transfer',fromId:f.liquid,toId:f.savings,amount:10000,purpose:'investment_allocation',relatedId:id});assert.equal(report(f.s,'2026-10').investmentAllocations[0].remaining,0);});
test('期初债权可纠错并保留历史，但不能低于已还本金',()=>{const f=fixture();f.cmd('obligation.add',{kind:'receivable',party:'家长',opening:300000,at:OPEN});const id=f.s.obligations.at(-1).id;f.cmd('obligation.update',{id,party:'家长',opening:290000,memo:'修正',reason:'期初录入有误'});assert.equal(f.s.obligations[0].history[0].opening,300000);assert.equal(totals(f.s,OPEN).receivables,290000);f.tx({kind:'repay_receivable',obligationId:id,toId:f.savings,amount:200000});assert.throws(()=>f.cmd('obligation.update',{id,party:'家长',opening:190000,reason:'不合法'}));});

test('储蓄与流动现金均可借出本金，储蓄动用与债权分开核算',()=>{
 const f=fixture();
 f.cmd('obligation.add',{kind:'payable',party:'测试债务',opening:10000,at:OPEN});
 f.cmd('obligation.add',{kind:'receivable',party:'测试债权',opening:0,at:OPEN});
 const obligationId=f.s.obligations.at(-1).id,opening=totals(f.s,OPEN);
 f.tx({kind:'lend',fromId:f.savings,amount:300000,obligationId});
 f.tx({kind:'lend',fromId:f.liquid,amount:25000,obligationId});
 f.confirm();
 const r=report(f.s,'2026-10'),closing=r.closing;
 assert.equal(balance(f.s,f.savings,END).amount,700000);
 assert.equal(balance(f.s,f.liquid,END).amount,75000);
 assert.equal(closing.receivables,325000);
 assert.equal(closing.liabilities,10000);
 assert.equal(closing.assets,opening.assets);
 assert.equal(closing.net,closing.assets-closing.liabilities);
 assert.equal(closing.net,opening.net);
 assert.deepEqual([r.consumption,r.special,r.investmentGain],[0,0,0]);
 assert.deepEqual(r.savingsUses.map(t=>t.fromId),[f.savings]);
 assert.equal(r.savingsUseAmount,300000);
 assert.ok(r.warnings.includes('储蓄资产低于储备基准'));
});

test('须赎回的现金管理产品先过真实结算账户，再借出本金',()=>{
 const f=fixture();
 f.cmd('obligation.add',{kind:'receivable',party:'测试债权',opening:0,at:OPEN});
 const obligationId=f.s.obligations[0].id,amount=300000,opening=totals(f.s,OPEN);
 const lend={kind:'lend',fromId:f.product,amount,obligationId};
 assert.throws(()=>f.tx(lend),/先记录赎回/);
 f.tx({kind:'redeem',fromId:f.product,toId:f.savings,amount});
 assert.equal(balance(f.s,f.savings,T).amount,1300000);
 f.tx({...lend,fromId:f.savings});
 f.confirm();
 const r=report(f.s,'2026-10');
 assert.equal(balance(f.s,f.product,END).amount,200000);
 assert.equal(balance(f.s,f.savings,END).amount,1000000);
 assert.equal(r.closing.receivables,amount);
 assert.equal(r.closing.net,r.closing.assets-r.closing.liabilities);
 assert.equal(r.closing.net,opening.net);
 assert.deepEqual([r.consumption,r.special,r.investmentGain,r.savingsUseAmount],[0,0,0,amount]);
});

test('时点筛选拒绝未建立与停用账户，归档账户可更正曾启用时的事项',()=>{
 const f=fixture(),after='2026-10-20T12:00:00+08:00';
 f.cmd('account.add',{name:'晚开账户',platform:'测试银行',group:'liquid',kind:'cash',restriction:'free',amount:0,at:after});
 const late=f.s.accounts.at(-1).id;
 const expense={kind:'expense',fromId:late,amount:1000};
 assert.throws(()=>f.tx(expense),/尚未建立/);
 f.tx({...expense,at:after});
 const old=f.s.transactions.at(-1);
 f.cmd('balance.confirm',{items:[{accountId:late,asOf:'2026-10-21T12:00:00+08:00',amount:0}]});
 f.cmd('account.update',{id:late,status:'inactive',at:'2026-10-22T12:00:00+08:00'});
 assert.throws(()=>f.tx({...expense,at:'2026-10-23T12:00:00+08:00'}),/已停用/);
 f.cmd('account.update',{id:late,status:'archived',at:'2026-10-24T12:00:00+08:00'});
 assert.throws(()=>f.tx({...expense,at:'2026-10-25T12:00:00+08:00'}),/已归档/);
 f.cmd('transaction.correct',{...old,memo:'更正历史说明',reason:'核对原始凭证'});
 assert.equal(f.s.transactions.at(-1).version,2);
 assert.equal(f.s.transactions.at(-1).history[0].at,after);
});

test('已用账户的追溯归档不得使原有事项失效',()=>{
 const f=fixture(),fromId=f.acc('零余额账户','liquid',0);
 f.tx({kind:'expense',fromId,amount:100});
 assert.throws(()=>f.cmd('account.update',{id:fromId,status:'archived',at:OPEN}),/已登记的历史事项失效/);
 assert.equal(f.s.accounts.find(a=>a.id===fromId).history.length,1);
});

test('真实现金和预付储值支持实际用途，借还本金拒绝受限和在途资产',()=>{
 const f=fixture();
 const transit=f.acc('在途','savings',0,'transit','restricted');
 const restricted=f.acc('限定用途现金','savings',0,'cash','restricted');
 f.cmd('obligation.add',{kind:'receivable',party:'测试债权',opening:0,at:OPEN});
 const lend={kind:'lend',amount:100,obligationId:f.s.obligations[0].id};
 for(const [fromId,reason] of [[f.meal,/现金账户/],[transit,/实际到账/],[restricted,/限定用途/]]){
  assert.throws(()=>f.tx({...lend,fromId}),reason);
 }
 f.tx({kind:'transfer',fromId:f.liquid,toId:f.meal,amount:1000});
 f.tx({kind:'expense',fromId:f.meal,amount:100});
 assert.equal(balance(f.s,f.meal,T).amount,900);
 assert.throws(()=>f.tx({kind:'invest',fromId:f.meal,toId:f.product,amount:100}),/现金账户/);
});

test('旧版已有的非现金借还可保留和更正说明，改变发生时点时重新验证',()=>{
 const f=fixture(),id='legacy-loan';
 f.cmd('obligation.add',{kind:'receivable',party:'旧债权',opening:0,at:OPEN});
 const t={id,kind:'lend',fromId:f.meal,amount:100,at:T,obligationId:f.s.obligations[0].id,memo:'旧版记录',version:1};
 f.s.transactions.push(t);
 f.cmd('transaction.correct',{...t,memo:'核对说明',reason:'历史备注'});
 f.tx({kind:'expense',fromId:f.liquid,amount:100});
 assert.throws(()=>f.cmd('transaction.correct',{...t,at:'2026-10-13T12:00:00+08:00',reason:'修改时间'}),/现金账户/);
 assert.equal(f.s.transactions[0].version,2);
});

test('有申赎、分红、更正历史或历史余额变化的账户禁止直接改为现金',()=>{
 for(const kind of ['invest','redeem','dividend','void','snapshot']){
  const f=fixture();
  if(kind==='snapshot')f.confirm({[f.product]:510000});
  else{
   f.tx({kind:kind==='void'?'redeem':kind,fromId:kind==='invest'?f.savings:f.product,toId:kind==='invest'?f.product:f.savings,amount:100});
   if(kind==='void')f.cmd('transaction.correct',{...f.s.transactions.at(-1),void:true,reason:'撤销测试事项'});
  }
  const prior=structuredClone(f.s);
  assert.throws(()=>f.cmd('account.kind.correct',{id:f.product,restriction:'free',reason:'测试',confirmed:true}),/历史余额|已有事项/);
  assert.deepEqual(f.s,prior);
 }
});
