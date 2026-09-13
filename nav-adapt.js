/* 導覽列自適應顯色 (像 iOS 26 Liquid Glass)：
   估算「膠囊後面實際看起來是什麼顏色」，字跟底對比不夠就自動切成亮底深字 / 暗底亮字。
   做法：導覽列上取幾個點 → elementsFromPoint 由上往下疊色 (背景色、<img> 取樣)，
   pointer-events:none 的全螢幕背景層 (#custom-video-bg / .home-anim-bg) 不會被 elementsFromPoint 撈到，另外補在最底下。
   圖片先縮成 48px 小圖快取，之後每次只查像素，成本 < 1ms。 */
(function(){
  const nav=document.querySelector('.bottom-nav');
  if(!nav)return;
  const IMG_CACHE=new Map(); // src → {data,w,h} | null (被 taint 或還沒載完)
  let tone='',pending=false,lastRun=0;

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

  // 由上往下疊，直到不透明；回傳這個點看起來的顏色
  function colorAt(x,y){
    const stack=document.elementsFromPoint(x,y).filter(el=>!nav.contains(el)&&el!==document.documentElement&&el!==document.body);
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

  function measure(){
    pending=false;lastRun=performance.now();
    if(document.hidden||getComputedStyle(nav).display==='none')return;
    const rect=nav.getBoundingClientRect();if(rect.width<120)return;
    // 膠囊左右中間 5 點 × 圖示/文字 2 排
    let L=0,n=0;
    for(const fx of [.12,.31,.5,.69,.88])for(const fy of [.35,.72]){
      const c=colorAt(rect.left+rect.width*fx,rect.top+rect.height*fy);
      L+=lum(c);n++;
    }
    L/=n;
    // 遲滯：切換門檻兩邊各留一段，背景剛好在中間時不會一直閃
    let next=tone;
    if(L>.42)next='light';else if(L<.24)next='dark';else if(!tone)next=L>.33?'light':'dark';
    nav.dataset.bgLum=L.toFixed(3);
    if(next!==tone){
      tone=next;
      nav.classList.toggle('nav-on-light',tone==='light');
      nav.classList.toggle('nav-on-dark',tone==='dark');
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
  // 背景照片淡入 (.8s)、離開首頁淡出 (.6s)：量到一半會偏暗，動畫/轉場結束時補量
  const bgLayer=e=>{const t=e.target;if(t.closest&&t.closest('#custom-video-bg,.home-anim-bg,.page'))schedule();};
  document.addEventListener('animationend',bgLayer,true);
  document.addEventListener('transitionend',bgLayer,true);
  nav.addEventListener('click',()=>setTimeout(schedule,450));
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  const bg=document.getElementById('custom-video-bg');
  if(bg)new MutationObserver(()=>{IMG_CACHE.clear();schedule();}).observe(bg,{childList:true,subtree:true,attributes:true,attributeFilter:['class','src']});
  // 保險：換頁、背景淡入等沒有事件的變化，每 1.5 秒補量一次 (背景分頁不跑)
  setInterval(()=>{if(!document.hidden)schedule();},1500);
  schedule();
  window.navAdapt={measure,get tone(){return tone;}};
})();
