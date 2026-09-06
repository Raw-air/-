// Direct manipulation with one time-based critically damped spring (60/120 Hz).
function setup2DCarouselInteraction() {
  const area=document.getElementById('sf-card-area'),track=document.getElementById('sf-card-track');
  const page=document.getElementById('page-student-files');
  if(_carouselAttached||!area||!track)return;
  _carouselAttached=true;
  let pointer=null,dragging=false,startX=0,startY=0,startTrack=0,lastX=0,lastTime=0,velocity=0;
  let frame=0,dragFrame=0,idle=0,suppressClick=false,lastIndex=0;
  const clampIndex=i=>Math.max(0,Math.min(_sfResults.length-1,i));
  function moving(on){page.classList.toggle('sf-moving',on);}
  function stop(){cancelAnimationFrame(frame);cancelAnimationFrame(dragFrame);frame=dragFrame=0;clearTimeout(idle);moving(false);}
  function paint(){
    track.style.transition='none';track.style.transform=`translate3d(${_currentX}px,0,0)`;
    const center=-_currentX/_cardWidth;
    sfSyncWindow(center);
    for(const entry of _sfPool){
      const distance=Math.abs(entry.vIndex-center);
      const visible=entry.vIndex>=0&&entry.vIndex<_sfResults.length&&distance<3;
      entry.el.classList.toggle('sf-far',!visible);
      if(!visible)continue;
      entry.el.classList.toggle('active',entry.vIndex===_sfActiveIndex);
      const near=Math.max(0,1-distance);
      // Adjacent cards stay visible, including while the centre card rests in 3D.
      const tilt=window._is3dMode?near*7:0;
      entry.el.style.transition='none';
      entry.el.style.transform=`perspective(1100px) rotateY(${tilt}deg) scale(${.94+.06*near})`;
      entry.el.style.opacity=String(.72+.28*near);
      entry.el.style.zIndex=String(Math.round(100-distance*10));
    }
    const index=clampIndex(Math.round(center));
    if(index!==lastIndex){haptic('light');lastIndex=index;}
  }
  window._updateContinuousScale=()=>paint();
  function flatten(){
    clearTimeout(idle);window._is3dMode=false;
    for(const e of _sfPool)e.el.classList.remove('is-3d-active');
    paint();
  }
  window._sfDisable3D=flatten;
  window._sfStopMotion=()=>{stop();pointer=null;dragging=false;flatten();};
  window._restart3DTimer=()=>{
    clearTimeout(idle);
    // Retain depth at rest without throwing neighbouring cards 1500px offscreen.
    idle=setTimeout(()=>{
      if(pointer!==null||frame||window._sfBHBusy||document.hidden||currentPage!=='student-files')return;
      window._is3dMode=true;
      sfActiveEntry()?.el.classList.add('is-3d-active');paint();
    },1100);
  };
  function settle(index,initialVelocity=0){
    stop();_sfActiveIndex=clampIndex(index);const target=-_sfActiveIndex*_cardWidth;
    const origin=_currentX,delta=origin-target;
    const speed=Math.max(-2400,Math.min(2400,initialVelocity));
    const omega=17,start=performance.now();moving(true);
    function tick(now){
      const t=(now-start)/1000;
      _currentX=target+(delta+(speed+omega*delta)*t)*Math.exp(-omega*t);
      paint();
      if(t<.85&&(Math.abs(_currentX-target)>.2||t<.12)){frame=requestAnimationFrame(tick);return;}
      _currentX=target;frame=0;paint();moving(false);window._restart3DTimer();
    }
    frame=requestAnimationFrame(tick);
  }
  area.addEventListener('pointerdown',e=>{
    if(pointer!==null||window._sfBHBusy||!_sfResults.length||e.button>0||document.getElementById('sf-scene').classList.contains('is-searching'))return;
    // A focused field keeps native caret selection; unfocused fields can initiate a swipe.
    if(e.target===document.activeElement&&e.target.matches('input,textarea'))return;
    stop();flatten();pointer=e.pointerId;dragging=false;suppressClick=false;
    startX=lastX=e.clientX;startY=e.clientY;startTrack=_currentX;lastTime=performance.now();velocity=0;
  });
  area.addEventListener('pointermove',e=>{
    if(pointer!==e.pointerId)return;
    const dx=e.clientX-startX,dy=e.clientY-startY,now=performance.now();
    if(!dragging){
      if(Math.max(Math.abs(dx),Math.abs(dy))<7)return;
      if(Math.abs(dy)>Math.abs(dx)){pointer=null;window._restart3DTimer();return;}
      dragging=true;suppressClick=true;moving(true);area.setPointerCapture(e.pointerId);
      if(document.activeElement?.closest('.sf-student-card-2d'))document.activeElement.blur();
    }
    if(e.cancelable)e.preventDefault();
    const dt=now-lastTime;
    if(dt>0)velocity=.6*((e.clientX-lastX)/dt*1000)+.4*velocity;
    lastX=e.clientX;lastTime=now;
    const min=-(_sfResults.length-1)*_cardWidth;
    let x=startTrack+dx;
    if(x>0)x=100*(1-Math.exp(-x/200));
    if(x<min)x=min-100*(1-Math.exp((x-min)/200));
    _currentX=x;
    if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;paint();});
  },{passive:false});
  function release(e){
    if(pointer!==e.pointerId)return;
    pointer=null;
    if(area.hasPointerCapture(e.pointerId))area.releasePointerCapture(e.pointerId);
    if(!dragging){window._restart3DTimer();return;}
    dragging=false;
    if(e.type==='pointercancel'||performance.now()-lastTime>100)velocity=0;
    const projected=_currentX+velocity*.17;
    const current=Math.round(-startTrack/_cardWidth);
    let next=Math.round(-projected/_cardWidth);
    next=Math.max(current-3,Math.min(current+3,next));
    settle(next,velocity);
    setTimeout(()=>suppressClick=false,0);
  }
  window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);
  area.addEventListener('lostpointercapture',e=>{if(pointer===e.pointerId)release(e);});
  area.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  area.tabIndex=0;area.setAttribute('aria-label','住宿生卡片，可左右滑動或使用方向鍵');
  area.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select'))return;
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();flatten();settle(_sfActiveIndex+(e.key==='ArrowRight'?1:-1));}
  });
  window._sfSweepTo=(_from,to)=>{stop();_currentX=to+Math.min(_cardWidth*.65,180);settle(Math.round(-to/_cardWidth));};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)window._sfStopMotion();});
}
