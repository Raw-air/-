/* A single-pass, screen-space gravitational lens. Card text is sampled through
 * the same lens as the accretion disk, rather than rotating an undistorted DOM card.
 * Analytic deflection avoids marching 72 rays per pixel on mobile GPUs.
 */
(() => {
  const vertexShader = 'void main(){gl_Position=vec4(position.xy,0.,1.);}';
  const fragmentShader = `
    uniform vec2 resolution, hole;
    uniform vec4 card;
    uniform sampler2D cardTexture;
    uniform float dpr, time, radius, pull, birth, collapse;
    mat2 rotate(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
    vec4 cardAt(vec2 p){
      vec2 original=card.xy+card.zw*.5;
      vec2 center=mix(original,hole,pull);
      vec2 axis=normalize(hole-original+vec2(.001));
      vec2 side=vec2(-axis.y,axis.x);
      vec2 q=p-center;
      // Differential rotation: the near edge curls faster than the far edge.
      float proximity=1.-smoothstep(0.,card.w*1.3,length(p-hole));
      q=rotate(pull*pull*3.0+proximity*pull*2.8)*q;
      float scale=max(.025,1.-pow(pull,2.2)*.975);
      float x=dot(q,axis)/(scale*(1.+pull*2.8));
      float y=dot(q,side)/(scale*max(.13,1.-pull*.87));
      // Bend the card's straight edges into a tidal stream.
      y-=sin(x/card.w*3.5)*pull*card.z*.32;
      x/=max(.35,1.+pull*.55*clamp(x/card.w,-1.,1.));
      vec2 uv=(x*axis+y*side)/card.zw+.5;
      if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);
      vec4 c=texture2D(cardTexture,vec2(uv.x,1.-uv.y));
      c.rgb=mix(c.rgb,c.rgb*vec3(1.4,1.08,.8)+vec3(.12,.035,0.),pull*pull*.7);
      c.a*=1.-smoothstep(.975,1.,pull);
      return c;
    }
    void main(){
      vec2 p=vec2(gl_FragCoord.x/dpr,resolution.y-gl_FragCoord.y/dpr);
      vec2 q=p-hole;
      float r=length(q), rs=max(radius,.01);
      float nr=r/rs;
      vec2 direction=q/max(r,.001);
      // Thin-lens inverse mapping: the card becomes arcs around the Einstein ring.
      float deflection=rs*rs*2.5/max(r,rs*.35)*birth;
      vec2 source=hole+rotate(birth*.26*exp(-nr*.3))*(q-direction*deflection);
      vec4 c=cardAt(source);
      float shadow=(1.-smoothstep(.965,1.015,nr))*birth;
      vec3 color=c.rgb*c.a*(1.-shadow);
      float alpha=c.a*(1.-shadow)+shadow;
      // Inclined disk plus lensed rear image visible above and below the silhouette.
      vec2 diskP=vec2(q.x,q.y/.24);
      float diskR=length(diskP)/rs;
      float a=atan(diskP.y,diskP.x);
      float flow=a*5.-time*3.8+diskR*13.;
      float turbulence=.68+.2*sin(flow)+.12*sin(flow*2.7+time*1.3);
      float disk=(smoothstep(1.08,1.35,diskR)-smoothstep(2.5,4.3,diskR))*turbulence;
      disk*=q.y>0.?1.:(1.-shadow);
      float rearR=length(vec2(q.x,q.y*.83))/rs;
      float rear=exp(-pow((rearR-1.36)*8.,2.))*(.65+.35*sin(a*8.-time*4.));
      rear*=q.y<0.?1.:.35;
      float ring=exp(-abs(nr-1.035)*65.)*1.8;
      float halo=exp(-abs(nr-1.08)*4.5)*.22;
      float gain=birth*(1.-collapse);
      float doppler=clamp(1.+q.x/max(r,1.)*.55,.35,1.55);
      float light=(disk*1.1+rear*.85+ring+halo)*gain;
      vec3 hot=mix(vec3(1.,.32,.065),vec3(1.,.92,.72),clamp(light*.85,0.,1.));
      color+=hot*light*doppler;
      alpha=clamp(alpha+light,0.,1.);
      // Transparent premultiplied output, composed over the original UI.
      gl_FragColor=vec4(color,alpha);
    }`;

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

  window.clearStudentData=async function(btn){
    const activeCard=btn?.closest('.sf-student-card-2d') || document.querySelector('.sf-student-card-2d.active');
    if(!activeCard || window._sfBHBusy) return;
    window._sfBHBusy=true;
    const owner=_sfRenderMap.get(activeCard);
    const sceneEl=document.getElementById('sf-scene');
    const oldPointer=sceneEl?.style.pointerEvents || '';
    const oldStyle=activeCard.getAttribute('style');
    const wasInert=sceneEl?.inert || false;
    let renderer,texture,material,geometry,canvas,atmo,frame;
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
      const hx=Math.min(w-48,Math.max(64,rect.left+rect.width*.8));
      const hy=Math.max(64,Math.min(h*.25,rect.top-65));
      const rs=Math.max(30,Math.min(52,w*.105));
      haptic('heavy');
      // Local dependencies are prefetched at entry; no CDN round trip on delete.
      await sfPrefetchHtml2Canvas();
      if(cancelled)return;
      const snapshot=await sfCaptureCard(activeCard);
      if(cancelled)return;
      atmo=document.createElement('div');atmo.className='bh-atmo on';
      atmo.style.background='radial-gradient(circle at '+hx+'px '+hy+'px,transparent,rgba(4,3,12,.65))';
      document.body.appendChild(atmo);
      if(!window.THREE) throw Error('WebGL library unavailable');
      renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'high-performance'});
      // Keep full effect and texture detail, cap framebuffer cost on very tall phones.
      const pixelRatio=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1400000/(w*h)));
      renderer.setPixelRatio(pixelRatio);renderer.setSize(w,h,false);renderer.setClearColor(0,0);
      canvas=renderer.domElement;canvas.className='bh-webgl-layer on';
      canvas.style.transition='none';document.body.appendChild(canvas);
      canvas.addEventListener('webglcontextlost',abort);
      texture=new THREE.CanvasTexture(snapshot);texture.generateMipmaps=false;
      texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
      const u={resolution:{value:new THREE.Vector2(w,h)},hole:{value:new THREE.Vector2(hx,hy)},card:{value:new THREE.Vector4(rect.left,rect.top,rect.width,rect.height)},cardTexture:{value:texture},dpr:{value:pixelRatio},time:{value:0},radius:{value:.01},pull:{value:0},birth:{value:0},collapse:{value:0}};
      material=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms:u,transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor});
      geometry=new THREE.PlaneGeometry(2,2);
      const scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));
      const camera=new THREE.Camera();
      renderer.render(scene,camera);
      activeCard.style.visibility='hidden';
      const start=performance.now();
      await new Promise((resolve,reject)=>{
        resolveRun=resolve;
        function tick(now){
          try {
            if(cancelled){resolve();return;}
            const p=Math.min(1,(now-start)/3000);
            const born=Math.min(1,p/.16);
            const shrink=Math.max(0,(p-.86)/.14);
            const travel=Math.max(0,Math.min(1,(p-.13)/.7));
            u.time.value=(now-start)/1000;
            u.birth.value=born*born*(3.-2.*born);
            u.collapse.value=shrink;
            u.radius.value=Math.max(.01,rs*u.birth.value*(1.-shrink*shrink));
            u.pull.value=Math.pow(travel,1.35);
            renderer.render(scene,camera);
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
      canvas?.remove();atmo?.remove();texture?.dispose();material?.dispose();geometry?.dispose();renderer?.dispose();renderer?.forceContextLoss();
      if(oldStyle===null)activeCard.removeAttribute('style');else activeCard.setAttribute('style',oldStyle);
      delete activeCard.dataset.bhBusy;
      if(sceneEl){sceneEl.style.pointerEvents=oldPointer;sceneEl.inert=wasInert;}
      window._sfBHBusy=false;
      if(!cancelled && activeCard.isConnected){
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches) activeCard.animate([{opacity:0,transform:'scale(.88)'},{opacity:1,transform:'scale(1)'}],{duration:380,easing:'cubic-bezier(.2,.7,.2,1)'});
        showToast('床位已清空，按「儲存修改」同步', 'info');
      }
      window._restart3DTimer?.();
    }
  };
})();
