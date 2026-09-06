const THEME_VT_DURATION=520;
const THEME_VT_EASE='cubic-bezier(.33,.1,.25,1)';
let _themeTransition=null,_themeGeneration=0,_themeFallbackOverlay=null,_themeFallbackTimer=null;
function _themeTapPoint(el){
  const r=(el?.closest('label')||el||document.getElementById('setting-white-mode')).getBoundingClientRect();
  return {x:r.left+r.width/2,y:r.top+r.height/2};
}
function _themeEndRadius(x,y){return Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y))+8;}
function _themeClip(x,y,r){return `circle(${r}px at ${x}px ${y}px)`;}
// Keyframes are written with literal pixels: iOS WebKit does not resolve var() reliably on
// ::view-transition pseudo-elements (the circle then grows from the top-left corner).
function _themeWriteKeyframes(x,y,r){
  let s=document.getElementById('theme-reveal-style');
  if(!s){s=document.createElement('style');s.id='theme-reveal-style';document.head.appendChild(s);}
  s.textContent=`@keyframes theme-circle-reveal{from{clip-path:${_themeClip(x,y,0)}}to{clip-path:${_themeClip(x,y,r)}}}`;
}
function _themeFallbackTransition(light,x,y){
  const generation=_themeGeneration,ov=document.createElement('div');_themeFallbackOverlay=ov;
  ov.style.cssText=`position:fixed;inset:0;z-index:20000;pointer-events:none;background:${light?'#ebecf0':'#151518'}`;
  document.body.appendChild(ov);
  const a=ov.animate({clipPath:[_themeClip(x,y,0),_themeClip(x,y,_themeEndRadius(x,y))]},{duration:THEME_VT_DURATION,easing:THEME_VT_EASE,fill:'forwards'});
  a.finished.then(()=>{if(generation!==_themeGeneration)return;performAppearanceChange(light);return ov.animate({opacity:[1,0]},{duration:160,fill:'forwards'}).finished;}).then(()=>ov.remove()).catch(()=>ov.remove());
}
function toggleWhiteMode(el){
  const light=el.checked,generation=++_themeGeneration,root=document.documentElement;
  setPref('white_mode',light);
  _themeTransition?.skipTransition();_themeFallbackOverlay?.remove();
  root.classList.remove('vt-active','theme-reveal');
  const {x,y}=_themeTapPoint(el),radius=_themeEndRadius(x,y);
  if(typeof _themeHaptic==='function')_themeHaptic();else haptic('medium');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){performAppearanceChange(light);return;}
  if(!document.startViewTransition){_themeFallbackTransition(light,x,y);return;}
  // Define the reveal BEFORE snapshot creation. WebKit can silently ignore WAAPI
  // pseudoElement animation on the first transition; CSS starts at frame zero.
  root.style.setProperty('--theme-x',x+'px');root.style.setProperty('--theme-y',y+'px');
  root.style.setProperty('--theme-radius',radius+'px');
  _themeWriteKeyframes(x,y,radius);
  // vt-active：截圖期間關掉毛玻璃、陰影與所有 transition，兩張快照的成本大幅下降 (手機才不會掉幀)
  root.classList.add('theme-reveal','vt-active');
  let fallbackClock=0,watchdog=0,safety=0;
  const cleanup=()=>{clearTimeout(fallbackClock);clearTimeout(watchdog);clearTimeout(safety);if(generation===_themeGeneration){root.classList.remove('theme-reveal','vt-active');_themeTransition=null;}};
  try{
    const transition=document.startViewTransition(()=>{if(generation===_themeGeneration)performAppearanceChange(light);});
    _themeTransition=transition;
    transition.ready.then(()=>{
      if(generation!==_themeGeneration)return;
      // 快照已經拍好，毛玻璃可以開回來 (live DOM 在轉場期間看不到，不影響畫面)
      root.classList.remove('vt-active');
      // 主驅動：WAAPI 以實際像素推同一個圓 (舊版在 iPhone 上順暢的做法)；CSS keyframes 同值同時存在，
      // WebKit 偶爾忽略首次 WAAPI 時由 CSS 接手，兩者疊在一起數值一致不會打架。
      try{root.animate({clipPath:[_themeClip(x,y,0),_themeClip(x,y,radius)]},{duration:THEME_VT_DURATION,easing:THEME_VT_EASE,fill:'forwards',pseudoElement:'::view-transition-new(root)'});}catch(_){}
      const animation=document.getAnimations().find(a=>a.animationName==='theme-circle-reveal');
      // Some WebKit builds expose a running pseudo animation whose timeline stays at 0.
      // Only in that case, advance the SAME clip animation from the frame clock.
      watchdog=setTimeout(()=>{
        if(generation!==_themeGeneration||!animation||Number(animation.currentTime)>1)return;
        animation.pause();
        const started=performance.now();
        const advance=now=>{
          if(generation!==_themeGeneration)return;
          animation.currentTime=Math.min(THEME_VT_DURATION,now-started);
          if(now-started<THEME_VT_DURATION)fallbackClock=setTimeout(()=>advance(performance.now()),16);else animation.finish();
        };
        advance(started);
      },70);
    }).catch(()=>{if(generation===_themeGeneration)performAppearanceChange(light);});
    safety=setTimeout(()=>{transition.skipTransition();cleanup();},1500);
    transition.finished.then(cleanup,cleanup);
  }catch(_){cleanup();_themeFallbackTransition(light,x,y);}
}
