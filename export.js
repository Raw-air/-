/**
 * 壁苑宿舍點名系統 - Excel/CSV 匯出
 * 使用 SheetJS（xlsx）函式庫，格式仿照現有 Notion CSV
 */

import { CONFIG, formatDateChinese } from './config.js';

/**
 * 產生 Excel 匯出（格式與原 Notion CSV 一致）
 * @param {Array} roster - 所有學生花名冊
 * @param {Array} attendanceRecords - 日期範圍內的點名記錄
 * @param {Object} options - { startDate, endDate, semester }
 */
async function exportToExcel(roster, attendanceRecords, options = {}) {
  // 確保 SheetJS 已載入
  if (typeof XLSX === 'undefined') {
    throw new Error('SheetJS 函式庫尚未載入');
  }

  const { semester = CONFIG.SEMESTER } = options;

  // 建立出席查詢 Map：{ 'squad_date': { room: { bed: status } } }
  const attendanceMap = buildAttendanceMap(attendanceRecords);

  // 取得所有有資料的日期（排序好的）
  const dates = [...new Set(attendanceRecords.map(r => r.date))].sort();

  // ── 工作表一：完整點名記錄（仿 Notion 格式）───────────────────────────────

  const headers = ['名稱', '寢床號', '床號', '班別', '學號'];
  // 日期欄位轉中文
  const dateLabels = dates.map(d => {
    const parts = d.split('-');
    return `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  });
  const fullHeaders = [...headers, ...dateLabels];

  const rows = [fullHeaders];

  // 按中隊、房號、床位排序
  const sortedRoster = [...roster].sort((a, b) => {
    if (a.squad < b.squad) return -1;
    if (a.squad > b.squad) return 1;
    if (a.room < b.room) return -1;
    if (a.room > b.room) return 1;
    return a.bed.localeCompare(b.bed);
  });

  for (const student of sortedRoster) {
    const row = [
      student.name || '',
      student.room,
      student.bed,
      student.class || '',
      student.studentId || '',
    ];

    for (const date of dates) {
      const squadKey = student.squad;
      const squadData = attendanceMap[squadKey]?.[date];
      const status = squadData?.[student.room]?.[student.bed] || 'present';
      row.push(statusToSymbol(status));
    }

    rows.push(row);
  }

  // ── 工作表二：每日總表 ──────────────────────────────────────────────────────

  const summaryHeaders = [
    '日期', '總床數', '空床', '住宿人數', '外籍生', '住宿率',
    '實到', '請假', '未請假',
    '一單應到', '一單實到', '一單請假', '一單未請假',
    '一雙應到', '一雙實到', '一雙請假', '一雙未請假',
    '二單應到', '二單實到', '二單請假', '二單未請假',
    '二雙應到', '二雙實到', '二雙請假', '二雙未請假',
    '三單應到', '三單實到', '三單請假', '三單未請假',
    '三雙應到', '三雙實到', '三雙請假', '三雙未請假',
  ];

  const summaryRows = [summaryHeaders];

  for (const date of dates) {
    const squads = CONFIG.SQUADS.map(sq => sq.id);
    const squadSummaries = {};

    // 找出這一天各中隊的彙整
    for (const record of attendanceRecords) {
      if (record.date === date) {
        squadSummaries[record.squad] = {
          summary: record.summary,
          foreignCount: record.foreignCount || 0,
        };
      }
    }

    // 計算總計
    let totalShould = 0, totalPresent = 0, totalLeave = 0, totalAbsent = 0, totalEmpty = 0;
    let totalForeign = 0;

    for (const squadId of squads) {
      const s = squadSummaries[squadId]?.summary || { should: 0, present: 0, leave: 0, absent: 0, empty: 0 };
      totalShould += s.should;
      totalPresent += s.present;
      totalLeave += s.leave;
      totalAbsent += s.absent;
      totalEmpty += s.empty;
      totalForeign += squadSummaries[squadId]?.foreignCount || 0;
    }

    // 當日實際總床數（住宿 + 空床），不受目前設定影響
    const actualTotalBeds = (totalShould + totalEmpty) || CONFIG.TOTAL_BEDS;
    const occupancyRate = Math.round((totalShould / actualTotalBeds) * 100 * 10) / 10;

    const row = [
      date,
      actualTotalBeds,
      totalEmpty,
      totalShould,
      totalForeign,
      `${occupancyRate}%`,
      totalPresent,
      totalLeave,
      totalAbsent,
    ];

    for (const squadId of squads) {
      const s = squadSummaries[squadId]?.summary || { should: 0, present: 0, leave: 0, absent: 0 };
      row.push(s.should, s.present, s.leave, s.absent);
    }

    summaryRows.push(row);
  }

  // ── 建立 Workbook ──────────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  styleAttendanceSheet(ws1, rows, dateLabels.length);

  const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);

  XLSX.utils.book_append_sheet(wb, ws1, '點名記錄');
  XLSX.utils.book_append_sheet(wb, ws2, '每日總表');

  // 下載
  const filename = `${CONFIG.DORM_NAME}_${semester}_點名記錄_${new Date().toLocaleDateString('zh-TW').replace(/\//g, '')}.xlsx`;
  XLSX.writeFile(wb, filename);

  return filename;
}

/**
 * 快速匯出今日總表文字（複製用）
 * @param {Array} summaryData
 * @param {string} date
 * @param {number} [totalBeds] - 當日實際總床數（可選，預設從 summaryData 計算）
 * @param {number} [totalForeignOverride] - 當日外籍生人數（可選）
 */
function exportDailySummaryText(summaryData, date, totalBeds, totalForeignOverride) {
  const dateChinese = formatDateChinese(date);

  let totalShould = 0, totalPresent = 0, totalLeave = 0, totalAbsent = 0, totalEmpty = 0;

  for (const squad of CONFIG.SQUADS) {
    const data = summaryData.find(s => s.squad === squad.id);
    if (!data) continue;

    const s = data.summary;
    totalShould += s.should || 0;
    totalPresent += s.present || 0;
    totalLeave += s.leave || 0;
    totalAbsent += s.absent || 0;
    totalEmpty += s.empty || 0;
  }

  // 外籍生：優先使用傳入的值（當日快照），否則從 summaryData 中的 foreignCount 取
  const totalForeign = totalForeignOverride ??
    summaryData.reduce((sum, s) => sum + (s.foreignCount || 0), 0);

  // 總床數：優先使用傳入的當日快照值
  const actualBeds = totalBeds || (totalShould + totalEmpty) || CONFIG.TOTAL_BEDS;
  const occupancyRate = Math.round((totalShould / actualBeds) * 100 * 10) / 10;

  const text = [
    `【${CONFIG.DORM_NAME} ${dateChinese} 點名總表】`,
    ``,
    `總床數：${actualBeds}　空床：${totalEmpty}`,
    `住宿人數：${totalShould}　外籍生：${totalForeign}`,
    `住宿率：${occupancyRate}%`,
    ``,
    `實到：${totalPresent}　請假：${totalLeave}　未請假：${totalAbsent}`,
  ].join('\n');

  return text;
}

// ─── 輔助函式 ─────────────────────────────────────────────────────────────────

function statusToSymbol(status) {
  const map = {
    present: '✓',
    leave: '◎',
    absent: '✘',
    empty: '',   // 空床留空白
  };
  // 未知狀態預設出席（✓），但 empty 已對應空字串
  return status in map ? map[status] : '✓';
}

function buildAttendanceMap(records) {
  const map = {};
  for (const record of records) {
    const { squad, date, records: studentRecords } = record;
    if (!map[squad]) map[squad] = {};
    if (!map[squad][date]) map[squad][date] = {};

    for (const r of (studentRecords || [])) {
      if (!map[squad][date][r.room]) map[squad][date][r.room] = {};
      map[squad][date][r.room][r.bed] = r.status;
    }
  }
  return map;
}

function styleAttendanceSheet(ws, rows, dateCols) {
  // 設定欄寬
  const colWidths = [
    { wch: 12 }, // 名稱
    { wch: 8 },  // 房號
    { wch: 5 },  // 床號
    { wch: 12 }, // 班別
    { wch: 12 }, // 學號
  ];
  for (let i = 0; i < dateCols; i++) {
    colWidths.push({ wch: 6 });
  }
  ws['!cols'] = colWidths;
}

export { exportToExcel, exportDailySummaryText };
