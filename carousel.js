// Finite spatial archive. Ellipse positions and analytic tangent orientations share one rail.
// A RAF state machine drives entrance, extraction, dragging, snap and the independent inspector.
// The historical setup2DCarouselInteraction name remains as the app integration entry point.
function setup2DCarouselInteraction() {
  const area = document.getElementById('sf-card-area'), track = document.getElementById('sf-card-track');
  const page = document.getElementById('page-student-files');
  if (_carouselAttached || !area || !track) return;
  _carouselAttached = true;

  // ── 弧形軌道：依畫面寬度算，resize / 進場時重算 ────────────────────────────
  const PERSP = 1500, ORIGIN_X = .34, ORIGIN_Y = .40;   // 跟 folder.css 的 perspective / perspective-origin 一致
  const RAD = Math.PI / 180;
  const cfg = {};
  // 軌道是一段橢圓弧：φ 是弧上的角度，φ=0 是最靠近鏡頭的頂點，目前這本停在 φA (<0，頂點左邊)，
  //   x(φ) = cx + RX·sin φ,   z(φ) = zNear − RZ·(1 − cos φ)
  // Tangent (RX cos φ, -RZ sin φ), yaw = atan2(dx,dz), continuous through the apex.
  const phiOf = d => cfg.phiA + d * cfg.dPhi;
  const R0 = {}, R1 = {};
  function rail(d, out) {
    const phi = phiOf(d) * RAD, s = Math.sin(phi), co = Math.cos(phi);
    out.x = cfg.cx + cfg.RX * s;
    out.z = cfg.zNear - cfg.RZ * (1 - co);
    let yaw = Math.atan2(cfg.RX * co, -cfg.RZ * s) / RAD;
    // Keep the tangent unwrapped through 90°; transparent back faces remain visible.
    out.yaw = yaw;
    return out;
  }
  // 世界座標 → 畫面 px (元素本身排在舞台正中，所以要加 W/2)
  function project(x, z) {
    const W = area.clientWidth || innerWidth, ox = W * ORIGIN_X;
    return ox + (W / 2 + x - ox) * (PERSP / (PERSP - z));
  }
  function measure() {
    const W = area.clientWidth || innerWidth;
    const mobile = W < 640, tablet = W < 1024;
    cfg.mobile = mobile;
    cfg.fw = mobile ? Math.max(220, Math.min(W - 160, 300)) : tablet ? 360 : 400;   // 橫式：寬 : 高 ≈ 1.55
    cfg.fh = Math.round(cfg.fw / 1.55);
    cfg.RX = mobile ? 200 : tablet ? 520 : 700;      // 弧的橫向半徑
    cfg.RZ = mobile ? 300 : tablet ? 400 : 520;      // 弧的縱深半徑
    cfg.zNear = 40;                                  // 頂點離鏡頭多近，其餘都在它後面
    cfg.phiA = mobile ? -40 : -42;                   // 目前這本停在弧的哪個角度
    cfg.dPhi = mobile ? 12 : tablet ? 9 : 8;         // 每本差幾度 (越大間隙越明顯)
    cfg.activeX = mobile ? .46 : .42;                // 抽出那本落在畫面寬度的幾成
    cfg.pull = mobile ? 280 : tablet ? 360 : 430;    // 抽出：離開弧往鏡頭多少
    cfg.side = mobile ? 14 : 30;                     // 抽出：再往左偏一點 (離開軌道)
    cfg.lift = mobile ? 14 : 20;                     // 抽出：上移
    cfg.activeYaw = 18;                              // 抽出後的朝向 (軌道給的側視角只校正到這裡，不轉正)
    cfg.part = .12;                                  // 鄰居沿弧讓開幾本
    cfg.farVisible = mobile ? 8.4 : tablet ? 9 : 11.5;   // 深處看得到幾本
    cfg.fade = mobile ? 1.8 : 3.5;                       // 尾端幾本內淡到 0
    cfg.nearVisible = mobile ? 2.4 : 3.2;
    // 依深度切兩段模糊：門檻取弧上「真正到得了」的深度範圍 (近端 / 遠端誰更深就用誰) 的 45% 與 75%
    cfg.cx = 0;
    const zEnd = Math.min(rail(cfg.farVisible, R0).z, rail(-cfg.nearVisible, R1).z), zTop = cfg.zNear;
    cfg.blur1 = zTop + (zEnd - zTop) * .45; cfg.blur2 = zTop + (zEnd - zTop) * .75;
    area.style.setProperty('--fd-w', cfg.fw + 'px');
    area.style.setProperty('--fd-h', cfg.fh + 'px');
    // 解出弧的位置 cx，讓抽出來的那本 (含 pull、side) 剛好落在 activeX
    cfg.cx = 0;
    const a = rail(0, R0), ox = W * ORIGIN_X, P = PERSP / (PERSP - a.z - cfg.pull);
    cfg.cx = (cfg.activeX * W - ox) / P - (W / 2 + a.x - cfg.side - ox);
    // 拖一個虛擬索引 = 中央那本在畫面上實際走幾 px (手指 1:1 帶著它走；太小會太敏感，給個下限)
    const b = rail(1, R1);
    _cardWidth = Math.max(mobile ? 54 : 60, Math.abs(project(b.x, b.z) - cfg.activeX * W));
  }
  measure();

  // ── 狀態 ──────────────────────────────────────────────────────────────
  let state = 'idle';                 // idle | dragging | snapping | extracting | entering | locked
  let c = 0;                          // 目前中心 (虛擬索引，浮點)
  let frame = 0;
  let lastIndex = 0, suppressClick = false;
  const ext = { mode: 'none', t0: 0, from: 0, base: 0, basePart: 0, ex: 1, part: 1, pulse: 1, done: null };   // 抽出時間軸
  let ent = null;                     // 進場：{ t0, only: entry|null }
  const sheet = { amt: 0, target: 0, t0: 0, from: 0, shift: 0, timer: 0, entry: null, vIndex: null };   // 詳細資料紙
  const snap = { active: false, target: 0, delta: 0, speed: 0, t0: 0 };
  let active = false, dragging = false, touchId = null, mouseActive = false;
  let startX = 0, startY = 0, startC = 0, lastX = 0, lastTime = 0, velocity = 0;
  const wheel = { acc: 0, deadline: 0, lastStep: 0 };
  const count = () => _sfResults.length;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function moving(on) { page.classList.toggle('sf-moving', on); area.classList.toggle('is-dragging', on); }
  function requestFrame() { if (!frame) frame = requestAnimationFrame(tick); }
  function stopFrame() { cancelAnimationFrame(frame); frame = 0; }
  // 打斷所有進行中的動畫 (拖曳開始、點鄰居、滾輪、方向鍵)
  function interrupt() { stopFrame(); snap.active = false; ent = null; clearTimeout(sheet.timer); wheel.deadline = 0; }

  // ── 曲線 ───────────────────────────────────────────────────────────────
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
  const outQuint = v => 1 - Math.pow(1 - clamp01(v), 5);
  const outCubic = v => 1 - Math.pow(1 - clamp01(v), 3);
  // 抽出用的欠阻尼彈簧 (ζ=.62, ω=13)：0.3 秒衝過頭 8%，0.62 秒收斂
  function springEx(t) {
    if (t <= 0) return 0;
    const z = .62, w = 13, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  }

  // ── 每本的姿態：離中心 d 本 (可為負、浮點) ───────────────────────────────
  const P0 = {}, G0 = {};
  function pose(d, out) {
    const ad = Math.abs(d), s = d < 0 ? -1 : 1;
    // 抽出只影響中央這本 (ad<.5)，用鐘形權重讓拖曳時連續過渡
    const bump = ad < .5 ? 1 - smooth(ad / .5) : 0;
    const k = ext.ex * bump;
    const room = s * cfg.part * ext.part * smooth(Math.min(ad, 1));   // 鄰居沿弧讓開
    const r = rail(d + room, R0);
    // 抽出：離開弧往鏡頭、微微上移、往左一點；朝向從軌道給的側視角校正到 activeYaw
    out.x = r.x - cfg.side * k;
    out.y = -cfg.lift * k;
    out.z = r.z + cfg.pull * k;
    const turn = smooth(clamp01((k - .12) / .88));
    out.rot = r.yaw + (cfg.activeYaw - r.yaw) * turn;
    out.scale = 1 + (ext.pulse - 1) * bump;         // 大小交給透視；這裡只有抽出時 ±3% 的脈衝
    // 兩端都淡到 0 才離開視窗，回收換人時才不會在畫面上「跳出來」
    const near = d < -1 ? Math.max(0, 1 + (d + 1) / (cfg.nearVisible - 1)) : 1;
    const far = Math.min(1, (cfg.farVisible - d) / cfg.fade);
    out.alpha = Math.max(0, Math.min(near, far));
    out.near = d > -1.6 && d < 2.6;                 // 只有這些給 will-change
    out.blur = out.z < cfg.blur2 ? 2 : out.z < cfg.blur1 ? 1 : 0;
    out.lefty = r.yaw < 90;                          // yaw>0 (頂點左邊) 左緣離鏡頭近、露在外面 → 側標與標籤放左邊；yaw<0 放右邊
    return out;
  }
  // 進場前「整疊還沒攤開」的姿態：全部擠在目前這本附近、更深、透明
  function gathered(d, out) {
    const r = rail(d * .35, R0), dst = rail(d, R1);
    out.x = r.x; out.y = 6; out.z = r.z - 140; out.rot = dst.yaw + (dst.yaw < 0 ? -8 : 8); out.scale = .96; out.alpha = 0;
    return out;
  }

  // 只有值真的變了才寫 style，拖曳時省下大量樣式計算
  function put(el, transform, alpha, near, blur, lefty) {
    if (el._tf !== transform) { el.style.transform = transform; el._tf = transform; }
    if (el._op !== alpha) { el.style.setProperty('--fd-alpha', alpha); el._op = alpha; }
    if (el._nr !== near) { el.classList.toggle('fd-near', near); el._nr = near; }
    if (el._bl !== blur) { el.classList.toggle('fd-blur1', blur === 1); el.classList.toggle('fd-blur2', blur === 2); el._bl = blur; }
    if (el._lf !== lefty) { el.classList.toggle('fd-lefty', lefty); el._lf = lefty; }
  }

  function paint() {
    const n = count();
    _currentX = -c * _cardWidth;
    sfSyncWindow(c);
    const now = performance.now();
    for (const entry of _sfPool) {
      const el = entry.el, v = entry.vIndex;
      if (v === null || !n || !entry.student) { el.classList.add('sf-far'); continue; }
      const d = v - c, ad = Math.abs(d);
      const p = pose(d, P0);
      const visible = p.alpha > .012;
      el.classList.toggle('sf-far', !visible);
      if (!visible) { el._tf = null; continue; }
      const isActive = v === _sfActiveIndex;
      el.classList.toggle('active', isActive);
      el.classList.toggle('fd-back-facing', p.rot > 90);
      // 進場：從「整疊還沒攤開」的姿態依序沿軌道展開 (每本 380ms，離中心越遠越晚 30ms)
      if (ent && (!ent.only || ent.only === entry)) {
        const delay = ent.only ? 0 : .03 * Math.min(ad, 7);
        const e = outQuint(((now - ent.t0) / 1000 - delay) / .38);
        if (e < 1) {
          const g = gathered(d, G0);
          p.x = g.x + (p.x - g.x) * e; p.y = g.y + (p.y - g.y) * e; p.z = g.z + (p.z - g.z) * e;
          p.rot = g.rot + (p.rot - g.rot) * e; p.scale = g.scale + (p.scale - g.scale) * e; p.alpha *= e;
        }
      }
      // 開紙時這本往下讓位
      const y = p.y - (isActive ? (cfg.mobile ? 108 : 12) * sheet.amt : 0);
      p.z += isActive ? 22 * sheet.amt : 0;   // 回收換人就不套
      put(el,
        `translate3d(${p.x.toFixed(1)}px,${y.toFixed(1)}px,${p.z.toFixed(1)}px) rotateY(${p.rot.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`,
        p.alpha.toFixed(3), p.near, p.blur, p.lefty);
      // 資料紙要正對使用者，所以把這本的 yaw 反轉回去
      if (isActive) {
        const cy = (-p.rot).toFixed(2) + 'deg';
        if (el._cy !== cy) { el.style.setProperty('--fd-counter-yaw', cy); el._cy = cy; }
      }
    }
    const index = Math.round(c);
    if (index !== lastIndex) { haptic('light'); lastIndex = index; }
  }
  window._updateContinuousScale = () => paint();

  // ── rAF 主迴圈：所有子動畫都在這裡推進 ─────────────────────────────────
  function tick(now) {
    frame = 0;
    let more = false;
    if (wheel.deadline) {
      if (now < wheel.deadline) more = true;
      else {
        wheel.deadline = 0;
        const base = Math.round(c);
        settle(Math.max(base-2, Math.min(base+2, Math.round(c+wheel.acc/_cardWidth*.3))), -wheel.acc*8);
      }
    }
    // 彈簧吸附 (臨界阻尼 + 初速度，60/120Hz 都一樣)。公式以 px 計 (_currentX)，換算回索引
    if (snap.active) {
      const t = (now - snap.t0) / 1000, omega = 19;
      const offsetPx = (snap.delta + (snap.speed + omega * snap.delta) * t) * Math.exp(-omega * t);
      c = snap.target - offsetPx / _cardWidth;
      if (t < .8 && (Math.abs(offsetPx) > .15 || t < .1)) more = true;
      else { c = snap.target; snap.active = false; moving(false); if (state === 'snapping') startExtraction(now); }
    }
    // 抽出 (in) / 塞回 (out)
    if (ext.mode === 'in') {
      const t = (now - ext.t0) / 1000, b = ext.base, bp = ext.basePart;
      ext.part = bp + (1 - bp) * outCubic(t / .16);
      ext.ex = b + (1 - b) * springEx(t - .06);
      ext.pulse = 1 + .03 * (1 - b) * Math.sin(Math.PI * clamp01(t / .55));
      if (t < .68) more = true;
      else {
        ext.mode = 'none'; ext.ex = ext.part = ext.pulse = 1;
        if (state === 'extracting') { state = 'idle'; prepareSelection(); }
        const cb = ext.done; ext.done = null; if (cb) cb();
      }
    } else if (ext.mode === 'reflow') {
      const t = clamp01((now-ext.t0)/300); ext.part=1-smooth(t);
      if(t<1) more=true; else ext.mode='none';
    } else if (ext.mode === 'out') {
      const t = clamp01((now - ext.t0) / 160);
      const e = 1 - outCubic(t);
      ext.ex = ext.from * e; ext.part = ext.from * e; ext.pulse = 1;
      if (t < 1) more = true; else ext.mode = 'none';
    }
    // 進場：中央那本一到位 (0.36s) 就開始抽，其餘的繼續展開
    if (ent) {
      const t = (now - ent.t0) / 1000;
      if (state === 'entering' && t >= .36) startExtraction(now);
      if (t < (ent.only ? .38 : .56)) more = true;
      else ent = null;
    }
    if (state === 'opening' && now - sheet.t0 >= 150) {
      const editor = sfInspector(); editor.hidden = false; editor.classList.add('is-open');
      state = 'editing';
      editor.querySelector('input')?.focus({preventScroll:true});
    }
    // 開紙讓位
    if (sheet.amt !== sheet.target) {
      const t = clamp01((now - sheet.t0) / (sheet.target ? 480 : 220));
      sheet.amt = sheet.from + (sheet.target - sheet.from) * outQuint(t);
      if (t < 1) more = true; else { sheet.amt = sheet.target; if (!sheet.target) { sheet.entry = null; sheet.vIndex = null; } }
    }
    paint();
    if (more) requestFrame();
  }

  // ── 抽出動畫：鄰居讓開 (0-160ms) → 抽出 (60ms 起，彈簧衝過頭) → 收斂 (~680ms) ──
  function startExtraction(now) {
    if (reduced()) { ext.mode = 'none'; ext.ex = ext.part = ext.pulse = 1; state = 'idle'; paint(); prepareSelection(); const cb = ext.done; ext.done = null; if (cb) cb(); return; }
    state = 'extracting';
    ext.mode = 'in'; ext.t0 = now || performance.now();
    ext.base = clamp01(ext.ex); ext.basePart = clamp01(ext.part);   // 從目前的位置接著抽，不跳回 0
    ext.ex = ext.base; ext.part = ext.basePart; ext.pulse = 1;
    haptic('medium');
    requestFrame();
  }
  function pushBack() {
    // 手一碰就把抽出的那本塞回整排 (160ms)，而不是瞬間跳回
    const from = clamp01(Math.max(ext.ex, ext.part));
    if (from === 0) { ext.mode = 'none'; return; }
    ext.from = from; ext.mode = 'out'; ext.t0 = performance.now();
    requestFrame();
  }

  // ── 詳細資料紙 (fd-sheet)：從資料夾頂端抽出來，資料夾往下讓位 ────────────
  function openSheet() {
    const entry = sfActiveEntry();
    if (!entry || state !== 'idle' || !entry.student) return;
    if (!sfInspector().hidden) return;
    sfMountInspector(entry);
    sheet.entry = entry; sheet.vIndex = entry.vIndex;
    sheet.from = sheet.amt; sheet.target = 1; sheet.t0 = performance.now();
    if (reduced()) {
      sheet.amt = 1; state = 'editing';
      sfInspector().hidden = false; sfInspector().classList.add('is-open');
      sfInspector().querySelector('input')?.focus({preventScroll:true});
      paint(); return;
    }
    state = 'opening';
    requestFrame();
  }
  function closeSheet(instant) {
    sfStashInspector();
    const editor = sfInspector();
    if (editor) { editor.hidden = true; editor.classList.remove('is-open'); }
    if (state === 'opening' || state === 'editing') state = 'idle';
    if (instant || reduced()) { sheet.amt = sheet.target = 0; sheet.entry = null; paint(); return; }
    sheet.from = sheet.amt; sheet.target = 0; sheet.t0 = performance.now();
    requestFrame();
    if (editor?.contains(document.activeElement)) area.focus({preventScroll:true});
  }
  function prepareSelection() {
    // Browsing never opens the editor. Warm the selected folder's dust texture while idle.
    window.sfDissolve?.prepare(sfActiveEntry()?.el);
  }
  function toggleSheet() { if (!sfInspector().hidden) closeSheet(false); else openSheet(); }

  // ── 吸附到某一本 ─────────────────────────────────────────────────────────
  function settle(index, initialVelocity = 0) {
    index = Math.max(0, Math.min(count()-1, index));
    clearTimeout(sheet.timer);
    _sfActiveIndex = index;
    snap.target = index;
    snap.delta = (index - c) * _cardWidth;               // 以 px 計的距離 (_currentX 座標系)
    if (Math.abs(snap.delta) < .5 && !initialVelocity) {
      c = index; snap.active = false; moving(false);
      if (ext.ex >= 1 && ext.mode === 'none') { state = 'idle'; paint(); prepareSelection(); }
      else startExtraction();
      return;
    }
    state = 'snapping';
    snap.speed = Math.max(-2600, Math.min(2600, initialVelocity));
    snap.t0 = performance.now(); snap.active = true;
    moving(true);
    requestFrame();
  }
  function stopAll() {
    interrupt(); ext.mode = 'none';
    moving(false);
    // 抽出被打斷 (切頁、背景) 也要把等待中的 materialize() 叫醒，否則刪除流程永遠鎖住
    const cb = ext.done; ext.done = null; if (cb) cb();
  }
  // 使用者主動翻到別本 (點鄰居、滾輪、方向鍵) 共用的前置
  function jumpTo(index, vel) { interrupt(); closeSheet(false); pushBack(); settle(index, vel); }

  // ── 手勢狀態機 (觸控與滑鼠共用) ─────────────────────────────────────────
  function down(x, y, target) {
    if (active || state === 'locked' || !count() || document.getElementById('sf-scene').classList.contains('is-searching')) return false;
    // 已經聚焦的欄位保留原生游標選取；沒聚焦的欄位可以直接起手滑動
    if (target === document.activeElement && target.matches('input,textarea')) return false;
    if (target.closest('button')) return false;
    active = true; dragging = false; suppressClick = false;
    startX = lastX = x; startY = y; lastTime = performance.now(); velocity = 0;
    return true;
  }
  function move(x, y) {
    if (!active) return false;
    const dx = x - startX, dy = y - startY, now = performance.now();
    if (!dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return false;
      if (Math.abs(dy) > Math.abs(dx)) { active = false; return false; }   // 直向：交給頁面捲動，動畫照常跑
      // 真的開始橫向拖曳才打斷動畫，並以此刻的位置為基準 (彈簧可能還在動)
      dragging = true; suppressClick = true; state = 'dragging';
      interrupt(); moving(true); closeSheet(false); pushBack();
      startX = x; startC = c; lastX = x; lastTime = now;
      if (document.activeElement?.closest('.sf-folder')) document.activeElement.blur();
      return true;
    }
    const dt = now - lastTime;
    if (dt > 0) velocity = .65 * ((x - lastX) / dt * 1000) + .35 * velocity;
    lastX = x; lastTime = now;
    c = Math.max(-.25, Math.min(count()-.75, startC - dx / _cardWidth));          // 無限循環：兩端都不設限
    requestFrame();
    return true;
  }
  function up(cancelled) {
    if (!active) return;
    active = false;
    if (!dragging) { if (state === 'idle') prepareSelection(); return; }
    dragging = false;
    if (cancelled || performance.now() - lastTime > 100) velocity = 0;
    // velocity 是手指的 px/s (往右為正)；往右拖 = 索引變小
    const projected = c - velocity * .16 / _cardWidth;
    const current = Math.round(c);          // 以放手時的位置為準：拖超過 3 本也不會猛彈回去
    let next = Math.round(projected);
    next = Math.max(current - 3, Math.min(current + 3, next));
    settle(next, velocity);
    // The next pointer/touch down clears click suppression.
  }
  // ── 觸控 (iPhone / Android) ─────────────────────────────────────────────
  const findTouch = e => Array.from(e.changedTouches).find(t => t.identifier === touchId);
  area.addEventListener('touchstart', e => {
    // 只看落在資料夾區裡的手指；別處的手指 (握持、捏合) 不該擋掉滑動
    if (touchId !== null || mouseActive || Array.from(e.touches).filter(t => area.contains(t.target)).length !== 1) return;
    const t = e.changedTouches[0];
    if (down(t.clientX, t.clientY, e.target)) touchId = t.identifier;
  }, { passive: true });
  area.addEventListener('touchmove', e => {
    const t = findTouch(e); if (!t) return;
    move(t.clientX, t.clientY);
    // 只在「已判定為水平拖曳」後才擋住預設行為：WebKit 會記住第一個被 preventDefault 的 touchmove
    if (dragging && e.cancelable) e.preventDefault();
    if (!active) touchId = null;
  }, { passive: false });
  const touchEnd = e => { if (!findTouch(e)) return; touchId = null; up(e.type === 'touchcancel'); };
  area.addEventListener('touchend', touchEnd);
  area.addEventListener('touchcancel', touchEnd);
  // ── 滑鼠 (桌面) ─────────────────────────────────────────────────────────
  area.addEventListener('mousedown', e => {
    if (touchId !== null || e.button !== 0) return;
    if (down(e.clientX, e.clientY, e.target)) mouseActive = true;
  });
  window.addEventListener('mousemove', e => {
    if (!mouseActive) return;
    if (e.buttons === 0) { mouseEnd(); return; }   // 按鍵在視窗外放開，沒收到 mouseup
    if (move(e.clientX, e.clientY)) e.preventDefault();
    if (!active) mouseActive = false;
  });
  const mouseEnd = () => { if (!mouseActive) return; mouseActive = false; up(false); };
  window.addEventListener('mouseup', mouseEnd);
  window.addEventListener('blur', () => { mouseEnd(); if (touchId !== null) { touchId = null; up(true); } });
  area.addEventListener('dragstart', e => e.preventDefault());
  // ── 觸控板橫向捲動 / 滾輪 ───────────────────────────────────────────────
  const pageScrollable = () => (document.scrollingElement || document.documentElement).scrollHeight > innerHeight + 4;
  area.addEventListener('wheel', e => {
    if (state === 'locked' || active || !count()) return;
    const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
    if (ax > ay && ax > 1) {
      // 觸控板橫向：連續跟手，停 120ms 就吸附
      e.preventDefault();
      if (state !== 'dragging') { interrupt(); state = 'dragging'; moving(true); closeSheet(false); pushBack(); wheel.acc = 0; }
      const px = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      c = Math.max(0, Math.min(count()-1, c + px / _cardWidth)); wheel.acc = .6 * px + .4 * wheel.acc;
      requestFrame();
      wheel.deadline = performance.now() + 120;
    } else if (ay > ax && (e.shiftKey || !pageScrollable())) {
      // 滑鼠滾輪：一格一本 (頁面本身不需要捲動時才接管，否則讓頁面捲)
      e.preventDefault();
      const now = performance.now();
      if (now - wheel.lastStep < 220 || ay < 4) return;
      wheel.lastStep = now;
      jumpTo(Math.round(c) + (e.deltaY > 0 ? 1 : -1));
    }
  }, { passive: false });
  // ── 點擊：點鄰居 = 翻到那本；點中央那本 = 開/收詳細資料 ─────────────────
  area.addEventListener('click', e => {
    if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (state === 'locked' || !count()) return;
    const folder = e.target.closest('.sf-folder');
    if (!folder || e.target.closest('.fd-sheet')) return;
    const entry = _sfPool.find(x => x.el === folder);
    if (!entry || entry.vIndex === null) return;
    if (entry.vIndex !== _sfActiveIndex) jumpTo(entry.vIndex);
    else if (state === 'idle' || state === 'editing') toggleSheet();
  }, true);
  sfInspector().addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeSheet(false); } });
  area.tabIndex = 0; area.setAttribute('aria-label', '住宿生資料夾，可左右滑動、使用方向鍵，Enter 展開');
  area.addEventListener('keydown', e => {
    if (state === 'locked' || e.target.closest('input,textarea,select,button,a')) return;   // 紙上的按鈕要吃得到 Enter/Space
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); jumpTo(_sfActiveIndex + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (state === 'idle' || state === 'editing') toggleSheet(); }
    else if (e.key === 'Escape') closeSheet(false);
  });
  window.addEventListener('resize', () => {
    measure();
    for (const e of _sfPool) e.el._tf = null;
    if (state === 'idle') prepareSelection();
    if (currentPage === 'student-files') paint();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) window._sfStopMotion(); });

  // ── 對外 API (app.js / dissolve.js / 測試) ────────────────────────────────
  function resetInput() { active = false; dragging = false; touchId = null; mouseActive = false; suppressClick = false; }
  window.sfCarousel = {
    // 進場：全部先擠在中央，依序展開，最後中央那本抽出 (總長約 1 秒)
    enter(index = 0) {
      stopAll(); resetInput(); measure();
      _sfActiveIndex = index; c = index; lastIndex = index;
      closeSheet(true);
      for (const e of _sfPool) e.el._tf = null;
      if (reduced()) { ext.ex = ext.part = ext.pulse = 1; state = 'idle'; paint(); prepareSelection(); return; }
      ext.mode = 'none'; ext.ex = ext.part = 0; ext.pulse = 1;
      ent = { t0: performance.now(), only: null };
      state = 'entering';
      paint(); ent.t0 = performance.now();   // 第一次 paint 會重建 13 本的內容，時間軸從那之後才開始算
      requestFrame();
    },
    // 刪除完、床位清空後，同一本資料夾重新「長回來」：短進場 + 小抽出。回傳抽出完成的 Promise
    materialize(el) {   // 鄰居維持讓開的狀態 (part 保持 1)，只有這本從 0 重新抽出
      const entry = _sfPool.find(x => x.el === el);
      state = 'idle';
      if (!entry) { paint(); return Promise.resolve(); }
      return new Promise(resolve => {
        ext.done = resolve;
        if (reduced()) { ext.ex = ext.part = ext.pulse = 1; paint(); prepareSelection(); const cb = ext.done; ext.done = null; cb(); return; }
        ext.mode = 'none'; ext.ex = 0; ext.part = 1; ext.pulse = 1;
        ent = { t0: performance.now(), only: entry };
        state = 'entering';
        paint(); ent.t0 = performance.now();
        requestFrame();
      });
    },
    // 刪除中：鎖住所有輸入 (拖曳、滾輪、點擊、鍵盤)，畫面停在目前狀態
    lock() { stopAll(); resetInput(); state = 'locked'; ext.ex = ext.part = ext.pulse = 1; sheet.amt = sheet.target; paint(); },
    unlock() { if (state === 'locked') state = 'idle'; },
    reflow() { ext.mode='reflow'; ext.t0=performance.now(); requestFrame(); },
    settle, openSheet, closeSheet, paint, measure,
    get state() { return state; },
    get center() { return c; },
    get cfg() { return cfg; }
  };
  window._sfDisable3D = () => closeSheet(false);
  window._restart3DTimer = () => { if (state === 'idle') prepareSelection(); };
  window._sfStopMotion = () => {
    stopAll(); resetInput();
    if (state !== 'locked') state = 'idle';
    ext.ex = ext.part = ext.pulse = 1; closeSheet(true);
    c = _sfActiveIndex; lastIndex = _sfActiveIndex;
    paint();
  };
  // 舊介面：從右邊快速掃進來停在 to (測試用)
  window._sfSweepTo = (_from, to) => {
    stopAll(); resetInput(); closeSheet(true); ext.ex = ext.part = ext.pulse = 1;
    const index = Math.round(-to / _cardWidth);
    c = index - 1.4;
    settle(index, -900);
  };
}
