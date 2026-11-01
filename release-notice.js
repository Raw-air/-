// 大改版通知：更新後第一次打開 APP 跳一次，按「知道了」後這台裝置不再跳。下次大改版換 NOTICE_ID 就會再跳。
(function () {
  const NOTICE_ID = 'v33-tray-2';
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
    <svg viewBox="0 0 320 176" role="img" aria-label="教學動畫：長按住宿生，格子越抖越快後彈出圓形選取盤，往備註方向拖，再往外拖到瓷扣圖案後放開，點名列就會掛上圓形瓷扣圖案" style="display:block;width:100%;height:auto;border-radius:14px;margin-top:4px">
      <defs>
        <linearGradient id="rt-raised" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3b44"/><stop offset="1" stop-color="#26262c"/></linearGradient>
        <linearGradient id="rt-edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
        <radialGradient id="rt-shadow"><stop offset=".72" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      </defs>
      <style>
        @keyframes rt-finger {
          0% { transform: translate(160px, 190px); opacity: 0; }
          8% { transform: translate(160px, 146px); opacity: 1; }
          30% { transform: translate(160px, 146px); opacity: 1; }
          44% { transform: translate(160px, 56px); opacity: 1; }
          50% { transform: translate(160px, 56px); opacity: 1; }
          64% { transform: translate(97.2px, 64px); opacity: 1; }
          70% { transform: translate(97.2px, 64px); opacity: 0; }
          100% { transform: translate(97.2px, 64px); opacity: 0; }
        }
        @keyframes rt-row { 0%, 9.9% { transform: translateX(0); } 10.00% { transform: translateX(-0.6px); } 11.29% { transform: translateX(0.8px); } 12.57% { transform: translateX(-0.9px); } 13.86% { transform: translateX(1.1px); } 15.14% { transform: translateX(-1.3px); } 16.43% { transform: translateX(1.5px); } 17.71% { transform: translateX(-1.6px); } 19.00% { transform: translateX(1.8px); } 20.29% { transform: translateX(-2px); } 21.57% { transform: translateX(2.1px); } 22.86% { transform: translateX(-2.3px); } 24.14% { transform: translateX(2.5px); } 25.43% { transform: translateX(-2.7px); } 26.71% { transform: translateX(2.8px); } 28.00% { transform: translateX(-3px); } 28.1%, 100% { transform: translateX(0); } }
        @keyframes rt-pulse { 0%, 10% { transform: scale(.5); opacity: 0; } 14% { opacity: .75; } 28% { transform: scale(1.7); opacity: 0; } 100% { opacity: 0; } }
        @keyframes rt-inner { 0%, 28.9% { opacity: 0; transform: scale(.2); } 31% { opacity: 1; transform: scale(1.13); } 33% { transform: scale(.95); } 35% { transform: scale(1.03); } 37%, 68% { opacity: 1; transform: scale(1); } 71%, 100% { opacity: 0; transform: scale(.75); } }
        @keyframes rt-outer { 0%, 44.9% { opacity: 0; transform: scale(.7) rotate(0deg); } 47% { opacity: 1; transform: scale(1.06); } 49% { transform: scale(.97); } 51%, 68% { opacity: 1; transform: scale(1); } 71%, 100% { opacity: 0; transform: scale(.75); } }
        @keyframes rt-remark-hot { 0%, 41% { fill: #26262c; } 44%, 56% { fill: #0a84ff; } 60%, 100% { fill: #26262c; } }
        @keyframes rt-ceramic-hot { 0%, 60% { fill: #26262c; } 63%, 100% { fill: #0a84ff; } }
        @keyframes rt-mark { 0%, 70% { opacity: 0; transform: scale(.2); } 73% { opacity: 1; transform: scale(1.3); } 75% { transform: scale(.9); } 77%, 96% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1); } }
        .rt-finger { animation: rt-finger 7s ease-in-out infinite; }
        .rt-row { animation: rt-row 7s linear infinite; }
        .rt-pulse { animation: rt-pulse 7s linear infinite; transform-box: fill-box; transform-origin: center; }
        .rt-inner { animation: rt-inner 7s linear infinite; transform-origin: 160px 90px; }
        .rt-outer { animation: rt-outer 7s linear infinite; transform-origin: 160px 90px; }
        .rt-remark-hot { animation: rt-remark-hot 7s linear infinite; }
        .rt-ceramic-hot { animation: rt-ceramic-hot 7s linear infinite; }
        .rt-mark { animation: rt-mark 7s linear infinite; transform-origin: 112px 144px; }
        .rt-text { fill: #fff; font-weight: 700; text-anchor: middle; }
        @media (prefers-reduced-motion: reduce) {
          .rt-finger, .rt-row, .rt-pulse, .rt-inner, .rt-outer, .rt-remark-hot, .rt-ceramic-hot, .rt-mark { animation: none; }
          .rt-finger { transform: translate(97.2px, 64px); }
        }
      </style>
      <rect width="320" height="176" fill="#15171f"/>

      <g class="rt-row">
        <rect x="18" y="126" width="284" height="40" rx="10" fill="#262832" stroke="#3b3e4c"/>
        <rect x="28" y="134" width="24" height="24" rx="6" fill="#6366f1"/>
        <text x="40" y="150.500" class="rt-text" font-size="12">A</text>
        <text x="62" y="150" fill="#fff" font-size="12" font-weight="700">住宿生</text>
        <g class="rt-mark"><svg x="102" y="134" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f6f2e7" stroke="#8d8a7c" stroke-width="1.500"/><circle cx="12" cy="12" r="6.500" fill="none" stroke="#2f6fb5" stroke-width="1.700"/><circle cx="12" cy="12" r="2.300" fill="#2f6fb5"/></svg></g>
        <rect x="252" y="136" width="40" height="20" rx="7" fill="#22c55e" fill-opacity=".15" stroke="#22c55e" stroke-opacity=".4"/>
        <text x="272" y="150" text-anchor="middle" fill="#22c55e" font-size="10" font-weight="700">在場</text>
      </g>

      <g fill="none" stroke="#7cc4ff" stroke-width="2">
        <circle class="rt-pulse" cx="160" cy="146" r="16"/>
        <circle class="rt-pulse" cx="160" cy="146" r="16" style="animation-delay:.28s"/>
        <circle class="rt-pulse" cx="160" cy="146" r="16" style="animation-delay:.48s"/>
      </g>

      <g class="rt-outer"><path class="rt-ceramic-hot" d="M76 87.8A84 84 0 0 1 99.1 32.2L123 54.9A51 51 0 0 0 109 88.7Z" fill="url(#rt-raised)" stroke="#121216"/><path d="M77.1 87.1A83 83 0 0 1 99.3 33.4L122 54.5A52 52 0 0 0 108 88.2Z" fill="none" stroke="url(#rt-edge)"/><svg x="87.2" y="54" width="20" height="20" viewBox="0 0 24 24" overflow="visible"><circle cx="12" cy="12" r="10" fill="#f6f2e7" stroke="#8d8a7c" stroke-width="1.500"/><circle cx="12" cy="12" r="6.500" fill="none" stroke="#2f6fb5" stroke-width="1.700"/><circle cx="12" cy="12" r="2.300" fill="#2f6fb5"/></svg></g>
      <g class="rt-outer"><path class="" d="M102.2 29.1A84 84 0 0 1 157.8 6L158.7 39A51 51 0 0 0 124.9 53Z" fill="url(#rt-raised)" stroke="#121216"/><path d="M103.4 29.3A83 83 0 0 1 157.1 7.1L158.2 38A52 52 0 0 0 124.5 52Z" fill="none" stroke="url(#rt-edge)"/><svg x="124" y="17.2" width="20" height="20" viewBox="0 0 24 24" overflow="visible"><path d="M5 2.500h10.500L19.500 6.500V21.500H5z" fill="#fbfbf7" stroke="#8b8f98" stroke-width="1.400" stroke-linejoin="round"/><path d="M8 9h8M8 12.500h8M8 16h4" stroke="#8b8f98" stroke-width="1.500" stroke-linecap="round"/><circle cx="17.500" cy="18" r="4.500" fill="#ef4444"/></svg></g>
      <g class="rt-outer"><path class="" d="M162.2 6A84 84 0 0 1 217.8 29.1L195.1 53A51 51 0 0 0 161.3 39Z" fill="url(#rt-raised)" stroke="#121216"/><path d="M162.9 7.1A83 83 0 0 1 216.6 29.3L195.5 52A52 52 0 0 0 161.8 38Z" fill="none" stroke="url(#rt-edge)"/><svg x="176" y="17.2" width="20" height="20" viewBox="0 0 24 24" overflow="visible"><path d="M3 9.500 12 5l9 4.500-2.500 2.200h-13z" fill="#27406f" stroke="#172845" stroke-width="1.200" stroke-linejoin="round"/><path d="M6.500 12.500h11V14a5.500 5.500 0 0 1-11 0z" fill="#f2c6a0"/><path d="M5 22c.5-3.500 3.300-5 7-5s6.500 1.500 7 5z" fill="#27406f"/></svg></g>
      <g class="rt-outer"><path class="" d="M220.9 32.2A84 84 0 0 1 244 87.8L211 88.7A51 51 0 0 0 197 54.9Z" fill="url(#rt-raised)" stroke="#121216"/><path d="M220.7 33.4A83 83 0 0 1 242.9 87.1L212 88.2A52 52 0 0 0 198 54.5Z" fill="none" stroke="url(#rt-edge)"/><svg x="212.8" y="54" width="20" height="20" viewBox="0 0 24 24" overflow="visible"><path d="M12 2.800 22.500 21h-21z" fill="#f59e0b" stroke="#a65f00" stroke-width="1.300" stroke-linejoin="round"/><path d="M12 9v6" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/><circle cx="12" cy="18" r="1.500" fill="#fff"/></svg></g>
      <g class="rt-inner"><circle cx="160" cy="92" r="58" fill="url(#rt-shadow)"/></g>
      <g class="rt-inner"><path class="rt-remark-hot" d="M118.2 64.4A49 49 0 0 1 201.8 64.4L175.3 80.6A18 18 0 0 0 144.7 80.6Z" fill="url(#rt-raised)" stroke="#121216"/><path d="M119.3 64.6A48 48 0 0 1 200.7 64.6L176.1 79.9A19 19 0 0 0 143.9 79.9Z" fill="none" stroke="url(#rt-edge)"/><svg x="151" y="47" width="18" height="18" viewBox="0 0 24 24" overflow="visible"><path d="M5 3.500h10l4 4V20.500H5z" fill="none" stroke="#eeeef2" stroke-width="2.200" stroke-linejoin="round"/><path d="M8.500 11h7M8.500 15h7" stroke="#eeeef2" stroke-width="2.200" stroke-linecap="round"/></svg></g>
      <g class="rt-inner"><path class="" d="M203.1 66.6A49 49 0 0 1 161.3 139L160.5 108A18 18 0 0 0 175.8 81.4Z" fill="url(#rt-raised)" stroke="#121216"/><path d="M202.4 67.5A48 48 0 0 1 161.7 138L160.7 109A19 19 0 0 0 176.8 81.1Z" fill="none" stroke="url(#rt-edge)"/><svg x="180.4" y="98" width="18" height="18" viewBox="0 0 24 24" overflow="visible"><path d="M6.6 3.5 9.5 3l1.6 4.2-2 1.5a11 11 0 0 0 6.2 6.2l1.5-2 4.2 1.6-.5 2.9c-.2 1-1 1.6-2 1.6C10.700 19 5 13.300 5 5.500c0-1 .6-1.800 1.600-2z" fill="none" stroke="#eeeef2" stroke-width="2.200" stroke-linejoin="round"/></svg></g>
      <g class="rt-inner"><path class="" d="M158.7 139A49 49 0 0 1 116.9 66.6L144.2 81.4A18 18 0 0 0 159.5 108Z" fill="url(#rt-raised)" stroke="#121216"/><path d="M158.3 138A48 48 0 0 1 117.6 67.5L143.2 81.1A19 19 0 0 0 159.3 109Z" fill="none" stroke="url(#rt-edge)"/><svg x="121.6" y="98" width="18" height="18" viewBox="0 0 24 24" overflow="visible"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="none" stroke="#eeeef2" stroke-width="2.200" stroke-linejoin="round"/></svg></g>
      <g class="rt-inner"><circle cx="160" cy="90" r="16" fill="url(#rt-raised)" stroke="#121216"/></g>

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
        <p style="margin:0 0 8px;line-height:1.6;font-size:14px">點一下照舊換狀態。按住不放，格子開始抖、手機越震越急，像教官走近的腳步聲。圓形選取盤跳出來後別放手，往選項的方向拖再放開：</p>
        ${TRAY_TUTORIAL_SVG}
        <ul style="margin:10px 0 14px;padding-left:20px;line-height:1.6;font-size:13px;text-align:left">
          <li>晚歸：掛上標記，總表照算在場，人回來了就是回來了。</li>
          <li>電話：拖過去就看到號碼，放開可以直接撥。</li>
          <li>備註：再往外拖，有沒繳回瓷扣、沒住宿同意書、找教官、有狀況!。選了就變成小圖案一直掛在名字旁邊，想賴也賴不掉。</li>
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
