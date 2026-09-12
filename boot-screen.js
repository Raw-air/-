// RAWAIR 開機終端機
// 只管「第一次打開 App」：一行一行印開機訊息，等 app.js 第一次把 #loading-overlay 收掉 (資料載完) 就關掉。
// 之後改資料時跳的載入畫面仍是原本那個，這支檔案完全不碰。
(function () {
  var root = document.getElementById('rawair-boot');
  if (!root) return;
  // 自動化測試 (Playwright) 不顯示開機畫面，免得擋住測試的點擊
  if (navigator.webdriver) { root.parentNode.removeChild(root); return; }
  var body = document.body;
  body.classList.add('rawair-booting');

  var fast = false;
  try { fast = localStorage.getItem('power_save_mode') === 'true'; } catch (_) {}

  var t0 = Date.now();
  var MIN_MS = fast ? 900 : 2600;   // 至少顯示這麼久，字才看得到
  var MAX_MS = 19000;               // 資料一直沒回來就交給原本的載入畫面
  var dataDone = false, finished = false;

  // 開機期間先停掉背後舊終端機的假日誌，省效能；結束後恢復原設定
  var origStopLog = window._psStopHackingLog;
  window._psStopHackingLog = true;

  var term = document.getElementById('rb-term');

  // ANSI Shadow 字型的 RAWAIR
  var ART = [
    '██████╗  █████╗ ██╗    ██╗ █████╗ ██╗██████╗ ',
    '██╔══██╗██╔══██╗██║    ██║██╔══██╗██║██╔══██╗',
    '██████╔╝███████║██║ █╗ ██║███████║██║██████╔╝',
    '██╔══██╗██╔══██║██║███╗██║██╔══██║██║██╔══██╗',
    '██║  ██║██║  ██║╚███╔███╔╝██║  ██║██║██║  ██║',
    '╚═╝  ╚═╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝'
  ];
  // 大字的字級：盡量撐滿寬度 (等寬字大約 0.6em 寬)，最大 30px
  function artSize() {
    var w = (term && term.clientWidth) || window.innerWidth - 24;
    return Math.max(5, Math.min(30, Math.floor(w / (ART[0].length * 0.6) * 10) / 10));
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]; }); }
  var TAGS = {
    ok: '<span class="dim">[</span><span class="ok">  OK  </span><span class="dim">]</span> ',
    wait: '<span class="dim">[</span><span class="wait"> WAIT </span><span class="dim">]</span> ',
    warn: '<span class="dim">[</span><span class="warn"> WARN </span><span class="dim">]</span> ',
    bad: '<span class="dim">[</span><span class="bad"> FAIL </span><span class="dim">]</span> '
  };
  var cursor = document.createElement('span');
  cursor.className = 'rb-cursor';

  function print(kind, text) {
    if (!term) return;
    var div = document.createElement('div');
    if (kind === 'art') {
      div.className = 'rb-art';
      div.style.fontSize = artSize() + 'px';
      // 每個字元放進固定寬度的格子：手機字型的方塊字、框線字寬度不一，不固定格子就會跑版。
      // 「█」直接用底色填滿整格，不靠字型。
      var cells = '';
      for (var ci = 0; ci < text.length; ci++) {
        var ch = text[ci];
        cells += ch === '█' ? '<b class="rb-full"></b>' : '<b>' + (ch === ' ' ? '&nbsp;' : ch) + '</b>';
      }
      div.innerHTML = cells;
    } else if (TAGS[kind]) {
      div.innerHTML = TAGS[kind] + esc(text);
    } else if (kind === 'raw') {
      div.innerHTML = text;
    } else {
      div.innerHTML = kind ? '<span class="' + kind + '">' + esc(text) + '</span>' : esc(text);
    }
    div.appendChild(cursor);
    term.appendChild(div);
    // 像真的終端機一樣：滿了就往上捲
    while (term.scrollHeight > root.clientHeight && term.children.length > 1) term.removeChild(term.firstChild);
  }

  var mem = navigator.deviceMemory ? navigator.deviceMemory * 1024 : 4096;
  var cores = navigator.hardwareConcurrency || 4;
  var d = new Date();
  var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + d.toTimeString().slice(0, 8);

  // [種類, 文字, 印完後停多久 ms]
  var STEPS = [
    ['dim', 'RAWAIR BIOS v3.13  (C) 2026 Raw_air', 60],
    ['dim', 'CPU: ' + cores + ' cores detected    Memory: ' + mem + ' MB OK', 60],
    ['dim', 'Boot device: /dev/biyuan0    ' + stamp, 160],
    ['', '', 40]
  ];
  ART.forEach(function (l) { STEPS.push(['art', l, 45]); });
  STEPS.push(
    ['', '', 30],
    ['raw', '<span class="dim">  Biyuan Dorm Roll-Call System</span>', 30],
    ['raw', '<span class="dim">  Developer:</span> <span class="dev">Raw_air</span>', 260],
    ['', '', 30],
    ['ok', 'Mounted root filesystem (PWA shell)', 70],
    ['ok', 'Started Service Worker cache daemon', 70],
    ['ok', 'Restored user preferences (cookie / IndexedDB)', 90],
    ['ok', 'Reached target Local Storage', 60],
    ['ok', 'Started Theme Engine', 80],
    ['ok', 'Loaded phonetic search index', 110],
    ['ok', 'Started Haptic & Audio feedback service', 70],
    [navigator.onLine === false ? 'warn' : 'ok', navigator.onLine === false ? 'Network offline - using cached shell' : 'Network interface up', 90],
    ['wait', 'Connecting to biyuan-proxy.workers.dev ...', 180],
    ['ok', 'TLS handshake complete', 80],
    ['wait', 'Fetching roster / config / changelog from Notion ...', 200]
  );
  var WAIT_MSGS = [
    'Syncing attendance matrix ...',
    'Mapping bed state records ...',
    'Waiting for Notion API response ...',
    'Applying room rules ...',
    'Resolving semester date columns ...'
  ];

  var si = 0, wi = 0;
  function nextStep() {
    if (finished) return;
    if (si < STEPS.length) {
      var s = STEPS[si++];
      print(s[0], s[1]);
      setTimeout(nextStep, fast || dataDone ? Math.min(s[2], 25) : s[2]);
      return;
    }
    if (!dataDone) {
      print('wait', WAIT_MSGS[wi++ % WAIT_MSGS.length]);
      setTimeout(nextStep, 650 + Math.random() * 400);
      return;
    }
    finishLines();
  }

  function finishLines() {
    var n = 0;
    try { n = (typeof state !== 'undefined' && state.students) ? state.students.length : 0; } catch (_) {}
    print(n > 0 ? 'ok' : 'warn', n > 0 ? 'Roster synced - ' + n + ' residents loaded' : 'Roster sync returned no records');
    print('ok', 'Reached target Graphical Interface');
    print('', '');
    setTimeout(function () {
      print('raw', '<span class="prompt">raw_air@biyuan</span>:<span class="hi">~</span>$ startx');
      var wait = Math.max(fast ? 100 : 450, MIN_MS - (Date.now() - t0));
      setTimeout(exit, wait);
    }, fast ? 0 : 150);
  }

  function exit() {
    if (finished) return;
    finished = true;
    clearTimeout(maxTimer);
    if (mo) mo.disconnect();
    root.classList.add('rb-exit');
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
      window._psStopHackingLog = origStopLog;
      body.classList.remove('rawair-booting');
    }, 220);
  }

  // ── 判斷「第一次載入完成」：app.js 呼叫 showLoading(false) 時會替 overlay 加上 exit-drop ──
  var overlay = document.getElementById('loading-overlay');
  var mo = null, confirmTimer = null;
  function markDone() { dataDone = true; }
  if (overlay && window.MutationObserver) {
    mo = new MutationObserver(function () {
      if (!overlay.classList.contains('exit-drop')) return;
      clearTimeout(confirmTimer);
      // 等一下再確認，避免中途報錯先收掉又馬上重開的情況被誤判成載完
      confirmTimer = setTimeout(function () {
        if (overlay.classList.contains('exit-drop')) markDone();
      }, 250);
    });
    mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  } else {
    window.addEventListener('load', function () { setTimeout(markDone, 1500); });
  }

  var maxTimer = setTimeout(function () {
    if (finished) return;
    print('warn', 'Sync is taking longer than usual - handing over');
    setTimeout(exit, 400);
  }, MAX_MS);

  nextStep();
})();
