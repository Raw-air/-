// 平板模式無縫變形：開 / 關平板模式時，畫面不是直接跳成新版面，
// 而是每個元件 (卡片、標題、統計格、按鈕) 各自從舊位置滑到新位置、大小跟著變，
// 側欄從左邊展開 (或收回)、底部導覽列往下收 (或升回來)。
//   主路線：View Transitions API，每個元件給一個 view-transition-name，瀏覽器幫忙做位移 + 尺寸 + 交叉淡化
//   備援：沒有 View Transitions 時用 FLIP (量舊 rect → 換版面 → 量新 rect → transform 從舊滑到新)
// 切換時畫面上的文字會先變成一堆怪符號像抽獎一樣狂轉，再減速、一個字一個字定格回原文 (Scramble)。
// 只在 tablet.js 的 setTabletMode(on, animate=true) 時被呼叫；省電模式 / 減少動態就直接跳結果。
(function () {
  const root = document.documentElement;
  const MAX_PIECES = 80;
  const DUR = 640;                                  // 位移時間 (ms)
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const STAGGER = 140;                              // 由上到下最多錯開的時間 (ms)
  // 這些容器要拆成裡面一張張卡片，才有「很多元件各自改位置」的感覺
  const SPLIT = '#squad-grid, #management-grid, .big-stats, .summary-row-2, .summary-row-3, .squad-detail-grid, .summary-actions, .student-list, .calendar-grid, #page-tools > div, #page-management > div';
  const EXTRAS = ['#back-btn', '.fab-empty-bed', '.rc-confirm-container', '#qm-toggle'];

  let running = false;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const visible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.bottom > -40 && r.top < innerHeight + 40 && r.right > 0 && r.left < innerWidth;
  };

  function collectPieces() {
    const page = document.querySelector('.page.active');
    const set = new Set();
    if (page) {
      for (const child of page.children) {
        if (!visible(child)) continue;
        if (child.matches(SPLIT) && child.children.length > 1 && child.children.length <= 60) {
          for (const c of child.children) if (visible(c)) set.add(c);
        } else set.add(child);
        if (set.size >= MAX_PIECES) break;
      }
    }
    for (const sel of EXTRAS) {
      const el = document.querySelector(sel);
      if (!el || !visible(el) || set.has(el)) continue;
      let covered = false; for (const p of set) if (p.contains(el)) { covered = true; break; }
      if (!covered) set.add(el);
    }
    return { page, pieces: [...set].slice(0, MAX_PIECES) };
  }
  // 側欄裡的每一塊 (時鐘、每個導覽鈕、每個工具鈕、底部) 各自算一個零件，才能一片片展開
  const railParts = (rail) => {
    if (!rail) return [];
    const out = [];
    for (const c of rail.children) {
      if (c.matches('.tb-nav, .tb-tools')) out.push(...c.children); else out.push(c);
    }
    return out;
  };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // 底部導覽列 (.bottom-nav / .bottom-nav-glow) 與 #qm-toggle 本身靠 transform: translateX(-50%) 置中。
  // 動畫如果寫 transform 會把置中蓋掉，導覽列就會先出現在偏右、再跳 / 滑回中間。
  // 所以這幾個只用獨立的 translate / scale 屬性做動畫 (會跟原本的 transform 疊加)。
  const NAV_HIDE = { opacity: 0, translate: '0 120%' };
  const NAV_SHOW = { opacity: 1, translate: '0 0' };
  const QM_HIDE = { opacity: 0, scale: '.6' };
  const QM_SHOW = { opacity: 1, scale: '1' };
  const anim = (el, frames, opt) => { try { return el.animate(frames, Object.assign({ fill: 'both', easing: EASE, duration: DUR }, opt)); } catch (_) { return null; } };

  // ══ 亂碼解碼 (切換時文字先變成一堆怪符號，像抽獎轉盤一樣狂轉，再慢下來定格成原本的字) ══
  // 只改「文字節點的 nodeValue」，不插 span、不動 DOM 結構，所以不會重排整頁。
  // 每個字的一生：怪符號快速亂跳 → 快定格前換成亂碼中文、跳得越來越慢 (轉盤減速) → 定格成正確的字。
  // 中文位置用「全形」符號 (＠＃Ｑ％…)，跟中文一樣寬，版面不會跳；英文數字位置用半形符號。
  // 別的程式在解碼途中改了同一段文字 (例如側欄時鐘跳分鐘)，就放掉那段不再管，不會把新文字蓋回舊的。
  const Scramble = (() => {
    const SYM = '@#$%&*+=?!<>/~^QXZW{}[]';
    const toFull = (s) => s.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
    const POOL_SYM_FW = toFull(SYM);                       // 全形怪符號 (中文位置)
    const POOL_SYM = SYM + '0123456789';                    // 半形怪符號 (英文數字位置)
    const POOL_CJK = '锟斤拷烫屯鎷鏈夌殑鍦版柟涓嶈兘浣犲ソ閿欒娆㈣繋璇曡瘯鐨勬槸浜嗕竴鍦ㄦ湁鍜屼汉涓粰闂佺粯瀹炵幇鍏抽敭鏁版嵁绯荤粺';
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE']);
    const TICK = 28;                                        // 迴圈最快多久看一次 (每個字自己決定要不要換)
    const MAX_NODES = 500;
    const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
    const kindOf = (ch) => CJK_RE.test(ch) ? 2 : /[A-Za-z0-9]/.test(ch) ? 1 : 0;
    const pick = (s) => s[(Math.random() * s.length) | 0];
    // p = 這個字從開始亂到定格走了多少 (0~1)；越接近 1 越常出現中文、換得越慢
    const glyph = (kind, p) => kind === 2 ? (p > 0.68 && Math.random() < (p - 0.6) * 2.4 ? pick(POOL_CJK) : pick(POOL_SYM_FW)) : pick(POOL_SYM);
    const swapGap = (p) => 26 + p * p * p * 210 + Math.random() * 18;
    const now = () => performance.now();
    const jobs = new Map();
    let raf = 0, last = 0, waiters = [];

    // 找出某個區塊裡「看得到」的文字節點 (照文件順序)
    function textNodes(el) {
      if (!el) return [];
      const out = [];
      const okParent = new Map();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (!p || p.closest('svg')) return NodeFilter.FILTER_REJECT;
          if (!okParent.has(p)) {
            let ok = !SKIP.has(p.tagName);
            if (ok) { const cs = getComputedStyle(p); ok = cs.display !== 'none' && cs.visibility !== 'hidden'; }
            okParent.set(p, ok);
          }
          return okParent.get(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      while (walker.nextNode() && out.length < MAX_NODES) out.push(walker.currentNode);
      return out;
    }

    function add(node, breakAt) {
      let job = jobs.get(node);
      if (job) return job;
      if (jobs.size >= MAX_NODES) return null;
      const chars = Array.from(node.nodeValue);
      const kinds = chars.map(kindOf);
      if (!kinds.some(Boolean)) return null;               // 全是符號 / 空白，不用演
      job = {
        node, orig: node.nodeValue, written: node.nodeValue, chars, kinds,
        cur: chars.slice(),
        nextAt: chars.map(() => 0),
        breakAt: chars.map(() => breakAt + Math.random() * 140),
        resolveAt: chars.map(() => Infinity),
      };
      jobs.set(node, job);
      start();
      return job;
    }
    // 讓一段文字在 t0 開始由左到右定格，spread 毫秒內全部定格 (每個字再加一點隨機，像轉盤一格格停)
    function decode(node, t0, spread) {
      const job = jobs.get(node) || add(node, now());
      if (!job) return 0;
      const n = job.chars.length;
      for (let i = 0; i < n; i++) job.resolveAt[i] = Math.max(job.breakAt[i] + 260, t0 + (n > 1 ? i / (n - 1) : 0) * spread + Math.random() * 160);
      return t0 + spread + 160 + 260;
    }
    function restore(job) {
      if (job.node.nodeValue === job.written && job.written !== job.orig) job.node.nodeValue = job.orig;
      jobs.delete(job.node);
    }
    function start() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
    function tick(t) {
      raf = 0;
      if (t - last >= TICK) {
        last = t;
        const tn = now();
        for (const job of jobs.values()) {
          if (job.node.nodeValue !== job.written || !job.node.isConnected) { jobs.delete(job.node); continue; }   // 被別人改掉了
          let out = '', pending = false;
          for (let i = 0; i < job.chars.length; i++) {
            const kind = job.kinds[i];
            if (!kind || tn >= job.resolveAt[i]) { out += job.chars[i]; continue; }
            pending = true;
            if (tn < job.breakAt[i]) { out += job.chars[i]; continue; }
            const span = job.resolveAt[i] - job.breakAt[i];
            const p = span === Infinity ? 0 : Math.min(1, Math.max(0, (tn - job.breakAt[i]) / span));
            if (tn >= job.nextAt[i]) { job.cur[i] = glyph(kind, p); job.nextAt[i] = tn + swapGap(p); }
            out += job.cur[i];
          }
          if (out !== job.written) { job.node.nodeValue = out; job.written = out; }
          if (!pending) restore(job);
        }
      }
      if (jobs.size) raf = requestAnimationFrame(tick);
      else { const w = waiters; waiters = []; w.forEach(r => r()); }
    }
    // 全部立刻變回原文 (保險絲：分頁在背景 rAF 不跑時也保證文字正確)
    function finish() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      for (const job of [...jobs.values()]) restore(job);
      const w = waiters; waiters = []; w.forEach(r => r());
    }
    const idle = () => jobs.size ? new Promise(r => waiters.push(r)) : Promise.resolve();
    const breakRegion = (el, breakAt) => textNodes(el).forEach(n => add(n, breakAt));
    // 整個區塊由上到下解碼：同一區塊裡的每段文字依序錯開；字越多轉越久 (上限 max)
    function decodeRegion(el, t0, opt = {}) {
      const step = opt.step ?? 90, perChar = opt.perChar ?? 55, min = opt.min ?? 480, max = opt.max ?? 1150;
      let end = 0;
      textNodes(el).forEach((n, k) => {
        const len = n.nodeValue.trim().length;
        end = Math.max(end, decode(n, t0 + k * step, clamp(len * perChar, min, max)));
      });
      return end;
    }
    return { textNodes, add, decode, breakRegion, decodeRegion, finish, idle, restoreRegion: (el) => textNodes(el).forEach(n => { const j = jobs.get(n); if (j) restore(j); }), get size() { return jobs.size; } };
  })();
  window.tbScramble = Scramble;   // 方便除錯

  // ── 主路線：View Transitions ──
  async function runVT(on, applyFn) {
    const { pieces } = collectPieces();
    const named = [];
    const style = document.createElement('style');
    let css = '';
    const name = (el, n, delay) => {
      el.style.viewTransitionName = n;
      named.push(el);
      if (delay) css += `::view-transition-group(${n}),::view-transition-old(${n}),::view-transition-new(${n}){animation-delay:${Math.round(delay)}ms}\n`;
    };
    // 由上往下錯開一點點，畫面像是從上到下「展開」，不是同時瞬移
    pieces.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      name(el, `tf-p${i}`, clamp(r.top / innerHeight, 0, 1) * STAGGER);
    });
    const nav = document.querySelector('.bottom-nav');
    const glow = document.querySelector('.bottom-nav-glow');
    if (nav) name(nav, 'tf-nav');
    if (glow) name(glow, 'tf-nav-glow');
    let rail = document.querySelector('.tb-rail');
    if (!on && rail) {
      name(rail, 'tf-rail');
      railParts(rail).forEach((el, i) => name(el, `tf-r${i}`, i * 18));
    }
    document.head.appendChild(style);
    root.classList.add('tb-tf', 'vt-active');

    let transition;
    try {
      transition = document.startViewTransition(() => {
        applyFn(on);
        // 新畫面是「活的」，所以在這裡排好解碼，交叉淡入時就會看到亂碼慢慢變回文字
        const T = performance.now();
        pieces.forEach(el => {
          if (!el.isConnected) return;
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight) return;
          Scramble.decodeRegion(el, T + 140 + clamp(r.top / innerHeight, 0, 1) * STAGGER * 2);
        });
        if (on) { const rl = document.querySelector('.tb-rail'); railParts(rl).forEach((el, i) => Scramble.decodeRegion(el, T + 200 + i * 30, { min: 420, max: 900 })); }
        if (on) {
          // 側欄是 applyFn 才建出來的，在這裡命名，瀏覽器會把它當「新出現的元件」
          rail = document.querySelector('.tb-rail');
          if (rail) {
            name(rail, 'tf-rail');
            railParts(rail).forEach((el, i) => name(el, `tf-r${i}`, 80 + i * 26));
          }
        }
        style.textContent = css;
      });
    } catch (_) {
      root.classList.remove('tb-tf', 'vt-active');
      style.remove();
      return false;
    }
    // 快照拍好之後就可以把毛玻璃等開回來 (live DOM 在轉場期間看不到)
    transition.ready.then(() => root.classList.remove('vt-active')).catch(() => {});
    transition.updateCallbackDone?.catch?.(() => {});   // 分頁在背景時瀏覽器會跳過轉場，promise 會 reject，不要冒成全域錯誤
    const fuse = wait(DUR + STAGGER + 1200);
    await Promise.race([transition.finished.catch(() => {}), fuse]);
    await Promise.race([Scramble.idle(), wait(1800)]);
    // 瀏覽器沒畫面時 (視窗被擋住、分頁在背景) 轉場回呼可能一直沒跑；保險絲到了就直接把狀態切過去
    if (root.classList.contains('tablet-mode') !== on) { try { transition.skipTransition?.(); } catch (_) {} applyFn(on); }
    named.forEach(el => { el.style.viewTransitionName = ''; });
    style.remove();
    root.classList.remove('tb-tf', 'vt-active');
    return true;
  }

  // ── 備援：FLIP ──
  async function runFLIP(on, applyFn) {
    const { pieces } = collectPieces();
    const before = pieces.map(el => el.getBoundingClientRect());
    const anims = [];
    const nav = document.querySelector('.bottom-nav');
    const glow = document.querySelector('.bottom-nav-glow');
    const railOld = document.querySelector('.tb-rail');
    root.classList.add('tb-tf');
    if (!on && railOld) {
      // 先把側欄收回去，再換版面
      railParts(railOld).forEach((el, i) => anims.push(anim(el, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-24px)', opacity: 0 }], { duration: 220, delay: i * 10 })));
      anims.push(anim(railOld, [{ transform: 'none' }, { transform: 'translateX(-100%)' }], { duration: 300, delay: 60 }));
      await wait(300);
    } else if (on) {
      [nav, glow].forEach(el => el && anims.push(anim(el, [NAV_SHOW, NAV_HIDE], { duration: 300 })));
      await wait(120);
    }
    applyFn(on);
    void document.body.offsetHeight;
    {
      const T = performance.now();
      pieces.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        Scramble.decodeRegion(el, T + 120 + clamp(r.top / innerHeight, 0, 1) * STAGGER * 2);
      });
      if (on) railParts(document.querySelector('.tb-rail')).forEach((el, i) => Scramble.decodeRegion(el, T + 160 + i * 30, { min: 420, max: 900 }));
    }
    pieces.forEach((el, i) => {
      const b = before[i];
      if (!visible(el)) return;
      const a = el.getBoundingClientRect();
      const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
      const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      const sx = clamp(b.width / a.width, .2, 5), sy = clamp(b.height / a.height, .2, 5);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) return;
      el.style.transformOrigin = '50% 50%';
      anims.push(anim(el, [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: 'none' },
      ], { delay: clamp(b.top / innerHeight, 0, 1) * STAGGER }));
    });
    if (on) {
      const rail = document.querySelector('.tb-rail');
      if (rail) {
        anims.push(anim(rail, [{ transform: 'translateX(-100%)' }, { transform: 'none' }], { duration: 480 }));
        railParts(rail).forEach((el, i) => anims.push(anim(el, [{ transform: 'translateX(-24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 120 + i * 26 })));
      }
    } else {
      [nav, glow].forEach(el => el && anims.push(anim(el, [NAV_HIDE, NAV_SHOW], { duration: 480, delay: 160 })));
    }
    await wait(DUR + STAGGER + 200);
    await Promise.race([Scramble.idle(), wait(1800)]);
    anims.forEach(a => { try { a?.cancel(); } catch (_) {} });
    pieces.forEach(el => { el.style.transformOrigin = ''; });
    root.classList.remove('tb-tf');
    return true;
  }

  // ══ 設定頁專屬編排 (開關就在這一頁，所以這頁要做到最好) ══
  //   每張卡片、標題、側欄的每一塊、底部導覽列都當成一個「方塊」：
  //   ① 退場：方塊由上到下快速縮小淡出 (220ms，錯開 22ms)
  //   ② 換版面 (畫面上什麼都沒有，所以換的那一瞬間看不到跳動)；你按的那一列校正回同一個高度
  //   ③ 進場：每個方塊從「它原本的位置那個方向」滑進新位置 + 放大回 1 + 淡入，由上到下、左到右一個個錯開；
  //          卡片裡的每一列在方塊到位途中再依序淡入；側欄先推入，裡面的時鐘、按鈕一個個長出來
  //   進場動畫用 fill:backwards，播完就自動回到自然狀態，結尾不用一次取消幾十個動畫 (那就是之前卡一下的來源)
  const SET = {
    out: 220, outStep: 22,                 // ① 每個方塊退場時間 / 方塊錯開
    in: 600, inStep: 62, inMax: 420,       // ③ 方塊進場時間 / 錯開 / 最多錯開
    row: 360, rowStep: 24, rowLag: 110,    // ③ 卡片裡每一列淡入時間 / 錯開 / 比卡片晚多少開始
    rail: 520, railPart: 40, railLag: 140,
    drift: .32, driftMax: 160,             // 進場起點 = 往舊位置方向偏移多少 (比例 / 上限 px)
  };
  const OUT_EASE = 'cubic-bezier(.4, 0, .7, 1)';
  const IN_EASE = 'cubic-bezier(.2, .8, .2, 1)';
  const enter = (el, from, opt) => { try { return el.animate([from, { opacity: 1, transform: 'none' }], Object.assign({ fill: 'backwards', easing: IN_EASE }, opt)); } catch (_) { return null; } };
  const leave = (el, to, opt) => { try { return el.animate([{ opacity: 1, transform: 'none' }, to], Object.assign({ fill: 'forwards', easing: OUT_EASE }, opt)); } catch (_) { return null; } };

  async function runSettings(on, applyFn) {
    const page = document.getElementById('page-settings');
    if (!page || !page.classList.contains('active') || !visible(page)) return false;
    const toggle = document.getElementById('setting-tablet');
    const anchor = toggle?.closest('.setting-row') || toggle || page;
    const title = page.querySelector(':scope > .page-title');
    // 所有卡片都要參與 (包含還在螢幕下方看不到的)，換成兩欄後它們會進到畫面裡
    const cards = [...page.querySelectorAll(':scope > .settings-card')].filter(c => getComputedStyle(c).display !== 'none');
    if (!cards.length) return false;
    const blocks = [title, ...cards].filter(Boolean);
    const rows = cards.map(c => [...c.children].filter(el => el.nodeType === 1 && getComputedStyle(el).display !== 'none'));
    const nav = document.querySelector('.bottom-nav');
    const glow = document.querySelector('.bottom-nav-glow');
    const qm = document.querySelector('#qm-toggle');
    let rail = document.querySelector('.tb-rail');
    const outAnims = [];
    const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    root.classList.add('tb-tf');
    blocks.forEach(b => { b.style.transition = 'none'; });

    // ── ① 退場 ──
    const before = blocks.map(b => b.getBoundingClientRect());
    const anchorTop = anchor.getBoundingClientRect().top;
    let outEnd = 0;
    blocks.forEach((b, i) => {
      if (before[i].bottom < -20 || before[i].top > innerHeight + 20) return;   // 螢幕外的不用演
      const d = Math.min(i, 8) * SET.outStep;
      outEnd = Math.max(outEnd, d + SET.out);
      b.style.transformOrigin = '50% 50%';
      outAnims.push(leave(b, { opacity: 0, transform: 'translateY(-10px) scale(.97)' }, { duration: SET.out, delay: d }));
      Scramble.breakRegion(b, performance.now() + d * .5);   // 淡出前先亂掉
    });
    if (on) {
      [nav, glow].forEach(el => el && outAnims.push(anim(el, [NAV_SHOW, NAV_HIDE], { duration: 320, easing: OUT_EASE, fill: 'forwards' })));
      if (qm && visible(qm)) outAnims.push(anim(qm, [QM_SHOW, QM_HIDE], { duration: 240, easing: OUT_EASE, fill: 'forwards' }));
      outEnd = Math.max(outEnd, 300);
    } else if (rail) {
      const parts = railParts(rail);
      Scramble.breakRegion(rail, performance.now());
      parts.forEach((el, i) => outAnims.push(leave(el, { opacity: 0, transform: 'translateX(-12px)' }, { duration: 200, delay: (parts.length - 1 - i) * 14 })));
      outAnims.push(leave(rail, { transform: 'translateX(-100%)', opacity: 1 }, { duration: 380, delay: 120, easing: 'cubic-bezier(.5, 0, .75, .2)' }));
      outEnd = Math.max(outEnd, 500);
    }
    await wait(outEnd - 40);

    // ── ② 換版面 ──
    // 退場動畫的最後一格是「看不見」，先用內聯樣式接住，再取消動畫 (畫面上什麼都沒有，這一格再重也看不到)
    blocks.forEach(b => { b.style.opacity = '0'; });
    outAnims.forEach(a => { try { a?.cancel(); } catch (_) {} });
    applyFn(on);
    rail = document.querySelector('.tb-rail');
    if (rail) rail.style.animation = 'none';          // 側欄自己的 CSS 滑入動畫交給這裡，結尾才不會重播
    const parts = on ? railParts(rail) : [];
    void document.body.offsetHeight;
    const se = document.scrollingElement || root;
    const drift = anchor.getBoundingClientRect().top - anchorTop;
    if (Math.abs(drift) > 1) se.scrollTop += drift;
    const after = blocks.map(b => b.getBoundingClientRect());

    // ── ③ 進場：由上到下、左到右一個個方塊 ──
    const order = blocks.map((b, i) => i).sort((p, q) => (after[p].top - after[q].top) || (after[p].left - after[q].left));
    let inEnd = 0;
    const T = performance.now();
    const decodeEnd = (end) => { if (end) inEnd = Math.max(inEnd, end - T); };
    order.forEach((i, rank) => {
      const b = blocks[i];
      const a = after[i];
      if (a.bottom < -20 || a.top > innerHeight + 20) { b.style.opacity = ''; Scramble.restoreRegion(b); return; }   // 新版面裡也看不到的，直接還原
      const bc = center(before[i]), ac = center(a);
      const dx = clamp((bc.x - ac.x) * SET.drift, -SET.driftMax, SET.driftMax);
      const dy = clamp((bc.y - ac.y) * SET.drift, -SET.driftMax, SET.driftMax);
      const d = Math.min(rank * SET.inStep, SET.inMax);
      inEnd = Math.max(inEnd, d + SET.in);
      b.style.opacity = '';
      enter(b, { opacity: 0, transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(.96)` }, { duration: SET.in, delay: d });
      const ci = cards.indexOf(b);
      if (ci < 0) decodeEnd(Scramble.decodeRegion(b, T + d + 160, { perChar: 110, min: 700, max: 1200 }));   // 頁面標題
      else rows[ci].forEach((el, ii) => {
        const rd = d + SET.rowLag + ii * SET.rowStep;
        inEnd = Math.max(inEnd, rd + SET.row);
        enter(el, { opacity: 0, transform: 'translateY(6px)' }, { duration: SET.row, delay: rd });
        decodeEnd(Scramble.decodeRegion(el, T + rd + 70));   // 這一列淡入到一半就開始解碼
      });
    });
    if (on && rail) {
      enter(rail, { opacity: 1, transform: 'translateX(-100%)' }, { duration: SET.rail, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      parts.forEach((el, i) => {
        const d = SET.railLag + i * SET.railPart;
        inEnd = Math.max(inEnd, d + 460);
        enter(el, { opacity: 0, transform: 'translateX(-14px) scale(.97)' }, { duration: 460, delay: d });
        decodeEnd(Scramble.decodeRegion(el, T + d + 90, { min: 420, max: 900 }));
      });
    }
    if (!on) {
      [nav, glow].forEach(el => el && anim(el, [NAV_HIDE, NAV_SHOW], { duration: 560, delay: 180, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' }));
      if (qm) anim(qm, [QM_HIDE, QM_SHOW], { duration: 420, delay: 380, easing: IN_EASE, fill: 'backwards' });
    }
    // 進場動畫是 fill:backwards，播完自己回到自然狀態；這裡只把暫時的內聯樣式拿掉 (不影響正在播的動畫)
    blocks.forEach(b => { b.style.transition = ''; b.style.transformOrigin = ''; });
    await wait(inEnd + 60);
    await Promise.race([Scramble.idle(), wait(400)]);
    Scramble.finish();
    root.classList.remove('tb-tf');
    window.haptic?.('light');
    return true;
  }

  async function run(on, applyFn) {
    if (running) return false;
    running = true;
    window.haptic?.('light');
    try {
      let ok = await runSettings(on, applyFn);
      if (!ok && document.startViewTransition) ok = await runVT(on, applyFn);
      if (!ok) await runFLIP(on, applyFn);
    } catch (err) {
      console.error(err);
      Scramble.finish();
      root.classList.remove('tb-tf', 'vt-active');
      if (root.classList.contains('tablet-mode') !== on) applyFn(on);   // 動畫炸了也要保證狀態切過去
    }
    Scramble.finish();
    running = false;
    return true;
  }

  window.tbTransform = { run, get running() { return running; } };
})();
