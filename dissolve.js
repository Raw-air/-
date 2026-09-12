// 刪除動畫：Telegram 式高密度粉塵 + 微型黑洞吸入 (WebGL Points，Canvas 2D 備援)
// ─────────────────────────────────────────────────────────────────────────────
// 時間軸 (連續，沒有任何等待階段)：
//   0ms      資料夾 scale 1 → .985、邊緣微亮
//   50ms     黑洞淡入 (只是改 uniform，renderer 在頁面載入時就備妥了)
//   80ms     不規則的崩解邊界從資料夾右緣 (垃圾桶那一側) 開始往左掃
//   80-520   邊界掃過哪裡，那裡的 DOM 就被 mask 吃掉，同一位置生出粉塵 (顏色取自該區塊)
//   180-700  粉塵先照原本方向飄 30-60ms，再被黑洞引力拉彎，切向分量讓它繞成螺旋
//   350ms    資料夾以「空床」長回來、鄰居補位 (跟還在飛的粉塵重疊)
//   650-850  最後的粉塵進入事件視界：亮一下 → 縮到 0
//   750-950  黑洞 scale 1 → .15、淡出
//   ~950ms   結束
//
// 效能：canvas / WebGL context / 兩支 shader / VBO / 4000 顆的 typed-array 粒子池
// 全部在頁面載入時就建好並試畫一次 (暖機)，按下垃圾桶只是改 uniform 與開始寫 buffer。
// 每幀零配置：粒子狀態放在 Float32Array，只 bufferSubData 存活的那一段。
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
    // 省電模式：完全不建立 WebGL context / shader / 粒子池 (省一次開機時的暖機繪製)
    if (window.sfReduceMotion && window.sfReduceMotion()) return;
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
  function palette() {
    return isLight() ? [
      [.62, .62, .70], [.66, .58, .92], [.55, .30, .88], [.80, .38, .84], [.22, .23, .32], [.46, .47, .58], [.52, .50, .66]
    ] : [
      [.92, .93, 1.0], [.78, .72, .99], [.66, .33, .97], [.91, .36, .86], [.97, .97, 1.0], [.42, .42, .58], [.98, .98, 1.0]
    ];
  }
  function sampler(root) {
    const R = (el, kind) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < .05) return null;   // 看不見的 (收起的摘要、側標) 不算
      const r = el.getBoundingClientRect();
      return r.width > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom, kind } : null;
    };
    const list = [];
    const sheet = root.classList.contains('is-open') ? root.querySelector('.fd-sheet') : null;
    if (sheet) {
      for (const el of sheet.querySelectorAll('input[type="text"],textarea')) list.push(R(el, 'input'));
      for (const el of sheet.querySelectorAll('.sf-save-action-btn')) list.push(R(el, 'accent'));
      for (const el of sheet.querySelectorAll('.sf-card-badge-relative,.sf-icon-btn')) list.push(R(el, 'lav'));
      for (const el of sheet.querySelectorAll('.sf-title-text,label')) list.push(R(el, 'text'));
      list.push(R(sheet, 'glass'));
    }
    for (const el of root.querySelectorAll('.fd-name,.fd-class,.fd-rail-label')) list.push(R(el, 'text'));
    for (const el of root.querySelectorAll('.fd-tag,.fd-tab')) list.push(R(el, 'lav'));
    list.push(R(root.querySelector('.fd-paper'), 'paper'));
    list.push(R(root.querySelector('.fd-front'), 'glass'));
    list.push(R(root.querySelector('.fd-back'), 'glass'));
    const rects = list.filter(Boolean);
    return (x, y, rnd) => {
      for (const q of rects) {
        if (x < q.l || x > q.r || y < q.t || y > q.b) continue;
        switch (q.kind) {
          case 'input': return rnd < .2 ? 4 : 5;
          case 'accent': return rnd < .5 ? 2 : 3;
          case 'lav': return rnd < .6 ? 1 : 2;
          case 'text': if (rnd < .55) return 4; continue;        // 文字不是整塊，一半機率落到下層
          case 'paper': return rnd < .78 ? 6 : 0;
          default: return rnd < .74 ? 0 : rnd < .92 ? 1 : 2;     // 玻璃：白銀為主，少數紫
        }
      }
      return -1;
    };
  }
  // 便宜的 2D 值雜訊 (-1 ~ 1)：讓崩解鋒面不是一條直線
  function noise(x, y) {
    return (Math.sin(x * .031 + 1.7) * Math.cos(y * .027 - .4) + Math.sin((x + y) * .017) * .6 + Math.sin(x * .071 - y * .053) * .35) / 1.95;
  }
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // ── 主流程 ─────────────────────────────────────────────────────────────
  function run(root, opts = {}) {
    init();
    if (running) running.cancel();
    quality = Math.min(1, quality + .12);          // 上次掉幀降過的密度慢慢還回來
    const layers = Array.from(root.children).filter(el => !el.classList.contains('fd-spine') && !el.classList.contains('fd-top'));
    const rigid = Array.from(root.querySelectorAll('.fd-spine, .fd-top'));   // 轉過的平面，遮罩座標對不上，直接藏
    const rr = root.getBoundingClientRect();
    const box = layers.reduce((b, el) => {
      if (getComputedStyle(el).visibility === 'hidden') return b;
      const r = el.getBoundingClientRect();
      if (!r.width) return b;
      return { l: Math.min(b.l, r.left), t: Math.min(b.t, r.top), r: Math.max(b.r, r.right), b: Math.max(b.b, r.bottom) };
    }, { l: rr.left, t: rr.top, r: rr.right, b: rr.bottom });
    const bw = box.r - box.l, bh = box.b - box.t;
    const mobile = innerWidth < 640;
    // 崩解鋒面：從右緣往左掃。DOM 遮罩與粒子誕生共用同一個門檻 —
    //   threshold(x, y) = 離右緣的比例 + noise(x, y)；progress 掃過門檻，該格的 DOM 消失、同一位置生出粉塵。
    //   DOM 端做不到逐像素雜訊，所以用一條 FEATHER 寬的漸層過渡帶，粒子 (帶雜訊) 就密集出生在這條帶裡 → ▓▒░
    const FEATHER = Math.max(44, bw * .1);
    // 黑洞在資料夾右上方外側：粉塵要有一段看得見的流線，不能一生出來就被吃掉
    const hx = clamp(box.r + (mobile ? bw * .16 : bw * .26), 56, innerWidth - 54);
    const hy = clamp(box.t + bh * (mobile ? .10 : .16), 64, innerHeight - 120);
    const holeR = clamp(bw * .12, 20, 52);          // 資料夾寬度的 12% (UI 尺度的微型黑洞)
    const horizon = holeR * .9;                     // 事件視界：進去就開始被吞

    // ── 生成：整本切成細格，每顆粉塵就出生在自己那一格 (一定在資料夾矩形內)，顏色取自該格所在的區塊 ──
    const target = Math.round((mobile ? 1300 : innerWidth < 1024 ? 1800 : 2400) * quality);   // 桌機 1500-3000、手機 700-1400 (掉幀會再打折)
    let rnd = .137;
    const rand = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
    const sample = sampler(root);
    // 三成五的格子會多一顆，所以格距要把 1.35 倍算進去，總數才會落在目標附近 (桌機 ~2400、手機 ~1100)
    const step = Math.max(2.2, Math.sqrt(bw * bh * 1.35 / Math.min(target, MAX)));
    const cells = [];
    for (let y = box.t + step / 2; y < box.b; y += step) {
      for (let x = box.l + step / 2; x < box.r; x += step) {
        const reps = rand() < .35 ? 2 : 1;           // 三成五的格子多一顆：密度不平均，才像粉塵不像網點
        for (let k = 0; k < reps; k++) {
          const jx = x + (rand() - .5) * step, jy = y + (rand() - .5) * step;
          const p = sample(jx, jy, rand());
          if (p < 0) continue;
          cells.push({ x: jx, y: jy, p, d: (box.r - jx) / bw + noise(jx, jy) * .09 + (rand() - .5) * .025 });
        }
      }
    }
    cells.sort((a, b) => a.d - b.d);
    const n = Math.min(MAX, cells.length);
    const cols = palette();
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      px[i] = c.x; py[i] = c.y; age[i] = -1; eaten[i] = 0;
      const roll = rand();
      // 七成 1-2px 極細粉塵、兩成 2-3px、8% 3-4px、2% 4-5px 亮碎片
      sz0[i] = roll < .7 ? 1 + rand() : roll < .9 ? 2 + rand() : roll < .98 ? 3 + rand() : 4 + rand();
      const col = cols[c.p], bright = roll >= .98 ? 1.3 : roll >= .9 ? 1.1 : 1;
      cr[i] = Math.min(1, col[0] * bright); cg[i] = Math.min(1, col[1] * bright); cb[i] = Math.min(1, col[2] * bright);
      ca[i] = roll < .7 ? .5 + rand() * .32 : roll < .98 ? .72 + rand() * .25 : 1;
      life[i] = 2000 + rand() * 600;                 // 只是保險；正常死法是進事件視界
      delay[i] = 20 + rand() * 40;                   // 剝離後先留在原位這麼久，才受引力影響
      tang[i] = (rand() < .5 ? -1 : 1) * (.7 + rand() * .9);
      // 初速：幾乎不動，只有一點點雜訊 (剛剝離時要看得出是從資料夾本體長出來的)
      vx[i] = (rand() - .5) * 26;
      vy[i] = -(3 + rand() * 12) + (rand() - .5) * 16;
    }

    const WIPE_T0 = 80, WIPE_T1 = 560, REFLOW = 350, OVER = 1.14;   // progress 掃過 1 之後再多一點，雜訊最高的格子才會全剝離
    // 引力：a = GM/(d²+soft)。最遠的粉塵離黑洞 ~600px，要在 450ms 內被拉過去，所以 GM 要夠大；
    // 加速度與速度都設上限，才不會在近距離爆掉 / 一幀衝過視界
    const GM = 1.8e9, SOFT = 100 * 100, AMAX = 14000, VMAX = 2600;
    let emit = 0, alive = 0, frame = 0, t0 = 0, lastNow = 0, slow = 0;
    let hidden = false, released = false, finished = false, cancelled = false, holeFade = 0, shrinkAt = -1;
    let resolveDone, resolveReflow, reflowed = false;
    const done = new Promise(r => resolveDone = r);
    const reflow = new Promise(r => resolveReflow = r);

    stats.spawned = 0; stats.peak = 0; stats.frames = 0; stats.ms = 0; stats.masked = false;
    root.classList.add('fd-dissolving');
    canvas.classList.add('is-running');
    const masks = layers.map(el => {                 // 在 fd-dissolving (scale .985) 套上之後才量，遮罩才對得準
      const r = el.getBoundingClientRect();
      return { el, k: r.width && el.offsetWidth ? r.width / el.offsetWidth : 1, right: r.right };
    });
    // 遮罩：to left 的 0px 在右緣。鋒面右邊全透明、左邊保留，中間 FEATHER 寬的漸層就是正在崩解的那一帶
    function setMask(m, frontX) {
      stats.masked = true;
      const dRight = (m.right - frontX) / m.k;
      const v = `linear-gradient(to left, transparent ${Math.max(0, dRight - FEATHER * .5).toFixed(1)}px, #000 ${(dRight + FEATHER * .5).toFixed(1)}px)`;
      m.el.style.webkitMaskImage = v; m.el.style.maskImage = v;
    }
    function restore() {
      released = true;                        // 補位之後就別再寫遮罩了 (資料夾已經長回來)
      for (const m of masks) { m.el.style.webkitMaskImage = ''; m.el.style.maskImage = ''; m.el.style.visibility = ''; }
      for (const s of rigid) { s.style.visibility = ''; s.style.opacity = ''; }
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
      // 自適應密度：連續兩幀掉到 45fps 以下就少生一些 (已經生出來的不動，不然畫面會突然變稀)
      if (dtms > 22) { if (++slow >= 2) { quality = Math.max(.5, quality * (dtms > 28 ? .65 : .8)); slow = 0; } } else slow = 0;

      // ── 崩解鋒面：DOM 遮罩與粒子誕生同步 ──
      const prog = t < WIPE_T0 ? 0 : easeInOut(clamp((t - WIPE_T0) / (WIPE_T1 - WIPE_T0), 0, 1)) * OVER;
      // 粒子跟 DOM 遮罩同一個時鐘：鋒面 80ms 才開始，粒子也 80ms 才開始生
      while (t >= WIPE_T0 && emit < n && cells[emit].d <= prog) {
        if (quality >= .999 || ((emit * .618034) % 1) < quality) { age[emit] = 0; stats.spawned++; }   // 保留比例 = quality
        emit++;
      }
      if (!released) {
        const frontX = box.r - prog * bw;
        if (t >= WIPE_T0 && !hidden) for (const m of masks) setMask(m, frontX);
        for (const s of rigid) s.style.opacity = String(Math.max(0, 1 - prog * 1.6));
        if (prog >= OVER && !hidden) { hidden = true; for (const m of masks) m.el.style.visibility = 'hidden'; }
      }
      // 補位：粉塵還在飛的時候，資料夾就開始長回來
      if (!reflowed && t >= REFLOW) { reflowed = true; resolveReflow(true); }

      // ── 物理：引力 + 切向漩渦 + 阻尼；死法 = 進事件視界 ──
      alive = 0;
      let w = 0;
      const fadeOut = shrinkAt >= 0 ? Math.max(0, 1 - (t - shrinkAt) / 240) : 1;   // 黑洞收掉時還沒進去的也一起收
      for (let i = 0; i < emit; i++) {
        if (age[i] < 0) continue;
        age[i] += dtms;
        if (age[i] >= life[i]) { age[i] = -2; continue; }
        if (age[i] > delay[i]) {
          const dx = hx - px[i], dy = hy - py[i];
          const d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
          const a = Math.min(AMAX, GM / (d2 + SOFT));
          const nx = dx / d, ny = dy / d;
          const sw = tang[i] * 30000 / (d + 70);          // 切向分量：繞成弧線 / 螺旋，不是直線射向中心
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
      if (shrinkAt < 0 && emit >= n && (alive <= Math.max(6, stats.spawned * .03) || t > 1500)) shrinkAt = t;
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
      if ((emit < n || alive > 0 || holeFade > 0) && t < 2600) { frame = requestAnimationFrame(tick); return; }
      finish(true);
    }
    frame = requestAnimationFrame(tick);
    running = { done, reflow, restore, cancel() { if (finished) return; cancelled = true; finish(false); } };
    return running;
  }

  window.sfDissolve = { init, run, stats, get quality() { return quality; }, get webgl() { return !!gl; }, get max() { return MAX; }, get running() { return !!running; } };

  // ── 垃圾桶：清空這一床的資料 ──────────────────────────────────────────
  // 床位本身不會從房間裡消失，所以粉塵被吸走的同時，同一本資料夾會以「空床」重新長回來；
  // 清空跟以前一樣是草稿，要按「儲存修改」才會同步 (誤按可以直接改回來)。
  window.clearStudentData = async function (btn) {
    const folder = btn?.closest('.sf-folder') || document.querySelector('.sf-folder.active');
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
      for (const f of document.querySelectorAll('.sf-folder')) {
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
      window.sfCarousel?.lock();
      window._sfAbortClear = abort;             // 搜尋框在舞台外面，重新渲染名單前要先把這一場收掉
      if (sceneEl) sceneEl.inert = true;
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('app:navigate', onNavigation);
      // 省電模式：跳過 WebGL 粉塵/黑洞，直接清空欄位
      if (window.sfReduceMotion ? window.sfReduceMotion() : matchMedia('(prefers-reduced-motion: reduce)').matches) { haptic('medium'); resetFields(); showToast('床位已清空，按「儲存修改」同步', 'info'); return; }
      haptic('medium');
      handle = run(folder);
      // 粉塵大約飛到一半 (350ms) 就開始補位：清空欄位、資料夾以空床長回來，兩段動畫重疊
      const ok = await handle.reflow;
      if (!ok || cancelled) return;
      resetFields();
      haptic('light');
      showToast('床位已清空，按「儲存修改」同步', 'info');
      handle.restore();
      window.sfCarousel?.closeSheet(true);      // 先把紙收回去，長回來、抽出之後會再自動打開
      window.sfCarousel?.materialize(folder);   // 不 await：跟還在飛的粉塵同時進行
      await handle.done;
    } catch (err) {
      console.warn('[Dissolve]', err);
      if (!cancelled) resetFields();
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
