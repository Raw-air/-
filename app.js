/**
 * 碧苑宿舍點名系統 - 主應用邏輯 v2.2
 * 新增: 硬性房間規則 / 斜線動畫 / 導覽列自訂圖示
 */

// ─── 全域狀態 ───────────────────────────────────────────────────────────────
const state = {
  students: [],
  dateColumns: [],
  config: {},
  currentSquad: null,
  currentDate: null,
  changes: [],
  loading: true,
  calMonth: new Date(),
  confirmedSquads: [],
};

// ─── 初始化 ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  state.currentDate = getTodayColumnName();
  setupNav();
  setupPinDialog();
  applyNavIcons();
  loadBgVideo(); // 載入背景影片
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

    // 套用硬性房間規則
    applyRoomRules();
    
    // 套用全域背景影片設定
    loadGlobalBgVideo();
    
    const today = getTodayColumnName();
    const confVal = state.config['confirm_' + today];
    if (confVal) state.confirmedSquads = confVal.split(',').filter(Boolean);
    else state.confirmedSquads = [];

    showLoading(false);
    renderCurrentPage();
    showToast(`已載入 ${state.students.length} 位學生`, 'success');
  } catch (err) {
    showLoading(false);
    showToast('載入失敗：' + err.message, 'error');
  }
}

// ─── 導航 ───────────────────────────────────────────────────────────────────
let currentPage = 'home';

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });
}

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  const backBtn = document.getElementById('back-btn');
  backBtn.style.display = (page === 'rollcall') ? 'flex' : 'none';

  // 隱藏 FAB
  const fab = document.querySelector('.fab-empty-bed');
  if (fab) fab.style.display = (page === 'rollcall') ? 'flex' : 'none';

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

// ═════════════════════════════════════════════════════════════════════════════
// 首頁
// ═════════════════════════════════════════════════════════════════════════════
function renderHome() {
  // 日期
  const dateEl = document.getElementById('home-date');
  const now = new Date();
  const weekDay = ['日','一','二','三','四','五','六'][now.getDay()];
  dateEl.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${weekDay}`;

  // ── 斜線球體動畫 ──
  const animBg = document.querySelector('.home-anim-bg');
  if (animBg && !animBg.hasChildNodes()) {
    const sphere = document.createElement('div');
    sphere.className = 'ball-sphere';
    
    // 產生 35 條水平線組成球體，再藉由 CSS 的 135deg 旋轉變成斜向
    const LINE_COUNT = 35;
    
    for (let i = 0; i < LINE_COUNT; i++) {
        const line = document.createElement('div');
        line.className = 'anim-line';
        
        const t = i / (LINE_COUNT - 1);
        const normalized = 2 * t - 1; // -1 to 1
        
        // 根據圓形公式 √(1 - y^2) 讓中間最寬，兩側漸窄
        const circleX = Math.sqrt(Math.max(0, 1 - normalized * normalized));
        const maxW = circleX * 360; // 容器寬度為 360px
        
        if (maxW < 12) continue; // 忽略太短的雜訊
        
        // y 軸位置 0% ~ 100%
        const yPos = t * 100;
        
        // 使所有線條動畫有極微小的錯開，創造立體堆疊錯覺
        const dur = 8; 
        const delay = (i * 0.03); 
        
        line.style.setProperty('--w', maxW + 'px');
        line.style.setProperty('--y', yPos + '%');
        line.style.setProperty('--dur', dur + 's');
        line.style.setProperty('--delay', delay + 's');
        line.style.setProperty('--op', (0.1 + circleX * 0.9).toFixed(2));
        
        sphere.appendChild(line);
    }
    animBg.appendChild(sphere);
  }

  // 中隊卡片 (3列)
  const grid = document.getElementById('squad-grid');
  const floorLabels = { 1: '1樓', 2: '2樓', 3: '3樓' };

  grid.innerHTML = CONFIG.SQUADS.map(sq => {
    const count = state.students.filter(s => s.squad === sq.id && !s.isEmpty && !s.hidden).length;
    const floor = sq.floor;
    const type = sq.odd ? '單數房' : '雙數房';
    return `
      <div class="sq-card" style="--sq-c:${sq.color}" onclick="enterSquad('${sq.id}')">
        <div class="sq-badge" style="background:${sq.color}">${floor}</div>
        <div class="sq-name">${sq.id}</div>
        <div class="sq-desc">${floorLabels[floor]}・${type}</div>
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

// ═════════════════════════════════════════════════════════════════════════════
// 日期選擇器
// ═════════════════════════════════════════════════════════════════════════════
function toggleDatePicker() {
  const panel = document.getElementById('date-picker-panel');
  const btn   = document.getElementById('rc-date-btn');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    closeDatePicker();
  } else {
    renderDatePicker();
    panel.classList.add('open');
    btn.classList.add('open');
  }
}

function closeDatePicker() {
  document.getElementById('date-picker-panel')?.classList.remove('open');
  document.getElementById('rc-date-btn')?.classList.remove('open');
}

function renderDatePicker() {
  const today = getTodayColumnName();
  const list  = document.getElementById('date-picker-list');
  // 倒序排列：最新的在最上面
  const dates = [...state.dateColumns].reverse();
  list.innerHTML = dates.map(d => {
    const isActive  = d === state.currentDate;
    const isToday   = d === today;
    return `<div class="date-item${isActive?' active':''}${isToday?' today-marker':''}"
                 onclick="selectRollCallDate('${d}')">${d}</div>`;
  }).join('');
  // 自動捲到選中的日期
  setTimeout(() => {
    const active = list.querySelector('.date-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, 50);
}

function selectRollCallDate(date) {
  state.currentDate = date;
  closeDatePicker();
  renderRollCall();
}

// 點選面板外關閉
document.addEventListener('click', e => {
  const btn   = document.getElementById('rc-date-btn');
  const panel = document.getElementById('date-picker-panel');
  if (btn && panel && !btn.contains(e.target) && !panel.contains(e.target)) {
    closeDatePicker();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 點名
// ═════════════════════════════════════════════════════════════════════════════
function renderRollCall() {
  if (!state.currentSquad) return;

  document.getElementById('rc-squad-name').textContent = state.currentSquad;
  document.getElementById('rc-date').textContent = state.currentDate;

  // 更新提交按鈕顯示目前日期
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.textContent = `✅ 提交 ${state.currentDate} 點名`;

  const students = state.students.filter(s => s.squad === state.currentSquad && !s.hidden);
  students.sort((a, b) => a.room.localeCompare(b.room) || a.bed.localeCompare(b.bed));

  let html = '';
  let curRoom = '';
  for (const s of students) {
    if (s.room !== curRoom) { curRoom = s.room; html += `<div class="room-divider">${s.room}</div>`; }
    const status = s.attendance[state.currentDate] || '✓';
    const si = CONFIG.STATUS[status] || CONFIG.STATUS['✓'];
    const absent = status !== '✓';
    const isPending = state.changes.some(c => c.pageId === s.id && c.date === state.currentDate);
    html += `
      <div class="student-row ${s.isEmpty?'empty-bed':''} ${absent?'absent':''}"
           data-pid="${s.id}"
           onclick="${s.isEmpty?'':`toggleStatus('${s.id}')`}">
        <div class="student-info">
          <div class="student-bed" style="background:${getSquadColor(state.currentSquad)}">${s.bed}</div>
          <div>
            <div class="student-name">${s.isEmpty?'（空床）':s.name}${s.isForeign?' 🌏':''}</div>
            <div class="student-meta">${s.class||''} ${s.studentId||''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          ${s.isEmpty?'<span class="empty-tag">空床</span>':
            `<div class="status-badge" style="background:${si.color}20;color:${si.color};border:1px solid ${si.color}40">${si.icon} ${si.label}</div>`}
          <span class="sync-dot${isPending?' pending':''}"></span>
        </div>
      </div>`;
  }
  document.getElementById('rc-student-list').innerHTML = html;
  updateRollCallStats();
  setupSubmitButton();
}

// 每位學生的 debounce timer
const _syncTimers = {};

function toggleStatus(pageId) {
  const s = state.students.find(x => x.id === pageId);
  if (!s || s.isEmpty) return;

  const cur  = s.attendance[state.currentDate] || '✓';
  const next = { '✓':'◎', '◎':'✘', '✘':'✓', '△':'✓' }[cur] || '✓';
  s.attendance[state.currentDate] = next;

  // 保留在 changes 以供提交按鈕使用
  const idx = state.changes.findIndex(c => c.pageId === pageId && c.date === state.currentDate);
  const change = { pageId, date: state.currentDate, value: next };
  if (idx >= 0) state.changes[idx] = change;
  else state.changes.push(change);

  // 即時更新 UI
  renderRollCall();

  // 立即同步到 Notion（debounce 800ms 防止快速連點重複 API）
  clearTimeout(_syncTimers[pageId]);
  _syncTimers[pageId] = setTimeout(async () => {
    try {
      await window._api.updateAttendance([change]);
      // 同步成功：移除 changes 中已成功的那筆
      const i = state.changes.findIndex(c => c.pageId === pageId && c.date === state.currentDate && c.value === next);
      if (i >= 0) state.changes.splice(i, 1);
      // 微小的成功提示（不打擾操作）
      showSyncDot(pageId, 'ok');
    } catch (err) {
      // 失敗保留在 changes 留待手動提交
      showSyncDot(pageId, 'err');
      console.warn('auto-sync failed:', err.message);
    }
  }, 800);
}

// 在學生行顯示同步狀態小點
function showSyncDot(pageId, state) {
  const rows = document.querySelectorAll('.student-row');
  // 找到對應行（透過 onclick 屬性）
  for (const row of rows) {
    if (row.dataset.pid === pageId) {
      const dot = row.querySelector('.sync-dot');
      if (dot) {
        dot.className = `sync-dot ${state}`;
        setTimeout(() => dot.classList.remove('ok','err'), 2000);
      }
      break;
    }
  }
}

function updateRollCallStats() {
  const ss = state.students.filter(s => s.squad === state.currentSquad && !s.isEmpty && !s.hidden);
  let p=0, l=0, a=0;
  for (const s of ss) { const v = s.attendance[state.currentDate]||'✓'; if(v==='✓')p++; else if(v==='◎'||v==='△')l++; else a++; }
  document.getElementById('rc-stat-should').textContent = ss.length;
  document.getElementById('rc-stat-present').textContent = p;
  document.getElementById('rc-stat-leave').textContent = l;
  document.getElementById('rc-stat-absent').textContent = a;

  const confirmBtn = document.getElementById('rc-confirm-btn');
  if (state.currentDate === getTodayColumnName()) {
    confirmBtn.style.display = 'flex';
    const isConfirmed = state.confirmedSquads.includes(state.currentSquad);
    confirmBtn.className = 'rc-confirm-action' + (isConfirmed ? ' done' : '');
    document.getElementById('rc-confirm-icon').textContent = isConfirmed ? '🟢' : '⭕';
    document.getElementById('rc-confirm-text').textContent = isConfirmed ? '確認本中隊已完成點名' : '確認本中隊完成點名';
  } else {
    confirmBtn.style.display = 'none';
  }
}

async function toggleSquadConfirm() {
  const sq = state.currentSquad;
  if (state.confirmedSquads.includes(sq)) {
    state.confirmedSquads = state.confirmedSquads.filter(s => s !== sq);
  } else {
    state.confirmedSquads.push(sq);
  }
  updateRollCallStats();
  
  const today = getTodayColumnName();
  try {
    await window._api.setConfig({ key: 'confirm_' + today, value: state.confirmedSquads.join(',') });
  } catch(e) {
    console.error('儲存確認狀態失敗', e);
  }
}

function setupSubmitButton() {
  const btn = document.getElementById('submit-btn');
  btn.onclick = async () => {
    if (!state.changes.length) { showToast('沒有需要提交的變更','info'); return; }
    btn.disabled = true; btn.textContent = '⏳ 提交中...';
    try {
      for (let i=0; i<state.changes.length; i+=45)
        await window._api.updateAttendance(state.changes.slice(i,i+45));
      showToast(`已提交 ${state.changes.length} 筆變更`,'success');
      showSubmitSuccess();
      state.changes = [];
    } catch (err) { showToast('提交失敗：'+err.message,'error'); }
    finally { btn.disabled = false; btn.textContent = '✅ 提交今日點名'; }
  };
}

function showSubmitSuccess() {
  const ss = state.students.filter(s => s.squad === state.currentSquad && !s.isEmpty && !s.hidden);
  let p=0,l=0,a=0;
  for (const s of ss) { const v=s.attendance[state.currentDate]||'✓'; if(v==='✓')p++; else if(v==='◎'||v==='△')l++; else a++;}
  document.getElementById('submit-should').textContent = ss.length;
  document.getElementById('submit-present').textContent = p;
  document.getElementById('submit-leave').textContent = l;
  document.getElementById('submit-absent').textContent = a;
  const m = document.getElementById('submit-success-modal');
  m.classList.add('visible'); setTimeout(()=>m.classList.remove('visible'),3000);
}

// ═════════════════════════════════════════════════════════════════════════════
// 空床回報
// ═════════════════════════════════════════════════════════════════════════════
function openEmptyBedModal() {
  // 若在點名頁只顯示當前中隊的房間，否則顯示全部房間
  const filtered = state.currentSquad && currentPage === 'rollcall'
    ? state.students.filter(s => s.squad === state.currentSquad && !s.hidden)
    : state.students.filter(s => !s.hidden);
  const rooms = [...new Set(filtered.map(s => s.room))].sort();
  const sel = document.getElementById('eb-room');
  sel.innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  updateBedOptions();
  document.getElementById('empty-bed-modal').classList.add('visible');
}

function updateBedOptions() {
  const room = document.getElementById('eb-room').value;
  // 遵守房間規則：雙人房只顯示 A/B
  const allowedBeds = CONFIG.DOUBLE_ROOMS.includes(room) ? ['A','B'] : ['A','B','C','D'];
  const sel = document.getElementById('eb-bed');
  sel.innerHTML = allowedBeds.map(b => {
    const s = state.students.find(x => x.room === room && x.bed === b && !x.hidden);
    const label = s ? (s.isEmpty ? `${b} 床（已空床）` : `${b} 床 - ${s.name}`) : `${b} 床`;
    return `<option value="${b}">${label}</option>`;
  }).join('');
}

async function submitEmptyBed() {
  const room = document.getElementById('eb-room').value;
  const bed = document.getElementById('eb-bed').value;
  const student = state.students.find(s => s.room === room && s.bed === bed);

  if (!student) { showToast('找不到此床位','error'); return; }
  if (student.isEmpty) { showToast('此床位已是空床','info'); closeModal('empty-bed-modal'); return; }

  try {
    // 在 Notion 中將「空床」checkbox 設為 true
    await window._api.updateAttendance([{
      pageId: student.id,
      markEmpty: true,
    }]);

    // 本地更新
    student.isEmpty = true;

    showToast(`${room} ${bed} 床已標記為空床`,'success');
    closeModal('empty-bed-modal');
    renderRollCall();
    renderSummary();
  } catch (err) {
    showToast('更新失敗：'+err.message,'error');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 換床位
// ═════════════════════════════════════════════════════════════════════════════
function openSwapBedModal() {
  const rooms = [...new Set(state.students.filter(s => !s.hidden).map(s => s.room))].sort();
  document.getElementById('sw-from-room').innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  document.getElementById('sw-to-room').innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  updateSwapFromBeds();
  updateSwapToBeds();
  document.getElementById('swap-bed-modal').classList.add('visible');
}

function updateSwapFromBeds() {
  const room = document.getElementById('sw-from-room').value;
  const beds = state.students.filter(s => s.room === room && !s.isEmpty);
  const sel = document.getElementById('sw-from-bed');
  sel.innerHTML = beds.map(s =>
    `<option value="${s.bed}">${s.bed} 床 - ${s.name || '(無名)'}</option>`
  ).join('');
  if (!beds.length) sel.innerHTML = '<option disabled>此房間無住宿生</option>';
}

function updateSwapToBeds() {
  const room = document.getElementById('sw-to-room').value;
  const allBeds = state.students.filter(s => s.room === room);
  const sel = document.getElementById('sw-to-bed');
  sel.innerHTML = allBeds.map(s => {
    const label = s.isEmpty ? `${s.bed} 床（空床）` : `${s.bed} 床 - ${s.name || '(無名)'}`;
    return `<option value="${s.bed}">${label}</option>`;
  }).join('');
  if (!allBeds.length) sel.innerHTML = '<option disabled>此房間無床位</option>';
}

async function submitSwapBed() {
  const fromRoom = document.getElementById('sw-from-room').value;
  const fromBed = document.getElementById('sw-from-bed').value;
  const toRoom = document.getElementById('sw-to-room').value;
  const toBed = document.getElementById('sw-to-bed').value;

  if (fromRoom === toRoom && fromBed === toBed) {
    showToast('來源和目標是同一個床位', 'info'); return;
  }

  const studentA = state.students.find(s => s.room === fromRoom && s.bed === fromBed);
  const studentB = state.students.find(s => s.room === toRoom && s.bed === toBed);

  if (!studentA) { showToast('找不到來源學生', 'error'); return; }
  if (!studentB) { showToast('找不到目標床位資料', 'error'); return; }

  const btn = document.querySelector('#swap-bed-modal .modal-btn.confirm');
  if (btn) { btn.disabled = true; btn.textContent = '交換中...'; }

  try {
    // 呼叫新端點：整行資料互換（姓名/班別/學號/空床/所有出席紀錄全部交換）
    // 物理位置（寢床號/床號/中隊）保持不變
    await window._api.swapBeds(studentA.id, studentB.id);

    // 本地狀態同步：交換兩個學生物件除位置外的所有資料
    const posA = { id: studentA.id, room: studentA.room, bed: studentA.bed, squad: studentA.squad };
    const posB = { id: studentB.id, room: studentB.room, bed: studentB.bed, squad: studentB.squad };

    // 交換所有非位置屬性
    const keysToSwap = ['name', 'class', 'studentId', 'isForeign', 'isEmpty', 'attendance'];
    for (const key of keysToSwap) {
      const tmp = studentA[key];
      studentA[key] = studentB[key];
      studentB[key] = tmp;
    }

    // 位置保持不變（用回原本的值）
    Object.assign(studentA, posA);
    Object.assign(studentB, posB);

    const nameA = studentA.name || '（空床）';
    const nameB = studentB.name || '（空床）';
    const msg = `✅ 已完整交換：${fromRoom}${fromBed} ${nameA} ↔ ${toRoom}${toBed} ${nameB}`;
    showToast(msg, 'success');
    closeModal('swap-bed-modal');
    renderSummary();
  } catch (err) {
    showToast('換床位失敗：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '確認換床位'; }
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('visible');
}

// ═════════════════════════════════════════════════════════════════════════════
// 總表
// 計算順序：
//   1. 總床數（設定值）
//   2. 空床數 = 各樓層空床(isEmpty)總和 + 空床修正值
//   3. 住宿人數 = 總床數 - 空床數
//   4. 住宿率 = round((住宿人數 / 總床數) * 100 * 10) / 10 + "%"
//   5. 實到 = 各樓層 (應到 - 請假 - 未請假) 的總合
//   6. 請假 = 各樓層當日請假總和
//   7. 未請假 = 各樓層當日未請假總和
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 計算某日的全域統計資料（一個函數，renderSummary 和 copySummary 共用）
 */
function computeDailyStats(date) {
  const totalBeds = parseInt(state.config['total_beds']) || state.students.filter(s => !s.hidden).length;
  const bedOffset = parseInt(state.config['bed_offset']) || 0;

  // --- 各中隊明細 ---
  const squads = [];
  let gShouldAttend = 0, gLeave = 0, gAbsent = 0, gPresent = 0;
  let gEmptyCount = 0, gForeignCount = 0;

  for (const sq of CONFIG.SQUADS) {
    // 排除隱藏的學生（雙人房 C/D 和儲藏室）
    const members = state.students.filter(s => s.squad === sq.id && !s.hidden);
    // 空床 = isEmpty 的學生（靜態屬性，來自 Notion 的「空床」checkbox）
    let emptyInSquad = members.filter(s => s.isEmpty).length;

    // 應到 = 非空床的住宿生
    const residents = members.filter(s => !s.isEmpty);
    const shouldAttend = residents.length;

    let sqLeave = 0, sqAbsent = 0;
    for (const s of residents) {
      const v = s.attendance[date] || '✓';
      if (v === '◎' || v === '△') sqLeave++;
      else if (v === '✘') sqAbsent++;
    }
    // 實到 = 應到 - 請假 - 未請假
    const sqPresent = shouldAttend - sqLeave - sqAbsent;
    // 外籍
    const sqForeign = residents.filter(s => s.isForeign).length;

    squads.push({
      id: sq.id, color: sq.color,
      shouldAttend, present: sqPresent, leave: sqLeave, absent: sqAbsent,
      empty: emptyInSquad, foreign: sqForeign,
    });

    gShouldAttend += shouldAttend;
    gLeave += sqLeave;
    gAbsent += sqAbsent;
    gPresent += sqPresent;
    gEmptyCount += emptyInSquad;
    gForeignCount += sqForeign;
  }

  // --- 全域計算 ---
  // 2. 空床數 = 各樓層空床總和 + 全域空床修正值
  const totalEmpty = gEmptyCount + bedOffset;
  // 3. 住宿人數 = 總床數 - 空床數
  const residents = totalBeds - totalEmpty;
  // 4. 住宿率公式: round((住宿人數/總床數)*100*10)/10
  const rate = totalBeds > 0 ? Math.round((residents / totalBeds) * 100 * 10) / 10 : 0;

  return {
    totalBeds, totalEmpty, residents, rate, bedOffset,
    present: gPresent, leave: gLeave, absent: gAbsent,
    shouldAttend: gShouldAttend, foreign: gForeignCount,
    squads,
  };
}

function renderSummary() {
  const date = state.currentDate || getTodayColumnName();
  document.getElementById('summary-date').textContent = date;

  const st = computeDailyStats(date);

  // 1-3: 上排大數字
  document.getElementById('total-beds').textContent = st.totalBeds;
  document.getElementById('total-empty').textContent = st.totalEmpty;
  document.getElementById('total-residents').textContent = st.residents;

  // 4-5: 外籍 / 住宿率
  document.getElementById('total-foreign').textContent = st.foreign;
  document.getElementById('total-rate').textContent = st.rate + '%';

  // 6-8: 實到 / 請假 / 未請假
  document.getElementById('total-present').textContent = st.present;
  document.getElementById('total-leave').textContent = st.leave;
  document.getElementById('total-absent').textContent = st.absent;

  // 各中隊
  const grid = document.getElementById('summary-squad-grid');
  grid.innerHTML = st.squads.map(sq => {
    const isConfirmed = state.confirmedSquads.includes(sq.id) && date === getTodayColumnName();
    const confHtml = isConfirmed ? `<span class="sqd-conf-badge">✅ 已確認</span>` : '';
    return `
    <div class="sqd-card" style="--sq-c:${sq.color}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
        <div class="sqd-title" style="margin-bottom:0">${sq.id}</div>
        ${confHtml}
      </div>
      <div class="sqd-row">
        <span>應到 <b>${sq.shouldAttend}</b></span>
        <span style="color:var(--green)">到 <b>${sq.present}</b></span>
        <span style="color:var(--yellow)">假 <b>${sq.leave}</b></span>
        <span style="color:var(--red)">缺 <b>${sq.absent}</b></span>
      </div>
      <div class="sqd-foreign">🌏 外籍 ${sq.foreign} ・ 🛏️ 空床 ${sq.empty}</div>
    </div>`;
  }).join('');

  document.getElementById('summary-prev-date').onclick = () => changeSummaryDate(-1);
  document.getElementById('summary-next-date').onclick = () => changeSummaryDate(1);
  document.getElementById('copy-summary-btn').onclick = () => copySummary(date);
  document.getElementById('refresh-summary-btn').onclick = () => loadData();
}

function changeSummaryDate(delta) {
  const idx = state.dateColumns.indexOf(state.currentDate);
  const ni = idx + delta;
  if (ni >= 0 && ni < state.dateColumns.length) {
    state.currentDate = state.dateColumns[ni];
    renderSummary();
  }
}

function copySummary(date) {
  const st = computeDailyStats(date);
  const text = `碧苑宿舍 ${date} 點名報告\n` +
    `1. 總床數：${st.totalBeds}\n` +
    `2. 空床數：${st.totalEmpty}（修正值: ${st.bedOffset}）\n` +
    `3. 住宿人數：${st.residents}\n` +
    `4. 住宿率：${st.rate}%\n` +
    `5. 實到：${st.present}\n` +
    `6. 請假：${st.leave}\n` +
    `7. 未請假：${st.absent}\n` +
    `外籍生：${st.foreign}`;
  navigator.clipboard.writeText(text).then(() => showToast('已複製', 'success'));
}

// ═════════════════════════════════════════════════════════════════════════════
// 歷史
// ═════════════════════════════════════════════════════════════════════════════
function renderHistory() {
  const year = state.calMonth.getFullYear();
  const month = state.calMonth.getMonth();
  document.getElementById('hist-month').textContent = `${year} 年 ${month+1} 月`;

  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month+1, 0).getDate();
  let html = '<div class="cal-header">日</div><div class="cal-header">一</div><div class="cal-header">二</div><div class="cal-header">三</div><div class="cal-header">四</div><div class="cal-header">五</div><div class="cal-header">六</div>';
  for (let i=0; i<firstDay; i++) html += '<div class="cal-cell empty"></div>';
  for (let d=1; d<=days; d++) {
    const col = `${month+1}月${d}日`;
    const has = state.dateColumns.includes(col);
    const today = col === getTodayColumnName();
    let badge = 0;
    if (has) for (const s of state.students) if (!s.isEmpty && s.attendance[col] && s.attendance[col]!=='✓') badge++;
    html += `<div class="cal-cell ${has?'has-data':''} ${today?'today':''}" ${has?`onclick="showDateDetail('${col}')"`:''}><div class="cal-day">${d}</div>${has&&badge?`<div class="cal-badge">${badge}</div>`:''}</div>`;
  }
  document.getElementById('hist-calendar').innerHTML = html;
  document.getElementById('cal-prev-month').onclick = () => { state.calMonth.setMonth(state.calMonth.getMonth()-1); renderHistory(); };
  document.getElementById('cal-next-month').onclick = () => { state.calMonth.setMonth(state.calMonth.getMonth()+1); renderHistory(); };
}

function showDateDetail(col) {
  const nonEmpty = state.students.filter(s => !s.isEmpty && !s.hidden);
  let p=0, l=0, a=0; const list=[];
  for (const s of nonEmpty) {
    const v = s.attendance[col] || '✓';
    if (v === '✓' || v === '△') p++;
    else if (v === '◎') { l++; list.push({...s, status: v}); }
    else if (v === '✘') { a++; list.push({...s, status: v}); }
  }
  let html = `<div class="detail-header"><h3>${col}</h3><div class="detail-stats"><span style="color:var(--green)">到 ${p}</span><span style="color:var(--yellow)">假 ${l}</span><span style="color:var(--red)">缺 ${a}</span></div></div>`;
  if (list.length) {
    html += '<div class="detail-list">';
    for (const s of list) { const si = CONFIG.STATUS[s.status]||CONFIG.STATUS['◎']; html += `<div class="detail-row"><span>${s.room} ${s.bed} ${s.name}</span><span style="color:${si.color}">${si.icon} ${si.label}</span></div>`; }
    html += '</div>';
  } else html += '<p style="color:var(--dim);text-align:center;padding:20px">全員到齊 🎉</p>';
  document.getElementById('hist-detail').innerHTML = html;
}

// ═════════════════════════════════════════════════════════════════════════════
// 設定
// ═════════════════════════════════════════════════════════════════════════════
function renderSettings() {
  testWorkerConnection();

  const visibleStudents = state.students.filter(s => !s.hidden);
  const sc = visibleStudents.length;
  const dc = state.dateColumns.length;
  const el = document.getElementById('settings-info');
  if (el) el.textContent = `${sc} 位學生 · ${dc} 個日期欄位`;

  // 宿舍參數
  const totalBeds = parseInt(state.config['total_beds']) || visibleStudents.length;
  const bedOffset = parseInt(state.config['bed_offset']) || 0;
  document.getElementById('cfg-total-beds').value = totalBeds;
  document.getElementById('cfg-bed-offset').value = bedOffset;

  // 導覽列圖示（僅開發者模式解鎖後才渲染）
  if (devUnlocked) renderNavIconUpload();
}

function adjustSetting(key, delta) {
  const map = {
    'total_beds': 'cfg-total-beds',
    'bed_offset': 'cfg-bed-offset',
  };
  const input = document.getElementById(map[key]);
  if (!input) return;
  let val = parseInt(input.value) || 0;
  if (key === 'total_beds') val = Math.max(0, val + delta);
  else val = val + delta;
  input.value = val;
}

async function saveDormSettings() {
  const totalBeds = parseInt(document.getElementById('cfg-total-beds').value) || 0;
  const bedOffset = parseInt(document.getElementById('cfg-bed-offset').value) || 0;
  try {
    await window._api.setConfig({
      total_beds: String(totalBeds),
      bed_offset: String(bedOffset),
    });
    state.config['total_beds'] = String(totalBeds);
    state.config['bed_offset'] = String(bedOffset);
    showToast('宿舍參數已儲存','success');
  } catch (err) {
    showToast('儲存失敗：'+err.message, 'error');
  }
}

async function testWorkerConnection() {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.textContent = '⏳ 測試連線中...';
  el.style.background = 'rgba(255,255,255,.05)'; el.style.color = 'var(--dim)';
  try {
    await window._api.ping();
    el.textContent = '✅ Worker 連線正常';
    el.style.background = 'rgba(34,197,94,.1)'; el.style.color = 'var(--green)';
  } catch (err) {
    el.textContent = '❌ 連線失敗';
    el.style.background = 'rgba(239,68,68,.1)'; el.style.color = 'var(--red)';
  }
}

// ─── PIN ────────────────────────────────────────────────────────────────────
let pinCallback = null, pinSquadId = null;

function setupPinDialog() {
  document.getElementById('pin-cancel').onclick = () => { document.getElementById('pin-dialog').classList.remove('visible'); pinCallback=null; };
  document.getElementById('pin-confirm').onclick = () => {
    const input = document.getElementById('pin-input');
    const pin = input.value;
    const expected = state.config[`pin_${pinSquadId}`];
    if (pin === expected || pin === state.config['pin_admin']) {
      document.getElementById('pin-dialog').classList.remove('visible');
      input.value = ''; if (pinCallback) pinCallback();
    } else { input.classList.add('shake'); setTimeout(()=>input.classList.remove('shake'),500); showToast('PIN 碼錯誤','error'); }
  };
  document.getElementById('pin-input').addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('pin-confirm').click(); });
}

function showPinDialog(squadId, callback) {
  pinSquadId = squadId; pinCallback = callback;
  document.getElementById('pin-dialog-title').textContent = `${squadId} 中隊點名`;
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-dialog').classList.add('visible');
  setTimeout(()=>document.getElementById('pin-input').focus(), 100);
}

// ─── 自動備份 ───────────────────────────────────────────────────────────────
setInterval(async () => {
  if (state.changes.length > 0) {
    try {
      for (let i=0; i<state.changes.length; i+=45) await window._api.updateAttendance(state.changes.slice(i,i+45));
      showToast(`自動備份 ${state.changes.length} 筆`,'info');
      state.changes = [];
    } catch (e) { console.error('自動備份失敗', e); }
  }
}, CONFIG.AUTO_SAVE_INTERVAL);

// ─── UI 工具 ────────────────────────────────────────────────────────────────
function showLoading(show) { state.loading=show; const el=document.getElementById('loading-overlay'); if(el) el.style.display=show?'flex':'none'; }

function showToast(msg, type='info') {
  const c = document.getElementById('toast-container'); if(!c) return;
  const t = document.createElement('div'); t.className=`toast toast-${type}`; t.textContent=msg;
  c.appendChild(t); setTimeout(()=>t.classList.add('visible'),10);
  setTimeout(()=>{ t.classList.remove('visible'); setTimeout(()=>t.remove(),300); },3000);
}

// ─── 匯出 ───────────────────────────────────────────────────────────────────
function exportExcel() {
  if (!state.students.length) { showToast('沒有資料','error'); return; }
  try {
    const headers = ['名稱','寢床號','床號','班別','學號', ...state.dateColumns];
    const rows = state.students.map(s => {
      const r = [s.name, s.room, s.bed, s.class, s.studentId];
      for (const d of state.dateColumns) r.push(s.attendance[d]||'✓');
      return r;
    });
    const ws = XLSX.utils.aoa_to_sheet([headers,...rows]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '點名總表');
    XLSX.writeFile(wb, `碧苑點名_${CONFIG.SEMESTER}_${getTodayColumnName()}.xlsx`);
    showToast('Excel 已下載','success');
  } catch (err) { showToast('匯出失敗：'+err.message,'error'); }
}

// ─── 全域暴露 ───────────────────────────────────────────────────────────────
window.enterSquad = enterSquad;
window.toggleStatus = toggleStatus;
window.showDateDetail = showDateDetail;
window.exportExcel = exportExcel;
window.navigateTo = navigateTo;
window.loadData = loadData;
window.openEmptyBedModal = openEmptyBedModal;
window.updateBedOptions = updateBedOptions;
window.submitEmptyBed = submitEmptyBed;
window.closeModal = closeModal;
window.adjustSetting = adjustSetting;
window.saveDormSettings = saveDormSettings;

window.openSwapBedModal = openSwapBedModal;
window.updateSwapFromBeds = updateSwapFromBeds;
window.updateSwapToBeds = updateSwapToBeds;
window.submitSwapBed = submitSwapBed;

window.toggleDatePicker = toggleDatePicker;
window.selectRollCallDate = selectRollCallDate;
window.toggleSquadConfirm = toggleSquadConfirm;

// ═════════════════════════════════════════════════════════════════════════════
// 硬性房間規則
// ═════════════════════════════════════════════════════════════════════════════
function applyRoomRules() {
  for (const s of state.students) {
    // 儲藏室：整間隱藏
    if (CONFIG.STORAGE_ROOMS.includes(s.room)) {
      s.hidden = true;
      continue;
    }
    // 雙人房：C、D 床隱藏
    if (CONFIG.DOUBLE_ROOMS.includes(s.room) && (s.bed === 'C' || s.bed === 'D')) {
      s.hidden = true;
      continue;
    }
    s.hidden = false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 導覽列自訂圖示
// ═════════════════════════════════════════════════════════════════════════════
const NAV_PAGES = [
  { page: 'home',     emoji: '🏠', label: '點名' },
  { page: 'summary',  emoji: '📊', label: '總表' },
  { page: 'history',  emoji: '📅', label: '歷史' },
  { page: 'settings', emoji: '⚙️', label: '設定' },
];

function applyNavIcons() {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    const page = item.dataset.page;
    const saved = localStorage.getItem('nav_icon_' + page);
    const iconEl = item.querySelector('.nav-icon');
    if (!iconEl) return;
    if (saved) {
      iconEl.innerHTML = `<img class="nav-icon-img" src="${saved}" alt="${page}">`;
    } else {
      const def = NAV_PAGES.find(n => n.page === page);
      if (def) iconEl.textContent = def.emoji;
    }
  });
}

function renderNavIconUpload() {
  const grid = document.getElementById('nav-icon-upload-grid');
  if (!grid) return;
  grid.innerHTML = NAV_PAGES.map(n => {
    const saved = localStorage.getItem('nav_icon_' + n.page);
    const previewContent = saved
      ? `<img src="${saved}" alt="${n.label}">`
      : n.emoji;
    const removeBtn = saved
      ? `<button class="icon-upload-btn remove" onclick="removeNavIcon('${n.page}')">✕</button>`
      : '';
    return `
      <div class="icon-upload-item">
        <div class="icon-upload-preview">${previewContent}</div>
        <div class="icon-upload-info">
          <div class="label">${n.label}</div>
          <div class="icon-upload-actions">
            <button class="icon-upload-btn" onclick="pickNavIcon('${n.page}')">上傳</button>
            ${removeBtn}
          </div>
        </div>
      </div>`;
  }).join('');
}

let _pendingNavIconPage = null;

function pickNavIcon(page) {
  _pendingNavIconPage = page;
  const input = document.getElementById('nav-icon-file-input');
  input.value = '';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      // 壓縮圖片到 64x64 再存入 localStorage
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 64, 64);
        const dataUrl = canvas.toDataURL('image/png');
        localStorage.setItem('nav_icon_' + _pendingNavIconPage, dataUrl);
        applyNavIcons();
        renderNavIconUpload();
        showToast('圖示已更新', 'success');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function removeNavIcon(page) {
  localStorage.removeItem('nav_icon_' + page);
  applyNavIcons();
  renderNavIconUpload();
  showToast('已恢復預設圖示', 'info');
}

window.pickNavIcon = pickNavIcon;
window.removeNavIcon = removeNavIcon;

// ═════════════════════════════════════════════════════════════════════════════
// 開發者調適區（6 位密碼保護）
// ═════════════════════════════════════════════════════════════════════════════
const DEV_PASSWORD = '147258'; // 6 位開發者密碼
let devUnlocked = false;

function openDevAuth() {
  const panel = document.getElementById('dev-panel');
  // 如果已解鎖，切換顯示/隱藏
  if (devUnlocked) {
    panel.classList.toggle('open');
    return;
  }
  // 彈出密碼輸入
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay visible';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>🔐 開發者驗證</h3>
      <p class="modal-desc">請輸入 6 位數開發者密碼</p>
      <input type="password" id="dev-pin-input" class="pin-input" maxlength="6" placeholder="••••••" inputmode="numeric" autocomplete="off">
      <div class="modal-actions">
        <button class="modal-btn cancel" id="dev-pin-cancel">取消</button>
        <button class="modal-btn confirm" id="dev-pin-confirm">解鎖</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('dev-pin-input');
  setTimeout(() => input.focus(), 100);

  const tryUnlock = () => {
    if (input.value === DEV_PASSWORD) {
      devUnlocked = true;
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
      panel.classList.add('open');
      renderNavIconUpload();
      showToast('🔓 開發者模式已解鎖', 'success');
    } else {
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 500);
      showToast('密碼錯誤', 'error');
      input.value = '';
    }
  };

  document.getElementById('dev-pin-cancel').onclick = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
  };
  document.getElementById('dev-pin-confirm').onclick = tryUnlock;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
}

window.openDevAuth = openDevAuth;

// ═════════════════════════════════════════════════════════════════════════════
// 伺服器自訂背景影片 (全域 Notion Config 儲存)
// ═════════════════════════════════════════════════════════════════════════════
function loadGlobalBgVideo() {
  // 從 Notion 全域設定讀取
  const url = state.config['bg_video_url'];
  const scale = state.config['bg_video_scale'] || 1.0;
  const opacity = state.config['bg_video_opacity'] || 0.25;
  
  const container = document.getElementById('custom-video-bg');
  const animBg = document.querySelector('.home-anim-bg');
  
  if (url) {
    container.innerHTML = `<video src="${url}" autoplay loop muted playsinline style="transform: scale(${scale}); opacity: ${opacity};"></video>`;
    if (animBg) animBg.style.display = 'none'; // 隱藏預設動畫
    
    // 同步到 UI (如果在設定頁)
    const urlInput = document.getElementById('bg-video-url');
    if (urlInput) {
      urlInput.value = url;
      document.getElementById('bg-video-scale').value = scale;
      document.getElementById('bg-video-opacity').value = opacity;
    }
  } else {
    container.innerHTML = '';
    if (animBg) animBg.style.display = 'flex';
  }
}

function previewBgVideoStyle() {
  const scale = document.getElementById('bg-video-scale').value;
  const opacity = document.getElementById('bg-video-opacity').value;
  const video = document.querySelector('#custom-video-bg video');
  
  if (video) {
    video.style.transform = `scale(${scale})`;
    video.style.opacity = opacity;
  } else {
    // 若尚未載入影片，嘗試立刻用輸入的網址做預覽
    const url = document.getElementById('bg-video-url').value.trim();
    if (url) {
      document.getElementById('custom-video-bg').innerHTML = `<video src="${url}" autoplay loop muted playsinline style="transform: scale(${scale}); opacity: ${opacity};"></video>`;
    }
  }
}

async function applyBgVideoUrl() {
  const url = document.getElementById('bg-video-url').value.trim();
  const scale = document.getElementById('bg-video-scale').value;
  const opacity = document.getElementById('bg-video-opacity').value;

  if (!url) {
    return showToast('請先輸入影片網址', 'error');
  }

  showLoading(true);
  try {
    // 儲存至 Notion 全域 Config
    await window._api.setConfig({
      bg_video_url: url,
      bg_video_scale: scale,
      bg_video_opacity: opacity
    });
    
    // 更新本地狀態
    state.config['bg_video_url'] = url;
    state.config['bg_video_scale'] = scale;
    state.config['bg_video_opacity'] = opacity;

    showToast('全域背景影片已更新', 'success');
    loadGlobalBgVideo();
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  }
  showLoading(false);
}

async function clearBgVideo() {
  showLoading(true);
  try {
    // 將 URL 設為空字串，以清除 Notion 上的設定
    await window._api.setConfig({ bg_video_url: '' });
    
    state.config['bg_video_url'] = '';
    
    const urlInput = document.getElementById('bg-video-url');
    if (urlInput) {
      urlInput.value = '';
      document.getElementById('bg-video-scale').value = 1.0;
      document.getElementById('bg-video-opacity').value = 0.25;
    }

    showToast('已恢復全域預設光球動畫', 'success');
    loadGlobalBgVideo();
  } catch (err) {
    showToast('清除失敗：' + err.message, 'error');
  }
  showLoading(false);
}

window.applyBgVideoUrl = applyBgVideoUrl;
window.previewBgVideoStyle = previewBgVideoStyle;
window.clearBgVideo = clearBgVideo;

