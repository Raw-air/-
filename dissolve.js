// Prewarmed WebGL dust and black hole, with a Canvas 2D fallback.
// Selected-folder raster pixels supply both the noise-threshold mask and particle colors.
// The shared RAF timeline dissolves at 80–500ms, closes the gap at 580ms, then absorbs the dust.
// Bed data is cleared only after completion; cancellation restores the original surface.
(() => {
  const MAX = 4000;                       // 粒子池上限 (typed array 預先配好，不會 new 物件)
  const FLOATS = 8;                       // 每顆送進 GPU 的資料：x, y, size, r, g, b, a, 保留
  // ── 粒子狀態 (全部預先配置，永遠重複使用) ──────────────────────────────
  const px = new Float32Array(MAX), py = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX);
  const cr = new Float32Array(MAX), cg = new Float32Array(MAX), cb = new Float32Array(MAX);
  const ca = new Float32Array(MAX), sz0 = new Float32Array(MAX);
  const age = new Float32Array(MAX), life = new Float32Array(MAX);
  const delay = new Float32Array(MAX), tang = new Float32Array(MAX), eaten = new Float32Array(MAX);
  const buf = new Float32Array(MAX * FLOATS);   // 給 GPU 的交錯陣列

  let canvas = null, gl = null, ctx2d = null, dpr = 1, W = 0, H = 0;
  let progDot = null, progHole = null, vboDot = null, vboHole = null, loc = {};
  let quality = 1;                        // 這台裝置學到的密度 (0.5 ~ 1)，掉 FPS 就往下調
  let running = null;
  const stats = { spawned: 0, peak: 0, frames: 0, ms: 0, masked: false };   // 上一場的實測數字
  const isLight = () => document.body.classList.contains('light-mode');
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ── WebGL：頁面載入就建好 ─────────────────────────────────────────────
  const DOT_VS = `
    attribute vec2 a_pos; attribute float a_size; attribute vec4 a_col;
    uniform vec2 u_res; uniform float u_dpr; varying vec4 v_col;
    void main() {
      vec2 c = (a_pos / u_res) * 2.0 - 1.0;
      gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
      gl_PointSize = max(1.0, a_size * u_dpr);
      v_col = a_col;
    }`;
  const DOT_FS = `
    precision mediump float; varying vec4 v_col;
    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float d = dot(p, p) * 4.0;
      float a = (smoothstep(1.0, 0.12, d) + smoothstep(1.0, 0.0, d) * 0.4) * v_col.a;
      if (a <= 0.003) discard;
      gl_FragColor = vec4(v_col.rgb * a, a);
    }`;
  const HOLE_VS = `
    attribute vec2 a_quad; uniform vec2 u_res; uniform vec2 u_center; uniform float u_radius;
    varying vec2 v_uv;
    void main() {
      v_uv = a_quad;
      vec2 p = u_center + a_quad * u_radius * 2.3;
      vec2 c = (p / u_res) * 2.0 - 1.0;
      gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
    }`;
  // 微型黑洞：純黑事件視界 + 一圈細光子環 + 帶旋臂的吸積輝光 (紫 → 白)
  const HOLE_FS = `
    precision mediump float; varying vec2 v_uv;
    uniform float u_time; uniform float u_fade;
    void main() {
      float r = length(v_uv);
      if (r > 1.0) discard;
      float R = 0.40;
      float ang = atan(v_uv.y, v_uv.x);
      float arms = 0.5 + 0.5 * sin(ang * 2.0 + u_time * 5.0 + r * 11.0);
      float disc = smoothstep(1.0, R * 1.06, r) * smoothstep(R * 0.92, R * 1.3, r);
      float ring = smoothstep(R * 1.16, R * 1.0, r) * smoothstep(R * 0.86, R * 1.0, r);
      float core = smoothstep(R * 1.02, R * 0.93, r);
      vec3 hot = mix(vec3(0.66, 0.38, 0.99), vec3(1.0, 0.96, 1.0), smoothstep(R * 1.35, R * 0.98, r));
      float glow = disc * (0.30 + 0.70 * arms);
      vec3 col = hot * (glow * 1.15 + ring * 1.8) * (1.0 - core);
      float a = clamp(max(core, glow * 0.85 + ring * 1.1), 0.0, 1.0) * u_fade;
      gl_FragColor = vec4(col * a, a);
    }`;

  function compile(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[Dissolve] shader', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  function link(vs, fs) {
    const v = compile(vs, gl.VERTEX_SHADER), f = compile(fs, gl.FRAGMENT_SHADER);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  }

  function init() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'sf-dissolve-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
        || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    } catch (e) { gl = null; }
    if (gl) {
      progDot = link(DOT_VS, DOT_FS);
      progHole = link(HOLE_VS, HOLE_FS);
      if (!progDot || !progHole) gl = null;
    }
    if (gl) {
      vboDot = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboDot);
      gl.bufferData(gl.ARRAY_BUFFER, buf.byteLength, gl.DYNAMIC_DRAW);
      vboHole = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboHole);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      loc = {
        dPos: gl.getAttribLocation(progDot, 'a_pos'), dSize: gl.getAttribLocation(progDot, 'a_size'),
        dCol: gl.getAttribLocation(progDot, 'a_col'), dRes: gl.getUniformLocation(progDot, 'u_res'),
        dDpr: gl.getUniformLocation(progDot, 'u_dpr'),
        hQuad: gl.getAttribLocation(progHole, 'a_quad'), hRes: gl.getUniformLocation(progHole, 'u_res'),
        hCenter: gl.getUniformLocation(progHole, 'u_center'), hRadius: gl.getUniformLocation(progHole, 'u_radius'),
        hTime: gl.getUniformLocation(progHole, 'u_time'), hFade: gl.getUniformLocation(progHole, 'u_fade')
      };
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // 預乘 alpha：粉塵疊起來會變密但不會爆白
    } else {
      ctx2d = canvas.getContext('2d');
      // A canvas that already created a failed WebGL context cannot switch context type.
      if (!ctx2d) {
        const fallback = canvas.cloneNode(false);
        canvas.replaceWith(fallback); canvas = fallback;
        ctx2d = canvas.getContext('2d');
      }
    }
    resize();
    warmUp();
    window.addEventListener('resize', resize);
  }
  // 暖機：載入時就真的畫一次 (shader 送上 GPU、buffer 配好、合成層建好)，第一次刪除才不會頓
  function warmUp() {
    if (gl) {
      drawHole(6, 6, 8, 0, 0.001);
      buf[0] = 6; buf[1] = 6; buf[2] = 2; buf[3] = buf[4] = buf[5] = 1; buf[6] = 0.004;
      drawDots(1);
      gl.flush();
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    } else if (ctx2d) {
      ctx2d.fillStyle = '#fff'; ctx2d.fillRect(0, 0, 4, 4); ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  let needResize = false;
  function resize() {
    if (!canvas) return;
    if (running) { needResize = true; return; }   // 跑的時候不能重配畫布，結束再補
    needResize = false;
    W = innerWidth; H = innerHeight;
    // 粉塵只有 1-5px，超大螢幕不需要 2x：整張畫布壓在 3.2MP 以內
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.2e6 / Math.max(1, W * H))));
    const nw = Math.round(W * dpr), nh = Math.round(H * dpr);
    if (canvas.width === nw && canvas.height === nh) return;   // iOS 捲動時網址列伸縮也會發 resize
    canvas.width = nw; canvas.height = nh;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (gl) gl.viewport(0, 0, nw, nh);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();

  function drawDots(n) {
    if (!n) return;
    gl.useProgram(progDot);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboDot);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, n * FLOATS));
    const stride = FLOATS * 4;
    gl.enableVertexAttribArray(loc.dPos); gl.vertexAttribPointer(loc.dPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc.dSize); gl.vertexAttribPointer(loc.dSize, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(loc.dCol); gl.vertexAttribPointer(loc.dCol, 4, gl.FLOAT, false, stride, 12);
    gl.uniform2f(loc.dRes, W, H); gl.uniform1f(loc.dDpr, dpr);
    gl.drawArrays(gl.POINTS, 0, n);
  }
  function drawHole(hx, hy, radius, time, fade) {
    if (fade <= 0) return;
    gl.useProgram(progHole);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboHole);
    gl.enableVertexAttribArray(loc.hQuad); gl.vertexAttribPointer(loc.hQuad, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(loc.hRes, W, H); gl.uniform2f(loc.hCenter, hx, hy);
    gl.uniform1f(loc.hRadius, radius); gl.uniform1f(loc.hTime, time); gl.uniform1f(loc.hFade, fade);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ── 顏色：依區塊取樣資料夾原本的視覺 (玻璃白、銀、薰衣草、紫、文字、內頁) ──
  // 便宜的 2D 值雜訊 (-1 ~ 1)：讓崩解鋒面不是一條直線
  function noise(x, y) {
    return (Math.sin(x * .031 + 1.7) * Math.cos(y * .027 - .4) + Math.sin((x + y) * .017) * .6 + Math.sin(x * .071 - y * .053) * .35) / 1.95;
  }
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // Capture the browser-styled folder while selected, before a delete interaction.
  // The same raster is displayed by the dissolve surface and sampled by the dust.
  const textures = new WeakMap();
  const birth = new Float32Array(MAX);
  const thresholds = new Float32Array(1024 * 768);
  const erased = new Uint8Array(thresholds.length);
  const surface = document.createElement('canvas');
  surface.className = 'fd-dust-surface';
  surface.setAttribute('aria-hidden', 'true');
  let surfacePixels = null;
  const surfaceCtx = surface.getContext('2d', {willReadFrequently:true});
  function prepare(root) {
    if (!root) return Promise.resolve(null);
    const key = root.textContent + root.offsetWidth + document.body.className;
    const cached = textures.get(root);
    if (cached?.key === key) return cached.promise;
    const width = root.offsetWidth + 40, height = root.offsetHeight + 52;
    const copy = root.cloneNode(true);
    const originals = [root, ...root.querySelectorAll('*')];
    const clones = [copy, ...copy.querySelectorAll('*')];
    originals.forEach((el,i) => {
      const style = getComputedStyle(el), target = clones[i];
      target.removeAttribute('id'); target.removeAttribute('onclick');
      target.style.cssText = Array.from(style, k => k + ':' + style.getPropertyValue(k) + ';').join('');
      target.style.animation = 'none'; target.style.transition = 'none';
      target.style.filter = 'none'; target.style.backdropFilter = 'none';
      target.style.transform = 'none';
      for (const prop of ['inset-block','inset-inline','inset-block-start','inset-block-end','inset-inline-start','inset-inline-end']) target.style.removeProperty(prop);
      if (el.classList.contains('fd-spine')) target.style.width='1px';
      if (el.classList.contains('fd-top')) target.style.height='1px';
    });
    copy.querySelectorAll('.fd-dust-surface').forEach(e=>e.remove());
    Object.assign(copy.style, {position:'absolute',left:'20px',top:'26px',right:'auto',bottom:'auto',margin:'0',visibility:'visible',opacity:'1'});
    copy.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><foreignObject width="100%" height="100%">'+new XMLSerializer().serializeToString(copy)+'</foreignObject></svg>';
    const record = {key, promise:null, value:null};
    record.promise = new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width=width; c.height=height;
        const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0);
        try { record.value={canvas:c,pixels:ctx.getImageData(0,0,width,height),width,height}; }
        catch (e) { console.warn('[Dissolve] texture capture',e); }
        if (record.value && !running && (surface.width!==width || surface.height!==height)) {
          surface.width=width;surface.height=height;
          surfacePixels=surfaceCtx.createImageData(width,height);
        }
        resolve(record.value);
      };
      img.onerror = () => resolve(null);
      img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    });
    textures.set(root,record);
    return record.promise;
  }
  function projection(root) {
    const area=document.getElementById('sf-card-area'), rect=area.getBoundingClientRect();
    const style=getComputedStyle(area), origins=style.perspectiveOrigin.split(' ').map(parseFloat);
    const perspective=parseFloat(style.perspective), matrix=new DOMMatrix(getComputedStyle(root).transform);
    const cx=root.offsetWidth/2, cy=root.offsetHeight/2;
    return (x,y,out) => {
      const point=new DOMPoint(x-20-cx,y-26-cy,2).matrixTransform(matrix);
      const k=perspective/(perspective-point.z);
      out.x=rect.left+origins[0]+(root.offsetLeft+cx+point.x-origins[0])*k;
      out.y=rect.top+origins[1]+(root.offsetTop+cy+point.y-origins[1])*k;
    };
  }
  // ── Main RAF timeline ─────────────────────────────────────────────────
  function run(root, opts = {}) {
    if (!canvas) throw new Error("Dissolve renderer has not mounted");
    if (running) running.cancel();
    quality = Math.min(1, quality + .12);          // 上次掉幀降過的密度慢慢還回來
    const texture = textures.get(root)?.value;
    if (!texture) throw new Error('Folder texture unavailable');
    const layers = Array.from(root.children);
    const rect=root.getBoundingClientRect();
    const box={l:rect.left,t:rect.top,r:rect.right,b:rect.bottom};
    const bw=rect.width,bh=rect.height,mobile=innerWidth<640;
    const hx=clamp(box.r+(mobile?bw*.16:bw*.26),56,innerWidth-54);
    const hy=clamp(box.t+bh*.1,64,innerHeight-120);
    const holeR=clamp(bw*.12,20,52),horizon=holeR*.9;
    const target=mobile ? (navigator.hardwareConcurrency<=4 ? 1000 : 1300) : 2400;
    const {width:tw,height:th,pixels}=texture;
    if (!surfacePixels || surface.width!==tw || surface.height!==th) {
      surface.width=tw; surface.height=th; surfacePixels=surfaceCtx.createImageData(tw,th);
    }
    surfacePixels.data.set(pixels.data);
    surface.style.width=tw+'px'; surface.style.height=th+'px';
    surface.style.left='-20px'; surface.style.top='-26px';
    surfaceCtx.drawImage(texture.canvas,0,0);
    const threshold=(x,y)=>(tw-x)/tw+noise(x,y)*.09;
    let seed=37;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const project=projection(root), point={x:0,y:0};
    let n=0;
    for(let attempt=0;n<target && attempt<target*30;attempt++) {
      const x=rand()*tw|0,y=rand()*th|0,o=(y*tw+x)*4;
      if(pixels.data[o+3]<12) continue;
      const i=n++; project(x,y,point);
      px[i]=point.x;py[i]=point.y;age[i]=-1;eaten[i]=0;
      // A cell's threshold both erases that texture cell and releases its particles.
      birth[i]=threshold(Math.floor(x/2)*2+1,Math.floor(y/2)*2+1);
      const roll=rand();
      sz0[i]=roll<.7?1+rand():roll<.9?2+rand():roll<.98?3+rand():4+rand();
      cr[i]=pixels.data[o]/255;cg[i]=pixels.data[o+1]/255;cb[i]=pixels.data[o+2]/255;
      ca[i]=.65+rand()*.35;life[i]=1000;delay[i]=12+rand()*15;
      tang[i]=(rand()<.5?-1:1)*(.7+rand()*.9);
      vx[i]=(rand()-.5)*26;vy[i]=-3-rand()*12;
    }
    const tileCols=Math.ceil(tw/2),tileRows=Math.ceil(th/2);
    // The texture mask is reused for the entire animation; no per-frame ImageData allocation.
    const tileCount=tileCols*tileRows;
    erased.fill(0,0,tileCount);
    for(let y=0;y<tileRows;y++) for(let x=0;x<tileCols;x++) thresholds[y*tileCols+x]=threshold(x*2+1,y*2+1);

    const WIPE_T0 = 80, WIPE_T1 = 500, REFLOW = 580, OVER = 1.14;   // progress 掃過 1 之後再多一點，雜訊最高的格子才會全剝離
    // 引力：a = GM/(d²+soft)。最遠的粉塵離黑洞 ~600px，要在 450ms 內被拉過去，所以 GM 要夠大；
    // 加速度與速度都設上限，才不會在近距離爆掉 / 一幀衝過視界
    const GM = 1.8e9, SOFT = 100 * 100, AMAX = 14000, VMAX = 2600;
    let emit = 0, alive = 0, frame = 0, t0 = 0, lastNow = 0, slow = 0;
    let released = false, finished = false, cancelled = false, holeFade = 0, shrinkAt = -1;
    let resolveDone, resolveReflow, reflowed = false;
    const done = new Promise(r => resolveDone = r);
    const reflow = new Promise(r => resolveReflow = r);

    stats.spawned = 0; stats.peak = 0; stats.frames = 0; stats.ms = 0; stats.masked = false;
    root.classList.add('fd-dissolving');
    canvas.classList.add('is-running');
    const masks=layers.map(el=>({el,visibility:el.style.visibility}));
    for(const m of masks) m.el.style.visibility='hidden';
    root.appendChild(surface);
    function restore() {
      released=true;
      surface.remove();
      for(const m of masks) m.el.style.visibility=m.visibility;
      root.classList.remove('fd-dissolving');
    }
    function finish(ok) {
      if (finished) return;
      finished = true; running = null;
      cancelAnimationFrame(frame);
      if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      else if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.remove('is-running');
      if (needResize) resize();
      if (!ok) restore();
      if (!reflowed) { reflowed = true; resolveReflow(ok); }
      resolveDone(ok);
    }
    function tick(now) {
      frame = 0;
      if (cancelled) return;
      if (!t0) { t0 = now; lastNow = now; }
      const t = now - t0, dtms = Math.min(48, now - lastNow); lastNow = now;
      const dt = dtms / 1000;
      // Reduce turbulence work under load; preserve the visible dust population.
      if(dtms>22) { if(++slow>=3) {quality=Math.max(.6,quality*.8);slow=0;} } else slow=0;
      const prog=t<WIPE_T0?-.2:easeInOut(clamp((t-WIPE_T0)/(WIPE_T1-WIPE_T0),0,1))*OVER;
      for(let i=0;i<n;i++) if(age[i]===-1 && t>=WIPE_T0 && birth[i]<=prog) {
        age[i]=0;stats.spawned++;emit++;
      }
      if(!released && t>=WIPE_T0) {
        stats.masked=true;
        for(let i=0;i<tileCount;i++) if(!erased[i] && thresholds[i]<=prog) {
          erased[i]=1;
          const x=i%tileCols*2,y=Math.floor(i/tileCols)*2;
          for(let yy=y;yy<Math.min(y+2,th);yy++) for(let xx=x;xx<Math.min(x+2,tw);xx++) surfacePixels.data[(yy*tw+xx)*4+3]=0;
        }
      }
      if (!released && t>=WIPE_T0) surfaceCtx.putImageData(surfacePixels,0,0);
      // 補位：粉塵還在飛的時候，資料夾就開始長回來
      if (!reflowed && t >= REFLOW) { reflowed = true; resolveReflow(true); }

      // ── 物理：引力 + 切向漩渦 + 阻尼；死法 = 進事件視界 ──
      alive = 0;
      let w = 0;
      const fadeOut = shrinkAt >= 0 ? Math.max(0, 1 - (t - shrinkAt) / 240) : 1;   // 黑洞收掉時還沒進去的也一起收
      for (let i = 0; i < n; i++) {
        if (age[i] < 0) continue;
        age[i] += dtms;
        if (age[i] >= life[i]) { age[i] = -2; continue; }
        if (age[i] > delay[i]) {
          const dx = hx - px[i], dy = hy - py[i];
          const d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
          const a = Math.min(AMAX, GM / (d2 + SOFT));
          const nx = dx / d, ny = dy / d;
          const sw = quality > .7 ? tang[i] * 30000 / (d + 70) : tang[i] * 100;          // 切向分量：繞成弧線 / 螺旋，不是直線射向中心
          vx[i] += (nx * a - ny * sw) * dt;
          vy[i] += (ny * a + nx * sw) * dt;
          const drag = Math.exp(-.6 * dt);
          vx[i] *= drag; vy[i] *= drag;
          const sp = Math.hypot(vx[i], vy[i]);
          if (sp > VMAX) { vx[i] = vx[i] / sp * VMAX; vy[i] = vy[i] / sp * VMAX; }
          // 進入事件視界：快的粒子一幀能走 100px，點測試會直接穿過去，所以看這一幀的線段離中心最近多遠；
          // 進去就鎖住 (eaten>0)，之後只往中心收、亮一下、縮到 0，不會再飛出來
          if (eaten[i] === 0) {
            const sx = vx[i] * dt, sy = vy[i] * dt, ss = sx * sx + sy * sy;
            const u = ss > 0 ? clamp(((hx - px[i]) * sx + (hy - py[i]) * sy) / ss, 0, 1) : 0;
            const cx = px[i] + sx * u - hx, cy = py[i] + sy * u - hy;
            if (d < horizon || cx * cx + cy * cy < horizon * horizon) eaten[i] = .001;
          }
          if (eaten[i] > 0) { eaten[i] = Math.min(1, eaten[i] + dtms / 90); px[i] += (hx - px[i]) * .35; py[i] += (hy - py[i]) * .35; vx[i] *= .5; vy[i] *= .5; }
        }
        px[i] += vx[i] * dt; py[i] += vy[i] * dt;
        let alpha = ca[i] * fadeOut;
        let s = sz0[i];
        if (eaten[i] > 0) {
          alpha *= (1 - eaten[i]) * (1 + eaten[i] * .9);          // 被吞前先亮一下
          s = sz0[i] * (1 - eaten[i]);
          if (eaten[i] >= 1) { age[i] = -2; continue; }
        }
        if (alpha <= .004 || s <= .15) continue;
        alive++;
        const o = w * FLOATS;
        buf[o] = px[i]; buf[o + 1] = py[i]; buf[o + 2] = s;
        buf[o + 3] = cr[i]; buf[o + 4] = cg[i]; buf[o + 5] = cb[i]; buf[o + 6] = alpha; buf[o + 7] = 0;
        w++;
      }
      // 黑洞：50ms 淡入；粉塵幾乎都吃完 (或超時) 才開始收
      if (shrinkAt < 0 && emit >= n && (alive <= Math.max(6, stats.spawned * .03) || t >= 730)) shrinkAt = t;
      holeFade = t < 50 ? 0 : shrinkAt < 0 ? Math.min(1, (t - 50) / 180) : Math.max(0, 1 - (t - shrinkAt) / 220);
      const holeScale = shrinkAt < 0 ? 1 : Math.max(.15, 1 - (t - shrinkAt) / 220 * .85);

      // ── 畫：先粉塵，再黑洞蓋上去 (進到視界的就被核心吃掉) ──
      if (gl) {
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        drawDots(w);
        drawHole(hx, hy, holeR * holeScale, t / 1000, holeFade);
      } else if (ctx2d) {
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.clearRect(0, 0, W, H);
        for (let i = 0; i < w; i++) {
          const o = i * FLOATS, s = buf[o + 2];
          ctx2d.globalAlpha = Math.min(1, buf[o + 6]);
          ctx2d.fillStyle = `rgb(${buf[o + 3] * 255 | 0},${buf[o + 4] * 255 | 0},${buf[o + 5] * 255 | 0})`;
          ctx2d.fillRect(buf[o] - s / 2, buf[o + 1] - s / 2, s, s);
        }
        if (holeFade > 0) {
          const r = holeR * holeScale;
          const g = ctx2d.createRadialGradient(hx, hy, r * .2, hx, hy, r * 1.7);
          g.addColorStop(0, `rgba(0,0,0,${holeFade})`); g.addColorStop(.42, `rgba(10,4,20,${holeFade})`);
          g.addColorStop(.55, `rgba(190,110,255,${.85 * holeFade})`); g.addColorStop(1, 'rgba(140,80,240,0)');
          ctx2d.globalAlpha = 1; ctx2d.fillStyle = g;
          ctx2d.beginPath(); ctx2d.arc(hx, hy, r * 1.7, 0, 6.2832); ctx2d.fill();
        }
        ctx2d.globalAlpha = 1;
      }
      stats.frames++; stats.ms = t; if (alive > stats.peak) stats.peak = alive;
      if ((t < 750 || emit < n || alive > 0 || holeFade > 0) && t < 980) { frame = requestAnimationFrame(tick); return; }
      finish(true);
    }
    frame = requestAnimationFrame(tick);
    running = { done, reflow, restore, cancel() { if (finished) return; cancelled = true; finish(false); } };
    return running;
  }

  window.sfDissolve = { init, prepare, run, stats, get quality() { return quality; }, get webgl() { return !!gl; }, get max() { return MAX; }, get running() { return !!running; } };

  // ── 垃圾桶：清空這一床的資料 ──────────────────────────────────────────
  // 床位本身不會從房間裡消失，所以粉塵被吸走的同時，同一本資料夾會以「空床」重新長回來；
  // 清空跟以前一樣是草稿，要按「儲存修改」才會同步 (誤按可以直接改回來)。
  window.clearStudentData = async function (btn) {
    const folder = document.querySelector('.sf-folder.active');
    if (!folder || window._sfBHBusy) return;
    const owner = _sfRenderMap.get(folder);
    if (!owner) return;
    window._sfBHBusy = true;
    const sceneEl = document.getElementById('sf-scene');
    const wasInert = sceneEl?.inert || false;
    let handle = null, cancelled = false;
    const abort = () => { if (cancelled) return; cancelled = true; handle?.cancel(); };
    const onVisibility = () => { if (document.hidden) abort(); };
    const onNavigation = () => { if (currentPage !== 'student-files') abort(); };
    const resetFields = () => {
      if (_sfRenderMap.get(folder) !== owner) return;
      const draft = { name: '', studentId: '', class: '', remarks: '', isForeign: false, isEmpty: true };
      _sfDrafts.set(owner.id, draft);          // 清空是草稿，跟「儲存修改」同一套流程
      // 名單少於回收池時同一床會出現在好幾本上，每一本都要清，否則另一本被回收時會把草稿還原
      for (const f of document.querySelectorAll('.sf-folder,.sf-editor')) {
        if (_sfRenderMap.get(f) !== owner) continue;
        for (const cls of ['name', 'id', 'class', 'remarks']) { const el = f.querySelector('.sf-input-' + cls); if (el) el.value = ''; }
        const cf = f.querySelector('.sf-chk-foreign'), ce = f.querySelector('.sf-chk-empty');
        if (cf) cf.checked = false; if (ce) ce.checked = true;
        const badge = f.querySelector('.sf-card-badge-relative');
        if (badge) badge.textContent = '空床';
        if (typeof sfUpdateSummary === 'function') sfUpdateSummary(f, owner, draft);
      }
    };
    try {
      sfStashInspector();
      window.sfCarousel?.closeSheet(true);
      window.sfCarousel?.lock();
      window._sfAbortClear = abort;             // 搜尋框在舞台外面，重新渲染名單前要先把這一場收掉
      if (sceneEl) sceneEl.inert = true;
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('app:navigate', onNavigation);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { haptic('medium'); resetFields(); showToast('床位已清空，按「儲存修改」同步', 'info'); return; }
      haptic('medium');
      const texture = await prepare(folder);
      if(cancelled) return;
      if(!texture) { showToast('無法準備資料夾動畫，請重試', 'error'); return; }
      handle = run(folder);
      // 粉塵大約飛到一半 (350ms) 就開始補位：清空欄位、資料夾以空床長回來，兩段動畫重疊
      const ok = await handle.reflow;
      if (!ok || cancelled) return;
      // Begin closing the gap without recycling or restoring the disappearing DOM.
      window.sfCarousel?.reflow();
      if (!await handle.done || cancelled) return;
      resetFields();
      handle.restore();
      showToast('床位已清空，按「儲存修改」同步', 'info');
      window.sfCarousel?.unlock();
      await window.sfCarousel?.materialize(folder);
    } catch (err) {
      console.warn('[Dissolve]', err);
      if (!cancelled) showToast('清空未完成，資料已保留', 'error');
    } finally {
      handle?.restore();
      window._sfAbortClear = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('app:navigate', onNavigation);
      if (sceneEl) sceneEl.inert = wasInert;
      window.sfCarousel?.unlock();
      window._sfBHBusy = false;
      if (currentPage === 'student-files') window.sfCarousel?.paint();
    }
  };
})();
