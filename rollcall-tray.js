// ─── 點名頁長按選取盤：按住格子會抖、馬達越震越快 → 彈出圓形選取盤 → 不放手往選項方向拖再放開 ───
// 晚歸：狀態維持「在場」(總表算到)，另外記一個標記，存在設定表 late_<日期>_<中隊>
// 備註：直接寫進住宿生的備註文字，住宿生檔案頁也看得到，換床時會跟著人走；外圈四個選項在點名列顯示成圖案
(function () {
  // 每一下的間隔，由慢到快，加起來就是要按多久 (約 0.85 秒)。第一段不震，輕點不會有感
  const HOLD_STEPS_MS = [140, 170, 125, 95, 72, 56, 44, 35, 28, 23, 19, 16, 14, 12];
  const PULSE_MS = [24, 40];     // Android 每一下震多久：由短到長。低於 15 毫秒馬達轉不起來，手上感覺不到
  const MOVE_CANCEL_PX = 10;     // 選單出來前手指移動超過這個距離，當作在捲動
  const TAP_MAX_MS = 300;        // 按超過這麼久才放開，就不算點一下
  const DEAD_ZONE = 26;          // 手指離按下去的點太近 = 還沒選
  const WHEEL_RADIUS = 168;
  const SHAKE_HZ = [7, 26];      // 格子抖動頻率：從慢到快
  const SHAKE_PX = [0.8, 3.2];   // 格子抖動幅度：從小到大
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 24×24 的圖案。stroke 用目前文字色，外圈四個有自己的材質色
  const GLYPH = {
    late: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    phone: '<path d="M6.6 3.5 9.5 3l1.6 4.2-2 1.5a11 11 0 0 0 6.2 6.2l1.5-2 4.2 1.6-.5 2.9c-.2 1-1 1.6-2 1.6C10.700 19 5 13.300 5 5.500c0-1 .6-1.800 1.600-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    remark: '<path d="M5 3.500h10l4 4V20.500H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.500 11h7M8.500 15h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    yellow: '<path d="M6 2.500h12V21.500l-2-1.400-2 1.400-2-1.400-2 1.400-2-1.400-2 1.400z" fill="#ffd60a" stroke="#a88a00" stroke-width="1.400" stroke-linejoin="round"/><path d="M12 7v6" stroke="#5c4a00" stroke-width="2.200" stroke-linecap="round"/><circle cx="12" cy="16.300" r="1.300" fill="#5c4a00"/>',
    ceramic: '<circle cx="12" cy="12" r="10" fill="#f6f2e7" stroke="#8d8a7c" stroke-width="1.500"/><circle cx="12" cy="12" r="6.500" fill="none" stroke="#2f6fb5" stroke-width="1.700"/><circle cx="12" cy="12" r="2.300" fill="#2f6fb5"/><path d="M5.500 7.500A8 8 0 0 1 10 4.300" fill="none" stroke="#fff" stroke-width="1.500" stroke-linecap="round"/>',
    consent: '<path d="M5 2.500h10.500L19.500 6.500V21.500H5z" fill="#fbfbf7" stroke="#8b8f98" stroke-width="1.400" stroke-linejoin="round"/><path d="M8 9h8M8 12.500h8M8 16h4" stroke="#8b8f98" stroke-width="1.500" stroke-linecap="round"/><circle cx="17.500" cy="18" r="4.500" fill="#ef4444"/><path d="m15.700 16.200 3.600 3.600m0-3.600-3.600 3.600" stroke="#fff" stroke-width="1.500" stroke-linecap="round"/>',
    officer: '<path d="M3 9.500 12 5l9 4.500-2.500 2.200h-13z" fill="#27406f" stroke="#172845" stroke-width="1.200" stroke-linejoin="round"/><circle cx="12" cy="8.700" r="1.500" fill="#f2c94c"/><path d="M6.500 12.500h11V14a5.500 5.500 0 0 1-11 0z" fill="#f2c6a0" stroke="#b98b66" stroke-width="1.100"/><path d="M5 22c.5-3.500 3.300-5 7-5s6.500 1.500 7 5z" fill="#27406f"/>',
    issue: '<path d="M12 2.800 22.500 21h-21z" fill="#f59e0b" stroke="#a65f00" stroke-width="1.300" stroke-linejoin="round"/><path d="M12 9v6" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/><circle cx="12" cy="18" r="1.500" fill="#fff"/>',
  };
  const INNER = [
    { id: 'remark', label: '備註', angle: -90, span: 90 },
    { id: 'phone', label: '電話', angle: 0, span: 90 },
    { id: 'yellow', label: '開黃單', angle: 90, span: 90 },
    { id: 'late', label: '晚歸', angle: 180, span: 90 },
  ];
  const TAGS = [
    { id: 'ceramic', label: '沒繳回瓷扣', angle: -157.5, span: 45 },
    { id: 'consent', label: '沒住宿同意書', angle: -112.5, span: 45 },
    { id: 'officer', label: '找教官', angle: -67.5, span: 45 },
    { id: 'issue', label: '有狀況!', angle: -22.5, span: 45 },
  ];
  const TAG_LABELS = TAGS.map(t => t.label);

  let hold = null;   // 正在按住
  let menu = null;   // 選單開著
  let scrollLock = null;
  let suppressClickUntil = 0;
  let lastTouchAt = 0;

  // ── 資料 ──
  const lateKey = (date, squad) => `late_${dateColumnToISO(date) || date}_${squad}`;
  const lateList = (date, squad) => String(state.config[lateKey(date, squad)] || '').split(',').filter(Boolean);
  const isLate = (s, date) => lateList(date, s.squad).includes(s.id);
  const remarkTokens = text => String(text || '').split('、').map(t => t.trim()).filter(Boolean);
  const hasTag = (s, label) => remarkTokens(s.remarks).includes(label);
  const findStudent = id => state.students.find(s => s.id === id);

  async function setLate(s, on) {
    const date = state.currentDate;
    const key = lateKey(date, s.squad);
    const before = state.config[key];
    const list = lateList(date, s.squad).filter(id => id !== s.id);
    if (on) list.push(s.id);
    state.config[key] = list.join(',');
    refreshRow(s.id);
    try {
      await window._api.setConfig({ [key]: state.config[key] });
    } catch (err) {
      state.config[key] = before;
      refreshRow(s.id);
      showToast('晚歸標記沒存到：' + escHtml(err.message), 'error');
    }
  }

  async function saveRemark(s, text) {
    const before = s.remarks || '';
    rememberSavedProfile(s.id, { remarks: text });
    refreshRow(s.id);
    try {
      await window._api.updateRemark(s.id, text);
    } catch (err) {
      rememberSavedProfile(s.id, { remarks: before });
      refreshRow(s.id);
      showToast('備註沒存到：' + escHtml(err.message), 'error');
    }
  }

  // ── 點名列上顯示的東西：外圈四個選項用圖案，自己打的備註才用文字 ──
  function nameIcons(s) {
    if (s.isEmpty) return '';
    return TAGS.filter(t => hasTag(s, t.label)).map(t =>
      `<svg class="rct-tag-icon" data-tag="${t.id}" viewBox="0 0 24 24" width="20" height="20" role="img" aria-label="${t.label}"><title>${t.label}</title>${GLYPH[t.id]}</svg>`).join('');
  }
  function rowExtras(s) {
    if (s.isEmpty) return '<div class="rct-extras"></div>';
    const status = s.attendance[state.currentDate] || '✓';
    const late = status === '✓' && isLate(s, state.currentDate);
    const remark = remarkTokens(s.remarks).filter(t => !TAG_LABELS.includes(t)).join('、');
    return `<div class="rct-extras">${late ? '<span class="rct-late">晚歸</span>' : ''}${remark ? `<span class="rct-remark">${escHtml(remark)}</span>` : ''}</div>`;
  }
  function refreshRow(id) {
    const s = findStudent(id);
    const row = document.querySelector(`.student-row[data-pid="${id}"]`);
    if (!s || !row) return;
    const extras = row.querySelector('.rct-extras');
    if (extras) extras.outerHTML = rowExtras(s);
    const icons = row.querySelector('.rct-name-icons');
    if (icons) icons.innerHTML = nameIcons(s);
  }
  // 別台改了晚歸也要重畫：放進總表簽名
  function signature() {
    const prefix = `late_${dateColumnToISO(state.currentDate) || state.currentDate}_`;
    return Object.keys(state.config).filter(k => k.startsWith(prefix)).sort().map(k => k + '=' + state.config[k]).join(';');
  }
  // 改成請假/未請假時，晚歸標記就不算數了
  function clearLate(id) {
    const s = findStudent(id);
    if (s && isLate(s, state.currentDate)) setLate(s, false);
  }

  // ── 長按不能選到網頁文字：iPhone 會去抓手指附近任何能選的字，所以按住期間整頁都不准選 ──
  function clearSelection() {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
  }
  function allowSelection() {
    // 手指放開的瞬間瀏覽器還可能補一次選取，晚一點才恢復
    setTimeout(() => { if (!hold && !menu) document.documentElement.classList.remove('rct-no-select'); }, 400);
  }

  // ── 鎖定畫面：選單開著時不能捲動，不然選到一半背景會跑掉 ──
  // iPhone 不一定理會 preventDefault，所以把頁面整個固定住，連捲動能力都拿掉
  function lockScroll(row) {
    if (scrollLock) return;
    const body = document.body;
    const inner = [];
    for (let el = row && row.parentElement; el && el !== body && el !== document.documentElement; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
        inner.push({ el, top: el.scrollTop, overflow: el.style.overflow });
        el.style.overflow = 'hidden';
      }
    }
    const y = window.scrollY;
    const saved = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width };
    body.style.position = 'fixed';
    body.style.top = -y + 'px';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.classList.add('rct-locked');
    // 手指放開前還在滑的慣性也要擋掉
    const guard = () => { for (const i of inner) if (i.el.scrollTop !== i.top) i.el.scrollTop = i.top; };
    window.addEventListener('scroll', guard, true);
    scrollLock = { y, saved, inner, guard };
  }
  function unlockScroll() {
    if (!scrollLock) return;
    const { y, saved, inner, guard } = scrollLock;
    scrollLock = null;
    window.removeEventListener('scroll', guard, true);
    const body = document.body;
    Object.assign(body.style, saved);
    body.classList.remove('rct-locked');
    for (const i of inner) { i.el.style.overflow = i.overflow; i.el.scrollTop = i.top; }
    window.scrollTo(0, y);
  }

  // ── 穩重的回彈：阻尼彈簧取樣成關鍵影格，只回彈約 7%，有重量不亂跳；只動 transform，手機跑得動 ──
  function springFrames(from, stiffness = 7, damping = 7, samples = 18) {
    const frames = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const v = 1 - Math.exp(-damping * t) * Math.cos(stiffness * t);
      frames.push({ offset: t, ...from(v, t) });
    }
    frames[samples] = { offset: 1, ...from(1, 1) };
    return frames;
  }
  function animate(el, frames, duration, delay = 0, fill = 'both') {
    if (REDUCED_MOTION || !el.animate) return null;
    if (el._rctAnim) el._rctAnim.cancel();
    el._rctAnim = el.animate(frames, { duration, delay, fill, easing: 'linear' });
    return el._rctAnim;
  }
  const popIn = (el, delay) => animate(el, springFrames(v => ({
    transform: `scale(${(0.82 + 0.18 * v).toFixed(3)})`, opacity: Math.min(1, v * 2.5).toFixed(3),
  })), 420, delay);
  // 外環從備註那格「甩」出去展開：旋轉 + 放大都帶回彈
  const fanOut = (el, fromDeg, delay) => animate(el, springFrames(v => ({
    transform: `rotate(${(fromDeg * (1 - v)).toFixed(2)}deg) scale(${(0.9 + 0.1 * v).toFixed(3)})`, opacity: Math.min(1, v * 3).toFixed(3),
  })), 420, delay);
  const fanIn = (el, toDeg) => animate(el, [
    { transform: 'rotate(0deg) scale(1)', opacity: 1 },
    { transform: `rotate(${toDeg}deg) scale(.9)`, opacity: 0 },
  ], 130);

  // ── 選取盤：像遊戲的圓形快捷盤，手指往哪個方向拖就選哪一格 ──
  function layout(x, y) {
    const w = window.innerWidth, h = window.innerHeight;
    const outer = Math.min(WHEEL_RADIUS, w / 2 - 12);
    const inner = outer * 0.56;      // 內圈外緣；再往外就是外圈
    const hub = outer * 0.22;
    const cx = Math.min(Math.max(x, outer + 12), w - outer - 12);
    const cy = Math.min(Math.max(y, outer + 70), h - inner - 20);
    return { cx, cy, inner, outer, hub };
  }
  const polar = (g, r, deg) => {
    const rad = deg * Math.PI / 180;
    return [g.cx + Math.cos(rad) * r, g.cy + Math.sin(rad) * r];
  };
  function wedgePath(g, r0, r1, center, span) {
    const gap = 1.6; // 扇形之間留一點溝，看起來像一塊一塊的實體按鍵
    const a0 = center - span / 2 + gap, a1 = center + span / 2 - gap;
    const large = a1 - a0 > 180 ? 1 : 0;
    const [x0, y0] = polar(g, r1, a0), [x1, y1] = polar(g, r1, a1), [x2, y2] = polar(g, r0, a1), [x3, y3] = polar(g, r0, a0);
    return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
  }
  function slotSvg(g, item, r0, r1, outer, on) {
    const mid = (r0 + r1) / 2 + (outer ? 3 : 0);
    const [lx, ly] = polar(g, mid, item.angle);
    const size = outer ? 28 : 24;
    const iconY = ly - (outer ? 22 : 20);
    const labelY = ly + (outer ? 14 : 13);
    const rad = item.angle * Math.PI / 180;
    const style = `--dx:${(Math.cos(rad) * 3).toFixed(1)}px;--dy:${(Math.sin(rad) * 3).toFixed(1)}px;transform-origin:${g.cx}px ${g.cy}px`;
    return `<g class="rct-slot${outer ? ' rct-outer' : ''}${on ? ' rct-on' : ''}" data-id="${item.id}" data-x="${lx}" data-y="${ly}" style="transform-origin:${g.cx}px ${g.cy}px">
      <g class="rct-face" style="${style}">
        <path class="rct-face-base" d="${wedgePath(g, r0, r1, item.angle, item.span)}"/>
        <path class="rct-face-edge" d="${wedgePath(g, r0 + 1, r1 - 1, item.angle, item.span - 1)}"/>
        <svg x="${lx - size / 2}" y="${iconY}" width="${size}" height="${size}" viewBox="0 0 24 24" class="rct-glyph">${GLYPH[item.id]}</svg>
        <text x="${lx}" y="${labelY}" dy=".35em">${item.label}</text>
      </g></g>`;
  }

  function openMenu(s, x, y) {
    const g = layout(x, y);
    const present = (s.attendance[state.currentDate] || '✓') === '✓';
    const lateOn = present && isLate(s, state.currentDate);
    const innerSvg = INNER.map(i => slotSvg(g, i, g.hub + 3, g.inner, false, i.id === 'late' && lateOn)).join('');
    const outerSvg = TAGS.map(t => slotSvg(g, t, g.inner + 3, g.outer, true, hasTag(s, t.label))).join('');
    const root = document.createElement('div');
    root.id = 'rc-tray';
    root.dataset.cx = g.cx;
    root.dataset.cy = g.cy;
    root.dataset.ox = x;
    root.dataset.oy = y;
    root.innerHTML = `<div class="rct-caption"></div>
      <svg class="rct-wheel" width="100%" height="100%">
        <defs>
          <linearGradient id="rct-raised" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rct-stop-top"/><stop offset="1" class="rct-stop-bot"/></linearGradient>
          <linearGradient id="rct-pressed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a6fe0"/><stop offset="1" stop-color="#3aa0ff"/></linearGradient>
          <linearGradient id="rct-edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rct-stop-light"/><stop offset="1" class="rct-stop-dark"/></linearGradient>
          <linearGradient id="rct-hub-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rct-stop-bot"/><stop offset="1" class="rct-stop-top"/></linearGradient>
          <radialGradient id="rct-shadow"><stop offset=".72" class="rct-stop-shadow"/><stop offset="1" stop-opacity="0" class="rct-stop-shadow"/></radialGradient>
        </defs>
        <g class="rct-group rct-outer-shadow" style="transform-origin:${g.cx}px ${g.cy}px"><path d="${wedgePath(g, g.inner, g.outer + 10, -90, 184)}" fill="url(#rct-shadow)"/></g>
        ${outerSvg}
        <g class="rct-base" style="transform-origin:${g.cx}px ${g.cy}px"><circle cx="${g.cx}" cy="${g.cy + 4}" r="${g.inner + 12}" fill="url(#rct-shadow)"/></g>
        ${innerSvg}
        <g class="rct-hub-group" style="transform-origin:${g.cx}px ${g.cy}px">
          <circle class="rct-hub" cx="${g.cx}" cy="${g.cy}" r="${g.hub}"/>
          <text class="rct-hub-text" x="${g.cx}" y="${g.cy}" dy=".35em"></text>
        </g>
        <circle class="rct-cursor" r="6" cx="${g.cx}" cy="${g.cy}" style="opacity:0"/>
      </svg>`;
    document.body.appendChild(root);
    const slots = [...INNER.map(i => ({ ...i, outer: false })), ...TAGS.map(t => ({ ...t, outer: true }))]
      .map(item => ({ ...item, el: root.querySelector(`.rct-slot[data-id="${item.id}"]`) }));
    menu = {
      root, s, g, slots, active: null, outerOpen: false, originX: x, originY: y,
      caption: root.querySelector('.rct-caption'),
      hubText: root.querySelector('.rct-hub-text'),
      cursor: root.querySelector('.rct-cursor'),
      outerShadow: root.querySelector('.rct-outer-shadow'),
    };
    setCaption();
    root.classList.add('rct-show');
    // 中心先彈出來，三格接著一格一格彈開
    popIn(root.querySelector('.rct-base'), 0);
    popIn(root.querySelector('.rct-hub-group'), 0);
    slots.filter(i => !i.outer).forEach((slot, i) => popIn(slot.el, 30 + i * 30));
    popIn(menu.caption, 60);
    haptic('heavy');
  }

  function setOuterOpen(open) {
    if (menu.outerOpen === open) return;
    menu.outerOpen = open;
    menu.root.classList.toggle('rct-outer-open', open);
    const tags = menu.slots.filter(i => i.outer);
    // 從備註那格 (正上方) 往左右甩出去，離得遠的晚一點到
    tags.forEach(slot => {
      const fromDeg = -90 - slot.angle;
      if (open) fanOut(slot.el, fromDeg, Math.abs(fromDeg) * 0.5);
      else fanIn(slot.el, fromDeg);
    });
    if (open) fanOut(menu.outerShadow, 0, 0);
    else fanIn(menu.outerShadow, 0);
  }

  function setCaption() {
    const a = menu.active, s = menu.s;
    let text = s.name;
    if (a) {
      if (a.id === 'phone') text = s.phone ? `${s.name}：${s.phone}` : `${s.name}：沒有電話資料`;
      else if (a.id === 'late') text = a.el.classList.contains('rct-on') ? '放開取消晚歸' : '放開標記晚歸 (總表算在場)';
      else if (a.id === 'remark') text = '放開寫備註，或繼續往外選';
      else if (a.id === 'yellow') text = `放開替 ${s.name} 開黃單`;
      else text = (a.el.classList.contains('rct-on') ? '放開取消：' : '放開標記：') + a.label;
    }
    menu.caption.textContent = text;
    menu.hubText.textContent = a ? (a.outer ? '放開' : a.id === 'phone' && s.phone ? '看電話' : a.label) : String(s.name || '').slice(0, 4);
  }

  const inSector = (deg, center, span) => Math.abs(((deg - center + 540) % 360) - 180) <= span / 2;

  // 只看手指相對按下去那一點的方向和距離；盤子被螢幕邊緣推開也一樣準
  function hitTest(dx, dy) {
    const { g, slots, outerOpen } = menu;
    const r = Math.hypot(dx, dy);
    if (r < DEAD_ZONE) return null;
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    // 外圈開著、手指夠遠且還在上半圈：照方向選外圈，滑過去不會被內圈搶走
    if (outerOpen && dy < 0 && r > g.inner * 0.8) {
      return slots.find(i => i.outer && inSector(deg, i.angle, i.span)) || null;
    }
    return slots.find(i => !i.outer && inSector(deg, i.angle, i.span)) || null;
  }

  function moveMenu(x, y) {
    if (!menu) return;
    const dx = x - menu.originX, dy = y - menu.originY;
    const { g } = menu;
    const r = Math.hypot(dx, dy), limit = g.outer - 10, k = r > limit ? limit / r : 1;
    menu.cursor.setAttribute('cx', g.cx + dx * k);
    menu.cursor.setAttribute('cy', g.cy + dy * k);
    menu.cursor.style.opacity = r < DEAD_ZONE ? 0 : 1; // 還沒開始拖就不要蓋住中間的姓名
    const hit = hitTest(dx, dy);
    if (hit === menu.active) return;
    if (menu.active) menu.active.el.classList.remove('rct-hover');
    menu.active = hit;
    if (hit) {
      hit.el.classList.add('rct-hover');
      haptic('light');
      if (hit.id === 'remark') setOuterOpen(true);
      else if (!hit.outer) setOuterOpen(false);
    } else {
      setOuterOpen(false);
    }
    setCaption();
  }

  function closeMenu() {
    if (!menu) return;
    const { root } = menu;
    menu = null;
    unlockScroll();
    allowSelection();
    root.classList.remove('rct-show');
    setTimeout(() => root.remove(), 170);
  }

  function releaseMenu() {
    if (!menu) return;
    const { s, active } = menu;
    closeMenu();
    suppressClickUntil = Date.now() + 500;
    if (!active) return;
    haptic('medium');
    if (active.id === 'late') {
      const on = !(isLate(s, state.currentDate) && (s.attendance[state.currentDate] || '✓') === '✓');
      if (on && (s.attendance[state.currentDate] || '✓') !== '✓') toggleStatus(s.id, '✓');
      setLate(s, on);
    } else if (active.id === 'phone') {
      showContact(s);
    } else if (active.id === 'remark') {
      editRemark(s);
    } else if (active.id === 'yellow') {
      issueYellow(s);
    } else {
      const tokens = remarkTokens(s.remarks);
      const next = tokens.includes(active.label) ? tokens.filter(t => t !== active.label) : [...tokens, active.label];
      saveRemark(s, next.join('、'));
    }
  }

  // ── 放開後的小視窗 ──
  function dialog(html) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay rct-dialog';
    overlay.innerHTML = `<div class="modal-card" style="max-width:340px">${html}</div>`;
    const close = () => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 260); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
      popIn(overlay.querySelector('.modal-card'), 0);
    });
    return { overlay, close };
  }

  function showContact(s) {
    const phone = String(s.phone || '').trim();
    const dial = phone.replace(/[^\d+]/g, '');
    const { overlay, close } = dialog(`
      <h3 style="margin:0 0 10px">${escHtml(s.name)} 的聯絡資料</h3>
      <p style="margin:0 0 6px;font-size:20px;font-weight:700">${phone ? escHtml(phone) : '沒有電話資料'}</p>
      <p style="margin:0 0 14px;font-size:13px;opacity:.75;word-break:break-all">${s.address ? escHtml(s.address) : '沒有住址資料'}</p>
      ${dial ? `<a class="modal-btn confirm rct-call" href="tel:${escHtml(dial)}">撥打電話</a>` : ''}
      <button type="button" class="modal-btn cancel" style="width:100%;margin-top:8px">關閉</button>`);
    overlay.querySelector('button').addEventListener('click', close);
  }

  function editRemark(s) {
    const { overlay, close } = dialog(`
      <h3 style="margin:0 0 10px">${escHtml(s.name)} 的備註</h3>
      <textarea class="rct-remark-input" rows="3" maxlength="500" placeholder="寫了就會一直顯示在點名頁，清空就會拿掉"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="modal-btn cancel" style="flex:1">取消</button>
        <button type="button" class="modal-btn confirm" style="flex:1">儲存</button>
      </div>`);
    const input = overlay.querySelector('textarea');
    input.value = s.remarks || '';
    overlay.querySelector('.cancel').addEventListener('click', close);
    overlay.querySelector('.confirm').addEventListener('click', () => {
      close();
      const text = input.value.trim();
      if (text !== (s.remarks || '')) saveRemark(s, text);
    });
  }

  function issueYellow(s) {
    if (!window.yc || !window.yc.issue) { showToast('黃單功能還沒載入好', 'error'); return; }
    const date = dateColumnToISO(state.currentDate) || localTodayISO();
    const count = window.yc.openCount(s);
    const chips = window.yc.reasons().map(r => `<button type="button" class="rct-chip" data-reason="${escHtml(r)}">${escHtml(r)}</button>`).join('');
    const { overlay, close } = dialog(`
      <h3 style="margin:0 0 4px">替 ${escHtml(s.name)} 開黃單</h3>
      <p style="margin:0 0 12px;font-size:13px;opacity:.75">目前待執行 ${count} 張</p>
      <div class="rct-chips">${chips}</div>
      <input class="rct-remark-input rct-yellow-reason" type="text" maxlength="100" placeholder="犯規事由 (點上面或自己打)">
      <label class="rct-yellow-date">開單日期 <input type="date" class="rct-remark-input" value="${escHtml(date)}"></label>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="modal-btn cancel" style="flex:1">取消</button>
        <button type="button" class="modal-btn confirm rct-yellow-submit" style="flex:1">開單</button>
      </div>`);
    const reasonInput = overlay.querySelector('.rct-yellow-reason');
    overlay.querySelector('.rct-chips').addEventListener('click', e => {
      const chip = e.target.closest('.rct-chip');
      if (!chip) return;
      reasonInput.value = chip.dataset.reason;
      for (const c of overlay.querySelectorAll('.rct-chip')) c.classList.toggle('rct-chip-on', c === chip);
    });
    overlay.querySelector('.cancel').addEventListener('click', close);
    const submit = overlay.querySelector('.rct-yellow-submit');
    submit.addEventListener('click', async () => {
      const reason = reasonInput.value.trim();
      if (!reason) { showToast('先寫犯規事由（或點上面的快速選項）', 'error'); reasonInput.focus(); return; }
      if (submit.disabled) return;
      submit.disabled = true;
      submit.textContent = '開單中…';
      try {
        const total = await window.yc.issue(s, reason, overlay.querySelector('input[type="date"]').value);
        close();
        haptic('heavy');
        showToast(`${escHtml(s.name)} 開了黃單，待執行 ${total} 張`, 'success');
      } catch (err) {
        submit.disabled = false;
        submit.textContent = '開單';
        showToast('開單失敗：' + escHtml(err.message || err), 'error');
      }
    });
  }

  // ── 馬達由慢到快 ──
  // Android 一次把整段節奏交給系統，比一下一下用計時器準；放開時 vibrate(0) 立刻停
  function startMotorRamp() {
    if (hapticMuted() || !hasVibrate()) return;
    const beats = HOLD_STEPS_MS.slice(1);
    const pattern = [0, HOLD_STEPS_MS[0]];
    beats.forEach((gap, i) => {
      const t = i / (beats.length - 1);
      const on = Math.min(gap - 2, Math.round(PULSE_MS[0] + (PULSE_MS[1] - PULSE_MS[0]) * t));
      pattern.push(Math.max(on, 8), Math.max(gap - on, 2));
    });
    try { navigator.vibrate(pattern); } catch (_) {}
  }
  function stopMotorRamp() {
    if (hasVibrate()) { try { navigator.vibrate(0); } catch (_) {} }
  }
  // iPhone 沒有震動 API：每一下敲 Taptic Engine，加上越來越重的低頻波形
  function iosRampBeat(step) {
    if (hapticMuted() || !IS_IOS) return;
    const t = step / (HOLD_STEPS_MS.length - 1);
    if (HOLD_STEPS_MS[step] >= 28 || step % 2 === 0) iosSwitchHaptic(1); // 太密的就隔一下敲，Safari 會把連點吃掉
    const peak = 0.04 + 0.2 * t;
    playHapticCurve([peak, peak * 0.3, 0.001], 26 + 20 * t, 'sine', 150 - 60 * t);
  }

  // ── 按住的流程：格子越抖越快、馬達越震越快，到底就彈出選單 ──
  function shakeLoop(h) {
    const total = HOLD_STEPS_MS.reduce((a, b) => a + b, 0);
    const startAt = HOLD_STEPS_MS[0]; // 第一段不抖，輕點不會有感
    let phase = 0, last = performance.now();
    const began = last;
    const frame = now => {
      if (hold !== h) return;
      const t = Math.min(1, Math.max(0, (now - began - startAt) / (total - startAt)));
      phase += 2 * Math.PI * (SHAKE_HZ[0] + (SHAKE_HZ[1] - SHAKE_HZ[0]) * t) * (now - last) / 1000;
      last = now;
      if (now - began > startAt && !REDUCED_MOTION) {
        const amp = SHAKE_PX[0] + (SHAKE_PX[1] - SHAKE_PX[0]) * t;
        h.row.style.transform = `translateX(${(Math.sin(phase) * amp).toFixed(2)}px) rotate(${(Math.cos(phase * 0.9) * amp * 0.12).toFixed(3)}deg) scale(${(1 - 0.03 * t).toFixed(3)})`;
      }
      h.raf = requestAnimationFrame(frame);
    };
    h.raf = requestAnimationFrame(frame);
  }
  function stopShake(h, bounce) {
    cancelAnimationFrame(h.raf);
    h.row.classList.remove('rct-holding');
    h.row.style.transform = '';
    h.row.style.transition = h.savedTransition;
    if (bounce) animate(h.row, springFrames(v => ({ transform: `scale(${(0.97 + 0.03 * v).toFixed(3)})` })), 300, 0, 'none');
  }
  function startHold(row, x, y) {
    if (hold || menu || !row) return;
    const s = findStudent(row.dataset.pid);
    if (!s || s.isEmpty || state.viewSemester) return;
    hold = { row, s, x, y, lastX: x, lastY: y, step: 0, timer: null, raf: 0, startedAt: performance.now(), savedTransition: row.style.transition };
    row.style.transition = 'none'; // .student-row 有 transition，會把抖動抹平
    row.classList.add('rct-holding');
    document.documentElement.classList.add('rct-no-select');
    clearSelection();
    shakeLoop(hold);
    startMotorRamp();
    const tick = () => {
      if (!hold) return;
      if (hold.step >= HOLD_STEPS_MS.length) {
        const h = hold;
        hold = null;
        stopShake(h, true);
        lockScroll(h.row);
        openMenu(h.s, h.lastX, h.lastY);
        return;
      }
      if (hold.step > 0) iosRampBeat(hold.step);
      hold.timer = setTimeout(tick, HOLD_STEPS_MS[hold.step++]);
    };
    tick();
  }
  function cancelHold() {
    if (!hold) return;
    const h = hold;
    hold = null;
    clearTimeout(h.timer);
    stopShake(h, false);
    stopMotorRamp();
    allowSelection();
  }
  function pointerMove(x, y) {
    if (menu) { moveMenu(x, y); return true; }
    if (hold) {
      hold.lastX = x; hold.lastY = y;
      if (Math.hypot(x - hold.x, y - hold.y) > MOVE_CANCEL_PX) cancelHold();
    }
    return false;
  }
  function pointerEnd() {
    if (menu) { releaseMenu(); return; }
    // 已經按到在抖了才放開 = 想長按又反悔，不能算成點一下換狀態
    if (hold && performance.now() - hold.startedAt > TAP_MAX_MS) suppressClickUntil = Date.now() + 500;
    cancelHold();
  }

  function install() {
    const list = document.getElementById('rc-student-list');
    if (!list) return;
    // 選單開著時整頁不准捲動。一定要事先掛好且不是 passive，手勢開始後才掛瀏覽器不理
    document.addEventListener('touchmove', e => { if (menu && e.cancelable) e.preventDefault(); }, { passive: false, capture: true });
    list.addEventListener('touchstart', e => {
      lastTouchAt = Date.now();
      if (e.touches.length !== 1) { cancelHold(); return; }
      const row = e.target.closest('.student-row');
      if (!row) return;
      const t = e.touches[0];
      startHold(row, t.clientX, t.clientY);
      // 背景刷新可能把這一列換掉，事件要綁在手指按到的元素上，換掉了還是收得到
      const target = e.target;
      const move = ev => {
        const touch = ev.touches[0];
        if (touch && pointerMove(touch.clientX, touch.clientY) && ev.cancelable) ev.preventDefault();
      };
      const end = () => {
        target.removeEventListener('touchmove', move);
        target.removeEventListener('touchend', end);
        target.removeEventListener('touchcancel', end);
        pointerEnd();
      };
      target.addEventListener('touchmove', move, { passive: false });
      target.addEventListener('touchend', end);
      target.addEventListener('touchcancel', end);
    }, { passive: true });

    // 電腦用滑鼠也能按住
    list.addEventListener('mousedown', e => {
      if (e.button !== 0 || Date.now() - lastTouchAt < 800) return;
      startHold(e.target.closest('.student-row'), e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', e => { if (Date.now() - lastTouchAt >= 800) pointerMove(e.clientX, e.clientY); });
    document.addEventListener('mouseup', () => { if (Date.now() - lastTouchAt >= 800) pointerEnd(); });

    list.addEventListener('scroll', cancelHold, { passive: true });
    window.addEventListener('scroll', () => { if (hold) cancelHold(); }, { passive: true });
    // 長按放開後瀏覽器還會補一個 click，不能算成點一下切換狀態
    list.addEventListener('click', e => {
      if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    document.addEventListener('contextmenu', e => {
      if (hold || menu) e.preventDefault();
    }, true);
    document.addEventListener('selectstart', e => {
      if (hold || menu) e.preventDefault();
    }, true);
    document.addEventListener('selectionchange', () => {
      if (hold || menu) clearSelection();
    });
    const markSuppress = () => { if (menu) suppressClickUntil = Date.now() + 500; };
    document.addEventListener('touchend', markSuppress, true);
    document.addEventListener('mouseup', markSuppress, true);
  }

  window._rcTray = { rowExtras, nameIcons, refreshRow, signature, clearLate, swallowingClick: () => Date.now() < suppressClickUntil };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
