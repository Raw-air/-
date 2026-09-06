const _navOriginalIcons=new Map(Array.from(document.querySelectorAll('.nav-item'),item=>[item.dataset.page,item.querySelector('.nav-icon').innerHTML]));
function setupNav(){
  const nav=document.querySelector('.bottom-nav');nav.classList.add('liquid-nav');
  nav.setAttribute('aria-label','主要導覽');
  const items=Array.from(nav.querySelectorAll('.nav-item'));
  for(const item of items)item.querySelector('.nav-icon').innerHTML=_navOriginalIcons.get(item.dataset.page);
  // 鏡片：外層只位移；lens-shape 做玻璃材質與液態擠壓；lens-zoom 裡是放大的圖示複本 (跨瀏覽器折射)
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
  const rim=document.createElement('span');rim.className='lens-rim';shape.appendChild(rim);
  lens.appendChild(shape);nav.prepend(lens);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let lastIndex=-1,travelTimer=0,retryTimer=0;
  function update(){
    const page=['home','summary','history','settings'].includes(currentPage)?currentPage:currentPage==='rollcall'?'home':'settings';
    const index=Math.max(0,items.findIndex(item=>item.dataset.page===page));
    const w=nav.clientWidth;
    // 尚未完成排版 (分頁在背景、剛切回前景) 時量到的寬度不可信，稍後再算一次
    if(w<120){clearTimeout(retryTimer);retryTimer=setTimeout(update,120);return;}
    const slot=(w-16)/4,size=lens.offsetWidth||68;
    nav.style.setProperty('--nav-w',w+'px');
    nav.style.setProperty('--lens-x',(8+slot*(index+.5)-size/2)+'px');
    for(const [i,item] of items.entries()){
      item.classList.toggle('active',i===index);clones[i].classList.toggle('active',i===index);
      if(i===index)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
    }
    // 換分頁時鏡片像水滴一樣先拉長，抵達後彈回正圓
    if(lastIndex!==-1&&lastIndex!==index&&!reduced.matches){
      lens.classList.remove('is-travelling');void lens.offsetWidth;
      lens.classList.add('is-travelling');clearTimeout(travelTimer);
      travelTimer=setTimeout(()=>lens.classList.remove('is-travelling'),520);
    }
    lastIndex=index;
  }
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
