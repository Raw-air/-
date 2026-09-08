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
  try {
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

  await page.evaluate(()=>{navigateTo('student-files');initStudentFiles();});
  await page.waitForFunction(()=>sfCarousel?.state==='idle');
  await page.waitForTimeout(200);
  await page.locator('#sf-scene').screenshot({path:path.join(out,engine.name()+'-archive-'+viewport.width+'.png')});
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),0);
  const selectedCentre=await page.locator('.sf-folder.active').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,w:innerWidth};});
  assert.ok(Math.abs(selectedCentre.x-selectedCentre.w/2)<selectedCentre.w*.04,'selected folder is visually centred: '+JSON.stringify(selectedCentre));
  const railBefore = await page.evaluate(()=>Array.from(document.querySelectorAll('.sf-folder')).filter(e=>!e.classList.contains('sf-far')&&!e.classList.contains('active')).map(e=>({index:e.dataset.index,x:new DOMMatrixReadOnly(getComputedStyle(e).transform).m41})));
  await page.locator('.sf-selection').click();
  await page.waitForFunction(()=>{
    const left=document.querySelector('.sf-folder[data-index="-1"]');
    return document.querySelector('.sf-folder.active.is-open') && left && new DOMMatrixReadOnly(getComputedStyle(left).transform).m41 < -400;
  });
  const railDeparting = await page.evaluate(()=>Array.from(document.querySelectorAll('.sf-folder')).map(e=>({index:e.dataset.index,x:new DOMMatrixReadOnly(getComputedStyle(e).transform).m41})));
  assert.ok(railBefore.some(b=>+b.index<0 && railDeparting.find(a=>a.index===b.index).x<b.x-30),'left folders travel left');
  assert.ok(railBefore.some(b=>+b.index>0 && railDeparting.find(a=>a.index===b.index).x>b.x+30),'right folders travel right');

  await page.waitForFunction(()=>parseFloat(document.querySelector('.sf-folder.active')?.style.getPropertyValue('--fd-sheet-y')) < -160);
  await page.waitForTimeout(300);
  await page.locator('#sf-scene').screenshot({path:path.join(out,engine.name()+'-editor-'+viewport.width+'.png')});
  const liftedY=await page.locator('.sf-folder.active').evaluate(e=>parseFloat(e.style.getPropertyValue('--fd-sheet-y')));
  assert.ok(liftedY < -100,'paper is pulled upward after the folders depart');
  await page.locator('.sf-folder.active .sf-input-name').fill('測試草稿');
  await page.locator('.sf-folder.active .sf-close-btn').click();
  await page.waitForTimeout(750);
  await page.locator('[aria-label="下一份檔案"]').click();
  await page.waitForFunction(()=>sfCarousel.state==='idle');
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),0);
  await page.locator('#sf-search-input').fill('no-such-synthetic-student');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.sf-folder').count(),0);
  assert.equal(await page.locator('.sf-selection').isVisible(),false);
  await page.locator('#sf-search-input').fill('');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#sf-result-count').innerText(),'90 份檔案');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#sf-card-area').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sf-folder.active.is-open').count(),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  const darkGeometry=await page.locator('.sf-folder.active').evaluate(e=>e.style.transform);
  const darkMaterial=await page.locator('.sf-folder.active .fd-front').evaluate(e=>getComputedStyle(e).backgroundImage);
  await page.evaluate(()=>{document.activeElement?.blur();document.body.classList.add('light-mode');sfCarousel.paint();});
  assert.equal(await page.locator('.sf-folder.active').evaluate(e=>e.style.transform),darkGeometry,'themes preserve the same file geometry');
  assert.notEqual(await page.locator('.sf-folder.active .fd-front').evaluate(e=>getComputedStyle(e).backgroundImage),darkMaterial,'light mode uses its own material lighting');
  await page.locator('#sf-scene').screenshot({path:path.join(out,engine.name()+'-archive-light-'+viewport.width+'.png')});
  await page.locator('.sf-selection').click();
  await page.waitForTimeout(1050);
  await page.locator('#sf-scene').screenshot({path:path.join(out,engine.name()+'-editor-light-'+viewport.width+'.png')});
  // A close interrupted by reopening must settle into one visible, usable sheet.
  await page.evaluate(()=>sfCarousel.dismiss());
  await page.waitForTimeout(150);
  await page.evaluate(()=>sfCarousel.openSheet());
  await page.waitForTimeout(1050);
  assert.equal(await page.locator('.sf-folder.is-open').count(),1);
  await page.locator('.sf-folder.active .sf-input-name').fill('中斷後仍可編輯');
  await page.evaluate(()=>{navigateTo('tools');});
  assert.equal(await page.locator('.sf-folder.is-open').count(),0);
  assert.deepEqual(errors,[]);
  console.log(engine.name()+' '+viewport.width+': archive, editor, empty search, keyboard and reduced motion PASS');
  } finally { await browser.close(); }
}
server.listen(0,'127.0.0.1',async()=>{try {await run(chromium,{width:1280,height:900});await run(webkit,{width:375,height:844});await run(webkit,{width:844,height:375});}catch(e){console.error(e);process.exitCode=1;}finally{server.close();}});

