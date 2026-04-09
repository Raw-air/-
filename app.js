/**
 * 壁苑宿舍點名系統 - 主應用邏輯
 * 單頁應用（SPA），包含所有頁面的狀態管理與渲染
 */

import { CONFIG, formatDate, formatDateChinese, calcOccupancyRate } from './config.js';
import api from './api.js';
import { parseNotionCsv, validateImport, extractHistoricalAttendance, convertDateLabel } from './import.js';
import { exportToExcel, exportDailySummaryText } from './export.js';

// ─── 全域狀態 ──────────────────────────────────────────────────────────────────

const State = {
  currentPage: 'home',
  currentSquad: null,      // { id, label, color, ... }
  currentDate: formatDate(),
  roster: [],              // 當前中隊的花名冊
  attendance: null,        // { id?, submitted, records, summary }
  summaryData: [],         // 今日各中隊總表
  isOnline: navigator.onLine,
  autoSyncTimer: null,
  lastSyncTime: null,
  isSyncing: false,
  hasUnsavedChanges: false,
  notionConfig: {},        // 從 Notion 讀取的設定
};

// 修改出席記錄的快取（未提交的本地變更）
let localChanges = {};

// 暫存完整的 CSV 解析結果（包含出席歷史，供歷史匯入用）
let parsedCsvData = null;

// ─── 初始化 ────────────────────────────────────────────────────────────────────

async function init() {
  // 網路狀態監聽
  window.addEventListener('online', () => {
    State.isOnline = true;
    showToast('已恢復連線', 'success');
    startAutoSync();
  });
  window.addEventListener('offline', () => {
    State.isOnline = false;
    showToast('已離線，資料將在恢復連線後同步', 'warning');
    stopAutoSync();
  });

  // 設定頁面標題
  document.title = `${CONFIG.DORM_NAME}點名系統`;
  document.getElementById('dorm-name').textContent = CONFIG.DORM_NAME;

  // 路由
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function handleRoute() {
  const hash = window.location.hash || '#home';
  const [page, ...params] = hash.substring(1).split('/');

  // 更新底部導航
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // 顯示對應頁面
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });

  State.currentPage = page;

  // 頁面初始化
  const handlers = {
    home: renderHomePage,
    rollcall: () => renderRollCallPage(params[0]),
    summary: renderSummaryPage,
    history: renderHistoryPage,
    settings: renderSettingsPage,
  };

  if (handlers[page]) handlers[page]();
}

function navigate(page, params = '') {
  window.location.hash = `#${page}${params ? '/' + params : ''}`;
}

// ─── 首頁：選擇中隊 ───────────────────────────────────────────────────────────

function renderHomePage() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  document.getElementById('home-date').textContent = dateStr;

  const grid = document.getElementById('squad-grid');
  grid.innerHTML = '';

  for (const squad of CONFIG.SQUADS) {
    const card = document.createElement('div');
    card.className = 'squad-card';
    card.style.setProperty('--squad-color', squad.color);
    card.innerHTML = `
      <div class="squad-card-icon">${squad.emoji}</div>
      <div class="squad-card-label">${squad.label}</div>
      <div class="squad-card-sub">${squad.floor}樓 · ${squad.parity === 'odd' ? '單數房' : '雙數房'}</div>
    `;
    card.addEventListener('click', () => showPinDialog(squad));
    grid.appendChild(card);
  }
}

// ─── PIN 驗證對話框 ────────────────────────────────────────────────────────────

function showPinDialog(squad) {
  const dialog = document.getElementById('pin-dialog');
  const title = document.getElementById('pin-dialog-title');
  title.textContent = `${squad.label} 中隊點名`;
  title.style.color = squad.color;

  const input = document.getElementById('pin-input');
  input.value = '';

  dialog.classList.add('visible');
  setTimeout(() => input.focus(), 300);

  // 確認按鈕
  const confirmBtn = document.getElementById('pin-confirm');
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  newConfirmBtn.addEventListener('click', async () => {
    const pin = input.value;
    await verifyPin(pin, squad, dialog);
  });

  // Enter 鍵確認
  input.onkeydown = async (e) => {
    if (e.key === 'Enter') await verifyPin(input.value, squad, dialog);
  };

  // 取消
  document.getElementById('pin-cancel').onclick = () => {
    dialog.classList.remove('visible');
  };
}

async function verifyPin(pin, squad, dialog) {
  const storedPin = State.notionConfig[`pin_${squad.id}`] || '0000';
  const adminPin = State.notionConfig['pin_admin'] || CONFIG.DEFAULT_ADMIN_PIN;

  if (pin === storedPin || pin === adminPin) {
    dialog.classList.remove('visible');
    State.currentSquad = squad;
    navigate('rollcall', squad.id);
  } else {
    const input = document.getElementById('pin-input');
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 500);
    showToast('PIN 碼錯誤', 'error');
  }
}

// ─── 點名頁面 ──────────────────────────────────────────────────────────────────

async function renderRollCallPage(squadId) {
  if (!squadId || !State.currentSquad) {
    // 如果沒有驗證過直接進來，回首頁
    navigate('home');
    return;
  }

  const squad = State.currentSquad;

  // 設定標頭
  document.getElementById('rc-squad-name').textContent = squad.label;
  document.getElementById('rc-date').textContent = formatDateChinese(State.currentDate);

  // 顯示載入狀態
  document.getElementById('rc-student-list').innerHTML = renderSkeletonList();

  // 並行載入花名冊和今日點名記錄
  const [roster, savedAttendance] = await Promise.all([
    loadRoster(squad.id),
    loadAttendance(squad.id, State.currentDate),
  ]);

  State.roster = roster;
  State.attendance = savedAttendance || { id: null, submitted: false, records: [], summary: {} };

  // 合併花名冊 + 已儲存的出席狀態
  initLocalChanges(roster, State.attendance, squad.id);

  // 渲染學生清單
  renderStudentList();
  updateSummaryBar();

  // 啟動自動同步
  startAutoSync();
}

function renderSkeletonList() {
  return Array(8).fill(0).map(() => `
    <div class="student-row skeleton">
      <div class="sk-avatar"></div>
      <div class="sk-content">
        <div class="sk-line wide"></div>
        <div class="sk-line narrow"></div>
      </div>
      <div class="sk-badge"></div>
    </div>
  `).join('');
}

async function loadRoster(squadId) {
  try {
    const cached = localStorage.getItem(`roster_${squadId}_${CONFIG.SEMESTER}`);
    if (cached) {
      // 後台刷新快取
      refreshRosterCache(squadId);
      return JSON.parse(cached);
    }
    return await fetchAndCacheRoster(squadId);
  } catch (e) {
    showToast('載入花名冊失敗：' + e.message, 'error');
    return [];
  }
}

async function fetchAndCacheRoster(squadId) {
  const data = await api.getRoster(squadId, CONFIG.SEMESTER);
  localStorage.setItem(`roster_${squadId}_${CONFIG.SEMESTER}`, JSON.stringify(data));
  return data;
}

async function refreshRosterCache(squadId) {
  try {
    await fetchAndCacheRoster(squadId);
  } catch {
    // 靜默失敗，已有快取版本
  }
}

async function loadAttendance(squadId, date) {
  try {
    return await api.getAttendance(squadId, date);
  } catch (e) {
    console.warn('載入點名記錄失敗，使用空白記錄:', e.message);
    return null;
  }
}

// ─── 本地出席狀態管理 ─────────────────────────────────────────────────────────

function initLocalChanges(roster, saved, squadId) {
  localChanges = {};

  // 先以花名冊為基底（預設全部在場）
  for (const student of roster) {
    const key = `${student.room}_${student.bed}`;
    localChanges[key] = {
      room: student.room,
      bed: student.bed,
      name: student.name,
      status: student.isEmpty ? 'empty' : 'present',
    };
  }

  // 覆蓋已儲存的出席資料
  if (saved && saved.records) {
    for (const record of saved.records) {
      const key = `${record.room}_${record.bed}`;
      if (localChanges[key]) {
        localChanges[key].status = record.status;
      }
    }
  }
}

function toggleStatus(room, bed) {
  const key = `${room}_${bed}`;
  const current = localChanges[key];
  if (!current || current.status === 'empty') return;

  const cycle = { present: 'leave', leave: 'absent', absent: 'present' };
  current.status = cycle[current.status] || 'present';

  State.hasUnsavedChanges = true;
  updateStudentRow(room, bed);
  updateSummaryBar();
  updateSyncIndicator();
}

// ─── 渲染學生清單 ──────────────────────────────────────────────────────────────

function renderStudentList() {
  const list = document.getElementById('rc-student-list');
  const roster = State.roster;

  if (roster.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>此中隊尚無學生資料</p>
        <p>請前往設定頁面導入花名冊</p>
      </div>
    `;
    return;
  }

  // 依房號分組
  const byRoom = {};
  for (const student of roster) {
    if (!byRoom[student.room]) byRoom[student.room] = [];
    byRoom[student.room].push(student);
  }

  let html = '';
  for (const [room, students] of Object.entries(byRoom)) {
    html += `<div class="room-divider"><span>${room}</span></div>`;
    for (const student of students) {
      html += renderStudentRow(student);
    }
  }

  list.innerHTML = html;

  // 綁定點擊事件
  list.querySelectorAll('.student-row:not(.is-empty)').forEach(row => {
    row.addEventListener('click', () => {
      toggleStatus(row.dataset.room, row.dataset.bed);
    });
  });
}

function renderStudentRow(student) {
  const key = `${student.room}_${student.bed}`;
  const record = localChanges[key] || { status: student.isEmpty ? 'empty' : 'present' };
  const statusCfg = CONFIG.STATUSES[record.status];
  const isEmpty = student.isEmpty || record.status === 'empty';

  return `
    <div class="student-row ${isEmpty ? 'is-empty' : ''} status-${record.status}"
         data-room="${student.room}" data-bed="${student.bed}"
         id="row-${student.room}-${student.bed}">
      <div class="student-bed-badge">${student.bed}</div>
      <div class="student-info">
        <div class="student-name">${isEmpty ? '（空床）' : (student.name || '—')}</div>
        <div class="student-meta">${student.class || ''}</div>
      </div>
      <div class="student-status" style="background:${statusCfg.bg}; color:${statusCfg.color}">
        <span class="status-symbol">${statusCfg.symbol}</span>
        <span class="status-label">${statusCfg.label}</span>
      </div>
    </div>
  `;
}

function updateStudentRow(room, bed) {
  const el = document.getElementById(`row-${room}-${bed}`);
  if (!el) return;

  const key = `${room}_${bed}`;
  const record = localChanges[key];
  if (!record) return;

  const statusCfg = CONFIG.STATUSES[record.status];

  // 更新 class
  el.className = `student-row status-${record.status}`;

  // 更新狀態徽章
  const badge = el.querySelector('.student-status');
  if (badge) {
    badge.style.background = statusCfg.bg;
    badge.style.color = statusCfg.color;
    badge.querySelector('.status-symbol').textContent = statusCfg.symbol;
    badge.querySelector('.status-label').textContent = statusCfg.label;
  }

  // 觸感反饋（如果支援）
  if (navigator.vibrate) navigator.vibrate(30);
}

// ─── 統計列 ───────────────────────────────────────────────────────────────────

function calcSummary() {
  let should = 0, present = 0, leave = 0, absent = 0, empty = 0;

  for (const record of Object.values(localChanges)) {
    if (record.status === 'empty') { empty++; continue; }
    should++;
    if (record.status === 'present') present++;
    else if (record.status === 'leave') leave++;
    else if (record.status === 'absent') absent++;
  }

  return { should, present, leave, absent, empty };
}

function updateSummaryBar() {
  const s = calcSummary();
  document.getElementById('rc-stat-should').textContent = s.should;
  document.getElementById('rc-stat-present').textContent = s.present;
  document.getElementById('rc-stat-leave').textContent = s.leave;
  document.getElementById('rc-stat-absent').textContent = s.absent;
}

// ─── 同步與提交 ───────────────────────────────────────────────────────────────

function startAutoSync() {
  stopAutoSync();
  State.autoSyncTimer = setInterval(autoSync, CONFIG.AUTO_SYNC_INTERVAL);
}

function stopAutoSync() {
  if (State.autoSyncTimer) {
    clearInterval(State.autoSyncTimer);
    State.autoSyncTimer = null;
  }
}

async function autoSync() {
  if (!State.hasUnsavedChanges || !State.isOnline || State.isSyncing) return;
  if (State.currentPage !== 'rollcall') return;

  try {
    await syncAttendance(false);
  } catch (e) {
    console.warn('自動同步失敗:', e.message);
  }
}

async function syncAttendance(submit = false) {
  if (State.isSyncing) return;
  State.isSyncing = true;
  updateSyncIndicator('syncing');

  try {
    const summary = calcSummary();
    const records = Object.values(localChanges);

    // 計算當日外籍生人數快照（從本地快取取，確保歷史資料不受日後設定變更影響）
    const squadId = State.currentSquad.id;
    const cachedRoster = localStorage.getItem(`roster_${squadId}_${CONFIG.SEMESTER}`);
    const rosterArr = cachedRoster ? JSON.parse(cachedRoster) : (State.roster || []);
    const foreignCount = rosterArr.filter(s => s.isForeign && !s.isEmpty).length;

    const payload = {
      id: State.attendance?.id,
      squad: State.currentSquad.id,
      date: State.currentDate,
      submitted: submit,
      summary,
      records,
      foreignCount,
    };

    const result = await api.upsertAttendance(payload);

    // 更新本地狀態中的 ID（如果是新建立的）
    if (!State.attendance.id && result.id) {
      State.attendance.id = result.id;
    }
    State.attendance.submitted = submit;

    State.hasUnsavedChanges = false;
    State.lastSyncTime = new Date();
    updateSyncIndicator('success');

    if (submit) {
      showSubmitSuccess(summary);
    }
  } catch (e) {
    updateSyncIndicator('error');
    throw e;
  } finally {
    State.isSyncing = false;
  }
}

function updateSyncIndicator(status = null) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;

  if (status === 'syncing') {
    el.innerHTML = `<span class="sync-dot syncing"></span> 同步中…`;
  } else if (status === 'success') {
    const time = State.lastSyncTime?.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<span class="sync-dot success"></span> 已儲存 ${time}`;
  } else if (status === 'error') {
    el.innerHTML = `<span class="sync-dot error"></span> 同步失敗`;
  } else if (State.hasUnsavedChanges) {
    el.innerHTML = `<span class="sync-dot pending"></span> 有未儲存變更`;
  } else {
    const time = State.lastSyncTime?.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = time ? `<span class="sync-dot success"></span> 已儲存 ${time}` : '';
  }
}

function showSubmitSuccess(summary) {
  const modal = document.getElementById('submit-success-modal');
  document.getElementById('submit-should').textContent = summary.should;
  document.getElementById('submit-present').textContent = summary.present;
  document.getElementById('submit-leave').textContent = summary.leave;
  document.getElementById('submit-absent').textContent = summary.absent;
  modal.classList.add('visible');

  setTimeout(() => modal.classList.remove('visible'), 4000);
}

// ─── 總表頁面 ──────────────────────────────────────────────────────────────────

async function renderSummaryPage() {
  const dateDisplay = document.getElementById('summary-date');
  dateDisplay.textContent = formatDateChinese(State.currentDate);

  // 載入今日各中隊數據
  const loader = document.getElementById('summary-loader');
  if (loader) loader.classList.add('visible');

  try {
    const summaryData = await api.getDailySummary(State.currentDate);
    State.summaryData = summaryData;
    renderSummaryContent(summaryData);
  } catch (e) {
    showToast('載入總表失敗：' + e.message, 'error');
  } finally {
    if (loader) loader.classList.remove('visible');
  }
}

function renderSummaryContent(summaryData) {
  // 各中隊狀態卡片
  const squadGrid = document.getElementById('summary-squad-grid');
  let squadHtml = '';

  for (const squad of CONFIG.SQUADS) {
    const data = summaryData.find(s => s.squad === squad.id);
    const isSubmitted = data?.submitted;
    const hasDraft = data && !isSubmitted;

    const statusClass = isSubmitted ? 'submitted' : hasDraft ? 'draft' : 'empty';
    const statusText = isSubmitted ? '✅ 已提交' : hasDraft ? '🕐 草稿' : '❌ 未填';

    squadHtml += `
      <div class="squad-status-card ${statusClass}" style="--squad-color:${squad.color}">
        <div class="squad-status-header">
          <span class="squad-status-name">${squad.label}</span>
          <span class="squad-status-badge">${statusText}</span>
        </div>
        ${data ? `
          <div class="squad-status-stats">
            <span>應到 ${data.summary.should}</span>
            <span>實到 ${data.summary.present}</span>
            <span>請假 ${data.summary.leave}</span>
            <span>未請假 ${data.summary.absent}</span>
          </div>
        ` : '<div class="squad-status-empty">尚未點名</div>'}
      </div>
    `;
  }
  squadGrid.innerHTML = squadHtml;

  // 計算總表
  let totalShould = 0, totalPresent = 0, totalLeave = 0, totalAbsent = 0, totalEmpty = 0;
  for (const d of summaryData) {
    totalShould += d.summary.should || 0;
    totalPresent += d.summary.present || 0;
    totalLeave += d.summary.leave || 0;
    totalAbsent += d.summary.absent || 0;
    totalEmpty += d.summary.empty || 0;
  }

  // 總床數 = 住宿人數 + 空床（從當日實際資料算，不受目前設定影響）
  const totalBeds = totalShould + totalEmpty;
  const actualTotalBeds = totalBeds || CONFIG.TOTAL_BEDS;

  // 外籍生：從各中隊 foreignCount 欄位取（由匯入歷史時一併儲存）
  // 若無則從本地快取取（僅今日有效）
  const totalForeign = summaryData.reduce((sum, d) => sum + (d.foreignCount || 0), 0) ||
    CONFIG.SQUADS.flatMap(sq => {
      const cached = localStorage.getItem(`roster_${sq.id}_${CONFIG.SEMESTER}`);
      return cached ? JSON.parse(cached) : [];
    }).filter(s => s.isForeign && !s.isEmpty).length;

  const occupancyRate = Math.round((totalShould / actualTotalBeds) * 100 * 10) / 10;

  // 填入總表數字
  const fields = {
    'total-beds': actualTotalBeds,
    'total-empty': totalEmpty,
    'total-residents': totalShould,
    'total-foreign': totalForeign,
    'total-rate': `${occupancyRate}%`,
    'total-present': totalPresent,
    'total-leave': totalLeave,
    'total-absent': totalAbsent,
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // 更新複製按鈕的文字
  document.getElementById('copy-summary-btn').dataset.text = exportDailySummaryText(summaryData, State.currentDate, actualTotalBeds, totalForeign);
}

// ─── 歷史頁面 ──────────────────────────────────────────────────────────────────

function renderHistoryPage() {
  const today = new Date();
  document.getElementById('hist-month').textContent =
    today.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' });
  renderCalendar(today.getFullYear(), today.getMonth());
}

function renderCalendar(year, month) {
  const grid = document.getElementById('hist-calendar');
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = formatDate();

  const days = ['日', '一', '二', '三', '四', '五', '六'];
  let html = days.map(d => `<div class="cal-header">${d}</div>`).join('');

  // 填充空格
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === today;
    const isFuture = dateStr > today;

    html += `
      <div class="cal-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : 'past'}"
           data-date="${dateStr}" ${isFuture ? 'disabled' : ''}>
        ${d}
      </div>
    `;
  }

  grid.innerHTML = html;

  // 點擊日期
  grid.querySelectorAll('.cal-day.past, .cal-day.today').forEach(el => {
    el.addEventListener('click', () => loadHistoryDate(el.dataset.date));
  });
}

async function loadHistoryDate(date) {
  document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.cal-day[data-date="${date}"]`)?.classList.add('selected');

  const panel = document.getElementById('hist-detail');
  panel.innerHTML = `<div class="loading-spinner"></div>`;

  try {
    const summary = await api.getDailySummary(date);
    renderHistoryDetail(date, summary, panel);
  } catch (e) {
    panel.innerHTML = `<p class="error-text">載入失敗：${e.message}</p>`;
  }
}

function renderHistoryDetail(date, summaryData, panel) {
  let totalShould = 0, totalPresent = 0, totalLeave = 0, totalAbsent = 0, totalEmpty = 0;
  for (const d of summaryData) {
    totalShould += d.summary.should || 0;
    totalPresent += d.summary.present || 0;
    totalLeave += d.summary.leave || 0;
    totalAbsent += d.summary.absent || 0;
    totalEmpty += d.summary.empty || 0;
  }
  // 使用當日實際總床數（住宿+空床），不受目前設定影響
  const actualTotalBeds = (totalShould + totalEmpty) || CONFIG.TOTAL_BEDS;
  const occupancyRate = Math.round((totalShould / actualTotalBeds) * 100 * 10) / 10;

  panel.innerHTML = `
    <div class="hist-date-title">${formatDateChinese(date)}</div>
    <div class="hist-overview">
      <div class="hist-stat"><span>${totalShould}</span><label>住宿人數</label></div>
      <div class="hist-stat"><span>${occupancyRate}%</span><label>住宿率</label></div>
      <div class="hist-stat present"><span>${totalPresent}</span><label>實到</label></div>
      <div class="hist-stat leave"><span>${totalLeave}</span><label>請假</label></div>
      <div class="hist-stat absent"><span>${totalAbsent}</span><label>未請假</label></div>
    </div>
    <div class="hist-squad-list">
      ${CONFIG.SQUADS.map(sq => {
        const d = summaryData.find(s => s.squad === sq.id);
        if (!d) return `<div class="hist-squad-row empty"><span>${sq.label}</span><span>—</span></div>`;
        return `
          <div class="hist-squad-row" style="border-left:3px solid ${sq.color}">
            <span class="hist-squad-name">${sq.label}</span>
            <span class="hist-squad-stats">
              應到 ${d.summary.should} ·
              實到 ${d.summary.present} ·
              請假 ${d.summary.leave} ·
              未請假 ${d.summary.absent}
            </span>
            <span class="hist-status-badge ${d.submitted ? 'submitted' : 'draft'}">${d.submitted ? '✅' : '草稿'}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ─── 設定頁面 ──────────────────────────────────────────────────────────────────

async function renderSettingsPage() {
  // 載入 Notion 設定
  try {
    const config = await api.getConfig();
    State.notionConfig = config;
  } catch (e) {
    console.warn('無法載入 Notion 設定:', e.message);
  }

  // 填入當前學期
  const semEl = document.getElementById('settings-semester');
  if (semEl) semEl.textContent = CONFIG.SEMESTER;

  // 各中隊外籍生人數
  for (const squad of CONFIG.SQUADS) {
    const el = document.getElementById(`foreign-${squad.id}`);
    if (el) el.value = State.notionConfig[`foreign_${squad.id}`] || '0';
  }

  // 檢查未完成的匯入任務
  checkPendingImport();
}

// ─── 匯入花名冊（伺服器端匯入，支援中斷恢復）──────────────────────────────────

async function handleCsvImport(file) {
  try {
    const text = await file.text();
    const parsed = parseNotionCsv(text);
    const { warnings, info } = validateImport(parsed);

    // 暫存完整解析資料（包含出席歷史）
    parsedCsvData = parsed;

    const dateCount = parsed.dateColumns.length;
    const preview = document.getElementById('import-preview');
    preview.innerHTML = `
      <div class="import-info">
        <h3>🗂️ 匯入預覽</h3>
        <p>總床位：${info.totalBeds} | 有效學生：${info.totalStudents} | 空床：${info.emptyBeds}</p>
        ${dateCount > 0 ? `<p>📅 歷史點名日期：${dateCount} 天</p>` : ''}
        ${warnings.map(w => `<div class="import-warning">${w}</div>`).join('')}
        <div class="squad-breakdown">
          ${Object.entries(info.bySquad).map(([sq, data]) =>
            `<div class="squad-preview-item">
              <span>${sq}</span>
              <span>應到 ${data.students} / 空床 ${data.empty} / 外籍 ${data.foreign}</span>
            </div>`
          ).join('')}
        </div>
        ${dateCount > 0 ? `
          <div style="margin:12px 0;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;">
              <input type="checkbox" id="import-history-check" checked
                     style="width:18px;height:18px;accent-color:var(--primary);">
              同步歷史點名紀錄（${dateCount} 天）
            </label>
          </div>
        ` : ''}
        <button id="upload-import-btn" class="btn btn-primary" style="width:100%;">
          ⬆️ 上傳到伺服器（${info.totalBeds} 筆）
        </button>
        <p style="font-size:12px;color:var(--text-muted);text-align:center;margin-top:8px;">
          上傳後即使關閉頁面，資料也不會遺失
        </p>
      </div>
    `;

    document.getElementById('upload-import-btn').addEventListener('click', () => {
      uploadAndStartImport();
    });

  } catch (e) {
    showToast('CSV 解析失敗：' + e.message, 'error');
  }
}

async function uploadAndStartImport() {
  const uploadBtn = document.getElementById('upload-import-btn');
  const progressEl = document.getElementById('import-progress');

  if (!parsedCsvData) {
    showToast('沒有可上傳的資料，請重新選擇 CSV', 'error');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = '⬆️ 上傳中…';

  try {
    const result = await api.uploadImport(parsedCsvData.students, CONFIG.SEMESTER);

    uploadBtn.textContent = '✅ 已上傳到伺服器';

    progressEl.innerHTML = `
      <div style="margin-top:12px;">
        <p style="color:var(--green);margin-bottom:12px;">✅ 資料已安全儲存到伺服器（${result.preview.totalBeds} 筆）</p>
        <button id="start-import-btn" class="btn btn-success" style="width:100%;">
          🚀 開始匯入花名冊
        </button>
      </div>
    `;

    document.getElementById('start-import-btn').addEventListener('click', () => {
      executeServerImport(progressEl);
    });

  } catch (e) {
    uploadBtn.disabled = false;
    uploadBtn.textContent = '⬆️ 上傳到伺服器';
    showToast('上傳失敗：' + e.message, 'error');
  }
}

async function executeServerImport(progressEl) {
  progressEl.innerHTML = `
    <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
    <p id="progress-text">匯入中…</p>
  `;

  let retries = 0;
  const MAX_RETRIES = 3;

  while (true) {
    try {
      const result = await api.executeImportBatch();

      const pct = Math.round((result.done / result.total) * 100);
      document.getElementById('progress-fill').style.width = `${pct}%`;
      document.getElementById('progress-text').textContent =
        `匯入中 ${result.done}/${result.total}（新增 ${result.totalCreated || 0} / 更新 ${result.totalUpdated || 0}）`;

      retries = 0; // 成功就重置重試計數

      if (result.phase === 'done') {
        progressEl.innerHTML = `
          <div class="import-success">
            ✅ 花名冊匯入完成！共 ${result.total} 筆
            （新增 ${result.totalCreated || 0} / 更新 ${result.totalUpdated || 0}）
          </div>
        `;

        // 清除本地快取
        CONFIG.SQUADS.forEach(sq => {
          localStorage.removeItem(`roster_${sq.id}_${CONFIG.SEMESTER}`);
        });

        showToast('花名冊匯入完成！', 'success');

        // 匯入歷史紀錄
        const importHistory = document.getElementById('import-history-check')?.checked;
        if (importHistory && parsedCsvData && parsedCsvData.dateColumns.length > 0) {
          await importHistoricalRecords(progressEl);
        }

        break;
      }
    } catch (e) {
      retries++;
      if (retries >= MAX_RETRIES) {
        document.getElementById('progress-text').textContent = `⚠️ 匯入暫停：${e.message}`;
        progressEl.innerHTML += `
          <div style="margin-top:12px;">
            <p style="color:var(--amber);margin-bottom:8px;">匯入已暫停，可稍後繼續</p>
            <button class="btn btn-primary" style="width:100%;" onclick="location.reload()">
              重新整理頁面以繼續
            </button>
          </div>
        `;
        showToast('匯入暫停，可稍後在設定頁面繼續', 'warning');
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function importHistoricalRecords(progressEl) {
  if (!parsedCsvData) return;

  const { students, dateColumns } = parsedCsvData;
  const totalDates = dateColumns.length;
  if (totalDates === 0) return;

  const historicalData = extractHistoricalAttendance(parsedCsvData);

  progressEl.innerHTML += `
    <div style="margin-top:16px;">
      <h4 style="margin-bottom:8px;">📅 匯入歷史點名紀錄</h4>
      <div class="progress-bar"><div class="progress-fill" id="hist-progress-fill"></div></div>
      <p id="hist-progress-text">準備中…</p>
    </div>
  `;

  let done = 0;

  for (const dateCol of dateColumns) {
    const isoDate = convertDateLabel(dateCol.label, CONFIG.SEMESTER);
    if (!isoDate) { done++; continue; }

    const squadRecords = historicalData[dateCol.label];
    if (!squadRecords) { done++; continue; }

    // 計算每個中隊的統計
    const squads = {};
    for (const [squadId, records] of Object.entries(squadRecords)) {
      const summary = { should: records.length, present: 0, leave: 0, absent: 0, empty: 0 };
      for (const r of records) {
        if (r.status === 'present') summary.present++;
        else if (r.status === 'leave') summary.leave++;
        else if (r.status === 'absent') summary.absent++;
      }
      squads[squadId] = { summary, records };
    }

    // 空床統計
    for (const student of students) {
      if (!student.isEmpty) continue;
      if (squads[student.squad]) {
        squads[student.squad].summary.empty++;
      }
    }

    try {
      await api.importAttendanceHistory(isoDate, squads);
    } catch (e) {
      console.warn(`歷史紀錄匯入失敗 (${dateCol.label}):`, e.message);
    }

    done++;
    const pct = Math.round((done / totalDates) * 100);
    document.getElementById('hist-progress-fill').style.width = `${pct}%`;
    document.getElementById('hist-progress-text').textContent =
      `匯入歷史紀錄 ${done}/${totalDates}（${dateCol.label}）`;
  }

  document.getElementById('hist-progress-text').textContent =
    `✅ 歷史紀錄匯入完成！共 ${totalDates} 天`;
  showToast('歷史點名紀錄匯入完成！', 'success');
}

async function checkPendingImport() {
  try {
    const status = await api.getImportStatus();
    const container = document.getElementById('pending-import');
    if (!container) return;

    if (status.hasJob && status.phase !== 'done') {
      const pct = Math.round((status.done / status.total) * 100);
      container.innerHTML = `
        <div style="margin-top:16px;padding:16px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:12px;">
          <h4 style="margin-bottom:8px;">⏸️ 有未完成的匯入任務</h4>
          <p style="font-size:14px;">學期：${status.semester} · 進度：${status.done}/${status.total}（${pct}%）</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">
            上傳時間：${new Date(status.createdAt).toLocaleString('zh-TW')}
          </p>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <button id="resume-import-btn" class="btn btn-success" style="flex:1;">▶️ 繼續匯入</button>
            <button id="cancel-import-btn" class="btn btn-outline">取消</button>
          </div>
        </div>
      `;

      document.getElementById('resume-import-btn').addEventListener('click', () => {
        container.innerHTML = '';
        const progressEl = document.getElementById('import-progress');
        executeServerImport(progressEl);
      });

      document.getElementById('cancel-import-btn').addEventListener('click', () => {
        container.innerHTML = '';
        showToast('已取消，可重新上傳 CSV', 'info');
      });
    } else {
      container.innerHTML = '';
    }
  } catch (e) {
    console.warn('檢查匯入狀態失敗:', e.message);
  }
}

// ─── 匯出（整學期一鍵匯出，不需選日期）────────────────────────────────────────

async function handleExport() {
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = '⏳ 準備中…'; }
  showToast('正在準備匯出整學期資料…', 'info');

  try {
    // 取得整學期花名冊
    const allRoster = [];
    for (const sq of CONFIG.SQUADS) {
      const roster = await api.getRoster(sq.id, CONFIG.SEMESTER);
      allRoster.push(...roster);
    }

    if (exportBtn) exportBtn.textContent = '⏳ 載入點名記錄…';

    // 取得整學期所有已提交的點名記錄（不限日期範圍）
    const summaryRecords = await api.getSummaryRange('2024-01-01', formatDate(), false);

    if (exportBtn) exportBtn.textContent = '⏳ 載入詳細記錄…';

    // 補充每筆的個別學生狀態
    const detailedRecords = [];
    for (const record of summaryRecords) {
      try {
        const detail = await api.getAttendance(record.squad, record.date);
        if (detail) detailedRecords.push(detail);
      } catch { /* 忽略無詳細記錄的日期 */ }
    }

    await exportToExcel(allRoster, detailedRecords, { semester: CONFIG.SEMESTER });

    showToast('匯出完成！', 'success');
  } catch (e) {
    showToast('匯出失敗：' + e.message, 'error');
  } finally {
    if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = '⬇️ 下載 Excel（整學期）'; }
  }
}

// ─── 工具函式 ──────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── 事件綁定 ──────────────────────────────────────────────────────────────────

function bindEvents() {
  // 底部導航
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });

  // 提交 / 修改按鈕
  document.getElementById('submit-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('submit-btn');

    // 已提交狀態 → 切換回可編輯（取消提交）
    if (State.attendance?.submitted) {
      if (!confirm('確定要修改已提交的點名記錄嗎？')) return;
      btn.disabled = true;
      btn.textContent = '解除提交中…';
      try {
        await syncAttendance(false); // submitted = false
        State.attendance.submitted = false;
        btn.textContent = '✅ 提交今日點名';
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-success');
        showToast('已解除提交，可繼續修改', 'info');
      } catch (e) {
        showToast('操作失敗：' + e.message, 'error');
      } finally {
        btn.disabled = false;
      }
      return;
    }

    // 未提交 → 提交
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      await syncAttendance(true);
      // 提交成功後變為「修改」按鈕
      btn.textContent = '✏️ 修改點名記錄';
      btn.classList.remove('btn-success');
      btn.classList.add('btn-warning');
    } catch (e) {
      showToast('提交失敗：' + e.message, 'error');
      btn.textContent = '✅ 提交今日點名';
    } finally {
      btn.disabled = false;
    }
  });

  // 複製總表
  document.getElementById('copy-summary-btn')?.addEventListener('click', async (e) => {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已複製到剪貼板！', 'success');
    } catch {
      showToast('複製失敗，請手動複製', 'error');
    }
  });

  // 重新整理總表
  document.getElementById('refresh-summary-btn')?.addEventListener('click', renderSummaryPage);

  // CSV 匯入
  const csvInput = document.getElementById('csv-file-input');
  const dropZone = document.getElementById('csv-drop-zone');

  csvInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) handleCsvImport(e.target.files[0]);
  });

  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) handleCsvImport(file);
    else showToast('請拖曳 CSV 檔案', 'error');
  });

  dropZone?.addEventListener('click', () => csvInput?.click());

  // 匯出（整學期，不需選日期）
  document.getElementById('export-btn')?.addEventListener('click', () => {
    handleExport();
  });

  // 日期切換（總表頁面）
  document.getElementById('summary-prev-date')?.addEventListener('click', () => {
    const d = new Date(State.currentDate);
    d.setDate(d.getDate() - 1);
    State.currentDate = formatDate(d);
    renderSummaryPage();
  });

  document.getElementById('summary-next-date')?.addEventListener('click', () => {
    const d = new Date(State.currentDate);
    d.setDate(d.getDate() + 1);
    const tomorrow = formatDate(d);
    if (tomorrow <= formatDate()) {
      State.currentDate = tomorrow;
      renderSummaryPage();
    }
  });

  // 離開點名頁面時停止自動同步
  window.addEventListener('hashchange', () => {
    if (State.currentPage !== 'rollcall') {
      stopAutoSync();
    }
  });

  // 離開前警告（如有未儲存變更）
  window.addEventListener('beforeunload', (e) => {
    if (State.hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '有未提交的點名資料，確定要離開嗎？';
    }
  });
}

// ─── 啟動 ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  init();
});
