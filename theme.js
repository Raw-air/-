const THEME_VT_DURATION=480;
let _themeTransition=null,_themeGeneration=0,_themeFallbackOverlay=null,_themeFallbackTimer=null;
function _themeTapPoint(el){
  const r=(el?.closest('label')||el||document.getElementById('setting-white-mode')).getBoundingClientRect();
  return {x:r.left+r.width/2,y:r.top+r.height/2};
}
function _themeEndRadius(x,y){return Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y))+8;}
function _themeFallbackTransition(light,x,y){
  const generation=_themeGeneration,ov=document.createElement('div');_themeFallbackOverlay=ov;
  ov.style.cssText=`position:fixed;inset:0;z-index:20000;pointer-events:none;background:${light?'#ebecf0':'#151518'}`;
  document.body.appendChild(ov);
  const a=ov.animate({clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${_themeEndRadius(x,y)}px at ${x}px ${y}px)`]},{duration:THEME_VT_DURATION,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});
  a.finished.then(()=>{if(generation!==_themeGeneration)return;performAppearanceChange(light);return ov.animate({opacity:[1,0]},{duration:160,fill:'forwards'}).finished;}).then(()=>ov.remove()).catch(()=>ov.remove());
}
function toggleWhiteMode(el){
  const light=el.checked,generation=++_themeGeneration,root=document.documentElement;
  localStorage.setItem('white_mode',light);
  _themeTransition?.skipTransition();_themeFallbackOverlay?.remove();
  root.classList.remove('vt-active','theme-reveal');
  const {x,y}=_themeTapPoint(el);
  haptic('medium');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){performAppearanceChange(light);return;}
  if(!document.startViewTransition){_themeFallbackTransition(light,x,y);return;}
  // Define the reveal BEFORE snapshot creation. WebKit can silently ignore WAAPI
  // pseudoElement animation on the first transition; CSS starts at frame zero.
  root.style.setProperty('--theme-x',x+'px');root.style.setProperty('--theme-y',y+'px');
  root.style.setProperty('--theme-radius',_themeEndRadius(x,y)+'px');
  root.classList.add('theme-reveal');
  let fallbackClock=0,watchdog=0,safety=0;
  const cleanup=()=>{clearTimeout(fallbackClock);clearTimeout(watchdog);clearTimeout(safety);if(generation===_themeGeneration){root.classList.remove('theme-reveal');_themeTransition=null;}};
  try{
    const transition=document.startViewTransition(()=>{if(generation===_themeGeneration)performAppearanceChange(light);});
    _themeTransition=transition;
    transition.ready.then(()=>{
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
