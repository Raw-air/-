// 後端點名表缺日期欄位時：本機暫存不被背景刷新洗掉、電話請假進總表、Excel 預設 ✓、欄位出現後自動補送
const {chromium,webkit}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function run(engine){
 const browser=await engine.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const mk=(id,name,room,bed)=>({id,name,room,bed,squad:'一單',class:'測試班',studentId:id.toUpperCase(),attendance:{'6月26日':'✓'}});
  const students=[mk('s1','甲','101','A'),mk('s2','乙','101','B'),mk('s3','丙','103','A')];
  let dateColumns=['6月26日'];
  const writes=[];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='pending.test'){const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});}
    if(u.pathname==='/api/roster')return route.fulfill({json:{students:students.map(s=>({...s,attendance:{...s.attendance}})),dateColumns}});
    if(u.pathname==='/api/attendance'){writes.push(...JSON.parse(route.request().postData()).updates);return route.fulfill({json:{ok:true}});}
    if(u.pathname==='/api/config')return route.fulfill({json:{}});
    if(u.pathname==='/api/leave-records')return route.fulfill({json:{success:true}});
    if(u.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s}',contentType:'application/javascript'});
    return route.fulfill({json:{}});
  });
  await page.goto('https://pending.test/');await page.waitForFunction(()=>!state.loading);

  const r1=await page.evaluate(async()=>{
    state.currentSquad='一單';state.currentDate=getTodayAttendanceDate();renderRollCall(true);
    const today=localTodayISO();
    toggleStatus('s1');toggleStatus('s2');toggleStatus('s3'); // 三人請假
    await new Promise(r=>setTimeout(r,1200)); // 等 debounce 同步完成 (changes 清空、recentSyncs 建立)
    // 模擬 15 秒保護過期後的背景刷新：伺服器回來的名單沒有今天的欄位
    Object.keys(state.recentSyncs).forEach(k=>state.recentSyncs[k].ts=0);
    const roster=await _api.getRoster();
    state.students=applyLocalStateToRoster(roster.students,roster.dateColumns);state.dateColumns=roster.dateColumns;
    const leaveAfterRefresh=state.students.filter(s=>s.attendance[today]==='◎').map(s=>s.id);
    const stats=computeDailyStats(today);
    navigateTo('summary');renderSummary();
    const summaryDate=document.getElementById('summary-date').textContent;
    const stored=JSON.parse(localStorage.getItem('biyuan_pending_attendance'));
    return {today,changes:state.changes.length,leaveAfterRefresh,statsLeave:stats.leave,summaryDate,stored};
  });
  assert.equal(r1.changes,0,'auto-sync still clears changes');
  assert.deepEqual(r1.leaveAfterRefresh,['s1','s2','s3'],'background refresh must not wipe leave set on a date the server has no column for');
  assert.equal(r1.statsLeave,3,'summary counts all three leaves');
  assert.match(r1.summaryDate,/僅本機暫存/,'summary flags local-only date');
  assert.deepEqual(r1.stored[r1.today],{s1:'◎',s2:'◎',s3:'◎'},'pending values persisted to localStorage');

  // 重新載入後暫存仍在
  await page.reload();await page.waitForFunction(()=>!state.loading);
  const r2=await page.evaluate(()=>{const t=localTodayISO();return state.students.filter(s=>s.attendance[t]==='◎').map(s=>s.id);});
  assert.deepEqual(r2,['s1','s2','s3'],'pending survives reload');

  // 電話請假：日期後端沒有欄位 → 總表也要顯示請假
  const r3=await page.evaluate(async()=>{
    const t=localTodayISO();
    openCounterLeaveModal();
    document.getElementById('cl-target').innerHTML='<option value="s2">s2</option>';document.getElementById('cl-target').value='s2';
    const d=parseISODate(t);d.setUTCDate(d.getUTCDate()+1);const tomorrow=d.toISOString().slice(0,10);
    document.getElementById('cl-start-date').value=t;document.getElementById('cl-end-date').value=tomorrow;
    await submitCounterLeave();
    return {tomorrow,v:state.students.find(s=>s.id==='s2').attendance[tomorrow],stats:computeDailyStats(tomorrow).leave};
  });
  assert.equal(r3.v,'◎','counter leave marks local-only date');
  assert.equal(r3.stats,1,'summary for tomorrow shows the phone leave');

  // Excel：每個人每一天預設 ✓
  const r4=await page.evaluate(()=>{
    const t=localTodayISO();
    state.config.export_start_date='2026-06-26';state.config.export_end_date=t;initializeExportDateInputs();
    let rows;window.XLSX={utils:{aoa_to_sheet:r=>(rows=r),book_new:()=>({}),book_append_sheet:()=>{}},writeFile:()=>{}};
    exportExcel();
    return rows.slice(1).map(r=>r.slice(5));
  });
  for(const row of r4){assert.ok(row.every(v=>v==='✓'||v==='◎'),'no blank cells in export');assert.ok(row.slice(0,-1).every(v=>v==='✓'));}
  assert.deepEqual(r4.map(r=>r[r.length-1]),['◎','◎','◎'],'today column exports the pending leaves');

  // 後端建立欄位後自動補送，並清掉暫存
  const before=writes.length;
  dateColumns=['6月26日',await page.evaluate(()=>localTodayISO())];
  const r5=await page.evaluate(async()=>{
    const roster=await _api.getRoster();
    state.students=applyLocalStateToRoster(roster.students,roster.dateColumns);state.dateColumns=roster.dateColumns;
    await new Promise(r=>setTimeout(r,500));
    const stored=JSON.parse(localStorage.getItem('biyuan_pending_attendance'));
    return {todayLeft:stored[localTodayISO()]||null,keys:Object.keys(stored)};
  });
  const replayed=writes.slice(before).filter(w=>w.date===dateColumns[1]);
  assert.equal(replayed.length,3,'three pending values replayed once the column exists');
  assert.equal(r5.todayLeft,null,'replayed date removed from pending store');
  assert.equal(r5.keys.length,1,'tomorrow (still no column) stays pending');
  assert.deepEqual(errors,[]);console.log(engine.name()+': pending attendance survives refresh/reload, phone leave, export ✓, replay PASS');
 }finally{await browser.close();}
}
(async()=>{await run(chromium);await run(webkit);})().catch(e=>{console.error(e);process.exitCode=1;});
