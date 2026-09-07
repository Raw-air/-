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
async function run(engine,viewport){
  const browser=await engine.launch({headless:true});
  const context=await browser.newContext({viewport,deviceScaleFactor:2,serviceWorkers:'block',hasTouch:true});
  const errors=[],requests=[];
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1') {
      const file=path.join(root,decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    }
    if(url.pathname.startsWith('/api/')){
      requests.push({path:url.pathname,method:route.request().method(),body:route.request().postData()});
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
  await page.evaluate(()=>{navigateTo('student-files');_sfResults=state.students;renderStudentFileCards();});
  // 進場 (~1s)：整排展開、中央那本抽出、自動打開詳細資料紙
  await page.waitForFunction(()=>window.sfCarousel&&sfCarousel.state==='idle',null,{timeout:5000});
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),1,'the active folder opens its sheet after the entrance');
  await page.evaluate(()=>{window._sfStopMotion();_sfResults=state.students;renderStudentFileCards();});
  await page.waitForTimeout(100);
  assert.ok(await page.locator('.sf-folder').count()<=13);
  await page.evaluate(()=>{window._sfStopMotion();});
  // 橫式資料夾、六層殼 (背板 / 兩片側邊 / 內頁 / 前板 / 邊緣) + 資料紙，兩側鄰居是側轉的
  const geo=await page.evaluate(()=>{
    const f=document.querySelector('.sf-folder.active'),r=f.getBoundingClientRect();
    const n=Array.from(document.querySelectorAll('.sf-folder:not(.sf-far):not(.active)'));
    return {ratio:r.width/r.height,layers:f.children.length,front:!!f.querySelector('.fd-front'),sheet:!!f.querySelector('.fd-sheet'),
      neighbours:n.length,yaws:n.map(e=>parseFloat((e.style.transform.match(/rotateY\((-?[\d.]+)deg\)/)||[])[1])),
      preserve:getComputedStyle(f).transformStyle==='preserve-3d',active:f.style.transform};
  });
  assert.ok(geo.ratio>1.4&&geo.ratio<1.8,'landscape folder '+geo.ratio);
  assert.ok(geo.layers>=7&&geo.front&&geo.sheet&&geo.preserve,'6-layer folder + sheet in a 3D context');
  assert.ok(geo.neighbours>=2&&geo.yaws.every(y=>y<=-6&&y>=-14),'every folder shares the same yaw (no mirrored fan): '+geo.yaws.join(','));
  assert.ok(/translate3d\(0px, -12px, (92|120)px\)/.test(geo.active),'active folder is pulled out towards the viewer: '+geo.active);
  // A swipe can begin over the folder front; release settles in one short spring, then the sheet re-opens.
  const front=await page.locator('.sf-folder.active .fd-front').boundingBox();
  await page.mouse.move(front.x+front.width*.7,front.y+front.height*.5);
  await page.mouse.down();await page.mouse.move(front.x+front.width*.7-180,front.y+front.height*.5,{steps:12});await page.mouse.up();
  await page.waitForTimeout(950);
  assert.ok(await page.evaluate(()=>_sfActiveIndex>0));
  assert.ok(await page.evaluate(()=>Math.abs(_currentX+_sfActiveIndex*_cardWidth)<.5));
  await page.waitForFunction(()=>sfCarousel.state==='idle',null,{timeout:5000});
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),1,'sheet re-opens after a swipe settles');
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
  // 刪除 = 粒子消散：canvas 在頁面載入就存在，按下去 200ms 內就開始畫，DOM 用遮罩同步消失，
  // 結束後同一本以「空床」長回來 (草稿，不打 API)，紙會再自動打開
  assert.equal(await page.locator('.sf-dissolve-canvas').count(),1,'particle canvas is created at page mount');
  await page.evaluate(()=>{window.__delT0=performance.now();window.__bhDone=false;clearStudentData(document.querySelector('.sf-folder.active .sf-broom-btn')).then(()=>window.__bhDone=true);});
  await page.waitForSelector('.sf-dissolve-canvas.is-running',{timeout:400});
  assert.ok(await page.evaluate(()=>performance.now()-window.__delT0<250),'dissolve starts immediately, no first-run stall');
  await page.waitForFunction(()=>{const f=document.querySelector('.sf-folder.active .fd-front');return !!(f.style.maskImage||f.style.webkitMaskImage);},null,{timeout:900}).catch(()=>{throw new Error('the folder itself must dissolve with the particles');});
  await page.waitForTimeout(60);
  await page.screenshot({path:path.join(out,engine.name()+'-dissolve.png')});
  await page.waitForFunction(()=>window.__bhDone,{timeout:5000});
  const delT=await page.evaluate(()=>performance.now()-window.__delT0);
  assert.ok(delT<4000,'delete + re-materialise finishes in time: '+delT);
  assert.equal(await page.evaluate(()=>window._sfBHBusy),false);
  assert.equal(await page.locator('.sf-dissolve-canvas.is-running').count(),0);
  assert.equal(await page.evaluate(()=>Array.from(document.querySelector('.sf-folder.active').children).filter(c=>c.style.maskImage||c.style.webkitMaskImage||c.style.visibility==='hidden').length),0,'masks are cleaned up');
  assert.equal(await page.locator('.sf-folder.active .sf-input-name').inputValue(),'');
  assert.equal(await page.locator('.sf-folder.active .fd-name').innerText(),'空床');
  assert.equal(requests.filter(r=>r.path==='/api/attendance'&&r.method!=='GET').length,0);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),1,'sheet re-opens on the re-materialised folder');
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
  const impRows=[[1,'101','1','匯入班','S9001','新生甲','','0911000001','','台北市'],[2,'101','2','','','','','','',''],[3,'101','3','測試班','TEST2','測試住宿生 2','','','',''],[4,'999','1','x','S9','無法比對','','','','']];
  const impMap={room:1,bed:2,class:3,studentId:4,name:5,phone:7,address:9};
  const impBefore=requests.filter(r=>r.path==='/api/attendance').length;
  const imp1=await page.evaluate(({rows,mapping})=>window._importRows(rows,mapping,{blankAsEmpty:false,noteContact:false,skipUnchanged:true}),{rows:impRows,mapping:impMap});
  assert.equal(imp1.preview.stats.total,4);assert.equal(imp1.preview.stats.matched,3);assert.equal(imp1.preview.stats.unmatchedRows,1);assert.equal(imp1.preview.stats.willChange,1);
  assert.equal(imp1.result.ok,1);assert.equal(imp1.result.fail,0);
  const impReqs=requests.filter(r=>r.path==='/api/attendance');assert.equal(impReqs.length,impBefore+1);
  assert.deepEqual(JSON.parse(impReqs[impReqs.length-1].body).updates,[{pageId:'test-0',updateProfile:{name:'新生甲',class:'匯入班',studentId:'S9001',isForeign:false},markEmpty:false}]);
  assert.equal(await page.evaluate(()=>state.students.find(s=>s.id==='test-0').name),'新生甲');
  const imp2=await page.evaluate(({rows,mapping})=>window._importRows(rows,mapping,{blankAsEmpty:true,noteContact:false,skipUnchanged:true}),{rows:impRows,mapping:impMap});
  assert.equal(imp2.preview.items.find(it=>String(it.room)==='101'&&String(it.bed)==='2').action,'clear');
  const impClear=JSON.parse(requests.filter(r=>r.path==='/api/attendance').slice(-1)[0].body).updates.find(u=>u.pageId==='test-1');
  assert.deepEqual(impClear,{pageId:'test-1',updateProfile:{name:'',class:'',studentId:'',isForeign:false},markEmpty:true,clearProfile:true});
  await page.evaluate(()=>localStorage.setItem('white_mode','true'));
  await page.reload();await page.waitForFunction(()=>typeof state!=='undefined'&&!state.loading);
  assert.equal(await page.locator('.liquid-nav .nav-icon img').count(),0);
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
  assert.equal(await page.evaluate(()=>typeof THREE),'undefined','three.js is gone');
  console.log('Offline shell, versioned assets and particle-dissolve dependencies PASS');
  await browser.close();
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));try{if(process.env.TEST_OFFLINE)await offline();else await run(process.env.TEST_WEBKIT?webkit:chromium,process.env.TEST_DESKTOP?{width:1440,height:1000}:{width:390,height:844});}finally{server.close();}})().catch(e=>{console.error(e);process.exit(1);});
