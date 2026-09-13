// 平板模式變形動畫：開 / 關平板模式時，整個版面像變形金剛一樣
//   ① 拆解 — 現有零件浮起、底部導覽列 (或側欄) 折疊收起
//   ② 藍圖 — 換成新版面後，先用線框畫出每個零件的新位置，掃描光束橫掃畫面
//   ③ 組裝 — 光束掃到哪，零件就從舊位置翻轉飛到新位置卡進去 (FLIP + 3D)
//   ④ 鎖定 — 閃光、震動、音效，覆蓋層淡出
// 只在 tablet.js 的 setTabletMode(on, animate=true) 時被呼叫；省電模式 / 減少動態就直接跳結果。
(function () {
  const root = document.documentElement;
  const MAX_PIECES = 80;
  // 這些容器要拆成裡面一張張卡片，零件多才有「拆開再組回去」的感覺
  const SPLIT = '#squad-grid, #management-grid, .big-stats, .summary-row-2, .summary-row-3, .squad-detail-grid, .summary-actions, .student-list, .calendar-grid, #page-tools > div, #page-management > div';
  const EXTRAS = ['#back-btn', '.fab-empty-bed', '.rc-confirm-container', '#qm-toggle'];
  const EASE = 'cubic-bezier(.22, 1, .32, 1)';
  const PHASE_A = 320;      // 拆解
  const SWEEP = 720;        // 光束橫掃時間
  const FLY = 720;          // 單一零件飛行時間
  const PHASE_B = 1500;     // 組裝總長
  const FADE = 520;         // 覆蓋層淡出

  let overlay = null, running = false, audio = null;
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

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'tb-tf-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="tb-tf-dim"></div><div class="tb-tf-grid"></div>'
      + '<svg class="tb-tf-bp" xmlns="http://www.w3.org/2000/svg"></svg>'
      + '<div class="tb-tf-beam"></div><div class="tb-tf-flash"></div>'
      + '<div class="tb-tf-hud"><i></i><i></i><i></i><i></i></div>'
      + '<div class="tb-tf-title">TRANSFORM SEQUENCE<b></b></div>'
      + '<div class="tb-tf-steps"><span>拆解版面</span><span>掃描藍圖</span><span>組裝零件</span><span>鎖定完成</span></div>'
      + '<div class="tb-tf-pct">0<small>%</small></div>';
    document.body.appendChild(overlay);
  }

  // ── 音效 (自己合成，跟 haptic 一樣尊重「靜音」設定) ──
  function ac() {
    try { if (localStorage.getItem('mute_sound') === 'true') return null; } catch (_) {}
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      return audio;
    } catch (_) { return null; }
  }
  function sweepTone(c, at, f0, f1, dur, vol, type) {
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = type || 'sawtooth';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, at); lp.frequency.exponentialRampToValueAtTime(2600, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(lp); lp.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + dur + 0.05);
  }
  function clank(c, at, vol, pitch) {
    const n = Math.floor(c.sampleRate * 0.07), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = pitch || 1400; bp.Q.value = 2.2;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    s.connect(bp); bp.connect(g); g.connect(c.destination); s.start(at);
    const o = c.createOscillator(), g2 = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(160, at); o.frequency.exponentialRampToValueAtTime(70, at + 0.12);
    g2.gain.setValueAtTime(vol * 1.4, at); g2.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    o.connect(g2); g2.connect(c.destination); o.start(at); o.stop(at + 0.16);
  }
  function playScore(on) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    sweepTone(c, t, on ? 90 : 260, on ? 260 : 90, 0.42, 0.05);                  // 拆解：動力啟動
    sweepTone(c, t + PHASE_A / 1000, on ? 180 : 520, on ? 520 : 180, SWEEP / 1000, 0.035, 'triangle'); // 光束
    for (let i = 0; i < 5; i++) clank(c, t + (PHASE_A + 120 + i * 190) / 1000, 0.05, 1100 + i * 180);   // 零件卡入
    clank(c, t + (PHASE_A + PHASE_B - 60) / 1000, 0.12, 700);                  // 鎖定
  }

  const anim = (el, frames, opt) => { try { return el.animate(frames, Object.assign({ fill: 'both', easing: EASE }, opt)); } catch (_) { return null; } };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const railParts = (rail) => {
    if (!rail) return [];
    const out = [];
    for (const c of rail.children) {
      if (c.matches('.tb-nav, .tb-tools')) out.push(...c.children); else out.push(c);
    }
    return out;
  };

  async function run(on, applyFn) {
    if (running) return false;
    running = true;
    if (!overlay) buildOverlay();
    const anims = [];
    const svg = overlay.querySelector('.tb-tf-bp');
    const beam = overlay.querySelector('.tb-tf-beam');
    const flash = overlay.querySelector('.tb-tf-flash');
    const pct = overlay.querySelector('.tb-tf-pct');
    const steps = overlay.querySelectorAll('.tb-tf-steps span');
    const title = overlay.querySelector('.tb-tf-title b');
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    steps.forEach(s => s.className = '');
    overlay.hidden = false;
    void overlay.offsetWidth;   // 先讓它顯示出來，再加 .on 才有淡入
    overlay.classList.remove('off');
    overlay.classList.add('on');
    root.classList.add('tb-tf');
    const T0 = performance.now();
    const TOTAL = PHASE_A + PHASE_B;
    const lit = (i) => { steps.forEach((s, n) => { s.classList.toggle('lit', n === i); s.classList.toggle('done', n < i); }); };

    // 進度百分比 + 標題打字
    const label = on ? '平板模式 · 啟動' : '平板模式 · 解除';
    title.textContent = '';
    (function tickPct() {
      const k = clamp((performance.now() - T0) / TOTAL, 0, 1);
      pct.firstChild.nodeValue = String(Math.round((1 - Math.pow(1 - k, 2.2)) * 100));
      title.textContent = label.slice(0, Math.ceil(k * 3 * label.length));
      if (k < 1 && running) requestAnimationFrame(tickPct);
    })();

    playScore(on);
    window.haptic?.('medium');
    lit(0);

    // ── ① 拆解：現在的零件浮起、變半透明；要收掉的那條導覽列折疊 ──
    const { page, pieces } = collectPieces();
    const before = pieces.map(el => el.getBoundingClientRect());
    if (page) page.classList.add('tb-tf-stage');
    pieces.forEach((el, i) => {
      el.classList.add('tb-tf-piece');
      el.style.transformOrigin = '50% 50%';
      anims.push(anim(el, [
        { transform: 'translateZ(0)', opacity: 1 },
        { transform: `translateZ(70px) rotateX(${(i % 3 - 1) * 4}deg) scale(.985)`, opacity: .5 },
      ], { duration: 260, delay: Math.min(i * 10, 120) }));
    });
    const rail = document.querySelector('.tb-rail');
    const nav = document.querySelector('.bottom-nav');
    const glow = document.querySelector('.bottom-nav-glow');
    if (on) {
      [nav, glow].forEach(el => el && anims.push(anim(el, [
        { transform: 'none', opacity: 1 },
        { transform: 'translateY(60%) rotateX(72deg)', opacity: 0 },
      ], { duration: 300, easing: 'cubic-bezier(.5, 0, .9, .4)' })));
      if (nav) nav.style.transformOrigin = '50% 100%';
    } else if (rail) {
      const parts = railParts(rail);
      parts.forEach((el, i) => {
        el.style.transformOrigin = '0 50%';
        anims.push(anim(el, [
          { transform: 'none', opacity: 1 },
          { transform: 'rotateY(-88deg) translateX(-30px)', opacity: 0 },
        ], { duration: 220, delay: (parts.length - 1 - i) * 14, easing: 'cubic-bezier(.5, 0, .9, .4)' }));
      });
      anims.push(anim(rail, [{ transform: 'none' }, { transform: 'translateX(-100%)' }], { duration: 260, delay: 90, easing: 'cubic-bezier(.5, 0, .9, .4)' }));
    }
    await wait(PHASE_A);

    // ── ② 換版面 + 藍圖 ──
    applyFn(on);
    lit(1);
    void document.body.offsetHeight;
    const after = pieces.map(el => visible(el) ? el.getBoundingClientRect() : null);
    const W = innerWidth, H = innerHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const delayFor = (r) => 40 + (on ? (r.left + r.width / 2) / W : 1 - (r.left + r.width / 2) / W) * SWEEP;

    // 光束
    beam.style.opacity = '1';
    anims.push(anim(beam, [
      { transform: on ? 'translateX(-100%)' : `translateX(${W}px)`, opacity: 0 },
      { opacity: 1, offset: .08 },
      { opacity: 1, offset: .92 },
      { transform: on ? `translateX(${W}px)` : 'translateX(-100%)', opacity: 0 },
    ], { duration: SWEEP + 160, delay: 20, easing: 'linear' }));

    // 藍圖線框 + 從舊位置連到新位置的虛線
    const NS = 'http://www.w3.org/2000/svg';
    pieces.forEach((el, i) => {
      const a = after[i]; if (!a) return;
      const b = before[i];
      const d = delayFor(a);
      const r = document.createElementNS(NS, 'rect');
      const rx = Math.min(16, a.width / 4, a.height / 4);
      r.setAttribute('x', a.left); r.setAttribute('y', a.top); r.setAttribute('width', a.width); r.setAttribute('height', a.height); r.setAttribute('rx', rx);
      const per = 2 * (a.width + a.height);
      r.style.strokeDasharray = per; r.style.strokeDashoffset = per;
      svg.appendChild(r);
      anims.push(anim(r, [
        { strokeDashoffset: per, opacity: 1 },
        { strokeDashoffset: 0, opacity: 1, offset: .45 },
        { strokeDashoffset: 0, opacity: 1, offset: .75 },
        { strokeDashoffset: 0, opacity: 0 },
      ], { duration: 720, delay: Math.max(0, d - 200), easing: 'ease-out' }));
      const bx = b.left + b.width / 2, by = b.top + b.height / 2, ax = a.left + a.width / 2, ay = a.top + a.height / 2;
      if (Math.hypot(ax - bx, ay - by) > 40) {
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', bx); l.setAttribute('y1', by); l.setAttribute('x2', ax); l.setAttribute('y2', ay);
        svg.appendChild(l);
        anims.push(anim(l, [{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .6 }, { opacity: 0 }], { duration: 520, delay: Math.max(0, d - 120), easing: 'linear' }));
      }
    });

    // ── ③ 組裝：零件從舊位置翻轉飛到新位置 ──
    pieces.forEach((el, i) => {
      const a = after[i];
      const b = before[i];
      if (!a) { anims.push(anim(el, [{ opacity: .5 }, { opacity: 0 }], { duration: 120 })); return; }
      const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
      const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      const sx = clamp(b.width / a.width, .2, 5), sy = clamp(b.height / a.height, .2, 5);
      const ry = clamp(-dx / 9, -55, 55) + (i % 2 ? 14 : -14);
      const rx = clamp(dy / 9, -45, 45) + (i % 3 - 1) * 6;
      const d = delayFor(a);
      anims.push(anim(el, [
        { transform: `translate3d(${dx}px, ${dy}px, 70px) scale(${sx}, ${sy})`, opacity: .5 },
        { transform: `translate3d(${dx * .4}px, ${dy * .4}px, -160px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${(sx + 1) / 2}, ${(sy + 1) / 2})`, opacity: .85, offset: .5 },
        { transform: 'translate3d(0, 0, 0) rotateY(0) rotateX(0) scale(1)', opacity: 1 },
      ], { duration: FLY, delay: d, easing: 'cubic-bezier(.2, .9, .25, 1.06)' }));
    });

    // 新出現的那一側：側欄一片片從左邊翻開；底部導覽列從下面升起
    if (on) {
      const railNow = document.querySelector('.tb-rail');
      if (railNow) {
        railNow.style.transformOrigin = '0 50%';
        anims.push(anim(railNow, [
          { transform: 'translateX(-100%)' },
          { transform: 'translateX(0)' },
        ], { duration: 420, delay: 0 }));
        railParts(railNow).forEach((el, i) => {
          el.style.transformOrigin = '0 50%';
          anims.push(anim(el, [
            { transform: 'rotateY(-90deg) translateX(-40px)', opacity: 0 },
            { transform: 'rotateY(12deg)', opacity: 1, offset: .7 },
            { transform: 'none', opacity: 1 },
          ], { duration: 520, delay: 120 + i * 42 }));
        });
      }
    } else {
      [nav, glow].forEach(el => {
        if (!el) return;
        el.style.transformOrigin = '50% 100%';
        anims.push(anim(el, [
          { transform: 'translateY(60%) rotateX(72deg)', opacity: 0 },
          { transform: 'translateY(-4%) rotateX(-6deg)', opacity: 1, offset: .7 },
          { transform: 'none', opacity: 1 },
        ], { duration: 520, delay: 260 }));
      });
      const qm = document.querySelector('#qm-toggle');
      if (qm && !pieces.includes(qm)) anims.push(anim(qm, [{ transform: 'scale(0) rotate(-90deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 500 }));
    }

    await wait(300); lit(2);
    await wait(PHASE_B - 300 - 80);
    // ── ④ 鎖定 ──
    lit(3);
    window.haptic?.('heavy');
    anims.push(anim(flash, [{ opacity: 0 }, { opacity: .9, offset: .25 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' }));
    await wait(80);
    overlay.classList.add('off');
    overlay.classList.remove('on');
    await wait(FADE);

    // 清乾淨：拿掉所有暫時的 transform / class，之後版面完全由 CSS 接手
    anims.forEach(a => { try { a?.cancel(); } catch (_) {} });
    pieces.forEach(el => { el.classList.remove('tb-tf-piece'); el.style.transformOrigin = ''; });
    [nav, glow, rail, document.querySelector('.tb-rail'), document.querySelector('#qm-toggle')].forEach(el => { if (el) el.style.transformOrigin = ''; });
    railParts(document.querySelector('.tb-rail')).forEach(el => { el.style.transformOrigin = ''; });
    page?.classList.remove('tb-tf-stage');
    beam.style.opacity = '';
    svg.innerHTML = '';
    root.classList.remove('tb-tf');
    overlay.hidden = true;      // 分頁在背景時 transition 不會跑，直接藏掉最保險
    running = false;
    return true;
  }

  window.tbTransform = { run, get running() { return running; } };
})();
