/**
 * 壁苑宿舍點名系統 - 設定檔
 *
 * ⚠️ 部署前請修改以下設定：
 * 1. WORKER_URL：填入你的 Cloudflare Worker 網址
 * 2. SEMESTER：填入當前學期（格式：114-2）
 */

const CONFIG = {
  // ── 必填設定 ────────────────────────────────────────────────────────────────
  // Cloudflare Worker 網址（部署後會得到，格式如下）
  WORKER_URL: 'https://biyuan-proxy.s010828.workers.dev',

  // 當前學期（學年-學期，如：114-2 表示民國114學年度第2學期）
  SEMESTER: '114-2',

  // 宿舍名稱（顯示用）
  DORM_NAME: '碧苑宿舍',

  // 總床數（固定數值）
  TOTAL_BEDS: 226,

  // ── 六個中隊設定 ─────────────────────────────────────────────────────────────
  SQUADS: [
    { id: '一單', label: '一單', floor: 1, parity: 'odd',  emoji: '1️⃣', color: '#6366f1' },
    { id: '一雙', label: '一雙', floor: 1, parity: 'even', emoji: '1️⃣', color: '#8b5cf6' },
    { id: '二單', label: '二單', floor: 2, parity: 'odd',  emoji: '2️⃣', color: '#3b82f6' },
    { id: '二雙', label: '二雙', floor: 2, parity: 'even', emoji: '2️⃣', color: '#06b6d4' },
    { id: '三單', label: '三單', floor: 3, parity: 'odd',  emoji: '3️⃣', color: '#10b981' },
    { id: '三雙', label: '三雙', floor: 3, parity: 'even', emoji: '3️⃣', color: '#22c55e' },
  ],

  // ── 自動同步 ─────────────────────────────────────────────────────────────────
  // 自動備份間隔（毫秒），預設 60 秒
  AUTO_SYNC_INTERVAL: 60000,

  // ── 點名狀態定義 ──────────────────────────────────────────────────────────────
  STATUSES: {
    present: { label: '在場', symbol: '✓', color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
    leave:   { label: '請假', symbol: 'O', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
    absent:  { label: '未請假', symbol: '✘', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
    empty:   { label: '空床', symbol: '—', color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
  },

  // ── 管理員 PIN（預設 0000，請在設定頁面修改）──────────────────────────────────
  // 實際 PIN 儲存在 Notion Config 資料庫，這只是本地預設
  DEFAULT_ADMIN_PIN: '0000',
};

// 房號 → 中隊 對應邏輯
function getRoomSquad(roomCode) {
  const match = roomCode.match(/^B(\d)(\d{2})$/);
  if (!match) return null;

  const floor = parseInt(match[1]);
  const roomNum = parseInt(match[2]);
  const parity = roomNum % 2 === 1 ? 'odd' : 'even';
  const parityLabel = parity === 'odd' ? '單' : '雙';

  const floorLabels = { 1: '一', 2: '二', 3: '三' };
  const floorLabel = floorLabels[floor];

  if (!floorLabel) return null;
  return `${floorLabel}${parityLabel}`;
}

// 取得中隊設定物件
function getSquadConfig(squadId) {
  return CONFIG.SQUADS.find(s => s.id === squadId) || null;
}

// 格式化日期為 YYYY-MM-DD
function formatDate(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 格式化日期為中文顯示
function formatDateChinese(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 計算住宿率
function calcOccupancyRate(residents, totalBeds = CONFIG.TOTAL_BEDS) {
  return Math.round((residents / totalBeds) * 100 * 10) / 10;
}

export { CONFIG, getRoomSquad, getSquadConfig, formatDate, formatDateChinese, calcOccupancyRate };
