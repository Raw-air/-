// 封存學期流程不中斷：床位建立進度存 localStorage (重新整理後可繼續建)、import-batch 回 success:false 不顯示完成且只重試失敗那幾張、
// 封存失敗提示學期沒切換、alreadyCurrent 直接建床位、beds 遺失時從舊學期總表重建、學期名稱跳脫、別的學期的 pending 不理會
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const KEY='biyuan_archive_pending';
async function run(engine){
 const browser=await engine.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const mk=(id,name,room,bed,extra)=>({id,name,room,bed,squad:'一單',class:'測試班',studentId:id.toUpperCase(),phone:'0912'+id,address:'住址'+id,attendance:{},...(extra||{})});
  const evil=`115-<b>x</b>'"&`;
  const current={students:[mk('s1','甲','101','A'),mk('s2','乙','101','B'),mk('s3','丙','103','A',{isEmpty:true,name:''})],dateColumns:[],semester:{name:'115-1',start:'2026-09-01',end:'2027-01-16',isCurrent:true}};
  let semesterState={current:{name:'115-1',dbId:'db-1',start:'2026-09-01',end:'2027-01-16'},archives:[{name:'114-2',dbId:'db-0',start:'2026-02-20',end:'2026-06-27'},{name:evil,dbId:'db-evil',start:'2025-09-01',end:'2026-01-16'}],dateColumns:[]};
  const posts=[];
  let archiveMode='ok'; // ok | alreadyCurrent | fail
  let importMode='ok';  // abort-second | partial-first | 其他 = 全部成功 (值當作計數用的標籤)
  let dbSeq=1;
  const makeBeds=(n,carry)=>{const beds=[];for(let i=0;i<n;i++)beds.push({room:'B1'+String(i).padStart(2,'0'),bed:'A',squad:'一單',name:carry?'人'+i:'',class:carry?'班':'',studentId:carry?'S'+i:'',isForeign:false,isEmpty:!carry,phone:carry?'09'+i:'',address:carry?'地址'+i:'',remark:carry?'備'+i:'',attendance:{}});return beds;};
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());const m=route.request().method();
    if(u.hostname==='sem.test'){const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});}
    if(u.pathname==='/api/roster'){posts.push({p:u.pathname,q:u.searchParams.get('semester')||''});return route.fulfill({json:current});}
    if(u.pathname==='/api/semester'&&m==='GET')return route.fulfill({json:semesterState});
    if(u.pathname==='/api/semester/archive'){const b=JSON.parse(route.request().postData());posts.push({p:u.pathname,b});
      if(archiveMode==='fail')return route.fulfill({status:500,json:{error:'Notion 暫時不可用'}});
      dbSeq++;const newDbId='db-'+dbSeq;const oldCur=semesterState.current;
      semesterState={current:{name:b.newName,dbId:newDbId,start:b.start,end:b.end},archives:[...semesterState.archives,{name:oldCur.name,dbId:oldCur.dbId,start:oldCur.start,end:oldCur.end}],dateColumns:[]};
      const base={newDbId,archived:{name:oldCur.name,dbId:oldCur.dbId},current:semesterState.current,beds:makeBeds(45,b.carryResidents)};
      if(archiveMode==='alreadyCurrent')return route.fulfill({json:{success:false,alreadyCurrent:true,...base}});
      return route.fulfill({json:{success:true,...base}});}
    if(u.pathname==='/api/import-batch'){const b=JSON.parse(route.request().postData());const n=posts.filter(p=>p.p===u.pathname&&p.tag===importMode).length;posts.push({p:u.pathname,b,tag:importMode});
      if(importMode==='abort-second'&&n===1)return route.abort('failed');
      if(importMode==='partial-first'&&n===0)return route.fulfill({json:{success:false,imported:b.students.length-2,updated:0,errors:[{name:'人1',room:'B101',bed:'A',error:'conflict'},{name:'人3',room:'B103',bed:'A',error:'rate limited'}],total:b.students.length}});
      return route.fulfill({json:{success:true,imported:b.students.length,updated:0,errors:[],total:b.students.length}});}
    if(u.pathname==='/api/config')return route.fulfill({json:{}});
    if(u.pathname==='/api/poll')return route.fulfill({json:{ts:0,att_ts:0}});
    if(u.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s}',contentType:'application/javascript'});
    return route.fulfill({json:{}});
  });
  // 載入頁面 + 記錄 toast + 打開開發者面板 (學期卡在這裡才會渲染)
  const load=async()=>{
    await page.goto('https://sem.test/');await page.waitForFunction(()=>typeof state!=='undefined'&&!state.loading);
    await page.evaluate(()=>{window.__toasts=[];new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.classList&&n.classList.contains('toast'))window.__toasts.push(n.textContent);}).observe(document.getElementById('toast-container'),{childList:true});});
    await page.evaluate(()=>{navigateTo('settings');renderSettings();devUnlocked=true;openDevAuth();});
    await page.waitForFunction(()=>/雲端目前/.test(document.getElementById('semester-hint').textContent));
  };
  const resetToasts=()=>page.evaluate(()=>{window.__toasts=[];});
  const confirmArchive=async(oldName)=>{
    await page.waitForFunction(()=>document.querySelectorAll('.confirm-overlay').length===0);
    const done=page.evaluate(()=>archiveSemester());
    await page.waitForFunction(txt=>[...document.querySelectorAll('.confirm-overlay .confirm-msg')].some(e=>e.textContent.includes(txt)),'碧苑點名總表 '+oldName);
    const msg=await page.locator('.confirm-overlay .confirm-msg').last().innerText();
    await page.locator('#cfd-confirm').last().click();await done;return msg;
  };
  const snapshot=()=>page.evaluate(KEY=>({pending:JSON.parse(localStorage.getItem(KEY)||'null'),name:state.semester.current.name,progress:document.getElementById('sem-archive-progress').textContent,box:document.getElementById('sem-archive-resume')?.textContent||'',btn:document.getElementById('sem-archive-btn').textContent,disabled:document.getElementById('sem-archive-btn').disabled,toasts:window.__toasts.slice()}),KEY);
  await load();

  // 0. 學期名稱跳脫：封存清單與匯出下拉都不會把 <b> 變成真的元素，按鈕改用 data-name
  const r0=await page.evaluate(evil=>{const list=document.getElementById('sem-archive-list');const btns=[...list.querySelectorAll('.sem-archive-view')];const sel=document.getElementById('export-semester');
    return {rows:list.querySelectorAll('.sem-archive-row').length,bolds:list.querySelectorAll('b').length,names:btns.map(b=>b.dataset.name),onclick:btns.some(b=>b.getAttribute('onclick')),raw:list.innerHTML.includes('<b>x</b>'),opts:[...sel.options].map(o=>o.value),optRaw:sel.innerHTML.includes('<b>x</b>')};},evil);
  assert.equal(r0.rows,2);assert.equal(r0.bolds,2,'名稱裡的 <b> 沒有變成真的元素');assert.deepEqual(r0.names,[evil,'114-2']);assert.equal(r0.onclick,false,'不再用 onclick 字串');assert.equal(r0.raw,false);
  assert.deepEqual(r0.opts,['','114-2',evil]);assert.equal(r0.optRaw,false);
  await page.evaluate(()=>document.querySelector('.sem-archive-view').click()); // 面板不在可視區，用 DOM click
  await page.waitForFunction(evil=>state.viewSemester===evil&&!state.loading,evil);
  assert.ok(posts.some(p=>p.p==='/api/roster'&&p.q===evil),'按鈕用 dataset 把原始名稱傳給 viewArchivedSemester');
  await page.evaluate(()=>exitArchiveView());await page.waitForFunction(()=>state.viewSemester===null&&!state.loading);
  await page.evaluate(()=>{navigateTo('settings');renderSettings();devUnlocked=true;const p=document.getElementById('dev-panel');if(!p.classList.contains('open'))openDevAuth();});

  // 1. 封存 (帶人) → 第 2 批網路失敗 → 進度留在 localStorage；重新載入後學期卡提示並可繼續建
  await resetToasts();importMode='abort-second';
  await page.fill('#sem-new-name','115-2');await page.fill('#sem-new-start','2027-02-01');await page.fill('#sem-new-end','2027-06-30');
  const msg1=await confirmArchive('115-1');
  assert.match(msg1,/電話、住址與備註/,'確認框說明會一併帶入電話、住址與備註');
  let batches=posts.filter(p=>p.p==='/api/import-batch'&&p.tag==='abort-second');
  assert.equal(batches.length,2);assert.equal(batches[0].b.students.length,20,'每批 20 筆');assert.equal(batches[0].b.db_id,'db-2');
  const sent0=batches[0].b.students[0];assert.equal(sent0.phone,'090');assert.equal(sent0.address,'地址0');assert.equal(sent0.remark,'備0','beds 原封不動送出 (含電話/住址/備註)');
  const r1=await snapshot();
  assert.equal(r1.pending.newName,'115-2');assert.equal(r1.pending.newDbId,'db-2');assert.equal(r1.pending.oldName,'115-1');assert.equal(r1.pending.carry,true);assert.equal(typeof r1.pending.createdAt,'string');
  assert.equal(r1.pending.beds.length,25,'第 2 批網路例外 → 這批和後面的都留在 pending');assert.equal(r1.pending.beds[0].room,'B120');
  assert.doesNotMatch(r1.progress,/建立完成/);assert.match(r1.box,/剩 25 張/);assert.match(r1.btn,/繼續建立床位/);assert.equal(r1.disabled,false);
  assert.ok(r1.toasts.some(t=>/床位建立中斷/.test(t)),'提示可重試');assert.ok(!r1.toasts.some(t=>/封存失敗/.test(t)));
  assert.equal(r1.name,'115-2','學期狀態已切到新學期');

  await load(); // 手機被切掉 / 重新整理
  const r2=await snapshot();
  assert.equal(r2.name,'115-2');assert.match(r2.box,/115-2/);assert.match(r2.box,/剩 25 張/);assert.match(r2.btn,/繼續建立床位/);
  importMode='resume-1';const archivesBefore=posts.filter(p=>p.p==='/api/semester/archive').length;
  await page.evaluate(()=>archiveSemester()); // 封存按鈕在有 pending 時只做「繼續建立」
  assert.equal(posts.filter(p=>p.p==='/api/semester/archive').length,archivesBefore,'不會再封存一次');
  batches=posts.filter(p=>p.p==='/api/import-batch'&&p.tag==='resume-1');
  assert.deepEqual(batches.map(b=>b.b.students.length),[20,5]);assert.equal(batches[0].b.students[0].room,'B120');assert.ok(batches.every(b=>b.b.db_id==='db-2'));
  const r3=await snapshot();
  assert.equal(r3.pending,null,'全部建完才刪 pending');assert.equal(r3.box,'');assert.equal(r3.btn,'封存本學期並建立新學期');assert.match(r3.progress,/建立完成/);assert.match(r3.progress,/新增 25 張/);
  assert.ok(r3.toasts.some(t=>/床位建立完成/.test(t)&&/新增 25 張/.test(t)),'toast 顯示實際 imported 數字');

  // 2. import-batch 回 success:false + errors → 不顯示完成，只有失敗那幾張留在 pending；再按一次只重送那幾張
  await resetToasts();importMode='partial-first';
  await page.fill('#sem-new-name','115-3');await page.fill('#sem-new-start','2027-09-01');await page.fill('#sem-new-end','2028-01-15');
  await confirmArchive('115-2');
  batches=posts.filter(p=>p.p==='/api/import-batch'&&p.tag==='partial-first');assert.deepEqual(batches.map(b=>b.b.students.length),[20,20,5],'失敗的那批不會擋住後面的批次');
  const r4=await snapshot();
  assert.deepEqual(r4.pending.beds.map(b=>b.room+'/'+b.bed),['B101/A','B103/A'],'用 room+bed 對回去，只留失敗的');assert.equal(r4.pending.newDbId,'db-3');
  assert.doesNotMatch(r4.progress,/建立完成/);assert.match(r4.progress,/有 2 張床位建立失敗/);assert.match(r4.progress,/B101/);assert.match(r4.progress,/繼續建立床位/);assert.match(r4.box,/剩 2 張/);
  assert.ok(r4.toasts.some(t=>/有 2 張床位建立失敗/.test(t)));assert.ok(!r4.toasts.some(t=>/床位建立完成/.test(t)),'有失敗就不能說完成');
  await resetToasts();importMode='resume-2';
  await page.evaluate(()=>archiveSemester());
  batches=posts.filter(p=>p.p==='/api/import-batch'&&p.tag==='resume-2');assert.equal(batches.length,1);assert.deepEqual(batches[0].b.students.map(b=>b.room),['B101','B103']);assert.equal(batches[0].b.students[0].name,'人1');
  const r5=await snapshot();
  assert.equal(r5.pending,null);assert.equal(r5.box,'');assert.match(r5.progress,/建立完成/);assert.ok(r5.toasts.some(t=>/床位建立完成/.test(t)&&/新增 2 張/.test(t)));

  // 3. 封存失敗 → 提示學期沒有切換可直接重試；重試時後端回 alreadyCurrent → 直接建床位不當錯誤
  await resetToasts();archiveMode='fail';
  await page.fill('#sem-new-name','115-4');await page.fill('#sem-new-start','2028-02-01');await page.fill('#sem-new-end','2028-06-30');
  await confirmArchive('115-3');
  const r6=await snapshot();
  assert.ok(r6.toasts.some(t=>/封存失敗/.test(t)&&/學期沒有切換，可以直接重試/.test(t)),'失敗訊息明確說學期沒切換');
  assert.equal(r6.pending,null);assert.equal(r6.name,'115-3');assert.equal(r6.disabled,false);assert.equal(r6.btn,'封存本學期並建立新學期');
  assert.equal(await page.inputValue('#sem-new-name'),'115-4','輸入保留，直接重試');
  await resetToasts();archiveMode='alreadyCurrent';importMode='already';
  await confirmArchive('115-3');
  batches=posts.filter(p=>p.p==='/api/import-batch'&&p.tag==='already');assert.deepEqual(batches.map(b=>b.b.students.length),[20,20,5]);assert.ok(batches.every(b=>b.b.db_id==='db-4'));
  const r7=await snapshot();
  assert.ok(!r7.toasts.some(t=>/封存失敗/.test(t)),'alreadyCurrent 不當錯誤');assert.equal(r7.pending,null);assert.equal(r7.name,'115-4');assert.match(r7.progress,/建立完成/);
  assert.equal(await page.inputValue('#sem-new-name'),'','成功後清空輸入');

  // 4. pending 的 beds 遺失但知道 oldName → 用 getRoster(oldName) 重建床位清單 (欄位與後端 beds 相同，帶不帶人依 carry)
  await resetToasts();
  await page.evaluate(KEY=>{localStorage.setItem(KEY,JSON.stringify({newName:'115-4',newDbId:state.semester.current.dbId,oldName:'115-3',carry:true,beds:[],createdAt:new Date().toISOString()}));renderSemesterCard();},KEY);
  const r8=await snapshot();assert.match(r8.box,/重新讀取/);assert.match(r8.btn,/繼續建立床位/);
  importMode='rebuild';const rosterBefore=posts.filter(p=>p.p==='/api/roster').length;
  await page.evaluate(()=>archiveSemester());
  assert.ok(posts.filter(p=>p.p==='/api/roster').slice(rosterBefore).some(c=>c.q==='115-3'),'用舊學期名稱讀總表');
  batches=posts.filter(p=>p.p==='/api/import-batch'&&p.tag==='rebuild');assert.equal(batches.length,1);
  const sent=batches[0].b.students;assert.deepEqual(sent.map(s=>s.room+'/'+s.bed),['101/A','101/B','103/A']);
  assert.deepEqual(Object.keys(sent[0]).sort(),['address','attendance','bed','class','isEmpty','isForeign','name','phone','remark','room','squad','studentId']);
  assert.equal(sent[0].name,'甲');assert.equal(sent[0].studentId,'S1');assert.equal(sent[0].phone,'0912s1');assert.equal(sent[0].address,'住址s1');assert.equal(sent[0].isEmpty,false);
  assert.equal(sent[2].isEmpty,true);assert.equal(sent[2].name,'');assert.equal(sent[2].phone,'','空床不帶資料');
  const r9=await snapshot();assert.equal(r9.pending,null);assert.equal(r9.box,'');assert.ok(r9.toasts.some(t=>/床位建立完成/.test(t)));

  // 5. 別的學期 (dbId 不同) 留下的 pending 不顯示、不會誤刪
  await page.evaluate(KEY=>{localStorage.setItem(KEY,JSON.stringify({newName:'999',newDbId:'db-other',oldName:'x',carry:false,beds:[{room:'Z1',bed:'A'}],createdAt:''}));renderSemesterCard();},KEY);
  const r10=await snapshot();assert.equal(r10.box,'');assert.equal(r10.btn,'封存本學期並建立新學期');assert.equal(r10.pending.newDbId,'db-other','不主動刪');
  await page.evaluate(KEY=>localStorage.removeItem(KEY),KEY);

  assert.deepEqual(errors,[]);console.log(engine.name()+': archive pending in localStorage, resume after reload, partial failure retry, archive fail/alreadyCurrent, rebuild from old roster, name escaping PASS');
 }finally{await browser.close();}
}
(async()=>{await run(chromium);})().catch(e=>{console.error(e);process.exitCode=1;});
