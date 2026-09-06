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
  // html2canvas 一律複製整份文件，所以「不複製用不到的子樹」是最大的一筆加速。
  const body=document.body;
  const cardOnly=el=>body.contains(el)&&!(el===card||card.contains(el)||el.contains(card));
  const offscreen=el=>{
    const cl=el.classList;if(!cl)return false;
    if(cl.contains('page')&&!cl.contains('active'))return true;   // 非目前分頁 display:none
    if(cl.contains('sf-far'))return true;                          // 回收池裡看不到的卡片
    if(cl.contains('bottom-nav')||cl.contains('bottom-nav-glow'))return true; // 本來就要藏起來
    if(cl.contains('bh-webgl-layer')||cl.contains('bh-seed')||cl.contains('bh-seed-dim')||cl.contains('bh-atmo')||cl.contains('bh-final-star'))return true;
    return false;
  };
  try {
    const rect=card.getBoundingClientRect();
    const dpr=devicePixelRatio||1;
    // 卡片貼圖 scale ≤ 1.5、背景手機 scale 1：像素少一半，成形速度優先。
    const cardImage=await html2canvas(card,{backgroundColor:null,scale:Math.min(dpr,1.5),imageTimeout:600,useCORS:true,logging:false,onclone:flatten,ignoreElements:cardOnly});
    const background=await html2canvas(document.body,{
      backgroundColor:getComputedStyle(document.body).backgroundColor,
      x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,
      windowWidth:innerWidth,windowHeight:innerHeight,
      scale:innerWidth<700?1:Math.min(dpr,1.25),imageTimeout:600,useCORS:true,logging:false,
      ignoreElements:offscreen,
      onclone:doc=>{flatten(doc);const target=doc.querySelector(`[data-gravity-capture="${key}"]`);if(target)target.style.visibility='hidden';}
    });
    // 左右鄰卡的矩形：螢幕 shader 用來讓它們「抵抗引力」發抖。
    const cx=rect.left+rect.width/2;
    const neighbours=Array.from(document.querySelectorAll('.sf-student-card-2d:not(.sf-far)'))
      .filter(el=>el!==card)
      .map(el=>el.getBoundingClientRect())
      .filter(r=>r.width>1&&r.right>0&&r.left<innerWidth)
      .sort((a,b)=>Math.abs(a.left+a.width/2-cx)-Math.abs(b.left+b.width/2-cx))
      .slice(0,4);
    return {cardImage,background,rect,neighbours};
  } finally {delete card.dataset.gravityCapture;}
}

// 吸積盤的基底（視空間 x 右、y 上、z 朝觀察者）：
//   傾斜軸 -45° → 畫面上長軸左高右低；俯視傾角 cos = 0.42 → 可見橢圓短軸/長軸 = 0.42。
//   盤面法線朝觀察者，所以看得到盤的上表面；靠下方那半在球體前面，上方那半被球體擋住。
const BH_GLSL_DISK=`
const vec3 DU=vec3(0.70711,-0.70711,0.0);
const vec3 DV=vec3(0.29698,0.29698,-0.90741);
const vec3 DN=vec3(0.64167,0.64167,0.42);
const float R_IN=1.35,R_OUT=4.30;
// 盤上一點投影到畫面（y 向下）的方向，長度即橢圓壓縮量
vec2 diskDir(float a){return cos(a)*vec2(0.70711,0.70711)+sin(a)*vec2(0.29698,-0.29698);}
// 由畫面方向反推盤上的方位角
float diskAngle(vec2 d){
  float c=(d.x*(-0.29698)-d.y*0.29698)/(-0.42);
  float s=(0.70711*d.y-0.70711*d.x)/(-0.42);
  return atan(s,c);
}`;

const BH_GLSL_NOISE=`
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.64+noise(p*2.17)*.36;}`;

function createGravityScene({cardImage,background,rect,neighbours},hx,hy,rs){
  const w=innerWidth,h=innerHeight,objects=[],mobile=w<600;
  const keep=o=>(objects.push(o),o);
  const renderer=new THREE.WebGLRenderer({alpha:false,antialias:false,powerPreference:'high-performance'});
  let dpr=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1400000/(w*h)));
  const dprUniform={value:dpr};
  renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);
  const canvas=renderer.domElement;canvas.className='bh-webgl-layer on';canvas.style.transition='none';
  const camera=new THREE.Camera(),scene=new THREE.Scene(),screen=new THREE.Scene();
  const tex=source=>{const t=keep(new THREE.CanvasTexture(source));t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;return t;};
  const cardTexture=tex(cardImage),backgroundTexture=tex(background);
  const target=keep(new THREE.WebGLRenderTarget(Math.floor(w*dpr),Math.floor(h*dpr),{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false}));
  const common={uResolution:{value:new THREE.Vector2(w,h)},uHole:{value:new THREE.Vector2(hx,hy)},uTime:{value:0},uPull:{value:0},uBirth:{value:0},uCollapse:{value:0},uRadius:{value:rs}};
  const rectUniform={value:new THREE.Vector4(rect.left,rect.top,rect.width,rect.height)};
  const shakeVec=new THREE.Vector2();   // 引力震動在 CPU 算好，省下每畫素三次三角函數

  // ── 卡片撕裂：216 片不規則三角形 ──────────────────────────────────────────
  const vertices=[],uvs=[],centers=[],seeds=[],bary=[],fragCenters=[];
  const random=i=>{const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);};
  const cols=12,rows=9,grid=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++)grid.push([(x+(x&&x<cols?(random(y*cols+x)-.5)*.55:0))/cols,(y+(y&&y<rows?(random(y*cols+x+7)-.5)*.55:0))/rows]);
  function triangle(a,b,c,id){
    const points=[grid[a],grid[b],grid[c]],center=[0,0];points.forEach(p=>{center[0]+=p[0]/3;center[1]+=p[1]/3;});
    for(const p of points){vertices.push(p[0]*rect.width,p[1]*rect.height,0);uvs.push(p[0],1-p[1]);centers.push(center[0]*rect.width,center[1]*rect.height);seeds.push(random(id));}
    bary.push(1,0,0,0,1,0,0,0,1);
    fragCenters.push(center[0],center[1],random(id));
  }
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;triangle(a,b,c,a*2);triangle(b,d,c,a*2+1);}
  const geom=keep(new THREE.BufferGeometry());
  geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geom.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geom.setAttribute('aCenter',new THREE.Float32BufferAttribute(centers,2));geom.setAttribute('aSeed',new THREE.Float32BufferAttribute(seeds,1));
  geom.setAttribute('aBary',new THREE.Float32BufferAttribute(bary,3));
  const mat=keep(new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{...common,uTexture:{value:cardTexture},uRect:rectUniform},
    vertexShader:`
      attribute vec2 aCenter;attribute float aSeed;attribute vec3 aBary;varying vec3 vBary;varying vec2 vUv;varying float vHeat,vAlpha;
      uniform vec2 uResolution,uHole;uniform vec4 uRect;uniform float uPull;
      mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
      void main(){
        vUv=uv;vBary=aBary;float delay=.05+(aCenter.y/uRect.w)*.20+aSeed*.14;
        float t=smoothstep(delay,1.,uPull);vHeat=t;
        // 碎片在半途就化成粉塵，之後由 dust 接手
        vAlpha=1.-smoothstep(.42,.80,t);
        vec2 center=uRect.xy+aCenter,offset=position.xy-aCenter;
        vec2 axis=normalize(uHole-center),side=vec2(-axis.y,axis.x);
        float stretch=1.+sin(t*3.14159)*2.2;
        offset=axis*dot(offset,axis)*stretch+side*dot(offset,side)*(1.-t*.7);
        offset=rot(t*(aSeed-.5)*7.)*offset*(1.-t*.9);
        vec2 orbit=center-uHole;
        center=uHole+rot(t*t*(1.5+aSeed*2.4))*orbit*(1.-pow(t,1.35));
        vec2 p=center+offset;
        gl_Position=vec4(p.x/uResolution.x*2.-1.,1.-p.y/uResolution.y*2.,0.,1.);
      }`,
    fragmentShader:`uniform sampler2D uTexture;varying vec2 vUv;varying vec3 vBary;varying float vHeat,vAlpha;
      void main(){vec4 c=texture2D(uTexture,vUv);if(c.a<.01)discard;
      c.rgb=mix(c.rgb,c.rgb*vec3(1.3,1.07,.87)+vec3(.10,.025,.005),vHeat*.6);
      float edge=1.-smoothstep(0.,.035,min(vBary.x,min(vBary.y,vBary.z)));
      c.rgb+=vec3(.9,.4,.10)*edge*smoothstep(.05,.6,vHeat)*.85;
      c.rgb+=vec3(1.,.52,.16)*vHeat*vHeat*.30;
      gl_FragColor=vec4(c.rgb,c.a*vAlpha);}`
  }));
  const mesh=new THREE.Mesh(geom,mat);mesh.frustumCulled=false;mesh.renderOrder=1;scene.add(mesh);

  // ── 粉塵：每片碎片配數十顆，顏色照該碎片的 UV 從卡片貼圖取樣 ──────────────
  const dustPer=mobile?10:18,dustCount=fragCenters.length/3*dustPer;
  const dPos=new Float32Array(dustCount*3),dUv=new Float32Array(dustCount*2),dCenter=new Float32Array(dustCount*2),dSeed=new Float32Array(dustCount),dRand=new Float32Array(dustCount*3);
  for(let f=0,n=0;f<fragCenters.length/3;f++){
    const cxp=fragCenters[f*3],cyp=fragCenters[f*3+1],sd=fragCenters[f*3+2];
    for(let k=0;k<dustPer;k++,n++){
      const r1=random(n*3+11),r2=random(n*3+911),r3=random(n*3+2311);
      const px=cxp+(r1-.5)*rect.width/cols*1.1,py=cyp+(r2-.5)*rect.height/rows*1.1;
      dCenter[n*2]=cxp;dCenter[n*2+1]=cyp;
      dUv[n*2]=Math.min(.999,Math.max(.001,px/rect.width));dUv[n*2+1]=1-Math.min(.999,Math.max(.001,py/rect.height));
      dSeed[n]=sd;dRand[n*3]=r1;dRand[n*3+1]=r2;dRand[n*3+2]=r3;
    }
  }
  const dustGeom=keep(new THREE.BufferGeometry());
  dustGeom.setAttribute('position',new THREE.BufferAttribute(dPos,3));
  dustGeom.setAttribute('aUv',new THREE.BufferAttribute(dUv,2));
  dustGeom.setAttribute('aCenter',new THREE.BufferAttribute(dCenter,2));
  dustGeom.setAttribute('aSeed',new THREE.BufferAttribute(dSeed,1));
  dustGeom.setAttribute('aRand',new THREE.BufferAttribute(dRand,3));
  const dustMat=keep(new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,
    uniforms:{...common,uTexture:{value:cardTexture},uRect:rectUniform,uDpr:dprUniform},
    vertexShader:BH_GLSL_DISK+`
      attribute vec2 aUv;attribute vec2 aCenter;attribute float aSeed;attribute vec3 aRand;
      uniform vec2 uResolution,uHole;uniform vec4 uRect;uniform float uPull,uTime,uDpr,uRadius,uBirth,uCollapse;
      varying vec2 vUv;varying float vAlpha,vHot;
      mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
      void main(){
        vUv=aUv;
        float delay=.05+(aCenter.y/uRect.w)*.20+aSeed*.14;
        float t=smoothstep(delay,1.,uPull);
        vec2 center=uRect.xy+aCenter,orbit=center-uHole;
        vec2 frag=uHole+rot(t*t*(1.5+aSeed*2.4))*orbit*(1.-pow(t,1.35));
        frag+=(aRand.xy-.5)*vec2(uRect.z/12.,uRect.w/9.)*(1.-t*.55);
        // Telegram 式：碎片先「噗」地散開成細粉塵，再沿盤面平面螺旋落入視界
        vec2 puff=normalize(frag-center+vec2(aRand.x-.5,aRand.y-.5)*.001);
        frag+=puff*(6.+aRand.z*26.)*sin(min(t,1.)*3.14159)*(.35+aSeed*.65);
        float ts=.30+aRand.z*.20;
        float k=smoothstep(ts,min(ts+.50,.995),t);
        vec2 d=frag-uHole;float dl=max(length(d),.001);
        float ang=diskAngle(d/dl);
        float ell=max(length(diskDir(ang)),.05);
        float rd0=dl/(max(uRadius,1.)*ell);
        float rd=mix(rd0,.35,k*k);
        ang+=k*k*(4.2+aRand.z*3.4)+uTime*.35*k;
        vec2 p=uHole+diskDir(ang)*rd*uRadius;
        p=mix(frag,p,k);
        float alive=smoothstep(0.,.10,t)*(1.-smoothstep(.965,1.,t));
        // 距離感：越靠近視界的粒子越小、越暗，像被吸進深處一樣
        float near=smoothstep(2.4,.42,rd);
        vAlpha=alive*uBirth*(1.-uCollapse)*(.55+aRand.x*.85)*smoothstep(.42,1.25,rd)*(1.-near*.45);
        vHot=clamp(k*1.1+(1.-smoothstep(1.2,4.,rd))*.5,0.,1.);
        gl_PointSize=max(.6,(.85+aRand.y*2.0)*uDpr*(1.-k*.22)*(1.-near*.72));
        gl_Position=vec4(p.x/uResolution.x*2.-1.,1.-p.y/uResolution.y*2.,0.,1.);
      }`,
    fragmentShader:`uniform sampler2D uTexture;varying vec2 vUv;varying float vAlpha,vHot;
      void main(){vec2 pc=gl_PointCoord-.5;float a=exp(-dot(pc,pc)*13.)*vAlpha;
      if(a<.004)discard;
      vec3 c=texture2D(uTexture,vUv).rgb*1.15+vec3(.03,.015,.01);
      c=mix(c,vec3(1.,.80,.52),vHot*.8);
      gl_FragColor=vec4(c,a);}`
  }));
  const dust=new THREE.Points(dustGeom,dustMat);dust.frustumCulled=false;dust.renderOrder=2;scene.add(dust);

  // ── 畫面外側飛入的粒子流：沿盤面被吸入，純氣氛用 ────────────────────────
  const inCount=mobile?600:1300,inData=new Float32Array(inCount*4),inPos=new Float32Array(inCount*3);
  for(let i=0;i<inCount;i++){inData[i*4]=random(i+31);inData[i*4+1]=random(i+5231);inData[i*4+2]=random(i+9231);inData[i*4+3]=random(i+14231);}
  const inGeom=keep(new THREE.BufferGeometry());
  inGeom.setAttribute('position',new THREE.BufferAttribute(inPos,3));
  inGeom.setAttribute('aData',new THREE.BufferAttribute(inData,4));
  const inMat=keep(new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,
    uniforms:{...common,uDpr:dprUniform,uSpan:{value:Math.hypot(w,h)/rs}},
    vertexShader:BH_GLSL_DISK+`
      attribute vec4 aData;uniform vec2 uResolution,uHole;uniform float uTime,uRadius,uDpr,uPull,uBirth,uCollapse,uSpan;
      varying float vAlpha,vHot;
      void main(){
        float gate=smoothstep(.12,.34,uPull)*uBirth*(1.-uCollapse);
        float c=fract(aData.z+uTime*(.20+aData.y*.26));
        float rd=mix(uSpan*(.75+aData.y*.75),.30,pow(c,1.8));
        float ang=aData.x*6.28318+pow(c,1.7)*(3.0+aData.y*3.2);
        vec2 p=uHole+diskDir(ang)*rd*uRadius;
        float speed=.35+1.25*c;
        vAlpha=gate*smoothstep(0.,.08,c)*(1.-smoothstep(.86,1.,c))*(.45+aData.w*1.05)*speed*smoothstep(.5,1.3,rd);
        vHot=c;
        gl_PointSize=max(1.,(.7+aData.w*1.9)*uDpr*(1.-c*.55));
        gl_Position=vec4(p.x/uResolution.x*2.-1.,1.-p.y/uResolution.y*2.,0.,1.);
      }`,
    fragmentShader:`varying float vAlpha,vHot;
      void main(){vec2 pc=gl_PointCoord-.5;float a=exp(-dot(pc,pc)*16.)*vAlpha;
      if(a<.004)discard;
      gl_FragColor=vec4(mix(vec3(.78,.45,.22),vec3(1.,.95,.86),vHot*vHot),a);}`
  }));
  const inflow=new THREE.Points(inGeom,inMat);inflow.frustumCulled=false;inflow.renderOrder=0;scene.add(inflow);

  // ── 全螢幕合成 pass：透鏡、黑洞球體、吸積盤、鄰卡顫抖、變暗與暗角 ────────
  const cards=[new THREE.Vector4(),new THREE.Vector4(),new THREE.Vector4(),new THREE.Vector4()];
  const cardAim=[new THREE.Vector4(),new THREE.Vector4(),new THREE.Vector4(),new THREE.Vector4()];
  (neighbours||[]).slice(0,4).forEach((r,i)=>{
    cards[i].set(r.left,r.top,r.right,r.bottom);
    const mx=r.left+r.width/2,my=r.top+r.height/2;
    const dx=hx-mx,dy=hy-my,d=Math.max(1,Math.hypot(dx,dy));
    const fall=1-Math.min(1,Math.max(0,(d-140)/580));           // 離黑洞越遠抖越小
    const ux=dx/d,uy=dy/d;
    cardAim[i].set(ux,uy,1.1+2.6*fall*fall,ux*mx+uy*my);
  });
  const screenMat=keep(new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
    uniforms:{...common,uBackground:{value:backgroundTexture},uFragments:{value:target.texture},uDpr:dprUniform,uBaseRadius:{value:rs},uCards:{value:cards},uCardAim:{value:cardAim},uShake:{value:shakeVec},uDim:{value:1}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:BH_GLSL_NOISE+BH_GLSL_DISK+`
    uniform sampler2D uBackground,uFragments;uniform vec2 uResolution,uHole;
    uniform float uDpr,uTime,uPull,uBirth,uCollapse,uRadius,uBaseRadius,uDim;
    uniform vec2 uShake;
    uniform vec4 uCards[4],uCardAim[4];
    // 盤面（法線 DN、離原點高度 hgt）與正交視線的交點
    vec3 planeHit(vec2 U,float hgt){return vec3(U,(hgt-DN.x*U.x-DN.y*U.y)/DN.z);}
    // 盤的一層：hgt 是離盤面的高度，兩層疊出厚度；rotc / ang 由中間層算好共用
    vec3 diskLayer(vec2 U,float hgt,vec2 rotc,float ang,float grain,out float front){
      vec3 P=planeHit(U,hgt);
      float rd=length(P);
      front=step(0.,P.z);
      float band=smoothstep(R_IN,R_IN+.18,rd)*(1.-smoothstep(R_OUT-1.15,R_OUT,rd));
      if(band<=0.0002){return vec3(0.);}
      float a=dot(P,DU),b=dot(P,DV);
      vec2 dp=vec2(a*rotc.x-b*rotc.y,a*rotc.y+b*rotc.x);
      float dens=fbm(dp*2.6+grain);
      // sin(整數倍方位角) 沒有接縫，做出旋臂狀的細絲
      dens*=.40+.60*(.5+.5*sin(3.*ang+rd*3.1-uTime*2.4));
      float streak=.16+1.95*dens*dens;
      float heat=1.-smoothstep(R_IN,R_OUT+.25,rd);
      vec3 col=mix(vec3(1.,.28,.045),vec3(1.,.96,.90),heat*sqrt(heat));
      // 都卜勒：往觀察者轉的那半更亮更白
      float dop=1.+.72*(.64167*(P.y-P.x))/max(rd,.001);
      col=mix(col,vec3(.92,.96,1.),clamp((dop-1.)*.9,0.,.7));
      float iv=R_IN/max(rd,R_IN);
      float bright=band*streak*dop*dop*iv*sqrt(iv);
      return col*bright;
    }
    // 鄰卡顫抖：共用一組高頻位移，每張卡只剩矩形遮罩與一次乘加
    vec2 cardShake(vec4 c,vec4 aim,vec2 p,vec2 j,float amp){
      vec2 inside=step(c.xy,p)*step(p,c.zw);
      float m=inside.x*inside.y*aim.z*amp;
      // 抖動 + 微微往黑洞方向拉伸
      return (j+aim.xy*((dot(p,aim.xy)-aim.w)*.03))*m;
    }
    vec3 sampleScene(vec2 pt){
      vec2 uv=vec2(pt.x/uResolution.x,1.-pt.y/uResolution.y);
      uv=clamp(uv,.001,.999);
      vec3 bg=texture2D(uBackground,uv).rgb*uDim;
      vec4 c=texture2D(uFragments,uv);
      return bg*(1.-c.a)+c.rgb;
    }
    void main(){
      vec2 p=vec2(gl_FragCoord.x/uDpr,uResolution.y-gl_FragCoord.y/uDpr);
      float strength=uBirth*(1.-uCollapse);
      p+=uShake;
      vec2 q=p-uHole;float r=length(q),rs=max(uRadius,.01),nr=r/rs;
      float raw=rs*rs*3.9/max(r,rs*.62);
      float lens=raw*r/(r+raw*1.25)*strength*(1.-smoothstep(7.,15.,r/max(uBaseRadius,1.)));
      vec2 src=p-q/max(r,1.)*lens;
      float amp=uPull*strength*1.6;
      vec2 j=vec2(sin(uTime*41.+p.y*.13),cos(uTime*47.+p.x*.11));
      src+=cardShake(uCards[0],uCardAim[0],p,j,amp)+cardShake(uCards[1],uCardAim[1],p,j,amp)
          +cardShake(uCards[2],uCardAim[2],p,j,amp)+cardShake(uCards[3],uCardAim[3],p,j,amp);
      vec3 color=sampleScene(src);
      // 黑洞降臨：畫面壓暗並加暗角，結束前回亮
      vec2 vn=(p/uResolution-.5)*vec2(1.,uResolution.y/uResolution.x)*2.;
      color*=1.-.42*strength*smoothstep(.42,1.35,length(vn));
      if(uBirth<.002){gl_FragColor=vec4(color,1.);return;}
      vec2 U=vec2(q.x,-q.y)/rs;
      if(nr>R_OUT+.45){gl_FragColor=vec4(color,1.);return;}
      // 事件視界：純黑球體
      float sphere=1.-smoothstep(.975,1.005,nr);
      color*=1.-sphere*strength;
      // 中間層先算好方位角與差動旋轉，兩層與透鏡弧共用
      vec3 Pm=planeHit(U,0.);
      float rdm=max(length(Pm),.001);
      float angM=atan(dot(Pm,DV),dot(Pm,DU));
      float spin=uTime*(.75+1.45/max(rdm,1.15));
      vec2 rotc=vec2(cos(spin),sin(spin));
      // 吸積盤：兩層取樣做出厚度感，依盤上點旋轉後的 z 判斷在球體前或後
      float f1,f2;
      vec3 d1=diskLayer(U,-.20,rotc,angM,0.,f1);
      vec3 d2=diskLayer(U,.20,rotc,angM,4.7,f2);
      float outside=smoothstep(.965,1.02,nr);
      vec3 disk=d1*mix(outside,1.,f1)*(.62+.50*f1)+d2*mix(outside,1.,f2)*(.82+.62*f2);
      // 重力透鏡把被球體擋住的後半盤翻到球體上方成一道弧
      float arcEnv=smoothstep(.985,1.035,nr)*(1.-smoothstep(1.05,1.52,nr));
      vec3 arc=vec3(0.);
      if(arcEnv>.002){
        vec3 PA=planeHit(U/max(nr*nr,1e-3),0.);
        float angA=atan(dot(PA,DV),dot(PA,DU));
        float rdA=mix(R_OUT-.70,R_IN+.55,smoothstep(1.01,1.45,nr));
        vec2 dpA=vec2(cos(angA+spin),sin(angA+spin))*rdA;
        float densA=fbm(dpA*2.6);
        densA*=.55+.45*(.5+.5*sin(3.*angA+rdA*3.1-uTime*2.4));
        float back=smoothstep(-.40,.55,(U.x+U.y)*.70711/max(nr,.001));
        arc=mix(vec3(1.,.42,.11),vec3(1.,.93,.84),.25+.5*densA)*arcEnv*(.30+1.5*densA*densA)*(.25+.9*back)*.95;
      }
      // 細光子環與外圈微光
      float photon=exp(-abs(nr-1.)*115.)*1.5+exp(-abs(nr-1.)*30.)*.22;
      float glow=exp(-abs(nr-1.06)*4.5)*.13;
      vec3 light=(disk+arc+vec3(1.,.96,.90)*photon+vec3(1.,.70,.40)*glow)*strength;
      color+=light/(1.+light*.42);
      gl_FragColor=vec4(color,1.);
    }`
  }));
  const screenGeom=keep(new THREE.PlaneGeometry(2,2));screen.add(new THREE.Mesh(screenGeom,screenMat));

  // 前十幾幀量一次真正的畫面間隔；太慢就一次性把解析度降一階（只重配一次，之後每幀零配置）
  let frameN=0,dtSum=0,lastT=0,steps=0;
  function adapt(now){
    if(lastT&&frameN>3&&frameN<=13)dtSum+=now-lastT;
    lastT=now;frameN++;
    if(frameN!==14||steps>0||dtSum/10<24)return;
    steps=1;dpr=Math.max(.75,dpr*.78);dprUniform.value=dpr;
    renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);
    target.setSize(Math.floor(w*dpr),Math.floor(h*dpr));
  }
  return {canvas,
    render(seconds,p){
      adapt(performance.now());
      const born=Math.min(1,p/.10),collapse=Math.max(0,(p-.88)/.12);
      common.uTime.value=seconds;common.uBirth.value=born*born*(3-2*born);common.uCollapse.value=collapse*collapse;
      common.uPull.value=Math.max(0,Math.min(1,(p-.07)/.80));
      common.uRadius.value=Math.max(.01,rs*common.uBirth.value*(1-collapse*collapse));
      const st=common.uBirth.value*(1-common.uCollapse.value);
      screenMat.uniforms.uDim.value=1-.65*st;
      const q=st*(.9+common.uPull.value*2.1);
      shakeVec.set((Math.sin(seconds*47)+Math.sin(seconds*71)*.4)*q,Math.cos(seconds*53)*.65*q);
      renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
      renderer.setRenderTarget(null);renderer.setClearColor(0,1);renderer.render(screen,camera);
    },
    dispose(){objects.forEach(o=>o.dispose());renderer.dispose();renderer.forceContextLoss();}
  };
}
