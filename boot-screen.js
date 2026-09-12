// RAWAIR OS 開機畫面
// 只管「第一次打開 App」：等 app.js 第一次把 #loading-overlay 收掉 (資料載完) 就播收場動畫並移除自己。
// 之後改資料時跳的載入畫面仍是原本那個，這支檔案完全不碰。
(function () {
  var root = document.getElementById('rawair-boot');
  if (!root) return;
  var body = document.body;
  body.classList.add('rawair-booting');

  var lite = false;
  try {
    lite = localStorage.getItem('power_save_mode') === 'true' ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {}
  if (lite) root.classList.add('rb-lite');

  var t0 = Date.now();
  var MIN_MS = lite ? 900 : 2800;   // 至少播這麼久，動畫才看得完整
  var MAX_MS = 19000;               // 資料一直沒回來就交給原本的載入畫面
  var dataDone = false, finished = false;

  // 開機期間先停掉背後舊終端機的假日誌，省效能；收場後恢復原設定
  var origStopLog = window._psStopHackingLog;
  window._psStopHackingLog = true;

  // ── 大字 RAWAIR (5x7 點陣) ──
  var FONT = {
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111']
  };
  var WORD = 'RAWAIR';
  var logo = document.getElementById('rb-logo');
  var html = '';
  var vw = Math.max(window.innerWidth, 320), vh = Math.max(window.innerHeight, 480);
  for (var li = 0; li < WORD.length; li++) {
    var g = FONT[WORD[li]];
    html += '<span class="rb-ch" style="left:calc(var(--p)*' + (li * 6) + ')"></span>';
    for (var r = 0; r < 7; r++) {
      for (var c = 0; c < 5; c++) {
        if (g[r][c] !== '1') continue;
        var col = li * 6 + c;
        var hue = Math.round(188 + col / 34 * 120);
        var ang = Math.random() * Math.PI * 2, dist = 0.45 + Math.random() * 0.6;
        var dx = Math.round(Math.cos(ang) * vw * dist), dy = Math.round(Math.sin(ang) * vh * dist);
        var rot = Math.round(Math.random() * 540 - 270);
        var delay = Math.round(250 + li * 90 + Math.random() * 320);
        html += '<i style="left:calc(var(--p)*' + col + ');top:calc(var(--p)*' + r + ');--h:' + hue +
          ';--dx:' + dx + 'px;--dy:' + dy + 'px;--r:' + rot + 'deg;--d:' + delay + 'ms"></i>';
      }
    }
  }
  if (logo) logo.innerHTML = html;
  var assembleMs = lite ? 0 : 250 + 5 * 90 + 320 + 850;
  setTimeout(function () {
    if (!logo || finished) return;
    logo.classList.add('rb-glow');
    if (!lite) {
      logo.classList.add('rb-shine');
      setTimeout(function () { logo.classList.add('rb-glitch'); }, 700);
      setTimeout(function () { logo.classList.remove('rb-glitch'); }, 1050);
    }
  }, assembleMs);

  // ── 上方時鐘 ──
  var clock = document.getElementById('rb-clock');
  function tick() {
    if (!clock) return;
    var d = new Date();
    clock.textContent = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' + d.toTimeString().slice(0, 8);
  }
  tick();
  var clockTimer = setInterval(tick, 1000);

  // ── Developer: Raw_air 打字 ──
  var devEl = document.getElementById('rb-devname');
  var DEV = 'Raw_air';
  setTimeout(function typeDev(i) {
    i = i || 0;
    if (!devEl || finished) return;
    devEl.textContent = DEV.slice(0, i + 1);
    if (i + 1 < DEV.length) setTimeout(function () { typeDev(i + 1); }, lite ? 0 : 85);
  }, lite ? 0 : 900);

  // ── 開機訊息 ──
  var logEl = document.getElementById('rb-log');
  var bar = document.getElementById('rb-bar-fill');
  var pctEl = document.getElementById('rb-pct');
  function esc(s) { return String(s).replace(/[&<>]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]; }); }
  function line(tag, text) {
    if (!logEl) return;
    var TAGS = {
      ok: '<span class="dim">[</span><span class="ok">  OK  </span><span class="dim">]</span> ',
      wait: '<span class="dim">[</span><span class="wait"> WAIT </span><span class="dim">]</span> ',
      warn: '<span class="dim">[</span><span class="warn"> WARN </span><span class="dim">]</span> ',
      bad: '<span class="dim">[</span><span class="bad"> FAIL </span><span class="dim">]</span> '
    };
    var div = document.createElement('div');
    div.innerHTML = (TAGS[tag] || '') + (tag === 'hi' ? '<span class="hi">' + esc(text) + '</span>' : tag === 'dim' ? '<span class="dim">' + esc(text) + '</span>' : esc(text));
    logEl.appendChild(div);
    while (logEl.children.length > 14) logEl.removeChild(logEl.firstChild);
  }
  var pct = 0;
  function setPct(p) {
    pct = Math.max(pct, Math.min(100, Math.round(p)));
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  }

  var mem = navigator.deviceMemory ? navigator.deviceMemory * 1024 : 4096;
  var cores = navigator.hardwareConcurrency || 4;
  var STEPS = [
    ['dim', 'RAWAIR BIOS v3.13  (C) 2026 Raw_air. All rights reserved.'],
    ['dim', 'CPU: ' + cores + '-core Biyuan Neural Engine ........ detected'],
    ['dim', 'Memory test: ' + mem + ' MB OK'],
    ['dim', 'Booting from /dev/biyuan0 ...'],
    ['ok', 'Mounted root filesystem (PWA shell)'],
    ['ok', 'Started Service Worker cache daemon'],
    ['ok', 'Restored user preferences (cookie / IndexedDB)'],
    ['ok', 'Reached target Local Storage'],
    ['ok', 'Started Theme Engine & Liquid Glass compositor'],
    ['ok', 'Loaded phonetic search index'],
    ['ok', 'Started Haptic & Audio feedback service'],
    [navigator.onLine === false ? 'warn' : 'ok', navigator.onLine === false ? 'Network offline — using cached shell' : 'Network interface up'],
    ['wait', 'Connecting to biyuan-proxy.workers.dev ...'],
    ['ok', 'TLS handshake complete'],
    ['wait', 'Fetching roster / config / changelog from Notion ...']
  ];
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
      line(STEPS[si][0], STEPS[si][1]);
      si++;
      setPct(si / STEPS.length * 72);
      var fast = dataDone || lite;
      var d = si <= 4 ? 70 : 110 + Math.random() * 130;
      setTimeout(nextStep, fast ? d * 0.3 : d);
      return;
    }
    if (!dataDone) {
      line('wait', WAIT_MSGS[wi++ % WAIT_MSGS.length]);
      setPct(72 + (1 - Math.pow(0.8, wi)) * 22);
      setTimeout(nextStep, 700 + Math.random() * 500);
      return;
    }
    finishLines();
  }

  function finishLines() {
    var n = 0;
    try { n = (typeof state !== 'undefined' && state.students) ? state.students.length : 0; } catch (_) {}
    line(n > 0 ? 'ok' : 'warn', n > 0 ? 'Roster synced — ' + n + ' residents loaded' : 'Roster sync returned no records');
    line('ok', 'Reached target Graphical Interface');
    line('hi', 'Welcome to RAWAIR OS.');
    setPct(100);
    var wait = Math.max(lite ? 150 : 550, MIN_MS - (Date.now() - t0));
    setTimeout(exit, wait);
  }

  function exit() {
    if (finished) return;
    finished = true;
    clearInterval(clockTimer);
    clearTimeout(maxTimer);
    if (mo) mo.disconnect();
    root.classList.add('rb-exit');
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
      window._psStopHackingLog = origStopLog;
      body.classList.remove('rawair-booting');
    }, lite ? 280 : 800);
  }

  // ── 判斷「第一次載入完成」：app.js 呼叫 showLoading(false) 時會替 overlay 加上 exit-drop ──
  var overlay = document.getElementById('loading-overlay');
  var mo = null, confirmTimer = null;
  function markDone() {
    if (dataDone) return;
    dataDone = true;
  }
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
    line('warn', 'Sync is taking longer than usual — handing over');
    setTimeout(exit, 400);
  }, MAX_MS);

  setTimeout(nextStep, lite ? 0 : 120);
})();
