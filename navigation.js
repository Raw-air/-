const _navOriginalIcons=new Map(Array.from(document.querySelectorAll('.nav-item'),item=>[item.dataset.page,item.querySelector('.nav-icon').innerHTML]));
// 用 canvas 畫一張圓角長條的位移貼圖 (R=左右偏移、G=上下偏移，128 = 不動)，包成 SVG feDisplacementMap
function buildLensRefraction(W,H,R){
  const id='lens-refract';
  if(document.getElementById(id))return id;
  try{
    const S=2,BAND=14,MAX=9; // 貼圖解析度倍數、折射帶寬度 px、邊緣最大偏移 px
    const cv=document.createElement('canvas');cv.width=W*S;cv.height=H*S;
    const ctx=cv.getContext('2d');const img=ctx.createImageData(cv.width,cv.height);const d=img.data;
    for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++){
      const px=(x+.5)/S-W/2,py=(y+.5)/S-H/2;
      const qx=Math.abs(px)-(W/2-R),qy=Math.abs(py)-(H/2-R);
      const ox=Math.max(qx,0),oy=Math.max(qy,0),ol=Math.hypot(ox,oy);
      const inside=-(ol+Math.min(Math.max(qx,qy),0)-R); // 離邊緣多遠 (px)
      let nx=0,ny=0;
      if(qx>0&&qy>0){nx=ox/ol;ny=oy/ol;}else if(qx>qy)nx=1;else ny=1;
      nx*=Math.sign(px)||1;ny*=Math.sign(py)||1;
      const t=Math.max(0,Math.min(1,1-inside/BAND)),k=t*t*MAX;
      const i=(y*cv.width+x)*4;
      d[i]=Math.round(255*(.5+nx*k/(2*MAX)));d[i+1]=Math.round(255*(.5+ny*k/(2*MAX)));d[i+2]=128;d[i+3]=255;
    }
    ctx.putImageData(img,0,0);
    const ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');
    svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');
    svg.style.cssText='position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.innerHTML=`<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feImage href="${cv.toDataURL()}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${2*MAX}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
    document.body.appendChild(svg);
    return id;
  }catch(_){return null;}
}
function setupNav(){
  const nav=document.querySelector('.bottom-nav');nav.classList.add('liquid-nav');
  nav.setAttribute('aria-label','主要導覽');
  const items=Array.from(nav.querySelectorAll('.nav-item'));
  for(const item of items)item.querySelector('.nav-icon').innerHTML=_navOriginalIcons.get(item.dataset.page);
  // --lens-x 註冊成真正的 <length>，膠囊光暈、鏡片、複本列、遮罩洞吃同一個數值 → 一條 transition 全部同步
  // liquid-nav.css 的 @property 已經註冊 --lens-x；這裡只做功能偵測，沒有 registerProperty 的舊瀏覽器退回逐元素 transition
  const propOK=typeof CSS!=='undefined'&&typeof CSS.registerProperty==='function';
  if(!propOK)nav.classList.add('no-prop');
  // 真實按鈕包成一列，遮罩才能在鏡片位置挖洞
  const rowReal=document.createElement('span');rowReal.className='nav-row';
  items.forEach(item=>rowReal.appendChild(item));nav.appendChild(rowReal);
  // 鏡片：外層只位移；lens-shape 做玻璃材質/拉伸/擠壓；lens-zoom 裡是放大的圖示複本 (跨瀏覽器折射)
  const lens=document.createElement('span');lens.className='liquid-lens';lens.setAttribute('aria-hidden','true');
  const shape=document.createElement('span');shape.className='lens-shape';
  const blur=document.createElement('span');blur.className='lens-blur';shape.appendChild(blur);
  const zoom=document.createElement('span');zoom.className='lens-zoom';
  const row=document.createElement('span');row.className='lens-row';
  const clones=items.map(item=>{
    const c=document.createElement('span');c.className='lens-item';c.dataset.page=item.dataset.page;
    c.innerHTML=`<span class="nav-icon">${_navOriginalIcons.get(item.dataset.page)}</span><span class="nav-label">${item.querySelector('.nav-label').textContent}</span>`;
    row.appendChild(c);return c;
  });
  // 折射濾鏡掛在不放大的外框上，貼圖座標才會剛好對齊鏡片邊緣 (掛在 lens-zoom 上會被 1.2 倍放大推出去)
  const bend=document.createElement('span');bend.className='lens-bend';
  zoom.appendChild(row);bend.appendChild(zoom);shape.appendChild(bend);
  // 保持乾淨、無色的液體玻璃；不再疊加青／洋紅色散複本，避免深色模式出現負片殘影。
  const rim=document.createElement('span');rim.className='lens-rim';shape.appendChild(rim);
  lens.appendChild(shape);nav.prepend(lens);
  // 省電模式也算「減少動態」→ 鏡片不做水滴拉長，直接定位
  const reduced=()=>(window.sfReduceMotion?window.sfReduceMotion():matchMedia('(prefers-reduced-motion: reduce)').matches);
  const LENS_W=84,PAD=8;
  // 邊緣折射：鏡片邊緣一圈往外取樣，外面的圖示被「彎進」邊緣；中間保持原樣。複本上的一般 filter，iOS Safari 也吃
  const refractId=buildLensRefraction(LENS_W,54,27);
  if(refractId)bend.style.filter=`url(#${refractId})`;
  let index=0,lastIndex=-1,travelTimer=0,retryTimer=0,w=0,slot=0,suppressClick=false;
  const pageIndex=()=>{
    const page=typeof navTabFor==='function'?navTabFor(currentPage):'home';
    return Math.max(0,items.findIndex(item=>item.dataset.page===page));
  };
  const xFor=i=>PAD+slot*(i+.5)-LENS_W/2;
  const lensX=()=>parseFloat(nav.style.getPropertyValue('--lens-x'))||xFor(index);
  const slotAt=x=>Math.max(0,Math.min(3,Math.floor((x+LENS_W/2-PAD)/slot)));
  function measure(){w=nav.clientWidth;slot=(w-16)/4;nav.style.setProperty('--nav-w',w+'px');}
  function mark(i){
    for(const [k,item] of items.entries()){
      item.classList.toggle('active',k===i);clones[k].classList.toggle('active',k===i);
      if(k===i)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
    }
  }
  function update(){
    measure();
    // 尚未完成排版 (分頁在背景、剛切回前景) 時量到的寬度不可信，稍後再算一次
    if(w<120){clearTimeout(retryTimer);retryTimer=setTimeout(update,120);return;}
    index=pageIndex();
    if(drag.active)return; // 拖曳中鏡片跟著手指，不被外部更新拉走
    nav.style.setProperty('--lens-x',xFor(index)+'px');
    mark(index);
    // 換分頁時鏡片像水滴一樣先拉長，抵達後彈回正圓
    if(lastIndex!==-1&&lastIndex!==index&&!reduced()){
      lens.classList.remove('is-travelling');void lens.offsetWidth;
      lens.classList.add('is-travelling');clearTimeout(travelTimer);
      travelTimer=setTimeout(()=>lens.classList.remove('is-travelling'),520);
    }
    lastIndex=index;
  }
  // ── 按住鏡片左右拖 (iOS 26 tab bar)：鏡片跟著手指、依速度拉長、跨過分頁震一下、放開吸到最近的分頁 ──
  const drag={active:false,moved:false,id:null,item:null,startX:0,startLens:0,lastX:0,lastT:0,v:0,hover:-1};
  const rubber=x=>{const min=PAD,max=w-PAD-LENS_W,over=22;
    if(x<min)return min-over*(1-Math.exp((x-min)/over));
    if(x>max)return max+over*(1-Math.exp(-(x-max)/over));return x;};
  function stretch(){
    const s=Math.min(.28,Math.abs(drag.v)/2600);
    nav.style.setProperty('--lens-sx',(1+s).toFixed(3));nav.style.setProperty('--lens-sy',(1-s*.55).toFixed(3));
  }
  nav.addEventListener('pointerdown',e=>{
    const pressed=e.target.closest('.nav-item');
    if(e.button!==0||drag.active||!pressed)return;
    measure();if(w<120)return;
    Object.assign(drag,{active:true,moved:false,id:e.pointerId,item:pressed,startX:e.clientX,lastX:e.clientX,lastT:performance.now(),v:0,hover:index,startLens:lensX()});
    // 先不抓 pointer capture：一抓住，瀏覽器就會把 click 改派給 nav，.nav-item 收不到點擊。
    // 等真的拖了才抓 (見 pointermove)，單純點一下維持原生 click 流程。
    nav.classList.add('is-pressing');
  });
  // 移動/放開掛在 document 上：不靠 pointer capture 也一定收得到，
  // 手指或滑鼠滑出導覽列、或瀏覽器把事件改派到別的元素時都還能追。
  document.addEventListener('pointermove',e=>{
    if(!drag.active||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.startX;
    if(!drag.moved){if(Math.abs(dx)<4)return;drag.moved=true;
      try{nav.setPointerCapture(e.pointerId);}catch(_){}
      nav.classList.add('is-dragging');lens.classList.remove('is-travelling');}
    const now=performance.now(),dt=now-drag.lastT;
    if(dt>0)drag.v=.7*((e.clientX-drag.lastX)/dt*1000)+.3*drag.v;
    drag.lastX=e.clientX;drag.lastT=now;
    const x=rubber(drag.startLens+dx);
    nav.style.setProperty('--lens-x',x+'px');stretch();
    const h=slotAt(x);
    if(h!==drag.hover){drag.hover=h;haptic('light');mark(h);}
  });
  function release(e,cancelled){
    if(!drag.active||e.pointerId!==drag.id)return;
    drag.active=false;
    nav.classList.remove('is-pressing','is-dragging');
    nav.style.removeProperty('--lens-sx');nav.style.removeProperty('--lens-sy');
    try{nav.releasePointerCapture(e.pointerId);}catch(_){}
    const hit=drag.item;drag.item=null;
    if(!drag.moved){
      // 沒拖動 → 沒抓過 capture，原生 click 會正常送到 .nav-item。
      // 但少數瀏覽器 (含被 capture 影響時) 不送 click，這裡補一個保險。
      if(!cancelled&&hit)setTimeout(()=>{if(currentPage!==hit.dataset.page&&navTabFor(currentPage)!==hit.dataset.page){navigateTo(hit.dataset.page);update();}},0);
      return;
    }
    suppressClick=true;setTimeout(()=>suppressClick=false,0);
    const target=cancelled?index:slotAt(lensX());
    if(target!==index)navigateTo(items[target].dataset.page); // 會廣播 app:navigate → update()
    update(); // 已離開拖曳狀態，transition 恢復 → 彈簧吸附
  }
  document.addEventListener('pointerup',e=>release(e,false));
  document.addEventListener('pointercancel',e=>release(e,true));
  nav.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  items.forEach(item=>item.addEventListener('click',()=>{navigateTo(item.dataset.page);update();}));
  nav.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();let i=items.indexOf(document.activeElement);
    i=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4;
    items[i].focus();items[i].click();
  });
  window.addEventListener('app:navigate',update);
  window.addEventListener('resize',update);
  window.addEventListener('load',update);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  new ResizeObserver(update).observe(nav);
  update();requestAnimationFrame(update);
}
