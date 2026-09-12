// 學期管理前端流程：套用日期範圍 (含縮小範圍確認)、封存並開新學期 (分批建床位)、查看封存學期 (唯讀)、匯出封存學期 Excel
const {chromium,webkit}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function run(engine){
 const browser=await engine.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const mk=(id,name,room,bed,att)=>({id,name,room,bed,squad:'一單',class:'測試班',studentId:id.toUpperCase(),attendance:att||{}});
  const today=new Date();const iso=d=>d.toISOString().slice(0,10);
  const t0=iso(new Date(Date.UTC(today.getFullYear(),today.getMonth(),today.getDate())));
  const current={students:[mk('s1','甲','101','A',{[t0]:'◎'}),mk('s2','乙','101','B'),mk('s3','丙','103','A')],dateColumns:[t0],semester:{name:'115-1',start:'2026-09-01',end:'2027-01-16',isCurrent:true}};
  const old={students:[mk('o1','舊甲','101','A',{'6月26日':'◎','6月27日':'✓'}),mk('o2','舊乙','101','B')],dateColumns:['6月26日','6月27日'],semester:{name:'114-2',start:'2026-02-20',end:'2026-06-27',isCurrent:false}};
  let semesterState={current:{name:'115-1',dbId:'db-new',start:'2026-09-01',end:'2027-01-16'},archives:[{name:'114-2',dbId:'db-old',start:'2026-02-20',end:'2026-06-27'}],dateColumns:[t0]};
  const posts=[];let datesCalls=0;let confirmCount=0;
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());const m=route.request().method();
    if(u.hostname==='sem.test'){const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});}
    if(u.pathname==='/api/roster')return route.fulfill({json:u.searchParams.get('semester')==='114-2'?old:current});
    if(u.pathname==='/api/semester'&&m==='GET')return route.fulfill({json:semesterState});
    if(u.pathname==='/api/semester/dates'){const b=JSON.parse(route.request().postData());posts.push({p:u.pathname,b});datesCalls++;
      if(!b.confirmRemove)return route.fulfill({json:{success:false,needsConfirm:true,toAdd:['2026-09-02'],toRemove:[{date:'2027-01-15',nonDefault:2},{date:'2027-01-16',nonDefault:0}]}});
      semesterState={...semesterState,current:{...semesterState.current,start:b.start,end:b.end,name:b.name||semesterState.current.name}};
      return route.fulfill({json:{success:true,added:['2026-09-02'],removed:['2027-01-15','2027-01-16'],current:semesterState.current}});}
    if(u.pathname==='/api/semester/archive'){const b=JSON.parse(route.request().postData());posts.push({p:u.pathname,b});
      const beds=[];for(let i=0;i<45;i++)beds.push({room:'B1'+String(i).padStart(2,'0'),bed:'A',squad:'一單',name:b.carryResidents?'人'+i:'',isEmpty:!b.carryResidents,attendance:{}});
      semesterState={current:{name:b.newName,dbId:'db-newer',start:b.start,end:b.end},archives:[...semesterState.archives,{name:'115-1',dbId:'db-new',start:'2026-09-01',end:'2027-01-16'}],dateColumns:[]};
      return route.fulfill({json:{success:true,newDbId:'db-newer',archived:{name:'115-1',dbId:'db-new'},current:semesterState.current,beds}});}
    if(u.pathname==='/api/import-batch'){const b=JSON.parse(route.request().postData());posts.push({p:u.pathname,b});return route.fulfill({json:{success:true,imported:b.students.length,errors:[]}});}
    if(u.pathname==='/api/attendance'){posts.push({p:u.pathname,b:JSON.parse(route.request().postData())});return route.fulfill({json:{success:true}});}
    if(u.pathname==='/api/config')return route.fulfill({json:{}});
    if(u.pathname==='/api/poll')return route.fulfill({json:{ts:0,att_ts:0}});
    if(u.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s}',contentType:'application/javascript'});
    return route.fulfill({json:{}});
  });
  await page.goto('https://sem.test/');await page.waitForFunction(()=>!state.loading);

  // 1. 學期狀態載入、匯出下拉有封存學期
  const r1=await page.evaluate(()=>{navigateTo('settings');renderSettings();const sel=document.getElementById('export-semester');return {available:state.semester.available,name:state.semester.current.name,options:[...sel.options].map(o=>o.value),hidden:sel.closest('.export-semester-field').hidden,exportStart:document.getElementById('export-start-date').value};});
  assert.equal(r1.available,true);assert.equal(r1.name,'115-1');assert.deepEqual(r1.options,['','114-2']);assert.equal(r1.hidden,false);
  assert.equal(r1.exportStart,'2026-09-01','匯出預設起日跟著學期開始日');

  // 2. 開發者面板：套用範圍 → 縮小要確認 → 確認後第二次帶 confirmRemove
  await page.evaluate(()=>{devUnlocked=true;openDevAuth();});
  await page.waitForFunction(()=>document.getElementById('sem-start').value==='2026-09-01');
  const hint=await page.locator('#semester-hint').innerText();assert.match(hint,/115-1/);
  await page.fill('#sem-end','2027-01-14');
  const applyPromise=page.evaluate(()=>applySemesterDates()).catch(e=>console.error("apply failed",e.message));
  await page.waitForFunction(txt=>[...document.querySelectorAll('.confirm-overlay .confirm-msg')].some(e=>e.textContent.includes(txt)),'2027-01-15');
  const msg=await page.locator('.confirm-overlay .confirm-msg').last().innerText();assert.match(msg,/2027-01-15/);assert.match(msg,/2 筆/);
  await page.locator('#cfd-confirm').last().click();await applyPromise;
  const dates=posts.filter(p=>p.p==='/api/semester/dates');
  assert.equal(dates.length,2);assert.equal(dates[0].b.confirmRemove,undefined);assert.equal(dates[1].b.confirmRemove,true);assert.equal(dates[1].b.end,'2027-01-14');assert.equal(dates[1].b.name,'115-1');
  await page.waitForFunction(()=>state.semester.current.end==='2027-01-14');

  // 取消就不送第二次
  await page.fill('#sem-end','2027-01-13');
  const cancelPromise=page.evaluate(()=>applySemesterDates()).catch(e=>console.error("cancel failed",e.message));
  await page.waitForFunction(txt=>[...document.querySelectorAll('.confirm-overlay .confirm-msg')].some(e=>e.textContent.includes(txt)),'2027-01-15');await page.locator('#cfd-cancel').last().click();await cancelPromise;
  assert.equal(posts.filter(p=>p.p==='/api/semester/dates').length,3,'取消後沒有第二次呼叫');

  // 3. 封存並開新學期：確認 → 45 張床位分 2 批建立 → 狀態切換
  await page.fill('#sem-new-name','115-2');await page.fill('#sem-new-start','2027-02-01');await page.fill('#sem-new-end','2027-06-30');
  const archivePromise=page.evaluate(()=>archiveSemester()).catch(e=>console.error("archive failed",e.message));
  await page.waitForFunction(txt=>[...document.querySelectorAll('.confirm-overlay .confirm-msg')].some(e=>e.textContent.includes(txt)),'碧苑點名總表 115-1');
  assert.match(await page.locator('.confirm-overlay .confirm-msg').last().innerText(),/碧苑點名總表 115-1/);
  await page.locator('#cfd-confirm').last().click();await archivePromise;
  const arch=posts.filter(p=>p.p==='/api/semester/archive');assert.equal(arch.length,1);assert.equal(arch[0].b.newName,'115-2');assert.equal(arch[0].b.currentName,'115-1');assert.equal(arch[0].b.carryResidents,true);
  const batches=posts.filter(p=>p.p==='/api/import-batch');assert.deepEqual(batches.map(b=>b.b.students.length),[40,5]);assert.ok(batches.every(b=>b.b.db_id==='db-newer'));
  const r3=await page.evaluate(()=>({name:state.semester.current.name,archives:state.semester.archives.map(a=>a.name),list:document.getElementById('sem-archive-list').innerText}));
  assert.equal(r3.name,'115-2');assert.deepEqual(r3.archives,['114-2','115-1']);assert.match(r3.list,/115-1/);

  // 4. 查看封存學期：唯讀、總表橫幅、舊式欄位用該學期推年份
  await page.evaluate(()=>viewArchivedSemester('114-2'));
  await page.waitForFunction(()=>state.viewSemester==='114-2'&&!state.loading&&state.students.length===2);
  const r4=await page.evaluate(async()=>{
    const banner=document.getElementById('summary-archive-banner');
    const before=state.students[0].attendance['6月26日'];
    toggleStatus('o1');
    let rejected=false;try{await _api.updateAttendance([{pageId:'o1',date:'6月26日',value:'✓'}]);}catch(e){rejected=true;}
    return {bannerHidden:banner.hidden,bannerName:document.getElementById('summary-archive-name').textContent,date:state.currentDate,pill:document.getElementById('summary-date').textContent,unchanged:state.students[0].attendance['6月26日']===before,rejected,iso:dateColumnToISO('6月26日'),leave:computeDailyStats('6月26日').leave};
  });
  assert.equal(r4.bannerHidden,false);assert.equal(r4.bannerName,'114-2');assert.equal(r4.date,'6月27日','日期退到封存學期最後一天');assert.match(r4.pill,/封存 114-2/);
  assert.equal(r4.unchanged,true,'唯讀');assert.equal(r4.rejected,true,'所有寫入都被擋');assert.equal(r4.iso,'2026-06-26','舊式欄位用 114-2 推年份');assert.equal(r4.leave,1);
  assert.equal(posts.filter(p=>p.p==='/api/attendance').length,0,'沒有任何點名寫入送出');

  // 5. 匯出封存學期：從封存 roster 抓資料
  const r5=await page.evaluate(async()=>{
    navigateTo('settings');renderSettings();
    document.getElementById('export-semester').value='114-2';
    document.getElementById('export-start-date').value='2026-06-26';document.getElementById('export-end-date').value='2026-06-28';
    let rows,file;window.XLSX={utils:{aoa_to_sheet:r=>(rows=r),book_new:()=>({}),book_append_sheet:()=>{}},writeFile:(wb,name)=>{file=name;}};
    await exportExcel();
    return {rows,file};
  });
  assert.deepEqual(r5.rows[0].slice(5),['6月26日','6月27日','2026-06-28']);assert.deepEqual(r5.rows[1].slice(5),['◎','✓','✓']);assert.match(r5.file,/114-2_20260626-20260628/);

  // 6. 回到本學期
  await page.evaluate(()=>exitArchiveView());
  await page.waitForFunction(()=>state.viewSemester===null&&!state.loading&&state.students.length===3);
  await page.evaluate(()=>navigateTo('summary'));const r6=await page.evaluate(()=>({hidden:document.getElementById('summary-archive-banner').hidden,display:getComputedStyle(document.getElementById('summary-archive-banner')).display,name:state.rosterSemester.name}));assert.equal(r6.display,'none','橫幅在本學期必須真的看不見');
  assert.equal(r6.hidden,true);assert.equal(r6.name,'115-1');
  assert.deepEqual(errors,[]);console.log(engine.name()+': semester state, apply/confirm/cancel, archive + batched beds, read-only archive view, archive export PASS');
 }finally{await browser.close();}
}
(async()=>{await run(chromium);await run(webkit);})().catch(e=>{console.error(e);process.exitCode=1;});
