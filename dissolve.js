// 刪除動畫：Telegram 式粒子消散 (Canvas 2D)
// ─────────────────────────────────────────────────────────────────────────────
// 按下垃圾桶 → 資料夾微縮微亮 (0-70ms) → 一條不規則的消散邊界從垃圾桶位置往外掃 (70-290ms)，
// 邊界掃過的地方，DOM 用 radial-gradient 遮罩同步消失，同一位置在共用的 canvas 上冒出 2-5px 的
// 粉塵，帶著資料夾原本的白 / 薰衣草紫 / 紫色，往右上飄、減速、淡出 (每顆 170-300ms)。
// 整段約 0.5 秒。不截圖、不載外部程式庫：顏色是拿資料夾各區塊 (玻璃、紙、輸入框、標籤、文字)
// 的位置與主題色去採樣的，所以第一次刪除也不會卡。
// 效能：canvas 與 1000 顆的粒子池在頁面載入就建好 (typed array，不會每次 new 物件)；
// 桌機約 700 顆、手機約 320 顆，連續兩幀超過 21ms 就自動降密度，60fps 優先。
(() => {
  const MAX = 1000;
  const px = new Float32Array(MAX), py = new Float32Array(MAX), vx = new Float32Array(MAX), vy = new Float32Array(MAX);
  const age = new Float32Array(MAX), life = new Float32Array(MAX), size = new Float32Array(MAX), seed = new Float32Array(MAX);
  const dist = new Float32Array(MAX), pal = new Uint8Array(MAX), glow = new Uint8Array(MAX);
  let canvas = null, ctx = null, dpr = 1, W = 0, H = 0;
  let quality = 1;                 // 這台裝置學到的密度 (0.45 ~ 1)，掉幀就往下調
  let running = null;              // 目前這一場
  const isLight = () => document.body.classList.contains('light-mode');

  function init() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'sf-dissolve-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true }) || canvas.getContext('2d');
    resize();
    // 暖機：先畫一次再清掉，讓 GPU 貼圖與合成層現在就建好，第一次刪除才不用等
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 4, 4); ctx.clearRect(0, 0, canvas.width, canvas.height);
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas || running) return;
    W = innerWidth; H = innerHeight;
    // 粒子只有 2-5px，大螢幕不需要 2x：整張 canvas 壓在 3.2MP 以內，清畫面才便宜
    dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.2e6 / Math.max(1, W * H)));
    if (dpr < 1) dpr = 1;
    const nw = Math.round(W * dpr), nh = Math.round(H * dpr);
    if (canvas.width === nw && canvas.height === nh) return;   // iOS 捲動時網址列伸縮也會發 resize，尺寸沒變就別重配
    canvas.width = nw; canvas.height = nh;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();

  // 2D 值雜訊 (便宜的 hash)，讓消散邊界不是一個正圓
  function noise(x, y) {
    const n = Math.sin(x * .031 + 1.7) * Math.cos(y * .027 - .4) + Math.sin((x + y) * .017) * .5;
    return n / 1.5;   // -1 ~ 1
  }
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // 顏色採樣：把資料夾切成幾塊矩形，依主題給顏色 (不截圖)
  function palette() {
    const L = isLight();
    return [
      { rgb: L ? [255, 255, 255] : [230, 232, 248], a: .72 },   // 0 玻璃
      { rgb: [200, 186, 253], a: .82 },                          // 1 薰衣草紫
      { rgb: [168, 85, 247], a: .9 },                            // 2 紫
      { rgb: [232, 92, 220], a: .88 },                           // 3 洋紅
      { rgb: L ? [52, 54, 76] : [246, 246, 250], a: .9 },        // 4 文字
      { rgb: L ? [255, 255, 255] : [40, 40, 58], a: .86 },       // 5 輸入框
      { rgb: [252, 252, 255], a: .92 }                           // 6 紙
    ];
  }
  function sampler(root) {
    const R = (el, kind) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom, kind } : null; };
    const list = [];
    const sheet = root.classList.contains('is-open') ? root.querySelector('.fd-sheet') : null;
    if (sheet) {
      for (const el of sheet.querySelectorAll('input[type="text"],textarea')) list.push(R(el, 'input'));
      for (const el of sheet.querySelectorAll('.sf-save-action-btn')) list.push(R(el, 'accent'));
      for (const el of sheet.querySelectorAll('.sf-card-badge-relative,.sf-icon-btn')) list.push(R(el, 'lav'));
      for (const el of sheet.querySelectorAll('.sf-title-text,label')) list.push(R(el, 'text'));
      list.push(R(sheet, 'glass'));
    }
    for (const el of root.querySelectorAll('.fd-name,.fd-class')) list.push(R(el, 'text'));
    for (const el of root.querySelectorAll('.fd-tag,.fd-tab')) list.push(R(el, 'lav'));
    list.push(R(root.querySelector('.fd-paper'), 'paper'));
    list.push(R(root.querySelector('.fd-front'), 'glass'));
    list.push(R(root.querySelector('.fd-back'), 'glass'));
    const rects = list.filter(Boolean);
    return (x, y, rnd) => {
      for (const q of rects) {
        if (x < q.l || x > q.r || y < q.t || y > q.b) continue;
        switch (q.kind) {
          case 'input': return rnd < .18 ? 4 : 5;
          case 'accent': return rnd < .5 ? 2 : 3;
          case 'lav': return rnd < .6 ? 1 : 2;
          case 'text': if (rnd < .5) return 4; continue;          // 文字不是整塊，一半機率落到下層
          case 'paper': return rnd < .75 ? 6 : 0;
          default: return rnd < .78 ? 0 : rnd < .93 ? 1 : 2;      // 玻璃：白為主，少數紫
        }
      }
      return -1;
    };
  }

  // 主流程：回傳 { done: Promise<boolean>, cancel(), restore() }
  function run(root, opts = {}) {
    init();
    if (running) running.cancel();
    quality = Math.min(1, quality + .15);   // 上次掉幀降過的密度慢慢還回來，不會一次卡就永遠稀
    const layers = Array.from(root.children).filter(el => !el.classList.contains('fd-spine'));
    const spines = Array.from(root.querySelectorAll('.fd-spine'));
    const rr = root.getBoundingClientRect();
    const box = layers.reduce((b, el) => {
      if (getComputedStyle(el).visibility === 'hidden') return b;
      const r = el.getBoundingClientRect();
      if (!r.width) return b;
      return { l: Math.min(b.l, r.left), t: Math.min(b.t, r.top), r: Math.max(b.r, r.right), b: Math.max(b.b, r.bottom) };
    }, { l: rr.left, t: rr.top, r: rr.right, b: rr.bottom });
    const ox = opts.origin?.x ?? (box.r - 40), oy = opts.origin?.y ?? (box.t + 40);
    // 粒子數：桌機 ~850、手機 ~400，乘上這台裝置學到的密度；格距由目標數反推 (不設上限，否則格子會超過池子、遠端沒粒子)
    const target = Math.round((innerWidth < 640 ? 400 : 850) * quality);
    const area = (box.r - box.l) * (box.b - box.t);
    const step = Math.max(3, Math.sqrt(area / Math.min(target, MAX)));
    const sample = sampler(root);
    // 依離垃圾桶的距離排序，邊界掃到哪就放到哪
    const cells = [];
    let rnd = 0.137;
    const rand = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
    for (let y = box.t + step / 2; y < box.b; y += step) {
      for (let x = box.l + step / 2; x < box.r; x += step) {
        const p = sample(x + (rand() - .5) * step, y + (rand() - .5) * step, rand());
        if (p < 0) continue;
        const dx = x - ox, dy = y - oy;
        cells.push({ x, y, p, d: Math.hypot(dx, dy) + noise(x, y) * 22 + (rand() - .5) * step * 1.5 });
      }
    }
    cells.sort((a, b) => a.d - b.d);
    const n = Math.min(MAX, cells.length);
    for (let i = 0; i < n; i++) {
      const cc = cells[i];
      px[i] = cc.x; py[i] = cc.y; dist[i] = cc.d; pal[i] = cc.p; age[i] = -1;
      size[i] = clamp(step * (.42 + rand() * .5), 2, 5);
      life[i] = 170 + rand() * 130;
      seed[i] = rand() * 6.283;
      glow[i] = rand() < .1 ? 1 : 0;
      const ux = cc.x - ox, uy = cc.y - oy, ul = Math.hypot(ux, uy) || 1;
      // 往右上飄 + 一點點從垃圾桶位置往外推 + 隨機
      vx[i] = 55 + rand() * 95 + ux / ul * 26 + (rand() - .5) * 60;
      vy[i] = -(18 + rand() * 62) + uy / ul * 26 + (rand() - .5) * 50;
    }
    let corner = 0;
    for (const [cx, cy] of [[box.l, box.t], [box.r, box.t], [box.l, box.b], [box.r, box.b]]) corner = Math.max(corner, Math.hypot(cx - ox, cy - oy));
    const Rmax = corner + 40;
    const colors = palette();
    const strs = colors.map(c => `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})`);
    // 每一層遮罩的本地座標換算 (層可能被抽出來放大)
    const masks = layers.map(el => {
      const r = el.getBoundingClientRect();
      const k = r.width && el.offsetWidth ? r.width / el.offsetWidth : 1;
      return { el, k, lx: (ox - r.left) / k, ly: (oy - r.top) / k };
    });
    const WIPE_T0 = 70, WIPE_T1 = 290;
    let emit = 0, alive = 0, frame = 0, t0 = 0, lastNow = 0, slow = 0, stride = 1, finished = false, cancelled = false;
    let dl = 1e9, dt_ = 1e9, dr = -1e9, db = -1e9;   // 上一幀畫過的範圍 (只清這塊)
    let hidden = false;                                // 各層已經整個藏起來 (之後不用再寫遮罩)
    let resolveDone;
    const done = new Promise(r => resolveDone = r);

    root.classList.add('fd-dissolving');
    canvas.classList.add('is-running');
    function setMask(m, R) {
      const v = R <= 0 ? 'none' : `radial-gradient(circle at ${m.lx.toFixed(1)}px ${m.ly.toFixed(1)}px, transparent ${Math.max(0, (R - 10) / m.k).toFixed(1)}px, #000 ${((R + 12) / m.k).toFixed(1)}px)`;
      m.el.style.webkitMaskImage = v; m.el.style.maskImage = v;
    }
    function restore() {
      for (const m of masks) { m.el.style.webkitMaskImage = ''; m.el.style.maskImage = ''; m.el.style.visibility = ''; }
      for (const s of spines) s.style.visibility = '';
      root.classList.remove('fd-dissolving');
    }
    function finish(ok) {
      if (finished) return;
      finished = true; running = null;
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.remove('is-running');
      if (!ok) restore();
      resolveDone(ok);
    }
    function tick(now) {
      frame = 0;
      if (cancelled) return;
      if (!t0) { t0 = now; lastNow = now; }
      const t = now - t0, dt = Math.min(48, now - lastNow); lastNow = now;
      // 掉幀就降密度 (之後的粒子每 stride 顆略過一顆)，這一場與下一場都受益
      if (dt > 21) { if (++slow >= 2) { quality = Math.max(.45, quality * .72); stride = quality < .6 ? 2 : quality < .85 ? 3 : 1; slow = 0; } } else slow = 0;
      // 消散邊界
      const R = t < WIPE_T0 ? 0 : Rmax * easeInOut(clamp((t - WIPE_T0) / (WIPE_T1 - WIPE_T0), 0, 1));
      while (emit < n && dist[emit] <= R) { age[emit] = 0; emit++; }
      // 慢的裝置一幀可能直接跳過整段掃描，所以「還沒藏起來之前」每幀都寫遮罩，藏起來後才停
      if (t >= WIPE_T0 && !hidden) for (const m of masks) setMask(m, R);
      if (R > Rmax * .45) for (const s of spines) s.style.visibility = 'hidden';
      if (t >= WIPE_T1 + 30 && !hidden) { hidden = true; for (const m of masks) m.el.style.visibility = 'hidden'; }
      // 推進粒子
      const ds = dt / 1000, drag = Math.exp(-3.4 * ds);
      alive = 0;
      for (let i = 0; i < emit; i++) {
        if (age[i] < 0) continue;
        age[i] += dt;
        if (age[i] >= life[i]) { age[i] = -2; continue; }
        alive++;
        vx[i] = vx[i] * drag + Math.sin(age[i] * .021 + seed[i]) * 90 * ds;
        vy[i] = vy[i] * drag - 30 * ds;
        px[i] += vx[i] * ds; py[i] += vy[i] * ds;
      }
      // 畫：只清上一幀畫過的範圍，再依色盤分組畫方塊 (fillStyle 只切換 7 次)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (dr > dl) ctx.clearRect(dl - 8, dt_ - 8, dr - dl + 16, db - dt_ + 16);
      dl = 1e9; dt_ = 1e9; dr = -1e9; db = -1e9;
      for (let p = 0; p < colors.length; p++) {
        ctx.fillStyle = strs[p];
        const base = colors[p].a;
        for (let i = 0; i < emit; i++) {
          if (pal[i] !== p || age[i] < 0 || (stride > 1 && i % stride === 0)) continue;
          const u = age[i] / life[i], a = Math.pow(1 - u, 1.3) * base;
          const s = size[i] * (1 - .6 * u);
          if (px[i] < dl) dl = px[i]; if (px[i] > dr) dr = px[i]; if (py[i] < dt_) dt_ = py[i]; if (py[i] > db) db = py[i];
          if (glow[i]) { ctx.globalAlpha = a * .22; ctx.fillRect(px[i] - s * 1.3, py[i] - s * 1.3, s * 2.6, s * 2.6); }
          ctx.globalAlpha = a;
          ctx.fillRect(px[i] - s / 2, py[i] - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      if (t < WIPE_T1 || alive > 0) { if (t < 1200) { frame = requestAnimationFrame(tick); return; } }
      finish(true);
    }
    frame = requestAnimationFrame(tick);
    running = {
      done, restore,
      cancel() { if (finished) return; cancelled = true; finish(false); }
    };
    return running;
  }

  window.sfDissolve = { init, run, get quality() { return quality; }, get running() { return !!running; } };

  // ── 垃圾桶：清空這一床的資料 ──────────────────────────────────────────
  // 床位本身不會從房間裡消失，所以粒子散掉之後，同一本資料夾會以「空床」的樣子重新長回來；
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
      // 名單少於 13 人時同一床會出現在好幾本上，每一本都要清，否則另一本被回收時會把草稿還原
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
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { haptic('medium'); resetFields(); showToast('床位已清空，按「儲存修改」同步', 'info'); return; }
      haptic('medium');
      const r = btn?.getBoundingClientRect();
      const fr = folder.getBoundingClientRect();
      const origin = r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: fr.right - 40, y: fr.top + 40 };
      handle = run(folder, { origin });
      const ok = await handle.done;
      if (!ok || cancelled) return;
      if (_sfRenderMap.get(folder) !== owner) return;   // 消散途中重新搜尋、這本已換人：不清、不長回來
      resetFields();
      haptic('light');
      showToast('床位已清空，按「儲存修改」同步', 'info');
      handle.restore(); handle = null;
      window.sfCarousel?.closeSheet(true);     // 先把紙收回去，長回來、抽出之後會再自動打開
      await window.sfCarousel?.materialize(folder);
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
