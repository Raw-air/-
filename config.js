/**
 * 碧苑宿舍點名系統 - 設定檔
 */
const CONFIG = {
  // Cloudflare Worker 網址
  WORKER_URL: 'https://biyuan-proxy.s010828.workers.dev',

  // 當前學期
  SEMESTER: '114-2',

  // 中隊定義
  SQUADS: [
    { id: '一單', label: '一單（1F 奇數房）', color: '#6366f1', floor: 1, odd: true },
    { id: '一雙', label: '一雙（1F 偶數房）', color: '#8b5cf6', floor: 1, odd: false },
    { id: '二單', label: '二單（2F 奇數房）', color: '#3b82f6', floor: 2, odd: true },
    { id: '二雙', label: '二雙（2F 偶數房）', color: '#06b6d4', floor: 2, odd: false },
    { id: '三單', label: '三單（3F 奇數房）', color: '#10b981', floor: 3, odd: true },
    { id: '三雙', label: '三雙（3F 偶數房）', color: '#22c55e', floor: 3, odd: false },
  ],

  // 出席狀態
  STATUS: {
    '✓': { label: '在場', color: '#22c55e', icon: '✓' },
    '◎': { label: '請假', color: '#f59e0b', icon: '◎' },
    '✘': { label: '未請假', color: '#ef4444', icon: '✘' },
    '△': { label: '特殊', color: '#8b5cf6', icon: '△' },
  },

  // 自動備份間隔（毫秒）
  AUTO_SAVE_INTERVAL: 60000,

  // ── 硬性房間規則 ──
  // 雙人房：只有 A、B 床，C、D 床完全屏蔽（不顯示、不計入統計）
  DOUBLE_ROOMS: ['B118', 'B120', 'B122', 'B124', 'B126'],
  // 儲藏室：不能住人，完全隱藏
  STORAGE_ROOMS: ['B128'],
};

/** 從寢床號判斷中隊 */
function getSquadFromRoom(room) {
  if (!room) return '一單';
  const match = room.match(/B?(\d)(\d{2})/);
  if (!match) return '一單';
  const floor = match[1];
  const roomNum = parseInt(match[2]);
  const isOdd = roomNum % 2 === 1;
  if (floor === '1') return isOdd ? '一單' : '一雙';
  if (floor === '2') return isOdd ? '二單' : '二雙';
  if (floor === '3') return isOdd ? '三單' : '三雙';
  return '一單';
}

/** 取得中隊顏色 */
function getSquadColor(squadId) {
  const sq = CONFIG.SQUADS.find(s => s.id === squadId);
  return sq ? sq.color : '#666';
}

/** 取得今天的日期欄位名稱（如 "4月10日"）*/
function getTodayColumnName() {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日`;
}

/** 解析日期欄位名稱為 Date 物件（使用今年）*/
function parseDateColumnToDate(name) {
  const m = name.match(/(\d+)月(\d+)日/);
  if (!m) return null;
  const d = new Date();
  d.setMonth(parseInt(m[1]) - 1, parseInt(m[2]));
  d.setHours(0, 0, 0, 0);
  return d;
}

// 匯出為全域
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
  window.getSquadFromRoom = getSquadFromRoom;
  window.getSquadColor = getSquadColor;
  window.getTodayColumnName = getTodayColumnName;
  window.parseDateColumnToDate = parseDateColumnToDate;
}
