// RAWAIR 開機終端機
// 只管「第一次打開 App」：一行一行印開機訊息，等 app.js 第一次把 #loading-overlay 收掉 (資料載完) 就關掉。
// 之後改資料時跳的載入畫面仍是原本那個，這支檔案完全不碰。
// 進度條與每一行 API 請求都是真的：開機期間暫時包住 fetch，照實際收到的位元組、完成時間更新。
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
  var MIN_MS = fast ? 600 : 1800;   // 至少顯示這麼久，大字才看得到
  var MAX_MS = 19000;               // 資料一直沒回來就交給原本的載入畫面
  var EXPECTED_REQ = 5;             // app.js loadData() 開機時同時打 5 支：roster / config / changelog / remarks / semester
  var domReady = document.readyState !== 'loading';
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
  function fmt(b) {
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }
  var TAGS = {
    ok: '<span class="dim">[</span><span class="ok">  OK  </span><span class="dim">]</span> ',
    warn: '<span class="dim">[</span><span class="warn"> WARN </span><span class="dim">]</span> ',
    bad: '<span class="dim">[</span><span class="bad"> FAIL </span><span class="dim">]</span> '
  };
  // / | \ - 旋轉：所有還在跑的行共用同一個計時器
  var SPIN = '|/-\\', spinI = 0;
  function spinTag() { return '<span class="dim">[</span>  <span class="spin wait">' + SPIN[spinI] + '</span>   <span class="dim">]</span> '; }

  var cursor = document.createElement('span');
  cursor.className = 'rb-cursor';
  var statusLine = document.createElement('div');
  statusLine.className = 'rb-status';

  function trim() {
    // 像真的終端機一樣：滿了就往上捲
    while (term.scrollHeight > root.clientHeight - 20 && term.children.length > 2) term.removeChild(term.firstChild);
  }
  function print(kind, text) {
    if (!term) return null;
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
    term.appendChild(div);
    if (statusShown) term.appendChild(statusLine);
    trim();
    return div;
  }
  function setLine(div, html) { if (div) div.innerHTML = html; }

  // ── 真實進度 ──
  var reqs = [];
  var statusShown = false;
  var pendingLines = [];
  function progress() {
    if (dataDone) return 100;
    var p = domReady ? 25 : 5;
    var sum = 0;
    for (var i = 0; i < reqs.length; i++) {
      var r = reqs[i];
      if (r.done) sum += 1;
      else if (r.total) sum += Math.min(0.95, r.loaded / r.total) * 0.9 + 0.05;
      else if (r.headers) sum += 0.1;
    }
    p += 70 * sum / Math.max(EXPECTED_REQ, reqs.length);
    return Math.min(99, Math.floor(p));
  }
  function renderStatus() {
    if (!statusShown) return;
    var pct = progress();
    var W = 20, fill = Math.round(pct / 100 * W);
    var done = 0, bytes = 0;
    for (var i = 0; i < reqs.length; i++) { if (reqs[i].done) done++; bytes += reqs[i].loaded; }
    var bar = new Array(fill + 1).join('#') + new Array(W - fill + 1).join('.');
    var head = pct >= 100 ? '<span class="ok">*</span>' : '<span class="wait">' + SPIN[spinI] + '</span>';
    statusLine.innerHTML = head + ' <span class="dim">[</span><span class="ok">' + bar.slice(0, fill) + '</span><span class="dim">' +
      bar.slice(fill) + ']</span> ' + ('   ' + pct).slice(-3) + '%  <span class="dim">' +
      Math.min(done, Math.max(EXPECTED_REQ, reqs.length)) + '/' + Math.max(EXPECTED_REQ, reqs.length) + '  ' + fmt(bytes) + '</span>';
    statusLine.appendChild(cursor);
  }
  var spinTimer = setInterval(function () {
    spinI = (spinI + 1) % 4;
    var els = term.getElementsByClassName('spin');
    for (var i = 0; i < els.length; i++) els[i].textContent = SPIN[spinI];
    renderStatus();
  }, 90);

  // ── 包住 fetch：每一支 /api/ 請求一行，旋轉到真的收完為止 ──
  var origFetch = window.fetch;
  var wrappedFetch = null;
  if (typeof origFetch === 'function') {
    wrappedFetch = function (input, init) {
      var p = origFetch.apply(this, arguments);
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (finished || url.indexOf('/api/') < 0 || url.indexOf('/api/poll') >= 0) return p;
      var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var label = esc((method + '    ').slice(0, 5) + path);
      var r = { loaded: 0, total: 0, done: false, headers: false, t: Date.now() };
      reqs.push(r);
      var line;
      if (statusShown) line = print('raw', spinTag() + label);
      else {
        // 開頭大字還在印：先記著，等印完再依序接上去，免得插在 RAWAIR 中間
        line = document.createElement('div');
        line.innerHTML = spinTag() + label;
        pendingLines.push(line);
      }
      function end(ok, info) {
        if (r.done) return;
        r.done = true;
        setLine(line, TAGS[ok ? 'ok' : 'bad'] + label + '  <span class="dim">' + esc(info) + '</span>');
        renderStatus();
        maybeFinish();
      }
      p.then(function (res) {
        r.headers = true;
        r.total = Number(res.headers.get('content-length')) || 0;
        var info = function () { return res.status + '  ' + fmt(r.loaded) + '  ' + (Date.now() - r.t) + 'ms'; };
        var live = function () {
          if (!r.done) setLine(line, spinTag() + label + '  <span class="dim">' + fmt(r.loaded) + (r.total ? ' / ' + fmt(r.total) : '') + '</span>');
        };
        live();
        var reader = null;
        try { reader = res.clone().body.getReader(); } catch (_) {}
        if (!reader) { end(res.ok, info()); return; }
        (function pump() {
          reader.read().then(function (x) {
            if (x.done) { end(res.ok, info()); return; }
            r.loaded += x.value.byteLength;
            live();
            pump();
          }, function () { end(res.ok, info()); });
        })();
      }, function (err) {
        end(false, err && err.name === 'AbortError' ? 'timeout' : 'network error');
      });
      return p;
    };
    window.fetch = wrappedFetch;
  }

  var mem = navigator.deviceMemory ? navigator.deviceMemory * 1024 : 4096;
  var cores = navigator.hardwareConcurrency || 4;
  var d = new Date();
  var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + d.toTimeString().slice(0, 8);

  // 開頭固定印的部分：[種類, 文字, 印完後停多久 ms]
  var STEPS = [
    ['dim', 'RAWAIR BIOS v3.13  (C) 2026 Raw_air', 40],
    ['dim', 'CPU: ' + cores + ' cores detected    Memory: ' + mem + ' MB OK', 40],
    ['dim', 'Boot device: /dev/biyuan0    ' + stamp, 80],
    ['', '', 20]
  ];
  ART.forEach(function (l) { STEPS.push(['art', l, 35]); });
  STEPS.push(
    ['', '', 20],
    ['raw', '<span class="dim">  Biyuan Dorm Roll-Call System</span>', 20],
    ['raw', '<span class="dim">  Developer:</span> <span class="dev">Raw_air</span>', 120],
    ['', '', 0]
  );

  var si = 0, modLine = null;
  function nextStep() {
    if (finished) return;
    if (si < STEPS.length) {
      var s = STEPS[si++];
      print(s[0], s[1]);
      setTimeout(nextStep, fast ? 0 : s[2]);
      return;
    }
    // 開頭印完：接上真實狀態
    statusShown = true;
    term.appendChild(statusLine);
    renderStatus();
    modLine = print('raw', spinTag() + 'Loading application modules ...');
    if (domReady) modulesLoaded();
    pendingLines.forEach(function (l) { term.appendChild(l); });
    pendingLines = [];
    term.appendChild(statusLine);
    trim();
    maybeFinish();
  }

  function modulesLoaded() {
    domReady = true;
    if (!modLine) return;
    var n = 0, bytes = 0;
    try {
      performance.getEntriesByType('resource').forEach(function (e) {
        if (/\.(js|css)(\?|$)/.test(e.name) && e.name.indexOf(location.origin) === 0) { n++; bytes += e.transferSize || 0; }
      });
    } catch (_) {}
    setLine(modLine, TAGS.ok + 'Loaded ' + n + ' application modules  <span class="dim">' + (bytes ? fmt(bytes) : 'from cache') + '</span>');
    modLine = null;
    renderStatus();
  }
  document.addEventListener('DOMContentLoaded', modulesLoaded);

  // ── 進度條跑完後：把真的載入結果一行一行印出來，直到整個螢幕寫滿 ──
  var infoStarted = false;
  var extra = { storage: null, caches: null };
  function collectInfo() {
    var L = [];
    var S = (typeof state !== 'undefined') ? state : null;
    var C = window.CONFIG || {};
    var students = (S && S.students) || [];
    var live = students.filter(function (s) { return !s.isEmpty && !s.hidden; });
    L.push([live.length ? 'ok' : 'warn', live.length ? 'Roster applied - ' + live.length + ' residents / ' + students.length + ' beds' : 'Roster sync returned no records']);
    (C.SQUADS || []).forEach(function (sq) {
      var beds = students.filter(function (s) { return s.squad === sq.id; });
      var n = beds.filter(function (s) { return !s.isEmpty && !s.hidden; }).length;
      L.push(['ok', 'Mounted squad ' + sq.id + ' ' + sq.floor + 'F ' + (sq.odd ? 'odd ' : 'even') + '  ' + n + '/' + beds.length + ' beds']);
    });
    if (S) {
      var today = S.currentDate || '';
      var leave = 0, absent = 0;
      live.forEach(function (s) { var v = s.attendance && s.attendance[today]; if (v === '◎') leave++; else if (v === '✘') absent++; });
      var sem = S.rosterSemester;
      var semText = sem && typeof sem === 'object'
        ? (sem.name || '-') + (sem.start ? '  ' + sem.start + ' ~ ' + (sem.end || '') : '')
        : (sem || C.SEMESTER || '-');
      L.push(['ok', 'Semester ' + semText]);
      L.push(['ok', 'Loaded ' + (S.dateColumns || []).length + ' date columns']);
      L.push(['ok', 'Attendance date ' + today + '  leave ' + leave + '  absent ' + absent]);
      L.push(['ok', 'Roll-call confirmed ' + (S.confirmedSquads || []).length + ' / ' + (C.SQUADS || []).length + ' squads']);
      L.push(['ok', 'Loaded ' + (S.changelogs || []).length + ' changelog entries']);
      L.push([(S.changes || []).length ? 'warn' : 'ok', 'Pending offline changes: ' + (S.changes || []).length]);
    }
    L.push(['ok', 'Duty roster ' + (C.DUTY_ROSTER || []).length + ' weeks loaded']);
    L.push(['ok', 'Room rules: ' + (C.DOUBLE_ROOMS || []).length + ' double rooms, ' + (C.STORAGE_ROOMS || []).length + ' storage masked']);
    L.push(['ok', 'Theme: ' + (body.classList.contains('light-mode') ? 'light' : 'dark') + '  power save: ' + (fast ? 'on' : 'off')]);
    L.push(['ok', 'Display ' + window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x']);
    var cn = navigator.connection;
    if (cn && cn.effectiveType) L.push(['ok', 'Network ' + cn.effectiveType + (cn.downlink ? '  ' + cn.downlink + ' Mbps' : '') + (cn.rtt != null ? '  rtt ' + cn.rtt + 'ms' : '')]);
    L.push([navigator.serviceWorker && navigator.serviceWorker.controller ? 'ok' : 'warn', 'Service Worker ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'active' : 'not controlling yet') + (extra.caches ? '  cache ' + extra.caches : '')]);
    if (extra.storage) L.push(['ok', 'Storage ' + fmt(extra.storage.usage || 0) + ' used / ' + fmt(extra.storage.quota || 0)]);
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) L.push(['ok', 'DOM ready in ' + Math.round(nav.domContentLoadedEventEnd) + 'ms']);
    } catch (_) {}
    var apiMs = 0, apiBytes = 0;
    reqs.forEach(function (r) { apiBytes += r.loaded; });
    if (reqs.length) apiMs = Date.now() - reqs[0].t;
    L.push(['ok', 'Data sync ' + fmt(apiBytes) + ' in ' + apiMs + 'ms']);
    L.push(['ok', 'Started realtime KV poll listener']);
    // 還沒寫滿就接著列出每間房 (真實房號與人數)
    var rooms = {};
    live.forEach(function (s) { if (s.room) rooms[s.room] = (rooms[s.room] || 0) + 1; });
    Object.keys(rooms).sort().forEach(function (r) { L.push(['ok', 'Indexed room ' + r + '  ' + rooms[r] + ' residents']); });
    return L;
  }
  function maybeFinish() {
    if (finished || !statusShown || !dataDone || infoStarted) return;
    infoStarted = true;
    clearTimeout(maxTimer);
    renderStatus();
    var list = collectInfo(), k = 0;
    (function nextInfo() {
      if (finished) return;
      if (k >= list.length || isFull()) { endBoot(); return; }
      var item = list[k++];
      var line = print('raw', spinTag() + esc(item[1]));
      setTimeout(function () {
        setLine(line, TAGS[item[0]] + esc(item[1]));
        nextInfo();
      }, fast ? 0 : 35 + Math.random() * 90);
    })();
  }
  // 螢幕寫滿了沒：再多一行就會超出畫面
  function isFull() {
    var lineH = statusLine.offsetHeight || 18;
    return term.scrollHeight + lineH * 2 > root.clientHeight - 20;
  }
  function endBoot() {
    print('ok', 'Reached target Graphical Interface');
    var wait = Math.max(fast ? 80 : 300, MIN_MS - (Date.now() - t0));
    setTimeout(function () {
      if (finished) return;
      print('raw', '<span class="prompt">raw_air@biyuan</span>:<span class="hi">~</span>$ startx');
      setTimeout(exit, fast ? 60 : 250);
    }, wait);
  }
  // 儲存空間、快取名稱是非同步的，先去拿，拿得到就會列出來
  try { navigator.storage.estimate().then(function (e) { extra.storage = e; }).catch(function () {}); } catch (_) {}
  try { caches.keys().then(function (k) { extra.caches = k.filter(function (n) { return n.indexOf('biyuan-') === 0; }).join(','); }).catch(function () {}); } catch (_) {}

  function exit() {
    if (finished) return;
    finished = true;
    clearTimeout(maxTimer);
    clearInterval(spinTimer);
    if (mo) mo.disconnect();
    if (wrappedFetch && window.fetch === wrappedFetch) window.fetch = origFetch;
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
  function markDone() { dataDone = true; renderStatus(); maybeFinish(); }
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
