// 黃單額度：跟「資料微動查詢」共用同一頁、同一條弧形資料夾軌道與黑洞，只換資料與配色
// ─────────────────────────────────────────────────────────────────────────────
// 資料放在系統設定表 (/api/config)，一個住宿生一個鍵：yc_<床位頁 id> = JSON 陣列
//   [{ d: 開單日 'YYYY-MM-DD', r: 犯規事由, n: 開單時的姓名, t: 建立時間毫秒, x?: 執行日 'YYYY-MM-DD', xt?: 標記執行的時間 }]
// 沒有 x = 待執行 (算額度，可以派去清冰箱)；有 x = 已執行，留在開單紀錄裡，不再算額度。
// 一人一鍵：兩個幹部同時替不同人開單不會互相蓋掉。
// 記錄會帶開單當時的姓名，床位換人之後舊的黃單不會算到新住宿生頭上 (但開單紀錄裡還看得到)。
// 開單是馬上存；黑洞 = 全部標記執行、單張執行 / 復原 / 刪除都是草稿，清完一輪按軌道下方的「儲存」一次送出。
// 軌道在黃單模式不循環 (sfFinite)：只有 1 個人就只有 1 本，名額一眼看得出來。
(function () {
  const PREFIX = 'yc_';
  const PROTECT_MS = 90 * 1000;              // 剛寫進去的值先信本機，背景刷新可能還拿到舊設定
  const REASONS = ['晚歸', '噪音喧嘩', '內務不整', '違規電器', '垃圾未倒', '未到點名'];
  let mode = 'files';
  const pending = new Map();                 // 床位 id -> 改過之後的完整紀錄 (草稿)
  const local = new Map();                   // 設定鍵 -> { v, at } 這台剛存過的值
  const cache = new Map();                   // 設定鍵 -> { raw, list } 解析快取 (軌道每幀都會問)
  let busy = false;

  const esc = v => (typeof escHtml === 'function' ? escHtml(v) : String(v ?? ''));
  const keyOf = id => PREFIX + id;
  const today = () => (typeof localTodayISO === 'function' ? localTodayISO() : new Date().toISOString().slice(0, 10));
  const isISO = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const short = iso => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? (+m[1]) + '/' + (+m[2]) : (iso || ''); };
  const isEmptyBed = s => !s || s.isEmpty || !s.name;
  const isActive = x => !x.x;
  const studentsAll = () => (typeof state !== 'undefined' && state.students) || [];

  function raw(id) {
    const k = keyOf(id), l = local.get(k);
    if (l && Date.now() - l.at < PROTECT_MS) return l.v;
    return (typeof state !== 'undefined' && state.config && state.config[k]) || '';
  }
  function parse(id) {
    const k = keyOf(id), r = raw(id), hit = cache.get(k);
    if (hit && hit.raw === r) return hit.list;
    let list = [];
    try { const v = r ? JSON.parse(r) : []; if (Array.isArray(v)) list = v.filter(x => x && typeof x === 'object'); } catch (e) { list = []; }
    cache.set(k, { raw: r, list });
    return list;
  }
  // 雲端上的紀錄 (只算現在住這床的人)
  function saved(s) {
    if (!s || isEmptyBed(s)) return [];
    return parse(s.id).filter(x => !x.n || x.n === s.name);
  }
  // 畫面上看到的全部紀錄 (有草稿就用草稿)，含已執行
  function list(s) { return s && pending.has(s.id) ? pending.get(s.id) : saved(s); }
  // 待執行的黃單 = 額度
  function open(s) { return list(s).filter(isActive); }
  // 寫回設定表時要保留別人 (換床前的住宿生) 的紀錄
  function others(s) { return parse(s.id).filter(x => x.n && x.n !== s.name); }

  function roster() {
    return studentsAll().filter(s => !isEmptyBed(s) && open(s).length > 0).sort((a, b) => {
      const la = open(a), lb = open(b);
      if (lb.length !== la.length) return lb.length - la.length;
      // 同樣張數：最早開單、等最久的排前面
      const da = la[0]?.d || '', db = lb[0]?.d || '';
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }

  // ── 資料夾外殼 (結構跟 sfCardHTML 一樣，carousel.js / dissolve.js 才認得) ──
  function slips(n) {
    // 夾在資料夾裡的黃色單子：幾張待執行就露出幾張 (最多 6)，沒有就是白紙
    if (!n) return '<i class="yc-blank"></i><i></i><i></i>';
    let h = '';
    for (let i = 0; i < Math.min(n, 6); i++) h += '<i class="yc-slip" style="--i:' + i + '"></i>';
    return h;
  }
  function summaryHTML(s) {
    const o = open(s), last = o[o.length - 1];
    const tags = [];
    if (pending.has(s.id)) tags.push('<span class="fd-tag yc-tag-pending">待儲存</span>');
    if (last) tags.push('<span class="fd-tag yc-tag-reason">' + esc(last.r) + '</span>');
    else if (list(s).length) tags.push('<span class="fd-tag">都執行完了</span>');
    return '<div class="fd-name">' + esc(s.name) + '</div><div class="fd-tags">' + tags.join('') + '</div>';
  }
  function stampHTML(n) {
    return '<div class="yc-stamp' + (n >= 3 ? ' is-hot' : '') + (n ? '' : ' is-zero') + '"><b>' + n + '</b><span>' + (n ? '張待執行' : '無黃單') + '</span></div>';
  }
  function badge(s) {
    const n = open(s).length, all = list(s).length;
    return n ? '待執行 ' + n + '・共 ' + all : all ? '共 ' + all + '・已執行完' : '無黃單';
  }

  function cardHTML(s) {
    const empty = isEmptyBed(s);
    const n = empty ? 0 : open(s).length;
    const name = empty ? '空床' : s.name;
    const room = esc(s.room), bed = esc(s.bed);
    return `
      <div class="fd-back"></div>
      <div class="fd-tab"><span>${room}</span><b>${bed}</b><i></i></div><div class="fd-tab fd-tab-r"><span>${room}</span><b>${bed}</b><i></i></div>
      <div class="fd-spine"></div><div class="fd-spine fd-spine-r"></div>
      <div class="fd-top"></div>
      <div class="fd-paper" aria-hidden="true">${slips(n)}</div>
      <div class="fd-front">
        <div class="yc-hazard" aria-hidden="true"></div>
        <div class="fd-file-mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span>${room}-${bed}</span></div>
        ${empty ? '' : stampHTML(n)}
        <div class="fd-rail-label">${esc(name)}${n ? ' ×' + n : ''}</div>
        <div class="fd-summary">${empty ? '<div class="fd-name is-empty">空床</div>' : summaryHTML(s)}</div>
      </div>
      <div class="fd-edge"></div>
      <div class="fd-sheet yc-sheet" data-lazy="1"></div>
    `;
  }

  // ── 抽出來的紙 (點開才做，見 app.js sfEnsureSheet) ─────────────────────
  function rowsHTML(s) {
    const l = list(s);
    if (!l.length) return '<div class="yc-none">沒有黃單，是乖寶寶</div>';
    // 待執行在上 (舊的先)，已執行在下 (新的先)
    const idx = l.map((x, i) => i);
    const act = idx.filter(i => isActive(l[i])).sort((a, b) => (l[a].d || '').localeCompare(l[b].d || '') || a - b);
    const done = idx.filter(i => !isActive(l[i])).sort((a, b) => (l[b].x || '').localeCompare(l[a].x || '') || b - a);
    const row = i => {
      const x = l[i], on = isActive(x);
      return '<div class="yc-row' + (on ? '' : ' is-done') + '">'
        + '<div class="yc-dates"><span><em>開單</em>' + esc(short(x.d)) + '</span><span><em>執行</em>' + (on ? '<i>待執行</i>' : esc(short(x.x))) + '</span></div>'
        + '<span class="yc-reason-text">' + esc(x.r) + '</span>'
        + '<div class="yc-row-act">'
        + (on ? '<button type="button" class="yc-exec" onclick="yc.execOne(this,' + i + ')">執行</button>'
              : '<button type="button" class="yc-undo" onclick="yc.undoOne(this,' + i + ')">復原</button>')
        + '<button type="button" class="yc-del" onclick="yc.removeOne(this,' + i + ')" aria-label="刪除這張黃單 (開錯單才用)">×</button>'
        + '</div></div>';
    };
    let h = act.map(row).join('');
    if (done.length) h += '<div class="yc-sep">已執行 ' + done.length + ' 張</div>' + done.map(row).join('');
    return h;
  }
  function sheetHTML(s) {
    const empty = isEmptyBed(s);
    const name = empty ? '空床' : s.name;
    const n = empty ? 0 : open(s).length;
    const t = today();
    const form = empty ? '<div class="yc-none">空床不能開黃單</div>' : `
          <div class="yc-chips">${REASONS.map(r => `<button type="button" class="yc-chip" onclick="yc.pick(this)">${esc(r)}</button>`).join('')}</div>
          <div class="yc-date-row">
            <label>開單日期<input type="date" class="yc-issue-date styled-input" value="${t}" max="${t}"></label>
            <label>執行日期<input type="date" class="yc-exec-date styled-input" value="${t}" title="按「執行」或黑洞時記錄的日期"></label>
          </div>
          <div class="yc-add-row">
            <input type="text" class="yc-reason styled-input" aria-label="犯規事由" maxlength="60" placeholder="犯規事由（可點上面快速填入）" onkeydown="if(event.key==='Enter'){event.preventDefault();yc.add(this)}">
            <button type="button" class="yc-add-btn" onclick="yc.add(this)">開黃單</button>
          </div>`;
    return `
        <div class="sf-card-title">
          <span class="sf-title-text">${esc(s.room)} ${esc(s.bed)}</span>
          <div class="sf-card-badge-relative">${empty ? '空床' : badge(s)}</div>
          <button class="sf-icon-btn sf-close-btn" onclick="sfCarousel.dismiss()" aria-label="關閉檔案">×</button>
          <button class="sf-icon-btn sf-broom-btn" onclick="clearStudentData(this)" title="黑洞：待執行的黃單全部標記已執行" aria-label="黑洞：待執行的黃單全部標記已執行"${n ? '' : ' disabled'}><svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9"/><path d="M21 12a9 9 0 0 1-9 9" opacity=".6"/><path d="M12 21a9 9 0 0 1-9-9" opacity=".35"/></svg></button>
        </div>
        <div class="yc-label"><b>${esc(name)}</b> 的開單紀錄</div>
        <div class="yc-list">${empty ? '' : rowsHTML(s)}</div>
        <div class="yc-add">${form}</div>
    `;
  }

  // 只換內容、不換整本 DOM：紙打開時重畫 innerHTML 會讓紙瞬間消失
  function refreshFolder(el, s) {
    const n = open(s).length;
    const q = sel => el.querySelector(sel);
    const sum = q('.fd-summary'); if (sum) sum.innerHTML = summaryHTML(s);
    const st = q('.yc-stamp'); if (st) st.outerHTML = stampHTML(n);
    const rail = q('.fd-rail-label'); if (rail) rail.textContent = s.name + (n ? ' ×' + n : '');
    const paper = q('.fd-paper'); if (paper) paper.innerHTML = slips(n);
    const b = q('.sf-card-badge-relative'); if (b) b.textContent = badge(s);
    const rows = q('.yc-list'); if (rows) rows.innerHTML = rowsHTML(s);
    const hole = q('.sf-broom-btn'); if (hole) hole.disabled = !n;
  }
  function refreshStudent(s) {
    for (const f of document.querySelectorAll('#sf-card-track .sf-folder')) if (_sfRenderMap.get(f)?.id === s.id) refreshFolder(f, s);
    refreshHeading();
    window.sfRefreshCommitBar?.();
    window.sfCarousel?.paint();
  }

  // ── 開單 (馬上存) ─────────────────────────────────────────────────────
  async function write(updates) {
    await window._api.setConfig(updates);
    const at = Date.now();
    for (const [k, v] of Object.entries(updates)) {
      local.set(k, { v, at });
      if (typeof state !== 'undefined' && state.config) state.config[k] = v;
    }
  }
  function ownerOf(el) {
    const folder = el?.closest('.sf-folder');
    return folder ? { folder, s: _sfRenderMap.get(folder) } : {};
  }
  function execDateOf(folder) {
    const v = folder?.querySelector('.yc-exec-date')?.value;
    return isISO(v) ? v : today();
  }
  async function add(el) {
    const { folder, s } = ownerOf(el);
    if (!folder || !s || isEmptyBed(s)) return;
    const input = folder.querySelector('.yc-reason');
    const reason = (input?.value || '').trim();
    if (!reason) { showToast('先寫犯規事由（或點上面的快速選項）', 'error'); input?.focus(); return; }
    const dIn = folder.querySelector('.yc-issue-date')?.value;
    const d = isISO(dIn) ? dIn : today();
    const btn = folder.querySelector('.yc-add-btn');
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = '開單中…'; }
    // 有草稿 (例如剛標記執行還沒存) 時一起存進去，開單後以完整清單為準
    const next = list(s).concat([{ d, r: reason, n: s.name, t: Date.now() }]);
    try {
      await write({ [keyOf(s.id)]: JSON.stringify(others(s).concat(next)) });
      pending.delete(s.id);
      if (input) input.value = '';
      for (const c of folder.querySelectorAll('.yc-chip.is-on')) c.classList.remove('is-on');
      refreshStudent(s);
      stampPop(folder);
      haptic('heavy');
      showToast(esc(s.name) + ' 開了黃單，待執行 ' + next.filter(isActive).length + ' 張', 'success');
    } catch (err) {
      showToast('開單失敗：' + esc(err.message || err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '開黃單'; }
    }
  }
  function stampPop(folder) {
    const st = folder.querySelector('.yc-stamp');
    if (!st || !st.animate || (window.sfReduceMotion && sfReduceMotion())) return;
    st.animate([
      { transform: 'rotate(-14deg) scale(1.9)', opacity: 0 },
      { transform: 'rotate(-10deg) scale(.92)', opacity: 1, offset: .55 },
      { transform: 'rotate(-12deg) scale(1.04)', offset: .8 },
      { transform: 'rotate(-12deg) scale(1)', opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }
  function pick(chip) {
    const { folder } = ownerOf(chip);
    const input = folder?.querySelector('.yc-reason');
    if (!input) return;
    for (const c of folder.querySelectorAll('.yc-chip.is-on')) c.classList.remove('is-on');
    chip.classList.add('is-on');
    input.value = chip.textContent;
    haptic('light');
  }

  // ── 執行 / 復原 / 刪除 (草稿，按下方儲存才送) ─────────────────────────────
  function edit(el, index, fn) {
    const { folder, s } = ownerOf(el);
    if (!s) return;
    const l = list(s).map(x => ({ ...x }));
    if (index < 0 || index >= l.length) return;
    if (fn(l, index, folder) === false) return;
    pending.set(s.id, l);
    haptic('light');
    refreshStudent(s);
  }
  function execOne(el, i) { edit(el, i, (l, k, f) => { l[k].x = execDateOf(f); l[k].xt = Date.now(); }); }
  function undoOne(el, i) { edit(el, i, (l, k) => { delete l[k].x; delete l[k].xt; }); }
  function removeOne(el, i) {
    edit(el, i, (l, k) => {
      // 開單紀錄要留著；只有開錯單才刪
      if (!confirm('刪掉這張黃單「' + (l[k].r || '') + '」？\n開單紀錄會一起消失，只有開錯單才刪。\n清完冰箱請按「執行」。')) return false;
      l.splice(k, 1);
    });
  }
  // 黑洞：待執行的黃單全部標記已執行 (日期用紙上的執行日期，沒打開過就是今天)
  function markCleared(s, folder) {
    if (!s) return;
    const x = execDateOf(folder), xt = Date.now();
    pending.set(s.id, list(s).map(r => (isActive(r) ? { ...r, x, xt } : { ...r })));
    refreshStudent(s);
  }
  function dirty(id) {
    const s = studentsAll().find(x => x.id === id);
    return s && JSON.stringify(pending.get(id)) !== JSON.stringify(saved(s)) ? s : null;
  }
  function pendingCount() {
    let n = 0;
    for (const id of pending.keys()) if (dirty(id)) n++;
    return n;
  }
  async function saveAll() {
    const btn = document.querySelector('#sf-commit-bar .sf-commit-save');
    if (busy || !btn) return;
    const updates = {}, ids = [];
    for (const [id, l] of pending) {
      const s = dirty(id);
      if (!s) { pending.delete(id); continue; }
      const all = others(s).concat(l);
      updates[keyOf(id)] = all.length ? JSON.stringify(all) : '';
      ids.push(id);
    }
    if (!ids.length) { window.sfRefreshCommitBar?.(); return; }
    busy = true;
    btn.classList.add('is-busy'); btn.disabled = true;
    btn.querySelector('span').textContent = '儲存中…';
    try {
      await write(updates);
      for (const id of ids) pending.delete(id);
      showToast('已同步 ' + ids.length + ' 人的黃單', 'success');
      if (typeof playClickSound === 'function') playClickSound('all_present');
      btn.classList.remove('is-busy');
      // 執行完的人從軌道上下架 (紀錄還在，搜尋得到)
      const input = document.getElementById('sf-search-input');
      onStudentFileSearch(input ? input.value : '');
    } catch (err) {
      btn.classList.remove('is-busy');
      showToast('儲存失敗，草稿還在，再按一次重試：' + esc(err.message || err), 'error');
    } finally {
      busy = false;
      refreshHeading();
      window.sfRefreshCommitBar?.();
    }
  }

  // ── 全部的開單紀錄 (含已執行、含已退宿的人) ─────────────────────────────
  function allRecords() {
    const out = [];
    const byId = new Map(studentsAll().map(s => [s.id, s]));
    const keys = new Set();
    if (typeof state !== 'undefined' && state.config) for (const k of Object.keys(state.config)) if (k.startsWith(PREFIX)) keys.add(k);
    for (const k of local.keys()) keys.add(k);
    for (const k of keys) {
      const id = k.slice(PREFIX.length), s = byId.get(id);
      const cur = s ? list(s) : [];
      const rest = s ? others(s) : parse(id);
      for (const x of cur.concat(rest)) out.push({ ...x, room: s?.room || '', bed: s?.bed || '', moved: !s || (x.n && x.n !== s.name) });
    }
    return out.sort((a, b) => (b.d || '').localeCompare(a.d || '') || (b.t || 0) - (a.t || 0));
  }
  let logFilter = 'all';
  function renderLog() {
    const box = document.getElementById('yc-log');
    if (!box) return;
    const all = allRecords();
    const rows = all.filter(x => logFilter === 'all' || (logFilter === 'open' ? isActive(x) : !isActive(x)));
    const nOpen = all.filter(isActive).length;
    box.querySelector('.yc-log-tabs').innerHTML = [['all', '全部 ' + all.length], ['open', '待執行 ' + nOpen], ['done', '已執行 ' + (all.length - nOpen)]]
      .map(([k, t]) => '<button type="button" class="' + (k === logFilter ? 'is-on' : '') + '" onclick="yc.logTab(\'' + k + '\')">' + t + '</button>').join('');
    box.querySelector('.yc-log-body').innerHTML = rows.length ? '<table><thead><tr><th>開單</th><th>住宿生</th><th>事由</th><th>執行</th></tr></thead><tbody>'
      + rows.map(x => '<tr class="' + (isActive(x) ? '' : 'is-done') + '"><td>' + esc(short(x.d)) + '</td><td>' + esc(x.n || '') + (x.moved ? '<small>已換床</small>' : '<small>' + esc(x.room) + '-' + esc(x.bed) + '</small>') + '</td><td>' + esc(x.r) + '</td><td>' + (isActive(x) ? '<i>待執行</i>' : esc(short(x.x))) + '</td></tr>').join('')
      + '</tbody></table>' : '<div class="yc-none">還沒有開單紀錄</div>';
  }
  function openLog() {
    let box = document.getElementById('yc-log');
    if (!box) {
      box = document.createElement('div');
      box.id = 'yc-log';
      box.className = 'yc-log';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', '黃單開單紀錄');
      box.innerHTML = '<div class="yc-log-panel"><div class="yc-log-head"><b>開單紀錄</b><span>草稿 (還沒按儲存) 也會列出</span><button type="button" class="yc-log-close" onclick="yc.closeLog()" aria-label="關閉">×</button></div>'
        + '<div class="yc-log-tabs"></div><div class="yc-log-body"></div></div>';
      box.addEventListener('click', e => { if (e.target === box) closeLog(); });
      document.body.appendChild(box);
    }
    renderLog();
    box.classList.add('is-open');
    haptic('light');
  }
  function closeLog() { document.getElementById('yc-log')?.classList.remove('is-open'); }

  // ── 頁面外觀：同一頁切兩種模式 ─────────────────────────────────────────
  const TEXT = {
    files: null,   // 第一次切換時從 HTML 讀原文
    yellow: {
      eyebrow: 'BIYUAN / YELLOW CARD LEDGER',
      status: '違規紀錄',
      sub: '誰欠一次清冰箱，一眼就知道',
      title: '黃單額度<span>Yellow card ledger</span>',
      placeholder: '搜尋住宿生，可直接開黃單',
      hint: '左右拖曳瀏覽 · 點選檔案看紀錄 · 黑洞＝執行',
      pick: '目前選取',
      hole: '黑洞執行',
    },
  };
  function els() {
    const page = document.getElementById('page-student-files');
    if (!page) return null;
    return {
      page,
      eyebrow: page.querySelector('.sf-archive-header .sf-eyebrow'),
      status: page.querySelector('.sf-archive-status'),
      sub: page.querySelector('.sf-archive-heading .sf-eyebrow'),
      title: page.querySelector('.sf-archive-heading h1'),
      input: document.getElementById('sf-search-input'),
      hint: page.querySelector('.sf-gesture-hint'),
      pick: page.querySelector('.sf-selection > span'),
      hole: page.querySelector('.sf-commit-hole span'),
    };
  }
  function applyText(m) {
    const e = els(); if (!e) return;
    if (!TEXT.files) TEXT.files = {
      eyebrow: e.eyebrow?.textContent, status: e.status?.innerHTML, sub: e.sub?.textContent, title: e.title?.innerHTML,
      placeholder: e.input?.placeholder, hint: e.hint?.textContent, pick: e.pick?.innerHTML, hole: e.hole?.textContent,
    };
    const t = TEXT[m];
    if (e.eyebrow) e.eyebrow.textContent = t.eyebrow;
    if (e.status) e.status.innerHTML = m === 'yellow' ? '<i></i> ' + t.status : t.status;
    if (e.sub) e.sub.textContent = t.sub;
    if (e.title) e.title.innerHTML = t.title;
    if (e.input) { e.input.placeholder = t.placeholder; e.input.setAttribute('aria-label', t.placeholder); }
    if (e.hint) e.hint.textContent = t.hint;
    if (e.pick) e.pick.innerHTML = m === 'yellow' ? t.pick + ' <b>↗</b>' : t.pick;
    if (e.hole) e.hole.textContent = t.hole;
    e.page.classList.toggle('yc-mode', m === 'yellow');
    let duty = e.page.querySelector('.yc-duty');
    if (m === 'yellow' && !duty) {
      duty = document.createElement('div');
      duty.className = 'yc-duty';
      e.page.querySelector('.sf-archive-heading')?.appendChild(duty);
    }
    if (duty) duty.hidden = m !== 'yellow';
    if (m !== 'yellow') closeLog();
    refreshHeading();
  }
  // 標題旁的「清冰箱」看板：幾個人可以派、優先派誰、看全部開單紀錄
  function refreshHeading() {
    const duty = document.querySelector('#page-student-files .yc-duty');
    if (!duty || mode !== 'yellow') return;
    const r = roster();
    const total = r.reduce((a, s) => a + open(s).length, 0);
    const top = r.slice(0, 3).map(s => esc(s.name) + '<em>×' + open(s).length + '</em>').join('、');
    duty.innerHTML = '<div class="yc-duty-n" role="status"><b>' + r.length + '</b><span>人可派<br>清冰箱</span></div>'
      + '<div class="yc-duty-meta"><small>待執行 ' + total + ' 張</small>' + (top ? '<p>優先：' + top + '</p>' : '<p>目前沒人有黃單</p>') + '</div>'
      + '<button type="button" class="yc-log-btn" onclick="yc.openLog()">開單紀錄</button>';
    if (document.getElementById('yc-log')?.classList.contains('is-open')) renderLog();
  }

  function setMode(m) {
    m = m === 'yellow' ? 'yellow' : 'files';
    const changed = m !== mode;
    mode = m;
    if (changed || !TEXT.files) applyText(m);
  }

  window.yc = {
    active: () => mode === 'yellow',
    setMode, roster, list, open, cardHTML, sheetHTML, markCleared, execOne, undoOne, removeOne, add, pick, saveAll, pendingCount,
    openLog, closeLog, logTab(k) { logFilter = k; renderLog(); },
    activeCount: s => (isEmptyBed(s) ? 0 : open(s).length),
    meta(s) { const n = open(s).length; return (s.room || '') + ' 房 · ' + (n ? '待執行 ' + n + ' 張' : '沒有待執行') + ' · 點選查看'; },
    countLabel(results) {
      const q = document.getElementById('sf-search-input')?.value.trim();
      if (q) return String(results.length).padStart(2, '0') + ' 位住宿生';
      return String(results.length).padStart(2, '0') + ' 人待執行';
    },
    emptyHTML() {
      return `<div class="sf-empty-hint yc-empty">
        <div class="yc-empty-card" aria-hidden="true"></div>
        <div style="color:var(--dim); font-size:15px;">目前沒有待執行的黃單</div>
        <div style="color:var(--dim); font-size:12px; margin-top:8px; opacity:.8;">在上面搜尋住宿生就能開單；以前的紀錄在「開單紀錄」</div>
      </div>`;
    },
  };
  // 黃單模式的軌道不循環：名單有幾個人就幾本
  window.sfFinite = () => mode === 'yellow';

  window.openYellowCards = function () {
    navigateTo('student-files');
    setMode('yellow');
    if (window.sfDissolve) window.sfDissolve.init();
    const input = document.getElementById('sf-search-input');
    if (input) input.value = '';
    onStudentFileSearch('');
  };

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLog(); });
  // 在資料夾紙上打字 / 勾選時，下方「儲存 N 筆」即時更新 (資料微動模式)
  let t = 0;
  document.addEventListener('input', e => {
    if (!e.target.closest?.('#sf-card-track')) return;
    clearTimeout(t); t = setTimeout(() => window.sfRefreshCommitBar?.(), 160);
  }, true);
  // change 會在資料夾換人、舊輸入框被移除的那一刻同步觸發，所以一律延後到換完再算
  document.addEventListener('change', e => {
    if (!e.target.closest?.('#sf-card-track')) return;
    clearTimeout(t); t = setTimeout(() => window.sfRefreshCommitBar?.(), 0);
  }, true);
})();
