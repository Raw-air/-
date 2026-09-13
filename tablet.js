// 平板模式：設定 → 個人化設定 → 平板模式。開啟後 <html> 加上 .tablet-mode，
// 左側固定側欄取代底部導覽列 (樣式在 tablet.css)。開關狀態走 prefs 層的 tablet_mode。
(function () {
  const root = document.documentElement;
  const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const NAV = [
    { page: 'home', t: '點名', s: '選擇中隊開始點名', i: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { page: 'summary', t: '每日總表', s: '床位、請假、各中隊', i: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>' },
    { page: 'history', t: '歷史資料', s: '月曆查看過去紀錄', i: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>' },
    { page: 'settings', t: '系統設定', s: '個人化、匯出、參數', i: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>' },
  ];
  const TOOLS = [
    { t: '回報空床', c: 'var(--blue)', run: () => openEmptyBedModal(), i: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>' },
    { t: '換床位', c: '#a78bfa', run: () => openSwapBedModal(), i: '<path d="M21 17H3"/><path d="m6 10-3 3 3 3"/><path d="M3 7h18"/><path d="m18 20 3-3-3-3"/>' },
    { t: '新增住宿生', c: 'var(--blue)', run: () => openAddResidentModal(), i: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
    { t: '櫃台請假', c: 'var(--green)', run: () => openCounterLeaveModal(), i: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' },
    { t: '請假查詢', c: 'var(--yellow)', run: () => openLeaveLookup(), i: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="11.5" cy="16" r="2.5"/><path d="m15 19.5-1.7-1.7"/>' },
    { t: '通知報修', c: 'var(--purple)', run: () => openRepairForm(), i: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
    { t: '資料微動', c: '#6366f1', run: () => { navigateTo('student-files'); initStudentFiles(); }, i: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>' },
    { t: '檔案管理', c: '#34c759', run: () => navigateTo('resident-management'), i: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/>' },
  ];

  let rail = null, clockTimer = 0;

  function build() {
    rail = document.createElement('aside');
    rail.className = 'tb-rail';
    rail.setAttribute('aria-label', '平板側欄');
    rail.innerHTML =
      `<div class="tb-brand"><img src="icon-192.png" alt=""><div><b>碧苑宿舍</b><small>點名管理系統</small></div></div>`
      + `<div class="tb-clock"><b class="tb-time">--:--</b><span class="tb-date"></span></div>`
      + `<div class="tb-sec">主要功能</div>`
      + `<nav class="tb-nav">${NAV.map(n => `<button type="button" data-page="${n.page}" title="${n.t}">${ICON(n.i)}<span><b>${n.t}</b><small>${n.s}</small></span></button>`).join('')}</nav>`
      + `<div class="tb-sec">快速工具</div>`
      + `<div class="tb-tools">${TOOLS.map((it, n) => `<button type="button" data-idx="${n}" title="${it.t}" style="--tb-c:${it.c}">${ICON(it.i)}${it.t}</button>`).join('')}</div>`
      + `<div class="tb-foot"><span>平板模式</span><button type="button" class="tb-off" title="關閉平板模式">關閉</button></div>`;
    rail.addEventListener('click', (e) => {
      const nav = e.target.closest('.tb-nav button');
      if (nav) { window.haptic?.('light'); navigateTo(nav.dataset.page); return; }
      const tool = e.target.closest('.tb-tools button');
      if (tool) {
        try { TOOLS[Number(tool.dataset.idx)].run(); }
        catch (err) { console.error(err); window.showToast?.('開啟失敗：' + err.message, 'error'); }
        return;
      }
      if (e.target.closest('.tb-off')) setTabletMode(false, true);
    });
    document.body.appendChild(rail);
  }

  function syncActive() {
    if (!rail) return;
    let tab = 'home';
    try { tab = navTabFor(currentPage); } catch (_) {}
    rail.querySelectorAll('.tb-nav button').forEach(b => b.classList.toggle('active', b.dataset.page === tab));
  }

  function tick() {
    if (!rail) return;
    const d = new Date();
    rail.querySelector('.tb-time').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    rail.querySelector('.tb-date').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${'日一二三四五六'[d.getDay()]}`;
  }

  function apply(on) {
    root.classList.toggle('tablet-mode', on);
    const toggle = document.getElementById('setting-tablet');
    if (toggle) toggle.checked = on;
    if (on) {
      if (!rail) build();
      rail.hidden = false;
      syncActive();
      tick();
      clearInterval(clockTimer);
      clockTimer = setInterval(tick, 15000);
    } else {
      if (rail) rail.hidden = true;
      clearInterval(clockTimer);
    }
    // 底部導覽列鏡片、資料夾輪播都靠量寬度排版，版面換了要讓它們重量一次
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function setTabletMode(on, animate) {
    if (window.tbTransform?.running) { const t = document.getElementById('setting-tablet'); if (t) t.checked = !on; return; }
    if (typeof setPref === 'function') setPref('tablet_mode', on);
    else try { localStorage.setItem('tablet_mode', String(on)); } catch (_) {}
    const reduce = window.sfReduceMotion?.();
    // 變形金剛式的拆解 → 掃描 → 組裝動畫在 tablet-transform.js；沒載到或減少動態就直接切
    if (animate && !reduce && window.tbTransform) window.tbTransform.run(on, apply);
    else if (animate && !reduce && document.startViewTransition) document.startViewTransition(() => apply(on));
    else apply(on);
    window.showToast?.(on ? '已開啟平板模式' : '已關閉平板模式', 'success');
  }

  window.toggleTabletMode = (el) => setTabletMode(el.checked, true);
  window.addEventListener('app:navigate', syncActive);

  let initial = false;
  try { initial = localStorage.getItem('tablet_mode') === 'true'; } catch (_) {}
  apply(initial);
})();
