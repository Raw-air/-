/* Gravity lifecycle: GPU scene in gravity.js; edits remain an unsaved draft. */
(() => {
  const DURATION=3400;   // 整段動畫長度 (ms)

  function star(x,y) {
    const el=document.createElement('div');
    el.className='bh-final-star';
    el.style.left=x+'px'; el.style.top=y+'px';
    el.innerHTML='<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M60 0 68 48 120 60 68 68 60 120 52 68 0 60 52 48Z" fill="#fff9e7"/><path d="M60 27 65 54 93 60 65 65 60 93 55 65 27 60 55 54Z" fill="white"/></svg>';
    document.body.appendChild(el);
    const a=el.animate([
      {transform:'translate(-50%,-50%) scale(0) rotate(-25deg)',opacity:0},
      {transform:'translate(-50%,-50%) scale(1.15) rotate(0deg)',opacity:1,offset:.2},
      {transform:'translate(-50%,-50%) scale(.65) rotate(12deg)',opacity:1,offset:.45},
      {transform:'translate(-50%,-50%) scale(0) rotate(35deg)',opacity:0}
    ],{duration:650,easing:'ease-out',fill:'forwards'});
    a.finished.then(()=>el.remove(),()=>el.remove());
    return a.finished;
  }

  // 先遣層：截圖還沒好之前就先讓黑洞「成形」，按下垃圾桶 0.3s 內畫面就變黑、球體出現。
  // WebGL 場景備妥後會直接蓋掉這一層，兩者位置、半徑與傾角一致。
  function seed(hx,hy,rs){
    const dim=document.createElement('div');
    dim.className='bh-atmo bh-seed-dim on';
    dim.style.setProperty('--bh-x',hx+'px');
    dim.style.setProperty('--bh-y',hy+'px');
    const el=document.createElement('div');
    el.className='bh-seed';
    el.style.setProperty('--bh-r',rs+'px');
    el.style.left=hx+'px';el.style.top=hy+'px';
    el.innerHTML='<i class="bh-seed-disk"></i><i class="bh-seed-core"></i>';
    document.body.appendChild(dim);document.body.appendChild(el);
    const anims=[
      dim.animate([{opacity:0},{opacity:1}],{duration:420,easing:'ease-out',fill:'forwards'}),
      el.animate([
        {transform:'translate(-50%,-50%) scale(.06)',opacity:0},
        {transform:'translate(-50%,-50%) scale(1)',opacity:1}
      ],{duration:300,easing:'cubic-bezier(.2,.85,.25,1)',fill:'forwards'})
    ];
    return ()=>{anims.forEach(a=>{try{a.cancel();}catch(e){}});dim.remove();el.remove();};
  }

  window.clearStudentData=async function(btn){
    const activeCard=btn?.closest('.sf-student-card-2d') || document.querySelector('.sf-student-card-2d.active');
    if(!activeCard || window._sfBHBusy) return;
    window._sfBHBusy=true;
    const owner=_sfRenderMap.get(activeCard);
    const sceneEl=document.getElementById('sf-scene');
    const oldPointer=sceneEl?.style.pointerEvents || '';
    const oldStyle=activeCard.getAttribute('style');
    const wasInert=sceneEl?.inert || false;
    let gravity,canvas,frame,stopSeed;
    let cancelled=false, resolveRun;
    const abort=()=>{cancelled=true;cancelAnimationFrame(frame);resolveRun?.();};
    const onVisibility=()=>{if(document.hidden)abort();};
    const onNavigation=()=>{if(currentPage!=='student-files')abort();};
    const resetFields=()=>{
      if(_sfRenderMap.get(activeCard)!==owner) return;
      for(const cls of ['name','id','class','remarks']) activeCard.querySelector('.sf-input-'+cls).value='';
      activeCard.querySelector('.sf-chk-foreign').checked=false;
      activeCard.querySelector('.sf-chk-empty').checked=true;
      const badge=activeCard.querySelector('.sf-card-badge-relative');
      if(badge)badge.textContent='空床';
      // Clearing is an editable draft, just like the existing Save Changes workflow.
      if(owner) _sfDrafts.set(owner.id,{name:'',studentId:'',class:'',remarks:'',isForeign:false,isEmpty:true});
    };
    try {
      window._sfStopMotion?.();
      document.body.classList.add('gravity-running');
      if(sceneEl){sceneEl.style.pointerEvents='none';sceneEl.inert=true;}
      activeCard.dataset.bhBusy='1';
      activeCard.style.transition='none';
      activeCard.style.transform='translateX(0) scale(1)';
      activeCard.style.opacity='1';
      document.addEventListener('visibilitychange',onVisibility);
      window.addEventListener('resize',abort);
      window.addEventListener('app:navigate',onNavigation);
      if(matchMedia('(prefers-reduced-motion: reduce)').matches){resetFields();return;}
      await new Promise(r=>requestAnimationFrame(r));
      const rect=activeCard.getBoundingClientRect();
      const w=innerWidth,h=innerHeight;
      const hx=Math.min(w-90,Math.max(90,w*.58));
      const hy=Math.max(64,Math.min(h*.25,rect.top-65));
      const rs=Math.max(34,Math.min(58,w*.115));
      haptic('heavy');
      const press=performance.now();
      stopSeed=seed(hx,hy,rs);
      // Local dependencies are prefetched at entry; no CDN round trip on delete.
      await sfPrefetchHtml2Canvas();
      if(cancelled)return;
      const snapshot=await captureGravityScene(activeCard);
      if(cancelled)return;
      if(!window.THREE)throw Error('WebGL library unavailable');
      gravity=createGravityScene(snapshot,hx,hy,rs);canvas=gravity.canvas;
      document.body.appendChild(canvas);canvas.addEventListener('webglcontextlost',abort);
      // 時鐘從按下算起，但最多只補 0.5s，擷取久一點也不會直接跳到動畫尾巴。
      const start=Math.max(press,performance.now()-500);
      const first=performance.now()-start;
      gravity.render(first/1000,Math.min(1,first/DURATION));
      activeCard.style.visibility='hidden';
      stopSeed();stopSeed=null;
      haptic('heavy');
      let lastHaptic=performance.now();
      await new Promise((resolve,reject)=>{
        resolveRun=resolve;
        function tick(now){
          try {
            if(cancelled){resolve();return;}
            const p=Math.min(1,(now-start)/DURATION);
            gravity.render((now-start)/1000,p);
            if(now-lastHaptic>Math.max(90,240-p*140)&&p<.9){haptic(p>.45?'medium':'light');lastHaptic=now;}
            if(p<1)frame=requestAnimationFrame(tick);else resolve();
          }catch(e){reject(e);}
        }
        frame=requestAnimationFrame(tick);
      });
      if(cancelled)return;
      canvas.remove();
      haptic('light');
      await star(hx,hy);
      if(!cancelled)resetFields();
    }catch(err){
      console.warn('[BlackHole]',err);
      // Context/library failure must not leave a hidden or unusable card.
      stopSeed?.();stopSeed=null;
      canvas?.remove();
      activeCard.style.visibility='visible';
      if(!cancelled){
        const a=activeCard.animate([{transform:'scale(1)',opacity:1},{transform:'translateY(-120px) rotate(25deg) scale(.02)',opacity:0}],{duration:550,easing:'ease-in',fill:'forwards'});
        await a.finished.catch(()=>{});a.cancel();
        if(!cancelled){const r=activeCard.getBoundingClientRect();await star(r.left+r.width/2,Math.max(70,r.top));resetFields();}
      }
    }finally{
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('resize',abort);
      window.removeEventListener('app:navigate',onNavigation);
      stopSeed?.();
      document.querySelectorAll('.bh-seed,.bh-seed-dim').forEach(el=>el.remove());
      canvas?.remove();gravity?.dispose();
      if(oldStyle===null)activeCard.removeAttribute('style');else activeCard.setAttribute('style',oldStyle);
      delete activeCard.dataset.bhBusy;
      if(sceneEl){sceneEl.style.pointerEvents=oldPointer;sceneEl.inert=wasInert;}
      window._sfBHBusy=false;
      document.body.classList.remove('gravity-running');
      if(!cancelled && activeCard.isConnected){
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches) activeCard.animate([{opacity:0,transform:'scale(.88)'},{opacity:1,transform:'scale(1)'}],{duration:380,easing:'cubic-bezier(.2,.7,.2,1)'});
        showToast('床位已清空，按「儲存修改」同步', 'info');
      }
      window._restart3DTimer?.();
    }
  };
})();
