// 住宿生檔案：透明壓克力資料夾的「空間軌道」(spatial folder rail)
// ─────────────────────────────────────────────────────────────────────────────
// 這不是輪播，是一條斜插進畫面的檔案軌道：所有資料夾同一個朝向 (yaw -24°，左右不鏡像)，
// 沿著一條往「右後方 44°」延伸的直線排列，越後面的離鏡頭越遠 —— 大小完全由透視決定
// (不用 scale)，所以最近與最遠差到 2.4 倍，一整排會明顯往深處收斂、彼此重疊。
// 目前這本從軌道上「抽離」出來：往鏡頭 +155px、微微上移、稍微離開軌道，角度只校正三分之一，
// 看起來像從一整疊檔案裡被拉出來查看，而不是中間那張被放大。
// 近端 (已經看過的) 在 z 上很快飽和並淡出，才不會衝到鏡頭前面擋住抽出來的那本。
// 每本的姿態都是「離中心幾本 (d)」的連續函數，拖曳時逐幀直接寫 transform，放手用阻尼彈簧
// 吸到最近一本；一個 rAF 迴圈推進全部子動畫，狀態機 idle / dragging / snapping /
// extracting / entering / locked，不用 setTimeout 疊時間軸。
// 輸入層：觸控用 Touch Events、桌面用 Mouse Events (iOS Safari 在可直向捲動的頁面做水平
// 拖曳會發 pointercancel，w3c/pointerevents#303)，另加觸控板橫向捲動、滾輪與鍵盤。
function setup2DCarouselInteraction() {
  const area = document.getElementById('sf-card-area'), track = document.getElementById('sf-card-track');
  const page = document.getElementById('page-student-files');
  if (_carouselAttached || !area || !track) return;
  _carouselAttached = true;

  // ── 軌道幾何：依畫面寬度算，resize / 進場時重算 ────────────────────────────
  const PERSP = 1500, ORIGIN_X = .34, ORIGIN_Y = .40;   // 跟 folder.css 的 perspective / perspective-origin 一致
  const RAD = Math.PI / 180;
  const cfg = {};
  // 軌道參數：遠端 (d>0) 線性往後延伸，近端 (d<0) 指數飽和 —— 否則往前會衝到鏡頭前面爆掉
  const soft = (d, n) => d >= 0 ? d : -n * (1 - Math.exp(d / n));
  const railX = d => (soft(d, cfg.nearX)) * cfg.rail * Math.cos(cfg.theta * RAD) + cfg.offset;
  const railZ = d => -(soft(d, cfg.nearZ)) * cfg.rail * Math.sin(cfg.theta * RAD);
  // 世界座標 → 畫面 px (元素本身排在舞台正中，所以要加 W/2)
  function project(x, z) {
    const W = area.clientWidth || innerWidth, ox = W * ORIGIN_X;
    return ox + (W / 2 + x - ox) * (PERSP / (PERSP - z));
  }
  function measure() {
    const W = area.clientWidth || innerWidth;
    const mobile = W < 640, tablet = W < 1024;
    cfg.mobile = mobile;
    cfg.fw = mobile ? Math.max(268, Math.min(W - 78, 400)) : tablet ? 380 : 440;   // 橫式：寬 : 高 ≈ 1.55
    cfg.fh = Math.round(cfg.fw / 1.55);
    cfg.rail = mobile ? 95 : tablet ? 150 : 200;    // 沿軌道每本的間距 (世界座標)
    // 軌道與畫面平面的夾角：手機螢幕窄，角度開大一點，同樣的橫向寬度才換得到足夠的縱深
    cfg.theta = mobile ? 52 : 44;
    cfg.nearX = 2.4;                                // 近端在 X 上還會再散開一點
    cfg.nearZ = .5;                                 // 近端在 Z 上很快飽和 (最多 ~70px，遠低於抽出的 155)
    // 抽出那本落在畫面寬度的幾成 (偏左前方)；手機螢幕窄，太靠左會被切掉，所以往中間挪
    cfg.activeX = mobile ? .42 : tablet ? .29 : .27;
    cfg.pull = mobile ? 122 : tablet ? 140 : 155;   // 從軌道抽離往鏡頭多少
    cfg.side = mobile ? 16 : 26;                    // 抽出時再往左偏一點 (離開軌道)
    cfg.lift = mobile ? 13 : 18;                    // 抽出時上移
    cfg.part = .14;                                 // 鄰居讓開 (沿軌道，單位 = 幾本)
    cfg.yaw = -24;                                  // 每一本的朝向，整排相同、左右不鏡像
    cfg.yawDrift = .34;                             // 越遠只多轉 0.34°/本 (最多 +3°)
    cfg.faceUp = .34;                               // 抽出時角度只校正三分之一 (-24° → -16°)，不轉正
    cfg.farVisible = mobile ? 7 : tablet ? 9.5 : 13.2;     // 往深處看得到幾本
    cfg.nearVisible = 2.8;                                 // 往近處看得到幾本
    area.style.setProperty('--fd-w', cfg.fw + 'px');
    area.style.setProperty('--fd-h', cfg.fh + 'px');
    // 解出軌道位移，讓抽出那本剛好落在 activeX
    const ox = W * ORIGIN_X, P = PERSP / (PERSP - cfg.pull);
    cfg.offset = 0;
    cfg.offset = (cfg.activeX * W - ox) / P - (W / 2 - ox);
    // 拖一個虛擬索引，中央那本在畫面上實際走幾 px (手指 1:1 帶著它走)
    _cardWidth = Math.max(36, Math.abs(project(railX(1), railZ(1)) - cfg.activeX * W));
  }
  measure();

  // ── 狀態 ──────────────────────────────────────────────────────────────
  let state = 'idle';                 // idle | dragging | snapping | extracting | entering | locked
  let c = 0;                          // 目前中心 (虛擬索引，浮點)
  let frame = 0;
  let lastIndex = 0, suppressClick = false;
  const ext = { mode: 'none', t0: 0, from: 0, base: 0, ex: 1, part: 1, pulse: 1, done: null };   // 抽出時間軸
  let ent = null;                     // 進場：{ t0, only: entry|null }
  const sheet = { amt: 0, target: 0, t0: 0, from: 0, shift: 0, timer: 0, entry: null, vIndex: null };   // 詳細資料紙
  const snap = { active: false, target: 0, delta: 0, speed: 0, t0: 0 };
  let active = false, dragging = false, touchId = null, mouseActive = false;
  let startX = 0, startY = 0, startC = 0, lastX = 0, lastTime = 0, velocity = 0;
  const wheel = { acc: 0, timer: 0, lastStep: 0 };
  const count = () => _sfResults.length;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function moving(on) { page.classList.toggle('sf-moving', on); area.classList.toggle('is-dragging', on); }
  function requestFrame() { if (!frame) frame = requestAnimationFrame(tick); }
  function stopFrame() { cancelAnimationFrame(frame); frame = 0; }
  // 打斷所有進行中的動畫 (拖曳開始、點鄰居、滾輪、方向鍵)
  function interrupt() { stopFrame(); snap.active = false; ent = null; clearTimeout(sheet.timer); clearTimeout(wheel.timer); }

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
  // 大小不用 scale，全部交給透視：z 從 +155 (抽出) 一路退到 -1800 (最深)，倍率 1.12 → 0.45
  const P0 = {}, G0 = {};
  function pose(d, out) {
    const ad = Math.abs(d), s = d < 0 ? -1 : 1;
    // 抽出只影響中央這本 (ad<.5)，用鐘形權重讓拖曳時連續過渡
    const bump = ad < .5 ? 1 - smooth(ad / .5) : 0;
    const k = ext.ex * bump;
    const room = s * cfg.part * ext.part * smooth(Math.min(ad, 1));   // 鄰居沿軌道讓開
    const ux = soft(d, cfg.nearX) + room, uz = soft(d, cfg.nearZ) + room;
    const th = cfg.theta * RAD;
    out.x = ux * cfg.rail * Math.cos(th) + cfg.offset - cfg.side * k;
    out.y = -cfg.lift * k;
    out.z = -uz * cfg.rail * Math.sin(th) + cfg.pull * k;
    out.rot = cfg.yaw + Math.min(ad, 9) * cfg.yawDrift - cfg.yaw * cfg.faceUp * k;
    out.scale = 1 + (ext.pulse - 1) * bump;
    // 兩端都淡到 0 才離開視窗，回收換人時才不會在畫面上「跳出來」
    const near = d < -1 ? Math.max(0, 1 + (d + 1) / (cfg.nearVisible - 1)) : 1;
    const far = Math.min(1, (cfg.farVisible - ux) / 3.5);
    out.alpha = Math.max(0, Math.min(near, far));
    out.near = d > -1.6 && d < 2.6;                                  // 只有這些給 will-change
    out.blur = ux > cfg.farVisible * .74 ? 2 : ux > cfg.farVisible * .46 ? 1 : d < -1.9 ? 1 : 0;
    return out;
  }
  // 進場前「整疊還沒攤開」的姿態：全部擠在軌道前段、更深、透明
  function gathered(d, out) {
    const th = cfg.theta * RAD, u = soft(d, cfg.nearX) * .34;
    out.x = u * cfg.rail * Math.cos(th) + cfg.offset;
    out.y = 6; out.z = -u * cfg.rail * Math.sin(th) - 150;
    out.rot = cfg.yaw - 9; out.scale = .96; out.alpha = 0;
    return out;
  }

  // 只有值真的變了才寫 style，拖曳時省下大量樣式計算
  function put(el, transform, alpha, near, blur) {
    if (el._tf !== transform) { el.style.transform = transform; el._tf = transform; }
    if (el._op !== alpha) { el.style.setProperty('--fd-alpha', alpha); el._op = alpha; }
    if (el._nr !== near) { el.classList.toggle('fd-near', near); el._nr = near; }
    if (el._bl !== blur) { el.classList.toggle('fd-blur1', blur === 1); el.classList.toggle('fd-blur2', blur === 2); el._bl = blur; }
  }

  function paint() {
    const n = count();
    _currentX = -c * _cardWidth;
    sfSyncWindow(c);
    const now = performance.now();
    for (const entry of _sfPool) {
      const el = entry.el, v = entry.vIndex;
      if (v === null || !n) { el.classList.add('sf-far'); continue; }
      const d = v - c, ad = Math.abs(d);
      const p = pose(d, P0);
      const visible = p.alpha > .012;
      el.classList.toggle('sf-far', !visible);
      if (!visible) { el._tf = null; continue; }
      const isActive = v === _sfActiveIndex;
      el.classList.toggle('active', isActive);
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
      const y = p.y + (entry === sheet.entry && v === sheet.vIndex ? sheet.shift * sheet.amt : 0);   // 回收換人就不套
      put(el,
        `translate3d(${p.x.toFixed(1)}px,${y.toFixed(1)}px,${p.z.toFixed(1)}px) rotateY(${p.rot.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`,
        p.alpha.toFixed(3), p.near, p.blur);
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
      const t = (now - ext.t0) / 1000, b = ext.base;
      ext.part = b + (1 - b) * outCubic(t / .16);
      ext.ex = b + (1 - b) * springEx(t - .06);
      ext.pulse = 1 + .03 * (1 - b) * Math.sin(Math.PI * clamp01(t / .55));
      if (t < .68) more = true;
      else {
        ext.mode = 'none'; ext.ex = ext.part = ext.pulse = 1;
        if (state === 'extracting') { state = 'idle'; scheduleOpen(); }
        const cb = ext.done; ext.done = null; if (cb) cb();
      }
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
    // 開紙讓位
    if (sheet.amt !== sheet.target) {
      const t = clamp01((now - sheet.t0) / (sheet.target ? 480 : 220));
      sheet.amt = sheet.from + (sheet.target - sheet.from) * outQuint(t);
      if (t < 1) more = true; else sheet.amt = sheet.target;
    }
    paint();
    if (more) requestFrame();
  }

  // ── 抽出動畫：鄰居讓開 (0-160ms) → 抽出 (60ms 起，彈簧衝過頭) → 收斂 (~680ms) ──
  function startExtraction(now) {
    if (reduced()) { ext.mode = 'none'; ext.ex = ext.part = ext.pulse = 1; state = 'idle'; paint(); scheduleOpen(); const cb = ext.done; ext.done = null; if (cb) cb(); return; }
    state = 'extracting';
    ext.mode = 'in'; ext.t0 = now || performance.now();
    ext.base = clamp01(Math.min(ext.ex, ext.part));      // 從目前抽到一半的位置接著抽，不跳回 0
    ext.ex = ext.part = ext.base; ext.pulse = 1;
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
  function sheetShift(entry) {
    const s = entry.el.querySelector('.fd-sheet');
    if (!s) return 0;
    // 用透視投影算：資料夾根節點在 z=zActive、紙再往前 40px，兩者被放大的倍率不同，
    // 透視原點在舞台 (50%, 44%)。要讓紙的頂端留 12px、資料夾底部也留 12px。
    const sh = area.clientHeight || 560, fh = cfg.fh, h = s.offsetHeight;
    const oy = sh * ORIGIN_Y, Ly = sh / 2 - fh / 2;
    const Pz = PERSP / (PERSP - cfg.pull), Ps = PERSP / (PERSP - cfg.pull - 40);
    let overlap = 74;                                   // 紙的下緣插進資料夾多深
    const yActive = -cfg.lift;                           // pose() 給抽出那本的 y
    let need = (12 - oy) / Ps + oy - Ly - overlap + h;   // 紙頂端不被切到，根節點至少要往下多少
    const max = (sh - 12 - oy) / Pz + oy - Ly - fh;      // 資料夾底部不能掉出舞台
    if (need > max) { overlap += need - max; need = max; }
    let shift = need - yActive;
    if (shift < 0) shift = 0;
    entry.el.style.setProperty('--fd-overlap', overlap.toFixed(0) + 'px');
    return shift;
  }
  function openSheet() {
    const entry = sfActiveEntry();
    clearTimeout(sheet.timer);
    if (!entry || state !== 'idle' || !entry.student) return;
    if (entry.el.classList.contains('is-open')) return;
    for (const e of _sfPool) if (e !== entry) e.el.classList.remove('is-open');
    entry.el.classList.add('is-open');
    sheet.entry = entry; sheet.vIndex = entry.vIndex;
    sheet.shift = sheetShift(entry);
    sheet.from = sheet.amt; sheet.target = 1; sheet.t0 = performance.now();
    requestFrame();
  }
  function closeSheet(instant) {
    clearTimeout(sheet.timer);
    for (const e of _sfPool) e.el.classList.remove('is-open');
    if (instant) { sheet.amt = sheet.target = 0; sheet.entry = null; paint(); return; }
    if (sheet.amt) { sheet.from = sheet.amt; sheet.target = 0; sheet.t0 = performance.now(); requestFrame(); }
    else sheet.entry = null;
  }
  function scheduleOpen() {
    clearTimeout(sheet.timer);
    sheet.timer = setTimeout(() => { if (state === 'idle' && !active && !document.hidden && currentPage === 'student-files') openSheet(); }, 140);
  }
  function toggleSheet() {
    const entry = sfActiveEntry();
    if (entry?.el.classList.contains('is-open')) closeSheet(false); else openSheet();
  }

  // ── 吸附到某一本 ─────────────────────────────────────────────────────────
  function settle(index, initialVelocity = 0) {
    clearTimeout(sheet.timer);
    _sfActiveIndex = index;
    snap.target = index;
    snap.delta = (index - c) * _cardWidth;               // 以 px 計的距離 (_currentX 座標系)
    if (Math.abs(snap.delta) < .5 && !initialVelocity) {
      c = index; snap.active = false; moving(false);
      if (ext.ex >= 1 && ext.mode === 'none') { state = 'idle'; paint(); scheduleOpen(); }
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
      startX = x; startC = c;
      if (document.activeElement?.closest('.sf-folder')) document.activeElement.blur();
      return true;
    }
    const dt = now - lastTime;
    if (dt > 0) velocity = .65 * ((x - lastX) / dt * 1000) + .35 * velocity;
    lastX = x; lastTime = now;
    c = startC - dx / _cardWidth;          // 無限循環：兩端都不設限
    requestFrame();
    return true;
  }
  function up(cancelled) {
    if (!active) return;
    active = false;
    if (!dragging) { if (state === 'idle') scheduleOpen(); return; }
    dragging = false;
    if (cancelled || performance.now() - lastTime > 100) velocity = 0;
    // velocity 是手指的 px/s (往右為正)；往右拖 = 索引變小
    const projected = c - velocity * .16 / _cardWidth;
    const current = Math.round(c);          // 以放手時的位置為準：拖超過 3 本也不會猛彈回去
    let next = Math.round(projected);
    next = Math.max(current - 3, Math.min(current + 3, next));
    settle(next, velocity);
    setTimeout(() => suppressClick = false, 0);
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
      c += px / _cardWidth; wheel.acc = .6 * px + .4 * wheel.acc;
      requestFrame();
      clearTimeout(wheel.timer);
      wheel.timer = setTimeout(() => {
        const base = Math.round(c);
        const target = Math.max(base - 2, Math.min(base + 2, Math.round(c + wheel.acc / _cardWidth * .3)));
        settle(target, -wheel.acc * 8);
      }, 120);
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
    else if (state === 'idle') toggleSheet();
  }, true);
  area.tabIndex = 0; area.setAttribute('aria-label', '住宿生資料夾，可左右滑動、使用方向鍵，Enter 展開');
  area.addEventListener('keydown', e => {
    if (state === 'locked' || e.target.closest('input,textarea,select,button,a')) return;   // 紙上的按鈕要吃得到 Enter/Space
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); jumpTo(_sfActiveIndex + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (state === 'idle') toggleSheet(); }
    else if (e.key === 'Escape') closeSheet(false);
  });
  window.addEventListener('resize', () => {
    measure();
    for (const e of _sfPool) e.el._tf = null;
    if (sheet.entry) sheet.shift = sheetShift(sheet.entry);
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
      if (reduced()) { ext.ex = ext.part = ext.pulse = 1; state = 'idle'; paint(); scheduleOpen(); return; }
      ext.mode = 'none'; ext.ex = ext.part = 0; ext.pulse = 1;
      ent = { t0: performance.now(), only: null };
      state = 'entering';
      paint(); ent.t0 = performance.now();   // 第一次 paint 會重建 13 本的內容，時間軸從那之後才開始算
      requestFrame();
    },
    // 刪除完、床位清空後，同一本資料夾重新「長回來」：短進場 + 小抽出。回傳抽出完成的 Promise
    materialize(el) {
      const entry = _sfPool.find(x => x.el === el);
      state = 'idle';
      if (!entry) { paint(); return Promise.resolve(); }
      return new Promise(resolve => {
        ext.done = resolve;
        if (reduced()) { ext.ex = ext.part = ext.pulse = 1; paint(); scheduleOpen(); const cb = ext.done; ext.done = null; cb(); return; }
        ext.mode = 'none'; ext.ex = ext.part = 0; ext.pulse = 1;
        ent = { t0: performance.now(), only: entry };
        state = 'entering';
        paint(); ent.t0 = performance.now();
        requestFrame();
      });
    },
    // 刪除中：鎖住所有輸入 (拖曳、滾輪、點擊、鍵盤)，畫面停在目前狀態
    lock() { stopAll(); resetInput(); state = 'locked'; ext.ex = ext.part = ext.pulse = 1; sheet.amt = sheet.target; paint(); },
    unlock() { if (state === 'locked') state = 'idle'; },
    settle, openSheet, closeSheet, paint, measure,
    get state() { return state; },
    get center() { return c; },
    get cfg() { return cfg; }
  };
  window._sfDisable3D = () => closeSheet(false);
  window._restart3DTimer = () => { if (state === 'idle') scheduleOpen(); };
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
