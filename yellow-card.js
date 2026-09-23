// 黃單額度：跟「資料微動查詢」共用同一頁、同一條弧形資料夾軌道與黑洞，只換資料與配色
// ─────────────────────────────────────────────────────────────────────────────
// 資料放在系統設定表 (/api/config)，一個住宿生一個鍵：yc_<床位頁 id> = JSON 陣列
//   [{ d: '2026-09-23', r: '犯規事由', n: '開單時的姓名', t: 建立時間毫秒 }]
// 一人一鍵：兩個幹部同時替不同人開單不會互相蓋掉；清空 = 寫空字串。
// 記錄會帶開單當時的姓名，床位換人之後舊的黃單不會算到新住宿生頭上。
// 開單是馬上存；黑洞銷單、刪單筆是草稿，清完一輪按軌道下方的「儲存」一次送出。
(function () {
  const PREFIX = 'yc_';
  const PROTECT_MS = 90 * 1000;              // 剛寫進去的值先信本機，背景刷新可能還拿到舊設定
  const REASONS = ['晚歸', '噪音喧嘩', '內務不整', '違規電器', '垃圾未倒', '未到點名'];
  let mode = 'files';
  const pending = new Map();                 // 床位 id -> 銷單後剩下的紀錄 (草稿)
  const local = new Map();                   // 設定鍵 -> { v, at } 這台剛存過的值
  const cache = new Map();                   // 設定鍵 -> { raw, list } 解析快取 (軌道每幀都會問)
  let busy = false;

  const esc = v => (typeof escHtml === 'function' ? escHtml(v) : String(v ?? ''));
  const keyOf = id => PREFIX + id;
  const today = () => (typeof localTodayISO === 'function' ? localTodayISO() : new Date().toISOString().slice(0, 10));
  const short = iso => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? (+m[1]) + '/' + (+m[2]) : (iso || ''); };
  const isEmptyBed = s => !s || s.isEmpty || !s.name;

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
  // 畫面上看到的紀錄 (有草稿就用草稿)
  function list(s) { return s && pending.has(s.id) ? pending.get(s.id) : saved(s); }
  // 寫回設定表時要保留別人 (換床前的住宿生) 的紀錄
  function others(s) { return parse(s.id).filter(x => x.n && x.n !== s.name); }

  function roster() {
    const students = (typeof state !== 'undefined' && state.students) || [];
    return students.filter(s => !isEmptyBed(s) && list(s).length > 0).sort((a, b) => {
      const la = list(a), lb = list(b);
      if (lb.length !== la.length) return lb.length - la.length;
      const da = la[la.length - 1]?.d || '', db = lb[lb.length - 1]?.d || '';
      return da < db ? 1 : da > db ? -1 : 0;
    });
  }

  // ── 資料夾 DOM (結構跟 sfCardHTML 一樣，carousel.js / dissolve.js 才認得) ──
  function slips(n) {
    // 夾在資料夾裡的黃色單子：幾張黃單就露出幾張 (最多 6)，沒有就是一張白紙
    if (!n) return '<i class="yc-blank"></i><i></i><i></i>';
    let h = '';
    for (let i = 0; i < Math.min(n, 6); i++) h += '<i class="yc-slip" style="--i:' + i + '"></i>';
    return h;
  }
  function summaryHTML(s, l) {
    const n = l.length, last = l[l.length - 1];
    const tags = [];
    if (pending.has(s.id)) tags.push('<span class="fd-tag yc-tag-pending">待儲存</span>');
    if (last) tags.push('<span class="fd-tag yc-tag-reason">' + esc(last.r) + '</span>');
    return '<div class="fd-name">' + esc(s.name) + '</div><div class="fd-tags">' + tags.join('') + '</div>';
  }
  function stampHTML(n) {
    return '<div class="yc-stamp' + (n >= 3 ? ' is-hot' : '') + (n ? '' : ' is-zero') + '"><b>' + n + '</b><span>' + (n ? '張黃單' : '無黃單') + '</span></div>';
  }
  function rowsHTML(l) {
    if (!l.length) return '<div class="yc-none">沒有黃單，是乖寶寶</div>';
    return l.map((x, i) => '<div class="yc-row"><time>' + esc(short(x.d)) + '</time><span>' + esc(x.r) + '</span>'
      + '<button type="button" class="yc-del" onclick="yc.removeOne(this,' + i + ')" aria-label="刪除這張黃單">×</button></div>').reverse().join('');
  }
  function badge(n) { return n ? '累犯 ' + n + ' 次' : '無黃單'; }

  function cardHTML(s) {
    const empty = isEmptyBed(s);
    const l = list(s), n = l.length;
    const name = empty ? '空床' : s.name;
    const room = esc(s.room), bed = esc(s.bed);
    const form = empty ? '<div class="yc-none">空床不能開黃單</div>' : `
          <div class="yc-chips">${REASONS.map(r => `<button type="button" class="yc-chip" onclick="yc.pick(this)">${esc(r)}</button>`).join('')}</div>
          <div class="yc-add-row">
            <input type="text" class="yc-reason styled-input" aria-label="犯規事由" maxlength="60" placeholder="犯規事由（可點上面快速填入）" onkeydown="if(event.key==='Enter'){event.preventDefault();yc.add(this)}">
            <button type="button" class="yc-add-btn" onclick="yc.add(this)">開黃單</button>
          </div>`;
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
        <div class="fd-summary">${empty ? '<div class="fd-name is-empty">空床</div>' : summaryHTML(s, l)}</div>
      </div>
      <div class="fd-edge"></div>
      <div class="fd-sheet yc-sheet">
        <div class="sf-card-title">
          <span class="sf-title-text">${room} ${bed}</span>
          <div class="sf-card-badge-relative">${badge(n)}</div>
          <button class="sf-icon-btn sf-close-btn" onclick="sfCarousel.dismiss()" aria-label="關閉檔案">×</button>
          <button class="sf-icon-btn sf-broom-btn" onclick="clearStudentData(this)" title="黑洞銷掉全部黃單" aria-label="黑洞銷掉全部黃單"${n ? '' : ' disabled'}><svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9"/><path d="M21 12a9 9 0 0 1-9 9" opacity=".6"/><path d="M12 21a9 9 0 0 1-9-9" opacity=".35"/></svg></button>
        </div>
        <div class="yc-label"><b>${esc(name)}</b> 的違規紀錄</div>
        <div class="yc-list">${empty ? '' : rowsHTML(l)}</div>
        <div class="yc-add">${form}</div>
      </div>
    `;
  }

  // 只換內容、不換整本 DOM：紙打開時重畫 innerHTML 會讓紙瞬間消失
  function refreshFolder(el, s) {
    const l = list(s), n = l.length;
    const q = sel => el.querySelector(sel);
    const sum = q('.fd-summary'); if (sum) sum.innerHTML = summaryHTML(s, l);
    const st = q('.yc-stamp'); if (st) st.outerHTML = stampHTML(n);
    const rail = q('.fd-rail-label'); if (rail) rail.textContent = s.name + (n ? ' ×' + n : '');
    const paper = q('.fd-paper'); if (paper) paper.innerHTML = slips(n);
    const b = q('.sf-card-badge-relative'); if (b) b.textContent = badge(n);
    const rows = q('.yc-list'); if (rows) rows.innerHTML = rowsHTML(l);
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
  async function add(el) {
    const { folder, s } = ownerOf(el);
    if (!folder || !s || isEmptyBed(s)) return;
    const input = folder.querySelector('.yc-reason');
    const reason = (input?.value || '').trim();
    if (!reason) { showToast('先寫犯規事由（或點上面的快速選項）', 'error'); input?.focus(); return; }
    const btn = folder.querySelector('.yc-add-btn');
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = '開單中…'; }
    const next = list(s).concat([{ d: today(), r: reason, n: s.name, t: Date.now() }]);
    try {
      await write({ [keyOf(s.id)]: JSON.stringify(others(s).concat(next)) });
      pending.delete(s.id);        // 有草稿時以開單後的完整清單為準
      if (input) input.value = '';
      for (const c of folder.querySelectorAll('.yc-chip.is-on')) c.classList.remove('is-on');
      refreshStudent(s);
      stampPop(folder);
      haptic('heavy');
      showToast(esc(s.name) + ' 開了第 ' + next.length + ' 張黃單', 'success');
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

  // ── 銷單 (草稿，按下方儲存才送) ─────────────────────────────────────────
  function removeOne(el, index) {
    const { s } = ownerOf(el);
    if (!s) return;
    const l = list(s).slice();
    if (index < 0 || index >= l.length) return;
    l.splice(index, 1);
    pending.set(s.id, l);
    haptic('light');
    refreshStudent(s);
  }
  function markCleared(s) {
    if (!s) return;
    pending.set(s.id, []);
    refreshStudent(s);
  }
  function pendingCount() {
    let n = 0;
    for (const [id, l] of pending) {
      const s = state.students.find(x => x.id === id);
      if (s && JSON.stringify(l) !== JSON.stringify(saved(s))) n++;
    }
    return n;
  }
  async function saveAll() {
    const btn = document.querySelector('#sf-commit-bar .sf-commit-save');
    if (busy || !btn) return;
    const updates = {}, ids = [];
    for (const [id, l] of pending) {
      const s = state.students.find(x => x.id === id);
      if (!s || JSON.stringify(l) === JSON.stringify(saved(s))) { pending.delete(id); continue; }
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
      // 銷光的人從軌道上下架
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

  // ── 頁面外觀：同一頁切兩種模式 ─────────────────────────────────────────
  const TEXT = {
    files: null,   // 第一次切換時從 HTML 讀原文
    yellow: {
      eyebrow: 'BIYUAN / YELLOW CARD LEDGER',
      status: '違規紀錄',
      sub: '誰欠一次清冰箱，一眼就知道',
      title: '黃單額度<span>Yellow card ledger</span>',
      placeholder: '搜尋住宿生，可直接開黃單',
      hint: '左右拖曳瀏覽 · 點選檔案看紀錄 · 黑洞＝銷單',
      pick: '目前選取',
      hole: '黑洞銷單',
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
      duty.setAttribute('role', 'status');
      e.page.querySelector('.sf-archive-heading')?.appendChild(duty);
    }
    if (duty) duty.hidden = m !== 'yellow';
    refreshHeading();
  }
  // 標題旁的「清冰箱」看板：幾個人可以派、優先派誰
  function refreshHeading() {
    const duty = document.querySelector('#page-student-files .yc-duty');
    if (!duty || mode !== 'yellow') return;
    const r = roster();
    const total = r.reduce((a, s) => a + list(s).length, 0);
    const top = r.slice(0, 3).map(s => esc(s.name) + '<em>×' + list(s).length + '</em>').join('、');
    duty.innerHTML = '<div class="yc-duty-n"><b>' + r.length + '</b><span>人可派<br>清冰箱</span></div>'
      + '<div class="yc-duty-meta"><small>共 ' + total + ' 張黃單</small>' + (top ? '<p>優先：' + top + '</p>' : '<p>目前沒人有黃單</p>') + '</div>';
  }

  function setMode(m) {
    m = m === 'yellow' ? 'yellow' : 'files';
    const changed = m !== mode;
    mode = m;
    if (changed || !TEXT.files) applyText(m);
  }

  window.yc = {
    active: () => mode === 'yellow',
    setMode, roster, list, cardHTML, markCleared, removeOne, add, pick, saveAll, pendingCount,
    meta(s) { const n = list(s).length; return (s.room || '') + ' 房 · ' + (n ? '累犯 ' + n + ' 次' : '沒有黃單') + ' · 點選查看'; },
    countLabel(results) {
      const q = document.getElementById('sf-search-input')?.value.trim();
      if (q) return String(results.length).padStart(2, '0') + ' 位住宿生';
      return String(results.length).padStart(2, '0') + ' 人有黃單';
    },
    emptyHTML() {
      return `<div class="sf-empty-hint yc-empty">
        <div class="yc-empty-card" aria-hidden="true"></div>
        <div style="color:var(--dim); font-size:15px;">目前沒有人有黃單</div>
        <div style="color:var(--dim); font-size:12px; margin-top:8px; opacity:.8;">在上面搜尋住宿生，就能替他開單</div>
      </div>`;
    },
  };

  window.openYellowCards = function () {
    navigateTo('student-files');
    setMode('yellow');
    if (window.sfDissolve) window.sfDissolve.init();
    const input = document.getElementById('sf-search-input');
    if (input) input.value = '';
    onStudentFileSearch('');
  };

  // 在資料夾紙上打字 / 勾選時，下方「儲存 N 筆」即時更新 (資料微動模式)
  let t = 0;
  document.addEventListener('input', e => {
    if (!e.target.closest?.('#sf-card-track')) return;
    clearTimeout(t); t = setTimeout(() => window.sfRefreshCommitBar?.(), 160);
  }, true);
  document.addEventListener('change', e => {
    if (e.target.closest?.('#sf-card-track')) window.sfRefreshCommitBar?.();
  }, true);
})();
