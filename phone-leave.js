// 電話請假紀錄頁：選一天，看那天誰打電話來請假 (來電號碼、本人還是代打、請哪幾天、誰接的)
// 資料一次抓一個月 (後端 ?from=&to= 依建立時間篩)，前端再依本機日期分到每一天。
(function () {
  const pad = n => String(n).padStart(2, '0');
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const monthCache = new Map(); // 'YYYY-MM' → { records, loading, error }
  let day = '';
  let calendarMonth = '';       // 行事曆正在看的月份，可以跟 day 不同

  const todayISO = () => (typeof localTodayISO === 'function' ? localTodayISO() : new Date().toISOString().slice(0, 10));
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const parseDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 建立時間 (UTC) → 本機的 YYYY-MM-DD / HH:MM
  function localParts(value) {
    const d = new Date(value);
    if (!value || isNaN(d.getTime())) return null;
    return { day: toISO(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }

  function loadMonth(month, force) {
    const hit = monthCache.get(month);
    if (hit && !force) {
      if (hit.loading || hit.records) return;
      // 抓取失敗：30 秒內不自動重抓，避免每次 render 都再打一次 API；使用者按重試 (force) 才立刻重抓
      if (hit.error && hit.retryAt && Date.now() < hit.retryAt) return;
    }
    const entry = { records: hit && hit.records, loading: true, error: '', retryAt: 0 };
    monthCache.set(month, entry);
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const url = `${CONFIG.WORKER_URL}/api/leave-records?from=${month}-01&to=${month}-${pad(last)}`;
    fetch(url)
      .then(res => { if (!res.ok) throw new Error('API 回應錯誤 ' + res.status); return res.json(); })
      .then(data => { entry.records = Array.isArray(data) ? data : []; })
      .catch(err => { entry.error = err.message || String(err); entry.retryAt = Date.now() + 30000; })
      .finally(() => { entry.loading = false; if (currentPage === 'leave-records') render(); });
  }

  function recordsOfMonth(month) {
    const entry = monthCache.get(month);
    return (entry && entry.records) || [];
  }

  function recordsOfDay(iso) {
    return recordsOfMonth(iso.slice(0, 7))
      .map(r => ({ r, at: localParts(r.createdAt) }))
      .filter(x => x.at && x.at.day === iso)
      .sort((a, b) => b.at.time.localeCompare(a.at.time));
  }

  function renderHeader() {
    const d = parseDay(day);
    const label = `${d.getMonth() + 1} 月 ${d.getDate()} 日 (${WEEK[d.getDay()]})${day === todayISO() ? ' ・ 今天' : ''}`;
    const labelEl = document.getElementById('pl-date-label');
    if (labelEl) labelEl.textContent = label;
    const input = document.getElementById('pl-date');
    if (input && input.value !== day) input.value = day;
    const sub = document.getElementById('pl-subtitle');
    if (sub) sub.textContent = `${d.getFullYear()} 年`;
  }

  function renderCalendar() {
    const box = document.getElementById('pl-calendar');
    if (!box) return;
    const [y, m] = calendarMonth.split('-').map(Number);
    const counts = {};
    for (const r of recordsOfMonth(calendarMonth)) {
      const at = localParts(r.createdAt);
      if (at) counts[at.day] = (counts[at.day] || 0) + 1;
    }
    const entry = monthCache.get(calendarMonth);
    const firstWeekday = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const today = todayISO();
    let cells = '';
    for (let i = 0; i < firstWeekday; i++) cells += '<span class="pl-cal-blank"></span>';
    for (let i = 1; i <= days; i++) {
      const iso = `${calendarMonth}-${pad(i)}`;
      const n = counts[iso] || 0;
      const cls = ['pl-cal-day', iso === day ? 'is-selected' : '', iso === today ? 'is-today' : '', n ? 'has-calls' : ''].join(' ');
      cells += `<button type="button" class="${cls}" onclick="phoneLeaveSetDay('${iso}')" aria-label="${m} 月 ${i} 日，${n} 通電話"${iso === day ? ' aria-current="date"' : ''}>
        <b>${i}</b>${n ? `<small>${n}</small>` : ''}
      </button>`;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const status = entry && entry.loading && !entry.records ? '讀取中…' : entry && entry.error ? '讀取失敗' : `本月 ${total} 通`;
    box.innerHTML = `<section class="pl-cal">
      <div class="pl-cal-head">
        <button type="button" class="pl-cal-nav" onclick="phoneLeaveShiftMonth(-1)" aria-label="上個月">‹</button>
        <strong>${y} 年 ${m} 月</strong>
        <span>${status}</span>
        <button type="button" class="pl-cal-nav" onclick="phoneLeaveShiftMonth(1)" aria-label="下個月">›</button>
      </div>
      <div class="pl-cal-week">${WEEK.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="pl-cal-grid">${cells}</div>
    </section>`;
  }

  function renderList() {
    const box = document.getElementById('leave-records-list');
    if (!box || !day) return;
    const entry = monthCache.get(day.slice(0, 7));
    if (!entry || (entry.loading && !entry.records)) {
      box.innerHTML = '<div class="ll-hint">正在讀取電話請假紀錄…</div>';
      return;
    }
    if (entry.error && !entry.records) {
      box.innerHTML = `<div class="ll-hint ll-hint-error"><button type="button" class="ll-change-btn" onclick="phoneLeaveReload()" title="${esc(entry.error)}">載入失敗，點此重試</button></div>`;
      return;
    }
    const q = (document.getElementById('pl-filter')?.value || '').trim().toLowerCase();
    const all = recordsOfDay(day);
    const list = q ? all.filter(({ r }) => [r.name, r.roomBed, r.callerPhone, r.callerNote, r.handler].join(' ').toLowerCase().includes(q)) : all;
    const d = parseDay(day);
    const title = `${d.getMonth() + 1}/${d.getDate()} 來電`;
    if (!all.length) {
      box.innerHTML = `<section class="summary-detail-group">
        <div class="summary-detail-group-title"><h2>${title}</h2><span>0 通</span></div>
        <ul><li class="summary-detail-row"><div class="summary-detail-row-main"><strong>這天沒有人打電話來請假</strong><span>有圓點數字的日子才有紀錄</span></div></li></ul>
      </section>`;
      return;
    }
    const rows = list.map(({ r, at }) => {
      const phone = r.callerPhone
        ? `<a class="pl-phone" href="tel:${esc(r.callerPhone.replace(/[^\d+]/g, ''))}">${esc(r.callerPhone)}</a>`
        : '<span class="pl-muted">未記錄號碼</span>';
      const range = r.dateStart && r.dateEnd && r.dateStart !== r.dateEnd ? `${r.dateStart} ～ ${r.dateEnd}` : (r.dateStart || '');
      return `<li class="pl-row">
        <div class="pl-time">${at.time}</div>
        <div class="pl-main">
          <strong>${esc(r.name || '(未填姓名)')}<span>${esc(r.roomBed || '')}</span></strong>
          <div class="pl-line">${phone}${r.callerNote ? `<span class="pl-note">${esc(r.callerNote)}</span>` : ''}</div>
          <div class="pl-meta">請假 ${esc(range)} ・ 處理人 ${esc(r.handler || '未填寫')}</div>
        </div>
      </li>`;
    }).join('');
    box.innerHTML = `<section class="summary-detail-group">
      <div class="summary-detail-group-title"><h2>${title}</h2><span>${q ? `${list.length} / ` : ''}${all.length} 通</span></div>
      <ul>${rows || '<li class="summary-detail-row"><div class="summary-detail-row-main"><strong>這天沒有符合搜尋的紀錄</strong></div></li>'}</ul>
    </section>`;
  }

  function render() {
    if (!day) day = todayISO();
    if (!calendarMonth) calendarMonth = day.slice(0, 7);
    loadMonth(day.slice(0, 7));
    loadMonth(calendarMonth);
    renderHeader();
    renderCalendar();
    renderList();
  }

  function setDay(iso) {
    day = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : todayISO();
    calendarMonth = day.slice(0, 7);
    render();
  }

  window.openPhoneLeaveRecords = function () {
    day = todayISO();
    calendarMonth = day.slice(0, 7);
    const filter = document.getElementById('pl-filter');
    if (filter) filter.value = '';
    monthCache.delete(calendarMonth); // 進頁面時本月一定重抓，才看得到剛登記的
    navigateTo('leave-records');
  };
  window.phoneLeaveRender = render;
  window.phoneLeaveRenderList = renderList;
  window.phoneLeaveSetDay = setDay;
  window.phoneLeaveShiftDay = delta => { const d = parseDay(day || todayISO()); d.setDate(d.getDate() + delta); setDay(toISO(d)); };
  window.phoneLeaveShiftMonth = delta => {
    const [y, m] = calendarMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    calendarMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    loadMonth(calendarMonth);
    renderCalendar();
  };
  window.phoneLeaveReload = () => { monthCache.clear(); render(); };
  window.phoneLeaveInvalidate = () => monthCache.clear();
  window.renderLeaveRecordsList = render; // 舊的呼叫點相容
})();
