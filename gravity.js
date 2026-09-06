// Capture once; all lensing, tears and dust thereafter stay on the GPU.
async function captureGravityScene(card) {
  await sfPrefetchHtml2Canvas();
  if(!window.html2canvas)throw Error('Snapshot renderer unavailable');
  const key='gravity-'+Date.now();card.dataset.gravityCapture=key;
  const flatten=doc=>{
    const style=doc.createElement('style');
    style.textContent=`.page{animation:none!important;transition:none!important;}
      .sf-student-card-2d,.sf-student-card-2d *,.sf-student-card-2d::before,.sf-student-card-2d::after{transform-style:flat!important;animation:none!important;transition:none!important;}
      .sf-student-card-2d *,.sf-student-card-2d::after{transform:none!important;}
      .sf-student-card-2d::before{display:none!important;}
      .sf-student-card-2d{isolation:isolate!important;}
      .sf-student-card-2d::after{z-index:0!important;}
      .sf-student-card-2d>*{position:relative;z-index:1;}
      .sf-form-group input,.sf-form-group textarea{box-shadow:none!important;background:${document.body.classList.contains('light-mode')?'#e3e5e9':'#24252d'}!important;}`;
    doc.head.appendChild(style);
  };
  try {
    const rect=card.getBoundingClientRect();
    const cardImage=await html2canvas(card,{backgroundColor:null,scale:Math.min(devicePixelRatio||1,2),imageTimeout:1200,useCORS:true,logging:false,onclone:flatten});
    const background=await html2canvas(document.body,{
      backgroundColor:getComputedStyle(document.body).backgroundColor,
      x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,
      windowWidth:innerWidth,windowHeight:innerHeight,scale:Math.min(devicePixelRatio||1,1.5),imageTimeout:1200,useCORS:true,logging:false,
      onclone:doc=>{flatten(doc);const target=doc.querySelector(`[data-gravity-capture="${key}"]`);if(target)target.style.visibility='hidden';const nav=doc.querySelector('.bottom-nav');if(nav)nav.style.visibility='hidden';}
    });
    return {cardImage,background,rect};
  } finally {delete card.dataset.gravityCapture;}
}

function createGravityScene({cardImage,background,rect},hx,hy,rs){
  const w=innerWidth,h=innerHeight,objects=[];
  const keep=o=>(objects.push(o),o);
  const renderer=new THREE.WebGLRenderer({alpha:false,antialias:false,powerPreference:'high-performance'});
  const dpr=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1400000/(w*h)));
  renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);
  const canvas=renderer.domElement;canvas.className='bh-webgl-layer on';canvas.style.transition='none';
  const camera=new THREE.Camera(),scene=new THREE.Scene(),screen=new THREE.Scene();
  const tex=source=>{const t=keep(new THREE.CanvasTexture(source));t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;return t;};
  const cardTexture=tex(cardImage),backgroundTexture=tex(background);
  const target=keep(new THREE.WebGLRenderTarget(Math.floor(w*dpr),Math.floor(h*dpr),{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false}));
  const common={uResolution:{value:new THREE.Vector2(w,h)},uHole:{value:new THREE.Vector2(hx,hy)},uTime:{value:0},uPull:{value:0},uBirth:{value:0},uCollapse:{value:0},uRadius:{value:rs}};
  const vertices=[],uvs=[],centers=[],seeds=[],bary=[];
  const random=i=>{const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);};
  const cols=12,rows=9,grid=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++)grid.push([(x+(x&&x<cols?(random(y*cols+x)-.5)*.55:0))/cols,(y+(y&&y<rows?(random(y*cols+x+7)-.5)*.55:0))/rows]);
  function triangle(a,b,c,id){
    const points=[grid[a],grid[b],grid[c]],center=[0,0];points.forEach(p=>{center[0]+=p[0]/3;center[1]+=p[1]/3;});
    for(const p of points){vertices.push(p[0]*rect.width,p[1]*rect.height,0);uvs.push(p[0],1-p[1]);centers.push(center[0]*rect.width,center[1]*rect.height);seeds.push(random(id));}
    bary.push(1,0,0,0,1,0,0,0,1);
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;triangle(a,b,c,a*2);triangle(b,d,c,a*2+1);}
  const geom=keep(new THREE.BufferGeometry());
  geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geom.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geom.setAttribute('aCenter',new THREE.Float32BufferAttribute(centers,2));geom.setAttribute('aSeed',new THREE.Float32BufferAttribute(seeds,1));
  geom.setAttribute('aBary',new THREE.Float32BufferAttribute(bary,3));
  const mat=keep(new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{...common,uTexture:{value:cardTexture},uRect:{value:new THREE.Vector4(rect.left,rect.top,rect.width,rect.height)}},
    vertexShader:`
      attribute vec2 aCenter;attribute float aSeed;attribute vec3 aBary;varying vec3 vBary;varying vec2 vUv;varying float vHeat,vAlpha;
      uniform vec2 uResolution,uHole;uniform vec4 uRect;uniform float uPull;
      mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
      void main(){
        vUv=uv;vBary=aBary;float delay=.07+(aCenter.y/uRect.w)*.24+aSeed*.16;
        float t=smoothstep(delay,1.,uPull);vHeat=t;vAlpha=1.-smoothstep(.88,1.,t);
        vec2 center=uRect.xy+aCenter,offset=position.xy-aCenter;
        vec2 axis=normalize(uHole-center),side=vec2(-axis.y,axis.x);
        float stretch=1.+sin(t*3.14159)*2.;
        offset=axis*dot(offset,axis)*stretch+side*dot(offset,side)*(1.-t*.7);
        offset=rot(t*(aSeed-.5)*7.)*offset*(1.-t*.98);
        vec2 orbit=center-uHole;
        center=uHole+rot(t*t*(1.4+aSeed*2.4))*orbit*(1.-pow(t,1.35));
        vec2 p=center+offset;
        gl_Position=vec4(p.x/uResolution.x*2.-1.,1.-p.y/uResolution.y*2.,0.,1.);
      }`,
    fragmentShader:`uniform sampler2D uTexture;varying vec2 vUv;varying vec3 vBary;varying float vHeat,vAlpha;
      void main(){vec4 c=texture2D(uTexture,vUv);if(c.a<.01)discard;
      c.rgb=mix(c.rgb,c.rgb*vec3(1.3,1.07,.87)+vec3(.10,.025,.005),vHeat*.5);
      float edge=1.-smoothstep(0.,.035,min(vBary.x,min(vBary.y,vBary.z)));
      c.rgb+=vec3(.8,.35,.09)*edge*smoothstep(.05,.6,vHeat)*.55;
      gl_FragColor=vec4(c.rgb,c.a*vAlpha);}`
  }));
  const mesh=new THREE.Mesh(geom,mat);mesh.frustumCulled=false;mesh.renderOrder=1;scene.add(mesh);
  const count=w<600?850:1400,data=[],positions=[];
  for(let i=0;i<count;i++){data.push(random(i+1),random(i+2001),random(i+4001),random(i+6001));positions.push(0,0,0);}
  const dustGeom=keep(new THREE.BufferGeometry());dustGeom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));dustGeom.setAttribute('aData',new THREE.Float32BufferAttribute(data,4));
  const dustMat=keep(new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{...common,uDpr:{value:dpr}},
    vertexShader:`attribute vec4 aData;uniform vec2 uResolution,uHole;uniform float uTime,uRadius,uDpr,uBirth,uCollapse;varying float vAlpha,vHot;
    void main(){float cycle=fract(aData.z+uTime*(.05+aData.y*.075));float r=uRadius*(1.05+pow(1.-cycle,1.5)*6.5);
      float angle=aData.x*6.28318+uTime*(.5+aData.y*1.8)+cycle*3.;
      vec2 p=uHole+vec2(cos(angle)*r,sin(angle)*r*.31+(aData.w-.5)*r*.12);
      vAlpha=uBirth*(1.-uCollapse)*sin(cycle*3.14159)*(.25+aData.w*.7);vHot=cycle;
      gl_Position=vec4(p.x/uResolution.x*2.-1.,1.-p.y/uResolution.y*2.,0.,1.);gl_PointSize=(.7+aData.w*2.)*uDpr;}`,
    fragmentShader:`varying float vAlpha,vHot;void main(){vec2 p=gl_PointCoord-.5;float a=exp(-dot(p,p)*18.)*vAlpha;gl_FragColor=vec4(mix(vec3(.85,.48,.20),vec3(1.,.96,.85),vHot),a);}`
  }));
  const dust=new THREE.Points(dustGeom,dustMat);dust.frustumCulled=false;scene.add(dust);
  const screenMat=keep(new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{...common,uBackground:{value:backgroundTexture},uFragments:{value:target.texture},uDpr:{value:dpr},uBaseRadius:{value:rs}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`
    uniform sampler2D uBackground,uFragments;uniform vec2 uResolution,uHole;uniform float uDpr,uTime,uPull,uBirth,uCollapse,uRadius,uBaseRadius;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
    float fbm(vec2 p){return noise(p)*.57+noise(p*2.1)*.28+noise(p*4.2)*.15;}
    vec3 sampleScene(vec2 p){vec2 uv=vec2(p.x/uResolution.x,1.-p.y/uResolution.y);vec3 bg=texture2D(uBackground,clamp(uv,.001,.999)).rgb;
      vec4 c=texture2D(uFragments,clamp(uv,.001,.999));return bg*(1.-c.a)+c.rgb;}
    void main(){
      vec2 p=vec2(gl_FragCoord.x/uDpr,uResolution.y-gl_FragCoord.y/uDpr);
      float strength=uBirth*(1.-uCollapse);
      vec2 shake=vec2(sin(uTime*47.)+sin(uTime*71.)*.4,cos(uTime*53.)*.65)*strength*(1.1+uPull*2.3+3.*exp(-uTime*3.));
      p+=shake;vec2 q=p-uHole;float r=length(q),rs=max(uRadius,.01),nr=r/rs;
      // Large Einstein radius visibly bends NEIGHBOURING cards as well as torn fragments.
      float lens=rs*rs*3.7/max(r,rs*.65)*strength*(1.-smoothstep(7.,14.,r/max(uBaseRadius,1.)));
      vec2 src=p-q/max(r,1.)*lens;
      vec3 color=sampleScene(src)*(1.-strength*.16);
      if(nr>12.||uBirth<.001){gl_FragColor=vec4(color,1.);return;}
      float shadow=1.-smoothstep(.984,1.008,nr);color*=1.-shadow*strength;
      vec2 diskP=vec2(q.x,q.y/.22);float dr=length(diskP)/rs,angle=atan(diskP.y,diskP.x);
      float density=fbm(vec2(dr*18.-uTime*.6,angle*8.+uTime*2.7));
      float streak=.35+.65*pow(density,1.5);
      float band=smoothstep(1.15,1.5,dr)*(1.-smoothstep(3.2,5.,dr));
      float disk=band*streak*pow(1.4/max(dr,1.4),1.5)*2.3;
      disk*=q.y>0.?1.:1.-shadow;
      float rearR=length(vec2(q.x,q.y*.78))/rs;
      float rear=exp(-pow((rearR-1.3)*12.,2.))*(.35+.5*density)*(q.y<0.?1.:.28);
      float photon=exp(-abs(nr-1.02)*110.)*1.5;
      float glow=exp(-abs(nr-1.04)*9.)*.14;
      float doppler=1.+q.x/max(r,1.)*.65;
      float light=(disk*doppler+rear+photon+glow)*strength;
      vec3 fire=mix(vec3(.95,.43,.12),vec3(1.,.95,.82),clamp(light*1.4,0.,1.));
      color+=fire*(1.-exp(-light*1.8));
      gl_FragColor=vec4(color,1.);
    }`
  }));
  const screenGeom=keep(new THREE.PlaneGeometry(2,2));screen.add(new THREE.Mesh(screenGeom,screenMat));
  return {canvas,
    render(seconds,p){
      const born=Math.min(1,p/.17),collapse=Math.max(0,(p-.88)/.12);
      common.uTime.value=seconds;common.uBirth.value=born*born*(3-2*born);common.uCollapse.value=collapse;
      common.uPull.value=Math.max(0,Math.min(1,(p-.12)/.72));common.uRadius.value=Math.max(.01,rs*common.uBirth.value*(1-collapse*collapse));
      renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
      renderer.setRenderTarget(null);renderer.setClearColor(0,1);renderer.render(screen,camera);
    },
    dispose(){objects.forEach(o=>o.dispose());renderer.dispose();renderer.forceContextLoss();}
  };
}
