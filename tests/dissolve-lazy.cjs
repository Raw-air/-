// 刪除動畫 (dissolve.js) 延遲建立 WebGL 與 context 遺失備援：
//   A. 首頁載入 (不navigate、不觸發刪除) 不應該建立任何 WebGL context / canvas
//   B. 使用者第一次真正播放刪除動畫時 (run() 內部呼叫 init())，WebGL 才建立，動畫仍然正常播放
//   C. 播放中途 WebGL context 遺失 (webglcontextlost)：不能拋錯、不能開天窗 (canvas 一直都在、資料夾與粒子照常消失)，
//      自動換成 Canvas 2D 備援繼續畫完
//   D. 進到學生檔案頁背景空檔預先建好 WebGL 後，閒置時 (還沒按刪除) 就先遺失 context，之後才按刪除，
//      一樣不拋錯、一樣正常播完 (從第一幀就直接走 Canvas 2D 備援)
// 全部離線跑 (page.route 攔截所有 API)，不連正式後端。
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

const mkRoster=n=>Array.from({length:n},(_,i)=>({
  id:'dl-'+i,name:'延遲住宿生 '+i,studentId:'DL'+i,class:'延遲班',squad:'一單',
  room:String(101+Math.floor(i/4)*2),bed:String(i%4+1),attendance:{},remarks:'',isForeign:false,isEmpty:false
}));

// 監看 canvas.getContext('webgl',…)：計數呼叫次數，並回傳一個假的 WebGL context (renderer 字串刻意避開
// SwiftShader/llvmpipe 偵測，讓 dissolve.js 走真正的 WebGL 分支，這樣才能真的觸發 context lost/restored 流程；
// 所有方法都是無害的 no-op，只要不拋例外、shader/program 判斷回傳成功即可，不需要真的畫出東西。
const GL_MOCK_INIT_SCRIPT=`(() => {
  window.__glCalls = 0;
  const orig = HTMLCanvasElement.prototype.getContext;
  const ctxMap = new WeakMap();
  const noop = () => {};
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    if (type === 'webgl' || type === 'experimental-webgl') {
      window.__glCalls++;
      if (ctxMap.has(this)) return ctxMap.get(this);
      const mock = {
        ARRAY_BUFFER:1, FRAMEBUFFER:2, TEXTURE_2D:3, TEXTURE_MIN_FILTER:4, TEXTURE_MAG_FILTER:5,
        TEXTURE_WRAP_S:6, TEXTURE_WRAP_T:7, CLAMP_TO_EDGE:8, LINEAR:9, RGBA:10, UNSIGNED_BYTE:11,
        COLOR_ATTACHMENT0:12, FRAMEBUFFER_COMPLETE:13, DYNAMIC_DRAW:14, STATIC_DRAW:15, FLOAT:16,
        POINTS:17, TRIANGLES:18, TRIANGLE_STRIP:19, BLEND:20, ONE:21, ONE_MINUS_SRC_ALPHA:22,
        VERTEX_SHADER:23, FRAGMENT_SHADER:24, COMPILE_STATUS:25, LINK_STATUS:26,
        UNPACK_PREMULTIPLY_ALPHA_WEBGL:27, RENDERER:28,
        createShader:()=>({}), shaderSource:noop, compileShader:noop, getShaderParameter:()=>true,
        getShaderInfoLog:()=>'', deleteShader:noop,
        createProgram:()=>({}), attachShader:noop, linkProgram:noop, getProgramParameter:()=>true,
        createBuffer:()=>({}), bindBuffer:noop, bufferData:noop, bufferSubData:noop,
        createTexture:()=>({}), bindTexture:noop, texParameteri:noop, texImage2D:noop,
        createFramebuffer:()=>({}), bindFramebuffer:noop, framebufferTexture2D:noop,
        checkFramebufferStatus:()=>13,
        getAttribLocation:()=>0, getUniformLocation:()=>({}),
        viewport:noop, blendFunc:noop, enable:noop, disable:noop, clearColor:noop, clear:noop,
        useProgram:noop, activeTexture:noop, vertexAttribPointer:noop,
        enableVertexAttribArray:noop, disableVertexAttribArray:noop, drawArrays:noop,
        pixelStorei:noop, readPixels:noop,
        uniform1f:noop, uniform1i:noop, uniform2f:noop, uniform4f:noop,
        isContextLost:()=>false,
        getExtension:(name)=>{
          if (name === 'WEBGL_debug_renderer_info') return {UNMASKED_RENDERER_WEBGL:999};
          if (name === 'WEBGL_lose_context') return {loseContext:noop};
          return null;
        },
        getParameter:(p)=> (p===999||p===28) ? 'Mock GPU (headless test)' : 0
      };
      ctxMap.set(this, mock);
      return mock;
    }
    return orig.call(this, type, opts);
  };
})();`;

async function withPage(fn){
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(GL_MOCK_INIT_SCRIPT);
    const students=mkRoster(8);
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='dissolve-lazy.test'){
        const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
        return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
      }
      if(u.pathname==='/api/roster')return route.fulfill({json:{students,dateColumns:[]}});
      if(u.pathname==='/api/config')return route.fulfill({json:{total_beds:'8'}});
      if(u.pathname==='/api/poll')return route.fulfill({json:{ts:0,att_ts:0}});
      if(u.pathname==='/api/ping')return route.fulfill({json:{ok:true}});
      if(u.pathname.includes('marked'))return route.fulfill({body:'window.marked={parse:s=>s};',contentType:'application/javascript'});
      return route.fulfill({json:{}});
    });
    await page.goto('https://dissolve-lazy.test/');
    await page.waitForFunction(()=>typeof state!=='undefined'&&!state.loading);
    await fn(page,errors);
    assert.deepEqual(errors,[],'頁面不應該有任何未捕捉例外: '+JSON.stringify(errors));
  }finally{
    await browser.close();
  }
}

// 進到學生檔案頁、展開名冊、打開第一本的詳細資料紙 (broom 按鈕在紙打開時才會渲染)，回傳 gl 呼叫次數快照的小工具
async function enterStudentFiles(page){
  await page.evaluate(()=>{navigateTo('student-files');_sfResults=state.students;renderStudentFileCards();});
  await page.waitForFunction(()=>window.sfCarousel&&sfCarousel.state==='idle',null,{timeout:5000});
  await page.waitForTimeout(300);
  await page.evaluate(()=>{window._sfStopMotion();sfCarousel.openSheet();});
  await page.waitForTimeout(400);
}

(async()=>{
  // ── A + B + C：同一頁依序測 (A 一定要在 navigate 之前做，才是真的「首頁載入」快照) ──────────
  await withPage(async(page,errors)=>{
    const boot=await page.evaluate(()=>({calls:window.__glCalls,canvases:document.querySelectorAll('.sf-dissolve-canvas').length}));
    assert.equal(boot.calls,0,'A: 首頁載入不應該呼叫 canvas.getContext(\'webgl\')');
    assert.equal(boot.canvases,0,'A: 首頁載入不應該建立 .sf-dissolve-canvas');

    await enterStudentFiles(page);

    // B: 觸發刪除 → run() 內部呼叫 init()，第一次真正建立 WebGL (或稍早的背景空檔已經建好)，動畫要正常播放
    await page.evaluate(()=>{window.__delT0=performance.now();window.__bhDone=false;
      clearStudentData(document.querySelector('.sf-folder.active .sf-broom-btn')).then(()=>window.__bhDone=true);});
    await page.waitForSelector('.sf-dissolve-canvas.is-running',{timeout:400});
    const afterClick=await page.evaluate(()=>({calls:window.__glCalls,canvases:document.querySelectorAll('.sf-dissolve-canvas').length}));
    assert.ok(afterClick.calls>=1,'B: 觸發刪除後 (至多加上稍早的背景暖機) 應該已經呼叫過 getContext(\'webgl\')');
    assert.equal(afterClick.canvases,1,'B: 這時候應該只有一顆 dissolve canvas');
    await page.waitForFunction(()=>window.__bhDone,{timeout:5000});
    const dustB=await page.evaluate(()=>({...sfDissolve.stats,webgl:sfDissolve.webgl}));
    assert.ok(dustB.masked,'B: 資料夾跟著粒子一起消失');
    assert.ok(dustB.spawned>100,'B: 有畫出一大片粉塵，不是零星幾顆: '+JSON.stringify(dustB));
    assert.equal(dustB.webgl,true,'B: 這次全程走 WebGL (mock 不是 SwiftShader，不會被偵測成軟體算圖)');

    // C: 重新打開紙 (刪除後會自動打開)，再刪一次；這次動畫跑到一半就讓 WebGL context 遺失
    await page.evaluate(()=>{window._sfStopMotion();sfCarousel.openSheet();});
    await page.waitForTimeout(300);
    await page.evaluate(()=>{window.__delT0=performance.now();window.__bhDone2=false;
      clearStudentData(document.querySelector('.sf-folder.active .sf-broom-btn')).then(()=>window.__bhDone2=true);});
    await page.waitForSelector('.sf-dissolve-canvas.is-running',{timeout:400});
    await page.evaluate(()=>{
      document.querySelector('.sf-dissolve-canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
    });
    await page.waitForTimeout(100);   // 給下一個 requestAnimationFrame 時間換成 Canvas 2D 備援
    const mid=await page.evaluate(()=>({
      webgl:sfDissolve.webgl,
      running:document.querySelectorAll('.sf-dissolve-canvas.is-running').length,
      total:document.querySelectorAll('.sf-dissolve-canvas').length
    }));
    assert.equal(mid.webgl,false,'C: context 遺失後應該換成 Canvas 2D 備援 (sfDissolve.webgl 變 false)');
    assert.equal(mid.running,1,'C: 不能開天窗：這時候還是有一顆執行中的 canvas');
    assert.equal(mid.total,1,'C: 換 canvas 之後畫面上只留一顆 (舊的已經移除)');
    await page.waitForFunction(()=>window.__bhDone2,{timeout:5000});
    const dustC=await page.evaluate(()=>({...sfDissolve.stats,webgl:sfDissolve.webgl}));
    assert.ok(dustC.masked,'C: 即使中途換備援，資料夾還是跟著粒子一起消失');
    assert.ok(dustC.spawned>50,'C: Canvas 2D 備援仍然畫出粉塵，不是空白: '+JSON.stringify(dustC));
    assert.equal(await page.locator('.sf-dissolve-canvas.is-running').count(),0,'C: 動畫結束後執行中的 class 要拿掉');
  });
  console.log('dissolve-lazy A+B+C: no WebGL at boot, lazy-create on first delete, seamless Canvas-2D fallback on context loss PASS');

  // ── D：背景空檔已經預先建好 WebGL，但使用者還沒按刪除時就先遺失 context，之後才按刪除 ──────────
  await withPage(async(page,errors)=>{
    await enterStudentFiles(page);
    // 給 requestIdleCallback (timeout 300ms) 足夠時間把 WebGL 背景建好
    await page.waitForFunction(()=>window.__glCalls>=1,{timeout:3000});
    const warmed=await page.evaluate(()=>({calls:window.__glCalls,canvases:document.querySelectorAll('.sf-dissolve-canvas').length,running:sfDissolve.running}));
    assert.ok(warmed.calls>=1,'D: 進到學生檔案頁背景空檔應該已經建好 WebGL');
    assert.equal(warmed.canvases,1);
    assert.equal(warmed.running,false,'D: 只是建好，還沒有動畫在跑');
    // 閒置時 context 就先遺失 (例如分頁太久被系統收回)
    await page.evaluate(()=>{
      document.querySelector('.sf-dissolve-canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
    });
    await page.waitForTimeout(50);
    // 這才按刪除：應該從第一幀就直接走 Canvas 2D 備援，不會有任何一幀試著用已經失效的 WebGL
    await page.evaluate(()=>{window.__delT0=performance.now();window.__bhDone3=false;
      clearStudentData(document.querySelector('.sf-folder.active .sf-broom-btn')).then(()=>window.__bhDone3=true);});
    await page.waitForSelector('.sf-dissolve-canvas.is-running',{timeout:400});
    const started=await page.evaluate(()=>({webgl:sfDissolve.webgl,running:document.querySelectorAll('.sf-dissolve-canvas.is-running').length}));
    assert.equal(started.webgl,false,'D: 閒置時遺失的 context 到了要畫的那一刻應該已經在用 Canvas 2D 備援');
    assert.equal(started.running,1,'D: 不能開天窗：一開始就有一顆執行中的 canvas');
    await page.waitForFunction(()=>window.__bhDone3,{timeout:5000});
    const dustD=await page.evaluate(()=>({...sfDissolve.stats}));
    assert.ok(dustD.masked,'D: 閒置時遺失 context，之後刪除照常讓資料夾消失');
    assert.ok(dustD.spawned>50,'D: 照常畫出粉塵，不是空白: '+JSON.stringify(dustD));
  });
  console.log('dissolve-lazy D: context lost while idle (before first delete) still replays without error or gap PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
