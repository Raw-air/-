// 首頁左上角漢堡捷徑選單：直接呼叫「工具與選項」頁裡同一批功能
(function () {
  const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ITEMS = [
    { t: '回報空床', s: '選房間與床位，更新總表', run: () => openEmptyBedModal(), i: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>' },
    { t: '住宿生換床位', s: '調整房間與床位配置', run: () => openSwapBedModal(), i: '<path d="M21 17H3"/><path d="m6 10-3 3 3 3"/><path d="M3 7h18"/><path d="m18 20 3-3-3-3"/>' },
    { t: '新增住宿生', s: '填寫新生資料送審', run: () => openAddResidentModal(), i: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
    { t: '櫃台請假填寫', s: '電話通報請假', run: () => openCounterLeaveModal(), i: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' },
    { t: '請假狀況查詢', s: '查單一住宿生請假日', run: () => openLeaveLookup(), i: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="11.5" cy="16" r="2.5"/><path d="m15 19.5-1.7-1.7"/>' },
    { t: '通知報修', s: '回報設施損壞', run: () => openRepairForm(), i: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
    { t: '資料微動查詢', s: '動態資料卡搜尋住宿生', run: () => { navigateTo('student-files'); initStudentFiles(); }, i: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>' },
    { t: '住宿生檔案管理', s: 'Excel 表格批次修改', run: () => navigateTo('resident-management'), i: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/>' },
  ];

  const toggle = document.getElementById('qm-toggle');
  if (!toggle) return;
  const panel = document.createElement('nav');
  panel.id = 'qm-panel';
  panel.className = 'qm-panel';
  panel.setAttribute('aria-label', '工具捷徑');
  const scrim = document.createElement('div');
  scrim.className = 'qm-scrim';

  const btn = (it, idx, extra = '') =>
    `<button type="button" class="qm-item ${extra}" data-idx="${idx}" style="--i:${idx}"><span class="qm-ico">${ICON(it.i)}</span><span class="qm-txt"><b>${it.t}</b>${it.s ? `<small>${it.s}</small>` : ''}</span></button>`;
  const all = { t: '開啟完整「工具與選項」 ›', s: '', run: () => navigateTo('tools'), i: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' };
  panel.innerHTML = `<div class="qm-head"><b>快速捷徑</b><span>TOOLS</span></div>`
    + ITEMS.map((it, n) => btn(it, n)).join('')
    + `<div class="qm-sep"></div>` + btn(all, ITEMS.length, 'qm-all');
  document.body.append(scrim, panel);

  const isOpen = () => panel.classList.contains('open');
  function setOpen(open) {
    panel.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      // 首頁內容是置中欄位，面板要對齊按鈕本身，而不是視窗左緣
      const r = toggle.getBoundingClientRect();
      const w = panel.offsetWidth;
      panel.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
      panel.style.top = (r.bottom + 10) + 'px';
      panel.style.maxHeight = `calc(100dvh - ${Math.round(r.bottom + 110)}px)`;
      panel.scrollTop = 0;
    }
  }
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen()); });
  scrim.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); } });
  window.addEventListener('app:navigate', () => setOpen(false));
  panel.addEventListener('click', (e) => {
    const item = e.target.closest('.qm-item');
    if (!item) return;
    const idx = Number(item.dataset.idx);
    const it = idx === ITEMS.length ? all : ITEMS[idx];
    setOpen(false);
    try { it.run(); } catch (err) { console.error(err); window.showToast?.('開啟失敗：' + err.message, 'error'); }
  });
})();
