// 大改版通知：更新後第一次打開 APP 跳一次，按「知道了」後這台裝置不再跳。下次大改版換 NOTICE_ID 就會再跳。
(function () {
  const NOTICE_ID = 'v33-moving-day';
  const SEEN_KEY = 'biyuan_release_notice_seen';
  const CHECK_MS = 300;

  // 搬家小圖：蝸牛 (Notion) → 貨車 → 火焰 (Firebase)。自帶深色底，淺色主題也看得清楚
  const MOVING_DAY_SVG = `
    <svg viewBox="0 0 320 124" role="img" aria-label="貨車載著 228 床資料從 Notion 搬到 Firebase，讀總表從 3.4 秒變 0.3 秒" style="display:block;width:100%;height:auto;border-radius:14px">
      <defs>
        <linearGradient id="rn-sky" x1="0" x2="1"><stop offset="0" stop-color="#1b2138"/><stop offset="1" stop-color="#3a1f16"/></linearGradient>
        <linearGradient id="rn-fire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff5a1f"/><stop offset="1" stop-color="#ffd23f"/></linearGradient>
      </defs>
      <style>
        @keyframes rn-drive { 0%, 100% { transform: translate(-7px, 0); } 25% { transform: translate(0, -1.5px); } 50% { transform: translate(7px, 0); } 75% { transform: translate(0, -1.5px); } }
        @keyframes rn-flicker { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07, .95); } }
        .rn-truck { animation: rn-drive 2.4s ease-in-out infinite; }
        .rn-flame { animation: rn-flicker .7s ease-in-out infinite; transform-origin: 274px 80px; }
        @media (prefers-reduced-motion: reduce) { .rn-truck, .rn-flame { animation: none; } }
      </style>
      <rect width="320" height="124" fill="url(#rn-sky)"/>
      <line x1="10" y1="92" x2="310" y2="92" stroke="#ffffff" stroke-opacity=".28" stroke-width="2" stroke-dasharray="7 7"/>

      <g fill="none" stroke-linecap="round">
        <path d="M24 92 h44 q6 0 6 -6 v-2 h-6 q-2 6 -8 6 h-36 z" fill="#b9c2d8" stroke="none"/>
        <path d="M70 84 l3 -11 M74 85 l6 -9" stroke="#b9c2d8" stroke-width="2"/>
        <circle cx="46" cy="74" r="15" fill="#7c86a8"/>
        <path d="M46 74 a4 4 0 0 1 6 3 a8 8 0 0 1 -12 3 a11 11 0 0 1 2 -17" stroke="#ffffff" stroke-opacity=".75" stroke-width="2"/>
      </g>
      <text x="46" y="26" text-anchor="middle" fill="#ffffff" font-size="15" font-weight="800">3.4 秒</text>
      <text x="46" y="45" text-anchor="middle" fill="#b9c2d8" font-size="11" font-weight="600">Notion</text>
      <text x="46" y="110" text-anchor="middle" fill="#b9c2d8" font-size="10">轉任備援</text>

      <g class="rn-truck">
        <path d="M102 58 h-14 M108 70 h-24 M102 82 h-12" stroke="#ffffff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
        <rect x="112" y="46" width="64" height="38" rx="4" fill="#f4f6fb"/>
        <text x="144" y="62" text-anchor="middle" fill="#1b2138" font-size="11" font-weight="800">228 床</text>
        <text x="144" y="77" text-anchor="middle" fill="#1b2138" font-size="9" font-weight="600">3 萬格點名</text>
        <path d="M178 56 h13 l12 14 v14 h-25 z" fill="#ff7a30"/>
        <path d="M182 60 h7 l7 9 h-14 z" fill="#20263f"/>
        <circle cx="130" cy="86" r="6.5" fill="#20263f" stroke="#f4f6fb" stroke-width="2"/>
        <circle cx="189" cy="86" r="6.5" fill="#20263f" stroke="#f4f6fb" stroke-width="2"/>
      </g>

      <path class="rn-flame" d="M274 48 c5 11 18 15 18 30 a18 15 0 0 1 -36 0 c0 -8 5 -12 8 -19 c2 5 4 7 6 8 c1 -7 1 -13 4 -19 z" fill="url(#rn-fire)"/>
      <text x="274" y="26" text-anchor="middle" fill="#ffffff" font-size="15" font-weight="800">0.3 秒</text>
      <text x="274" y="42" text-anchor="middle" fill="#ffc9a8" font-size="11" font-weight="600">Firebase</text>
      <text x="274" y="110" text-anchor="middle" fill="#ffc9a8" font-size="10">新家</text>
    </svg>`;

  const seen = () => { try { return localStorage.getItem(SEEN_KEY) === NOTICE_ID; } catch { return false; } };
  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, NOTICE_ID); } catch {} };

  // 開機畫面、資料載入都結束才跳，免得被蓋住
  function bootDone() {
    if (document.body.classList.contains('rawair-booting')) return false;
    const loading = document.getElementById('loading-overlay');
    return !loading || loading.classList.contains('exit-drop') || loading.style.display === 'none';
  }

  function show() {
    const overlay = document.createElement('div');
    overlay.id = 'release-notice';
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:360px;max-height:88vh;overflow-y:auto">
        ${MOVING_DAY_SVG}
        <h3 style="margin:12px 0 8px">系統大改版 v33：資料庫搬家完成</h3>
        <p style="margin:0 0 10px;line-height:1.6;font-size:14px">整座資料庫連夜搬到 Firebase。228 床、3 萬多格點名紀錄全數到齊，沒有一位住宿生被吵醒。</p>
        <ul style="margin:0 0 14px;padding-left:20px;line-height:1.6;font-size:13px;text-align:left">
          <li>讀總表從 3.4 秒變 0.3 秒，泡麵可以收起來了。</li>
          <li>手機一點請假，別台不到 1 秒就知道，想裝沒看到都難。</li>
          <li>Notion 沒有退休，改當備援：資料隨時留一份，Firebase 鬧脾氣就換它上場。</li>
        </ul>
        <button type="button" class="modal-btn confirm" style="width:100%">朕知道了</button>
      </div>`;
    overlay.querySelector('button').addEventListener('click', () => {
      markSeen();
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 260);
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  if (seen() || navigator.webdriver) return; // 自動化測試不跳，免得擋住其他測試的點擊
  const timer = setInterval(() => {
    if (!bootDone()) return;
    clearInterval(timer);
    show();
  }, CHECK_MS);
})();
