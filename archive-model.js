/* Continuous folded polypropylene shell. One mesh/camera for all browsers;
   the DOM remains the accessible hit targets and editable paper. No render loop
   runs while the archive is idle. Coordinates share carousel.js's CSS camera. */
(() => {
  'use strict';
  const VS = `
  attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute float region;
  uniform vec3 pose; uniform vec2 viewport; uniform vec2 rotation; uniform float size;
  varying vec3 n; varying vec3 world; varying vec2 texcoord; varying float part;
  void main(){
    vec3 p=position*size;
    world=vec3(rotation.x*p.x+rotation.y*p.z,p.y,-rotation.y*p.x+rotation.x*p.z)+pose;
    n=vec3(rotation.x*normal.x+rotation.y*normal.z,normal.y,-rotation.y*normal.x+rotation.x*normal.z);
    texcoord=uv;part=region;
    float w=1500.0-world.z;
    vec2 projected=vec2(1500.0*world.x,1500.0*world.y+viewport.y*.02*world.z);
    gl_Position=vec4(2.0*projected.x/viewport.x,-2.0*projected.y/viewport.y,((w-10.0)/5000.0*2.0-1.0)*w,w);
  }`;
  const FS = `
  precision mediump float;
  varying vec3 n; varying vec3 world; varying vec2 texcoord; varying float part;
  uniform float alpha;uniform float selected;uniform float light;uniform float mode;
  uniform sampler2D paper;uniform sampler2D label;
  uniform float wipe;uniform float pixelRatio;
  void main(){
    if(gl_FragCoord.x/pixelRatio > wipe) discard;
    vec3 N=normalize(n),V=normalize(vec3(0.0,0.0,1500.0)-world);
    float facing=abs(dot(N,V));
    float fresnel=pow(1.0-facing,2.4);
    if(mode>1.5){vec4 ink=texture2D(label,texcoord);gl_FragColor=vec4(mix(ink.rgb,vec3(.86,1.,.9),selected),ink.a*alpha);return;}
    if(mode>.5){vec4 p=texture2D(paper,texcoord);gl_FragColor=vec4(p.rgb*(.93+.07*facing),p.a*alpha);return;}
    float key=pow(max(0.,dot(reflect(-normalize(vec3(-.55,-.65,1.)),N),V)),34.0);
    float rim=pow(max(0.,dot(reflect(-normalize(vec3(.8,.15,.65)),N),V)),48.0);
    vec3 tint=mix(vec3(.80,.84,.81),vec3(.10,.73,.30),selected);
    vec3 color=mix(tint,vec3(1.),min(.9,fresnel*.6+key*.44+rim*.25));
    float opacity=(.08+.13*part+fresnel*.17+key*.16+rim*.12+light*.04)*alpha;
    if(part>1.5){color=mix(vec3(.88,.94,.90),vec3(.75,1.,.84),selected*.55);opacity=(.68+key*.22)*alpha;}
    gl_FragColor=vec4(color,opacity);
  }`;
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  function normal(a,b,c){
    const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;
    return n.map(x=>x/l);
  }
  function makeGeometry(w,h) {
    const d=w*.041, r=d/2,thickness=.8,cy=h/2-r,profile=[];
    // The front grows smoothly out of the same bottom fold, and flares toward
    // the open mouth. There is no top lid, full-height side wall, or floating rim.
    for(let i=0;i<=28;i++)profile.push({y:-h/2+(h-r)*i/28,z:-r,part:0,end:i===0});
    for(let i=1;i<=24;i++){const a=Math.PI*(1-i/24);profile.push({y:cy+r*Math.sin(a),z:r*Math.cos(a),part:.6});}
    for(let i=1;i<=32;i++){const t=i/32;profile.push({y:cy-(cy+h*.33)*t,z:r+d*.66*Math.pow(t,5),part:1,end:i===32});}
    const data=[],edges=[],front=[];
    const vertex=(arr,p,n,u,v,part)=>arr.push(...p,...n,u,v,part);
    const quad=(arr,a,b,c,d,part,uvs=[[0,0],[1,0],[1,1],[0,1]])=>{
      const n=normal(a,b,c);
      for(const i of [0,1,2,0,2,3])vertex(arr,[a,b,c,d][i],n,...uvs[i],part);
    };
    const point=(i,u,offset=0)=>{
      const p=profile[i],prev=profile[Math.max(0,i-1)],next=profile[Math.min(profile.length-1,i+1)];
      const dy=next.y-prev.y,dz=next.z-prev.z,l=Math.hypot(dy,dz)||1;
      // Rounded top corners are part of the surface, including their thickness.
      const fromEnd=Math.min(i,profile.length-1-i),corner=8,round=fromEnd===0?corner:fromEnd===1?1:0;
      const x=(u-.5)*(w-2*round);
      const lip=i>52 ? h*.025*Math.pow((i-52)/32,8)*Math.pow(2*u-1,4) : 0;
      return [x,p.y+lip+dz/l*offset,p.z-dy/l*offset];
    };
    const U=8;
    for(let i=0;i<profile.length-1;i++){
      for(let j=0;j<U;j++){
        const u=j/U,v=(j+1)/U;
        for(const side of [-1,1]){
          const ps=[point(i,u,side*thickness/2),point(i,v,side*thickness/2),point(i+1,v,side*thickness/2),point(i+1,u,side*thickness/2)];
          if(side<0)ps.reverse();
          quad(data,...ps,profile[i].part);
        }
        if(i===0||i===profile.length-2){const end=i===0?0:profile.length-1;quad(edges,point(end,u,-thickness/2),point(end,v,-thickness/2),point(end,v,thickness/2),point(end,u,thickness/2),2);}
        if(i>=53){
          // Ink sits on the curved pocket itself, so its perspective is identical.
          const uvFor=(idx,uu)=>[uu,(profile[idx].y+h*.33)/(h*.83)];
          quad(front,point(i,u,-.55),point(i,v,-.55),point(i+1,v,-.55),point(i+1,u,-.55),0,
            [uvFor(i,u),uvFor(i,v),uvFor(i+1,v),uvFor(i+1,u)]);
        }
      }
      for(const u of [0,1])quad(edges,point(i,u,-thickness/2),point(i+1,u,-thickness/2),point(i+1,u,thickness/2),point(i,u,thickness/2),2);
    }
    const sheet=[];
    // Inset paper, independent of the plastic sleeve.
    const x=w/2-19,y0=-h/2+22,y1=h/2-15,z=-r+1.5;
    quad(sheet,[-x,y0,z],[x,y0,z],[x,y1,z],[-x,y1,z],0);
    return {shell:new Float32Array(data),edges:new Float32Array(edges),front:new Float32Array(front),paper:new Float32Array(sheet),depth:d};
  }
  function create(area) {
    const canvas=document.createElement('canvas');canvas.className='sf-model-canvas';canvas.setAttribute('aria-hidden','true');
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
    if(!gl)return null;
    function shader(src,type){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    let program;
    try{program=gl.createProgram();const vs=shader(VS,gl.VERTEX_SHADER),fs=shader(FS,gl.FRAGMENT_SHADER);gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));}
    catch(e){console.warn('Archive model unavailable',e);return null;}
    area.prepend(canvas);area.classList.add('sf-model-ready');
    const uniforms={};for(const name of ['pose','viewport','rotation','size','alpha','selected','light','mode','paper','label','wipe','pixelRatio'])uniforms[name]=gl.getUniformLocation(program,name);
    const attrs={};for(const name of ['position','normal','uv','region'])attrs[name]=gl.getAttribLocation(program,name);
    let meshes={},width=0,height=0,fw=0,fh=0,dpr=1,lost=false,last=null,lastSignature='';
    const textures=new Map();
    function texture(source){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
    const paperCanvas=document.createElement('canvas');paperCanvas.width=512;paperCanvas.height=640;
    const pc=paperCanvas.getContext('2d');pc.fillStyle='#eef1ec';pc.fillRect(0,0,512,640);
    pc.fillStyle='#a5b0a6';for(let i=0;i<6;i++){pc.beginPath();pc.roundRect(28,30+i*21,i===0?278:i===5?235:340,6,2);pc.fill();}
    const paperTexture=texture(paperCanvas);
    function labelTexture(entry){
      const name=entry.el.querySelector('.fd-name')?.textContent||'',bed=entry.student?.bed||'',key=name+'|'+bed;
      const old=textures.get(entry.el);if(old?.key===key)return old.texture;
      if(old)gl.deleteTexture(old.texture);
      const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
      ctx.fillStyle='#263c2c';ctx.font='24px sans-serif';ctx.fillText(bed,55,68);
      ctx.beginPath();ctx.arc(33,52,5,0,Math.PI*2);ctx.fill();ctx.fillRect(27,61,12,13);
      ctx.font='25px sans-serif';ctx.fillText(name,27,477,455);
      const t=texture(c);textures.set(entry.el,{key,texture:t});return t;
    }
    function upload(name,array){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);meshes[name]={buffer:b,count:array.length/9};}
    function mesh(name){const m=meshes[name];gl.bindBuffer(gl.ARRAY_BUFFER,m.buffer);let offset=0;for(const [key,size] of [['position',3],['normal',3],['uv',2],['region',1]]){gl.enableVertexAttribArray(attrs[key]);gl.vertexAttribPointer(attrs[key],size,gl.FLOAT,false,36,offset);offset+=size*4;}gl.drawArrays(gl.TRIANGLES,0,m.count);}
    function paint(records,cfg){
      canvas.style.clipPath='';
      last={records,cfg};if(lost||!area.clientWidth)return;
      const W=area.clientWidth,H=area.clientHeight,ratio=Math.min(devicePixelRatio||1,2);
      const signature=[W,H,ratio,cfg.fw,cfg.fh,document.body.classList.contains('light-mode'),...records.map(r=>[r.x,r.y,r.z,r.rot,r.scale,r.alpha,r.entry.el.classList.contains('active'),r.entry.el._modelWipe,r.entry.el.querySelector('.fd-name')?.textContent,r.entry.student?.bed].join(','))].join('|');
      if(signature===lastSignature)return;
      lastSignature=signature;
      if(W!==width||H!==height||ratio!==dpr){width=W;height=H;dpr=ratio;canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);gl.viewport(0,0,canvas.width,canvas.height);}
      if(fw!==cfg.fw||fh!==cfg.fh){fw=cfg.fw;fh=cfg.fh;for(const m of Object.values(meshes))gl.deleteBuffer(m.buffer);meshes={};const geo=makeGeometry(fw,fh);for(const key of ['shell','edges','front','paper'])upload(key,geo[key]);}
      gl.useProgram(program);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DITHER);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(uniforms.viewport,W,H);gl.uniform1f(uniforms.pixelRatio,dpr);gl.uniform1f(uniforms.light,document.body.classList.contains('light-mode')?1:0);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,paperTexture);gl.uniform1i(uniforms.paper,0);gl.uniform1i(uniforms.label,1);
      const sorted=records.slice().sort((a,b)=>a.z-b.z);
      const visibleElements=new Set(records.map(r=>r.entry.el));for(const [el,t] of textures)if(!visibleElements.has(el)){gl.deleteTexture(t.texture);textures.delete(el);}
      function pose(r){const a=r.rot*Math.PI/180;gl.uniform3f(uniforms.pose,r.x,r.y,r.z);gl.uniform2f(uniforms.rotation,Math.cos(a),Math.sin(a));gl.uniform1f(uniforms.size,r.scale);gl.uniform1f(uniforms.alpha,r.alpha);gl.uniform1f(uniforms.selected,r.entry.el.classList.contains('active')?1:0);gl.uniform1f(uniforms.wipe,r.entry.el._modelWipe??10000);}
      // Opaque paper establishes depth, then translucent plastic and its actual
      // narrow cut edges catch light. Never flatten one folder into the next.
      gl.depthMask(true);gl.uniform1f(uniforms.mode,1);for(const r of sorted){pose(r);mesh('paper');}
      gl.depthMask(false);gl.uniform1f(uniforms.mode,0);for(const r of sorted){pose(r);mesh('shell');mesh('edges');}
      gl.uniform1f(uniforms.mode,2);for(const r of sorted){pose(r);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,labelTexture(r.entry));mesh('front');}
      gl.depthMask(true);
    }
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;area.classList.remove('sf-model-ready');});
    canvas.addEventListener('webglcontextrestored',()=>{dispose();window.sfArchiveModel=create(area);window.sfCarousel?.paint();});
    function repaint(){
      if(!last)return;
      const single=last.records.length===1?last.records[0]:null;
      if(single&&single.entry.el._modelWipe!==undefined){
        // An open editor has already moved every neighbour offstage. Let the
        // compositor wipe its cached image while particles animate; do not
        // re-shade the entire plastic mesh for every dust frame.
        canvas.style.clipPath=`inset(0 ${Math.max(0,width-single.entry.el._modelWipe)}px 0 0)`;
        return;
      }
      paint(last.records,last.cfg);
    }
    const observer=new MutationObserver(repaint);observer.observe(document.body,{attributes:true,attributeFilter:['class']});
    function dispose(){observer.disconnect();for(const m of Object.values(meshes))gl.deleteBuffer(m.buffer);for(const t of textures.values())gl.deleteTexture(t.texture);textures.clear();gl.deleteTexture(paperTexture);gl.deleteProgram(program);canvas.remove();area.classList.remove('sf-model-ready');}
    function hitTest(clientX,clientY){
      if(lost||!last)return null;
      const b=canvas.getBoundingClientRect(),sx=clientX-b.left-width/2,sy=clientY-b.top-height/2;
      // Ray/plane intersection shares the exact camera used by the mesh. DOM
      // 3D hit regions differ between engines; the editor still uses native DOM.
      let hit=null,nearest=Infinity;
      for(const r of last.records){
        if(r.alpha<.1)continue;
        const a=r.rot*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
        const ox=-r.x,oy=-height*.02-r.y,oz=1500-r.z;
        const dx=sx/1500,dy=(sy+height*.02)/1500,dz=-1;
        const denom=s*dx+c*dz;if(Math.abs(denom)<1e-5)continue;
        const t=-(s*ox+c*oz)/denom;if(t<0||t>=nearest)continue;
        const x=(c*(ox+t*dx)-s*(oz+t*dz))/r.scale,y=(oy+t*dy)/r.scale;
        if(Math.abs(x)<=fw/2+fw*.025&&Math.abs(y)<=fh/2){hit=r.entry.el;nearest=t;}
      }
      return hit;
    }
    return {paint,repaint,dispose,hitTest,canvas,get records(){return last?.records||[];},get geometry(){return {width:fw,height:fh,depth:fw*.041};}};
  }
  window.createArchiveModel=create;
})();
