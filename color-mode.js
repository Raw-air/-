// 統一色系模式：設定 → 個人化設定 → 統一色系模式。
// 做法：把每一份樣式表的文字複製一份，裡面「有顏色的值」(紫/綠/橘/藍/青…) 全部換成使用者選的色相，
// 亮度與透明度保持原樣 (所以深淺層次還在)，灰階與紅色 (刪除/缺席/錯誤) 不動。
// 開啟時停用原本的 <link>、在它正後方插入改色版 <style>，順序一模一樣，不會有權重問題；關閉就拿掉還原。
// 行內 style 屬性 (含之後 JS 動態插入的) 由 MutationObserver 補上。結果快取在 localStorage，
// 下次開 App 由 <head> 的小腳本直接套用，不會先閃一次彩色。
(function () {
  const KEY_ON = 'unified_color', KEY_ACC = 'unified_color_accent', KEY_CACHE = 'uc_css_cache';
  const DEFAULT_ACC = '#0a84ff';
  const PRESETS = [
    ['藍', '#0a84ff'], ['靛', '#5e5ce6'], ['紫', '#bf5af2'], ['綠', '#30d158'],
    ['青', '#40c8e0'], ['橘', '#ff9f0a'], ['粉', '#ff6fae'], ['灰', '#8e8e93'],
  ];
  const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g;
  const URL_RE = /url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g;

  function hexToRgb(h) {
    h = h.slice(1);
    if (h.length <= 4) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslToRgb(h, s, l) {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return [f(0), f(8), f(4)];
  }
  function parseColor(str) {
    if (str[0] === '#') return hexToRgb(str);
    const p = str.replace(/rgba?\(|\)/g, '').split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    let a = p.length > 3 ? p[3] : 1;
    if (/%\s*\)$/.test(str)) a /= 100;
    return [p[0], p[1], p[2], a];
  }

  function makeMapper(accent) {
    const [ar, ag, ab] = hexToRgb(accent);
    const [ah, as] = rgbToHsl(ar, ag, ab);
    const memo = new Map();
    return function (str) {
      let out = memo.get(str);
      if (out !== undefined) return out;
      out = str;
      const [r, g, b, a] = parseColor(str);
      const [h, s, l] = rgbToHsl(r, g, b);
      const isGray = s < .15 || l > .96 || l < .06;
      const isRed = (h <= 14 || h >= 340) && s >= .4;   // 紅色留著當「危險/缺席/錯誤」
      if (!isGray && !isRed) {
        const ns = as < .1 ? as : Math.min(1, s * .35 + as * .65);
        const [nr, ng, nb] = hslToRgb(ah, ns, l);
        out = a >= 1 ? `rgb(${nr}, ${ng}, ${nb})` : `rgba(${nr}, ${ng}, ${nb}, ${+a.toFixed(3)})`;
      }
      memo.set(str, out);
      return out;
    };
  }
  function recolorText(text, map, inline) {
    // url(...) 裡的東西 (SVG data URI 等) 不動，先換成 @@UC數字@@ 佔位
    const urls = [];
    text = text.replace(URL_RE, m => { urls.push(m); return '@@UC' + (urls.length - 1) + '@@'; });
    // 樣式表只改屬性值 (冒號後到 ; 或 } 為止)，選擇器裡的 #add、#fab 這類 ID 不能被當成顏色
    text = inline ? text.replace(COLOR_RE, map)
      : text.replace(/:([^;{}]*)(?=[;}])/g, (_, v) => ':' + v.replace(COLOR_RE, map));
    return text.replace(/@@UC(\d+)@@/g, (_, i) => urls[+i]);
  }

  const root = document.documentElement;
  const original = new Map();   // link href → 原始 CSS 文字
  let on = false, accent = DEFAULT_ACC, mapper = null, observer = null;

  function sheetLinks() {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(l => {
      try { return new URL(l.href).origin === location.origin; } catch (_) { return false; }
    });
  }
  function readOriginal(link) {
    if (original.has(link.href)) return original.get(link.href);
    let text = null;
    try {
      const wasDisabled = link.disabled;
      link.disabled = false;
      const rules = link.sheet && link.sheet.cssRules;
      if (rules) text = Array.from(rules, r => r.cssText).join('\n');
      link.disabled = wasDisabled;
    } catch (_) {}
    if (text) original.set(link.href, text);
    return text;
  }

  function applySheets() {
    const cache = { accent, sheets: {} };
    for (const link of sheetLinks()) {
      const src = readOriginal(link);
      if (!src) continue;   // 還沒載入完：保持原樣
      const css = recolorText(src, mapper);
      cache.sheets[link.href] = css;
      let st = link.nextElementSibling;
      if (!(st && st.matches('style[data-uc-for]'))) {
        st = document.createElement('style');
        st.setAttribute('data-uc-for', link.href);
        link.after(st);
      }
      if (st.textContent !== css) st.textContent = css;
      link.disabled = true;
    }
    try { localStorage.setItem(KEY_CACHE, JSON.stringify(cache)); } catch (_) {}
  }
  function removeSheets() {
    document.querySelectorAll('style[data-uc-for]').forEach(s => s.remove());
    sheetLinks().forEach(l => { l.disabled = false; });
    try { localStorage.removeItem(KEY_CACHE); } catch (_) {}
  }

  function recolorInline(el) {
    if (el.closest('[data-uc-skip]')) return;
    const orig = el.getAttribute('data-uc-o') ?? el.getAttribute('style');
    if (!orig || !/#[0-9a-fA-F]{3}|rgba?\(/.test(orig)) return;
    const next = recolorText(orig, mapper, true);
    if (next === orig && !el.hasAttribute('data-uc-o')) return;
    el.setAttribute('data-uc-o', orig);
    if (el.getAttribute('style') !== next) el.setAttribute('style', next);
  }
  function walkInline(node) {
    if (node.nodeType !== 1) return;
    if (node.hasAttribute('style')) recolorInline(node);
    node.querySelectorAll('[style]').forEach(recolorInline);
  }
  function restoreInline() {
    document.querySelectorAll('[data-uc-o]').forEach(el => {
      el.setAttribute('style', el.getAttribute('data-uc-o'));
      el.removeAttribute('data-uc-o');
    });
  }
  function startObserver() {
    if (observer) return;
    // 只看新插入的節點，不看 style 屬性變動 (輪播每幀都在寫 style，監聽會拖慢)
    observer = new MutationObserver(list => {
      for (const m of list) m.addedNodes.forEach(walkInline);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function apply() {
    root.classList.toggle('unified-color', on);
    if (on) {
      mapper = makeMapper(accent);
      applySheets();
      restoreInline();
      walkInline(document.body);
      startObserver();
    } else {
      if (observer) { observer.disconnect(); observer = null; }
      removeSheets();
      restoreInline();
    }
    syncUI();
  }

  function syncUI() {
    const t = document.getElementById('setting-unified-color');
    if (t) t.checked = on;
    const box = document.getElementById('uc-swatches');
    if (!box) return;
    box.hidden = !on;
    box.querySelectorAll('button.uc-swatch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === accent)));
    const custom = box.querySelector('.uc-custom');
    const isPreset = PRESETS.some(p => p[1] === accent);
    if (custom) {
      custom.setAttribute('aria-pressed', String(!isPreset));
      custom.style.setProperty('--c', isPreset ? 'transparent' : accent);
      const inp = custom.querySelector('input');
      if (inp) inp.value = accent;
    }
  }

  function save() {
    if (typeof setPref === 'function') { setPref(KEY_ON, on); setPref(KEY_ACC, accent); }
    else try { localStorage.setItem(KEY_ON, String(on)); localStorage.setItem(KEY_ACC, accent); } catch (_) {}
  }
  function withTransition(fn) {
    if (!window.sfReduceMotion?.() && document.startViewTransition) document.startViewTransition(fn);
    else fn();
  }

  window.toggleUnifiedColor = el => {
    on = !!el.checked;
    save();
    withTransition(apply);
    window.showToast?.(on ? '已開啟統一色系模式' : '已關閉統一色系模式', 'success');
  };
  window.setUnifiedAccent = hex => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    accent = hex.toLowerCase();
    on = true;
    save();
    withTransition(apply);
  };

  function buildSwatches() {
    const box = document.getElementById('uc-swatches');
    if (!box || box.childElementCount) return;
    box.innerHTML = PRESETS.map(([n, c]) =>
      `<button type="button" class="uc-swatch" data-c="${c}" title="${n}" aria-label="主題色：${n}" style="--c:${c}"></button>`).join('')
      + `<label class="uc-swatch uc-custom" title="自訂顏色" aria-label="自訂主題色"><input type="color" value="${accent}"></label>`;
    box.addEventListener('click', e => {
      const b = e.target.closest('button.uc-swatch');
      if (b) { window.haptic?.('light'); window.setUnifiedAccent(b.dataset.c); }
    });
    box.querySelector('input').addEventListener('change', e => window.setUnifiedAccent(e.target.value));
  }

  function load() {
    try {
      on = localStorage.getItem(KEY_ON) === 'true';
      const a = localStorage.getItem(KEY_ACC);
      accent = /^#[0-9a-f]{6}$/i.test(a || '') ? a.toLowerCase() : DEFAULT_ACC;
    } catch (_) {}
  }
  function init() {
    load();
    buildSwatches();
    if (on) apply(); else { removeSheets(); syncUI(); }
    // 樣式表若比這支程式晚載完，補做一次
    addEventListener('load', () => { if (on) applySheets(); }, { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
