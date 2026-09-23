// ─── 點名頁「全部請假」：假日大家都回家，一鍵把本中隊全部改成請假 ─────────────
// 每一條住宿生橫條會像店門口掛的牌子被推了一把，橫向轉一圈 (打烊)，翻到側面看不見的那一瞬間換成「請假」。
// 資料在按下確認時就先寫進 state，動畫只是畫面；中途換頁或背景刷新都不會少改。
(function () {
  const LEAVE = '◎';
  const STAGGER_MS = 110;   // 上下兩條的間隔 (由上往下一條接一條轉)
  const SPIN = buildSpin();   // 一條牌子橫向轉一圈的關鍵影格 (算一次，大家共用)
  let running = false;

  function paintRow(row, pending) {
    const si = window.CONFIG.STATUS[LEAVE];
    row.classList.add('absent');
    const badge = row.querySelector('.status-badge');
    if (badge) {
      badge.style.cssText = `background:${si.color}20;color:${si.color};border:1px solid ${si.color}40`;
      badge.innerHTML = `${si.icon} ${si.label}`;
    }
    const dot = row.querySelector('.sync-dot');
    if (dot && pending) dot.classList.add('pending');
  }

  // 像用手推一把掛著的牌子：一開始很快，靠慣性越轉越慢，轉過頭一點再盪回來停住。
  // 用彈簧+阻尼模擬 (推出去的初速 500°/s)，取樣成關鍵影格交給瀏覽器播，播放時不用算。
  function buildSpin() {
    const W = 3.2, Z = 0.72, dt = 1 / 240;
    let x = 0, v = 500, t = 0, swapAt = 0, last = 0;
    const pts = [[0, 0]];
    while (t < 4) {
      v += (-W * W * (x - 360) - 2 * Z * W * v) * dt;
      x += v * dt; t += dt;
      if (!swapAt && x >= 90) swapAt = t;              // 轉到 90° (側面、看不見) 的那一刻換內容
      if (Math.abs(x - 360) > 0.6 || Math.abs(v) > 3) last = t;
      if (t - pts[pts.length - 1][0] >= 1 / 30) pts.push([t, x]);
    }
    const dur = Math.ceil(last * 1000);
    const frames = pts.filter(p => p[0] < last).map(([pt, deg]) => ({
      offset: pt / last,
      transform: `perspective(1400px) rotateY(${deg.toFixed(2)}deg)`,
    }));
    frames.push({ offset: 1, transform: 'perspective(1400px) rotateY(360deg)' });
    return { frames, dur, swapMs: Math.round(swapAt * 1000) };
  }

  function flipRow(row, delay, onSwap) {
    return new Promise(resolve => {
      const anim = row.animate(SPIN.frames, { duration: SPIN.dur, delay, fill: 'backwards' });
      setTimeout(onSwap, delay + SPIN.swapMs);
      let landed = false;
      // 轉過頭最遠那一下 (約 1.2 秒) 亮黃光，像牌子晃到定位
      setTimeout(() => {
        if (landed) return; landed = true;
        row.classList.remove('la-landed'); void row.offsetWidth; row.classList.add('la-landed');
        setTimeout(() => row.classList.remove('la-landed'), 900);
      }, delay + 1200);
      anim.onfinish = anim.oncancel = () => resolve();
    });
  }

  async function leaveAllInSquad() {
    if (running) return;
    if (state.viewSemester) { showToast(`正在查看封存學期 ${state.viewSemester}，不能修改點名`, 'error'); return; }
    if (!state.currentSquad) return;
    const date = state.currentDate;
    const squad = state.currentSquad;
    const people = state.students.filter(s => s.squad === squad && !s.isEmpty && !s.hidden);
    const targets = people.filter(s => (s.attendance[date] || '✓') !== LEAVE);
    if (!targets.length) { showToast('這個中隊已經全部是請假了', 'info'); return; }

    const dateText = formatExportDate(dateColumnToISO(date)) || date;
    const ok = await showConfirmDialog({
      title: '全部改成請假？',
      message: `${escHtml(squad)} ${escHtml(dateText)}<br>還沒請假的 <b>${targets.length}</b> 位會全部改成請假。`,
      confirmText: `全部請假 (${targets.length})`,
      icon: '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    });
    // 確認期間可能換了中隊/日期，換了就不做
    if (!ok || state.currentSquad !== squad || state.currentDate !== date) return;
    running = true;

    // ── 1. 資料：馬上寫進 state 與未同步清單 (localStorage)，斷網也不會掉 ──
    const hasColumn = serverHasDateColumn(date);
    const batch = [];
    for (const s of targets) {
      s.attendance[date] = LEAVE;
      const key = s.id + '_' + date;
      clearTimeout(_syncTimers[key]); // 剛剛單點還在等送出的舊值不要再送，免得蓋掉請假
      const change = { pageId: s.id, date, value: LEAVE };
      const idx = state.changes.findIndex(c => c.pageId === s.id && c.date === date);
      if (idx >= 0) state.changes[idx] = change; else state.changes.push(change);
      if (!hasColumn) recordPendingAttendance(s.id, date, LEAVE);
      batch.push(change);
    }
    saveUnsyncedChanges();
    if (!hasColumn) showToast('後端點名表還沒有這一天的欄位，變更先暫存在這台裝置', 'info');

    // ── 2. 送出：跟動畫同時跑，每批 20 筆 ──
    const sending = sendAttendanceChanges(batch).then(({ failed, error }) => {
      const failedSet = new Set(failed);
      state.changes = state.changes.filter(c => !batch.includes(c) || failedSet.has(c));
      saveUnsyncedChanges();
      return { failed, error };
    }).catch(error => ({ failed: batch, error }));

    // ── 3. 動畫：畫面上看得到的橫條由上往下一條條翻；看不到的直接換 ──
    const list = document.getElementById('rc-student-list');
    const targetIds = new Set(targets.map(s => s.id));
    const rows = [...(list ? list.querySelectorAll('.student-row:not(.empty-bed)') : [])];
    const vh = window.innerHeight || 800;
    const reduce = window.sfReduceMotion && window.sfReduceMotion();
    list && list.classList.add('la-running');
    const flips = [];
    let n = 0;
    for (const row of rows) {
      const willChange = targetIds.has(row.dataset.pid);
      const r = row.getBoundingClientRect();
      const visible = r.bottom > 0 && r.top < vh && r.height > 0;
      if (reduce || !visible) { if (willChange) paintRow(row, true); continue; }
      const delay = n++ * STAGGER_MS;
      flips.push(flipRow(row, delay, () => {
        if (willChange) { paintRow(row, true); playClickSound('roll_leave'); }
      }));
    }
    await Promise.all(flips);
    list && list.classList.remove('la-running');
    updateRollCallStats();
    haptic('medium');

    const { failed, error } = await sending;
    running = false;
    const failedIds = new Set(failed.map(c => c.pageId));
    for (const s of targets) showSyncDot(s.id, failedIds.has(s.id) ? 'err' : 'ok');
    if (failed.length) {
      console.warn('leave-all sync failed:', error && error.message);
      showToast(`已改成請假，但有 ${failed.length} 筆還沒同步，網路恢復後會自動重送`, 'error');
    } else {
      showToast(`打烊囉！${targets.length} 位已全部改成請假`, 'success');
    }
  }

  window.leaveAllInSquad = leaveAllInSquad;
})();
