/**
 * 壁苑宿舍點名系統 - CSV 解析 + 學期導入
 */

import { getRoomSquad, CONFIG } from './config.js';

/**
 * 解析 Notion 匯出的 CSV 內容
 * 支援現有的碧苑點名單格式
 */
function parseNotionCsv(csvText) {
  const lines = csvText.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length < 2) throw new Error('CSV 格式錯誤：檔案太短');

  // 第一行是表頭
  const headers = parseRow(lines[0]);

  // 找到日期欄位的起始索引（第6欄開始是日期，格式：2月20日）
  const FIXED_COLS = ['名稱', '寢床號', '床號', '班別', '學號'];
  const dateColStart = 5; // 固定：第6欄（0-indexed: 5）開始是日期

  // 解析學生資料（跳過表頭、空行、底部統計行）
  const students = [];
  const dataRows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseRow(line);
    const roomCode = cols[1] || '';
    const bedCode = cols[2] || '';

    // 跳過非學生資料（房號格式應為 B+數字）
    if (!roomCode.match(/^B\d{3}$/)) continue;
    // 跳過床號不合法的（應為 A/B/C/D）
    if (!['A', 'B', 'C', 'D'].includes(bedCode)) continue;

    dataRows.push({ cols, index: i });
  }

  // 取得日期欄位列表
  const dateColumns = [];
  for (let col = dateColStart; col < headers.length; col++) {
    const h = headers[col];
    // 符合 N月N日 格式
    if (h && h.match(/^\d+月\d+日$/)) {
      dateColumns.push({ index: col, label: h });
    }
  }

  // 建立學生資料
  for (const { cols } of dataRows) {
    const name = cols[0] || '';
    const room = cols[1] || '';
    const bed = cols[2] || '';
    const cls = cols[3] || '';
    const studentId = cols[4] || '';

    const squad = getRoomSquad(room);
    if (!squad) continue; // 無法識別中隊的跳過

    const isEmpty = !name.trim(); // 名稱為空 = 空床
    const isForeign = detectForeign(cls, studentId, name);

    // 收集出席歷史（完全匹配 Notion Select 選項）
    const attendanceHistory = {};
    for (const { index, label } of dateColumns) {
      let status = (cols[index] || '').trim();
      if (!status) status = '✓'; // 預設出席
      if (status === '✘' || status === '✗') status = 'X'; // 統一未請假符號為全大寫英文字母 X (或者依用戶原意，如果用戶CSV裡有X就把全形X轉成X)
      // 假設你提供的選項裡有 '✘' (紅)，我們在 worker 已經設成 '✘'，這裡就不去改變'✘'但如果選項是英文字'X'
      // 我們剛剛在 worker 設定了 options 包含: { name: 'X', color: 'red' }, { name: '✘', color: 'red' }
      attendanceHistory[label] = status;
    }

    students.push({
      name: name.trim(),
      room,
      bed,
      class: cls.trim(),
      studentId: studentId.trim(),
      squad,
      isForeign,
      isEmpty,
      attendanceHistory,
    });
  }

  if (students.length === 0) {
    throw new Error('CSV 中找不到有效的學生資料');
  }

  return {
    students,
    dateColumns,
    totalStudents: students.filter(s => !s.isEmpty).length,
    totalBeds: students.length,
    squads: groupBySquad(students),
  };
}

/**
 * 解析單行 CSV（支援引號和逗號）
 */
function parseRow(line) {
  const result = [];
  let col = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        col += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        col += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(col);
        col = '';
      } else {
        col += char;
      }
    }
  }
  result.push(col);
  return result;
}

/**
 * 將出席符號轉為狀態字串
 */
function parseSymbol(symbol) {
  const s = symbol.trim();
  if (s === '✓') return 'present';
  if (s === '◎' || s === 'O') return 'leave';
  if (s === '✘' || s === '✗') return 'absent';
  if (s === '△') return 'present'; // 特殊在場
  return 'present'; // 預設在場
}

/**
 * 偵測是否為外籍生（根據班別/學號）
 * 目前邏輯：越南華語專班 = 外籍生
 * 如有其他外籍生定義請在此修改
 */
function detectForeign(cls, studentId, name) {
  if (cls.includes('越南華語')) return true;
  if (cls.includes('華語專班')) return true;
  // 非中文名字（含拉丁字母）
  // 不自動偵測，由管理員手動設定
  return false;
}

/**
 * 依中隊分組
 */
function groupBySquad(students) {
  const groups = {};
  for (const s of students) {
    if (!groups[s.squad]) groups[s.squad] = [];
    groups[s.squad].push(s);
  }
  return groups;
}

/**
 * 驗證 CSV 匯入結果的完整性
 */
function validateImport(parsed) {
  const warnings = [];
  const { students, squads } = parsed;

  // 檢查是否有六個中隊的資料
  const expectedSquads = ['一單', '一雙', '二單', '二雙', '三單', '三雙'];
  for (const s of expectedSquads) {
    if (!squads[s] || squads[s].length === 0) {
      warnings.push(`⚠️ 中隊「${s}」沒有學生資料`);
    }
  }

  // 匯總資訊
  const info = {
    totalBeds: students.length,
    totalStudents: students.filter(s => !s.isEmpty).length,
    foreignStudents: students.filter(s => s.isForeign).length,
    emptyBeds: students.filter(s => s.isEmpty).length,
    bySquad: Object.fromEntries(
      Object.entries(squads).map(([sq, list]) => [sq, {
        total: list.length,
        students: list.filter(s => !s.isEmpty).length,
        empty: list.filter(s => s.isEmpty).length,
        foreign: list.filter(s => s.isForeign).length,
      }])
    ),
  };

  return { warnings, info };
}

/**
 * 產生歷史出席記錄（從現有 CSV 恢復歷史資料）
 * 用於學期初匯入時同步舊有出席資料
 */
function extractHistoricalAttendance(parsed) {
  const { students, dateColumns } = parsed;
  const byDate = {};

  for (const dateCol of dateColumns) {
    const squads = {};

    for (const student of students) {
      if (student.isEmpty) continue;
      if (!squads[student.squad]) squads[student.squad] = [];

      const status = student.attendanceHistory[dateCol.label] || 'present';
      squads[student.squad].push({
        room: student.room,
        bed: student.bed,
        name: student.name,
        status,
      });
    }

    byDate[dateCol.label] = squads;
  }

  return byDate;
}

/**
 * 將 CSV 的日期標籤（如「2月20日」）轉換為 ISO 格式 YYYY-MM-DD
 * 根據學期推算年份：
 *   114-2 → 民國114學年度第2學期（~2026年2月～7月）
 *   114-1 → 民國114學年度第1學期（~2025年9月～2026年1月）
 */
function convertDateLabel(label, semester = '114-2') {
  const match = label.match(/^(\d+)月(\d+)日$/);
  if (!match) return null;

  const month = parseInt(match[1]);
  const day = parseInt(match[2]);

  // 解析學期：ROC年-學期號
  const parts = semester.split('-');
  const rocYear = parseInt(parts[0]);
  const semNum = parseInt(parts[1]);
  const ceYear = rocYear + 1911;

  // 第2學期（約2月-7月）→ 民國年 + 1912
  // 第1學期（約9月-隔1月）→ 9-12月用 ceYear，1月用 ceYear+1
  let year;
  if (semNum === 2) {
    year = ceYear + 1;
  } else {
    year = month >= 8 ? ceYear : ceYear + 1;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export {
  parseNotionCsv,
  parseSymbol,
  validateImport,
  extractHistoricalAttendance,
  convertDateLabel,
  groupBySquad,
};
