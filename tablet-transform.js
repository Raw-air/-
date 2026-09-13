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

  async function run(on, applyFn) {
    if (running) return false;
    running = true;
    window.haptic?.('light');
    try {
      let ok = false;
      if (document.startViewTransition) ok = await runVT(on, applyFn);
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
