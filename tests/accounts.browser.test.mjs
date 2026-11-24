import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {applyCommand,balance,emptyState,totals} from '../src/core.mjs';

const chrome=process.env.CHROME_BIN||['/usr/bin/chromium','/usr/bin/google-chrome','/opt/google/chrome/chrome'].find(existsSync);
const opening='2026-10-01T00:00:00+08:00';
const stamp='2026-11-10T12:00:00+08:00';
const at=day=>`2026-10-${String(day).padStart(2,'0')}T12:00:00+08:00`;

function fixture(){
 let state=emptyState();
 const cmd=(type,payload)=>state=applyCommand(state,{type,payload},stamp);
 const add=(name,group,kind,restriction,time,amount=0)=>{
  cmd('account.add',{name,platform:'验收账本',group,kind,restriction,at:time,amount});
  return state.accounts.at(-1).id;
 };
 cmd('initialize',{at:opening});
 const product=add('验收理财','savings','investment','redeem',opening,500000);
 const savings=add('验收储蓄','savings','cash','free',at(3));
 add('验收流动','liquid','cash','free',at(4));
 const archived=add('验收归档','liquid','cash','free',at(5));
 const inactive=add('验收停用','liquid','cash','free',at(5));
 cmd('transaction.add',{kind:'expense',at:at(6),fromId:archived,amount:100,memo:'归档前的事项'});
 cmd('balance.confirm',{items:[{accountId:archived,amount:0,asOf:at(7)}]});
 cmd('account.update',{id:archived,status:'archived',at:at(8)});
 cmd('account.update',{id:inactive,status:'inactive',at:at(8)});
 cmd('transaction.add',{kind:'redeem',at:at(4),fromId:product,toId:savings,amount:300000,memo:'为测试账户结算'});
 cmd('obligation.add',{kind:'receivable',party:'验收债权',opening:0,at:opening});
 return {get state(){return state;},cmd,savings};
}

async function exercisePicker(){
 const $=selector=>document.querySelector(selector);
 const check=(condition,message)=>{if(!condition)throw new Error(message);};
 const waitFor=async test=>{
  for(let i=0;i<100;i++){
   if(test())return;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('等待界面操作结果超时');
 };
 const input=name=>$(`#modal [name="${name}"]`);
 const change=(name,value)=>{
  input(name).value=value;
  input(name).dispatchEvent(new Event('change',{bubbles:true}));
 };
 const time=day=>change('at',`2026-10-${String(day).padStart(2,'0')}T12:00`);
 const option=(name,label)=>[...input(name).options].find(o=>o.textContent.includes(label));
 const submit=()=>$('#modal [type=submit]');
 const notice=()=>$('#modal [data-account-notice]').textContent;
 const choose=(name,label)=>{
  const found=option(name,label);
  check(found,`找不到可选账户 ${label}`);
  change(name,found.value);
  return found.value;
 };

 try{
  await waitFor(()=>$('[data-action="tx"]'));
  $('[data-action="tx"]').click();
  change('kind','lend');
  time(9);
  check(option('fromId','验收储蓄 · 储蓄 · 现金'),'储蓄现金不可选');
  check(option('fromId','验收流动 · 流动 · 现金'),'流动现金不可选');
  check(!option('fromId','验收理财')&&!option('fromId','验收归档')&&!option('fromId','验收停用'),'无效账户仍可选择');
  $('#modal details summary').click();
  for(const reason of ['须先记录赎回','该时点已归档','该时点已停用']){
   check($('#modal details[open]').textContent.includes(reason),`缺少原因 ${reason}`);
  }
  const savings=choose('fromId','验收储蓄');
  time(7);
  check(input('fromId').value===savings&&option('fromId','验收归档'),'改时间未保留有效选择，或历史账户未恢复可选');
  time(2);
  check(input('fromId').value===''&&notice().includes('重新选择'),'失效选择被静默替换');
  check(submit().disabled&&notice().includes('账户与余额'),'无合格账户时未阻止提交或未给出说明');
  check($('#modal details').textContent.includes('尚未建立'),'缺少账户未建立原因');

  time(9);
  choose('fromId','验收储蓄');
  change('kind','redeem');
  check(input('fromId').value===''&&notice().includes('重新选择'),'改变事项类型时未清除无效账户');
  choose('fromId','验收理财');
  check(option('toId','验收储蓄')&&!option('toId','验收理财'),'赎回的实际到账账户不正确');
  change('kind','lend');
  choose('fromId','验收储蓄');
  input('amount').value='3000';
  input('memo').value='浏览器登记借出本金';
  submit().click();
  await waitFor(()=>!$('#modal').open);
  check($('#app').textContent.includes('浏览器登记借出本金'),'浏览器提交后未显示已保存事项');

  const historical=[...document.querySelectorAll('[data-action="tx-edit"]')].find(button=>button.closest('.account-row').textContent.includes('归档前的事项'));
  historical.click();
  check(input('at').value==='2026-10-06T12:00','历史时间未正确回填');
  check(input('fromId').selectedOptions[0].textContent.includes('验收归档'),'历史归档账户未正确回填');
  input('memo').value='已核对归档前记录';
  input('reason').value='复核凭证';
  submit().click();
  await waitFor(()=>!$('#modal').open);
  check($('#app').textContent.includes('已核对归档前记录'),'归档前历史记录未能更正');
  document.body.dataset.pickerResult='pass';
 }catch(error){
  document.body.dataset.pickerResult='fail';
  const result=document.createElement('pre');
  result.textContent=error.message;
  document.body.append(result);
 }
}

// Chromium's DevTools pipe allows mobile viewport emulation without adding a runtime dependency.
async function runPicker(profile,url,device){
 const proc=spawn(chrome,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
  '--no-proxy-server','--disable-background-networking','--no-first-run','--no-startup-window',
  `--user-data-dir=${profile}`,'--remote-debugging-pipe'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 const stopped=once(proc,'exit');
 let stderr='',buffer='',nextId=0;
 const pending=new Map();
 proc.stderr.setEncoding('utf8').on('data',data=>{stderr=(stderr+data).slice(-3000);});
 proc.stdio[4].setEncoding('utf8').on('data',data=>{
  const frames=(buffer+data).split('\0');
  buffer=frames.pop();
  for(const frame of frames){
   const {id,result,error}=JSON.parse(frame);
   const done=pending.get(id);
   if(done){pending.delete(id);done(error?new Error(error.message):null,result);}
  }
 });
 function send(method,params={},sessionId){
  const id=++nextId;
  return new Promise((resolve,reject)=>{
   pending.set(id,(error,result)=>error?reject(error):resolve(result));
   proc.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0',error=>{if(error)reject(error);});
  });
 }
 let timer;
 const failed=Promise.race([
  stopped.then(([code,signal])=>{throw new Error(`Chromium 提前退出（${signal||code}）\n${stderr}`);}),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Chromium 验收超时\n${stderr}`)),18000);})
 ]);
 try{
  return await Promise.race([failed,(async()=>{
   const {targetId}=await send('Target.createTarget',{url:'about:blank'});
   const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
   await send('Emulation.setDeviceMetricsOverride',{width:device.width,height:844,deviceScaleFactor:2,mobile:true},sessionId);
   await send('Emulation.setTouchEmulationEnabled',{enabled:true},sessionId);
   await send('Emulation.setUserAgentOverride',{userAgent:device.ua},sessionId);
   await send('Page.navigate',{url},sessionId);
   for(let i=0;i<120;i++){
    try{
     const {result}=await send('Runtime.evaluate',{expression:"document.body?.dataset.pickerResult && [document.body.dataset.pickerResult, document.querySelector('pre')?.textContent, innerWidth]",returnByValue:true},sessionId);
     if(result?.value)return result.value;
    }catch(error){if(!error.message.includes('context'))throw error;}
    await new Promise(resolve=>setTimeout(resolve,80));
   }
   throw new Error('Chromium 未完成账户选择检查');
  })()]);
 }finally{
  clearTimeout(timer);
  if(proc.exitCode===null&&proc.signalCode===null){
   // The pipe may close before Chromium acknowledges its own shutdown.
   void send('Browser.close').catch(()=>{});
   await Promise.race([stopped,delay(2000,undefined,{ref:false})]).catch(()=>{});
   if(proc.exitCode===null&&proc.signalCode===null)proc.kill();
  }
  await stopped.catch(()=>{});
 }
}

const android='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
for(const device of [
 {name:'Android Chrome 390px',width:390,ua:android},
 {name:'微信 UA 360px',width:360,ua:android+' MicroMessenger/8.0.60'}
]){
test(`Chromium ${device.name} 按历史时间和事项性质更新账户，校验并保存`,async t=>{
 if(!chrome){
  assert.ok(!process.env.CI,'CI 需要 Chromium 或设置 CHROME_BIN');
  t.skip('本地未安装 Chromium，设置 CHROME_BIN 可运行');
  return;
 }
 const fixtureLedger=fixture(),before=totals(fixtureLedger.state,stamp);
 const html=(await readFile(new URL('../public/index.html',import.meta.url),'utf8')).replace('</body>','<script type="module" src="/check-picker.mjs"></script></body>');
 const routes={
  '/app.js':'app.js','/style.css':'style.css','/fonts.css':'fonts.css','/icon.svg':'icon.svg',
  '/manifest.webmanifest':'manifest.webmanifest'
 };
 const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const send=(body,type='application/json',status=200)=>res.writeHead(status,{'Content-Type':type}).end(body);
  try{
   if(path==='/')return send(html,'text/html; charset=utf-8');
   if(path==='/check-picker.mjs')return send(`(${exercisePicker.toString()})();`,'text/javascript');
   if(path==='/core.mjs')return send(await readFile(new URL('../src/core.mjs',import.meta.url)),'text/javascript');
   if(routes[path]){
    const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'application/manifest+json';
    return send(await readFile(new URL(`../public/${routes[path]}`,import.meta.url)),type);
   }
   if(path==='/api/session')return send(JSON.stringify({configured:true,authenticated:true,csrf:'fixture'}));
   if(path==='/api/state')return send(JSON.stringify(fixtureLedger.state));
   if(path==='/api/command'){
    let body='';
    for await(const chunk of req)body+=chunk;
    const {expectedRevision,command}=JSON.parse(body);
    assert.equal(expectedRevision,fixtureLedger.state.revision);
    return send(JSON.stringify(fixtureLedger.cmd(command.type,command.payload)));
   }
   return send('{}','application/json',404);
  }catch(error){return send(JSON.stringify({error:error.message}),'application/json',422);}
 });
 const profile=await mkdtemp(join(tmpdir(),'treasury-browser-'));
 t.after(async()=>{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const [result,message,width]=await runPicker(profile,`http://127.0.0.1:${server.address().port}/#events`,device);
 assert.equal(result,'pass',message);
 assert.equal(width,device.width);
 const after=totals(fixtureLedger.state,stamp);
 assert.equal(balance(fixtureLedger.state,fixtureLedger.savings,stamp).amount,0);
 assert.equal(after.receivables-before.receivables,300000);
 assert.equal(after.net,before.net);
 assert.equal(after.net,after.assets-after.liabilities);
});
}
