// Additional regression coverage uses synthetic data and blocks all external writes.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const roster=Array.from({length:32},(_,i)=>({id:'synthetic-'+i,name:'測試住宿生 '+i,room:String(101+Math.floor(i/4)),bed:String(i%4+1),class:'測試班',studentId:'SYN'+i,isEmpty:false}));
(async()=>{
  const browser=await chromium.launch();
  try {
    for(const viewport of [{width:375,height:667},{width:844,height:390},{width:1440,height:1000}]) {
      const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'});
      await context.route('**/*',route=>{
        const u=new URL(route.request().url());
        if(u.hostname==='archive.test') {
          const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
          return file.startsWith(root+path.sep)&&fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
        }
        if(u.pathname==='/api/roster')return route.fulfill({json:{students:roster,dateColumns:[]}});
        return route.fulfill({json:{}});
      });
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://archive.test/');
      await page.waitForFunction(()=>typeof state!=='undefined'&&!state.loading);
      await page.evaluate(()=>{navigateTo('student-files');initStudentFiles();});
      await page.waitForFunction(()=>window.sfCarousel?.state==='idle');
      await page.locator('#sf-card-area').waitFor({state:'visible'});
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(()=>_sfResults.length),32,'default archive includes the entire roster');
      assert.equal(await page.locator('#sf-inspector').isVisible(),false);
      assert.equal(await page.locator('.sf-folder input').count(),0);
      await page.evaluate(()=>sfCarousel.settle(-20));
      assert.equal(await page.evaluate(()=>_sfActiveIndex),0,'finite archive stops at first folder');
      await page.locator('#sf-card-area').focus();await page.keyboard.press('Enter');
      await page.locator('#sf-inspector').waitFor({state:'visible'});
      assert.ok(await page.locator('#sf-inspector').evaluate(e=>!e.closest('#sf-scene')),'inspector has no perspective ancestor');
      await page.locator('#sf-edit-name').fill('草稿未儲存');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#sf-inspector').isVisible(),false);
      await page.evaluate(()=>onStudentFileSearch('SYN31'));
      await page.waitForFunction(()=>_sfResults.length===1);
      assert.equal(await page.locator('.sf-folder:not(.sf-far)').count(),1,'a single search result is not duplicated around the rail');
      await page.evaluate(()=>onStudentFileSearch('no-match-xyz'));
      await page.waitForFunction(()=>_sfResults.length===0);
      assert.equal(await page.locator('.sf-folder').count(),0);
      await page.evaluate(()=>onStudentFileSearch(''));
      await page.evaluate(()=>sfCarousel.openSheet());
      await page.locator('#sf-inspector').waitFor({state:'visible'});
      assert.equal(await page.locator('#sf-edit-name').inputValue(),'草稿未儲存','search preserves drafts');
      const editor=await page.locator('#sf-inspector').boundingBox();
      assert.ok(editor.x>=0 && editor.x+editor.width<=viewport.width+1);
      assert.ok(editor.y>=0 && editor.y+editor.height<=viewport.height-75,'inspector clears the navigation');
      await page.evaluate(()=>{sfCarousel.closeSheet(true);document.body.classList.add('light-mode');});
      await page.waitForTimeout(3000);
      await page.screenshot({path:path.join(root,'test-results',`archive-${viewport.width}-light.png`)});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'rail does not cause horizontal page scrolling');
      assert.deepEqual(errors,[]);
      console.log(`${viewport.width}x${viewport.height}: full roster, finite rail, keyboard inspector, draft/search, light theme and reduced motion PASS`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
