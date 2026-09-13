// 平板模式無縫變形：開 / 關平板模式時，畫面不是直接跳成新版面，
// 而是每個元件 (卡片、標題、統計格、按鈕) 各自從舊位置滑到新位置、大小跟著變，
// 側欄從左邊展開 (或收回)、底部導覽列往下收 (或升回來)。
//   主路線：View Transitions API，每個元件給一個 view-transition-name，瀏覽器幫忙做位移 + 尺寸 + 交叉淡化
//   備援：沒有 View Transitions 時用 FLIP (量舊 rect → 換版面 → 量新 rect → transform 從舊滑到新)
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
  const anim = (el, frames, opt) => { try { return el.animate(frames, Object.assign({ fill: 'both', easing: EASE, duration: DUR }, opt)); } catch (_) { return null; } };

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
      [nav, glow].forEach(el => el && anims.push(anim(el, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(120%)', opacity: 0 }], { duration: 300 })));
      await wait(120);
    }
    applyFn(on);
    void document.body.offsetHeight;
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
      [nav, glow].forEach(el => el && anims.push(anim(el, [{ transform: 'translateY(120%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: 160 })));
    }
    await wait(DUR + STAGGER + 200);
    anims.forEach(a => { try { a?.cancel(); } catch (_) {} });
    pieces.forEach(el => { el.style.transformOrigin = ''; });
    root.classList.remove('tb-tf');
    return true;
  }

  // ══ 設定頁專屬編排 (開關就在這一頁，所以這頁要做到最好) ══
  //   ① 漣漪：從你按的那一列發出一圈波紋，波紋掃到哪，卡片裡的內容就一列列溶解，只留下卡片外殼
  //   ② 移動：外殼 (空的，沒有文字所以不會拉伸變形) 滑到新版面的位置，側欄從左邊推進來
  //   ③ 建設：從開關附近開始，每張卡片依序把標題、一列列內容長回來，卡片上掃過一道光；
  //          側欄的時鐘、導覽鈕、工具鈕一個個長出來
  const SET = {
    dissolve: 200, dissolveRow: 18, dissolveSpread: 170,   // ① 溶解每列時間 / 列與列錯開 / 由近到遠最多錯開
    move: 680, moveSpread: 120,                              // ② 外殼位移時間 / 由近到遠錯開
    buildStart: 300,                                         // ③ 位移開始後多久開始建設 (重疊才順)
    build: 460, buildRow: 36, buildCard: 70,                 // ③ 每列長出來時間 / 列錯開 / 卡片錯開
    railIn: 560, railPart: 44,
  };
  const OUT_EASE = 'cubic-bezier(.4, 0, 1, 1)';
  const IN_EASE = 'cubic-bezier(.16, 1, .3, 1)';

  function ripple(x, y, radius, color) {
    const wrap = document.createElement('div');
    wrap.className = 'tf-ripple';
    wrap.style.cssText = `left:${x}px;top:${y}px;--tf-ripple-c:${color}`;
    wrap.innerHTML = '<i></i><i></i>';
    document.body.appendChild(wrap);
    const size = radius * 2.2;
    [...wrap.children].forEach((ring, i) => {
      ring.animate([
        { width: '0px', height: '0px', opacity: .9 },
        { width: `${size}px`, height: `${size}px`, opacity: 0 },
      ], { duration: 820 + i * 120, delay: i * 130, easing: 'cubic-bezier(.2, .6, .3, 1)', fill: 'forwards' });
    });
    return wrap;
  }
  function sheen(card, delay) {
    const s = document.createElement('i');
    s.className = 'tf-sheen';
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.appendChild(s);
    const a = s.animate([{ transform: 'translateX(-110%) skewX(-14deg)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'translateX(110%) skewX(-14deg)', opacity: 0 }],
      { duration: 720, delay, easing: 'cubic-bezier(.3, 0, .2, 1)', fill: 'both' });
    return { el: s, a };
  }

  async function runSettings(on, applyFn) {
    const page = document.getElementById('page-settings');
    if (!page || !page.classList.contains('active') || !visible(page)) return false;
    const toggle = document.getElementById('setting-tablet');
    const anchor = toggle?.closest('.setting-row') || toggle || page;
    const title = page.querySelector(':scope > .page-title');
    // 所有卡片都要參與 (包含還在螢幕下方看不到的)，換成兩欄後它們會進到畫面裡，也要跟著滑進來、長出來
    const cards = [...page.querySelectorAll(':scope > .settings-card')].filter(c => getComputedStyle(c).display !== 'none');
    if (!cards.length) return false;
    const shells = [title, ...cards].filter(Boolean);
    const items = cards.map(c => [...c.children].filter(el => el.nodeType === 1 && getComputedStyle(el).display !== 'none'));
    const nav = document.querySelector('.bottom-nav');
    const glow = document.querySelector('.bottom-nav-glow');
    const qm = document.querySelector('#qm-toggle');
    let rail = document.querySelector('.tb-rail');
    const anims = [], temps = [];
    const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const dist = (r, o) => { const c = center(r); return Math.hypot(c.x - o.x, c.y - o.y); };
    const accent = getComputedStyle(root).getPropertyValue('--blue').trim() || '#0a84ff';
    root.classList.add('tb-tf');
    shells.forEach(s => { s.style.transition = 'none'; s.classList.add('tf-shell'); });

    // ── ① 漣漪 + 溶解 ──
    const o1 = center(anchor.getBoundingClientRect());
    // 每一列依「離你按的那一列多遠」決定何時溶解：波紋掃到才溶解
    const itemD1 = items.map(list => list.map(el => dist(el.getBoundingClientRect(), o1)));
    const maxD1 = Math.max(1, ...itemD1.flat());
    temps.push(ripple(o1.x, o1.y, Math.max(innerWidth, innerHeight), accent));
    let aEnd = 0;
    cards.forEach((c, ci) => {
      items[ci].forEach((el, ii) => {
        const d = itemD1[ci][ii] / maxD1 * SET.dissolveSpread;
        aEnd = Math.max(aEnd, d + SET.dissolve);
        anims.push(anim(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(7px)' }], { duration: SET.dissolve, delay: d, easing: OUT_EASE }));
      });
    });
    if (on) {
      [nav, glow].forEach(el => el && anims.push(anim(el, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(120%)', opacity: 0 }], { duration: 360, easing: OUT_EASE })));
      if (qm && visible(qm)) anims.push(anim(qm, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 260, easing: OUT_EASE }));
    } else if (rail) {
      const parts = railParts(rail);
      parts.forEach((el, i) => anims.push(anim(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-14px) scale(.97)' }], { duration: 220, delay: (parts.length - 1 - i) * 16, easing: OUT_EASE })));
      anims.push(anim(rail, [{ transform: 'none' }, { transform: 'translateX(-100%)' }], { duration: 440, delay: 140, easing: 'cubic-bezier(.5, 0, .75, .2)' }));
      aEnd = Math.max(aEnd, 560);
    }
    await wait(aEnd - 60);

    // ── ② 換版面 + 外殼位移 ──
    const before = shells.map(s => s.getBoundingClientRect());
    const anchorTop = anchor.getBoundingClientRect().top;
    applyFn(on);
    rail = document.querySelector('.tb-rail');
    if (rail) rail.style.animation = 'none';           // 側欄自己的滑入動畫交給這裡做，不然結尾會重播一次
    const parts = on ? railParts(rail) : [];
    parts.forEach(el => { el.style.opacity = '0'; });
    void document.body.offsetHeight;
    // 你按的那一列盡量停在螢幕同一個高度，畫面才不會跳
    const se = document.scrollingElement || root;
    const drift = anchor.getBoundingClientRect().top - anchorTop;
    if (Math.abs(drift) > 1) se.scrollTop += drift;
    const after = shells.map(s => s.getBoundingClientRect());
    const o2 = center(anchor.getBoundingClientRect());
    const maxD2 = Math.max(1, ...after.map(r => dist(r, o2)));
    shells.forEach((s, i) => {
      const b = before[i], a = after[i];
      const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
      const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      const sx = clamp(b.width / a.width, .2, 5), sy = clamp(b.height / a.height, .2, 5);
      s.style.transformOrigin = '50% 50%';
      anims.push(anim(s, [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: 'none' },
      ], { duration: SET.move, delay: dist(a, o2) / maxD2 * SET.moveSpread, easing: 'cubic-bezier(.25, 1, .3, 1)' }));
    });
    if (on && rail) anims.push(anim(rail, [{ transform: 'translateX(-100%)' }, { transform: 'none' }], { duration: SET.railIn, easing: 'cubic-bezier(.25, 1, .3, 1)' }));
    if (!on) {
      [nav, glow].forEach(el => el && anims.push(anim(el, [{ transform: 'translateY(120%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 220, easing: IN_EASE })));
      if (qm) anims.push(anim(qm, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 420, easing: IN_EASE }));
    }
    await wait(SET.buildStart);

    // ── ③ 建設：由近到遠，一張卡一張卡、一列一列長回來 ──
    // 建設順序：同樣以你按的那一列 (新位置) 為圓心往外長；同一張卡裡再由近到遠一列列
    const off = title ? 1 : 0;
    const order = cards.map((c, i) => i).sort((p, q) => dist(after[p + off], o2) - dist(after[q + off], o2));
    let cEnd = 0;
    order.forEach((ci, rank) => {
      const base = rank * SET.buildCard;
      const sh = sheen(cards[ci], base);
      temps.push(sh.el); anims.push(sh.a);
      const ds = items[ci].map(el => dist(el.getBoundingClientRect(), o2));
      const near = Math.min(...ds);
      items[ci].forEach((el, ii) => {
        const d = base + (ds[ii] - near) / 90 * SET.buildRow;   // 卡內每差 90px 多等一列的時間
        cEnd = Math.max(cEnd, d + SET.build);
        anims.push(anim(el, [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'none' }], { duration: SET.build, delay: d, easing: IN_EASE }));
      });
    });
    parts.forEach((el, i) => {
      const d = 180 + i * SET.railPart;
      cEnd = Math.max(cEnd, d + 440);
      el.style.opacity = '';
      anims.push(anim(el, [{ opacity: 0, transform: 'translateX(-16px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 440, delay: d, easing: IN_EASE }));
    });
    await wait(cEnd + 40);

    // 收尾：把暫時的東西全部拿掉 (動畫的最後一格就是自然狀態，取消不會跳)
    anims.forEach(a => { try { a?.cancel(); } catch (_) {} });
    temps.forEach(el => el.remove());
    shells.forEach(s => { s.style.transition = ''; s.style.transformOrigin = ''; s.classList.remove('tf-shell'); });
    cards.forEach(c => { if (c.style.position === 'relative') c.style.position = ''; });
    items.flat().forEach(el => { el.style.opacity = ''; });
    parts.forEach(el => { el.style.opacity = ''; });
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
      root.classList.remove('tb-tf', 'vt-active');
      if (root.classList.contains('tablet-mode') !== on) applyFn(on);   // 動畫炸了也要保證狀態切過去
    }
    running = false;
    return true;
  }

  window.tbTransform = { run, get running() { return running; } };
})();
