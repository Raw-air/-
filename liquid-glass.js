/* Convex rounded-rectangle lenses. The neutral centre stays still; only the
   perimeter samples displaced page pixels. No turbulence or duplicate icons. */
(() => {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  function node(tag,attrs={}) {const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;}
  function displacement(w,h,r,band,strength) {
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d'),im=ctx.createImageData(w,h),scale=32;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const px=x+.5-w/2,py=y+.5-h/2;
      const qx=Math.max(Math.abs(px)-(w/2-r),0),qy=Math.max(Math.abs(py)-(h/2-r),0);
      const len=Math.hypot(qx,qy),depth=r-len;
      const a=depth>=0&&depth<band?strength*Math.sin(Math.PI*depth/band):0;
      const nx=len?qx/len*Math.sign(px):0,ny=len?qy/len*Math.sign(py):0,k=(y*w+x)*4;
      im.data[k]=Math.round(128+nx*a/scale*255);im.data[k+1]=Math.round(128+ny*a/scale*255);im.data[k+2]=128;im.data[k+3]=255;
    }
    ctx.putImageData(im,0,0);return c.toDataURL();
  }
  window.createLiquidGlass = function(nav,shape){
    const svg=node('svg',{'aria-hidden':'true',width:1,height:1});svg.style.cssText='position:absolute;left:-10px;top:-10px;pointer-events:none';
    const defs=node('defs');svg.append(defs);document.body.append(svg);
    const make=(id)=>{
      const f=node('filter',{id,filterUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'});
      const map=node('feImage',{result:'lensMap',preserveAspectRatio:'none'});
      f.append(map,node('feDisplacementMap',{in:'SourceGraphic',in2:'lensMap',scale:32,xChannelSelector:'R',yChannelSelector:'G'}));defs.append(f);return {f,map};
    };
    const outer=make('nav-convex-refraction'),inner=make('nav-selection-refraction');
    nav.style.setProperty('--nav-refraction','url("#nav-convex-refraction")');
    nav.style.setProperty('--lens-refraction','url("#nav-selection-refraction")');
    // WebKit does not render SVG reference filters in backdrop-filter. Its
    // fallback filters an inert, clipped snapshot of the intersecting DOM scene.
    const native=/Chrome|Chromium|Edg\//.test(navigator.userAgent)&&!(/CriOS/.test(navigator.userAgent));
    nav.dataset.glassRenderer=native?'native':'mirror';
    function glass(parent,cls){
      const g=document.createElement('span');g.className=cls;g.setAttribute('aria-hidden','true');
      g.innerHTML='<span class="glass-backdrop"></span><span class="glass-mirror-clip"><span class="glass-mirror-effect"><span class="glass-scene" inert></span></span></span>';
      parent.prepend(g);return g.querySelector('.glass-scene');
    }
    const outerScene=glass(nav,'nav-glass'),innerScene=glass(shape,'lens-glass');
    let lastW=0,lastH=0,frame=0,timer=0,disposed=false,revision=0;
    function size(){
      const w=Math.round(nav.getBoundingClientRect().width),h=Math.round(nav.clientHeight);
      if(w===lastW&&h===lastH)return;lastW=w;lastH=h;
      for(const [lens,W,H,R,B,S] of [[outer,w,h,h/2,15,12],[inner,84,54,27,12,8]]){
        for(const e of [lens.f,lens.map])for(const [key,val] of Object.entries({x:0,y:0,width:W,height:H}))e.setAttribute(key,val);
        if(!native){lens.f.setAttribute('filterUnits','objectBoundingBox');lens.f.setAttribute('width','1');lens.f.setAttribute('height','1');}
        if(native){const url=displacement(W,H,R,B,S);lens.map.setAttribute('href',url);}
        if(!native){
          // An entirely local primitive field avoids WebKit's feImage security
          // restrictions in CSS filters. Soft directional bands form a lens.
          lens.f.replaceChildren();
          lens.f.append(node('feFlood',{'flood-color':'rgb(128,128,128)',result:'neutral'}));
          const corner=R*(1-Math.SQRT1_2)-3;
          const bands=[['top',0,0,W,4,'rgb(128,250,128)'],['bottom',0,H-4,W,4,'rgb(128,6,128)'],['left',0,0,4,H,'rgb(250,128,128)'],['right',W-4,0,4,H,'rgb(6,128,128)'],['tl',corner,corner,6,6,'rgb(214,214,128)'],['tr',W-corner-6,corner,6,6,'rgb(42,214,128)'],['bl',corner,H-corner-6,6,6,'rgb(214,42,128)'],['br',W-corner-6,H-corner-6,6,6,'rgb(42,42,128)']];
          for(const [id,x,y,width,height,color] of bands)lens.f.append(node('feFlood',{x,y,width,height,'flood-color':color,result:id}));
          const merge=node('feMerge',{result:'bands'});for(const name of ['neutral',...bands.map(b=>b[0])])merge.append(node('feMergeNode',{in:name}));
          lens.f.append(merge,node('feGaussianBlur',{in:'bands',stdDeviation:3,edgeMode:'duplicate',result:'localMap'}),node('feDisplacementMap',{in:'SourceGraphic',in2:'localMap',scale:48,xChannelSelector:'R',yChannelSelector:'G'}));
        }
      }
    }
    function snapshot(){
      if(disposed||document.hidden||!nav.getClientRects().length)return;
      size();if(native||document.body.classList.contains('power-save-mode'))return;
      // GPU readback competes with the particle canvas on iOS. Keep the last
      // inert snapshot during the short dissolve; refresh when it finishes.
      if(window._sfBHBusy)return;
      const box=nav.getBoundingClientRect(),pad=24,frag=document.createDocumentFragment();let budget=350;
      const intersects=r=>r.width>0&&r.height>0&&r.right>box.left-pad&&r.left<box.right+pad&&r.bottom>box.top-pad&&r.top<box.bottom+pad;
      function visit(el){
        if(budget<=0||el===nav||el===svg||/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(el.tagName))return;
        let rect=el.getBoundingClientRect();if(!intersects(rect))return;
        const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0)return;
        budget--;
        let copy;
        if(el instanceof HTMLCanvasElement){
          const left=Math.max(rect.left,box.left-pad),top=Math.max(rect.top,box.top-pad),width=Math.min(rect.right,box.right+pad)-left,height=Math.min(rect.bottom,box.bottom+pad)-top;
          const sx=el.width/rect.width,sy=el.height/rect.height;
          copy=document.createElement('canvas');copy.width=Math.ceil(width*Math.min(devicePixelRatio||1,2));copy.height=Math.ceil(height*Math.min(devicePixelRatio||1,2));
          try{copy.getContext('2d').drawImage(el,(left-rect.left)*sx,(top-rect.top)*sy,width*sx,height*sy,0,0,copy.width,copy.height);}catch(_){}
          rect={left,top,width,height};
        }else if(el instanceof SVGElement){copy=el.cloneNode(true);}
        else if(el.tagName==='IMG'){copy=document.createElement('img');copy.src=el.currentSrc||el.src;}
        else {copy=document.createElement('div');for(const child of el.childNodes)if(child.nodeType===Node.TEXT_NODE)copy.append(document.createTextNode(child.textContent));
          if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)copy.textContent=el.type==='password'?'':el.value;
        }
        // Computed styles preserve theme/typography without duplicate IDs, form
        // controls, listeners, selectors, or focusable/accessibility content.
        for(const key of cs)copy.style.setProperty(key,cs.getPropertyValue(key));
        for(const n of [copy,...copy.querySelectorAll('*')]){n.removeAttribute('id');n.removeAttribute('tabindex');n.removeAttribute('name');for(const a of [...n.attributes])if(a.name.startsWith('on'))n.removeAttribute(a.name);}
        Object.assign(copy.style,{position:'absolute',left:(rect.left-box.left)+'px',top:(rect.top-box.top)+'px',right:'auto',bottom:'auto',width:rect.width+'px',height:rect.height+'px',boxSizing:'border-box',margin:'0',transform:'none',transition:'none',animation:'none',pointerEvents:'none',backdropFilter:'none',webkitBackdropFilter:'none',contentVisibility:'visible'});
        frag.append(copy);
        if(!(el instanceof SVGElement)&&el.tagName!=='CANVAS')for(const child of el.children)visit(child);
      }
      for(const el of document.body.children)visit(el);
      outerScene.replaceChildren(frag);innerScene.replaceChildren(...[...outerScene.children].map(e=>{
        if(e.tagName==='CANVAS'){const c=e.cloneNode();c.getContext('2d').drawImage(e,0,0);return c;}return e.cloneNode(true);
      }));
      nav.dataset.glassRevision=String(++revision);
    }
    function schedule(){if(disposed||frame)return;frame=requestAnimationFrame(()=>{frame=0;snapshot();});}
    function changes(records){
      if(records.every(r=>nav.contains(r.target)||svg.contains(r.target)))return;
      if(!timer)timer=setTimeout(()=>{timer=0;schedule();},80);
    }
    const observer=new MutationObserver(changes);
    if(!native)observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
    const resize=new ResizeObserver(schedule);resize.observe(nav);
    for(const event of ['scroll','resize','app:navigate','input','change'])window.addEventListener(event,schedule,true);
    document.addEventListener('visibilitychange',schedule);schedule();
    return {refresh:schedule,snapshot,get revision(){return revision;},dispose(){disposed=true;observer.disconnect();resize.disconnect();cancelAnimationFrame(frame);clearTimeout(timer);for(const lens of [outer,inner])if(lens.url)URL.revokeObjectURL(lens.url);svg.remove();for(const event of ['scroll','resize','app:navigate','input','change'])window.removeEventListener(event,schedule,true);document.removeEventListener('visibilitychange',schedule);}};
  };
})();
