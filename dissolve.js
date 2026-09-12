// 刪除動畫：Gargantua 級黑洞 — 光線行進的引力透鏡、傾斜吸積盤、潮汐粉塵流、鏡頭震動、崩塌閃光與衝擊波
// (WebGL：粉塵畫到離屏貼圖，再由全螢幕透鏡 shader 逐像素彎曲；Canvas 2D 備援沒有透鏡)
// ─────────────────────────────────────────────────────────────────────────────
// 時間軸 (連續，沒有等待階段)：
//   0ms       輕點一下 (震動)、隆隆聲淡入、房間的燈滅掉：整個畫面壓暗 90%，只留一盞聚光燈在這本資料夾上
//   0-720     奇點在資料夾右上方點燃、長成黑洞：純黑陰影 + 光子環 + 傾斜 11° 的吸積盤 (接近側都卜勒增亮)
//             黑暗裡浮出星空，星光經過黑洞附近被拉成弧 (愛因斯坦環)，背景還有一層淡淡的星雲霧氣被攪動
//   220-980   崩解鋒面從右緣掃過資料夾：DOM 被遮罩吃掉、同一位置長出粉塵，聚光燈跟著鋒面縮小
//             粉塵被引力拉成弧線與螺旋，靠近黑洞被潮汐加熱成橘白，進了透鏡區影像被推到光子環上消失
//   300-1000  畫面四周的暗處也有碎屑被拉進來；鏡頭從 200ms 起開始顫動、越來越劇烈；手機同步震動
//   ~1250     粉塵幾乎吃光 → 內爆：陰影在 150ms 內縮成一點，吸積盤瞬間爆亮，隆隆聲拔高
//   +150      崩塌閃光：白熱核心炸開、一圈重力波往外掃 (折射星空與殘餘粉塵)、鏡頭猛震一下、手機重擊
//   +60       資料夾以「空床」在黑暗中長回來
//   +100~620  燈光閃兩下回來，星空退場；殘餘粉塵被震波推開淡出
//   ~2100ms   結束
//
// 效能：canvas / WebGL context / 兩支 shader / VBO / FBO / 4000 顆 typed-array 粒子池全部在頁面載入時建好，
// 並試畫一次 (暖機)。透鏡 shader 只在黑洞周圍 (rmax 倍視界半徑) 做光線行進，其他像素只是取樣 + 星空雜湊。
// 掉幀時自動減少行進步數與粉塵密度 (quality)。每幀零配置。
(() => {
  const MAX = 4000;                       // 粒子池上限 (資料夾粉塵 + 暗處碎屑)
  const FLOATS = 8;                       // 每顆送進 GPU：x, y, size, r, g, b, a, 保留
  // ── 粒子狀態 (全部預先配置，永遠重複使用) ──────────────────────────────
  const px = new Float32Array(MAX), py = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX);
  const cr = new Float32Array(MAX), cg = new Float32Array(MAX), cb = new Float32Array(MAX);
  const ca = new Float32Array(MAX), sz0 = new Float32Array(MAX);
  const age = new Float32Array(MAX), life = new Float32Array(MAX);
  const delay = new Float32Array(MAX), tang = new Float32Array(MAX), eaten = new Float32Array(MAX);
  const born = new Float32Array(MAX);     // 暗處碎屑：幾毫秒時出生
  const buf = new Float32Array(MAX * FLOATS);

  let canvas = null, gl = null, ctx2d = null, dpr = 1, W = 0, H = 0;
  let progDot = null, progLens = null, vboDot = null, vboQuad = null, fbo = null, fboTex = null, loc = {};
  let quality = 1;                        // 這台裝置學到的品質 (0.5 ~ 1)：粉塵密度與光線行進步數
  let running = null;
  const stats = { spawned: 0, peak: 0, frames: 0, ms: 0, masked: false, lens: false, soft: false };   // 上一場的實測數字
  const isLight = () => document.body.classList.contains('light-mode');
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const outExpo = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  const outCubic = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const inQuart = t => { t = clamp(t, 0, 1); return t * t * t * t; };
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  // 黑洞幾何 (單位 = 事件視界半徑 R)：JS 端的模擬與 shader 要用同一組數字
  const CAPT = 1.84;                      // 看得到的陰影半徑 (捕獲半徑 sqrt(1+2K)，K=1.2)
  const TILT = 0.26, ROLL = -0.42;        // 吸積盤仰角 15°、整體滾轉 -24° (右上翹)
  const DIM = 0.9;                        // 燈滅掉後畫面最暗 90%

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
  const QUAD_VS = `
    attribute vec2 a_quad;
    void main() { gl_Position = vec4(a_quad, 0.0, 1.0); }`;
  // 透鏡：每個像素射一條光線 (正交投影，+z 往畫面深處)，靠近黑洞時用 a = -K·r̂/r² 逐步彎曲。
  //   進視界 (r<1) → 黑；穿過吸積盤平面 → 累積發光 (差速旋轉的亂流、都卜勒增亮、內熱外冷)；
  //   逃出球面 → 沿最後方向打到 z=ZBG 的背景平面，那裡的座標就是去取樣粉塵貼圖 / 星空 / 霧氣的位置。
  //   球面外的像素用弱場近似 (偏折 2K/b)，進球面前後各補一半的解析偏折，球面邊緣才不會有接縫。
  const LENS_FS = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D u_tex;
    uniform vec2 u_res; uniform float u_dpr;
    uniform vec2 u_hole; uniform float u_R; uniform float u_holeA;
    uniform float u_time; uniform float u_dim; uniform float u_starA;
    uniform vec4 u_spot; uniform float u_front; uniform float u_feather;
    uniform vec2 u_shake; uniform float u_ripple; uniform float u_flash; uniform float u_feed;
    uniform float u_steps; uniform float u_rmax;
    const float K = 1.2;
    const float RIN = 2.05;
    const float ROUT = 6.2;
    const float ZBG = 6.0;
    const float TILT = ${TILT.toFixed(3)};
    const float ROLL = ${ROLL.toFixed(3)};
    const float BETA = 0.5;
    const float CAPT = ${CAPT.toFixed(3)};

    float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    vec2 rot(vec2 p, float a) { float c = cos(a); float s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
    float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

    // 星空：28px 一格的雜湊星點，約三成的格子有星、少數大星，各自閃爍
    vec3 stars(vec2 w) {
      vec2 g = w / 28.0; vec2 cell = floor(g); vec2 f = fract(g);
      float h = hash21(cell);
      vec2 sp = vec2(hash21(cell + 7.1), hash21(cell + 3.7)) * 0.8 + 0.1;
      float d = length(f - sp) * 28.0;
      float big = step(0.965, h);
      float sz = 0.9 + 1.4 * big;
      float br = smoothstep(0.72, 0.9, h) * (0.35 + 0.65 * big);
      float tw = 0.7 + 0.3 * sin(u_time * (2.0 + 5.0 * hash21(cell + 1.3)) + h * 40.0);
      vec3 tint = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.88, 0.75), hash21(cell + 9.2));
      return tint * br * tw * exp(-d * d / (sz * sz));
    }
    // 星雲霧氣：兩層值雜訊的冷紫色，被透鏡攪動時看得出空間在彎
    vec3 haze(vec2 w) {
      float n = vnoise(w * 0.0035 + vec2(u_time * 0.03, 0.0)) * 0.65 + vnoise(w * 0.011 - vec2(0.0, u_time * 0.05)) * 0.35;
      return vec3(0.16, 0.10, 0.28) * n * n;
    }
    // 粉塵貼圖 (預乘 alpha)；取樣座標跑出畫面就淡掉，不要拖出邊緣的殘影
    vec4 dust(vec2 w) {
      vec2 uv = vec2(w.x / u_res.x, 1.0 - w.y / u_res.y);
      float inside = smoothstep(0.0, 0.03, uv.x) * (1.0 - smoothstep(0.97, 1.0, uv.x)) * smoothstep(0.0, 0.03, uv.y) * (1.0 - smoothstep(0.97, 1.0, uv.y));
      return texture2D(u_tex, uv) * inside;
    }
    // 吸積盤：q 是光線穿過盤面的位置 (滾轉後的 3D 座標)
    void disk(vec3 q, inout vec3 emit, inout float trans) {
      float rq = length(q);
      if (rq < RIN || rq > ROUT) return;
      float ang = atan(dot(q, vec3(0.0, sin(TILT), -cos(TILT))), q.x);
      float spin = u_time * 5.0 / (rq * sqrt(rq));                       // 克卜勒差速旋轉：內快外慢
      float t1 = vnoise(vec2(ang * 2.2 - spin, rq * 2.4));
      float t2 = vnoise(vec2(ang * 7.0 - spin * 1.6 + 3.1, rq * 5.5 + u_time * 0.4));
      float t3 = vnoise(vec2(ang * 19.0 - spin * 2.3 + 7.7, rq * 9.0 - u_time * 0.2));   // 細絲
      float streak = 0.4 + 0.5 * t1 + 0.3 * (t2 - 0.5) + 0.3 * (t3 - 0.5);
      float dens = smoothstep(RIN, RIN + 0.3, rq) * (1.0 - smoothstep(ROUT - 1.6, ROUT, rq)) * clamp(streak, 0.0, 1.5);
      float radial = pow(RIN / rq, 1.6);                                   // 越靠內越亮 (外緣還看得到一條盤面)
      float vz = cos(ang) * (-cos(TILT));                                  // 切向速度的 z 分量
      float dop = 1.0 + BETA * vz;                                         // 朝鏡頭來的那一側 >1
      float beam = dop * dop * dop;                                        // 相對論性增亮 ~ D³
      float tc = smoothstep(RIN, ROUT, rq);
      vec3 c = mix(vec3(1.0, 0.94, 0.82), mix(vec3(1.0, 0.50, 0.10), vec3(0.50, 0.05, 0.02), smoothstep(0.30, 1.0, tc)), smoothstep(0.0, 0.45, tc));
      c = mix(c, c * vec3(0.85, 0.92, 1.2), clamp((dop - 1.0) * 1.3, 0.0, 0.6));   // 接近側微微藍移
      float e = dens * radial * beam * (0.85 + 1.9 * u_feed) * u_holeA;
      emit += c * e * trans;
      trans *= 1.0 - clamp(dens * 0.8, 0.0, 0.92);
    }

    void main() {
      vec2 p = vec2(gl_FragCoord.x / u_dpr, u_res.y - gl_FragCoord.y / u_dpr);   // DOM 座標 (y 往下)
      vec2 w = p - u_shake;                                                       // 鏡頭震動：世界座標
      // ── 聚光燈：資料夾還沒被吃掉的部分留亮，其餘一片黑 ──
      float right = min(u_spot.z, u_front);
      float spot = 0.0;
      vec2 hb = vec2((right - u_spot.x) * 0.5, (u_spot.w - u_spot.y) * 0.5);
      if (hb.x > 0.0) {
        vec2 c = vec2((u_spot.x + right) * 0.5, (u_spot.y + u_spot.w) * 0.5);
        float sd = sdBox(w - c, hb, min(24.0, min(hb.x, hb.y)));
        spot = 1.0 - smoothstep(-4.0, u_feather, sd);
      }
      float dark = u_dim * (1.0 - spot);

      // ── 引力透鏡 ──
      vec2 rel = (w - u_hole) / max(u_R, 0.001);
      float b = max(length(rel), 0.0001);
      vec2 bgw = w;
      float transmit = 1.0;
      vec3 emit = vec3(0.0);
      bool lensing = u_holeA > 0.001 && u_R > 0.6;
      if (lensing) {
        if (b < u_rmax) {
          vec2 rr = rot(rel, -ROLL);
          float ze = sqrt(max(u_rmax * u_rmax - b * b, 0.0));
          float pre = K / b * (1.0 - ze / u_rmax);                          // 進球面前已累積的偏折
          vec3 pos = vec3(rr, -ze);
          vec3 dir = normalize(vec3(-rr / b * tan(min(pre, 1.2)), 1.0));
          vec3 n = vec3(0.0, cos(TILT), sin(TILT));
          float prev = dot(pos, n);
          float trans = 1.0;
          bool captured = false;
          for (int i = 0; i < 64; i++) {
            if (float(i) >= u_steps) break;
            float r2 = dot(pos, pos); float r = sqrt(r2);
            if (r < 1.0) { captured = true; break; }
            if (r > u_rmax + 0.01 && pos.z > 0.0) break;
            float h = clamp(0.28 * r, 0.05, 0.9);
            dir = normalize(dir - pos * (K * h / (r2 * r)));
            pos += dir * h;
            float side = dot(pos, n);
            if (side * prev < 0.0) {
              float f = prev / (prev - side);
              disk(pos - dir * h * (1.0 - f), emit, trans);
            }
            prev = side;
          }
          if (!captured) {
            float b2 = max(length(pos.xy), 0.001);
            float post = K / b2 * (1.0 - min(1.0, sqrt(max(u_rmax * u_rmax - b2 * b2, 0.0)) / u_rmax));
            dir = normalize(dir + vec3(-pos.xy / b2 * post, 0.0));
            if (dir.z < 0.05) captured = true;
            else { vec2 e = pos.xy + dir.xy * max((ZBG - pos.z) / dir.z, 0.0); bgw = u_hole + rot(e, ROLL) * u_R; transmit = trans; }
          }
          if (captured) transmit = 0.0;
          // 光子環：緊貼陰影邊緣的一圈白熱
          float ring = exp(-pow((b - CAPT) * 6.0, 2.0)) * u_holeA;
          emit += vec3(1.0, 0.86, 0.62) * ring * (1.1 + 1.6 * u_feed);
        } else {
          float shift = tan(min(2.0 * K / b, 1.3)) * ZBG * (1.0 - smoothstep(9.0, 22.0, b));
          bgw = w - rel / b * shift * u_R;
        }
      }
      // ── 崩塌：閃光核心 + 往外掃的重力波 (折射背景) ──
      float dpx = length(w - u_hole);
      float sig = 24.0 + 220.0 * (1.0 - u_flash);
      vec3 flash = vec3(1.0, 0.93, 0.8) * u_flash * u_flash * exp(-dpx * dpx / (2.0 * sig * sig)) * 2.2;
      float rp = 0.0, rippleA = 0.0;
      if (u_ripple > 0.0) {
        float ringW = 10.0 + u_ripple * 0.035;
        rp = exp(-pow((dpx - u_ripple) / ringW, 2.0));
        rippleA = clamp(1.0 - u_ripple / 1400.0, 0.0, 1.0);
        bgw += (w - u_hole) / max(dpx, 1.0) * ((dpx - u_ripple) / ringW) * rp * rippleA * 30.0;
      }
      // ── 背景取樣：粉塵 + 星空 + 霧氣；靠近光子環的背景紅藍稍微分開 (色散) ──
      float caF = lensing ? 0.045 * (1.0 - smoothstep(1.9, 5.0, b)) : 0.0;
      vec4 d0 = dust(bgw);
      vec3 st = stars(bgw);
      vec3 du = d0.rgb;
      if (caF > 0.001) {
        vec2 rel2 = bgw - u_hole;
        vec2 bR = u_hole + rel2 * (1.0 + caF); vec2 bB = u_hole + rel2 * (1.0 - caF);
        du = vec3(dust(bR).r, d0.g, dust(bB).b);
        st = vec3(stars(bR).r, st.g, stars(bB).b);
      }
      float sky = u_starA * (1.0 - spot);
      vec3 bgc = du + (st + haze(bgw)) * sky;
      vec3 col = bgc * transmit + emit + flash + vec3(1.0, 0.9, 0.75) * rp * rippleA * 0.6;
      // 頁面還看得見多少：黑暗 × 粉塵遮蔽 × 黑洞陰影；閃光與波前會把黑暗漂白一點
      float V = (1.0 - dark) * (1.0 - d0.a * transmit) * transmit;
      V = mix(V, 1.0, clamp(u_flash * 0.55 + rp * rippleA * 0.3, 0.0, 1.0) * (1.0 - spot));
      gl_FragColor = vec4(col, 1.0 - V);
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
    // 軟體算圖 (SwiftShader / llvmpipe：遠端桌面、VM、headless) 跑不動全螢幕透鏡 pass (實測一幀 335ms)，
    // 改走 Canvas 2D 備援 (黑暗、聚光燈、簡化黑洞、閃光、衝擊波都有，只是沒有透鏡)
    if (gl) {
      try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const rn = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(rn)) {
          stats.soft = true;
          try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (_) {}
          gl = null;
          canvas.remove();                                   // 同一張 canvas 拿過 WebGL 就拿不到 2D，換一張
          canvas = document.createElement('canvas');
          canvas.className = 'sf-dissolve-canvas';
          canvas.setAttribute('aria-hidden', 'true');
          document.body.appendChild(canvas);
        }
      } catch (_) {}
    }
    if (gl) {
      progDot = link(DOT_VS, DOT_FS);
      progLens = link(QUAD_VS, LENS_FS);
      if (!progDot || !progLens) gl = null;
    }
    if (gl) {
      vboDot = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboDot);
      gl.bufferData(gl.ARRAY_BUFFER, buf.byteLength, gl.DYNAMIC_DRAW);
      vboQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      // 離屏貼圖：粉塵先畫到這裡，透鏡 pass 再把它彎曲
      fboTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fbo = gl.createFramebuffer();
      const U = (p, n) => gl.getUniformLocation(p, n);
      loc = {
        dPos: gl.getAttribLocation(progDot, 'a_pos'), dSize: gl.getAttribLocation(progDot, 'a_size'),
        dCol: gl.getAttribLocation(progDot, 'a_col'), dRes: U(progDot, 'u_res'), dDpr: U(progDot, 'u_dpr'),
        quad: gl.getAttribLocation(progLens, 'a_quad'),
        tex: U(progLens, 'u_tex'), res: U(progLens, 'u_res'), dpr: U(progLens, 'u_dpr'),
        hole: U(progLens, 'u_hole'), R: U(progLens, 'u_R'), holeA: U(progLens, 'u_holeA'),
        time: U(progLens, 'u_time'), dim: U(progLens, 'u_dim'), starA: U(progLens, 'u_starA'),
        spot: U(progLens, 'u_spot'), front: U(progLens, 'u_front'), feather: U(progLens, 'u_feather'),
        shake: U(progLens, 'u_shake'), ripple: U(progLens, 'u_ripple'), flash: U(progLens, 'u_flash'),
        feed: U(progLens, 'u_feed'), steps: U(progLens, 'u_steps'), rmax: U(progLens, 'u_rmax')
      };
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // 預乘 alpha：粉塵疊起來會變密但不會爆白
    } else {
      ctx2d = canvas.getContext('2d');
    }
    resize();
    warmUp();
    window.addEventListener('resize', resize);
  }
  // 暖機：載入時就真的把兩個 pass 都畫一次 (shader 送上 GPU、FBO 配好、合成層建好)，第一次刪除才不會頓
  function warmUp() {
    if (gl) {
      buf[0] = 6; buf[1] = 6; buf[2] = 2; buf[3] = buf[4] = buf[5] = 1; buf[6] = 0.004;
      drawScene(1, { hx: 6, hy: 6, R: 1, holeA: .001, t: 0, dim: .001, starA: 0, spot: [0, 0, 0, 0], front: -1, feather: 1, sx: 0, sy: 0, ripple: -1, flash: 0, feed: 0 });
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
    // 整張畫布壓在 3.2MP 以內 (透鏡 pass 是全螢幕逐像素，超大螢幕不需要 2x)
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.2e6 / Math.max(1, W * H))));
    const nw = Math.round(W * dpr), nh = Math.round(H * dpr);
    if (canvas.width === nw && canvas.height === nh) return;   // iOS 捲動時網址列伸縮也會發 resize
    canvas.width = nw; canvas.height = nh;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (gl) {
      gl.viewport(0, 0, nw, nh);
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      stats.lens = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
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
  // 一幀：粉塵 → FBO，然後全螢幕透鏡 pass 把 FBO + 星空 + 黑洞 + 黑暗 + 閃光合成到畫布
  function drawScene(n, u) {
    if (stats.lens) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      drawDots(n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!stats.lens) { gl.enable(gl.BLEND); drawDots(n); return; }   // FBO 不能用：至少粉塵還在
    gl.disable(gl.BLEND);                                             // 透鏡 pass 直接輸出整層 (預乘)
    gl.useProgram(progLens);
    gl.disableVertexAttribArray(loc.dSize); gl.disableVertexAttribArray(loc.dCol);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
    gl.enableVertexAttribArray(loc.quad); gl.vertexAttribPointer(loc.quad, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboTex); gl.uniform1i(loc.tex, 0);
    gl.uniform2f(loc.res, W, H); gl.uniform1f(loc.dpr, dpr);
    gl.uniform2f(loc.hole, u.hx, u.hy); gl.uniform1f(loc.R, u.R); gl.uniform1f(loc.holeA, u.holeA);
    gl.uniform1f(loc.time, u.t); gl.uniform1f(loc.dim, u.dim); gl.uniform1f(loc.starA, u.starA);
    gl.uniform4f(loc.spot, u.spot[0], u.spot[1], u.spot[2], u.spot[3]); gl.uniform1f(loc.front, u.front); gl.uniform1f(loc.feather, u.feather);
    gl.uniform2f(loc.shake, u.sx, u.sy); gl.uniform1f(loc.ripple, u.ripple); gl.uniform1f(loc.flash, u.flash); gl.uniform1f(loc.feed, u.feed);
    gl.uniform1f(loc.steps, Math.round(22 + 26 * quality)); gl.uniform1f(loc.rmax, 5.0 + 1.6 * quality);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.BLEND);
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

  // ── 手機震動：Android 走 Vibration API 的節奏，iPhone 走 Taptic 開關敲擊 + 低頻波形 ──
  const HAP = {
    muted: () => { try { return typeof hapticMuted === 'function' && hapticMuted(); } catch (_) { return false; } },
    ios: () => typeof IS_IOS !== 'undefined' && IS_IOS,
    vib(p) { try { if (typeof hasVibrate === 'function' && hasVibrate()) navigator.vibrate(p); } catch (_) {} },
    tap(n, gap) { try { if (typeof iosSwitchHaptic === 'function') iosSwitchHaptic(n, gap); } catch (_) {} },
    curve(c, ms, w, hz) { try { if (typeof playHapticCurve === 'function') playHapticCurve(c, ms, w, hz); } catch (_) {} },
    ignite() { if (this.muted()) return; this.vib(12); this.tap(1); },
    // 顫動：越來越密、越來越重 (Android 一次送整段節奏；iPhone 由時間軸逐下敲)
    rumble() { if (this.muted()) return; this.vib([14, 110, 18, 95, 22, 80, 26, 70, 30, 60, 36, 50, 42, 42, 50, 36, 60, 30]); },
    tick() { if (this.muted()) return; this.tap(1); },
    collapse() { if (this.muted()) return; this.vib([45, 25, 90]); this.tap(2, 55); },
    flash() { if (this.muted()) return; this.vib([190, 50, 60, 70, 35, 90, 20]); this.tap(3, 40); this.curve([.32, .38, .14, .05, .02, .001], 420, 'square', 58); },
    settle() { if (this.muted()) return; this.vib(10); this.tap(1); }
  };
  const IOS_TAPS = [300, 430, 550, 660, 760, 850, 930, 1000, 1060, 1110];   // iPhone 顫動的敲擊時刻 (ms)

  // ── 聲音：低頻隆隆 (棕噪音 + 鋸齒低音) → 內爆拔高 → 崩塌一聲悶轟 + 劈啪 + 呼嘯 ──
  let noiseBufs = null;
  function startRumble() {
    try {
      if (localStorage.getItem('mute_sound') === 'true') return null;
      if (typeof initAudioCtx !== 'function') return null;
      initAudioCtx();
      const ac = audioCtx;
      if (!ac) return null;
      const t0 = ac.currentTime;
      const master = ac.createGain(); master.gain.value = 1; master.connect(ac.destination);
      if (!noiseBufs || noiseBufs.ac !== ac) {            // 噪音樣本只算一次，之後重複用
        const sr = ac.sampleRate;
        const brown = ac.createBuffer(1, sr * 2, sr), bd = brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < bd.length; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
        const white = ac.createBuffer(1, Math.round(sr * .7), sr), wd = white.getChannelData(0);
        for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
        noiseBufs = { ac, brown, white };
      }
      const { brown, white } = noiseBufs;
      const noise = ac.createBufferSource(); noise.buffer = brown; noise.loop = true;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 1.1;
      const gN = ac.createGain(); gN.gain.setValueAtTime(.0001, t0); gN.gain.exponentialRampToValueAtTime(.5, t0 + .7);
      noise.connect(lp); lp.connect(gN); gN.connect(master);
      const sub = ac.createOscillator(); sub.type = 'sawtooth'; sub.frequency.setValueAtTime(58, t0);
      const lfo = ac.createOscillator(); lfo.frequency.value = 6.5;
      const lfoG = ac.createGain(); lfoG.gain.value = 9; lfo.connect(lfoG); lfoG.connect(sub.frequency);
      const lp2 = ac.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 220;
      const gS = ac.createGain(); gS.gain.setValueAtTime(.0001, t0); gS.gain.exponentialRampToValueAtTime(.16, t0 + .8);
      sub.connect(lp2); lp2.connect(gS); gS.connect(master);
      noise.start(t0); sub.start(t0); lfo.start(t0);
      const stopAll = at => { try { noise.stop(at); sub.stop(at); lfo.stop(at); } catch (_) {} };
      const hold = (g, t) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(.0001, g.gain.value), t); };
      let ended = false;
      return {
        collapse() {
          const t = ac.currentTime;
          hold(gN, t); gN.gain.exponentialRampToValueAtTime(.8, t + .14);
          sub.frequency.cancelScheduledValues(t); sub.frequency.setValueAtTime(58, t); sub.frequency.exponentialRampToValueAtTime(150, t + .15);
        },
        flash() {
          const t = ac.currentTime;
          hold(gN, t); gN.gain.exponentialRampToValueAtTime(.0001, t + .12);
          hold(gS, t); gS.gain.exponentialRampToValueAtTime(.0001, t + .1);
          const boom = ac.createOscillator(); boom.type = 'triangle';
          boom.frequency.setValueAtTime(150, t); boom.frequency.exponentialRampToValueAtTime(36, t + .42);
          const shaper = ac.createWaveShaper(); const curve = new Float32Array(256);
          for (let i = 0; i < 256; i++) curve[i] = Math.tanh(2.8 * (i / 127.5 - 1));
          shaper.curve = curve;
          const gB = ac.createGain(); gB.gain.setValueAtTime(.7, t); gB.gain.exponentialRampToValueAtTime(.0001, t + .62);
          boom.connect(shaper); shaper.connect(gB); gB.connect(master); boom.start(t); boom.stop(t + .7);
          const crack = ac.createBufferSource(); crack.buffer = white;
          const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = .8;
          const gC = ac.createGain(); gC.gain.setValueAtTime(.3, t); gC.gain.exponentialRampToValueAtTime(.0001, t + .22);
          crack.connect(bp); bp.connect(gC); gC.connect(master); crack.start(t); crack.stop(t + .3);
          const wh = ac.createBufferSource(); wh.buffer = white;
          const bp2 = ac.createBiquadFilter(); bp2.type = 'bandpass'; bp2.Q.value = .6;
          bp2.frequency.setValueAtTime(250, t); bp2.frequency.exponentialRampToValueAtTime(2600, t + .5);
          const gW = ac.createGain(); gW.gain.setValueAtTime(.0001, t); gW.gain.exponentialRampToValueAtTime(.12, t + .08); gW.gain.exponentialRampToValueAtTime(.0001, t + .55);
          wh.connect(bp2); bp2.connect(gW); gW.connect(master); wh.start(t); wh.stop(t + .6);
          stopAll(t + .2); ended = true;
        },
        stop() {   // 中斷：80ms 內收掉
          const t = ac.currentTime;
          master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + .08);
          if (!ended) stopAll(t + .1);
        }
      };
    } catch (e) { return null; }
  }

  // ── 主流程 ─────────────────────────────────────────────────────────────
  function run(root, opts = {}) {
    init();
    if (running) running.cancel();
    quality = Math.min(1, quality + .12);          // 上次掉幀降過的品質慢慢還回來
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
    const page = document.getElementById('page-student-files');   // 鏡頭震動：整頁一起晃
    // 崩解鋒面：從右緣往左掃。DOM 遮罩與粒子誕生共用同一個門檻 —
    //   threshold(x, y) = 離右緣的比例 + noise(x, y)；progress 掃過門檻，該格的 DOM 消失、同一位置生出粉塵。
    //   DOM 端做不到逐像素雜訊，所以用一條 FEATHER 寬的漸層過渡帶，粒子 (帶雜訊) 就密集出生在這條帶裡 → ▓▒░
    const FEATHER = Math.max(44, bw * .1);
    // 黑洞：事件視界半徑 R (px)，看得到的陰影約 1.84R、吸積盤到 6.2R。放在資料夾右上角外側一點，
    // 粉塵要有一段看得見的流線；陰影不能出畫面
    const R = clamp(bw * .105, 22, 58);
    const hx = clamp(box.r - bw * .02, 2.4 * R, innerWidth - 3.2 * R);
    const hy = clamp(box.t + bh * .2, 2.6 * R, innerHeight - 3 * R);
    const horizon = R * 1.7;                        // 模擬裡的吞噬半徑：透鏡會把這裡的影像推到光子環上，粉塵就在環上消失

    // ── 生成：整本切成細格，每顆粉塵就出生在自己那一格 (一定在資料夾矩形內)，顏色取自該格所在的區塊 ──
    const AMB = mobile ? 160 : 260;                 // 暗處被拉進來的碎屑
    const target = Math.round((mobile ? 1300 : innerWidth < 1024 ? 1800 : 2400) * quality);   // 桌機 1500-3000、手機 700-1400 (掉幀會再打折)
    let rnd = .137;
    const rand = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
    const sample = sampler(root);
    // 三成五的格子會多一顆，所以格距要把 1.35 倍算進去，總數才會落在目標附近
    const step = Math.max(2.2, Math.sqrt(bw * bh * 1.35 / Math.min(target, MAX - AMB)));
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
    const n = Math.min(MAX - AMB, cells.length);
    const cols = palette();
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      px[i] = c.x; py[i] = c.y; age[i] = -1; eaten[i] = 0; born[i] = 0;
      const roll = rand();
      // 七成 1-2px 極細粉塵、兩成 2-3px、8% 3-4px、2% 4-5px 亮碎片
      sz0[i] = roll < .7 ? 1 + rand() : roll < .9 ? 2 + rand() : roll < .98 ? 3 + rand() : 4 + rand();
      const col = cols[c.p], bright = roll >= .98 ? 1.3 : roll >= .9 ? 1.1 : 1;
      cr[i] = Math.min(1, col[0] * bright); cg[i] = Math.min(1, col[1] * bright); cb[i] = Math.min(1, col[2] * bright);
      ca[i] = roll < .7 ? .5 + rand() * .32 : roll < .98 ? .72 + rand() * .25 : 1;
      life[i] = 2600 + rand() * 600;                 // 只是保險；正常死法是進事件視界
      delay[i] = 20 + rand() * 40;                   // 剝離後先留在原位這麼久，才受引力影響
      tang[i] = (rand() < .5 ? -1 : 1) * (.7 + rand() * .9);
      // 初速：幾乎不動，只有一點點雜訊 (剛剝離時要看得出是從資料夾本體長出來的)
      vx[i] = (rand() - .5) * 26;
      vy[i] = -(3 + rand() * 12) + (rand() - .5) * 16;
    }
    // 暗處碎屑：黑洞周圍半個畫面外的一圈，300~1000ms 之間陸續被拉進來，帶點切向速度所以會繞
    const diag = Math.hypot(innerWidth, innerHeight);
    const total = n + AMB;
    for (let i = n; i < total; i++) {
      const a = rand() * 6.2832, d = diag * (.32 + rand() * .5);
      px[i] = clamp(hx + Math.cos(a) * d, -20, innerWidth + 20); py[i] = clamp(hy + Math.sin(a) * d, -20, innerHeight + 20);
      age[i] = -1; eaten[i] = 0; born[i] = 300 + rand() * 700;
      sz0[i] = 1 + rand() * 1.2;
      const g = .5 + rand() * .3;
      cr[i] = g * .8; cg[i] = g * .85; cb[i] = g;
      ca[i] = .3 + rand() * .35;
      life[i] = 3000; delay[i] = 0;
      tang[i] = (rand() < .5 ? -1 : 1) * (.9 + rand() * .8);
      const s = 50 + rand() * 110;                   // 切向初速：不會直直射進去
      vx[i] = -Math.sin(a) * s * tang[i]; vy[i] = Math.cos(a) * s * tang[i];
    }

    const WIPE_T0 = 220, WIPE_T1 = 980, OVER = 1.14;   // progress 掃過 1 之後再多一點，雜訊最高的格子才會全剝離
    // 引力：a = GM/(d²+soft)。最遠的粉塵離黑洞 ~600px，要在 500ms 內被拉過去，所以 GM 要夠大；
    // 加速度與速度都設上限，才不會在近距離爆掉 / 一幀衝過視界
    const GM = 1.9e9, SOFT = (R * .9) * (R * .9), AMAX = 15000, VMAX = 2800;
    let emit = 0, alive = 0, frame = 0, t0 = 0, lastNow = 0, slow = 0, feed = 0, blasted = false;
    let hidden = false, released = false, finished = false, cancelled = false;
    let collapseAt = -1, flashT = -1, hapIdx = 0, rumbled = false, settled = false;
    let resolveDone, resolveReflow, reflowed = false;
    const done = new Promise(r => resolveDone = r);
    const reflow = new Promise(r => resolveReflow = r);

    stats.spawned = 0; stats.peak = 0; stats.frames = 0; stats.ms = 0; stats.masked = false;
    root.classList.add('fd-dissolving');
    canvas.classList.add('is-running');
    const audio = startRumble();
    HAP.ignite();
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
      if (page) page.style.transform = '';
      if (audio) audio.stop();
      if (needResize) resize();
      if (!ok) restore();
      if (!reflowed) { reflowed = true; resolveReflow(ok); }
      resolveDone(ok);
    }
    // 鏡頭震動：200ms 起低頻顫動慢慢累積 (最大 8px)、內爆再加一點、崩塌那一擊 18px 高頻猛抖再衰減成餘震
    function shakeAt(t) {
      let A = t > 200 ? 1.2 + 6.8 * smooth((t - 200) / 950) : 0;
      if (collapseAt >= 0) A += 4 * clamp((t - collapseAt) / 150, 0, 1);
      let sx = 0, sy = 0;
      if (flashT >= 0) {
        const u = t - flashT;
        A = 6 * Math.exp(-u / 170) + 3 * Math.max(0, 1 - u / 600);
        sx += 14 * Math.exp(-u / 120) * Math.sin(u * .35); sy += 10 * Math.exp(-u / 120) * Math.cos(u * .41);
      }
      sx += A * (Math.sin(t * .029) * .45 + Math.sin(t * .061 + 2.1) * .35 + Math.sin(t * .131 + .7) * .2);
      sy += A * (Math.sin(t * .037 + 1.1) * .45 + Math.sin(t * .053 + 3.3) * .35 + Math.sin(t * .149 + 2.2) * .2);
      return [sx, sy];
    }
    function tick(now) {
      frame = 0;
      if (cancelled) return;
      if (!t0) { t0 = now; lastNow = now; }
      const t = now - t0, dtms = Math.min(48, now - lastNow); lastNow = now;
      const dt = dtms / 1000;
      // 自適應品質：連續兩幀掉到 45fps 以下就降 (粉塵少生一些、光線行進步數減少；已經生出來的不動)
      if (dtms > 22) { if (++slow >= 2) { quality = Math.max(.5, quality * (dtms > 28 ? .65 : .8)); slow = 0; } } else slow = 0;

      // ── 階段切換 ──
      if (collapseAt < 0 && t >= 1150 && emit >= n && (alive <= Math.max(6, stats.spawned * .03) || t > 1500)) { collapseAt = t; if (audio) audio.collapse(); HAP.collapse(); }
      if (collapseAt >= 0 && flashT < 0 && t >= collapseAt + 150) { flashT = t; if (audio) audio.flash(); HAP.flash(); }
      if (!rumbled && t >= 280) { rumbled = true; HAP.rumble(); }
      if (HAP.ios()) while (hapIdx < IOS_TAPS.length && t >= IOS_TAPS[hapIdx] && collapseAt < 0) { HAP.tick(); hapIdx++; }
      if (!settled && flashT >= 0 && t >= flashT + 300) { settled = true; HAP.settle(); }
      const attract = flashT < 0;
      const Rnow = flashT >= 0 ? 0 : collapseAt >= 0 ? R * (1 - inQuart((t - collapseAt) / 150)) : R * outExpo(t / 720);
      const holeA = flashT >= 0 ? 0 : clamp((t - 30) / 220, 0, 1);
      const flash = flashT >= 0 ? Math.exp(-(t - flashT) / 140) : 0;
      const ripple = flashT >= 0 ? (t - flashT) * 2.4 : -1;
      // 燈光：380ms 滅到 90%；閃光後 100ms 開始回來、520ms 全亮，中間閃兩下
      let dim = DIM * outCubic(t / 380);
      if (flashT >= 0) {
        const u = t - flashT;
        if (u > 100) {
          const f1 = Math.exp(-Math.pow((u - 190) / 28, 2)), f2 = Math.exp(-Math.pow((u - 290) / 40, 2));
          dim = Math.min(DIM, DIM * (1 - outCubic((u - 100) / 520)) + DIM * (.5 * f1 + .35 * f2));
        }
      }
      const starA = smooth((dim / DIM - .15) / .65);

      // ── 崩解鋒面：DOM 遮罩與粒子誕生同步 ──
      const prog = t < WIPE_T0 ? 0 : easeInOut(clamp((t - WIPE_T0) / (WIPE_T1 - WIPE_T0), 0, 1)) * OVER;
      while (t >= WIPE_T0 && emit < n && cells[emit].d <= prog) {
        if (quality >= .999 || ((emit * .618034) % 1) < quality) { age[emit] = 0; stats.spawned++; }   // 保留比例 = quality
        emit++;
      }
      const frontX = box.r - prog * bw;
      if (!released) {
        if (t >= WIPE_T0 && !hidden) for (const m of masks) setMask(m, frontX);
        for (const s of rigid) s.style.opacity = String(Math.max(0, 1 - prog * 1.6));
        if (prog >= OVER && !hidden) { hidden = true; for (const m of masks) m.el.style.visibility = 'hidden'; }
      }
      for (let i = n; i < total; i++) if (age[i] === -1 && attract && t >= born[i]) { age[i] = 0; stats.spawned++; }
      // 補位：崩塌閃光之後，資料夾在黑暗裡長回來，燈亮的時候已經在抽出了
      if (!reflowed && flashT >= 0 && t >= flashT + 60) { reflowed = true; resolveReflow(true); }

      // ── 物理：引力 + 切向漩渦 + 阻尼 + 潮汐加熱；死法 = 進事件視界。崩塌後剩下的被震波推開 ──
      alive = 0;
      let w = 0, eatCount = 0;
      const blast = flashT >= 0 && !blasted; if (blast) blasted = true;
      for (let i = 0; i < total; i++) {
        if (age[i] < 0) continue;
        age[i] += dtms;
        if (age[i] >= life[i]) { age[i] = -2; continue; }
        const dx = hx - px[i], dy = hy - py[i];
        const d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
        if (attract && age[i] > delay[i]) {
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
            const u = ss > 0 ? clamp((dx * sx + dy * sy) / ss, 0, 1) : 0;
            const cx = px[i] + sx * u - hx, cy = py[i] + sy * u - hy;
            if (d < horizon || cx * cx + cy * cy < horizon * horizon) { eaten[i] = .001; eatCount++; }
          }
          if (eaten[i] > 0) { eaten[i] = Math.min(1, eaten[i] + dtms / 70); px[i] += (hx - px[i]) * .35; py[i] += (hy - py[i]) * .35; vx[i] *= .5; vy[i] *= .5; }
        } else if (!attract) {
          if (blast) { const k = 400 + 60000 / (d + 30); vx[i] = -dx / d * k + vx[i] * .2; vy[i] = -dy / d * k + vy[i] * .2; }
          const drag = Math.exp(-2.2 * dt);
          vx[i] *= drag; vy[i] *= drag;
        }
        px[i] += vx[i] * dt; py[i] += vy[i] * dt;
        let r = cr[i], g = cg[i], bl = cb[i], alpha = ca[i], s = sz0[i];
        if (attract && d < R * 4.5) {                   // 潮汐加熱：越近越橘白、越亮、稍大
          const heat = clamp((R * 4.5 - d) / (R * 3), 0, 1);
          r += (1 - r) * heat; g += (.72 - g) * heat; bl += (.30 - bl) * heat;
          alpha = Math.min(1, alpha * (1 + heat * .6)); s *= 1 + heat * .35;
        }
        if (flashT >= 0) alpha *= Math.max(0, 1 - (t - flashT) / 380);
        if (eaten[i] > 0) {
          alpha *= (1 - eaten[i]) * (1 + eaten[i] * .9);          // 被吞前先亮一下
          s *= 1 - eaten[i];
          if (eaten[i] >= 1) { age[i] = -2; continue; }
        }
        if (alpha <= .004 || s <= .15) continue;
        alive++;
        const o = w * FLOATS;
        buf[o] = px[i]; buf[o + 1] = py[i]; buf[o + 2] = s;
        buf[o + 3] = r; buf[o + 4] = g; buf[o + 5] = bl; buf[o + 6] = alpha; buf[o + 7] = 0;
        w++;
      }
      // 進食：這一幀吞了多少 → 吸積盤與光子環亮起來；內爆時再加一把
      feed += (Math.min(1, eatCount / 5) - feed) * Math.min(1, dt * 9);
      const feedU = Math.min(2.2, feed + (collapseAt >= 0 && flashT < 0 ? 1.4 * clamp((t - collapseAt) / 150, 0, 1) : 0));
      const [sx, sy] = shakeAt(t);
      if (page) page.style.transform = (sx || sy) ? `translate3d(${sx.toFixed(2)}px,${sy.toFixed(2)}px,0)` : '';
      const spot = [box.l - 14, box.t - 14, box.r + 14, box.b + 14];
      const front = (hidden || released) ? -1e4 : t < WIPE_T0 ? box.r + 14 : frontX + FEATHER * .6;
      const u = { hx, hy, R: Rnow, holeA, t: t / 1000, dim, starA, spot, front, feather: 48, sx, sy, ripple, flash, feed: feedU };

      // ── 畫 ──
      if (gl) {
        drawScene(w, u);
      } else if (ctx2d) {
        const c = ctx2d;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, W, H);
        c.save(); c.translate(sx, sy);
        if (dim > .002) {                                // 黑暗 + 聚光燈 (備援：硬邊)
          c.fillStyle = `rgba(0,0,0,${dim.toFixed(3)})`; c.fillRect(-40, -40, W + 80, H + 80);
          const right = Math.min(spot[2], front);
          if (right > spot[0]) {
            c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
            c.beginPath(); c.roundRect ? c.roundRect(spot[0], spot[1], right - spot[0], spot[3] - spot[1], 22) : c.rect(spot[0], spot[1], right - spot[0], spot[3] - spot[1]); c.fill();
            c.globalCompositeOperation = 'source-over';
          }
        }
        for (let i = 0; i < w; i++) {
          const o = i * FLOATS, s = buf[o + 2];
          c.globalAlpha = Math.min(1, buf[o + 6]);
          c.fillStyle = `rgb(${buf[o + 3] * 255 | 0},${buf[o + 4] * 255 | 0},${buf[o + 5] * 255 | 0})`;
          c.fillRect(buf[o] - s / 2, buf[o + 1] - s / 2, s, s);
        }
        c.globalAlpha = 1;
        if (Rnow > .5 && holeA > 0) {                    // 吸積盤 (橢圓) + 陰影 + 光子環
          c.save(); c.translate(hx, hy); c.rotate(ROLL); c.globalAlpha = holeA;
          const g = c.createRadialGradient(0, 0, Rnow * 1.9, 0, 0, Rnow * 6.2);
          g.addColorStop(0, `rgba(255,240,210,${.95})`); g.addColorStop(.25, 'rgba(255,128,30,.85)'); g.addColorStop(.7, 'rgba(140,20,8,.5)'); g.addColorStop(1, 'rgba(80,5,5,0)');
          c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, Rnow * 6.2, Rnow * 6.2 * Math.sin(TILT) * 1.6, 0, 0, 6.2832); c.fill();
          c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, Rnow * CAPT, 0, 6.2832); c.fill();
          c.strokeStyle = 'rgba(255,220,170,.9)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, Rnow * CAPT, 0, 6.2832); c.stroke();
          c.restore();
        }
        if (flash > .01) {
          const sig = 30 + 260 * (1 - flash);
          const g = c.createRadialGradient(hx, hy, 0, hx, hy, sig * 2);
          g.addColorStop(0, `rgba(255,240,210,${Math.min(1, flash * flash * 2).toFixed(3)})`); g.addColorStop(1, 'rgba(255,240,210,0)');
          c.fillStyle = g; c.fillRect(0, 0, W, H);
        }
        if (ripple > 0 && ripple < 1400) {
          c.strokeStyle = `rgba(255,230,190,${(.8 * (1 - ripple / 1400)).toFixed(3)})`; c.lineWidth = 6; c.beginPath(); c.arc(hx, hy, ripple, 0, 6.2832); c.stroke();
        }
        c.restore();
      }
      stats.frames++; stats.ms = t; if (alive > stats.peak) stats.peak = alive;
      const endT = flashT >= 0 ? flashT + 720 : 1e9;
      if (t < endT && t < 3200) { frame = requestAnimationFrame(tick); return; }
      finish(true);
    }
    frame = requestAnimationFrame(tick);
    running = { done, reflow, restore, cancel() { if (finished) return; cancelled = true; finish(false); } };
    return running;
  }

  // 量測用：畫 frames 幀最壞情況 (黑洞全開、全黑、星空、1500 顆粉塵)，用 gl.finish() 等 GPU 做完，回傳每幀毫秒
  function bench(frames = 30) {
    init();
    if (!gl || running) return null;
    for (let i = 0; i < 1500; i++) { const o = i * FLOATS; buf[o] = (i * 37) % W; buf[o + 1] = (i * 91) % H; buf[o + 2] = 1 + (i % 4); buf[o + 3] = buf[o + 4] = buf[o + 5] = .9; buf[o + 6] = .8; }
    const R = clamp(Math.min(W, H) * .78 * .105, 22, 58);
    const u = { hx: W * .7, hy: H * .3, R, holeA: 1, t: 1, dim: DIM, starA: 1, spot: [W * .1, H * .3, W * .6, H * .7], front: W * .4, feather: 48, sx: 2, sy: 1, ripple: -1, flash: 0, feed: .5 };
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // 讀回 1 像素 = 真的等 GPU 做完 (finish 在 ANGLE 上不一定會等)
    sync();
    const a = performance.now();
    for (let i = 0; i < frames; i++) { u.t = i / 60; drawScene(1500, u); }
    sync();
    const ms = (performance.now() - a) / frames;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { msPerFrame: ms, px: canvas.width * canvas.height, quality, R };
  }
  window.sfDissolve = { init, run, stats, bench, get quality() { return quality; }, set quality(v) { quality = clamp(+v || 1, .5, 1); }, get webgl() { return !!gl; }, get lens() { return stats.lens; }, get max() { return MAX; }, get running() { return !!running; } };

  // ── 垃圾桶：清空這一床的資料 ──────────────────────────────────────────
  // 床位本身不會從房間裡消失，所以黑洞崩塌之後，同一本資料夾會以「空床」重新長回來；
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
      // 省電模式：跳過黑洞，直接清空欄位
      if (window.sfReduceMotion ? window.sfReduceMotion() : matchMedia('(prefers-reduced-motion: reduce)').matches) { haptic('medium'); resetFields(); showToast('床位已清空，按「儲存修改」同步', 'info'); return; }
      handle = run(folder);                     // 震動與聲音的節奏都在動畫的時間軸裡
      // 黑洞崩塌之後才補位：清空欄位、資料夾在黑暗裡以空床長回來，燈亮時已經在抽出
      const ok = await handle.reflow;
      if (!ok || cancelled) return;
      resetFields();
      showToast('床位已清空，按「儲存修改」同步', 'info');
      handle.restore();
      window.sfCarousel?.closeSheet(true);      // 先把紙收回去，長回來、抽出之後會再自動打開
      window.sfCarousel?.materialize(folder);   // 不 await：跟燈光回來同時進行
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
