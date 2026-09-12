const _navOriginalIcons=new Map(Array.from(document.querySelectorAll('.nav-item'),item=>[item.dataset.page,item.querySelector('.nav-icon').innerHTML]));
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
  zoom.appendChild(row);shape.appendChild(zoom);
  // 玻璃厚邊的色散：同一列圖示再各做一份青色與洋紅複本，往左右微偏，只在鏡片邊緣露出來
  const fringe=document.createElement('span');fringe.className='lens-fringe';
  for(const tint of ['c','m']){
    const z=document.createElement('span');z.className='lens-zoom lens-zoom-'+tint;
    const r=document.createElement('span');r.className='lens-row';
    for(const item of items){
      const c=document.createElement('span');c.className='lens-item';
      c.innerHTML=`<span class="nav-icon">${_navOriginalIcons.get(item.dataset.page)}</span><span class="nav-label">${item.querySelector('.nav-label').textContent}</span>`;
      r.appendChild(c);
    }
    z.appendChild(r);fringe.appendChild(z);
  }
  shape.appendChild(fringe);
  const rim=document.createElement('span');rim.className='lens-rim';shape.appendChild(rim);
  lens.appendChild(shape);nav.prepend(lens);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const LENS_W=84,PAD=8;
  let index=0,lastIndex=-1,travelTimer=0,retryTimer=0,w=0,slot=0,suppressClick=false;
  const pageIndex=()=>{
    const page=['home','summary','history','settings'].includes(currentPage)?currentPage:currentPage==='rollcall'?'home':'settings';
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
    if(lastIndex!==-1&&lastIndex!==index&&!reduced.matches){
      lens.classList.remove('is-travelling');void lens.offsetWidth;
      lens.classList.add('is-travelling');clearTimeout(travelTimer);
      travelTimer=setTimeout(()=>lens.classList.remove('is-travelling'),520);
    }
    lastIndex=index;
  }
  // ── 按住鏡片左右拖 (iOS 26 tab bar)：鏡片跟著手指、依速度拉長、跨過分頁震一下、放開吸到最近的分頁 ──
  const drag={active:false,moved:false,id:null,startX:0,startLens:0,lastX:0,lastT:0,v:0,hover:-1};
  const rubber=x=>{const min=PAD,max=w-PAD-LENS_W,over=22;
    if(x<min)return min-over*(1-Math.exp((x-min)/over));
    if(x>max)return max+over*(1-Math.exp(-(x-max)/over));return x;};
  function stretch(){
    const s=Math.min(.28,Math.abs(drag.v)/2600);
    nav.style.setProperty('--lens-sx',(1+s).toFixed(3));nav.style.setProperty('--lens-sy',(1-s*.55).toFixed(3));
  }
  nav.addEventListener('pointerdown',e=>{
    if(e.button!==0||drag.active||!e.target.closest('.nav-item'))return;
    measure();if(w<120)return;
    Object.assign(drag,{active:true,moved:false,id:e.pointerId,startX:e.clientX,lastX:e.clientX,lastT:performance.now(),v:0,hover:index,startLens:lensX()});
    try{nav.setPointerCapture(e.pointerId);}catch(_){}
    nav.classList.add('is-pressing');
  });
  nav.addEventListener('pointermove',e=>{
    if(!drag.active||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.startX;
    if(!drag.moved){if(Math.abs(dx)<4)return;drag.moved=true;nav.classList.add('is-dragging');lens.classList.remove('is-travelling');}
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
    if(!drag.moved)return; // 單純點一下 → 交給按鈕的 click
    suppressClick=true;setTimeout(()=>suppressClick=false,0);
    const target=cancelled?index:slotAt(lensX());
    if(target!==index)navigateTo(items[target].dataset.page); // 會廣播 app:navigate → update()
    update(); // 已離開拖曳狀態，transition 恢復 → 彈簧吸附
  }
  nav.addEventListener('pointerup',e=>release(e,false));
  nav.addEventListener('pointercancel',e=>release(e,true));
  nav.addEventListener('lostpointercapture',e=>release(e,true));
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
