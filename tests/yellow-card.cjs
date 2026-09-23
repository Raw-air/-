// 黃單額度 + 資料夾軌道下方的批次儲存 (API 全部攔截成合成資料，不會寫到正式 Notion)
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const roster=Array.from({length:40},(_,i)=>({id:'test-'+i,name:'測試住宿生 '+i,studentId:'T'+i,class:'測試班',squad:'一單',room:String(101+Math.floor(i/4)*2),bed:String(i%4+1),attendance:{},remarks:''}));
const rec=(d,r,n)=>({d,r,n,t:Date.parse(d)});
const config={total_beds:'40',
  'yc_test-3':JSON.stringify([rec('2026-09-01','晚歸','測試住宿生 3'),rec('2026-09-10','噪音喧嘩','測試住宿生 3')]),
  'yc_test-5':JSON.stringify([rec('2026-09-02','內務不整','測試住宿生 5'),rec('2026-09-12','晚歸','測試住宿生 5'),rec('2026-09-20','違規電器','測試住宿生 5')]),
  // 床位換人：舊住宿生的黃單不能算到現在這位頭上
  'yc_test-7':JSON.stringify([rec('2026-08-01','晚歸','已退宿的人')]),
};
(async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,serviceWorkers:'block',hasTouch:true,reducedMotion:'reduce'});
  const errors=[],writes=[];
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'){
      const file=path.join(root,decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    }
    if(url.pathname.startsWith('/api/')){
      const m=route.request().method();
      if(m!=='GET')writes.push({path:url.pathname,body:JSON.parse(route.request().postData()||'null')});
      const body=url.pathname==='/api/roster'?{students:roster,dateColumns:[]}:url.pathname==='/api/config'&&m==='GET'?config:url.pathname==='/api/poll'?{ts:0,att_ts:0}:{success:true};
      return route.fulfill({json:body});
    }
    return route.fulfill({body:'',status:200});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1/');
  await page.waitForFunction(()=>typeof state!=='undefined'&&!state.loading&&state.students.length===40);

  // ── 黃單額度：只列出有待執行黃單的人，累犯多的排前面；換床前的舊紀錄不算 ──
  page.on('dialog',d=>d.accept());
  await page.evaluate(()=>openYellowCards());
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(()=>document.getElementById('page-student-files').classList.contains('yc-mode')));
  assert.deepEqual(await page.evaluate(()=>_sfResults.map(s=>s.id)),['test-5','test-3']);
  assert.match(await page.locator('#sf-result-count').innerText(),/02 人待執行/);
  assert.match(await page.locator('.yc-duty').innerText(),/2[\s\n]*人可派/);
  assert.match(await page.locator('.yc-duty').innerText(),/待執行 5 張/);
  assert.equal(await page.locator('.sf-archive-heading h1').evaluate(e=>e.firstChild.textContent),'黃單額度');
  assert.equal(await page.locator('.sf-folder.active .yc-stamp b').innerText(),'3');
  assert.equal(await page.locator('.sf-folder.active .fd-paper .yc-slip').count(),3,'one yellow slip per card inside the folder');
  // 不循環：只有 2 個人就只有 2 本，往後翻停在最後一本
  assert.equal(await page.evaluate(()=>document.querySelectorAll('#sf-card-track .sf-folder:not(.sf-far)').length),2,'finite rail: one folder per person');
  await page.evaluate(()=>{sfCarousel.next();});await page.waitForTimeout(500);
  await page.evaluate(()=>{sfCarousel.next();});await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>_sfActiveIndex),1,'stops at the last folder');
  await page.evaluate(()=>{sfCarousel.previous();sfCarousel.previous();});await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>_sfActiveIndex),0,'stops at the first folder');
  await page.screenshot({path:path.join(out,'yc-rail.png')});

  // 開單：可以選開單日期，馬上寫進設定表
  await page.evaluate(()=>sfCarousel.openSheet());
  await page.waitForSelector('.sf-folder.active.is-open .yc-reason');
  await page.locator('.sf-folder.active .yc-chip',{hasText:'垃圾未倒'}).click();
  assert.equal(await page.locator('.sf-folder.active .yc-reason').inputValue(),'垃圾未倒');
  await page.locator('.sf-folder.active .yc-issue-date').fill('2026-09-21');
  await page.locator('.sf-folder.active .yc-add-btn').click();
  await page.waitForFunction(()=>document.querySelector('.sf-folder.active .yc-stamp b')?.textContent==='4');
  const addWrite=writes.find(w=>w.path==='/api/config');
  const added=JSON.parse(addWrite.body['yc_test-5']);
  assert.equal(added.length,4);assert.equal(added[3].r,'垃圾未倒');assert.equal(added[3].d,'2026-09-21');assert.equal(added[3].n,'測試住宿生 5');assert.ok(!added[3].x);
  assert.equal(await page.locator('.sf-folder.active .yc-row').count(),4);
  assert.match(await page.locator('.sf-folder.active .sf-card-badge-relative').innerText(),/待執行 4・共 4/);
  await page.screenshot({path:path.join(out,'yc-sheet.png')});

  // 黑洞 = 全部標記執行 (日期用紙上的執行日期)，紀錄留著
  const before=writes.length;
  await page.locator('.sf-folder.active .yc-exec-date').fill('2026-09-26');
  await page.evaluate(()=>sfCarousel.closeSheet(true));
  await page.locator('#sf-commit-bar .sf-commit-hole').click();
  await page.waitForFunction(()=>!window._sfBHBusy);
  assert.equal(writes.length,before,'black hole is a draft, no API call yet');
  assert.match(await page.locator('#sf-commit-bar .sf-commit-save').innerText(),/儲存 1 筆/);
  assert.equal(await page.locator('.sf-folder.active .yc-stamp b').innerText(),'0');
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),0,'stays on the rail after the clear');
  await page.locator('#sf-commit-bar .sf-commit-save').click();
  await page.waitForFunction(()=>(b=>b.disabled&&!b.classList.contains('is-busy'))(document.querySelector('#sf-commit-bar .sf-commit-save')));
  const execd=JSON.parse(writes.slice(before).find(w=>w.path==='/api/config').body['yc_test-5']);
  assert.equal(execd.length,4,'history is kept');
  assert.ok(execd.every(x=>x.x==='2026-09-26'),'every card gets the execution date');
  assert.deepEqual(await page.evaluate(()=>_sfResults.map(s=>s.id)),['test-3'],'executed student leaves the ledger');

  // 單張執行 / 刪除 (開錯單) 都是草稿
  await page.evaluate(()=>sfCarousel.openSheet());
  await page.waitForSelector('.sf-folder.active.is-open .yc-exec');
  await page.locator('.sf-folder.active .yc-exec').first().click();
  assert.equal(await page.locator('.sf-folder.active .yc-row.is-done').count(),1);
  assert.match(await page.locator('.sf-folder.active .yc-row.is-done').innerText(),/晚歸/,'the oldest open card is listed first');
  await page.locator('.sf-folder.active .yc-row:not(.is-done) .yc-del').click();
  assert.equal(await page.locator('.sf-folder.active .yc-row').count(),1);
  assert.match(await page.locator('#sf-commit-bar .sf-commit-save').innerText(),/儲存 1 筆/);
  await page.locator('#sf-commit-bar .sf-commit-save').click();
  await page.waitForFunction(()=>(b=>b.disabled&&!b.classList.contains('is-busy'))(document.querySelector('#sf-commit-bar .sf-commit-save')));
  const one=JSON.parse(writes.filter(w=>w.path==='/api/config').pop().body['yc_test-3']);
  assert.equal(one.length,1);assert.equal(one[0].r,'晚歸');assert.ok(one[0].x,'executed, not deleted');
  await page.waitForTimeout(200);
  assert.match(await page.locator('#sf-card-track').innerText(),/目前沒有待執行的黃單/);

  // 開單紀錄：全部 (含已執行、換床前的人)
  await page.evaluate(()=>yc.openLog());
  await page.waitForSelector('#yc-log.is-open');
  assert.equal(await page.locator('#yc-log tbody tr').count(),6,'4 + 1 + the previous occupant');
  assert.match(await page.locator('#yc-log').innerText(),/已退宿的人/);
  await page.screenshot({path:path.join(out,'yc-log.png')});
  await page.evaluate(()=>yc.closeLog());

  // 搜尋可以找到沒黃單的人；換床前的舊紀錄不算
  await page.fill('#sf-search-input','測試住宿生 7');
  await page.waitForFunction(()=>_sfResults.length===1&&_sfResults[0].id==='test-7');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.sf-folder.active .yc-stamp b').innerText(),'0');

  // ── 回到資料微動：模式切回、連清兩本、按一次儲存 ──
  await page.evaluate(()=>{navigateTo('tools');});
  await page.waitForTimeout(700);
  await page.evaluate(()=>{navigateTo('student-files');initStudentFiles();});
  await page.waitForFunction(()=>document.getElementById('page-student-files').classList.contains('active'));
  await page.waitForTimeout(500);
  assert.ok(!(await page.evaluate(()=>document.getElementById('page-student-files').classList.contains('yc-mode'))));
  assert.equal(await page.evaluate(()=>_sfResults.length),40);
  assert.equal(await page.locator('.sf-archive-heading h1').evaluate(e=>e.firstChild.textContent),'資料微動查詢');
  assert.equal(await page.locator('.sf-folder.active .sf-input-name').count(),0,'the form is built only when the folder opens');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('#sf-card-track .sf-folder:not(.sf-far)').length>2),true,'files mode loops again');
  const b2=writes.length;
  await page.locator('#sf-commit-bar .sf-commit-hole').click();
  await page.waitForFunction(()=>!window._sfBHBusy);
  await page.evaluate(()=>sfCarousel.next());
  await page.waitForTimeout(300);
  await page.locator('#sf-commit-bar .sf-commit-hole').click();
  await page.waitForFunction(()=>!window._sfBHBusy);
  assert.equal(writes.length,b2,'clears are drafts');
  assert.match(await page.locator('#sf-commit-bar .sf-commit-save').innerText(),/儲存 2 筆/);
  await page.screenshot({path:path.join(out,'sf-commit-bar.png')});
  await page.locator('#sf-commit-bar .sf-commit-save').click();
  await page.waitForFunction(()=>(b=>b.disabled&&!b.classList.contains('is-busy'))(document.querySelector('#sf-commit-bar .sf-commit-save')));
  const att=writes.slice(b2).filter(w=>w.path==='/api/attendance');
  assert.equal(att.length,1,'one batched request');
  assert.deepEqual(att[0].body.updates?att[0].body.updates.map(u=>u.pageId).sort():att[0].body.map(u=>u.pageId).sort(),['test-0','test-1']);
  assert.ok(await page.evaluate(()=>state.students.find(s=>s.id==='test-0').isEmpty&&state.students.find(s=>s.id==='test-1').isEmpty));
  assert.equal(await page.locator('.sf-folder.active .fd-name').innerText(),'空床');

  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('yellow-card: all checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
