/* 自適應顯色 (像 iOS 26 Liquid Glass)：
   估算「元件後面實際看起來是什麼顏色」，後面亮就用深字、後面暗就用亮字。
   套用對象：底部導覽列 + 首頁上方的標題/副標/日期/區塊標籤/漢堡鈕/更新公告鈕 (TARGETS)。
   做法：元件上取幾個點 → elementsFromPoint 由上往下疊色 (背景色、<img> 取樣)，元件自己跟子元素跳過；
   pointer-events:none 的全螢幕背景層 (#custom-video-bg / .home-anim-bg) 不會被 elementsFromPoint 撈到，另外補在最底下。
   圖片先縮成 48px 小圖快取，之後每次只查像素。畫面外、沒顯示的元件不量。 */
(function(){
  // hi/lo：亮度高於 hi 換深字、低於 lo 換亮字，中間維持原狀 (遲滯，背景剛好在門檻附近時不會一直閃)
  // 導覽列是會壓暗背景的玻璃，門檻比較高；純文字的黑白字對比交叉點約在亮度 .18
  const TARGETS=[
    {sel:'.bottom-nav',on:'nav-on',hi:.42,lo:.24,xs:[.12,.31,.5,.69,.88],ys:[.35,.72]},
    {sel:'#page-home .home-title,#page-home .home-sub,#page-home .home-date,.section-label',on:'bg-on',hi:.24,lo:.14,xs:[.15,.5,.85],ys:[.3,.7]},
    {sel:'#qm-toggle,.changelog-btn',on:'bg-on',hi:.3,lo:.18,xs:[.2,.5,.8],ys:[.3,.7]},
  ];
  const IMG_CACHE=new Map(); // src → {data,w,h} | null (被 taint)
  const TONE=new WeakMap();
  let pending=false,lastRun=0;

  const parseColor=s=>{
    const m=/rgba?\(([^)]+)\)/.exec(s||'');if(!m)return null;
    const p=m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};
  };
  const lin=c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4);};
  const lum=c=>.2126*lin(c.r)+.7152*lin(c.g)+.0722*lin(c.b);

  function imgPixel(img,x,y){
    const src=img.currentSrc||img.src;if(!src)return null;
    if(!img.complete||!img.naturalWidth){img.addEventListener('load',schedule,{once:true});return null;}
    let e=IMG_CACHE.get(src);
    if(e===undefined){
      try{
        const w=48,h=Math.max(1,Math.round(48*img.naturalHeight/img.naturalWidth));
        const cv=document.createElement('canvas');cv.width=w;cv.height=h;
        const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(img,0,0,w,h);
        e={data:cx.getImageData(0,0,w,h).data,w,h};
        // 剛換 src 時 complete 可能已是 true 但還沒解碼完，畫出來全透明：不要快取，稍後重量
        let seen=false;for(let i=3;i<e.data.length;i+=16)if(e.data[i]){seen=true;break;}
        if(!seen){setTimeout(schedule,200);return null;}
      }catch(_){e=null;}
      if(IMG_CACHE.size>12)IMG_CACHE.clear();
      IMG_CACHE.set(src,e);
    }
    if(!e)return null;
    const r=img.getBoundingClientRect();if(!r.width||!r.height)return null;
    const fit=getComputedStyle(img).objectFit;
    const iw=img.naturalWidth,ih=img.naturalHeight;
    let sx=r.width/iw,sy=r.height/ih;
    if(fit==='cover')sx=sy=Math.max(sx,sy);else if(fit==='contain')sx=sy=Math.min(sx,sy);
    const dw=iw*sx,dh=ih*sy;
    const u=(x-r.left-(r.width-dw)/2)/dw,v=(y-r.top-(r.height-dh)/2)/dh;
    if(u<0||u>1||v<0||v>1)return null;
    const i=(Math.min(e.h-1,Math.floor(v*e.h))*e.w+Math.min(e.w-1,Math.floor(u*e.w)))*4;
    return {r:e.data[i],g:e.data[i+1],b:e.data[i+2],a:e.data[i+3]/255};
  }

  function layerColor(el,x,y){
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none')return null;
    let op=parseFloat(cs.opacity);if(!(op>0))return null;
    if(el.tagName==='IMG'){const p=imgPixel(el,x,y);if(p){p.a*=op;return p;}}
    const c=parseColor(cs.backgroundColor);
    if(c&&c.a>0){c.a*=op;return c;}
    return null;
  }

  // 由上往下疊 (跳過 self 自己)，直到不透明；回傳這個點看起來的顏色
  function colorAt(self,x,y){
    const stack=document.elementsFromPoint(x,y).filter(el=>!self.contains(el)&&el!==document.documentElement&&el!==document.body);
    for(const sel of ['#custom-video-bg img','#custom-video-bg','.home-anim-bg']){
      const el=document.querySelector(sel);
      if(el&&!stack.includes(el)&&!el.classList.contains('hidden-bg')&&!(el.parentElement&&el.parentElement.classList.contains('hidden-bg')))stack.push(el);
    }
    stack.push(document.body,document.documentElement);
    let r=0,g=0,b=0,left=1;
    for(const el of stack){
      const c=layerColor(el,x,y);if(!c)continue;
      const a=Math.min(1,c.a)*left;
      r+=c.r*a;g+=c.g*a;b+=c.b*a;left-=a;
      if(left<.02)break;
    }
    if(left>0){const base=document.body.classList.contains('light-mode')?242:21;r+=base*left;g+=base*left;b+=base*left;}
    return {r,g,b,a:1};
  }

  function measureEl(el,t){
    const rect=el.getBoundingClientRect();
    if(rect.width<8||rect.height<8||rect.bottom<0||rect.top>innerHeight||rect.right<0||rect.left>innerWidth)return;
    if(t.sel==='.bottom-nav'&&rect.width<120)return; // 導覽列還沒排版
    // 文字元件只量字實際佔的寬度 (標題/標籤是整行寬的區塊，字只在中間或左邊)
    let L0=rect.left,W=rect.width;
    if(el.matches('.home-title,.home-sub,.section-label')){
      const rg=document.createRange();rg.selectNodeContents(el);const tr=rg.getBoundingClientRect();
      if(tr.width>4){L0=tr.left;W=tr.width;}
    }
    let L=0,n=0;
    for(const fx of t.xs)for(const fy of t.ys){
      const x=Math.min(innerWidth-1,Math.max(0,L0+W*fx)),y=Math.min(innerHeight-1,Math.max(0,rect.top+rect.height*fy));
      L+=lum(colorAt(el,x,y));n++;
    }
    L/=n;
    const tone=TONE.get(el)||'';
    let next=tone;
    if(L>t.hi)next='light';else if(L<t.lo)next='dark';else if(!tone)next=L>(t.hi+t.lo)/2?'light':'dark';
    el.dataset.bgLum=L.toFixed(3);
    if(next!==tone){
      TONE.set(el,next);
      el.classList.toggle(t.on+'-light',next==='light');
      el.classList.toggle(t.on+'-dark',next==='dark');
    }
  }

  function measure(){
    pending=false;lastRun=performance.now();
    if(document.hidden)return;
    for(const t of TARGETS)for(const el of document.querySelectorAll(t.sel)){
      if(!el.offsetParent&&getComputedStyle(el).position!=='fixed')continue; // 不在目前頁面
      measureEl(el,t);
    }
  }
  function schedule(){
    if(pending)return;pending=true;
    const wait=Math.max(0,120-(performance.now()-lastRun));
    setTimeout(()=>requestAnimationFrame(measure),wait);
  }

  addEventListener('scroll',schedule,{passive:true,capture:true});
  addEventListener('resize',schedule);
  document.addEventListener('load',e=>{if(e.target.tagName==='IMG')schedule();},true);
  document.addEventListener('visibilitychange',schedule);
  // 背景照片淡入 (.8s)、首頁進場 (.3s)：量到一半會偏暗，動畫/轉場結束時補量。
  // 這效果只有首頁用得到，改成只掛在首頁本身跟它的背景層上 (原本掛 document 捕捉會攔到全站每個轉場)，並節流 200ms。
  const pageHomeEl=document.getElementById('page-home');
  const bg=document.getElementById('custom-video-bg');
  const animBg=document.querySelector('.home-anim-bg');
  let bgLayerAt=0;
  const bgLayer=()=>{const now=performance.now();if(now-bgLayerAt<200)return;bgLayerAt=now;schedule();};
  for(const el of [pageHomeEl,bg,animBg]){
    if(!el)continue;
    el.addEventListener('animationend',bgLayer);
    el.addEventListener('transitionend',bgLayer);
  }
  const nav=document.querySelector('.bottom-nav');
  if(nav)nav.addEventListener('click',()=>setTimeout(schedule,450));
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  if(bg)new MutationObserver(()=>{IMG_CACHE.clear();schedule();}).observe(bg,{childList:true,subtree:true,attributes:true,attributeFilter:['class','src']});
  // 保險：換頁、背景淡入等沒有事件的變化，補量一次；這效果只有首頁用得到，只在首頁且畫面可見時才排程，
  // 離開首頁或切到背景就 clearInterval，避免在其他頁面白跑
  let resampleTimer=0;
  const isHomeActive=()=>!!pageHomeEl&&pageHomeEl.classList.contains('active');
  function syncResample(){
    if(isHomeActive()&&!document.hidden){
      if(!resampleTimer)resampleTimer=setInterval(schedule,4000);
    }else if(resampleTimer){
      clearInterval(resampleTimer);resampleTimer=0;
    }
  }
  window.addEventListener('app:navigate',syncResample);
  document.addEventListener('visibilitychange',syncResample);
  syncResample();
  schedule();
  window.navAdapt={measure,toneOf:el=>TONE.get(el)||'',get tone(){return nav?TONE.get(nav)||'':'';}};
})();
