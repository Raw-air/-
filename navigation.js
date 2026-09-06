const _navOriginalIcons=new Map(Array.from(document.querySelectorAll('.nav-item'),item=>[item.dataset.page,item.querySelector('.nav-icon').innerHTML]));
function setupNav(){
  const nav=document.querySelector('.bottom-nav');nav.classList.add('liquid-nav');
  nav.setAttribute('aria-label','主要導覽');
  const lens=document.createElement('span');lens.className='liquid-lens';lens.setAttribute('aria-hidden','true');
  nav.prepend(lens);
  // A normal map refracts the backdrop where SVG backdrop filters are supported.
  // Safari retains the CSS optical rim, transparency and native backdrop blur.
  const map=document.createElement('canvas');map.width=map.height=96;
  const ctx=map.getContext('2d'),pixels=ctx.createImageData(96,96);
  for(let y=0;y<96;y++)for(let x=0;x<96;x++){
    const nx=(x-47.5)/48,ny=(y-47.5)/48,r=Math.hypot(nx,ny);
    const bend=r<1?Math.pow(r,5)*.8:0,i=(y*96+x)*4;
    pixels.data[i]=128+nx*bend*115;pixels.data[i+1]=128+ny*bend*115;pixels.data[i+2]=128;pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');
  svg.style.position='absolute';
  svg.innerHTML=`<defs><filter id="nav-glass-refraction" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB"><feImage href="${map.toDataURL()}" result="normal" preserveAspectRatio="none"/><feDisplacementMap in="SourceGraphic" in2="normal" scale="18" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
  document.body.appendChild(svg);
  if(/Chrome|Chromium|Edg\//.test(navigator.userAgent)&&CSS.supports('backdrop-filter','url("#nav-glass-refraction")'))lens.style.backdropFilter='url("#nav-glass-refraction") blur(1px) saturate(145%)';
  const items=Array.from(nav.querySelectorAll('.nav-item'));
  for(const item of items)item.querySelector('.nav-icon').innerHTML=_navOriginalIcons.get(item.dataset.page);
  function update(){
    const page=['home','summary','history','settings'].includes(currentPage)?currentPage:currentPage==='rollcall'?'home':'settings';
    const index=Math.max(0,items.findIndex(item=>item.dataset.page===page));
    const slot=(nav.clientWidth-16)/4;
    nav.style.setProperty('--lens-x',(8+slot*(index+.5)-44)+'px');
    for(const [i,item] of items.entries()){
      item.classList.toggle('active',i===index);
      if(i===index)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
    }
  }
  items.forEach(item=>item.addEventListener('click',()=>{navigateTo(item.dataset.page);update();}));
  nav.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();let i=items.indexOf(document.activeElement);
    i=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4;
    items[i].focus();items[i].click();
  });
  window.addEventListener('app:navigate',update);
  new ResizeObserver(update).observe(nav);
  update();
}
