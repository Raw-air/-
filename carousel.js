// 住宿生卡片輪播：時間軸阻尼彈簧 (60/120 Hz) + 立體扇形排列 (coverflow)。
// 輸入層在觸控裝置用 Touch Events、桌面用 Mouse Events：iOS Safari 在可直向捲動的頁面
// 做水平拖曳時會送出 pointercancel (w3c/pointerevents#303)，所以不用 Pointer Events。
function setup2DCarouselInteraction() {
  const area=document.getElementById('sf-card-area'),track=document.getElementById('sf-card-track');
  const page=document.getElementById('page-student-files');
  if(_carouselAttached||!area||!track)return;
  _carouselAttached=true;
  // 扇形排列參數：離中心越遠越往中間擠、轉得越側、退得越深 → 兩側疊成一落玻璃卡
  const NEAR_PULL=64,FAR_PULL=200,MAX_ROT=62,ROT_PER=34,DEPTH=95,VISIBLE=2.7;
  let active=false,dragging=false,touchId=null,mouseActive=false;
  let startX=0,startY=0,startTrack=0,lastX=0,lastTime=0,velocity=0;
  let frame=0,dragFrame=0,idle=0,suppressClick=false,lastIndex=0,smoothUntil=0;
  const SMOOTH='transform .75s cubic-bezier(.22,1,.36,1),opacity .5s ease';
  const count=()=>_sfResults.length;
  const clampIndex=i=>Math.max(0,Math.min(count()-1,i));
  function moving(on){page.classList.toggle('sf-moving',on);}
  function stop(){cancelAnimationFrame(frame);cancelAnimationFrame(dragFrame);frame=dragFrame=0;clearTimeout(idle);moving(false);}
  // 每張卡只在數值真的改變時才寫 style，滑動時省下大量重複的樣式計算
  function put(el,transform,opacity,z){
    // 進出 3D 模式的那 0.8 秒讓卡片用 CSS 過渡走位，其餘時間逐幀直接寫值 (拖曳要跟手)
    const tr=performance.now()<smoothUntil?SMOOTH:'none';
    if(el._tr!==tr){el.style.transition=tr;el._tr=tr;}
    if(el._tf!==transform){el.style.transform=transform;el._tf=transform;}
    if(el._op!==opacity){el.style.opacity=opacity;el._op=opacity;}
    if(el._z!==z){el.style.zIndex=z;el._z=z;}
  }
  function paint(){
    track.style.transform=`translate3d(${_currentX}px,0,0)`;
    const center=-_currentX/_cardWidth,n=count(),spread=window._is3dMode;
    sfSyncWindow(center);
    for(const entry of _sfPool){
      const el=entry.el,v=entry.vIndex;
      if(v===null){el.classList.add('sf-far');continue;}
      const d=v-center,ad=Math.abs(d);
      const visible=v>=0&&v<n&&ad<VISIBLE;
      el.classList.toggle('sf-far',!visible);
      if(!visible)continue;
      el.classList.toggle('active',v===_sfActiveIndex);
      if(spread&&v!==_sfActiveIndex){
        // 中央卡立起來的時候，兩側卡片讓開 (跟舊版一樣往左右飛出畫面)
        put(el,`translate3d(${d<0?-1500:1500}px,0,0) scale(.85)`,'0','1');
        continue;
      }
      if(spread){
        put(el,'perspective(1200px) rotate3d(.5,1,0,14deg) scale(1.04)','1','120');
        continue;
      }
      const s=d<0?-1:1,cap=Math.min(ad,3);
      const pull=ad<=1?ad*NEAR_PULL:NEAR_PULL+(ad-1)*FAR_PULL;
      const rot=-s*Math.min(MAX_ROT,ad*ROT_PER);
      put(el,
        `perspective(1400px) translate3d(${(-s*pull).toFixed(1)}px,0,${(-cap*DEPTH).toFixed(1)}px) rotateY(${rot.toFixed(1)}deg) scale(${(1-cap*.05).toFixed(3)})`,
        (1-cap*.2).toFixed(3),
        String(Math.round(100-ad*10)));
    }
    const index=clampIndex(Math.round(center));
    if(index!==lastIndex){haptic('light');lastIndex=index;}
  }
  window._updateContinuousScale=()=>paint();
  function flatten(animated){
    clearTimeout(idle);
    if(window._is3dMode&&animated)smoothUntil=performance.now()+800;else smoothUntil=0;
    window._is3dMode=false;
    for(const e of _sfPool)e.el.classList.remove('is-3d-active');
    paint();
  }
  window._sfDisable3D=()=>flatten(true);
  window._sfStopMotion=()=>{stop();active=false;dragging=false;touchId=null;mouseActive=false;flatten(false);};
  window._restart3DTimer=()=>{
    clearTimeout(idle);
    idle=setTimeout(()=>{
      if(active||frame||window._sfBHBusy||document.hidden||currentPage!=='student-files')return;
      window._is3dMode=true;smoothUntil=performance.now()+800;
      sfActiveEntry()?.el.classList.add('is-3d-active');haptic('medium');paint();
    },1100);
  };
  function settle(index,initialVelocity=0){
    stop();_sfActiveIndex=clampIndex(index);const target=-_sfActiveIndex*_cardWidth;
    const origin=_currentX,delta=origin-target;
    if(Math.abs(delta)<.5&&!initialVelocity){_currentX=target;paint();window._restart3DTimer();return;}
    const speed=Math.max(-2600,Math.min(2600,initialVelocity));
    const omega=19,start=performance.now();moving(true);
    function tick(now){
      const t=(now-start)/1000;
      _currentX=target+(delta+(speed+omega*delta)*t)*Math.exp(-omega*t);
      paint();
      if(t<.8&&(Math.abs(_currentX-target)>.15||t<.10)){frame=requestAnimationFrame(tick);return;}
      _currentX=target;frame=0;paint();moving(false);window._restart3DTimer();
    }
    frame=requestAnimationFrame(tick);
  }
  // ── 手勢狀態機 (觸控與滑鼠共用) ────────────────────────────────────────────
  function down(x,y,target){
    if(active||window._sfBHBusy||!count()||document.getElementById('sf-scene').classList.contains('is-searching'))return false;
    // 已經聚焦的欄位保留原生游標選取；沒聚焦的欄位可以直接起手滑動
    if(target===document.activeElement&&target.matches('input,textarea'))return false;
    stop();flatten(false);active=true;dragging=false;suppressClick=false;
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
    if(dt>0)velocity=.65*((x-lastX)/dt*1000)+.35*velocity;
    lastX=x;lastTime=now;
    // 有邊界：超出第一張/最後一張時用橡皮筋阻尼，放手會彈回去
    const min=-(count()-1)*_cardWidth;
    let px=startTrack+dx;
    if(px>0)px=110*(1-Math.exp(-px/210));
    else if(px<min)px=min-110*(1-Math.exp((px-min)/210));
    _currentX=px;
    if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;paint();});
    return true;
  }
  function up(cancelled){
    if(!active)return;
    active=false;
    if(!dragging){window._restart3DTimer();return;}
    dragging=false;
    if(cancelled||performance.now()-lastTime>100)velocity=0;
    const projected=_currentX+velocity*.16;
    const current=Math.round(-startTrack/_cardWidth);
    let next=Math.round(-projected/_cardWidth);
    next=Math.max(current-3,Math.min(current+3,next));
    settle(next,velocity);
    setTimeout(()=>suppressClick=false,0);
  }
  // ── 觸控 (iPhone / Android) ───────────────────────────────────────────────
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
  // ── 滑鼠 (桌面) ───────────────────────────────────────────────────────────
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
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();flatten(false);settle(_sfActiveIndex+(e.key==='ArrowRight'?1:-1));}
  });
  window._sfSweepTo=(_from,to)=>{stop();_currentX=to+Math.min(_cardWidth*.65,180);settle(Math.round(-to/_cardWidth));};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)window._sfStopMotion();});
}
