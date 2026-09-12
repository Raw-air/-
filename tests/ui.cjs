const {chromium,webkit}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.join(root,name==='/'?'index.html':name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(b);});
});
const roster=Array.from({length:90},(_,i)=>({id:'test-'+i,name:'測試住宿生 '+i,studentId:'TEST'+i,class:'測試班',squad:'一單',room:String(101+Math.floor(i/4)*2),bed:String(i%4+1),attendance:{},remarks:'合成資料，不連線正式資料庫',isForeign:false,isEmpty:false}));
// 模擬資料庫未勾「空床」，但姓名只有空白且還殘留班別/學號的異常資料。
roster[89].name='   ';roster[89].studentId='STALE-ID';roster[89].class='殘留班別';
async function run(engine,viewport){
  const browser=await engine.launch({headless:true});
  const context=await browser.newContext({viewport,deviceScaleFactor:2,serviceWorkers:'block',hasTouch:true});
  const errors=[],requests=[];
  let retryImportFailed=false;
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1') {
      const file=path.join(root,decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    }
    if(url.pathname.startsWith('/api/')){
      requests.push({path:url.pathname,method:route.request().method(),body:route.request().postData()});
      if(url.pathname==='/api/attendance' && route.request().postData()?.includes('匯入重試測試') && !retryImportFailed){
        retryImportFailed=true;
        return route.fulfill({status:503,json:{error:'暫時無法連線'}});
      }
      const body=url.pathname==='/api/roster'?{students:roster,dateColumns:[]}:url.pathname==='/api/config'?{total_beds:'90'}:url.pathname==='/api/poll'?{ts:0,att_ts:0}:url.pathname==='/api/ping'?{ok:true}:{};
      return route.fulfill({json:body});
    }
    if(url.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s};',contentType:'application/javascript'});
    return route.fulfill({body:'',status:200});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error' && /Shader|WebGLProgram/.test(m.text()))errors.push(m.text());});
  await page.addInitScript(()=>{window.__vibrations=[];Object.defineProperty(navigator,'vibrate',{value:p=>{window.__vibrations.push(p);return true;},configurable:true});});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof state!=='undefined'&&!state.loading);
  const emptyBedChecks=await page.evaluate(()=>{
    const student=state.students.find(s=>s.id==='test-89');
    state.currentSquad='一單';renderRollCall(true);
    const row=document.querySelector('.student-row[data-pid="test-89"]');
    const before=state.changes.length;
    toggleStatus('test-89');
    return {
      normalized:student.isEmpty&&student.name==='',
      emptyClass:row.classList.contains('empty-bed'),
      notClickable:!row.getAttribute('onclick'),
      emptyLabel:row.querySelector('.student-name').textContent==='（空床）',
      staleMetaHidden:row.querySelector('.student-meta').textContent==='',
      noStatusButton:!row.querySelector('.status-badge')&&!!row.querySelector('.empty-tag'),
      ignoredToggle:state.changes.length===before,
      shouldAttend:document.getElementById('rc-stat-should').textContent
    };
  });
  assert.deepEqual(emptyBedChecks,{normalized:true,emptyClass:true,notClickable:true,emptyLabel:true,staleMetaHidden:true,noStatusButton:true,ignoredToggle:true,shouldAttend:'89'});
  await page.evaluate(()=>{
    const date=state.currentDate||getTodayColumnName();
    state.currentDate=date;
    state.config.total_beds='90';
    state.config.bed_offset='2';
    state.config.foreign_offset='1';
    state.students[0].isForeign=true;
    state.students[1].attendance[date]='◎';
    state.students[2].attendance[date]='✘';
    navigateTo('summary');
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#page-summary .summary-stat-link').count(),5);
  assert.equal(await page.locator('#total-empty').innerText(),'3');
  for(const [kind,title,needle] of [
    ['empty','空床數明細','空床修正值'],
    ['foreign','外籍生明細','測試住宿生 0'],
    ['leave','請假名單','測試住宿生 1'],
    ['absent','未請假名單','測試住宿生 2'],
    ['rate','住宿率計算明細','87 ÷ 90 × 100% = 96.7%']
  ]){
    await page.evaluate(kind=>openSummaryDetail(kind),kind);
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#summary-detail-title').innerText(),title);
    assert.ok((await page.locator('#summary-detail-content').innerText()).includes(needle));
    assert.equal(await page.locator('.liquid-nav [aria-current="page"]').getAttribute('data-page'),'summary');
  }
  await page.evaluate(()=>{
    const date=state.currentDate||getTodayColumnName();
    state.config.bed_offset='0';
    state.config.foreign_offset='0';
    state.students[0].isForeign=false;
    state.students[1].attendance[date]='✓';
    state.students[2].attendance[date]='✓';
  });
  await page.evaluate(()=>navigateTo('settings'));
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.liquid-nav button').count(),4);
  assert.equal(await page.locator('.liquid-nav [aria-current="page"]').getAttribute('data-page'),'settings');
  assert.equal(await page.locator('#setting-haptic').isChecked(),true);
  await page.evaluate(()=>{const el=document.getElementById('setting-haptic');el.checked=false;toggleHaptic(el);window.__vibrations=[];haptic('heavy');});
  assert.equal(await page.evaluate(()=>window.__vibrations.length),0);
  await page.evaluate(()=>{const el=document.getElementById('setting-haptic');el.checked=true;toggleHaptic(el);});
  assert.ok(await page.evaluate(()=>window.__vibrations.length>0));
  for(const [id,fn,cls] of [['setting-panzi','togglePanzi','panzi-mode'],['setting-powerSave','togglePowerSave','power-save-mode']]){
    await page.evaluate(({id,fn})=>{let e=document.getElementById(id);e.checked=true;window[fn](e);},{id,fn});
    assert.ok(await page.evaluate(cls=>document.body.classList.contains(cls),cls));
    await page.evaluate(({id,fn})=>{let e=document.getElementById(id);e.checked=false;window[fn](e);},{id,fn});
  }
  await page.evaluate(()=>{const e=document.getElementById('setting-white-mode');window.__themeOrigin=_themeTapPoint(e);e.checked=true;toggleWhiteMode(e);});
  await page.waitForFunction(()=>document.getAnimations().some(a=>a.animationName==='theme-circle-reveal'));
  await page.evaluate(()=>_themeTransition?.ready);
  assert.ok(await page.evaluate(()=>document.body.classList.contains('light-mode')));
  assert.ok(await page.evaluate(()=>{
    const p=window.__themeOrigin;
    return parseFloat(document.documentElement.style.getPropertyValue('--theme-x'))===p.x && parseFloat(document.documentElement.style.getPropertyValue('--theme-y'))===p.y;
  }));
  await page.waitForTimeout(90);
  assert.ok(await page.evaluate(()=>!document.documentElement.classList.contains('theme-reveal') || !getComputedStyle(document.documentElement,'::view-transition-new(root)').clipPath.startsWith('circle(0px')),'The first reveal must actually advance, including WebKit');
  await page.screenshot({path:path.join(out,engine.name()+'-first-theme.png')});
  await page.waitForTimeout(120);
  await page.evaluate(()=>{const e=document.getElementById('setting-white-mode');e.checked=false;toggleWhiteMode(e);});
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('light-mode')),false);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('vt-active')),false);
  await page.evaluate(()=>{state.config.total_beds='0';renderSettings();});
  assert.equal(await page.locator('#cfg-total-beds').inputValue(),'0');
  await page.evaluate(()=>{let e=document.getElementById('cfg-total-beds');e.value='10';adjustSetting('total_beds',1);});
  await page.waitForTimeout(400);
  await page.evaluate(()=>adjustSetting('total_beds',1));
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.stepper-anim-box').count(),1);
  assert.ok(await page.locator('#cfg-total-beds').evaluate(e=>e.classList.contains('number-anim-hiding')));
  await page.waitForTimeout(550);
  assert.equal(await page.locator('#cfg-total-beds').inputValue(),'12');
  assert.equal(await page.locator('.stepper-anim-box').count(),0);
  assert.ok(await page.locator('#cfg-total-beds').evaluate(e=>!e.classList.contains('number-anim-hiding')));
  for (const [from,to] of [[9,10],[99,100],[10,9],[0,-1],[-1,0]]) {
    await page.evaluate(({from,to})=>{const e=document.getElementById('cfg-bed-offset');e.value=from;animateNumber(e,to);},{from,to});
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#cfg-bed-offset').inputValue(),String(to));
    assert.equal(await page.locator('.stepper-anim-box').count(),0);
  }
  const missingHandlers=await page.evaluate(()=>Array.from(document.querySelectorAll('#page-settings [onclick],#page-settings [onchange]')).map(e=>(e.getAttribute('onclick')||e.getAttribute('onchange')).match(/^([\w$]+)\(/)?.[1]).filter(name=>name && typeof window[name]!=='function'));
  assert.deepEqual(missingHandlers,[]);
  await page.screenshot({path:path.join(out,engine.name()+'-settings.png')});
  const before=requests.filter(r=>r.path==='/api/config'&&r.method==='POST').length;
  await page.locator('#cfg-total-beds').fill('-1');await page.evaluate(()=>saveDormSettings());
  assert.equal(requests.filter(r=>r.path==='/api/config'&&r.method==='POST').length,before);
  await page.locator('#cfg-total-beds').fill('100');await page.evaluate(()=>saveDormSettings());
  assert.equal(requests.filter(r=>r.path==='/api/config'&&r.method==='POST').length,before+1);
  const exportChecks=await page.evaluate(async()=>{
    state.dateColumns=['2月20日','2月21日','2月22日','6月25日'];
    state.students[0].attendance={'2月20日':'✓','2月21日':'◎','2月22日':'✘','6月25日':'△'};
    state.config.export_start_date='2026-02-20';state.config.export_end_date='2026-02-22';renderSettings();
    const exportGridColumns=getComputedStyle(document.querySelector('#export-start-date').closest('.export-date-grid')).gridTemplateColumns.split(' ').length;
    const exportInputHeight=document.getElementById('export-start-date').getBoundingClientRect().height;
    const originalSemester=CONFIG.SEMESTER;CONFIG.SEMESTER='114-1';
    const firstSemesterDates=[dateColumnToISO('9月1日'),dateColumnToISO('1月15日')];CONFIG.SEMESTER=originalSemester;
    let exported=null,fileName='';
    window.XLSX={utils:{aoa_to_sheet:data=>(exported=data),book_new:()=>({}),book_append_sheet:()=>{}},writeFile:(_,name)=>{fileName=name;}};
    exportExcel();
    const firstHeaders=exported[0].slice();
    const firstRow=exported[1].slice();
    document.getElementById('dev-export-start-date').value='2026-02-21';
    document.getElementById('dev-export-end-date').value='2026-06-25';
    await saveDefaultExportRange();
    const savedRange=[state.config.export_start_date,state.config.export_end_date];
    const appliedRange=[document.getElementById('export-start-date').value,document.getElementById('export-end-date').value];
    exported=null;document.getElementById('export-start-date').value='2026-06-25';document.getElementById('export-end-date').value='2026-02-20';exportExcel();
    return {firstHeaders,firstRow,fileName,savedRange,appliedRange,invalidBlocked:exported===null,exportGridColumns,exportInputHeight,firstSemesterDates};
  });
  assert.deepEqual(exportChecks.firstHeaders,['名稱','寢床號','床號','班別','學號','2月20日','2月21日','2月22日']);
  assert.deepEqual(exportChecks.firstRow.slice(-3),['✓','◎','✘']);
  assert.equal(exportChecks.fileName,'碧苑點名_114-2_20260220-20260222.xlsx');
  assert.deepEqual(exportChecks.savedRange,['2026-02-21','2026-06-25']);
  assert.deepEqual(exportChecks.appliedRange,['2026-02-21','2026-06-25']);
  assert.equal(exportChecks.invalidBlocked,true);
  assert.equal(exportChecks.exportGridColumns,viewport.width<=430?1:2,'date inputs use the responsive column count');
  assert.ok(exportChecks.exportInputHeight>=44,'date inputs keep a touch-friendly height');
  assert.deepEqual(exportChecks.firstSemesterDates,['2025-09-01','2026-01-15'],'first-semester dates cross the calendar year correctly');
  await page.evaluate(()=>{document.getElementById('export-start-date').value='2026-02-21';document.getElementById('export-end-date').value='2026-06-25';updateExportDateSummary();});
  await page.locator('#export-btn').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,engine.name()+'-export-range.png')});
  await page.evaluate(()=>document.getElementById('dev-panel').classList.add('open'));
  await page.locator('#save-export-range-btn').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,engine.name()+'-export-default.png')});
  await page.evaluate(()=>document.getElementById('dev-panel').classList.remove('open'));

  // 更多選項保留原動態檔案瀏覽，但改名為「資料微動查詢」；新增 Excel 式住宿生檔案管理。
  await page.evaluate(()=>navigateTo('tools'));
  await page.waitForTimeout(250);
  const toolLabels=await page.locator('#page-tools .eb-title').allTextContents();
  assert.ok(toolLabels.includes('資料微動查詢'));
  assert.ok(toolLabels.includes('住宿生檔案管理'));
  await page.evaluate(()=>navigateTo('resident-management'));
  await page.waitForTimeout(520);
  const rmHeaders=await page.locator('.rm-table thead th').allTextContents();
  assert.deepEqual(rmHeaders,['#','名稱','寢床號','床號','班別','學號','電話','住址','外籍','空床','備註','修改']);
  assert.equal(rmHeaders.some(h=>h.includes('請假')||h.includes('2月')),false,'resident table excludes attendance/leave columns');
  assert.equal(await page.locator('#rm-table-body tr').count(),roster.length);
  const firstRmRow=page.locator('#rm-table-body tr').first();
  assert.deepEqual(await firstRmRow.locator('.rm-readonly').allTextContents(),[roster[0].room,roster[0].bed]);
  // 觸控裝置上輸入框預設唯讀 (手指滑動不會誤進編輯)，要先點一下解鎖
  const rmNameCell=firstRmRow.locator('.rm-input-name');
  await rmNameCell.click();
  assert.equal(await rmNameCell.evaluate(el=>el.readOnly),false);
  await rmNameCell.fill('測試住宿生 0A');
  assert.equal(await firstRmRow.locator('.rm-row-save').isEnabled(),true);
  assert.equal(await page.locator('#rm-dirty-count').textContent(),'1');
  await page.locator('.rm-table-shell').evaluate(shell=>{shell.scrollLeft=shell.scrollWidth;});
  await firstRmRow.locator('.rm-row-save').click();
  await page.waitForFunction(()=>state.students[0].name==='測試住宿生 0A');
  const rmWrite=requests.filter(r=>r.path==='/api/attendance'&&r.method==='PATCH').at(-1);
  const rmPayload=JSON.parse(rmWrite.body).updates[0];
  assert.equal(rmPayload.updateProfile.name,'測試住宿生 0A');
  assert.equal('date' in rmPayload,false,'profile save does not send attendance/date fields');
  await page.locator('#rm-search-input').fill('找不到的住宿生');
  assert.equal(await page.locator('#rm-table-body tr:visible').count(),0);
  assert.equal(await page.locator('#rm-empty-state').isVisible(),true);
  await page.locator('#rm-search-input').fill('');
  await page.locator('.rm-table-shell').evaluate(shell=>{shell.scrollLeft=0;});
  await page.screenshot({path:path.join(out,engine.name()+'-resident-management.png')});
  const writesBeforeArchiveClear=requests.filter(r=>r.path==='/api/attendance'&&r.method!=='GET').length;

  await page.evaluate(()=>{navigateTo('student-files');_sfResults=state.students;renderStudentFileCards();});
  // 進場 (~1s)：整排展開、中央那本抽出、自動打開詳細資料紙
  await page.waitForFunction(()=>window.sfCarousel&&sfCarousel.state==='idle',null,{timeout:5000});
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),0,'the archive stays closed until explicitly opened');
  await page.evaluate(()=>{window._sfStopMotion();_sfResults=state.students;renderStudentFileCards();});
  await page.waitForTimeout(100);
  assert.ok(await page.locator('.sf-folder').count()<=21);
  await page.evaluate(()=>{window._sfStopMotion();});
  // 弧形空間軌道：直式多層資料夾 + 資料紙；整列維持同向，跨過中央不會翻成鏡像；
  // 抽出那本 z 最前且朝向使用者；大小靠透視 (manual scale 只有 1)
  const geo=await page.evaluate(()=>{
    const num=(el,re)=>parseFloat((el.style.transform.match(re)||[])[1]);
    const zOf=el=>num(el,/translate3d\([^,]+,[^,]+,\s*(-?[\d.]+)px\)/);
    const yawOf=el=>num(el,/rotateY\((-?[\d.]+)deg\)/);
    const scOf=el=>num(el,/scale\((-?[\d.]+)\)/);
    const f=document.querySelector('.sf-folder.active'),r=f.getBoundingClientRect();
    const n=Array.from(document.querySelectorAll('.sf-folder:not(.sf-far):not(.active)')).map(e=>({i:+e.dataset.index,yaw:yawOf(e),z:zOf(e),scale:scOf(e)})).sort((p,q)=>p.i-q.i);
    return {ratio:r.width/r.height,layers:f.children.length,front:!!f.querySelector('.fd-front'),sheet:!!f.querySelector('.fd-sheet'),
      top:!!f.querySelector('.fd-top'),spines:f.querySelectorAll('.fd-spine').length,active:{i:_sfActiveIndex,yaw:yawOf(f),z:zOf(f),scale:scOf(f)},
      n,preserve:getComputedStyle(f).transformStyle==='preserve-3d'};
  });
  assert.ok(geo.ratio>.5&&geo.ratio<.9,'upright glass folder '+geo.ratio);
  assert.ok(geo.layers>=9&&geo.front&&geo.sheet&&geo.top&&geo.spines===2&&geo.preserve,'layered folder (front/back/top/2 spines/paper/edge) + sheet in a 3D context');
  assert.ok(geo.n.length>=4,'the rail shows a run of folders: '+geo.n.length);
  const yaws=geo.n.map(p=>p.yaw);
  assert.ok(geo.active.yaw>=18&&geo.active.yaw<=26,'the extracted folder faces the viewer while retaining visible thickness: '+geo.active.yaw);
  assert.ok(yaws.every(y=>y>40&&y<75),'rail folders keep one face towards the viewer: '+yaws.join(','));
  for(let k=1;k<geo.n.length;k++)assert.ok(Math.abs(geo.n[k].yaw-geo.n[k-1].yaw)<3,'yaw changes continuously without a mirrored flip: '+yaws.join(','));
  assert.ok(geo.n.every(p=>geo.active.z-p.z>55),'the active folder is pulled out of the rail towards the viewer: '+geo.active.z+' vs '+geo.n.map(p=>p.z).join(','));
  assert.ok(geo.n.concat(geo.active).every(p=>p.scale>=.88&&p.scale<=1.08),'size comes from perspective, manual scale stays within 0.88–1.08');
  const zs=geo.n.map(p=>p.z);
  assert.ok(Math.max(...zs)-Math.min(...zs)>110,'the arc has real depth: '+zs.join(','));
  // 弧：最靠近鏡頭的頂點在中間，兩端都比它後退 (不是單向縮小的斜直線)
  const apex=zs.indexOf(Math.max(...zs));
  assert.ok(apex>0&&apex<zs.length-1&&zs[0]<zs[apex]-30&&zs[zs.length-1]<zs[apex]-30,'curved rail: both ends recede behind the apex: '+zs.join(','));
  const centred=await page.locator('.sf-folder.active').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,w:innerWidth};});
  assert.ok(Math.abs(centred.x-centred.w/2)<centred.w*.08,'the selected folder is centred: '+JSON.stringify(centred));
  assert.equal(await page.locator('.sf-orbit').count(),0,'the decorative orbit ring is removed');
  assert.ok(await page.locator('#page-student-files').evaluate(e=>parseFloat(getComputedStyle(e).getPropertyValue('--fd-depth'))>=12),'folder shell has visible physical depth');
  await page.evaluate(()=>state.students.push({id:'synthetic-homophone',name:'合成巧玲',studentId:'SYN-QIAO',class:'合成班',squad:'測試',room:'999',bed:'9',attendance:{},remarks:'合成同音搜尋資料',isForeign:false,isEmpty:false}));
  await page.locator('#sf-search-input').fill('悄');
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(()=>_sfResults.some(s=>s.name==='合成巧玲')),true,'folder search matches 巧 when the user enters its homophone 悄');
  assert.equal(await page.locator('.sf-folder.active .fd-name').innerText(),'合成巧玲');
  await page.evaluate(()=>{state.students=state.students.filter(s=>s.id!=='synthetic-homophone');});
  await page.locator('#sf-search-input').fill('');
  await page.waitForTimeout(120);
  const stableTransform=await page.locator('.sf-folder.active').evaluate(e=>e.style.transform);
  await page.locator('#sf-search-input').fill('測試住宿生');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.sf-folder.active').evaluate(e=>e.style.transform),stableTransform,'search keeps the same camera and final folder pose');
  assert.equal(await page.locator('#sf-search-input').evaluate(e=>getComputedStyle(e).outlineStyle),'none','search field does not draw the green focus outline');
  await page.locator('#sf-search-input').fill('');
  await page.waitForTimeout(120);
  // A swipe can begin over the folder front; release settles in one short spring, then the sheet re-opens.
  const front=await page.locator('.sf-folder.active .fd-front').boundingBox();
  await page.mouse.move(front.x+front.width*.7,front.y+front.height*.5);
  await page.mouse.down();
  await page.mouse.move(front.x+front.width*.7-180,front.y+front.height*.5,{steps:12});
  await page.waitForFunction(()=>sfCarousel.state==='dragging'&&_sfActiveIndex>0&&_sfActiveIndex===Math.round(sfCarousel.center));
  const liveSelection=await page.evaluate(()=>{
    const active=document.querySelector('.sf-folder.active');
    const neighbor=document.querySelector('.sf-folder:not(.active):not(.sf-far)');
    return {
      index:_sfActiveIndex,
      cardIndex:Number(active.dataset.index),
      activeCount:document.querySelectorAll('.sf-folder.active').length,
      summary:document.getElementById('sf-selection-name').textContent,
      expected:sfStudentAt(_sfActiveIndex).name||'空床',
      activeMaterial:getComputedStyle(active.querySelector('.fd-front')).backgroundImage,
      neighborMaterial:getComputedStyle(neighbor.querySelector('.fd-front')).backgroundImage,
    };
  });
  assert.equal(liveSelection.cardIndex,liveSelection.index,'green selected folder updates before release');
  assert.equal(liveSelection.activeCount,1);
  assert.equal(liveSelection.summary,liveSelection.expected,'current resident summary updates during the drag');
  assert.notEqual(liveSelection.activeMaterial,liveSelection.neighborMaterial,'live selected folder uses the green material');
  await page.mouse.up();
  await page.waitForTimeout(950);
  assert.ok(await page.evaluate(()=>_sfActiveIndex>0));
  assert.ok(await page.evaluate(()=>Math.abs(_currentX+_sfActiveIndex*_cardWidth)<.5));
  await page.waitForFunction(()=>sfCarousel.state==='idle',null,{timeout:5000});
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),0,'browsing keeps the archive visible');
  // Return to the first synthetic card for deterministic screenshots.
  await page.evaluate(()=>{window._sfStopMotion();renderStudentFileCards();});
  await page.waitForTimeout(100);
  await page.evaluate(()=>{window._sfStopMotion();sfCarousel.openSheet();});
  await page.locator('.sf-folder.active .sf-input-name').fill('滑動後保留');
  await page.evaluate(()=>window._sfSweepTo(0,-20*_cardWidth));
  await page.waitForTimeout(950);
  await page.evaluate(()=>window._sfSweepTo(_currentX,0));
  await page.waitForTimeout(950);
  assert.equal(await page.locator('.sf-folder.active .sf-input-name').inputValue(),'滑動後保留');
  await page.evaluate(()=>{window._sfStopMotion();document.querySelector('.sf-folder.active .sf-input-name').value='測試住宿生 0';sfCarousel.openSheet();});
  await page.waitForTimeout(700);
  await page.screenshot({path:path.join(out,engine.name()+'-cards.png')});
  // 刪除 = 高密度粉塵 + 微型黑洞：renderer (canvas / WebGL context / shader / 粒子池) 在頁面載入
  // 就備妥，按下去 250ms 內就開始畫，DOM 用遮罩與粉塵同步消失；粉塵還在飛的時候資料夾就以
  // 「空床」長回來 (草稿，不打 API)，紙會再自動打開
  assert.equal(await page.locator('.sf-dissolve-canvas').count(),1,'particle canvas is created at page mount');
  assert.ok(await page.evaluate(()=>sfDissolve.max>=3000),'the particle pool is preallocated for a dense dust cloud');
  await page.evaluate(()=>{window.__delT0=performance.now();window.__bhDone=false;clearStudentData(document.querySelector('.sf-folder.active .sf-broom-btn')).then(()=>window.__bhDone=true);});
  await page.waitForSelector('.sf-dissolve-canvas.is-running',{timeout:400});
  assert.ok(await page.evaluate(()=>performance.now()-window.__delT0<250),'dissolve starts immediately, no first-run stall');
  await page.waitForTimeout(140);
  await page.screenshot({path:path.join(out,engine.name()+'-dissolve.png')});
  await page.waitForFunction(()=>window.__bhDone,{timeout:5000});
  const delT=await page.evaluate(()=>performance.now()-window.__delT0);
  assert.ok(delT<4000,'delete + black-hole suction finishes in time: '+delT);
  // 資料夾本身跟著粉塵一起消失 (DOM 遮罩)，而且粉塵是「一大片」不是幾十顆
  const dust=await page.evaluate(()=>({...sfDissolve.stats,webgl:sfDissolve.webgl,max:sfDissolve.max}));
  assert.ok(dust.masked,'the folder itself dissolves with the particles (DOM mask follows the frontier)');
  assert.ok(dust.max>=3000,'the particle pool is preallocated for a dense dust cloud: '+dust.max);
  assert.ok(dust.spawned>400,'a dense dust cloud, not a handful of specks: '+JSON.stringify(dust));
  assert.ok(dust.peak>150,'many particles are alive at once: '+JSON.stringify(dust));
  console.log('  dust:',JSON.stringify(dust));
  assert.equal(await page.evaluate(()=>window._sfBHBusy),false);
  assert.equal(await page.locator('.sf-dissolve-canvas.is-running').count(),0);
  assert.equal(await page.evaluate(()=>Array.from(document.querySelector('.sf-folder.active').children).filter(c=>c.style.maskImage||c.style.webkitMaskImage||c.style.visibility==='hidden').length),0,'masks are cleaned up');
  assert.equal(await page.locator('.sf-folder.active .sf-input-name').inputValue(),'');
  assert.equal(await page.locator('.sf-folder.active .fd-name').innerText(),'空床');
  assert.equal(requests.filter(r=>r.path==='/api/attendance'&&r.method!=='GET').length,writesBeforeArchiveClear);
  await page.waitForFunction(()=>sfCarousel.state==='idle',null,{timeout:5000});
  await page.waitForSelector('.sf-folder.active.is-open',{timeout:3000}).catch(()=>{throw new Error('sheet re-opens on the re-materialised folder');});
  await page.screenshot({path:path.join(out,engine.name()+'-after-delete.png')});
  // A pending save must not overwrite text the user types after pressing Save.
  await page.evaluate(async()=>{
    const card=document.querySelector('.sf-folder.active');
    const input=card.querySelector('.sf-input-name');input.value='已送出的名字';
    card.querySelector('.sf-chk-empty').checked=false;
    const original=window._api.updateAttendance;
    let finish;window._api.updateAttendance=()=>new Promise(r=>finish=r);
    const saving=autoSaveStudentFile(input);
    input.value='稍後的新修改';finish({});await saving;
    window._api.updateAttendance=original;
  });
  assert.equal(await page.locator('.sf-folder.active .sf-input-name').inputValue(),'稍後的新修改');
  assert.equal(await page.locator('.sf-folder.active .fd-name').innerText(),'稍後的新修改','summary on the folder front follows the save');
  // Cancellation (leaving the page mid-dissolve) restores the folder without clearing the form.
  await page.locator('.sf-folder.active .sf-input-name').fill('保留草稿');
  await page.evaluate(()=>{window.__bhDone=false;clearStudentData(document.querySelector('.sf-folder.active .sf-broom-btn')).then(()=>window.__bhDone=true);});
  await page.waitForTimeout(100);await page.evaluate(()=>navigateTo('settings'));
  await page.waitForFunction(()=>window.__bhDone);
  assert.equal(await page.evaluate(()=>window._sfBHBusy),false);
  assert.equal(await page.locator('.sf-dissolve-canvas.is-running').count(),0);
  assert.equal(await page.evaluate(()=>Array.from(document.querySelector('.sf-folder.active').children).filter(c=>c.style.maskImage||c.style.webkitMaskImage||c.style.visibility==='hidden').length),0);
  assert.equal(await page.locator('.sf-folder.active .sf-input-name').inputValue(),'保留草稿');
  // Older Safari fallback also honours the latest switch value.
  await page.evaluate(()=>{document.startViewTransition=undefined;const e=document.getElementById('setting-white-mode');e.checked=true;toggleWhiteMode(e);e.checked=false;toggleWhiteMode(e);});
  await page.waitForTimeout(850);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('light-mode')),false);
  // Theme source is the switch centre, even for keyboard changes after unrelated clicks.
  assert.ok(await page.evaluate(()=>{lastTapX=1;lastTapY=1;const el=document.getElementById('setting-white-mode'),r=el.closest('label').getBoundingClientRect(),p=_themeTapPoint(el);return p.x===r.left+r.width/2&&p.y===r.top+r.height/2;}));
  await page.evaluate(()=>{Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true});haptic('heavy');playHapticCurve([1],50);});
  // Simulate an in-flight backup and another edit to the same attendance record.
  await page.evaluate(()=>{window.__backupOriginal=_api.updateAttendance;_api.updateAttendance=()=>new Promise(r=>window.__finishBackup=r);state.changes=[{pageId:'test-backup',date:'d',value:'A'}];backupPendingChanges();});
  await page.evaluate(()=>{state.changes[0].value='B';window.__finishBackup({});});
  await page.waitForFunction(()=>!_backupBusy);
  assert.equal(await page.evaluate(()=>state.changes[0].value),'B');
  await page.evaluate(()=>{_api.updateAttendance=window.__backupOriginal;state.changes=[];});
  const adminChecks=await page.evaluate(async()=>{
    const real=_api.setConfig;let sent=[];_api.setConfig=async v=>sent.push(v);
    const pin=document.getElementById('cfg-pin-president');pin.value='abc';await saveRolePIN('president','cfg-pin-president');
    const invalidBlocked=sent.length===0;
    pin.value='123456';await saveRolePIN('president','cfg-pin-president');
    const pinSaved=sent.at(-1).pin_president==='123456' && pin.value==='';
    state.config.role_label_president='原標籤';document.getElementById('dev-label-president').value='新標籤';
    _api.setConfig=async()=>{throw Error('mock offline');};await saveRoleAppearance('president');
    const failedAppearancePreserved=state.config.role_label_president==='原標籤';
    state.config.global_pin_auth='true';document.getElementById('dev-global-pin-auth').checked=false;await saveGlobalPinAuth();
    const failedSwitchRestored=document.getElementById('dev-global-pin-auth').checked;
    _api.setConfig=real;
    const mute=document.getElementById('setting-mute');mute.checked=true;toggleMute(mute);
    const muteSaved=localStorage.getItem('mute_sound')==='true';
    return [invalidBlocked,pinSaved,failedAppearancePreserved,failedSwitchRestored,muteSaved];
  });
  assert.deepEqual(adminChecks,[true,true,true,true,true]);
  // ── Excel 匯入 (import.js)：設定卡片、精靈開關、_importRows 管線 (更新 / 略過相同 / 找不到床位 / 清空) ──
  await page.evaluate(()=>navigateTo('settings'));await page.waitForTimeout(300);
  assert.equal(await page.locator('.imp-open-btn').count(),1);
  await page.evaluate(()=>window.openImportWizard());
  await page.waitForSelector('#imp-modal.visible',{timeout:4000});   // WebKit 忙碌時固定等 200ms 不夠
  await page.evaluate(()=>window._impClose());await page.waitForTimeout(200);
  const impRows=[[1,'101','1','匯入班','S9001','新生甲','','0911000001','','台北市'],[2,'101','2','殘留班別','STALE-ID','','','','',''],[3,'101','3','測試班','TEST2','測試住宿生 2','','','',''],[4,'999','1','x','S9','無法比對','','','','']];
  const impMap={room:1,bed:2,class:3,studentId:4,name:5,phone:7,address:9};
  const impBefore=requests.filter(r=>r.path==='/api/attendance').length;
  const imp1=await page.evaluate(({rows,mapping})=>window._importRows(rows,mapping,{blankAsEmpty:false,noteContact:false,skipUnchanged:true}),{rows:impRows,mapping:impMap});
  assert.equal(imp1.preview.stats.total,4);assert.equal(imp1.preview.stats.matched,3);assert.equal(imp1.preview.stats.unmatchedRows,1);assert.equal(imp1.preview.stats.willChange,1);
  assert.equal(imp1.result.ok,1);assert.equal(imp1.result.fail,0);
  const impReqs=requests.filter(r=>r.path==='/api/attendance');assert.equal(impReqs.length,impBefore+1);
  assert.deepEqual(JSON.parse(impReqs[impReqs.length-1].body).updates,[{pageId:'test-0',updateProfile:{name:'新生甲',class:'匯入班',studentId:'S9001',isForeign:false,phone:'0911000001',address:'台北市'},markEmpty:false}]);
  assert.equal(await page.evaluate(()=>state.students.find(s=>s.id==='test-0').name),'新生甲');
  const imp2=await page.evaluate(({rows,mapping})=>window._importRows(rows,mapping,{blankAsEmpty:true,noteContact:false,skipUnchanged:true}),{rows:impRows,mapping:impMap});
  assert.equal(imp2.preview.items.find(it=>String(it.room)==='101'&&String(it.bed)==='2').action,'clear');
  const impClear=JSON.parse(requests.filter(r=>r.path==='/api/attendance').slice(-1)[0].body).updates.find(u=>u.pageId==='test-1');
  assert.deepEqual(impClear,{pageId:'test-1',updateProfile:{name:'',class:'',studentId:'',phone:'',address:'',isForeign:false},markEmpty:true,clearProfile:true});
  const retryRows=[[1,'103','1','匯入班','S-RETRY','匯入重試測試','','','','']];
  const impRetry=await page.evaluate(({rows,mapping})=>window._importRows(rows,mapping,{blankAsEmpty:false,noteContact:false,skipUnchanged:true}),{rows:retryRows,mapping:impMap});
  assert.equal(impRetry.result.ok,1,'a transient import request is retried safely');
  assert.equal(impRetry.result.fail,0);
  await page.evaluate(()=>localStorage.setItem('white_mode','true'));
  await page.reload();await page.waitForFunction(()=>typeof state!=='undefined'&&!state.loading);
  assert.equal(await page.locator('.liquid-nav .nav-icon img').count(),0);
  assert.equal(await page.locator('.liquid-nav .lens-fringe').count(),0,'liquid glass has no chromatic fringe layer');
  const navAlignment=await page.locator('.liquid-nav .nav-item').first().evaluate(e=>{const i=e.querySelector('.nav-icon svg').getBoundingClientRect(),t=e.querySelector('.nav-label').getBoundingClientRect();return Math.abs((i.left+i.width/2)-(t.left+t.width/2));});
  assert.ok(navAlignment<1,'navigation icon and label share the same centre line: '+navAlignment);
  assert.ok(await page.evaluate(()=>document.body.classList.contains('light-mode')));
  await page.screenshot({path:path.join(out,engine.name()+'-light-navigation.png')});
  assert.deepEqual(errors,[]);
  console.log(engine.name()+' '+viewport.width+'x'+viewport.height+': settings, theme race, reel race, validation, folder archive, swipe/extraction, particle dissolve, cancellation PASS');
  await browser.close();
}
async function offline(){
  const browser=await chromium.launch();const context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({json:{}}));
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const cacheName=fs.readFileSync(path.join(root,'sw.js'),'utf8').match(/CACHE_NAME\s*=\s*'([^']+)'/)[1];
  assert.ok(await page.evaluate(async name=>(await caches.keys()).includes(name),cacheName));
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  assert.ok(await page.evaluate(()=>typeof clearStudentData==='function' && typeof sfDissolve==='object' && typeof setup2DCarouselInteraction==='function'));
  assert.equal(await page.evaluate(()=>sfPhoneticSearch.matches('合成巧玲','悄')),true,'same-sound name search remains available offline');
  assert.equal(await page.evaluate(()=>typeof THREE),'undefined','three.js is gone');
  console.log('Offline shell, versioned assets and particle-dissolve dependencies PASS');
  await browser.close();
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{if(process.env.TEST_OFFLINE)await offline();else {const customViewport=Number(process.env.TEST_WIDTH)&&Number(process.env.TEST_HEIGHT)?{width:Number(process.env.TEST_WIDTH),height:Number(process.env.TEST_HEIGHT)}:null;await run(process.env.TEST_WEBKIT?webkit:chromium,customViewport||(process.env.TEST_DESKTOP?{width:1440,height:1000}:{width:390,height:844}));}}finally{server.close();}})().catch(e=>{console.error(e);process.exit(1);});
