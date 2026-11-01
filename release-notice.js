// 大改版通知：更新後第一次打開 APP 跳一次，按「知道了」後這台裝置不再跳。下次大改版換 NOTICE_ID 就會再跳。
(function () {
  const NOTICE_ID = 'v33-tray';
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

  // 教學動畫：按住 → 震動 → 跳出選取盤 → 拖到備註 → 往外選沒繳回瓷扣 → 點名列掛上瓷扣圖示。一輪 7 秒
  const TRAY_TUTORIAL_SVG = `
    <svg viewBox="0 0 320 176" role="img" aria-label="教學動畫：長按住宿生，圓形選取盤跳出來，往備註方向拖，再往外拖到沒繳回瓷扣後放開，點名列就會出現圓形瓷扣圖示" style="display:block;width:100%;height:auto;border-radius:14px;margin-top:4px">
      <style>
        @keyframes rt-finger {
          0% { transform: translate(160px, 190px); opacity: 0; }
          8% { transform: translate(160px, 146px); opacity: 1; }
          30% { transform: translate(160px, 146px); opacity: 1; }
          44% { transform: translate(160px, 55px); opacity: 1; }
          50% { transform: translate(160px, 55px); opacity: 1; }
          64% { transform: translate(96.3px, 63.6px); opacity: 1; }
          70% { transform: translate(96.3px, 63.6px); opacity: 0; }
          100% { transform: translate(96.3px, 63.6px); opacity: 0; }
        }
        @keyframes rt-pulse { 0% { transform: scale(.5); opacity: 0; } 8% { opacity: 0; } 12% { opacity: .8; } 28% { transform: scale(1.7); opacity: 0; } 100% { opacity: 0; } }
        @keyframes rt-inner { 0%, 29% { opacity: 0; transform: scale(.72); } 33%, 68% { opacity: 1; transform: scale(1); } 72%, 100% { opacity: 0; transform: scale(.9); } }
        @keyframes rt-outer { 0%, 46% { opacity: 0; } 50%, 68% { opacity: 1; } 72%, 100% { opacity: 0; } }
        @keyframes rt-remark-hot { 0%, 41% { fill: #24252e; } 44%, 56% { fill: #0a84ff; } 60%, 100% { fill: #24252e; } }
        @keyframes rt-ceramic-hot { 0%, 60% { fill: #33270f; } 63%, 100% { fill: #0a84ff; } }
        @keyframes rt-mark { 0%, 69% { opacity: 0; } 73%, 96% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes rt-dim { 0%, 29% { opacity: 0; } 33%, 68% { opacity: .6; } 72%, 100% { opacity: 0; } }
        .rt-finger { animation: rt-finger 7s ease-in-out infinite; }
        .rt-pulse { animation: rt-pulse 7s linear infinite; transform-box: fill-box; transform-origin: center; }
        .rt-inner { animation: rt-inner 7s ease-out infinite; transform-origin: 160px 90px; }
        .rt-outer { animation: rt-outer 7s ease-out infinite; }
        .rt-remark-hot { animation: rt-remark-hot 7s linear infinite; }
        .rt-ceramic-hot { animation: rt-ceramic-hot 7s linear infinite; }
        .rt-mark { animation: rt-mark 7s linear infinite; }
        .rt-dim { animation: rt-dim 7s linear infinite; }
        .rt-text { fill: #fff; font-weight: 800; text-anchor: middle; }
        @media (prefers-reduced-motion: reduce) {
          .rt-finger, .rt-pulse, .rt-inner, .rt-outer, .rt-remark-hot, .rt-ceramic-hot, .rt-mark, .rt-dim { animation: none; }
          .rt-finger { transform: translate(96.3px, 63.6px); }
          .rt-dim { opacity: 0; }
        }
      </style>
      <rect width="320" height="176" fill="#15171f"/>

      <rect x="18" y="126" width="284" height="40" rx="10" fill="#262832" stroke="#3b3e4c"/>
      <rect x="28" y="134" width="24" height="24" rx="6" fill="#6366f1"/>
      <text x="40" y="151" class="rt-text" font-size="12">A</text>
      <text x="62" y="146" fill="#fff" font-size="12" font-weight="700">住宿生</text>
      <g class="rt-mark">
        <circle cx="111" cy="142" r="7" fill="#f4f1e8" stroke="#8d8a7c"/>
        <circle cx="111" cy="142" r="4" fill="none" stroke="#2f6fb5" stroke-width="1.2"/>
        <circle cx="111" cy="142" r="1.4" fill="#2f6fb5"/>
        <rect x="62" y="150" width="58" height="13" rx="6.5" fill="#f59e0b" fill-opacity=".2"/>
        <text x="91" y="160" text-anchor="middle" fill="#f5b342" font-size="8.5" font-weight="700">沒繳回瓷扣</text>
      </g>
      <rect x="252" y="136" width="40" height="20" rx="7" fill="#22c55e" fill-opacity=".15" stroke="#22c55e" stroke-opacity=".4"/>
      <text x="272" y="150" text-anchor="middle" fill="#22c55e" font-size="10" font-weight="700">在場</text>

      <rect class="rt-dim" width="320" height="176" fill="#000"/>

      <g fill="none" stroke="#7cc4ff" stroke-width="2">
        <circle class="rt-pulse" cx="160" cy="146" r="16"/>
        <circle class="rt-pulse" cx="160" cy="146" r="16" style="animation-delay:.28s"/>
        <circle class="rt-pulse" cx="160" cy="146" r="16" style="animation-delay:.48s"/>
        <circle class="rt-pulse" cx="160" cy="146" r="16" style="animation-delay:.62s"/>
      </g>

      <g class="rt-outer"><path class="rt-ceramic-hot" d="M76 87.8A84 84 0 0 1 99.1 32.2L120.8 52.8A54 54 0 0 0 106 88.6Z" fill="#33270f" stroke="#c9a24f"/><text x="96.3" y="58.9" dy=".35em" class="rt-text" font-size="7.5">沒繳回</text><text x="96.3" y="68.3" dy=".35em" class="rt-text" font-size="7.5">瓷扣</text></g>
      <g class="rt-outer"><path class="" d="M102.2 29.1A84 84 0 0 1 157.8 6L158.6 36A54 54 0 0 0 122.8 50.8Z" fill="#33270f" stroke="#c9a24f"/><text x="133.6" y="21.6" dy=".35em" class="rt-text" font-size="7.5">沒住宿</text><text x="133.6" y="31.1" dy=".35em" class="rt-text" font-size="7.5">同意書</text></g>
      <g class="rt-outer"><path class="" d="M162.2 6A84 84 0 0 1 217.8 29.1L197.2 50.8A54 54 0 0 0 161.4 36Z" fill="#33270f" stroke="#c9a24f"/><text x="186.4" y="26.3" dy=".35em" class="rt-text" font-size="7.5">找教官</text></g>
      <g class="rt-outer"><path class="" d="M220.9 32.2A84 84 0 0 1 244 87.8L214 88.6A54 54 0 0 0 199.2 52.8Z" fill="#33270f" stroke="#c9a24f"/><text x="223.7" y="63.6" dy=".35em" class="rt-text" font-size="7.5">有狀況!</text></g>
      <g class="rt-inner"><circle cx="160" cy="90" r="53" fill="#0c0c12" stroke="#c9a24f" stroke-width="1.5"/></g>
      <g class="rt-inner"><path class="rt-remark-hot" d="M115.7 62.8A52 52 0 0 1 204.3 62.8L175.3 80.6A18 18 0 0 0 144.7 80.6Z" fill="#24252e" stroke="#c9a24f" stroke-opacity=".6"/><text x="160" y="55" dy=".35em" class="rt-text" font-size="10">備註</text></g>
      <g class="rt-inner"><path class="" d="M205.7 65.2A52 52 0 0 1 161.4 142L160.5 108A18 18 0 0 0 175.8 81.4Z" fill="#24252e" stroke="#c9a24f" stroke-opacity=".6"/><text x="190.3" y="107.5" dy=".35em" class="rt-text" font-size="10">電話</text></g>
      <g class="rt-inner"><path class="" d="M158.6 142A52 52 0 0 1 114.3 65.2L144.2 81.4A18 18 0 0 0 159.5 108Z" fill="#24252e" stroke="#c9a24f" stroke-opacity=".6"/><text x="129.7" y="107.5" dy=".35em" class="rt-text" font-size="10">晚歸</text></g>
      <g class="rt-inner"><circle cx="160" cy="90" r="16" fill="#0c0c12" stroke="#c9a24f" stroke-width="1.5"/></g>

      <g class="rt-finger">
        <circle r="10" fill="#fff" fill-opacity=".85" stroke="#0a84ff" stroke-width="2"/>
      </g>
    </svg>`;

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
        <h3 style="margin:0 0 8px;font-size:16px">新招式：長按住宿生</h3>
        <p style="margin:0 0 8px;line-height:1.6;font-size:14px">點一下照舊換狀態。按住不放，手機會越震越急，像教官走近的腳步聲。圓形選取盤跳出來後別放手，往選項的方向拖再放開：</p>
        ${TRAY_TUTORIAL_SVG}
        <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.6;font-size:13px;text-align:left">
          <li>晚歸：掛上標記，總表照算在場，人回來了就是回來了。</li>
          <li>電話：拖過去就看到號碼，放開可以直接撥。</li>
          <li>備註：再往外拖，有沒繳回瓷扣、沒住宿同意書、找教官、有狀況!。備註會一直掛在點名頁，沒繳回瓷扣還會多一顆圓形瓷扣，想賴也賴不掉。</li>
        </ul>
        <button type="button" class="modal-btn confirm" style="width:100%;position:sticky;bottom:0">朕知道了</button>
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
