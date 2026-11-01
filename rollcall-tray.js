// ─── 點名頁長按選取盤：按住越震越快 → 跳出圓形選取盤 → 不放手往選項方向拖再放開 ───
// 晚歸：狀態維持「在場」(總表算到)，另外記一個標記，存在設定表 late_<日期>_<中隊>
// 備註：直接寫進住宿生的備註文字，住宿生檔案頁也看得到，換床時會跟著人走
(function () {
  const HOLD_STEPS_MS = [150, 110, 90, 70, 55, 45, 30]; // 每次震動的間隔，越來越短，加起來就是要按多久
  const MOVE_CANCEL_PX = 10;     // 選單出來前手指移動超過這個距離，當作在捲動
  const DEAD_ZONE = 26;          // 手指離按下去的點太近 = 還沒選
  const WHEEL_RADIUS = 168;
  const INNER = [
    { id: 'remark', label: '備註', angle: -90, span: 120 },
    { id: 'phone', label: '電話', angle: 30, span: 120 },
    { id: 'late', label: '晚歸', angle: 150, span: 120 },
  ];
  const TAGS = [
    { id: 'ceramic', label: '沒繳回瓷扣', lines: ['沒繳回', '瓷扣'], angle: -157.5, span: 45 },
    { id: 'consent', label: '沒住宿同意書', lines: ['沒住宿', '同意書'], angle: -112.5, span: 45 },
    { id: 'officer', label: '找教官', lines: ['找教官'], angle: -67.5, span: 45 },
    { id: 'issue', label: '有狀況!', lines: ['有狀況!'], angle: -22.5, span: 45 },
  ];
  const CERAMIC = TAGS[0].label;
  const CERAMIC_ICON = '<svg class="rct-ceramic" viewBox="0 0 24 24" width="18" height="18" role="img" aria-label="沒繳回瓷扣"><circle cx="12" cy="12" r="10" fill="#f4f1e8" stroke="#8d8a7c" stroke-width="1.5"/><circle cx="12" cy="12" r="6" fill="none" stroke="#2f6fb5" stroke-width="1.5"/><circle cx="12" cy="12" r="2" fill="#2f6fb5"/></svg>';

  let hold = null;   // 正在按住
  let menu = null;   // 選單開著
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

  // ── 點名列上顯示的東西 ──
  function nameIcons(s) {
    return !s.isEmpty && hasTag(s, CERAMIC) ? CERAMIC_ICON : '';
  }
  function rowExtras(s) {
    if (s.isEmpty) return '<div class="rct-extras"></div>';
    const status = s.attendance[state.currentDate] || '✓';
    const late = status === '✓' && isLate(s, state.currentDate);
    const remark = String(s.remarks || '').trim();
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

  // ── 選取盤：像遊戲的圓形快捷盤，手指往哪個方向拖就選哪一格 ──
  function layout(x, y) {
    const w = window.innerWidth, h = window.innerHeight;
    const outer = Math.min(WHEEL_RADIUS, w / 2 - 8);
    const inner = outer * 0.62;      // 內圈外緣；再往外就是外圈
    const hub = outer * 0.25;
    const cx = Math.min(Math.max(x, outer + 8), w - outer - 8);
    const cy = Math.min(Math.max(y, outer + 66), h - inner - 16);
    return { cx, cy, inner, outer, hub };
  }
  const polar = (g, r, deg) => {
    const rad = deg * Math.PI / 180;
    return [g.cx + Math.cos(rad) * r, g.cy + Math.sin(rad) * r];
  };
  function wedgePath(g, r0, r1, center, span) {
    const gap = 1.5; // 扇形之間留一點縫
    const a0 = center - span / 2 + gap, a1 = center + span / 2 - gap;
    const large = a1 - a0 > 180 ? 1 : 0;
    const [x0, y0] = polar(g, r1, a0), [x1, y1] = polar(g, r1, a1), [x2, y2] = polar(g, r0, a1), [x3, y3] = polar(g, r0, a0);
    return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
  }
  function slotSvg(g, item, r0, r1, outer, on) {
    const mid = (r0 + r1) / 2;
    const [lx, ly] = polar(g, mid, item.angle);
    const lines = item.lines || [item.label];
    const lineH = outer ? 15 : 18;
    const text = lines.map((line, i) => `<text x="${lx}" y="${ly + (i - (lines.length - 1) / 2) * lineH}" dy=".35em">${line}</text>`).join('');
    return `<g class="rct-slot${outer ? ' rct-outer' : ''}${on ? ' rct-on' : ''}" data-id="${item.id}" data-x="${lx}" data-y="${ly}"><path d="${wedgePath(g, r0, r1, item.angle, item.span)}"/>${text}</g>`;
  }

  function openMenu(s, x, y) {
    const g = layout(x, y);
    const present = (s.attendance[state.currentDate] || '✓') === '✓';
    const lateOn = present && isLate(s, state.currentDate);
    const inner = INNER.map(i => slotSvg(g, i, g.hub, g.inner, false, i.id === 'late' && lateOn)).join('');
    const outer = TAGS.map(t => slotSvg(g, t, g.inner + 2, g.outer, true, hasTag(s, t.label))).join('');
    const root = document.createElement('div');
    root.id = 'rc-tray';
    root.dataset.cx = g.cx;
    root.dataset.cy = g.cy;
    root.dataset.ox = x;
    root.dataset.oy = y;
    root.innerHTML = `<div class="rct-caption"></div>
      <svg class="rct-wheel" width="100%" height="100%" style="transform-origin:${g.cx}px ${g.cy}px">
        <circle class="rct-rim" cx="${g.cx}" cy="${g.cy}" r="${g.inner + 1}"/>
        ${outer}${inner}
        <circle class="rct-hub" cx="${g.cx}" cy="${g.cy}" r="${g.hub - 2}"/>
        <text class="rct-hub-text" x="${g.cx}" y="${g.cy}" dy=".35em"></text>
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
    };
    setCaption();
    requestAnimationFrame(() => root.classList.add('rct-show'));
    haptic('medium');
  }

  function setCaption() {
    const a = menu.active, s = menu.s;
    let text = s.name;
    if (a) {
      if (a.id === 'phone') text = s.phone ? `${s.name}：${s.phone}` : `${s.name}：沒有電話資料`;
      else if (a.id === 'late') text = a.el.classList.contains('rct-on') ? '放開取消晚歸' : '放開標記晚歸 (總表算在場)';
      else if (a.id === 'remark') text = '放開寫備註，或繼續往外選';
      else text = (a.el.classList.contains('rct-on') ? '放開取消：' : '放開標記：') + a.label;
    }
    menu.caption.textContent = text;
    menu.hubText.textContent = a ? (a.id === 'phone' && s.phone ? '放開看電話' : a.label).slice(0, 6) : String(s.name || '').slice(0, 4);
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
      if (hit.id === 'remark') menu.outerOpen = true;
      else if (!hit.outer) menu.outerOpen = false;
    } else {
      menu.outerOpen = false;
    }
    menu.root.classList.toggle('rct-outer-open', menu.outerOpen);
    setCaption();
  }

  function closeMenu() {
    if (!menu) return;
    const root = menu.root;
    menu = null;
    root.classList.remove('rct-show');
    setTimeout(() => root.remove(), 160);
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
    requestAnimationFrame(() => overlay.classList.add('visible'));
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

  // ── 按住的流程 ──
  function startHold(row, x, y) {
    if (hold || menu || !row) return;
    const s = findStudent(row.dataset.pid);
    if (!s || s.isEmpty || state.viewSemester) return;
    hold = { row, s, x, y, lastX: x, lastY: y, step: 0, timer: null };
    row.classList.add('rct-holding');
    const tick = () => {
      if (!hold) return;
      if (hold.step >= HOLD_STEPS_MS.length) {
        const h = hold;
        hold = null;
        h.row.classList.remove('rct-holding');
        openMenu(h.s, h.lastX, h.lastY);
        return;
      }
      if (hold.step > 0) haptic('light'); // 第一下等一小段才震，輕點不會有感
      hold.timer = setTimeout(tick, HOLD_STEPS_MS[hold.step++]);
    };
    tick();
  }
  function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.row.classList.remove('rct-holding');
    hold = null;
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
    if (menu) releaseMenu();
    else cancelHold();
  }

  function install() {
    const list = document.getElementById('rc-student-list');
    if (!list) return;
    // 選單開著時不准捲動。一定要事先掛好且不是 passive，手勢開始後才掛瀏覽器不理
    list.addEventListener('touchmove', e => { if (menu && e.cancelable) e.preventDefault(); }, { passive: false });
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
    // 長按放開後瀏覽器還會補一個 click，不能算成點一下切換狀態
    list.addEventListener('click', e => {
      if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    list.addEventListener('contextmenu', e => {
      if (hold || menu) e.preventDefault();
    });
    // 長按期間如果有選單已跳出，手指還沒移動就放開也要擋 click
    const markSuppress = () => { if (hold === null && menu) suppressClickUntil = Date.now() + 500; };
    document.addEventListener('touchend', markSuppress, true);
    document.addEventListener('mouseup', markSuppress, true);
  }

  window._rcTray = { rowExtras, nameIcons, refreshRow, signature, clearLate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
