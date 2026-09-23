// 點名回報每天歸零：舊後端的輪詢信號沒帶 date，昨天最後一次回報不能被當成今天的「已回報」
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const today=await page.evaluate(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');});
  const students=[{id:'s1',name:'甲',room:'101',bed:'A',squad:'一單',class:'測試班',studentId:'S1',attendance:{}}];
  // 昨晚 23:51 的回報信號，跟線上舊後端一樣沒有 date
  const yest=new Date();yest.setDate(yest.getDate()-1);yest.setHours(23,51,0,0);
  let poll={ts:yest.getTime(),confirms:'一單,二單',att_ts:1};
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='rt.test'){const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});}
    if(u.pathname==='/api/roster')return route.fulfill({json:{students,dateColumns:[today]}});
    if(u.pathname==='/api/poll')return route.fulfill({json:poll});
    if(u.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s}',contentType:'application/javascript'});
    return route.fulfill({json:{}});
  });
  await page.goto('https://rt.test/');await page.waitForFunction(()=>!state.loading);
  await page.evaluate(()=>{navigateTo('summary');});
  await page.waitForTimeout(4500);
  assert.deepEqual(await page.evaluate(()=>confirmedSquadsToday()),[],'昨天的回報不算今天');
  // 今天有人按回報 (信號時間是現在) → 要照常出現
  poll={ts:Date.now(),confirms:'一單',att_ts:1};
  await page.waitForFunction(()=>confirmedSquadsToday().includes('一單'),null,{timeout:6000});
  // 新後端帶 date 的也照舊
  poll={ts:Date.now()+1,confirms:'一單,三雙',att_ts:1,date:today};
  await page.waitForFunction(()=>confirmedSquadsToday().includes('三雙'),null,{timeout:6000});
  assert.deepEqual(errors,[]);console.log('confirm-reset: yesterday signal ignored, today signal applied PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
