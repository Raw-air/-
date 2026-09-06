// Direct manipulation with one time-based critically damped spring (60/120 Hz).
// Input layer uses Touch Events on touch screens and Mouse Events on desktop.
// iOS Safari fires pointercancel during a horizontal pan on a vertically scrolling page
// even with touch-action:pan-y (w3c/pointerevents#303), so Pointer Events are not used.
function setup2DCarouselInteraction() {
  const area=document.getElementById('sf-card-area'),track=document.getElementById('sf-card-track');
  const page=document.getElementById('page-student-files');
  if(_carouselAttached||!area||!track)return;
  _carouselAttached=true;
  let active=false,dragging=false,touchId=null,mouseActive=false;
  let startX=0,startY=0,startTrack=0,lastX=0,lastTime=0,velocity=0;
  let frame=0,dragFrame=0,idle=0,suppressClick=false,lastIndex=0;
  // 名單是環狀的 (sfStudentAt 取模)，索引不設上下限
  const clampIndex=i=>i;
  function moving(on){page.classList.toggle('sf-moving',on);}
  function stop(){cancelAnimationFrame(frame);cancelAnimationFrame(dragFrame);frame=dragFrame=0;clearTimeout(idle);moving(false);}
  function paint(){
    track.style.transition='none';track.style.transform=`translate3d(${_currentX}px,0,0)`;
    const center=-_currentX/_cardWidth;
    sfSyncWindow(center);
    for(const entry of _sfPool){
      const distance=Math.abs(entry.vIndex-center);
      const visible=distance<3;
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
  window._sfStopMotion=()=>{stop();active=false;dragging=false;touchId=null;mouseActive=false;flatten();};
  window._restart3DTimer=()=>{
    clearTimeout(idle);
    // Retain depth at rest without throwing neighbouring cards 1500px offscreen.
    idle=setTimeout(()=>{
      if(active||frame||window._sfBHBusy||document.hidden||currentPage!=='student-files')return;
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
  // ── Gesture state machine (shared by touch and mouse) ──────────────────────
  function down(x,y,target){
    if(active||window._sfBHBusy||!_sfResults.length||document.getElementById('sf-scene').classList.contains('is-searching'))return false;
    // A focused field keeps native caret selection; unfocused fields can initiate a swipe.
    if(target===document.activeElement&&target.matches('input,textarea'))return false;
    stop();flatten();active=true;dragging=false;suppressClick=false;
    startX=lastX=x;startY=y;startTrack=_currentX;lastTime=performance.now();velocity=0;
    return true;
  }
  function move(x,y){
    if(!active)return false;
    const dx=x-startX,dy=y-startY,now=performance.now();
    if(!dragging){
      if(Math.max(Math.abs(dx),Math.abs(dy))<7)return false;
      if(Math.abs(dy)>Math.abs(dx)){active=false;window._restart3DTimer();return false;}
      dragging=true;suppressClick=true;moving(true);
      if(document.activeElement?.closest('.sf-student-card-2d'))document.activeElement.blur();
    }
    const dt=now-lastTime;
    if(dt>0)velocity=.6*((x-lastX)/dt*1000)+.4*velocity;
    lastX=x;lastTime=now;
    _currentX=startTrack+dx;
    if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;paint();});
    return true;
  }
  function up(cancelled){
    if(!active)return;
    active=false;
    if(!dragging){window._restart3DTimer();return;}
    dragging=false;
    if(cancelled||performance.now()-lastTime>100)velocity=0;
    const projected=_currentX+velocity*.17;
    const current=Math.round(-startTrack/_cardWidth);
    let next=Math.round(-projected/_cardWidth);
    next=Math.max(current-3,Math.min(current+3,next));
    settle(next,velocity);
    setTimeout(()=>suppressClick=false,0);
  }
  // ── Touch (iPhone / Android) ───────────────────────────────────────────────
  const findTouch=e=>Array.from(e.changedTouches).find(t=>t.identifier===touchId);
  area.addEventListener('touchstart',e=>{
    // 只看落在卡片區裡的手指；別處的手指 (握持、捏合) 不該擋掉滑動
    if(touchId!==null||mouseActive||Array.from(e.touches).filter(t=>area.contains(t.target)).length!==1)return;
    const t=e.changedTouches[0];
    if(down(t.clientX,t.clientY,e.target))touchId=t.identifier;
  },{passive:true});
  area.addEventListener('touchmove',e=>{
    const t=findTouch(e);if(!t)return;
    move(t.clientX,t.clientY);
    // 只在「已判定為水平拖曳」後才擋住預設行為：WebKit 會記住第一個被 preventDefault 的 touchmove，
    // 太早擋會讓後來變成直向的手勢整段都捲不動。判定條件與 move() 完全一致。
    if(dragging&&e.cancelable)e.preventDefault();
    if(!active)touchId=null;
  },{passive:false});
  const touchEnd=e=>{if(!findTouch(e))return;touchId=null;up(e.type==='touchcancel');};
  area.addEventListener('touchend',touchEnd);
  area.addEventListener('touchcancel',touchEnd);
  // ── Mouse (desktop) ────────────────────────────────────────────────────────
  area.addEventListener('mousedown',e=>{
    if(touchId!==null||e.button!==0)return;
    if(down(e.clientX,e.clientY,e.target))mouseActive=true;
  });
  window.addEventListener('mousemove',e=>{
    if(!mouseActive)return;
    if(move(e.clientX,e.clientY))e.preventDefault();
    if(!active)mouseActive=false;
  });
  const mouseEnd=()=>{if(!mouseActive)return;mouseActive=false;up(false);};
  window.addEventListener('mouseup',mouseEnd);
  window.addEventListener('blur',()=>{mouseEnd();if(touchId!==null){touchId=null;up(true);}});
  area.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  area.addEventListener('dragstart',e=>e.preventDefault());
  area.tabIndex=0;area.setAttribute('aria-label','住宿生卡片，可左右滑動或使用方向鍵');
  area.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select'))return;
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();flatten();settle(_sfActiveIndex+(e.key==='ArrowRight'?1:-1));}
  });
  window._sfSweepTo=(_from,to)=>{stop();_currentX=to+Math.min(_cardWidth*.65,180);settle(Math.round(-to/_cardWidth));};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)window._sfStopMotion();});
}
