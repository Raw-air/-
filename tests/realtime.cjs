// 即時同步：輪詢帶 since，別台的點名變動不用重抓總表就直接出現在畫面；自己沒送出的變更不被蓋掉
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const today=await page.evaluate(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');});
  const mk=(id,name,room,bed)=>({id,name,room,bed,squad:'一單',class:'測試班',studentId:id.toUpperCase(),attendance:{}});
  const students=[mk('s1','甲','101','A'),mk('s2','乙','101','B'),mk('s3','丙','103','A')];
  let seq=5,changes=[],rosterCalls=0;const sinces=[];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='rt.test'){const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});}
    if(u.pathname==='/api/roster'){rosterCalls++;return route.fulfill({json:{students:students.map(s=>({...s,attendance:{...s.attendance}})),dateColumns:[today]}});}
    if(u.pathname==='/api/poll'){
      const since=u.searchParams.get('since');sinces.push(since);
      const body={ts:0,att_ts:1,seq};
      if(since!==null)body.changes=changes.filter(c=>c.q>Number(since));
      return route.fulfill({json:body});
    }
    if(u.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s}',contentType:'application/javascript'});
    return route.fulfill({json:{}});
  });
  await page.goto('https://rt.test/');await page.waitForFunction(()=>!state.loading);
  await page.evaluate(()=>{navigateTo('summary');});
  await page.waitForFunction(()=>true);
  await page.waitForTimeout(2600);
  const rosterBefore=rosterCalls;
  // 本機 s3 還沒送出 (pending)，別台同時改 s3 → 本機優先
  await page.evaluate(t=>{state.changes.push({pageId:'s3',date:t,value:'✓'});},today);
  changes=[{q:6,id:'s1',d:today,v:'◎'},{q:7,id:'s3',d:today,v:'◎'}];seq=7;
  await page.waitForFunction(t=>state.students.find(s=>s.id==='s1').attendance[t]==='◎',today,{timeout:5000});
  const r=await page.evaluate(t=>({s3:state.students.find(s=>s.id==='s3').attendance[t]||'',leave:computeDailyStats(t).leave}),today);
  assert.equal(r.s3,'','本機未送出的變更不被別台蓋掉');
  assert.equal(r.leave,1,'總表統計馬上算進請假');
  assert.equal(rosterCalls,rosterBefore,'套用變動不用重抓總表');
  assert.ok(sinces.includes('5'),'輪詢帶 since');
  // 背景刷新拿到舊總表 (Notion 還沒更新) 也不會洗掉
  await page.evaluate(async()=>{const roster=await _api.getRoster();state.students=applyLocalStateToRoster(roster.students,roster.dateColumns);});
  assert.equal(await page.evaluate(t=>state.students.find(s=>s.id==='s1').attendance[t],today),'◎','舊總表不洗掉別台的變動');
  assert.deepEqual(errors,[]);console.log('realtime: poll since, remote changes applied without roster fetch, local pending wins PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
