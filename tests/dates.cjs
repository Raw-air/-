const {chromium,webkit}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function run(engine){
 const browser=await engine.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const students=[{id:'synthetic-date-test',name:'日期測試',room:'101',bed:'1',squad:'一單',class:'測試班',studentId:'TEST',attendance:{'6月26日':'✓','9月9日':'◎','2027-09-09':'✘'}}];
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='dates.test'){const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});}
    if(u.pathname==='/api/roster')return route.fulfill({json:{students,dateColumns:['6月26日','9月9日','2027-09-09']}});
    if(u.pathname==='/api/config')return route.fulfill({json:{}});
    if(u.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s}',contentType:'application/javascript'});
    return route.fulfill({json:{}});
  });
  await page.goto('https://dates.test/');await page.waitForFunction(()=>!state.loading);
  const defaults=await page.evaluate(()=>{
    state.currentSquad='一單';renderRollCall(true);renderDatePicker();initializeExportDateInputs();openCounterLeaveModal();
    const today=localTodayISO();
    const result={today,currentDate:state.currentDate,rollcall:document.getElementById('rc-date-input').value,quickDates:[...document.querySelectorAll('#date-picker-list .date-item')].map(e=>e.textContent),exportEnd:document.getElementById('export-end-date').value,counter:[document.getElementById('cl-start-date').value,document.getElementById('cl-end-date').value],submitIcon:!!document.querySelector('#submit-btn svg')};closeModal('counter-leave-modal');
    state.currentDate=getTodayAttendanceDate();changeSummaryDate(-1);result.summaryPrevious=state.currentDate;
    const originalDates=state.dateColumns;state.dateColumns=['6月26日'];state.currentDate=getTodayAttendanceDate();changeSummaryDate(-1);result.staleRosterPrevious=state.currentDate;state.dateColumns=originalDates;
    const previousDate=parseISODate(today);previousDate.setUTCDate(previousDate.getUTCDate()-1);result.expectedPrevious=previousDate.toISOString().slice(0,10);
    return result;
  });
  assert.equal(defaults.currentDate,defaults.today,'today outside the old semester must keep its full year');
  assert.equal(defaults.rollcall,defaults.today,'roll-call date defaults to local today');
  assert.ok(defaults.quickDates.some(label=>label.includes('今天')),'quick date list includes today after the old roster ends');
  assert.equal(defaults.exportEnd,defaults.today,'unsaved export end defaults to today instead of the stale final column');
  assert.deepEqual(defaults.counter,[defaults.today,defaults.today],'counter leave uses local today');
  assert.equal(defaults.submitIcon,true,'submit button renders its icon instead of raw SVG text');
  assert.equal(defaults.summaryPrevious,defaults.expectedPrevious,'summary moves to the previous calendar day');
  assert.equal(defaults.staleRosterPrevious,defaults.expectedPrevious,'missing semester dates remain continuously navigable');
  assert.ok(defaults.quickDates.some(label=>label.includes(defaults.expectedPrevious.slice(0,4)+'年'+Number(defaults.expectedPrevious.slice(5,7))+'月'+Number(defaults.expectedPrevious.slice(8,10))+'日')),'quick list includes yesterday instead of jumping to June');
  await page.evaluate(()=>{navigateTo('rollcall');state.currentSquad='一單';state.currentDate='9月9日';renderRollCall(true);});
  await page.locator('#rc-date-btn').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#submit-btn').evaluate(el=>getComputedStyle(el).opacity),'0','date picker stays above the fixed submit action');
  assert.equal(await page.locator('.fab-empty-bed').evaluate(el=>getComputedStyle(el).opacity),'0','date picker is not covered by the empty-bed action');
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.locator('#date-picker-panel').screenshot({path:path.join(root,'test-results',engine.name()+'-date-picker.png')});
  assert.equal(await page.locator('#rc-date-input').getAttribute('min'),null);
  assert.equal(await page.locator('#rc-date-input').getAttribute('max'),null);
  await page.locator('#rc-date-input').fill('2027-09-09');
  await page.locator('#rc-date-input').dispatchEvent('change');
  assert.equal(await page.evaluate(()=>state.currentDate),'2027-09-09','year-qualified date must not overwrite legacy September 9');
  assert.match(await page.locator('#rc-date').innerText(),/2027年9月9日/);
  const result=await page.evaluate(async()=>{
    const writes=[];_api.updateAttendance=async updates=>writes.push(...updates);
    selectRollCallDate('2026-09-09');toggleStatus(state.students[0].id);
    selectRollCallDate('2027-09-09');toggleStatus(state.students[0].id);
    await new Promise(r=>setTimeout(r,1000));
    selectRollCallDate('2030-12-31');_api.updateAttendance=async()=>{throw Error('synthetic missing date column');};toggleStatus(state.students[0].id);
    await new Promise(r=>setTimeout(r,1000));
    const failedNewDateRetained=state.changes.some(c=>c.date==='2030-12-31')&&!state.dateColumns.includes('2030-12-31');
    state.config.export_start_date='2026-09-09';state.config.export_end_date='2026-09-12';initializeExportDateInputs();
    let rows;window.XLSX={utils:{aoa_to_sheet:r=>(rows=r),book_new:()=>({}),book_append_sheet:()=>{}},writeFile:()=>{}};
    exportExcel();
    const bounds=['export-start-date','export-end-date','dev-export-start-date','dev-export-end-date'].map(id=>{const e=document.getElementById(id);return [e.min,e.max,e.validity.rangeOverflow,e.validity.rangeUnderflow];});
    document.getElementById('export-start-date').value='2028-02-28';document.getElementById('export-end-date').value='2028-03-01';const leap=readExportRange('export-start-date','export-end-date');
    document.getElementById('export-start-date').value='2031-01-01';document.getElementById('export-end-date').value='2030-01-01';const inverted=readExportRange('export-start-date','export-end-date');
    return {writes,failedNewDateRetained,rows,bounds,leap,inverted,configured:getConfiguredExportRange(),invalid:parseISODate('2026-02-29')};
  });
  assert.deepEqual(result.writes.map(w=>w.date).sort(),['2027-09-09','9月9日']);
  assert.equal(result.failedNewDateRetained,true,'failed new-date writes remain pending and are not falsely marked as saved');
  assert.deepEqual(result.rows[0].slice(5),['9/9','9/10','9/11','9/12']);
  assert.deepEqual(result.rows[1].slice(6),['✓','✓','✓'],'unknown future dates default to present (✓) in the export');
  assert.ok(result.bounds.every(b=>b[0]===''&&b[1]===''&&!b[2]&&!b[3]));
  assert.equal(result.leap.columns.length,3);assert.ok(result.inverted.error);assert.equal(result.invalid,null);
  assert.deepEqual(result.configured,{start:'2026-09-09',end:'2026-09-12'});
  assert.deepEqual(errors,[]);console.log(engine.name()+': date input, year isolation, cross-date sync, unbounded export, blank dates and leap year PASS');
 }finally{await browser.close();}
}
(async()=>{await run(chromium);await run(webkit);})().catch(e=>{console.error(e);process.exitCode=1;});
