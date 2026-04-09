/**
 * 碧苑宿舍點名系統 - 主應用邏輯 v2
 * 以 CSV 總表為核心，所有資料來自 Notion
 */

// ─── 全域狀態 ──────────────────────────────────────────────────────────────────
const state = {
  students: [],         // 全部學生（含出席資料）
  dateColumns: [],      // 日期欄位列表（已排序）
  config: {},           // 系統設定（PIN、外籍生等）
  currentSquad: null,   // 當前選中的中隊
  currentDate: null,    // 當前選中的日期欄位名稱
  changes: [],          // 尚未提交的變更
  loading: true,
  calMonth: new Date(), // 歷史頁面的當前月份
};

// ─── 初始化 ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  state.currentDate = getTodayColumnName();
  setupNav();
  setupPinDialog();
  navigateTo('home');
  await loadData();
});

async function loadData() {
  try {
    showLoading(true);
    const [roster, config] = await Promise.all([
      window._api.getRoster(),
      window._api.getConfig(),
    ]);
    state.students = roster.students;
    state.dateColumns = roster.dateColumns;
    state.config = config;
    showLoading(false);
    renderCurrentPage();
    showToast(`已載入 ${state.students.length} 位學生`, 'success');
  } catch (err) {
    showLoading(false);
    showToast('載入失敗：' + err.message, 'error');
  }
}

// ─── 導航 ──────────────────────────────────────────────────────────────────────
let currentPage = 'home';

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      navigateTo(page);
    });
  });
}

function navigateTo(page) {
  currentPage = page;
  // 切換頁面可見性
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');

  // 導航高亮
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // 返回按鈕
  const backBtn = document.getElementById('back-btn');
  backBtn.style.display = (page === 'rollcall') ? 'block' : 'none';

  renderCurrentPage();
}

function renderCurrentPage() {
  switch (currentPage) {
    case 'home': renderHome(); break;
    case 'rollcall': renderRollCall(); break;
    case 'summary': renderSummary(); break;
    case 'history': renderHistory(); break;
    case 'settings': renderSettings(); break;
  }
}

// ─── 首頁：中隊選擇 ────────────────────────────────────────────────────────────
function renderHome() {
  const grid = document.getElementById('squad-grid');
  if (!grid) return;

  // 顯示日期
  const dateEl = document.getElementById('home-date');
  const now = new Date();
  dateEl.textContent = `${now.getMonth() + 1}/${now.getDate()} ${['日','一','二','三','四','五','六'][now.getDay()]}`;

  grid.innerHTML = CONFIG.SQUADS.map(sq => {
    const count = state.students.filter(s => s.squad === sq.id && !s.isEmpty).length;
    return `
      <div class="squad-card" style="--sq-color:${sq.color}" onclick="enterSquad('${sq.id}')">
        <div class="squad-card-title">${sq.id}</div>
        <div class="squad-card-sub">${sq.label.split('（')[1]?.replace('）','') || ''}</div>
        <div class="squad-card-count">${count} 人</div>
      </div>
    `;
  }).join('');
}

function enterSquad(squadId) {
  const pin = state.config[`pin_${squadId}`];
  if (pin && pin !== '0000') {
    showPinDialog(squadId, () => {
      state.currentSquad = squadId;
      state.currentDate = getTodayColumnName();
      state.changes = [];
      navigateTo('rollcall');
    });
  } else {
    state.currentSquad = squadId;
    state.currentDate = getTodayColumnName();
    state.changes = [];
    navigateTo('rollcall');
  }
}

// ─── 點名頁面 ──────────────────────────────────────────────────────────────────
function renderRollCall() {
  if (!state.currentSquad) return;

  const squadName = document.getElementById('rc-squad-name');
  const dateEl = document.getElementById('rc-date');
  const list = document.getElementById('rc-student-list');

  squadName.textContent = state.currentSquad;
  dateEl.textContent = state.currentDate;

  // 篩選此中隊的學生
  const students = state.students.filter(s => s.squad === state.currentSquad);

  // 按房號+床號排序
  students.sort((a, b) => a.room.localeCompare(b.room) || a.bed.localeCompare(b.bed));

  let html = '';
  let currentRoom = '';

  for (const s of students) {
    // 房號分組標題
    if (s.room !== currentRoom) {
      currentRoom = s.room;
      html += `<div class="room-divider">${s.room}</div>`;
    }

    const status = s.attendance[state.currentDate] || '✓';
    const statusInfo = CONFIG.STATUS[status] || CONFIG.STATUS['✓'];
    const isAbsent = status !== '✓';

    html += `
      <div class="student-row ${s.isEmpty ? 'empty-bed' : ''} ${isAbsent ? 'absent' : ''}"
           data-id="${s.id}" onclick="${s.isEmpty ? '' : `toggleStatus('${s.id}')`}">
        <div class="student-info">
          <div class="student-bed" style="background:${getSquadColor(state.currentSquad)}">${s.bed}</div>
          <div>
            <div class="student-name">${s.isEmpty ? '（空床）' : s.name}${s.isForeign ? ' 🌏' : ''}</div>
            <div class="student-meta">${s.class || ''} ${s.studentId || ''}</div>
          </div>
        </div>
        ${s.isEmpty ? '<span class="empty-tag">空床</span>' : `
          <div class="status-badge" style="background:${statusInfo.color}20;color:${statusInfo.color};border:1px solid ${statusInfo.color}40">
            ${statusInfo.icon} ${statusInfo.label}
          </div>
        `}
      </div>
    `;
  }

  list.innerHTML = html;
  updateRollCallStats();
  setupSubmitButton();
}

function toggleStatus(pageId) {
  const student = state.students.find(s => s.id === pageId);
  if (!student || student.isEmpty) return;

  const current = student.attendance[state.currentDate] || '✓';
  // 切換順序：✓ → ◎ → ✘ → ✓
  const cycle = { '✓': '◎', '◎': '✘', '✘': '✓', '△': '✓' };
  const next = cycle[current] || '✓';

  student.attendance[state.currentDate] = next;

  // 記錄變更
  const existing = state.changes.findIndex(c => c.pageId === pageId);
  if (existing >= 0) {
    state.changes[existing] = { pageId, date: state.currentDate, value: next };
  } else {
    state.changes.push({ pageId, date: state.currentDate, value: next });
  }

  renderRollCall();
}

function updateRollCallStats() {
  const students = state.students.filter(s => s.squad === state.currentSquad);
  const nonEmpty = students.filter(s => !s.isEmpty);

  let present = 0, leave = 0, absent = 0;
  for (const s of nonEmpty) {
    const v = s.attendance[state.currentDate] || '✓';
    if (v === '✓') present++;
    else if (v === '◎' || v === '△') leave++;
    else if (v === '✘') absent++;
  }

  document.getElementById('rc-stat-should').textContent = nonEmpty.length;
  document.getElementById('rc-stat-present').textContent = present;
  document.getElementById('rc-stat-leave').textContent = leave;
  document.getElementById('rc-stat-absent').textContent = absent;
}

function setupSubmitButton() {
  const btn = document.getElementById('submit-btn');
  btn.onclick = async () => {
    if (!state.changes.length) {
      showToast('沒有需要提交的變更', 'info');
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 提交中...';

    try {
      // 分批提交（每批 45 筆）
      for (let i = 0; i < state.changes.length; i += 45) {
        const batch = state.changes.slice(i, i + 45);
        await window._api.updateAttendance(batch);
      }

      showToast(`已提交 ${state.changes.length} 筆變更`, 'success');
      showSubmitSuccess();
      state.changes = [];
    } catch (err) {
      showToast('提交失敗：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✅ 提交今日點名';
    }
  };
}

function showSubmitSuccess() {
  const modal = document.getElementById('submit-success-modal');
  const students = state.students.filter(s => s.squad === state.currentSquad && !s.isEmpty);

  let present = 0, leave = 0, absent = 0;
  for (const s of students) {
    const v = s.attendance[state.currentDate] || '✓';
    if (v === '✓') present++;
    else if (v === '◎' || v === '△') leave++;
    else absent++;
  }

  document.getElementById('submit-should').textContent = students.length;
  document.getElementById('submit-present').textContent = present;
  document.getElementById('submit-leave').textContent = leave;
  document.getElementById('submit-absent').textContent = absent;

  modal.classList.add('visible');
  setTimeout(() => modal.classList.remove('visible'), 3000);
}

// ─── 總表頁面 ──────────────────────────────────────────────────────────────────
function renderSummary() {
  const summaryDate = state.currentDate || getTodayColumnName();
  document.getElementById('summary-date').textContent = summaryDate;

  // 計算全校統計
  const allStudents = state.students;
  const nonEmpty = allStudents.filter(s => !s.isEmpty);
  const emptyCount = allStudents.filter(s => s.isEmpty).length;
  const foreignCount = nonEmpty.filter(s => s.isForeign).length;
  const totalBeds = allStudents.length;
  const residents = nonEmpty.length;

  let present = 0, leave = 0, absent = 0;
  for (const s of nonEmpty) {
    const v = s.attendance[summaryDate] || '✓';
    if (v === '✓') present++;
    else if (v === '◎' || v === '△') leave++;
    else if (v === '✘') absent++;
  }

  const rate = residents > 0 ? Math.round((residents / totalBeds) * 100) : 0;

  document.getElementById('total-beds').textContent = totalBeds;
  document.getElementById('total-empty').textContent = emptyCount;
  document.getElementById('total-residents').textContent = residents;
  document.getElementById('total-foreign').textContent = foreignCount;
  document.getElementById('total-rate').textContent = rate + '%';
  document.getElementById('total-present').textContent = present;
  document.getElementById('total-leave').textContent = leave;
  document.getElementById('total-absent').textContent = absent;

  // 各中隊狀態
  const squadGrid = document.getElementById('summary-squad-grid');
  squadGrid.innerHTML = CONFIG.SQUADS.map(sq => {
    const sqStudents = nonEmpty.filter(s => s.squad === sq.id);
    let sqPresent = 0, sqLeave = 0, sqAbsent = 0;
    for (const s of sqStudents) {
      const v = s.attendance[summaryDate] || '✓';
      if (v === '✓') sqPresent++;
      else if (v === '◎' || v === '△') sqLeave++;
      else sqAbsent++;
    }
    return `
      <div class="squad-status-card" style="border-left:3px solid ${sq.color}">
        <div class="squad-status-title">${sq.id}</div>
        <div class="squad-status-row">
          <span>應到 <b>${sqStudents.length}</b></span>
          <span style="color:#22c55e">到 <b>${sqPresent}</b></span>
          <span style="color:#f59e0b">假 <b>${sqLeave}</b></span>
          <span style="color:#ef4444">缺 <b>${sqAbsent}</b></span>
        </div>
      </div>
    `;
  }).join('');

  // 日期導航
  document.getElementById('summary-prev-date').onclick = () => changeSummaryDate(-1);
  document.getElementById('summary-next-date').onclick = () => changeSummaryDate(1);

  // 複製總表
  document.getElementById('copy-summary-btn').onclick = () => copySummary(summaryDate);

  // 刷新
  document.getElementById('refresh-summary-btn').onclick = () => loadData();
}

function changeSummaryDate(delta) {
  const idx = state.dateColumns.indexOf(state.currentDate);
  const newIdx = idx + delta;
  if (newIdx >= 0 && newIdx < state.dateColumns.length) {
    state.currentDate = state.dateColumns[newIdx];
    renderSummary();
  }
}

function copySummary(date) {
  const nonEmpty = state.students.filter(s => !s.isEmpty);
  const emptyCount = state.students.filter(s => s.isEmpty).length;
  const totalBeds = state.students.length;
  const residents = nonEmpty.length;
  const foreignCount = nonEmpty.filter(s => s.isForeign).length;

  let present = 0, leave = 0, absent = 0;
  for (const s of nonEmpty) {
    const v = s.attendance[date] || '✓';
    if (v === '✓') present++;
    else if (v === '◎' || v === '△') leave++;
    else absent++;
  }

  const rate = residents > 0 ? Math.round((residents / totalBeds) * 100) : 0;

  const text = `碧苑宿舍 ${date} 點名報告
總床數：${totalBeds}
空床數：${emptyCount}
住宿人數：${residents}
外籍生：${foreignCount}
住宿率：${rate}%
實到：${present}
請假：${leave}
未請假：${absent}`;

  navigator.clipboard.writeText(text).then(() => {
    showToast('已複製到剪貼簿', 'success');
  });
}

// ─── 歷史頁面 ──────────────────────────────────────────────────────────────────
function renderHistory() {
  const monthNav = document.getElementById('hist-month');
  const cal = document.getElementById('hist-calendar');
  const detail = document.getElementById('hist-detail');

  const year = state.calMonth.getFullYear();
  const month = state.calMonth.getMonth();
  monthNav.textContent = `${year} 年 ${month + 1} 月`;

  // 生成日曆格子
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '<div class="cal-header">日</div><div class="cal-header">一</div><div class="cal-header">二</div><div class="cal-header">三</div><div class="cal-header">四</div><div class="cal-header">五</div><div class="cal-header">六</div>';

  // 空白
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const colName = `${month + 1}月${d}日`;
    const hasData = state.dateColumns.includes(colName);
    const isToday = colName === getTodayColumnName();

    // 計算該日概略數據
    let leaveCount = 0;
    if (hasData) {
      for (const s of state.students) {
        if (!s.isEmpty) {
          const v = s.attendance[colName];
          if (v === '◎' || v === '✘' || v === '△') leaveCount++;
        }
      }
    }

    html += `
      <div class="cal-cell ${hasData ? 'has-data' : ''} ${isToday ? 'today' : ''}"
           ${hasData ? `onclick="showDateDetail('${colName}')"` : ''}>
        <div class="cal-day">${d}</div>
        ${hasData && leaveCount > 0 ? `<div class="cal-badge">${leaveCount}</div>` : ''}
      </div>
    `;
  }

  cal.innerHTML = html;

  // 月份導航
  document.getElementById('cal-prev-month').onclick = () => {
    state.calMonth.setMonth(state.calMonth.getMonth() - 1);
    renderHistory();
  };
  document.getElementById('cal-next-month').onclick = () => {
    state.calMonth.setMonth(state.calMonth.getMonth() + 1);
    renderHistory();
  };
}

function showDateDetail(colName) {
  const detail = document.getElementById('hist-detail');
  const nonEmpty = state.students.filter(s => !s.isEmpty);

  let present = 0, leave = 0, absent = 0;
  const absentList = [];

  for (const s of nonEmpty) {
    const v = s.attendance[colName] || '✓';
    if (v === '✓') present++;
    else if (v === '◎' || v === '△') { leave++; absentList.push({ ...s, status: v }); }
    else if (v === '✘') { absent++; absentList.push({ ...s, status: v }); }
  }

  let html = `
    <div class="detail-header">
      <h3>${colName}</h3>
      <div class="detail-stats">
        <span style="color:#22c55e">到 ${present}</span>
        <span style="color:#f59e0b">假 ${leave}</span>
        <span style="color:#ef4444">缺 ${absent}</span>
      </div>
    </div>
  `;

  if (absentList.length) {
    html += '<div class="detail-list">';
    for (const s of absentList) {
      const statusInfo = CONFIG.STATUS[s.status] || CONFIG.STATUS['◎'];
      html += `
        <div class="detail-row">
          <span>${s.room} ${s.bed} ${s.name}</span>
          <span style="color:${statusInfo.color}">${statusInfo.icon} ${statusInfo.label}</span>
        </div>
      `;
    }
    html += '</div>';
  } else {
    html += '<p style="color:#888;text-align:center;padding:16px;">全員到齊 🎉</p>';
  }

  detail.innerHTML = html;
}

// ─── 設定頁面 ──────────────────────────────────────────────────────────────────
function renderSettings() {
  // 學期
  const semEl = document.getElementById('settings-semester');
  if (semEl) semEl.textContent = CONFIG.SEMESTER;

  // Worker 連線
  testWorkerConnection();

  // 載入外籍生設定
  renderForeignSettings();

  // 載入 PIN 設定
  renderPinSettings();

  // 載入學生統計
  const studentCount = state.students.length;
  const dateCount = state.dateColumns.length;
  const infoEl = document.getElementById('settings-info');
  if (infoEl) infoEl.textContent = `${studentCount} 位學生 · ${dateCount} 個日期欄位`;

  // 匯出日期範圍預設
  if (state.dateColumns.length) {
    const startDate = state.dateColumns[0];
    const endDate = state.dateColumns[state.dateColumns.length - 1];
    const startInput = document.getElementById('export-start-col');
    const endInput = document.getElementById('export-end-col');
    if (startInput) startInput.value = startDate;
    if (endInput) endInput.value = endDate;
  }

  // 匯出按鈕
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.onclick = () => exportExcel();
  }
}

// ─── 設定輔助函式 ──────────────────────────────────────────────────────────────
async function testWorkerConnection() {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.textContent = '⏳ 測試連線中...';
  el.style.background = 'rgba(255,255,255,0.05)';
  try {
    const res = await window._api.ping();
    el.textContent = '✅ Worker 連線正常';
    el.style.background = 'rgba(34,197,94,0.1)';
    el.style.color = '#22c55e';
  } catch (err) {
    el.textContent = '❌ 連線失敗：' + err.message;
    el.style.background = 'rgba(239,68,68,0.1)';
    el.style.color = '#ef4444';
  }
}

function renderForeignSettings() {
  // 設定頁面若有外籍生設定區塊，在此渲染
  // 目前外籍生是從班別自動判斷，無需手動設定
}

function renderPinSettings() {
  // PIN 設定若有 UI 區塊，在此渲染
  // 目前 PIN 從 Notion config 讀取
}

// ─── PIN 對話框 ─────────────────────────────────────────────────────────────────
let pinCallback = null;
let pinSquadId = null;

function setupPinDialog() {
  document.getElementById('pin-cancel').onclick = () => {
    document.getElementById('pin-dialog').classList.remove('visible');
    pinCallback = null;
  };
  document.getElementById('pin-confirm').onclick = () => {
    const input = document.getElementById('pin-input');
    const pin = input.value;
    const expected = state.config[`pin_${pinSquadId}`];

    if (pin === expected || pin === state.config['pin_admin']) {
      document.getElementById('pin-dialog').classList.remove('visible');
      input.value = '';
      if (pinCallback) pinCallback();
    } else {
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 500);
      showToast('PIN 碼錯誤', 'error');
    }
  };

  // Enter 提交
  document.getElementById('pin-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pin-confirm').click();
  });
}

function showPinDialog(squadId, callback) {
  pinSquadId = squadId;
  pinCallback = callback;
  document.getElementById('pin-dialog-title').textContent = `${squadId} 中隊點名`;
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-dialog').classList.add('visible');
  setTimeout(() => document.getElementById('pin-input').focus(), 100);
}

// ─── 自動備份 ──────────────────────────────────────────────────────────────────
setInterval(async () => {
  if (state.changes.length > 0) {
    try {
      for (let i = 0; i < state.changes.length; i += 45) {
        await window._api.updateAttendance(state.changes.slice(i, i + 45));
      }
      showToast(`自動備份 ${state.changes.length} 筆`, 'info');
      state.changes = [];
    } catch (e) {
      console.error('自動備份失敗', e);
    }
  }
}, CONFIG.AUTO_SAVE_INTERVAL);

// ─── UI 工具 ───────────────────────────────────────────────────────────────────
function showLoading(show) {
  state.loading = show;
  const el = document.getElementById('loading-overlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── 匯出 ──────────────────────────────────────────────────────────────────────
function exportExcel() {
  if (!state.students.length || !state.dateColumns.length) {
    showToast('沒有資料可匯出', 'error');
    return;
  }

  try {
    // 建立工作表資料
    const headers = ['名稱', '寢床號', '床號', '班別', '學號', ...state.dateColumns];
    const rows = state.students.map(s => {
      const row = [s.name, s.room, s.bed, s.class, s.studentId];
      for (const date of state.dateColumns) {
        row.push(s.attendance[date] || '✓');
      }
      return row;
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '點名總表');
    XLSX.writeFile(wb, `碧苑點名_${CONFIG.SEMESTER}_${getTodayColumnName()}.xlsx`);
    showToast('Excel 已下載', 'success');
  } catch (err) {
    showToast('匯出失敗：' + err.message, 'error');
  }
}

// 暴露全域函式
window.enterSquad = enterSquad;
window.toggleStatus = toggleStatus;
window.showDateDetail = showDateDetail;
window.exportExcel = exportExcel;
window.navigateTo = navigateTo;
window.loadData = loadData;
