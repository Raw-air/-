/**
 * 碧苑宿舍點名系統 - 主應用邏輯 v2.2
 * 新增: 硬性房間規則 / 斜線動畫 / 導覽列自訂圖示
 */

// ─── 設定持久化層 (localStorage 為主, cookie + IndexedDB 為備援) ──────────────
// iOS ITP 7 天上限、「離開時清除網站資料」或部分內嵌瀏覽器會清掉 localStorage，
// 導致使用者的個人化設定（音效/震動/主題/潘仔/省電）每次重開都被重置。
// 這裡不改變 localStorage 是主要來源這件事（測試會直接操作 localStorage 的 key），
// 只是每次寫入時同步備份一份到 cookie 與 IndexedDB，開機時若 localStorage 缺值
// 才從備援還原回去。
const PREFS_KEYS = ['mute_sound', 'mute_haptic', 'white_mode', 'panzi_mode', 'power_save_mode', 'squad_custom'];
const PREFS_COOKIE_NAME = 'biyuan_prefs';
const PREFS_IDB_NAME = 'biyuan';
const PREFS_IDB_STORE = 'prefs';

// cookie 的 path 依目前頁面所在目錄計算（例如 /biyuan/index.html → /biyuan/），
// 避免整個網域都能讀到，也避免子路徑部署時吃不到 root path 的 cookie。
function _prefsCookiePath() {
  try {
    const p = location.pathname.replace(/[^/]*$/, '');
    return p || '/';
  } catch (_) { return '/'; }
}

function _prefsReadCookie() {
  try {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + PREFS_COOKIE_NAME + '=([^;]*)'));
    if (!m) return null;
    return JSON.parse(decodeURIComponent(m[1]));
  } catch (_) { return null; }
}

function _prefsWriteCookie(obj) {
  try {
    const val = encodeURIComponent(JSON.stringify(obj));
    document.cookie = PREFS_COOKIE_NAME + '=' + val + '; max-age=31536000; path=' + _prefsCookiePath() + '; SameSite=Lax';
  } catch (_) { /* 私密瀏覽模式等環境可能擋 cookie 寫入，忽略即可 */ }
}

function _prefsSnapshotFromLocalStorage() {
  const out = {};
  PREFS_KEYS.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    } catch (_) {}
  });
  return out;
}

function _prefsOpenIDB() {
  return new Promise((resolve) => {
    try {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open(PREFS_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(PREFS_IDB_STORE); } catch (_) {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}

function _prefsIDBGetAll() {
  return _prefsOpenIDB().then(db => new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(PREFS_IDB_STORE, 'readonly');
      const store = tx.objectStore(PREFS_IDB_STORE);
      const out = {};
      let pending = PREFS_KEYS.length;
      PREFS_KEYS.forEach(k => {
        try {
          const r = store.get(k);
          r.onsuccess = () => { if (r.result !== undefined) out[k] = r.result; if (--pending === 0) resolve(out); };
          r.onerror = () => { if (--pending === 0) resolve(out); };
        } catch (_) { if (--pending === 0) resolve(out); }
      });
    } catch (_) { resolve(null); }
  })).catch(() => null);
}

function _prefsIDBSetAll(obj) {
  _prefsOpenIDB().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(PREFS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(PREFS_IDB_STORE);
      Object.keys(obj).forEach(k => { try { store.put(obj[k], k); } catch (_) {} });
    } catch (_) {}
  }).catch(() => {});
}

// 五個個人化設定的唯一寫入入口：localStorage 照舊立即寫入，同時非同步備份到 cookie/IndexedDB。
function setPref(key, value) {
  const v = String(value);
  try { localStorage.setItem(key, v); } catch (_) {}
  if (PREFS_KEYS.includes(key)) {
    const snap = _prefsSnapshotFromLocalStorage();
    snap[key] = v;
    _prefsWriteCookie(snap);
    _prefsIDBSetAll(snap);
  }
  return v;
}

// 省電模式 = 等同系統設定裡的「減少動態」。
// 各個動畫模組 (theme.js / carousel.js / dissolve.js / navigation.js) 都改問這個函式，
// 所以打開省電模式就會自動走它們原本就有的「不做動畫、直接跳到結果」那條路。
window.sfReduceMotion = function sfReduceMotion() {
  try {
    if (document.body && document.body.classList.contains('power-save-mode')) return true;
    if (localStorage.getItem('power_save_mode') === 'true') return true;   // body 還沒就緒時的備援
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) { return false; }
};

// 開機還原：cookie 是同步的，所以在這裡（檔案最頂端，早於下方 DOMContentLoaded 的初始化邏輯執行）
// 就先把 localStorage 缺的 key 補回去，避免畫面先閃一次錯誤主題再跳回來。
(function _prefsRestoreFromCookie() {
  try {
    const cookiePrefs = _prefsReadCookie();
    if (!cookiePrefs) return;
    PREFS_KEYS.forEach(k => {
      if (localStorage.getItem(k) === null && Object.prototype.hasOwnProperty.call(cookiePrefs, k)) {
        try { localStorage.setItem(k, cookiePrefs[k]); } catch (_) {}
      }
    });
  } catch (_) {}
})();

// IndexedDB 還原是非同步的，可能在 DOMContentLoaded 之後才回來；若真的補回了任何值，
// 呼叫 applyStoredPrefs() 重新套用一次（此函式定義於下方 DOMContentLoaded 區塊之前，
// function 宣告會被提升到整個檔案作用域頂端，所以這裡可以先參照它）。
(function _prefsRestoreFromIDB() {
  _prefsIDBGetAll().then(idbPrefs => {
    if (!idbPrefs) return;
    let changed = false;
    PREFS_KEYS.forEach(k => {
      if (localStorage.getItem(k) === null && Object.prototype.hasOwnProperty.call(idbPrefs, k)) {
        try { localStorage.setItem(k, idbPrefs[k]); changed = true; } catch (_) {}
      }
    });
    if (changed && typeof applyStoredPrefs === 'function') applyStoredPrefs();
  }).catch(() => {});
})();

// 盡量請瀏覽器把儲存空間標記為「持久化」，降低被系統自動清掉的機率；忽略結果與錯誤。
try { navigator.storage?.persist?.().catch?.(() => {}); } catch (_) {}

// ─── 全域狀態 ───────────────────────────────────────────────────────────────
const state = {
  students: [],
  dateColumns: [],
  config: {},
  currentSquad: null,
  currentDate: null,
  changes: [],
  loading: true,
  calMonth: new Date(),
  confirmedSquads: [],
  recentSyncs: {}, // 用於保護剛同步成功的狀態，避免 eventual consistency 導致閃爍
  // 後端點名表沒有該日期欄位時，本機暫存的點名 { [iso日期]: { [pageId]: 狀態 } }
  pendingByDate: {},
  // 學期狀態 (來自 /api/semester)：current = 本學期、archives = 封存學期、available = 後端有支援
  semester: { current: { name: '', dbId: '', start: '', end: '' }, archives: [], dateColumns: [], available: false },
  // 正在查看的封存學期名稱；null = 本學期 (正常模式)
  viewSemester: null,
  // 這次 roster 來自哪個學期 (後端回傳)，用來推算舊式 "X月Y日" 欄位的年份
  rosterSemester: null,
};

// ─── 觸覺回饋 (iOS Taptic 開關 + 進階波形引擎 Web Audio API) ─────────────────
let audioCtx = null;

function initAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// iPhone / iPad (含桌面模式的 iPadOS) 沒有 Vibration API，要走另外兩條路
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function hasVibrate() { return typeof navigator.vibrate === 'function' && !IS_IOS; }
function hapticMuted() { return localStorage.getItem('mute_haptic') === 'true'; }

// iOS 17.4 ~ 26.4：用程式點擊 <input type="checkbox" switch> 的 label，Safari 會真的敲一下 Taptic Engine
let _hapticSwitchLabel = null;
function iosSwitchHaptic(count = 1, gap = 70) {
  if (!IS_IOS) return false;
  try {
    if (!_hapticSwitchLabel) {
      const label = document.createElement('label');
      label.id = 'haptic-switch-label';
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      _hapticSwitchLabel = label;
    }
    for (let i = 0; i < count; i++) setTimeout(() => _hapticSwitchLabel.click(), i * gap);
  } catch (_) {}
  return true;
}

/**
 * 播放自訂觸覺波形 (支援 ADSR 包絡線)
 * Android 走原生震動；iPhone 用低頻喇叭波形讓機身共振，這就是使用者感受到的「震動」
 * @param {Array} curve - 強度起伏陣列 (0.0 ~ 1.0)
 * @param {number} durationMs - 總時長 (毫秒)
 * @param {string} waveType - 波形類型 ('sine', 'square', 'sawtooth')
 * @param {number} frequency - 震動基頻 (Hz)
 */
function playHapticCurve(curve, durationMs, waveType = 'sine', frequency = 120) {
  if (hapticMuted()) return;
  if (hasVibrate()) { try { navigator.vibrate(durationMs); } catch (_) {} return; }
  if (!IS_IOS) return; // 桌面 Safari/Firefox 沒震動也不該聽到嗡嗡聲
  try {
    initAudioCtx();
    const t = audioCtx.currentTime;
    const duration = durationMs / 1000;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = waveType;
    osc.frequency.setValueAtTime(frequency, t);
    gain.gain.setValueAtTime(0.0001, t);
    if (curve && curve.length > 0) {
      const step = duration / curve.length;
      for (let i = 0; i < curve.length; i++) {
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, curve[i]), t + (i + 1) * step);
      }
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch (e) {
    console.warn('Haptic curve error:', e);
  }
}

const HAPTIC_PATTERNS = { light: 8, medium: 20, heavy: [15, 20, 25], error: [30, 40, 30, 40, 50] };
const HAPTIC_CURVES = {
  light:  { curve: [0.03, 0.01, 0.001], ms: 30, wave: 'sine', hz: 150, taps: 1 },
  medium: { curve: [0.08, 0.04, 0.001], ms: 45, wave: 'sine', hz: 100, taps: 1 },
  heavy:  { curve: [0.2, 0.05, 0.001], ms: 60, wave: 'square', hz: 80, taps: 2 },
  error:  { curve: [0.2, 0.01, 0.2, 0.01, 0.3], ms: 250, wave: 'sawtooth', hz: 60, taps: 3 },
};

function haptic(type = 'light') {
  if (hapticMuted()) return;
  if (hasVibrate()) { try { navigator.vibrate(HAPTIC_PATTERNS[type] || 8); } catch (_) {} return; }
  if (!IS_IOS) return;
  const h = HAPTIC_CURVES[type] || HAPTIC_CURVES.light;
  iosSwitchHaptic(h.taps);
  playHapticCurve(h.curve, h.ms, h.wave, h.hz);
}

// 主題切換：與 480ms 圓形擴散同步的「漸漸放大」漣漪震動
function _themeHaptic() {
  if (hapticMuted()) return;
  if (hasVibrate()) { try { navigator.vibrate([8, 60, 20, 60, 40, 60, 80]); } catch (_) {} return; }
  if (!IS_IOS) return;
  iosSwitchHaptic(3, 140);
  playHapticCurve([0.02, 0.01, 0.05, 0.02, 0.15, 0.25, 0.001], 400, 'sine', 120);
}

// ─── 自訂確認對話框 (替代原生 confirm) ─────────────────────────────────────
function showConfirmDialog({ title, message, confirmText = '確定', cancelText = '取消', danger = false, icon = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-card">
        <div class="confirm-icon">${icon}</div>
        <div class="confirm-title">${title}</div>
        <div class="confirm-msg">${message}</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel-btn" id="cfd-cancel">${cancelText}</button>
          <button class="confirm-btn ${danger ? 'danger-btn' : 'primary-btn'}" id="cfd-confirm">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const cleanup = (result) => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
      resolve(result);
    };

    overlay.querySelector('#cfd-cancel').onclick = () => { playClickSound('back'); cleanup(false); };
    overlay.querySelector('#cfd-confirm').onclick = () => { playClickSound('confirm'); haptic('medium'); cleanup(true); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
  });
}

// ─── 撒花慶祝效果 ──────────────────────────────────────────────────────
function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  const colors = ['#8b5cf6', '#6366f1', '#d946ef', '#f59e0b', '#22c55e', '#0ea5e9', '#ef4444', '#f472b6'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.setProperty('--fall-dur', (2.2 + Math.random() * 2).toFixed(1) + 's');
    piece.style.setProperty('--fall-delay', (Math.random() * 0.8).toFixed(2) + 's');
    piece.style.setProperty('--conf-rot', (360 + Math.random() * 720).toFixed(0) + 'deg');
    piece.style.setProperty('--conf-sway', (10 + Math.random() * 30).toFixed(0) + 'px');
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    container.appendChild(piece);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 5000);
}

// ─── 初始化 ─────────────────────────────────────────────────────────────────
window.addEventListener('error', (e) => {
  showLoading(false);
  showToast('系統錯誤: ' + e.message, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  showLoading(false);
  showToast('未預期的錯誤: ' + (e.reason ? e.reason.message : 'Unknown'), 'error');
});
// ─── 全域座標追蹤 (用於動畫精確定位) ──────────────────────────────────────────
let lastTapX = window.innerWidth / 2;
let lastTapY = window.innerHeight / 2;
window.addEventListener('pointerdown', (e) => {
  if (e.clientX && e.clientY) {
    lastTapX = e.clientX;
    lastTapY = e.clientY;
  }
}, { passive: true });
// ─── 觸覺震動反饋 (按鍵音效附帶) ───────────────────────────────────────
function triggerHapticFeedback(type = 'default') {
  if (hapticMuted()) return;
  const patterns = { confirm: 30, back: [15, 30, 15], unlock: [20, 40, 30], pin: 10, dev_unlock: [30, 50, 20, 50, 40], dev_error: [40, 50, 40, 50, 60], heavy: 40, light: 10, roll_in: 5, default: 15 };
  if (hasVibrate()) { try { navigator.vibrate(patterns[type] ?? patterns.default); } catch (_) {} return; }
  // iPhone：按鍵只敲 Taptic (無聲)，不播放低頻波形，避免每次點按都嗡一聲
  const taps = { dev_unlock: 2, dev_error: 3, heavy: 2 };
  iosSwitchHaptic(taps[type] || 1);
}

// ─── UI 清脆音效 (Web Audio API) ───────────────────────────────────────────
function playClickSound(type = 'default') {
  triggerHapticFeedback(type);
  if (localStorage.getItem('mute_sound') === 'true') return;
  try {
    // dev_unlock 用 MP3，提前 0.2s 播放（瀏覽器限制，最快就是 0s delay）
    if (type === 'dev_unlock') {
      const audio = new Audio('./Lp/6aa77c5e3bd7d98779628b82589dcb77.mp3');
      audio.volume = 0.8;
      audio.play().catch(() => { });
      return;
    }

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const time = audioCtx.currentTime;

    // ── 打密碼音效：白噪音高頻短爆 + 低頻點擊疊加 ──
    if (type === 'pin') {
      const bufferSize = audioCtx.sampleRate * 0.04;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.035, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2200;
      filter.Q.value = 1.5;
      source.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(audioCtx.destination);
      source.start(time);
      // 低頻點擊疊加「咔」質感
      const clickOsc = audioCtx.createOscillator();
      const clickGain = audioCtx.createGain();
      clickOsc.type = 'square';
      clickOsc.frequency.setValueAtTime(180, time);
      clickGain.gain.setValueAtTime(0.06, time);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.025);
      clickOsc.connect(clickGain);
      clickGain.connect(audioCtx.destination);
      clickOsc.start(time); clickOsc.stop(time + 0.03);
      return;
    }

    // ── 點名專用音效 ──
    if (type === 'roll_in') {
      // 到齊：清脆高頻上揚 <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="19" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.setValueAtTime(1200, time);
      o.frequency.exponentialRampToValueAtTime(1600, time + 0.04);
      g.gain.setValueAtTime(0.1, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
      o.start(time); o.stop(time + 0.07);
      return;
    }
    if (type === 'roll_leave') {
      // 請假/課外：溫和中頻下滑 <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'triangle';
      o.frequency.setValueAtTime(880, time);
      o.frequency.exponentialRampToValueAtTime(600, time + 0.08);
      g.gain.setValueAtTime(0.1, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      o.start(time); o.stop(time + 0.11);
      return;
    }
    if (type === 'roll_absent') {
      // 缺席：低沉鍛擊雙擊 <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>
      [0, 0.07].forEach(delay => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, time + delay);
        o.frequency.exponentialRampToValueAtTime(160, time + delay + 0.06);
        g.gain.setValueAtTime(0.08, time + delay);
        g.gain.exponentialRampToValueAtTime(0.001, time + delay + 0.07);
        o.start(time + delay); o.stop(time + delay + 0.08);
      });
      return;
    }
    if (type === 'all_present') {
      // 全員到齊慶祝三連音 Do-Mi-Sol (C5-E5-G5)
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type = 'triangle';
        const t = time + i * 0.1;
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.start(t); o.stop(t + 0.14);
      });
      return;
    }

    // ── 一般音效（使用共用 osc + gain）──
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'back') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, time);
      osc.frequency.exponentialRampToValueAtTime(200, time + 0.06);
      gainNode.gain.setValueAtTime(0.12, time);
      gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.06);
      osc.start(time); osc.stop(time + 0.07);
    } else if (type === 'unlock') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(600, time);
      osc.frequency.setValueAtTime(1000, time + 0.02);
      gainNode.gain.setValueAtTime(0.08, time);
      gainNode.gain.setTargetAtTime(0.001, time, 0.005);
      osc.start(time); osc.stop(time + 0.05);
    } else if (type === 'confirm') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, time);
      osc.frequency.exponentialRampToValueAtTime(1200, time + 0.08);
      gainNode.gain.setValueAtTime(0.08, time);
      gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.08);
      osc.start(time); osc.stop(time + 0.1);
    } else if (type === 'dev_error') {
      // 開發者密碼錯誤：低沉鋸齒下沉音
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, time);
      osc.frequency.exponentialRampToValueAtTime(140, time + 0.12);
      gainNode.gain.setValueAtTime(0.1, time);
      gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
      osc.start(time); osc.stop(time + 0.15);
    } else {
      // 預設清脆滴聲
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, time);
      osc.frequency.exponentialRampToValueAtTime(300, time + 0.04);
      gainNode.gain.setValueAtTime(0.12, time);
      gainNode.gain.exponentialRampToValueAtTime(0.01, time + 0.04);
      osc.start(time); osc.stop(time + 0.05);
    }
  } catch (e) { }
}

window.addEventListener('click', (e) => {
  const target = e.target.closest('button, .duty-manual-widget, #duty-roster-widget, .nav-item, .sq-card, .rc-date-clickable, .date-item, .student-row, .dev-trigger, .changelog-btn, .action-btn, .modal-overlay, .setting-row label');
  if (target) {
    if (target.id === 'back-btn' || target.classList.contains('cancel') || target.id === 'pin-cancel') {
      playClickSound('back');
    } else if (target.id === 'pin-confirm') {
      playClickSound('unlock'); // 解鎖中隊專屬的喀啦聲
    } else if (target.id === 'dev-pin-confirm') {
      // 開發者確認按鈕：音效由 tryUnlock 邏輯控制，這裡不重複播放
    } else if (target.classList.contains('confirm') || target.id === 'submit-btn' || target.id === 'rc-confirm-btn') {
      playClickSound('confirm');
    } else if (target.closest('.sq-card')) {
      playClickSound('default');
    } else {
      if (!target.classList.contains('modal-overlay') || e.target === target) {
        if (e.target.closest('.modal-card')) return;
        if (target.classList.contains('modal-overlay')) playClickSound('back');
        else playClickSound('default');
      }
    }
  }
}, true);

// 針對 PIN 碼輸入框打字時發出 pin 音效
document.addEventListener('input', (e) => {
  if (e.target && (e.target.id === 'pin-input' || e.target.id === 'dev-pin-input')) {
    playClickSound('pin');
  }
});

// ─── 初始化 ─────────────────────────────────────────────────────────────────

// 依 localStorage 目前的值套用五個個人化設定（body class + 對應 checkbox 狀態）。
// DOMContentLoaded 時呼叫一次；若 IndexedDB 備援還原之後補回了新的值，也會再呼叫一次。
function applyStoredPrefs() {
  // 全白模式
  const isLight = localStorage.getItem('white_mode') === 'true';
  document.body.classList.toggle('light-mode', isLight);
  const whiteToggle = document.getElementById('setting-white-mode');
  if (whiteToggle) whiteToggle.checked = isLight;
  if (isLight && typeof updateAllImagesToTheme === 'function') updateAllImagesToTheme();

  // 靜音模式
  const muteToggle = document.getElementById('setting-mute');
  if (muteToggle) muteToggle.checked = localStorage.getItem('mute_sound') === 'true';

  // 震動反饋
  const hapticToggle = document.getElementById('setting-haptic');
  if (hapticToggle) hapticToggle.checked = localStorage.getItem('mute_haptic') !== 'true';
  const hapticHelp = document.getElementById('haptic-help');
  if (hapticHelp && !hasVibrate()) {
    hapticHelp.textContent = IS_IOS ? 'iPhone 會用 Safari 觸覺開關與低頻波形模擬震動' : '此瀏覽器不支援網頁震動；音效可另外設定';
  }

  // 潘仔模式
  const isPanzi = localStorage.getItem('panzi_mode') === 'true';
  document.body.classList.toggle('panzi-mode', isPanzi);
  const panziToggle = document.getElementById('setting-panzi');
  if (panziToggle) panziToggle.checked = isPanzi;

  // 省電模式
  const isPS = localStorage.getItem('power_save_mode') === 'true';
  document.body.classList.toggle('power-save-mode', isPS);
  const psToggle = document.getElementById('setting-powerSave');
  if (psToggle) psToggle.checked = isPS;
  if (isPS) window._psStopHackingLog = true;

  // 顯示自訂客製化（預設關閉：沒有值就是 false）
  const custToggle = document.getElementById('setting-squad-custom');
  if (custToggle) custToggle.checked = squadCustomOn();
  updateCustomMenuEntry();
}

// 雲端設定是任何人都能寫的，照片一律確認真的是圖片 data URL 才塞進畫面
function isSafeImageDataUrl(v) {
  return typeof v === 'string' && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(v);
}

// 中隊卡片自訂客製化是否開啟。預設關閉，怕中隊長上傳的照片把首頁版面弄亂。
function squadCustomOn() {
  try { return localStorage.getItem('squad_custom') === 'true'; } catch (_) { return false; }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    applyStoredPrefs();
    loadPendingAttendance();
    semesterInputsTouched();
    // 查看封存學期時，所有寫入總表的動作一律擋下 (點名、電話請假、匯入精靈、檔案管理)
    if (window._api && typeof window._api.updateAttendance === 'function') {
      const rawUpdate = window._api.updateAttendance.bind(window._api);
      window._api.updateAttendance = (updates, options) => {
        if (state.viewSemester) return Promise.reject(new Error(`正在查看封存學期 ${state.viewSemester}，不能修改`));
        return rawUpdate(updates, options).then(result => {
          rememberRecentSyncs(updates);
          return result;
        });
      };
    }

    state.currentDate = getTodayAttendanceDate();
    setupNav();
    setupPinDialog();
    applyNavIcons();
    navigateTo('home');
    await loadData();

    // <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> 即時同步系統 — KV 信號層輪詢
    // 取代舊的 15 秒 Notion 輪詢，改為 3 秒 KV 輪詢（回應 < 10ms）
    let _pollTimer = null;
    let _lastPollTs = 0;      // 上次收到的 confirm 時間戳
    let _lastAttTs = 0;       // 上次收到的出席變動時間戳
    let _pollPaused = false;
    let _pollBusy = false;

    function getPollInterval() {
      if (currentPage === 'summary') return 3000;   // 總表頁：3 秒
      if (currentPage === 'rollcall') return 5000;   // 點名頁：5 秒
      return 10000;                                    // 其他頁：10 秒
    }

    async function doPoll() {
      if (_pollPaused || _pollBusy) return;
      _pollBusy = true;
      try {
        const data = await window._api.poll();
        if (!data) return;

        // 1. 檢查確認回報狀態是否有更新
        // 新後端會帶 date：別天的回報不要套到今天
        if (data.ts > _lastPollTs && (!data.date || data.date === getTodayAttendanceDate())) {
          _lastPollTs = data.ts;
          const newConfirms = data.confirms ? data.confirms.split(',').filter(Boolean) : [];
          if (newConfirms.join(',') !== state.confirmedSquads.join(',')) {
            state.confirmedSquads = newConfirms;
            const today = getTodayAttendanceDate();
            state.config['confirm_' + today] = data.confirms || '';
            // 僅重新渲染，不需要 loadData
            if (currentPage === 'summary') renderSummary();
            if (currentPage === 'rollcall') updateRollCallStats(true); // 輪詢更新也視為佈局變動，跳過動畫
          }
        }

        // 2. 檢查出席資料是否有更新（其他中隊提交了點名）
        if (data.att_ts > _lastAttTs && _lastAttTs > 0) {
          _lastAttTs = data.att_ts;
          scheduleBackgroundRefresh();
        } else if (_lastAttTs === 0) {
          _lastAttTs = data.att_ts || 0; // 首次初始化
        }
      } catch (e) { /* 輪詢失敗靜默跳過 */ } finally { _pollBusy = false; }
    }

    // 背景刷新：以前每個裝置一偵測到變動就立刻抓整張總表 + 設定表，
    // 20 台同時開總表 = 同一秒打 Notion 上百次 → Notion 回「太忙」，別人的點名請假就寫不進去。
    // 現在：隨機錯開 1.5~4 秒 (讓後端快取先建好)、同一台最快 8 秒刷一次、設定表 60 秒才重抓一次。
    let _bgRefreshTimer = null;
    let _bgRefreshBusy = false;
    let _bgRefreshAgain = false;
    let _lastBgRefreshAt = 0;
    let _lastBgConfigAt = Date.now();
    let _lastRenderSig = '';

    function rosterSignature() {
      const parts = [state.confirmedSquads.join(','), (state.dateColumns || []).length];
      for (const s of state.students) {
        parts.push(s.id, s.name, s.isEmpty ? 1 : 0, s.squad, s.room, s.bed, JSON.stringify(s.attendance || {}));
      }
      return parts.join('|');
    }

    function scheduleBackgroundRefresh() {
      if (_bgRefreshBusy) { _bgRefreshAgain = true; return; }
      if (_bgRefreshTimer) return;
      const minGap = 8000 - (Date.now() - _lastBgRefreshAt);
      const delay = Math.max(minGap, 1500 + Math.random() * 2500);
      _bgRefreshTimer = setTimeout(runBackgroundRefresh, delay);
    }

    async function runBackgroundRefresh() {
      _bgRefreshTimer = null;
      _bgRefreshBusy = true;
      _lastBgRefreshAt = Date.now();
      try {
        const wantConfig = Date.now() - _lastBgConfigAt > 60000;
        const [roster, config] = await Promise.all([
          window._api.getRoster(state.viewSemester || ''),
          wantConfig ? window._api.getConfig() : Promise.resolve(null),
        ]);
        state.rosterSemester = roster.semester || null;
        state.students = applyLocalStateToRoster(roster.students || [], roster.dateColumns || []);
        state.dateColumns = roster.dateColumns || [];
        state.currentDate = resolveAttendanceDate(state.currentDate || localTodayISO());
        if (config) {
          _lastBgConfigAt = Date.now();
          // 點名完成狀態以即時信號為準，不拿 (可能較舊的) 設定表覆蓋，否則「已回報」會一閃一閃
          const today = getTodayAttendanceDate();
          const keepConfirm = state.config['confirm_' + today];
          const keepSnapshot = state.config['snapshot_' + today];
          state.config = config || {};
          if (keepConfirm !== undefined) state.config['confirm_' + today] = keepConfirm;
          if (keepSnapshot !== undefined) state.config['snapshot_' + today] = keepSnapshot;
        }
        applyRoomRules();
        // 資料跟上次畫的一模一樣就不重畫，避免整塊畫面閃一下
        const sig = rosterSignature();
        if (sig !== _lastRenderSig) {
          _lastRenderSig = sig;
          renderCurrentPage(true);
        }
      } catch (e) {
        console.warn('[Poll] 背景刷新失敗', e);
      } finally {
        _bgRefreshBusy = false;
        if (_bgRefreshAgain) { _bgRefreshAgain = false; scheduleBackgroundRefresh(); }
      }
    }

    function startPoll() {
      if (_pollTimer) clearInterval(_pollTimer);
      _pollTimer = setInterval(doPoll, getPollInterval());
    }

    // 頁面可見性監聽：最小化/切到背景時暫停輪詢，回來時立即觸發
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        _pollPaused = true;
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
      } else {
        _pollPaused = false;
        doPoll(); // 回到前景時立即觸發一次
        startPoll();
      }
    });

    // 頁面切換時重新調整輪詢頻率
    const _origNavigateTo = window.navigateTo;
    if (typeof _origNavigateTo === 'function') {
      window.navigateTo = function (page) {
        _origNavigateTo(page);
        startPoll(); // 因為 currentPage 改變了，間隔也要跟著調整
      };
    }

    startPoll();
    doPoll(); // 啟動後立即執行一次

  } catch (err) {
    showLoading(false);
    showToast('初始化嚴重錯誤：' + err.message, 'error');
  }
});

// 個人化設定 Toggle
function toggleMute(el) {
  setPref('mute_sound', el.checked);
}

function toggleHaptic(el) {
  setPref('mute_haptic', !el.checked);
  if (el.checked) {
    haptic('medium');
    if (!hasVibrate() && !IS_IOS) showToast('此瀏覽器不支援網頁震動', 'info');
  } else { try { navigator.vibrate?.(0); } catch (_) {} }
}

function togglePanzi(el) {
  const isPanzi = el.checked;
  setPref('panzi_mode', isPanzi);
  if (isPanzi) document.body.classList.add('panzi-mode');
  else document.body.classList.remove('panzi-mode');
}

function toggleSquadCustom(el) {
  setPref('squad_custom', el.checked);
  updateCustomMenuEntry();
  loadGlobalBgVideo();
  if (currentPage === 'home') renderHome();
}

// 設定頁的「客製化選單」入口只在開關打開時出現
function updateCustomMenuEntry() {
  const entry = document.getElementById('custom-menu-entry');
  if (entry) entry.style.display = squadCustomOn() ? 'flex' : 'none';
}

function togglePowerSave(el) {
  const isPS = el.checked;
  setPref('power_save_mode', isPS);
  document.body.classList.toggle('power-save-mode', isPS);
  applyPowerSaveRuntime(isPS);
}

// 切換省電模式時，那些「已經在跑」的 JS 動畫也要當場處理，
// 不然要重開 App 才會生效。
function applyPowerSaveRuntime(isPS) {
  try {
    if (isPS) {
      // 3D 資料夾輪播：立刻停在目前位置，關掉自動展開
      if (typeof window._sfStopMotion === 'function') window._sfStopMotion();
      // 載入畫面的假終端機日誌 (每 20~60ms 重寫一次) 直接停掉
      window._psStopHackingLog = true;
    } else {
      // 關掉省電模式：把剛剛沒建立的刪除特效補建起來
      if (window.sfDissolve && typeof window.sfDissolve.init === 'function') window.sfDissolve.init();
      window._psStopHackingLog = false;
    }
  } catch (_) {}
}

function performAppearanceChange(isLight) {
  if (isLight) document.body.classList.add('light-mode');
  else document.body.classList.remove('light-mode');
  if (typeof updateAllImagesToTheme === 'function') updateAllImagesToTheme();
}

// ─── 主題切換：一律「從按鈕位置往外擴散」(深色/淺色都一樣) ───────────────────
// 舊版深色模式是把舊畫面往按鈕「縮進去」，看起來像從四周包過來，不是從按鈕展開。
// 現在兩個方向都用「新畫面從按鈕位置畫圓擴散」，並補上舊 iPhone (沒有 View Transition) 的替代動畫。
// Theme transitions are defined in theme.js.

function getIconSrc(baseName) {
  // Keep one decoded SVG per icon; CSS recolours it without a first-toggle network load.
  return './Lp/ICON/' + baseName + '.svg';
}

function updateAllImagesToTheme() {
  try {
    const images = document.querySelectorAll('img[src*="Lp/ICON"]');
    images.forEach(img => {
      let src = img.getAttribute('src');
      if (!src) return;

      let baseName = '';
      if (src.includes('BLACK')) {
        baseName = src.split('/').pop().replace('_BLACK.svg', '').replace('.svg', '');
        if (baseName === 'SETTINGS_') baseName = 'SETTIN';
      } else {
        baseName = src.split('/').pop().replace('.svg', '');
      }
      if (baseName) {
        img.setAttribute('src', getIconSrc(baseName));
      }
    });
    // 如果 applyNavIcons 存在則重新算一次
    if (typeof applyNavIcons === 'function') {
      applyNavIcons();
    }
  } catch (err) {
    console.error("Theme switch error:", err);
  }
}

async function loadData() {
  try {
    showLoading(true);
    const [roster, config, changelogs, remarks] = await Promise.all([
      window._api.getRoster(state.viewSemester || ''),
      window._api.getConfig(),
      window._api.getChangelog().catch(() => []),
      window._api.getRemarks().catch(() => ({})),
      loadSemesterState(),
    ]);
    state.rosterSemester = roster.semester || null;

    // Merge remarks natively into the student list
    if (roster.students && remarks) {
      roster.students.forEach(s => {
        s.remarks = remarks[s.id] || '';
      });
    }

    state.students = applyLocalStateToRoster(roster.students || [], roster.dateColumns || []);
    state.dateColumns = roster.dateColumns || [];
    state.currentDate = resolveAttendanceDate(state.currentDate || localTodayISO());
    state.config = config || {};
    state.changelogs = changelogs || [];

    // 嘗試從設定載入 AI 辨識的值星表
    if (state.config.duty_roster) {
      try {
        window.CONFIG.DUTY_ROSTER = JSON.parse(state.config.duty_roster);
      } catch (e) {
        console.error('Failed to parse dynamic duty roster', e);
      }
    }

    // 套用硬性房間規則
    applyRoomRules();

    // 套用全域背景影片設定
    loadGlobalBgVideo();

    const today = getTodayAttendanceDate();
    const confVal = state.config['confirm_' + today] || state.config['confirm_' + getTodayColumnName()];
    if (confVal) state.confirmedSquads = confVal.split(',').filter(Boolean);
    else state.confirmedSquads = [];

    showLoading(false);
    renderCurrentPage(true);
    checkChangelogDot();
    showToast(`已載入 ${state.students.length} 位學生`, 'success');
  } catch (err) {
    showLoading(false);
    showToast('載入失敗：' + err.message, 'error');
  }
}

// 檢查首頁紅點
function checkChangelogDot() {
  const dot = document.querySelector('.changelog-dot');
  if (!dot) return;
  if (state.changelogs && state.changelogs.length > 0) {
    const latestId = state.changelogs[0].id;
    const lastSeen = localStorage.getItem('last_seen_changelog');
    if (lastSeen !== latestId) {
      dot.style.display = 'block';
    } else {
      dot.style.display = 'none';
    }
  } else {
    dot.style.display = 'none';
  }
}

const DUTY_TASKS = {
  regular: {
    main: [
      { time: "06:00", text: "關宿舍電燈" },
      { time: "07:50", text: "把碧院冷氣關掉 (按鈕從右下關到左上，另外三個撥扭要轉成關)" },
      { time: "08:00", text: "櫃台桌子要整理 / 綠色本子交給學務處 / 包裹牌子朝門口放" },
      { time: "08:05", text: "轉電話 (黃色轉 ** 77 2535644 #，白色轉 *301 322)" },
      { time: "12:00", text: "收包裹牌子 / 管理室門打開 / 開宿舍冷氣 / 櫃檯掛機" },
      { time: "13:00", text: "關宿舍冷氣 / 放包裹牌子" },
      { time: "16:00", text: "去中正大樓拿包裹看信件 / 若教官值班則去拿綠本" },
      { time: "16:50", text: "開宿舍冷氣 / 把碧院各樓層燈打開" },
      { time: "17:00", text: "收包裹牌子 / 檢查監視器 / 解除電話 (*300, #77#) / 櫃台掛機" },
      { time: "23:00", text: "每個樓層找一個去拿點名表下來跟檢查" },
      { time: "23:30", text: "回收點名表 / 上保全 / 回報人數給值班宿舍" },
      { time: "23:55", text: "風扇冷氣關閉 / 管理室上鎖 / 牌子掛值星寢室 / 轉電話 (*77)" }
    ],
    sub: [
      { time: "12:00", text: "(若主值在忙) 開冷氣 / 收包裹牌子 / 在櫃檯掛機" },
      { time: "13:00", text: "(若主值在忙) 關宿舍冷氣 / 放包裹牌子" },
      { time: "20:00", text: "在宿舍櫃台掛機 (注意教官、學生、請假專線)" },
      { time: "23:00", text: "關掉櫃台附近的電燈" },
      { time: "23:30", text: "倒櫃台底下的垃圾 / 上保全 (星形鑰匙、藍色門紐)" }
    ]
  },
  friday: {
    main: [
      { time: "06:00", text: "關宿舍電燈" },
      { time: "07:50", text: "把碧院冷氣關掉 (按鈕從右下關到左上，另外三個撥扭要轉成關)" },
      { time: "08:00", text: "櫃台桌子要整理 / 綠本交給學務處 / 包裹牌子朝門口放" },
      { time: "08:05", text: "轉電話 (黃色: ** 77 2535644 #, 白色: *301 322)" },
      { time: "12:00", text: "收包裹牌子" },
      { time: "12:50", text: "廣播並全棟斷電 (只留1F跟3F走廊燈，其他冷氣電燈全關)" },
      { time: "13:00", text: "管理室上鎖 / 白板寫上『如果回來打給值星』與電話" },
      { time: "13:05", text: "管理室門口放紅龍 / 將黃綠紅三把鑰匙交給教官室" }
    ],
    sub: [
      { time: "12:50", text: "協助主值廣播並確認各樓層人員清空" },
      { time: "13:00", text: "協助檢查各寢室是否斷電與門窗關閉" }
    ]
  }
};

function updateDutyManualPreview() {
  const previewEl = document.getElementById('current-task-preview');
  if (!previewEl) return;

  const now = new Date();
  const currentStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
  const isFriday = now.getDay() === 5;
  const tasksGroup = isFriday ? DUTY_TASKS.friday : DUTY_TASKS.regular;

  // 尋找主值與副值即將或正在進行的任務
  let activeTask = "目前無待辦事項，請保持機動";

  // 簡單邏輯：找出大於等於現在時間，或過去一小時內的最近任務
  let closestTask = null;
  let maxPastTime = -1;
  const nowTime = now.getHours() * 60 + now.getMinutes();

  const checkTasks = (tasks) => {
    tasks.forEach(t => {
      const [h, m] = t.time.split(':').map(Number);
      const taskTime = h * 60 + m;

      // 任務已經開始（taskTime <= nowTime），且是最接近現在時間的
      if (taskTime <= nowTime && taskTime > maxPastTime) {
        maxPastTime = taskTime;
        closestTask = t;
      }
    });
  };

  checkTasks(tasksGroup.main);
  checkTasks(tasksGroup.sub);

  if (closestTask) {
    activeTask = `<span style="color:var(--orange); font-weight:800; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">${closestTask.time}</span> - <span style="opacity:0.9;">${closestTask.text}</span>`;
  }

  previewEl.innerHTML = activeTask;
}

// ── 值星幹部 ──
function openDutyRosterModal() {
  const container = document.getElementById('duty-roster-content');
  if (!container) return;

  if (!window.CONFIG || !window.CONFIG.DUTY_ROSTER) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--dim);">
        <div style="font-size:40px; margin-bottom:12px; opacity:0.3;"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg></div>
        <p>目前尚無值星輪值資料</p>
        <p style="font-size:12px; margin-top:8px;">請使用上方「AI 辨識更新」上傳圖片</p>
      </div>`;
  } else {
    const currentDuty = window.getCurrentDutyOfficers ? window.getCurrentDutyOfficers() : null;

    let html = '<div style="display:flex; flex-direction:column; gap:12px; padding:4px 8px 20px 8px;">';

    window.CONFIG.DUTY_ROSTER.forEach(row => {
      const isCurrent = currentDuty && currentDuty.week === row.week;

      const cardStyle = isCurrent
        ? 'background:linear-gradient(145deg, rgba(255,159,10,0.15) 0%, rgba(255,159,10,0.05) 100%); border:1px solid rgba(255,159,10,0.3); transform:scale(1.02); box-shadow:0 8px 24px rgba(0,0,0,0.2);'
        : 'background:var(--glass-bg); border:1px solid var(--glass-border);';

      const badge = isCurrent
        ? '<span style="font-size:10px; background:var(--orange); color:#000; padding:2px 8px; border-radius:10px; font-weight:900; margin-left:8px; text-transform:uppercase; letter-spacing:0.5px;">Current</span>'
        : '';

      html += `
      <div style="padding:16px 20px; border-radius:16px; ${cardStyle} transition:all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:900; font-size:16px; color:${isCurrent ? 'var(--orange)' : 'var(--text)'}; font-family:-apple-system, system-ui; letter-spacing:-0.3px;">
            第 ${row.week} 週 ${badge}
          </div>
          <div style="font-size:12px; color:var(--dim); font-weight:600; font-variant-numeric: tabular-nums;">
            ${row.start} ~ ${row.end}
          </div>
        </div>
        
        <div style="display:flex; gap:12px; margin-top:2px; align-items:stretch;">
          <div style="flex:1; background:var(--glass-bg); padding:10px 12px; border-radius:12px; border:1px solid var(--glass-border); display:flex; flex-direction:column; justify-content:center;">
            <div style="font-size:10px; color:var(--orange); font-weight:800; margin-bottom:2px; opacity:0.8;">主值星官</div>
            <div style="font-size:15px; font-weight:700; color:var(--text);">${row.dutyOfficer}</div>
          </div>
          <div style="flex:1; background:var(--glass-bg); padding:10px 12px; border-radius:12px; border:1px solid var(--glass-border); display:flex; flex-direction:column; justify-content:center;">
            <div style="font-size:10px; color:var(--purple); font-weight:800; margin-bottom:2px; opacity:0.8;">副值星官</div>
            <div style="font-size:15px; font-weight:700; color:var(--text);">${row.deputy}</div>
          </div>
        </div>
      </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
  }
  document.getElementById('duty-roster-modal').classList.add('visible');
}

function openDutyManualModal() {
  const container = document.getElementById('duty-manual-content');
  if (!container) return;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isFriday = now.getDay() === 5;
  const tasksGroup = isFriday ? DUTY_TASKS.friday : DUTY_TASKS.regular;

  const scheduleTypeTitle = isFriday ? '禮拜五中午交接' : '平日勤務';

  const renderTasks = (tasks, title, color) => {
    let html = `
    <div style="margin-top:24px; margin-bottom:16px;">
      <h2 style="margin:0; font-size:clamp(1.5rem, 5vw + 1rem, 2rem); font-weight:800; color:${color}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; letter-spacing:-0.5px; display:flex; align-items:center; gap:12px;">
         <span style="font-size:1.2em;">${title === '主職' ? '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'}</span> ${title}
      </h2>
    </div>`;

    html += '<div style="display:flex; flex-direction:column; gap:12px;">';

    let activeIndex = -1;
    let maxPast = -1;
    tasks.forEach((t, i) => {
      const [h, m] = t.time.split(':').map(Number);
      const taskTime = h * 60 + m;
      if (taskTime <= currentMinutes && taskTime > maxPast) {
        maxPast = taskTime;
        activeIndex = i;
      }
    });

    tasks.forEach((t, i) => {
      const isCurrent = (i === activeIndex);

      const bgColor = color === '#f59e0b' ? '245,158,11' : '59,130,246';

      const boxStyle = isCurrent
        ? `background:linear-gradient(145deg, rgba(${bgColor}, 0.15) 0%, rgba(${bgColor}, 0.05) 100%); border:1px solid rgba(${bgColor}, 0.3); transform:scale(1.02); box-shadow:0 8px 24px rgba(0,0,0,0.2);`
        : 'background:var(--glass-bg); border:1px solid var(--glass-border);';

      const timeColor = isCurrent ? color : 'var(--dim)';
      const textColor = isCurrent ? 'var(--text)' : 'var(--text)';

      html += `
      <div style="padding:16px 20px; border-radius:16px; ${boxStyle} transition:all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); display:flex; flex-direction:column; gap:8px;">
        <div style="font-weight:900; font-size:clamp(1.2rem, 3vw + 0.5rem, 1.5rem); color:${timeColor}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; letter-spacing:-0.5px; line-height:1;">
          ${t.time}
        </div>
        <div style="color:${textColor}; font-size:15px; font-weight:500; line-height:1.6; letter-spacing:0.3px;">
          ${t.text}
        </div>
      </div>`;
    });

    html += '</div>';
    return html;
  };

  container.innerHTML = `
    <div style="padding:0 4px 20px 4px;">
      <div style="text-align:center; margin-bottom:32px;">
        <div style="font-size:clamp(2rem, 6vw + 1rem, 3rem); font-weight:900; color:var(--text); letter-spacing:-1px; margin-bottom:8px; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          ${scheduleTypeTitle}
        </div>
        <div style="display:inline-flex; align-items:center; gap:8px; padding:6px 16px; background:var(--glass-bg); border-radius:20px; border:1px solid var(--glass-border);">
          <div style="width:8px; height:8px; border-radius:50%; background:var(--green); box-shadow:0 0 10px var(--green); animation:pulse 2s infinite;"></div>
          <span style="color:var(--dim); font-size:14px; font-weight:600; letter-spacing:0.5px; font-variant-numeric: tabular-nums;">
            當前時間 ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}
          </span>
        </div>
      </div>
      
      ${renderTasks(tasksGroup.main, '主職', '#f59e0b')}
      <div style="height:24px;"></div>
      ${renderTasks(tasksGroup.sub, '副職', '#3b82f6')}
    </div>
    <style>
      @keyframes pulse {
        0% { transform:scale(0.95); box-shadow:0 0 0 0 rgba(74, 222, 128, 0.7); }
        70% { transform:scale(1); box-shadow:0 0 0 6px rgba(74, 222, 128, 0); }
        100% { transform:scale(0.95); box-shadow:0 0 0 0 rgba(74, 222, 128, 0); }
      }
    </style>
  `;

  document.getElementById('duty-manual-modal').classList.add('visible');
}

// ── 最新公告與日誌 (Changelog) ──
function openChangelogModal() {
  // 從獨立資料庫取得的新版公告（附帶時間戳）
  const rawLogs = state.changelogs || [];
  // debug 用：首次開啟時印出結構
  if (rawLogs.length > 0) console.log('[Changelog] entry keys:', Object.keys(rawLogs[0]));
  const newEntries = rawLogs.map(log => {
    // 尋找全物件字串中是否有 ISO 8601 時間格式 (Notion 產生的標題或時間常見格式)
    let timeStr = null;
    const isoRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/;

    for (const key of Object.keys(log)) {
      if (typeof log[key] === 'string') {
        const match = log[key].match(isoRegex);
        if (match) {
          timeStr = match[1];
          break;
        }
      }
    }

    let time = timeStr || log.created_time || log.createdTime || log.created_at ||
      log.last_edited_time || log.lastEditedTime || log.updated_at ||
      log.timestamp || log.date || null;

    // 超級備援：查內文有無 YYYY/MM/DD
    if (!time && log.content) {
      const backupMatch = log.content.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
      if (backupMatch) time = backupMatch[1];
    }

    return {
      content: log.content,
      time: time
    };
  });

  // 兼容設定資料庫中的舊版公告（無時間戳）
  const legacyEntries = Object.keys(state.config)
    .filter(k => k.startsWith('changelog_entry_'))
    .sort()
    .reverse()
    .map(k => ({ content: state.config[k], time: null }));

  if (state.config['changelog_md']) {
    legacyEntries.push({ content: state.config['changelog_md'], time: null });
  }

  // 合併並渲染每條公告（各自解析確保時間戳位置正確）
  const allEntries = [...newEntries, ...legacyEntries];

  function formatTime(isoStr) {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      if (isNaN(d)) return null;
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} 更新`;
    } catch { return null; }
  }

  const tsStyle = 'font-size:11px;color:rgba(165,180,252,0.55);margin:-2px 0 8px 2px;font-weight:400;letter-spacing:0.5px;display:block;';

  let combinedHTML = '';
  if (typeof marked !== 'undefined') {
    for (const entry of allEntries) {
      // 逐篇解析 markdown
      let html = marked.parse(entry.content || '');
      // 在第一個 h2/h3 標籤之後插入時間戳
      const timeLabel = formatTime(entry.time);
      if (timeLabel) {
        html = html.replace(
          /(<\/h[23]>)/,
          `$1<span class="changelog-time" style="font-size:11px;margin:-2px 0 8px 2px;font-weight:400;letter-spacing:0.5px;display:block;"><svg class="ui-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${timeLabel}</span>`
        );
      }
      combinedHTML += html;
    }
  } else {
    combinedHTML = `<pre style="white-space:pre-wrap;font-family:inherit;">${allEntries.map(e => e.content).join('\n\n')}</pre>`;
  }

  if (!combinedHTML.trim()) combinedHTML = '<p>目前沒有最新公告。</p>';

  const contentEl = document.getElementById('changelog-content');
  contentEl.innerHTML = combinedHTML;

  if (typeof marked !== 'undefined') {
    // 建立折疊邏輯：將 h3 (每個版本) 轉換為可以平滑展開/收疊的 accordion
    const headings = contentEl.querySelectorAll('h3');
    headings.forEach((h3, i) => {
      const wrapper = document.createElement('div');

      wrapper.style.paddingLeft = '12px';
      wrapper.style.borderLeft = '2px solid rgba(255,255,255,0.1)';
      wrapper.style.marginLeft = '4px';
      wrapper.style.marginTop = '8px';
      wrapper.style.marginBottom = '20px';
      wrapper.style.overflow = 'hidden'; // 為動畫準備

      let nextNode = h3.nextElementSibling;
      while (nextNode && nextNode.tagName !== 'H3' && nextNode.tagName !== 'H2' && nextNode.tagName !== 'H1') {
        const toMove = nextNode;
        nextNode = nextNode.nextElementSibling;
        wrapper.appendChild(toMove);
      }

      h3.parentNode.insertBefore(wrapper, h3.nextSibling);

      h3.style.cursor = 'pointer';
      h3.style.display = 'flex';
      h3.style.justifyContent = 'space-between';
      h3.style.alignItems = 'center';
      h3.style.background = 'rgba(255,255,255,0.05)';
      h3.style.padding = '10px 14px';
      h3.style.borderRadius = '8px';
      h3.style.marginTop = '0';
      h3.style.marginBottom = '0';
      h3.style.userSelect = 'none';

      // 添加箭頭
      const chevron = document.createElement('span');
      chevron.innerHTML = '▼';
      chevron.style.fontSize = '12px';
      chevron.style.color = 'var(--dim)';
      chevron.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
      h3.appendChild(chevron);

      // 動態高度開關標記
      let isOpen = false;

      // 預設展開第一個
      if (i === 0) {
        isOpen = true;
        chevron.style.transform = 'rotate(-180deg)';
        // 初始狀態保持原樣，不設 height 以因應響應式
      } else {
        wrapper.style.height = '0px';
        wrapper.style.opacity = '0';
        wrapper.style.margin = '0'; // 隱藏時收掉 margin
        wrapper.style.padding = '0 0 0 12px'; // 保留左側邊框但不留上下空間
      }

      h3.onclick = () => {
        if (!isOpen) {
          // 展開動畫
          isOpen = true;
          chevron.style.transform = 'rotate(-180deg)';

          wrapper.style.margin = '8px 0 20px 4px';
          wrapper.style.padding = '0 0 0 12px';

          // 取得目標高度
          const targetHeight = wrapper.scrollHeight + 'px';

          // 啟動過渡
          wrapper.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
          wrapper.style.height = targetHeight;
          wrapper.style.opacity = '1';

          setTimeout(() => {
            if (isOpen) {
              wrapper.style.height = ''; // 解除死綁定以因應重新排版
            }
          }, 300);
        } else {
          // 收拢動畫
          isOpen = false;
          chevron.style.transform = 'rotate(0deg)';

          // 將目前自動的高度鎖住
          wrapper.style.height = wrapper.scrollHeight + 'px';
          wrapper.offsetHeight; // force reflow

          wrapper.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
          wrapper.style.height = '0px';
          wrapper.style.opacity = '0';
          wrapper.style.margin = '0';
          wrapper.style.padding = '0 0 0 12px';
        }
      };
    });
  }

  // 記錄已讀最新公告
  if (state.changelogs && state.changelogs.length > 0) {
    localStorage.setItem('last_seen_changelog', state.changelogs[0].id);
    const dot = document.querySelector('.changelog-dot');
    if (dot) dot.style.display = 'none';
  }

  document.getElementById('changelog-modal').classList.add('visible');
}

function closeChangelogModal() {
  document.getElementById('changelog-modal').classList.remove('visible');
}

window.openChangelogModal = openChangelogModal;
window.closeChangelogModal = closeChangelogModal;
window.saveChangelog = saveChangelog;

async function saveChangelog() {
  const content = document.getElementById('dev-changelog-input').value.trim();
  if (!content) return showToast('請輸入新增的日誌內容', 'error');

  showLoading(true);
  try {
    await window._api.postChangelog(content);
    // 重新載入公告資料來更新畫面
    const logs = await window._api.getChangelog().catch(() => []);
    state.changelogs = logs;
    checkChangelogDot();

    document.getElementById('dev-changelog-input').value = '';
    showToast('發布成功！已新增至公告資料庫', 'success');
  } catch (e) {
    showToast('發布失敗：請檢查設定 ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
}

// 供 dev 區載入時清除舊資料避免誤會
function initDevChangelog() {
  const el = document.getElementById('dev-changelog-input');
  if (el) el.value = '';
}

// ─── 導航 ───────────────────────────────────────────────────────────────────
let currentPage = 'home';
let isInitialHomeRender = true;
let activeSummaryDetail = 'empty';
let summaryScrollPosition = 0;

// Liquid-glass navigation is defined in navigation.js.

// 子頁面該讓底部導覽列的哪一顆維持highlight（依照該頁「返回」會回到哪裡）
const NAV_TAB_OF = {
  rollcall: 'home', management: 'home', review: 'home',
  'repair-review': 'home', 'feedback-form': 'home',
  'summary-detail': 'summary', tools: 'summary', 'leave-records': 'summary',
  'student-files': 'summary', 'resident-management': 'summary', 'repair-form': 'summary',
  'leave-lookup': 'summary',
  'feedback-review': 'settings', 'database-setup': 'settings', customize: 'settings',
};
const NAV_TABS = ['home', 'summary', 'history', 'settings'];
function navTabFor(page) {
  return NAV_TABS.includes(page) ? page : (NAV_TAB_OF[page] || 'home');
}

function navigateTo(page) {
  if (page === currentPage) { renderCurrentPage(true); return; }

  const fromPage = currentPage;
  currentPage = page;
  window.dispatchEvent(new Event('app:navigate'));
  if (page !== 'student-files') window._sfStopMotion?.();

  // 判斷導航方向
  const navOrder = ['home', 'rollcall', 'summary', 'history', 'settings'];
  const fromIdx = navOrder.indexOf(fromPage);
  const toIdx = navOrder.indexOf(page);
  const isForward = toIdx > fromIdx;  // 沒找到的頁面(-1)一律視為前進

  // 立刻更新導覽列 & 按鈕狀態
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navPage = navTabFor(page);
  const navItem = document.querySelector(`.nav-item[data-page="${navPage}"]`);
  if (navItem) navItem.classList.add('active');
  const backBtn = document.getElementById('back-btn');
  backBtn.style.display = (page === 'rollcall') ? 'flex' : 'none';
  const fab = document.querySelector('.fab-empty-bed');
  if (fab) fab.style.display = (page === 'rollcall') ? 'flex' : 'none';

  const fromEl = document.getElementById(`page-${fromPage}`);
  const toEl = document.getElementById(`page-${page}`);

  // 全域背景滑動效果
  const isHome = (page === 'home');
  const customBg = document.getElementById('custom-video-bg');
  const animBg = document.querySelector('.home-anim-bg');
  if (customBg) customBg.classList.toggle('hidden-bg', !isHome);
  if (animBg) animBg.classList.toggle('hidden-bg', !isHome);

  // 選擇方向性動畫
  const enterAnim = fromIdx < 0 || toIdx < 0 ? 'fadeUp' : (isForward ? 'slideInRight' : 'slideInLeft');
  const exitAnim = fromIdx < 0 || toIdx < 0 ? 'pageExit' : (isForward ? 'pageExitLeft' : 'pageExitRight');

  function showNewPage() {
    document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.animation = ''; });
    if (toEl) {
      toEl.classList.add('active');
      toEl.style.animation = `${enterAnim} 0.28s cubic-bezier(0.16, 1, 0.3, 1)`;
    }
    renderCurrentPage(true);
    if (page === 'summary-detail') {
      requestAnimationFrame(() => document.getElementById('summary-detail-title')?.focus({ preventScroll: true }));
    }
  }

  if (fromEl && fromEl.classList.contains('active')) {
    fromEl.style.animation = `${exitAnim} 0.18s ease forwards`;
    setTimeout(showNewPage, 170);
  } else {
    showNewPage();
  }
}

function renderCurrentPage(skipAnimation = false) {
  switch (currentPage) {
    case 'home': renderHome(); break;
    case 'rollcall': renderRollCall(skipAnimation); break;
    case 'summary': renderSummary(); break;
    case 'summary-detail': renderSummaryDetail(); break;
    case 'history': renderHistory(); break;
    case 'settings': renderSettings(); break;
    case 'resident-management': initResidentManagement(false); break;
    case 'leave-lookup': renderLeaveLookup(); break;
    case 'customize': renderCustomizePage(); break;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 首頁
// ═════════════════════════════════════════════════════════════════════════════
function renderHome() {
  // 日期
  const dateEl = document.getElementById('home-date');
  if (dateEl) {
    const now = new Date();
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekDay}`;
  }

  // ── 斜線球體動畫 ──
  const animBg = document.querySelector('.home-anim-bg');
  if (animBg && !animBg.hasChildNodes()) {
    const sphere = document.createElement('div');
    sphere.className = 'ball-sphere';

    // 產生 45 條水平線組成更綿密的高級光球
    const LINE_COUNT = 45;

    for (let i = 0; i < LINE_COUNT; i++) {
      const line = document.createElement('div');
      line.className = 'anim-line';

      const t = i / (LINE_COUNT - 1);
      const normalized = 2 * t - 1; // -1 to 1

      // 根據圓形公式 √(1 - y^2) 讓中間最寬，兩側漸窄
      const circleX = Math.sqrt(Math.max(0, 1 - normalized * normalized));
      const maxW = circleX * 360; // 容器寬度為 360px

      if (maxW < 12) continue; // 忽略太短的雜訊

      // y 軸位置 0% ~ 100%
      const yPos = t * 100;

      // 更具藝術感的錯落 delay 與呼吸頻率
      const dur = (Math.random() * 2 + 7.5).toFixed(2);
      const delay = (i * 0.05).toFixed(2);

      // 高級色域動態色相 (220~270度左右，藍紫漸變)
      const hue = 220 + (normalized * 30) + (Math.random() * 20);

      line.style.setProperty('--w', maxW + 'px');
      line.style.setProperty('--y', yPos + '%');
      line.style.setProperty('--dur', dur + 's');
      line.style.setProperty('--delay', delay + 's');
      line.style.setProperty('--op', (0.15 + circleX * 0.85).toFixed(2));
      line.style.setProperty('--hue', Math.floor(hue));

      sphere.appendChild(line);
    }
    animBg.appendChild(sphere);
  }

  const animClass = isInitialHomeRender ? 'pop-initial' : 'pop-return';

  const dutyWidget = document.getElementById('duty-roster-widget');
  if (dutyWidget && window.getCurrentDutyOfficers) {
    const duty = window.getCurrentDutyOfficers();
    const textSpan = document.getElementById('duty-roster-text');
    if (duty && textSpan) {
      textSpan.innerHTML = `值星(<span id="duty-roster-week">第${duty.week}週</span>): <span id="duty-roster-main">${duty.dutyOfficer}</span> / <span id="duty-roster-sub">${duty.deputy}</span>`;
      dutyWidget.style.display = 'flex';
    } else if (textSpan) {
      textSpan.innerHTML = `當周無人值班或無班表`;
      dutyWidget.style.display = 'flex';
    }

    dutyWidget.className = 'duty-roster-widget';
    void dutyWidget.offsetWidth; // Force reflow
    dutyWidget.classList.add(animClass);
    dutyWidget.style.animationDelay = isInitialHomeRender ? '0.1s' : '0s';
    dutyWidget.style.webkitAnimationDelay = isInitialHomeRender ? '0.1s' : '0s';
  }

  const manualWidget = document.getElementById('duty-manual-widget');
  if (manualWidget) {
    manualWidget.className = 'duty-manual-widget';
    void manualWidget.offsetWidth; // Force reflow
    manualWidget.classList.add(animClass);
    manualWidget.style.animationDelay = isInitialHomeRender ? '0.15s' : '0s';
    manualWidget.style.webkitAnimationDelay = isInitialHomeRender ? '0.15s' : '0s';
  }

  // 更新幹部工作手冊預覽
  updateDutyManualPreview();

  // 中隊卡片 (3列)
  const grid = document.getElementById('squad-grid');
  const floorLabels = { 1: '1樓', 2: '2樓', 3: '3樓' };
  const showCustom = squadCustomOn();

  grid.innerHTML = CONFIG.SQUADS.map((sq, i) => {
    const count = state.students.filter(s => s.squad === sq.id && !s.isEmpty && !s.hidden).length;
    const floor = sq.floor;
    const type = sq.odd ? '單數房' : '雙數房';

    const animClass = isInitialHomeRender ? 'pop-initial' : 'pop-return';

    const baseDelay = isInitialHomeRender ? 0.3 : 0; // 快速卡片進場
    const delay = (baseDelay + i * 0.03).toFixed(2) + 's';

    // 中隊長上傳的照片：只有使用者打開「顯示自訂客製化」才會拿出來用
    const rawPhoto = showCustom ? state.config['squad_img_' + sq.id] : '';
    const photo = isSafeImageDataUrl(rawPhoto) ? rawPhoto : '';
    if (photo) {
      return `
        <div class="sq-card sq-photo ${animClass}" style="--sq-c:${sq.color}; animation-delay: ${delay}; -webkit-animation-delay: ${delay};" onclick="enterSquad('${sq.id}')">
          <img class="sq-photo-img" src="${photo}" alt="${sq.id} 自訂卡片照片" loading="lazy" decoding="async">
          <div class="sq-photo-pill"><span class="sq-photo-dot"></span>${sq.id}<span class="sq-photo-sub">${floorLabels[floor]}</span></div>
        </div>
      `;
    }

    return `
      <div class="sq-card ${animClass}" style="--sq-c:${sq.color}; animation-delay: ${delay}; -webkit-animation-delay: ${delay};" onclick="enterSquad('${sq.id}')">
        <div class="sq-badge" style="background:${sq.color}">${floor}</div>
        <div class="sq-name">${sq.id}</div>
        <div class="sq-desc">${floorLabels[floor]}・${type}</div>
      </div>
    `;
  }).join('');

  // 幹部管理按鈕
  const managementGrid = document.getElementById('management-grid');
  if (managementGrid) {
    const roles = [
      {
        id: 'president',
        label: state.config['role_label_president'] || '社長管理選單',
        color: '#f59e0b',
        icon: state.config['role_icon_president'] || '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>'
      },
      {
        id: 'vice_president',
        label: state.config['role_label_vice_president'] || '副社長管理選單',
        color: '#10b981',
        icon: state.config['role_icon_vice_president'] || '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>'
      }
    ];
    // 接續中隊卡片的動畫延遲時間
    const squadCount = CONFIG.SQUADS.length;
    managementGrid.innerHTML = roles.map((role, i) => {
      const animClass = isInitialHomeRender ? 'pop-initial' : 'pop-return';
      const baseDelay = isInitialHomeRender ? 0.3 : 0;
      const delay = (baseDelay + (squadCount + i) * 0.03).toFixed(2) + 's';

      return `
        <div class="sq-card ${animClass}" style="--sq-c:${role.color}; animation-delay: ${delay}; -webkit-animation-delay: ${delay}; padding: 18px; display:flex; align-items:center; justify-content:center; gap: 12px; border-radius: 16px;" onclick="enterManagement('${role.id}', '${role.label}')">
          <div style="font-size:24px; filter:drop-shadow(0 2px 8px ${role.color}80);">${role.icon}</div>
          <div class="sq-name" style="margin:0; font-size:18px; font-weight:800; letter-spacing:1px;">${role.label}</div>
        </div>
      `;
    }).join('');
  }

  isInitialHomeRender = false;
}

function enterSquad(squadId) {
  const pin = state.config[`pin_${squadId}`];
  if (pin && pin !== '0000') {
    showPinDialog(squadId, () => {
      state.currentSquad = squadId;
      state.currentDate = getTodayAttendanceDate();
      state.changes = [];
      navigateTo('rollcall');
    });
  } else {
    state.currentSquad = squadId;
    state.currentDate = getTodayAttendanceDate();
    state.changes = [];
    navigateTo('rollcall');
  }
}

function enterManagement(roleId, title) {
  // 自動進入需密碼的驗證程序
  showPinDialog(roleId, () => {
    playClickSound('dev_unlock');
    showToast(`歡迎進入，${title}！`, 'success');
    document.getElementById('mgt-title').textContent = title;

    // 權限控制：報修審核只有副社長可見
    const repairBtn = document.getElementById('manage-repair-btn');
    if (repairBtn) {
      repairBtn.style.display = (roleId === 'vice_president') ? 'flex' : 'none';
    }

    navigateTo('management');
  }, `<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ${title} 身分驗證`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 日期選擇器
// ═════════════════════════════════════════════════════════════════════════════
function toggleDatePicker() {
  const panel = document.getElementById('date-picker-panel');
  const btn = document.getElementById('rc-date-btn');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    closeDatePicker();
  } else {
    renderDatePicker();
    panel.classList.add('open');
    btn.classList.add('open');
    document.querySelectorAll('#submit-btn, .fab-empty-bed').forEach(el => el.classList.add('date-picker-hidden'));
    btn.setAttribute('aria-expanded', 'true');
    const input = document.getElementById('rc-date-input');
    input.focus();
    try { input.showPicker?.(); } catch (_) { /* Native input remains usable on Safari. */ }
  }
}

function closeDatePicker() {
  document.getElementById('date-picker-panel')?.classList.remove('open');
  document.getElementById('rc-date-btn')?.classList.remove('open');
  document.querySelectorAll('#submit-btn, .fab-empty-bed').forEach(el => el.classList.remove('date-picker-hidden'));
  document.getElementById('rc-date-btn')?.setAttribute('aria-expanded', 'false');
}

function renderDatePicker() {
  document.getElementById('rc-date-input').value = dateColumnToISO(state.currentDate) || localTodayISO();
  document.getElementById('rc-date-notice').textContent = state.dateColumns.includes(state.currentDate) ? '可自行選擇任何年月日；下方為本學期可選日期。' : '後端點名表還沒有這一天的欄位；這裡的變更會暫存在這台裝置，等欄位建立後自動補送。';
  const list = document.getElementById('date-picker-list');
  // 今天即使尚無後端欄位也要顯示，避免快速選單停在舊學期最後一天。
  const dates = getNavigableAttendanceDates().slice().reverse();
  list.innerHTML = dates.map(d => {
    const isActive = d === state.currentDate;
    const isToday = isTodayAttendanceDate(d);
    const isAvailable = state.dateColumns.includes(d);
    return `<div class="date-item${isActive ? ' active' : ''}${isToday ? ' today-marker' : ''}"
                 onclick="selectRollCallDate('${d}')">${formatExportDate(dateColumnToISO(d))}${isToday ? ' · 今天' : ''}${!isAvailable ? ' · 尚未點名' : ''}</div>`;
  }).join('');
  // 自動捲到選中的日期
  setTimeout(() => {
    const active = list.querySelector('.date-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, 50);
}

function selectRollCallDate(date) {
  const iso = dateColumnToISO(date);
  if (!iso) { showToast('請選擇有效的年月日', 'error'); return; }
  state.currentDate = resolveAttendanceDate(iso);
  if (!state.dateColumns.includes(state.currentDate)) showToast('後端點名表還沒有這一天的欄位；這裡的變更會暫存在這台裝置，等欄位建立後自動補送。', 'info');
  closeDatePicker();
  renderRollCall(true); // 切換日期時也跳過動畫防止殘影
}

// 點選面板外關閉
document.addEventListener('click', e => {
  const btn = document.getElementById('rc-date-btn');
  const panel = document.getElementById('date-picker-panel');
  if (btn && panel && !btn.contains(e.target) && !panel.contains(e.target)) {
    closeDatePicker();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 點名
// ═════════════════════════════════════════════════════════════════════════════
function renderRollCall(skipAnimation = false) {
  if (!state.currentSquad) return;

  document.getElementById('rc-squad-name').textContent = state.currentSquad;
  document.getElementById('rc-date').textContent = formatExportDate(dateColumnToISO(state.currentDate)) || state.currentDate;
  const unavailable = !state.dateColumns.includes(state.currentDate);
  document.getElementById('rc-date-notice').textContent = unavailable ? '後端點名表還沒有這一天的欄位；這裡的變更會暫存在這台裝置，等欄位建立後自動補送。' : '';

  // 更新提交按鈕顯示目前日期
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.innerHTML = `<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 提交 ${state.currentDate} 點名`;

  // 記住捲動位置
  const listEl = document.getElementById('rc-student-list');
  const scrollTop = listEl ? listEl.scrollTop : 0;

  const students = state.students.filter(s => s.squad === state.currentSquad && !s.hidden);
  students.sort((a, b) => a.room.localeCompare(b.room) || a.bed.localeCompare(b.bed));

  let html = '';
  let curRoom = '';
  for (const s of students) {
    if (s.room !== curRoom) { curRoom = s.room; html += `<div class="room-divider">${s.room}</div>`; }
    const status = s.attendance[state.currentDate] || '✓';
    const si = CONFIG.STATUS[status] || CONFIG.STATUS['✓'];
    const absent = status !== '✓';
    const isPending = state.changes.some(c => c.pageId === s.id && c.date === state.currentDate);
    html += `
      <div class="student-row ${s.isEmpty ? 'empty-bed' : ''} ${absent ? 'absent' : ''}"
           data-pid="${s.id}"
           onclick="${s.isEmpty ? '' : `toggleStatus('${s.id}')`}">
        <div class="student-info">
          <div class="student-bed" style="background:${getSquadColor(state.currentSquad)}">${s.bed}</div>
          <div>
            <div class="student-name">${s.isEmpty ? '（空床）' : s.name}${!s.isEmpty && s.isForeign ? ' <svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>' : ''}</div>
            <div class="student-meta">${s.isEmpty ? '' : `${s.class || ''} ${s.studentId || ''}`}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          ${s.isEmpty ? '<span class="empty-tag">空床</span>' :
        `<div class="status-badge" style="background:${si.color}20;color:${si.color};border:1px solid ${si.color}40">${si.icon} ${si.label}</div>`}
          <span class="sync-dot${isPending ? ' pending' : ''}"></span>
        </div>
      </div>`;
  }
  listEl.innerHTML = html;
  updateRollCallStats(skipAnimation);
  setupSubmitButton();

  // 恢復捲動位置
  requestAnimationFrame(() => { if (listEl) listEl.scrollTop = scrollTop; });
}

// 每位學生的 debounce timer
const _syncTimers = {};

function toggleStatus(pageId) {
  if (state.viewSemester) { showToast(`正在查看封存學期 ${state.viewSemester}，不能修改點名`, 'error'); return; }
  const s = state.students.find(x => x.id === pageId);
  if (!s || s.isEmpty) return;

  const cur = s.attendance[state.currentDate] || '✓';
  const next = { '✓': '◎', '◎': '✘', '✘': '✓', '△': '✓' }[cur] || '✓';
  s.attendance[state.currentDate] = next;

  // 點名按鈕音效：切換到「請假」是黄色音，「缺席」是紅色队音，「到」是清脆白色音
  if (next === '✓') playClickSound('roll_in');
  else if (next === '◎') playClickSound('roll_leave');
  else playClickSound('roll_absent');

  // 保留在 changes 以供提交按鈕使用
  const idx = state.changes.findIndex(c => c.pageId === pageId && c.date === state.currentDate);
  const change = { pageId, date: state.currentDate, value: next };
  if (idx >= 0) state.changes[idx] = change;
  else state.changes.push(change);

  // 後端沒有這一天的欄位：先存在本機，背景刷新不會把它洗掉，欄位建立後自動補送
  if (!serverHasDateColumn(state.currentDate)) {
    recordPendingAttendance(pageId, state.currentDate, next);
    if (toggleStatus._warnedDate !== state.currentDate) {
      toggleStatus._warnedDate = state.currentDate;
      showToast('後端點名表還沒有這一天的欄位，變更先暫存在這台裝置', 'info');
    }
  }

  // 即時更新局部的 UI，不重新渲染整個列表以保留點擊動畫
  const row = document.querySelector(`.student-row[data-pid="${pageId}"]`);
  if (row) {
    const si = window.CONFIG.STATUS[next] || window.CONFIG.STATUS['✓'];
    const absent = next !== '✓';
    if (absent) row.classList.add('absent');
    else row.classList.remove('absent');

    const badge = row.querySelector('.status-badge');
    if (badge) {
      badge.style.cssText = `background:${si.color}20;color:${si.color};border:1px solid ${si.color}40`;
      badge.innerHTML = `${si.icon} ${si.label}`;
      // 彈跳微動畫 + 觸覺回饋
      badge.classList.remove('switching');
      void badge.offsetWidth; // force reflow
      badge.classList.add('switching');
      haptic('light');
    }
    const syncDot = row.querySelector('.sync-dot');
    if (syncDot) syncDot.classList.add('pending');
  }
  updateRollCallStats();

  // 立即同步到 Notion（debounce 800ms 防止快速連點重複 API）
  const timerKey = pageId + '_' + change.date;
  clearTimeout(_syncTimers[timerKey]);
  _syncTimers[timerKey] = setTimeout(async () => {
    try {
      await window._api.updateAttendance([change]);
      // 同步成功：移除 changes 中已成功的那筆
      const i = state.changes.findIndex(c => c.pageId === pageId && c.date === change.date && c.value === next);
      if (i >= 0) state.changes.splice(i, 1);

      // 將成功狀態放入「最近同步」保護中，保護 15 秒不被後台刷新覆蓋
      const syncKey = pageId + '_' + change.date;
      state.recentSyncs[syncKey] = { value: next, ts: Date.now() };

      showSyncDot(pageId, 'ok');
    } catch (err) {
      // 失敗保留在 changes 留待手動提交
      showSyncDot(pageId, 'err');
      console.warn('auto-sync failed:', err.message);
    }
  }, 800);
}

// 在學生行顯示同步狀態小點
function showSyncDot(pageId, state) {
  const rows = document.querySelectorAll('.student-row');
  // 找到對應行（透過 onclick 屬性）
  for (const row of rows) {
    if (row.dataset.pid === pageId) {
      const dot = row.querySelector('.sync-dot');
      if (dot) {
        dot.className = `sync-dot ${state}`;
        setTimeout(() => dot.classList.remove('ok', 'err'), 2000);
      }
      break;
    }
  }
}

function updateRollCallStats(skipAnimation = false) {
  const ss = state.students.filter(s => s.squad === state.currentSquad && !s.isEmpty && !s.hidden);
  let p = 0, l = 0, a = 0;
  for (const s of ss) {
    const v = s.attendance[state.currentDate] || '✓';
    if (v === '✓') p++;
    else if (v === '◎' || v === '△') l++;
    else a++;
  }

  // 應用老虎機動畫動畫效果
  animateNumber(document.getElementById('rc-stat-should'), ss.length, skipAnimation);
  animateNumber(document.getElementById('rc-stat-present'), p, skipAnimation);
  animateNumber(document.getElementById('rc-stat-leave'), l, skipAnimation);
  animateNumber(document.getElementById('rc-stat-absent'), a, skipAnimation);

  const confirmBtn = document.getElementById('rc-confirm-btn');
  if (isTodayAttendanceDate(state.currentDate)) {
    confirmBtn.style.display = 'flex';
    const isConfirmed = state.confirmedSquads.includes(state.currentSquad);
    confirmBtn.className = 'rc-confirm-action' + (isConfirmed ? ' done' : '');
    document.getElementById('rc-confirm-icon').innerHTML = isConfirmed ? '<svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : '<svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';
    document.getElementById('rc-confirm-text').textContent = isConfirmed ? '確認本中隊已完成點名' : '確認本中隊完成點名';
  } else {
    confirmBtn.style.display = 'none';
  }
}

async function toggleSquadConfirm() {
  const sq = state.currentSquad;
  const btn = document.getElementById('rc-confirm-btn');

  // 防呆：如果正在同步，忽略重複點擊
  if (btn.disabled) return;

  const isCurrentlyConfirmed = state.confirmedSquads.includes(sq);

  // 顯示載入中狀態 (卡住按鈕不讓使用者亂點)
  btn.disabled = true;
  document.getElementById('rc-confirm-text').textContent = '同步中...';

  // 預計要變成的最終結果
  let targetSquads = [];
  if (isCurrentlyConfirmed) {
    targetSquads = state.confirmedSquads.filter(s => s !== sq);
  } else {
    targetSquads = [...state.confirmedSquads, sq];
  }

  const today = getTodayAttendanceDate();
  try {
    // 儲存到 Notion (系統全域共用)，需等候完成才改變本地狀態。
    // 新後端只加/減自己這隊，不會蓋掉別隊同時按的回報；舊後端沒有 /api/confirm 才退回整串寫入
    try {
      const res = await window._api.confirmSquad(today, sq, !isCurrentlyConfirmed);
      if (Array.isArray(res && res.confirms)) targetSquads = res.confirms;
    } catch (err) {
      if (err && err.status === 404) await window._api.setConfig({ ['confirm_' + today]: targetSquads.join(',') });
      else throw err;
    }

    // 如果沒有拋出錯誤，代表網路更新成功！
    state.confirmedSquads = targetSquads;
    state.config['confirm_' + today] = targetSquads.join(',');

    showToast(isCurrentlyConfirmed ? '已取消回報' : '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 點名回報成功！已即時同步至總表', 'success');

    // 確認點名後永遠播放 Do-Mi-Sol 三連音
    if (!isCurrentlyConfirmed) {
      setTimeout(() => playClickSound('all_present'), 100);
    }
  } catch (e) {
    console.error('儲存確認狀態失敗', e);
    showToast('信號不穩定，回報失敗，請重試', 'error');
  } finally {
    // 放開按鈕，並依據最新（或被還原）的資料重新渲染按鈕狀態
    btn.disabled = false;
    updateRollCallStats();
  }
}

function setupSubmitButton() {
  const btn = document.getElementById('submit-btn');
  btn.onclick = async () => {
    if (!state.changes.length) { showToast('沒有需要提交的變更', 'info'); return; }
    btn.disabled = true; btn.textContent = '提交中...';
    try {
      for (let i = 0; i < state.changes.length; i += 45)
        await window._api.updateAttendance(state.changes.slice(i, i + 45));
      showToast(`已提交 ${state.changes.length} 筆變更`, 'success');
      showSubmitSuccess();
      state.changes = [];
    } catch (err) { showToast('提交失敗：' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 提交今日點名'; }
  };
}

function showSubmitSuccess() {
  const ss = state.students.filter(s => s.squad === state.currentSquad && !s.isEmpty && !s.hidden);
  let p = 0, l = 0, a = 0;
  for (const s of ss) { const v = s.attendance[state.currentDate] || '✓'; if (v === '✓') p++; else if (v === '◎' || v === '△') l++; else a++; }
  document.getElementById('submit-should').textContent = ss.length;
  document.getElementById('submit-present').textContent = p;
  document.getElementById('submit-leave').textContent = l;
  document.getElementById('submit-absent').textContent = a;
  const m = document.getElementById('submit-success-modal');
  m.classList.add('visible'); setTimeout(() => m.classList.remove('visible'), 3000);

  // 撒花慶祝 + 觸覺
  launchConfetti();
  haptic('heavy');

  // 全員到齊額外音效
  if (a === 0 && l === 0) playClickSound('all_present');
}

// ═════════════════════════════════════════════════════════════════════════════
// 空床回報
// ═════════════════════════════════════════════════════════════════════════════
function openEmptyBedModal() {
  // 若在點名頁只顯示當前中隊的房間，否則顯示全部房間
  const filtered = state.currentSquad && currentPage === 'rollcall'
    ? state.students.filter(s => s.squad === state.currentSquad && !s.hidden)
    : state.students.filter(s => !s.hidden);
  const rooms = [...new Set(filtered.map(s => s.room))].sort();
  const sel = document.getElementById('eb-room');
  sel.innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  updateBedOptions();
  document.getElementById('empty-bed-modal').classList.add('visible');
}

function updateBedOptions() {
  const room = document.getElementById('eb-room').value;
  // 遵守房間規則：雙人房只顯示 A/B
  const allowedBeds = CONFIG.DOUBLE_ROOMS.includes(room) ? ['A', 'B'] : ['A', 'B', 'C', 'D'];
  const sel = document.getElementById('eb-bed');
  sel.innerHTML = allowedBeds.map(b => {
    const s = state.students.find(x => x.room === room && x.bed === b && !x.hidden);
    const label = s ? (s.isEmpty ? `${b} 床（已空床）` : `${b} 床 - ${s.name}`) : `${b} 床`;
    return `<option value="${b}">${label}</option>`;
  }).join('');
}

async function submitEmptyBed() {
  const room = document.getElementById('eb-room').value;
  const bed = document.getElementById('eb-bed').value;
  const student = state.students.find(s => s.room === room && s.bed === bed);

  if (!student) { showToast('找不到此床位', 'error'); return; }
  if (student.isEmpty) { showToast('此床位已是空床', 'info'); closeModal('empty-bed-modal'); return; }

  try {
    const datesToClear = {};
    for (const d of state.dateColumns) datesToClear[d] = '✓'; // 預設所有空床請假紀錄一律為勾勾

    // 在 Notion 中將「空床」checkbox 設為 true，並清除學生與請假資料
    await window._api.updateAttendance([{
      pageId: student.id,
      markEmpty: true,
      clearProfile: true,
      dates: datesToClear
    }]);

    // 本地更新
    student.isEmpty = true;
    student.name = '';
    student.class = '';
    student.studentId = '';
    student.isForeign = false;
    for (const d of state.dateColumns) student.attendance[d] = '✓';

    showToast(`${room} ${bed} 床已標記為空床並清除殘留資料`, 'success');
    closeModal('empty-bed-modal');
    renderRollCall();
    renderSummary();
  } catch (err) {
    showToast('更新失敗：' + err.message, 'error');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 新增住宿生 (送出審核)
// ═════════════════════════════════════════════════════════════════════════════
function openAddResidentModal() {
  const emptyBeds = state.students.filter(s => s.isEmpty && !s.hidden);
  if (emptyBeds.length === 0) {
    showToast('目前沒有可用的空床', 'info');
    return;
  }
  const rooms = [...new Set(emptyBeds.map(s => s.room))].sort();
  const sel = document.getElementById('ar-room');
  sel.innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');

  // 清空輸入框
  document.getElementById('ar-name').value = '';
  document.getElementById('ar-class').value = '';
  document.getElementById('ar-studentid').value = '';
  document.getElementById('ar-is-foreign').checked = false;

  updateAddResidentBeds();
  document.getElementById('add-resident-modal').classList.add('visible');
}

function updateAddResidentBeds() {
  const room = document.getElementById('ar-room').value;
  const beds = state.students.filter(s => s.room === room && s.isEmpty && !s.hidden);
  const sel = document.getElementById('ar-bed');
  sel.innerHTML = beds.map(s => `<option value="${s.bed}">${s.bed} 床</option>`).join('');
}

function checkForeignStudentClass() {
  const classInput = document.getElementById('ar-class').value || '';
  if (/越南|華語專班/.test(classInput)) {
    document.getElementById('ar-is-foreign').checked = true;
  }
}

async function submitAddResident() {
  const room = document.getElementById('ar-room').value;
  const bed = document.getElementById('ar-bed').value;
  const name = document.getElementById('ar-name').value.trim();
  const className = document.getElementById('ar-class').value.trim();
  const studentId = document.getElementById('ar-studentid').value.trim();
  const isForeign = document.getElementById('ar-is-foreign').checked;

  if (!name || !className || !studentId) {
    playClickSound('dev_error');
    showToast('姓名、班別與學號為必填', 'error');
    return;
  }

  const student = state.students.find(s => s.room === room && s.bed === bed);
  if (!student || !student.isEmpty) {
    playClickSound('dev_error');
    showToast('此床位無法新增', 'error');
    return;
  }

  const btn = document.querySelector('#add-resident-modal .modal-btn.confirm');
  if (btn) { btn.disabled = true; btn.textContent = '送出中...'; }

  try {
    const reqId = 'add_req_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const payload = {
      pageId: student.id,
      room,
      bed,
      name,
      class: className,
      studentId,
      isForeign,
      timestamp: Date.now()
    };

    await window._api.setConfig({ [reqId]: JSON.stringify(payload) });

    playClickSound('all_present');
    showToast('該件已送出 請社長審核 或副社長審核', 'success');
    closeModal('add-resident-modal');
  } catch (err) {
    showToast('送出失敗：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '送出審核'; }
  }
}
// 換床位
// ═════════════════════════════════════════════════════════════════════════════
function openSwapBedModal() {
  const rooms = [...new Set(state.students.filter(s => !s.hidden).map(s => s.room))].sort();
  document.getElementById('sw-from-room').innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  document.getElementById('sw-to-room').innerHTML = rooms.map(r => `<option value="${r}">${r}</option>`).join('');
  updateSwapFromBeds();
  updateSwapToBeds();
  document.getElementById('swap-bed-modal').classList.add('visible');
}

function updateSwapFromBeds() {
  const room = document.getElementById('sw-from-room').value;
  const beds = state.students.filter(s => s.room === room && !s.isEmpty);
  const sel = document.getElementById('sw-from-bed');
  sel.innerHTML = beds.map(s =>
    `<option value="${s.bed}">${s.bed} 床 - ${s.name || '(無名)'}</option>`
  ).join('');
  if (!beds.length) sel.innerHTML = '<option disabled>此房間無住宿生</option>';
}

function updateSwapToBeds() {
  const room = document.getElementById('sw-to-room').value;
  const allBeds = state.students.filter(s => s.room === room);
  const sel = document.getElementById('sw-to-bed');
  sel.innerHTML = allBeds.map(s => {
    const label = s.isEmpty ? `${s.bed} 床（空床）` : `${s.bed} 床 - ${s.name || '(無名)'}`;
    return `<option value="${s.bed}">${label}</option>`;
  }).join('');
  if (!allBeds.length) sel.innerHTML = '<option disabled>此房間無床位</option>';
}

async function submitSwapBed() {
  const fromRoom = document.getElementById('sw-from-room').value;
  const fromBed = document.getElementById('sw-from-bed').value;
  const toRoom = document.getElementById('sw-to-room').value;
  const toBed = document.getElementById('sw-to-bed').value;

  if (fromRoom === toRoom && fromBed === toBed) {
    showToast('來源和目標是同一個床位', 'info'); return;
  }

  const studentA = state.students.find(s => s.room === fromRoom && s.bed === fromBed);
  const studentB = state.students.find(s => s.room === toRoom && s.bed === toBed);

  if (!studentA) { showToast('找不到來源學生', 'error'); return; }
  if (!studentB) { showToast('找不到目標床位資料', 'error'); return; }

  const btn = document.querySelector('#swap-bed-modal .modal-btn.confirm');
  if (btn) { btn.disabled = true; btn.textContent = '交換中...'; }

  try {
    // 呼叫新端點：整行資料互換（姓名/班別/學號/空床/所有出席紀錄全部交換）
    // 物理位置（寢床號/床號/中隊）保持不變
    await window._api.swapBeds(studentA.id, studentB.id);

    // 本地狀態同步：交換兩個學生物件除位置外的所有資料
    const posA = { id: studentA.id, room: studentA.room, bed: studentA.bed, squad: studentA.squad };
    const posB = { id: studentB.id, room: studentB.room, bed: studentB.bed, squad: studentB.squad };

    // 交換所有非位置屬性
    const keysToSwap = ['name', 'class', 'studentId', 'phone', 'address', 'isForeign', 'isEmpty', 'attendance'];
    for (const key of keysToSwap) {
      const tmp = studentA[key];
      studentA[key] = studentB[key];
      studentB[key] = tmp;
    }

    // 位置保持不變（用回原本的值）
    Object.assign(studentA, posA);
    Object.assign(studentB, posB);

    const nameA = studentA.name || '（空床）';
    const nameB = studentB.name || '（空床）';
    const msg = `<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 已完整交換：${fromRoom}${fromBed} ${nameA} ↔ ${toRoom}${toBed} ${nameB}`;
    showToast(msg, 'success');
    closeModal('swap-bed-modal');
    renderSummary();
  } catch (err) {
    showToast('換床位失敗：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '確認換床位'; }
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('visible');
}

// ═════════════════════════════════════════════════════════════════════════════
// 總表
// 計算順序：
//   1. 總床數（設定值）
//   2. 空床數 = 各樓層空床(isEmpty)總和 + 空床修正值
//   3. 住宿人數 = 總床數 - 空床數
//   4. 住宿率 = round((住宿人數 / 總床數) * 100 * 10) / 10 + "%"
//   5. 實到 = 各樓層 (應到 - 請假 - 未請假) 的總合
//   6. 請假 = 各樓層當日請假總和
//   7. 未請假 = 各樓層當日未請假總和
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 計算某日的全域統計資料（一個函數，renderSummary 和 copySummary 共用）
 */
function computeDailyStats(date) {
  const live = computeLiveDailyStats(date);
  if (!isTodayAttendanceDate(date) && !state.viewSemester) {
    const snap = state.config['snapshot_' + date];
    if (snap) {
      try {
        const cachedSt = JSON.parse(snap);
        if (cachedSt && typeof cachedSt === 'object') {
          // 快照只鎖床位/住宿人數/外籍 (名單會變動)；請假、未請假一律用點名表現況，
          // 不然當天最後一次開總表之後才登記的請假 (電話請假、別台裝置) 會漏算，跟歷史頁對不起來
          const shouldAttend = summaryDetailNumber(cachedSt.shouldAttend ?? live.shouldAttend);
          return {
            ...cachedSt,
            leave: live.leave, absent: live.absent,
            present: shouldAttend - live.leave - live.absent,
            squads: live.squads,
            lists: { ...(cachedSt.lists || {}), leave: live.lists.leave, absent: live.lists.absent },
          };
        }
      } catch (e) { console.error('Failed to parse snapshot', e); }
    }
  }
  return live;
}

function computeLiveDailyStats(date) {
  const totalBeds = parseInt(state.config['total_beds']) || state.students.filter(s => !s.hidden).length;
  const bedOffset = parseInt(state.config['bed_offset']) || 0;

  // --- 各中隊明細 ---
  const squads = [];
  let gShouldAttend = 0, gLeave = 0, gAbsent = 0, gPresent = 0;
  let gEmptyCount = 0, gForeignCount = 0;
  // 快照一起存「是誰」(學生 id)，之後名單變動時才查得出差額是哪些人
  const lists = { leave: [], absent: [], empty: [], foreign: [] };

  for (const sq of CONFIG.SQUADS) {
    // 排除隱藏的學生（雙人房 C/D 和儲藏室）
    const members = state.students.filter(s => s.squad === sq.id && !s.hidden);
    // 空床 = isEmpty 的學生（靜態屬性，來自 Notion 的「空床」checkbox）
    let emptyInSquad = members.filter(s => s.isEmpty).length;

    // 應到 = 非空床的住宿生
    const residents = members.filter(s => !s.isEmpty);
    const shouldAttend = residents.length;

    let sqLeave = 0, sqAbsent = 0;
    for (const s of members) if (s.isEmpty) lists.empty.push(s.id);
    for (const s of residents) {
      const v = s.attendance[date] || '✓';
      if (v === '◎' || v === '△') { sqLeave++; lists.leave.push(s.id); }
      else if (v === '✘') { sqAbsent++; lists.absent.push(s.id); }
      if (s.isForeign) lists.foreign.push(s.id);
    }
    // 實到 = 應到 - 請假 - 未請假
    const sqPresent = shouldAttend - sqLeave - sqAbsent;
    // 外籍
    const sqForeign = residents.filter(s => s.isForeign).length;

    squads.push({
      id: sq.id, color: sq.color,
      shouldAttend, present: sqPresent, leave: sqLeave, absent: sqAbsent,
      empty: emptyInSquad, foreign: sqForeign,
    });

    gShouldAttend += shouldAttend;
    gLeave += sqLeave;
    gAbsent += sqAbsent;
    gPresent += sqPresent;
    gEmptyCount += emptyInSquad;
    gForeignCount += sqForeign;
  }

  // --- 全域計算 ---
  // 2. 空床數 = 各樓層空床總和 + 全域空床修正值
  const totalEmpty = gEmptyCount + bedOffset;
  // 3. 住宿人數 = 總床數 - 空床數
  const residents = totalBeds - totalEmpty;
  // 4. 住宿率公式: round((住宿人數/總床數)*100*10)/10
  const rate = totalBeds > 0 ? Math.round((residents / totalBeds) * 100 * 10) / 10 : 0;

  const foreignOffset = parseInt(state.config['foreign_offset']) || 0;

  return {
    totalBeds, totalEmpty, residents, rate, bedOffset,
    present: gPresent, leave: gLeave, absent: gAbsent,
    shouldAttend: gShouldAttend, foreign: gForeignCount + foreignOffset, foreignOffset,
    squads, lists,
  };
}

const SUMMARY_DETAIL_META = {
  empty: {
    title: '空床數明細',
    description: '逐床列出被標記為空床的床位，並顯示設定中的修正值。',
    label: '空床',
  },
  rate: {
    title: '住宿率計算明細',
    description: '住宿率以「住宿人數 ÷ 總床數」計算，住宿人數由總床數扣除空床數。',
    label: '住宿率',
  },
  foreign: {
    title: '外籍生明細',
    description: '列出目前標記為外籍生、且不是空床的住宿生，並顯示設定修正值。',
    label: '外籍生',
  },
  leave: {
    title: '請假名單',
    description: '列出選定日期狀態為「請假」或「特殊」的住宿生。',
    label: '請假',
  },
  absent: {
    title: '未請假名單',
    description: '列出選定日期狀態為「未請假」的住宿生。',
    label: '未請假',
  },
};

function openSummaryDetail(kind) {
  if (!SUMMARY_DETAIL_META[kind]) return;
  if (currentPage === 'summary') summaryScrollPosition = window.scrollY;
  activeSummaryDetail = kind;
  haptic('light');
  navigateTo('summary-detail');
}

function closeSummaryDetail() {
  navigateTo('summary');
  setTimeout(() => window.scrollTo({ top: summaryScrollPosition, behavior: 'auto' }), 190);
}

function summaryDetailNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function summaryDetailToday() {
  return typeof getTodayAttendanceDate === 'function' ? getTodayAttendanceDate() : getTodayColumnName();
}

function summaryDetailIsToday(date) {
  return typeof isTodayAttendanceDate === 'function' ? isTodayAttendanceDate(date) : date === getTodayColumnName();
}

function summaryDetailSquadOrder(squadId) {
  const index = CONFIG.SQUADS.findIndex(sq => sq.id === squadId);
  return index < 0 ? CONFIG.SQUADS.length : index;
}

function summaryDetailEntries(kind, date) {
  const visible = state.students.filter(student => !student.hidden);
  let entries = [];
  if (kind === 'empty') entries = visible.filter(student => student.isEmpty);
  if (kind === 'foreign') entries = visible.filter(student => !student.isEmpty && student.isForeign);
  if (kind === 'leave') entries = visible.filter(student => {
    if (student.isEmpty) return false;
    const status = student.attendance[date] || '✓';
    return status === '◎' || status === '△';
  });
  if (kind === 'absent') entries = visible.filter(student => !student.isEmpty && (student.attendance[date] || '✓') === '✘');

  return entries.slice().sort((a, b) => {
    const squadDiff = summaryDetailSquadOrder(a.squad) - summaryDetailSquadOrder(b.squad);
    if (squadDiff) return squadDiff;
    return String(a.room || '').localeCompare(String(b.room || ''), 'zh-Hant', { numeric: true }) ||
      String(a.bed || '').localeCompare(String(b.bed || ''), 'zh-Hant', { numeric: true });
  });
}

function summaryDetailCorrection(kind, stats) {
  if (kind === 'empty') return summaryDetailNumber(stats.bedOffset);
  if (kind === 'foreign') {
    if (stats.foreignOffset !== undefined) return summaryDetailNumber(stats.foreignOffset);
    const squadTotal = (stats.squads || []).reduce((sum, squad) => sum + summaryDetailNumber(squad.foreign), 0);
    return summaryDetailNumber(stats.foreign) - squadTotal;
  }
  return 0;
}

function summaryDetailExpectedTotal(kind, stats) {
  return summaryDetailNumber({
    empty: stats.totalEmpty,
    foreign: stats.foreign,
    leave: stats.leave,
    absent: stats.absent,
  }[kind]);
}

function summaryDetailStatus(kind, student) {
  if (kind === 'empty') return { text: '空床', className: 'empty' };
  if (kind === 'foreign') return { text: '外籍生', className: 'foreign' };
  const value = student.attendance[state.currentDate] || '✓';
  if (value === '△') return { text: '特殊', className: 'special' };
  if (kind === 'leave') return { text: '請假', className: 'leave' };
  return { text: '未請假', className: 'absent' };
}

function summaryDetailRow(kind, student) {
  const status = summaryDetailStatus(kind, student);
  const roomBed = `${sfEsc(student.room || '未填房號')} ${sfEsc(student.bed || '未填')}床`;
  const primary = kind === 'empty' ? roomBed : sfEsc(student.name || '未填姓名');
  const details = kind === 'empty'
    ? sfEsc(student.squad || '未分隊')
    : [roomBed, student.class, student.studentId].filter(Boolean).map(sfEsc).join(' ・ ');
  return `<li class="summary-detail-row">
    <div class="summary-detail-row-main">
      <strong>${primary}</strong>
      <span>${details || '無其他資料'}</span>
    </div>
    <span class="summary-detail-status ${status.className}">${status.text}</span>
  </li>`;
}

function summaryDetailGroups(kind, entries) {
  if (!entries.length) {
    return `<div class="summary-detail-empty">
      <svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      <strong>目前沒有符合的名單</strong>
      <span>這裡沒有可列出的資料。</span>
    </div>`;
  }
  const groupIds = [...new Set(entries.map(student => student.squad || '未分隊'))];
  return groupIds.map(squadId => {
    const members = entries.filter(student => (student.squad || '未分隊') === squadId);
    return `<section class="summary-detail-group">
      <div class="summary-detail-group-title"><h2>${sfEsc(squadId)}</h2><span>${members.length} 筆</span></div>
      <ul>${members.map(student => summaryDetailRow(kind, student)).join('')}</ul>
    </section>`;
  }).join('');
}

function renderSummaryRateDetail(stats) {
  const displayedRate = summaryDetailNumber(stats.rate);
  return `<section class="summary-formula-card" aria-label="住宿率公式">
    <div class="summary-formula-result"><span>住宿率</span><strong>${displayedRate}%</strong></div>
    <div class="summary-formula-expression">${stats.residents} ÷ ${stats.totalBeds} × 100% = ${displayedRate}%</div>
    <div class="summary-formula-rows">
      <div><span>總床數</span><b>${stats.totalBeds}</b></div>
      <div><span>減：空床數</span><b>− ${stats.totalEmpty}</b></div>
      <div class="result"><span>住宿人數</span><b>${stats.residents}</b></div>
    </div>
    <button type="button" class="summary-detail-related" onclick="openSummaryDetail('empty')">查看空床數明細 <span aria-hidden="true">›</span></button>
  </section>`;
}

// 差額是誰：新快照有存 id 就逐人比對；舊快照沒存名字，只能比各隊人數
function renderSnapshotDifferenceDetail(kind, stats, entries, difference) {
  const heading = `<div class="summary-detail-list-heading"><h2>差額是誰</h2><span>差 ${difference > 0 ? '+' : ''}${difference}</span></div>`;
  const snapIds = stats.lists && Array.isArray(stats.lists[kind]) ? stats.lists[kind] : null;

  if (snapIds) {
    const snapSet = new Set(snapIds);
    const currentSet = new Set(entries.map(student => student.id));
    const added = entries.filter(student => !snapSet.has(student.id));
    const removed = snapIds.filter(id => !currentSet.has(id)).map(id => state.students.find(student => student.id === id) || { id });
    const removedRow = student => {
      const exists = !!student.name || !!student.room;
      const roomBed = exists ? `${sfEsc(student.room || '未填房號')} ${sfEsc(student.bed || '未填')}床` : '';
      return `<li class="summary-detail-row">
        <div class="summary-detail-row-main">
          <strong>${exists ? sfEsc(student.name || roomBed) : '已刪除的住宿生'}</strong>
          <span>${exists ? [roomBed, student.squad].filter(Boolean).map(sfEsc).join(' ・ ') : '住宿生資料已不存在'}</span>
        </div>
        <span class="summary-detail-status absent">快照有</span>
      </li>`;
    };
    const block = (title, rows) => rows ? `<section class="summary-detail-group"><div class="summary-detail-group-title"><h2>${title}</h2></div><ul>${rows}</ul></section>` : '';
    const body = block(`現在名單多出來的 ${added.length} 人（快照當時不在）`, added.map(student => summaryDetailRow(kind, student)).join('')) +
      block(`快照當時有、現在不在名單的 ${removed.length} 人`, removed.map(removedRow).join(''));
    return heading + (body || `<div class="summary-detail-notice"><span>名單人員相同，差額來自修正值變動。</span></div>`);
  }

  const snapSquads = Array.isArray(stats.squads) ? stats.squads : [];
  const rows = snapSquads.map(squad => {
    const then = summaryDetailNumber(squad[kind]);
    const now = entries.filter(student => (student.squad || '未分隊') === squad.id).length;
    const diff = now - then;
    return diff ? `<div><span>${sfEsc(squad.id)}：快照 ${then} → 現在 ${now}</span><b>${diff > 0 ? '多 ' : '少 '}${Math.abs(diff)}</b></div>` : '';
  }).join('');
  return `${heading}<div class="summary-detail-notice"><strong>這天的快照沒有存名字</strong><span>舊版快照只記了人數，查不到是哪幾個人。${rows ? '下面是各隊差多少，可以縮小範圍。' : '各隊人數也對不出差異，可能是修正值或分隊資料變動。'}（這次更新之後的快照會存名字）</span></div>
    ${rows ? `<section class="summary-calculation-card" aria-label="各隊差額"><div class="summary-formula-rows">${rows}</div></section>` : ''}`;
}

function renderSummaryDetail() {
  const kind = SUMMARY_DETAIL_META[activeSummaryDetail] ? activeSummaryDetail : 'empty';
  const meta = SUMMARY_DETAIL_META[kind];
  const date = state.currentDate || summaryDetailToday();
  const stats = computeDailyStats(date);
  const isLocked = !summaryDetailIsToday(date) && !!state.config['snapshot_' + date];
  document.getElementById('summary-detail-date').textContent = `${date}${isLocked ? ' ・ 已鎖定快照' : ''}`;
  document.getElementById('summary-detail-title').textContent = meta.title;
  document.getElementById('summary-detail-description').textContent = meta.description;

  const content = document.getElementById('summary-detail-content');
  if (kind === 'rate') {
    content.innerHTML = renderSummaryRateDetail(stats);
    return;
  }

  const entries = summaryDetailEntries(kind, date);
  const expectedTotal = summaryDetailExpectedTotal(kind, stats);
  const correction = summaryDetailCorrection(kind, stats);
  const snapshotDifference = expectedTotal - correction - entries.length;
  const correctionLabel = kind === 'empty' ? '空床修正值' : '外籍生修正值';
  const calculationRows = [
    `<div><span>目前可查名單</span><b>${entries.length}</b></div>`,
    correction !== 0 ? `<div><span>${correctionLabel}</span><b>${correction > 0 ? '+' : ''}${correction}</b></div>` : '',
    snapshotDifference !== 0 ? `<div class="snapshot-difference"><span>歷史快照名單差額</span><b>${snapshotDifference > 0 ? '+' : ''}${snapshotDifference}</b></div>` : '',
    `<div class="result"><span>${meta.label}合計</span><b>${expectedTotal}</b></div>`,
  ].join('');
  const notice = snapshotDifference !== 0
    ? `<div class="summary-detail-notice"><strong>為什麼有差額？</strong><span>這一天的總數已鎖定，但住宿生資料之後曾變動；差額用來讓舊快照總數保持一致。</span></div>`
    : '';
  content.innerHTML = `<section class="summary-calculation-card" aria-label="${meta.label}加總方式">
      <div class="summary-calculation-heading"><span>加總方式</span><strong>${expectedTotal}</strong></div>
      <div class="summary-formula-rows">${calculationRows}</div>
    </section>
    ${notice}
    ${snapshotDifference !== 0 ? renderSnapshotDifferenceDetail(kind, stats, entries, snapshotDifference) : ''}
    <div class="summary-detail-list-heading"><h2>逐筆明細</h2><span>${entries.length} 筆名單</span></div>
    ${summaryDetailGroups(kind, entries)}`;
}

// 快照以前是「每畫一次總表、數字有變就寫一次設定表」，人多時每台裝置每幾秒都在寫，
// 把 Notion 塞爆。現在同一台 45 秒內最多寫一次 (只寫最後的數字)。
let _snapshotTimer = null;
let _snapshotPending = null;
let _snapshotLastAt = 0;
function scheduleSnapshotSave(date, snapshotStr) {
  _snapshotPending = { date, snapshotStr };
  if (_snapshotTimer) return;
  const wait = Math.max(0, 45000 - (Date.now() - _snapshotLastAt));
  _snapshotTimer = setTimeout(() => {
    _snapshotTimer = null;
    const job = _snapshotPending;
    _snapshotPending = null;
    if (!job || state.viewSemester) return;
    _snapshotLastAt = Date.now();
    window._api.setConfig({ ['snapshot_' + job.date]: job.snapshotStr }).catch(e => console.error('Auto snapshot failed', e));
  }, wait);
}

function renderSummary() {
  const date = state.currentDate || getTodayAttendanceDate();
  const st = computeDailyStats(date);

  const banner = document.getElementById('summary-archive-banner');
  if (banner) {
    banner.hidden = !state.viewSemester;
    const nameEl = document.getElementById('summary-archive-name');
    if (nameEl) nameEl.textContent = state.viewSemester || '';
  }

  if (state.viewSemester) {
    document.getElementById('summary-date').textContent = date + ` (封存 ${state.viewSemester})`;
  } else if (!isTodayAttendanceDate(date) && state.config['snapshot_' + date]) {
    document.getElementById('summary-date').textContent = date + ' (已鎖定)';
  } else if (!serverHasDateColumn(date)) {
    document.getElementById('summary-date').textContent = date + ' (後端無此日欄位，僅本機暫存)';
  } else {
    document.getElementById('summary-date').textContent = date;
  }

  // 核心功能：當觀看的是「今天」的總表時，背景自動紀錄快照。
  // 這確保 11 點鐘他們拉開來看數字回報時，系統就會自動存下那瞬間的結果。
  // (查看封存學期時不能寫快照，不然會把舊學期的數字蓋到今天)
  if (isTodayAttendanceDate(date) && !state.viewSemester) {
    const snapshotStr = JSON.stringify(st);
    if (state.config['snapshot_' + date] !== snapshotStr) {
      state.config['snapshot_' + date] = snapshotStr;
      scheduleSnapshotSave(date, snapshotStr);
    }
  }

  // 1-3: 上排大數字
  document.getElementById('total-beds').textContent = st.totalBeds;
  document.getElementById('total-empty').textContent = st.totalEmpty;
  document.getElementById('total-residents').textContent = st.residents;

  // 4-5: 外籍 / 住宿率
  document.getElementById('total-foreign').textContent = st.foreign;
  document.getElementById('total-rate').textContent = st.rate + '%';

  // 6-8: 實到 / 請假 / 未請假
  document.getElementById('total-present').textContent = st.present;
  document.getElementById('total-leave').textContent = st.leave;
  document.getElementById('total-absent').textContent = st.absent;

  // 各中隊
  const grid = document.getElementById('summary-squad-grid');
  grid.innerHTML = st.squads.map(sq => {
    const isConfirmed = state.confirmedSquads.includes(sq.id) && isTodayAttendanceDate(date);
    const confHtml = isConfirmed ? `<div class="sqd-conf-badge-inline"><span class="conf-ring-sm">✓</span>已回報</div>` : '';
    return `
    <div class="sqd-card" style="--sq-c:${sq.color}">
      <div class="sqd-header-row">
        <div class="sqd-title">${sq.id}</div>
        ${confHtml}
      </div>
      <div class="sqd-stats-grid">
        <div class="sqd-stat-item">應到 <b>${sq.shouldAttend}</b></div>
        <div class="sqd-stat-item green">到 <b>${sq.present}</b></div>
        <div class="sqd-stat-item yellow">假 <b>${sq.leave}</b></div>
        <div class="sqd-stat-item red">缺 <b>${sq.absent}</b></div>
      </div>
      <div class="sqd-meta"><svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg> ${sq.foreign} ・ <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg> ${sq.empty}</div>
    </div>`;
  }).join('');

  document.getElementById('summary-prev-date').onclick = () => changeSummaryDate(-1);
  document.getElementById('summary-next-date').onclick = () => changeSummaryDate(1);
  document.getElementById('copy-summary-btn').onclick = () => copySummary(date);
  document.getElementById('refresh-summary-btn').onclick = () => loadData();
}

function changeSummaryDate(delta) {
  const dates = getNavigableAttendanceDates();
  const currentISO = dateColumnToISO(state.currentDate);
  const idx = dates.findIndex(date => dateColumnToISO(date) === currentISO);
  const ni = idx + delta;
  if (idx >= 0 && ni >= 0 && ni < dates.length) {
    state.currentDate = dates[ni];
    renderSummary();
  }
}

function copySummary(date) {
  const st = computeDailyStats(date);
  const text = `碧苑宿舍 ${date} 點名報告\n` +
    `1. 總床數：${st.totalBeds}\n` +
    `2. 空床數：${st.totalEmpty}（修正值: ${st.bedOffset}）\n` +
    `3. 住宿人數：${st.residents}\n` +
    `4. 住宿率：${st.rate}%\n` +
    `5. 實到：${st.present}\n` +
    `6. 請假：${st.leave}\n` +
    `7. 未請假：${st.absent}\n` +
    `外籍生：${st.foreign}`;
  navigator.clipboard.writeText(text).then(() => showToast('已複製', 'success'));
}

// ═════════════════════════════════════════════════════════════════════════════
// 歷史
// ═════════════════════════════════════════════════════════════════════════════
function renderHistory() {
  const year = state.calMonth.getFullYear();
  const month = state.calMonth.getMonth();
  document.getElementById('hist-month').textContent = `${year} 年 ${month + 1} 月`;

  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  let html = '<div class="cal-header">日</div><div class="cal-header">一</div><div class="cal-header">二</div><div class="cal-header">三</div><div class="cal-header">四</div><div class="cal-header">五</div><div class="cal-header">六</div>';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const col = resolveAttendanceDate(iso);
    const has = state.dateColumns.includes(col);
    const today = iso === localTodayISO();
    let badge = 0;
    if (has) for (const s of state.students) if (!s.isEmpty && s.attendance[col] && s.attendance[col] !== '✓') badge++;
    html += `<div class="cal-cell ${has ? 'has-data' : ''} ${today ? 'today' : ''}" ${has ? `onclick="showDateDetail('${col}')"` : ''}><div class="cal-day">${d}</div>${has && badge ? `<div class="cal-badge">${badge}</div>` : ''}</div>`;
  }
  document.getElementById('hist-calendar').innerHTML = html;
  document.getElementById('cal-prev-month').onclick = () => { state.calMonth.setMonth(state.calMonth.getMonth() - 1); renderHistory(); };
  document.getElementById('cal-next-month').onclick = () => { state.calMonth.setMonth(state.calMonth.getMonth() + 1); renderHistory(); };
}

function showDateDetail(col) {
  const nonEmpty = state.students.filter(s => !s.isEmpty && !s.hidden);
  let p = 0, l = 0, a = 0; const list = [];
  for (const s of nonEmpty) {
    const v = s.attendance[col] || '✓';
    if (v === '✓' || v === '△') p++;
    else if (v === '◎') { l++; list.push({ ...s, status: v }); }
    else if (v === '✘') { a++; list.push({ ...s, status: v }); }
  }
  let html = `<div class="detail-header"><h3>${col}</h3><div class="detail-stats"><span style="color:var(--green)">到 ${p}</span><span style="color:var(--yellow)">假 ${l}</span><span style="color:var(--red)">缺 ${a}</span></div></div>`;
  if (list.length) {
    html += '<div class="detail-list">';
    for (const s of list) { const si = CONFIG.STATUS[s.status] || CONFIG.STATUS['◎']; html += `<div class="detail-row"><span>${s.room} ${s.bed} ${s.name}</span><span style="color:${si.color}">${si.icon} ${si.label}</span></div>`; }
    html += '</div>';
  } else html += '<p style="color:var(--dim);text-align:center;padding:20px">全員到齊 <svg class="ui-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg></p>';
  document.getElementById('hist-detail').innerHTML = html;
}

// ═════════════════════════════════════════════════════════════════════════════
// 設定
// ═════════════════════════════════════════════════════════════════════════════
function renderSettings() {
  testWorkerConnection();

  const visibleStudents = state.students.filter(s => !s.hidden);
  const sc = visibleStudents.length;
  const dc = state.dateColumns.length;
  const el = document.getElementById('settings-info');
  if (el) el.textContent = `${sc} 位學生 · ${dc} 個日期欄位`;

  // 宿舍參數
  const parsedBeds = Number.parseInt(state.config['total_beds'], 10);
  const totalBeds = Number.isFinite(parsedBeds) ? parsedBeds : visibleStudents.length;
  const bedOffset = parseInt(state.config['bed_offset']) || 0;
  const foreignOffset = parseInt(state.config['foreign_offset']) || 0;
  document.getElementById('cfg-total-beds').value = totalBeds;
  document.getElementById('cfg-bed-offset').value = bedOffset;
  const foreignInput = document.getElementById('cfg-foreign-offset');
  if (foreignInput) foreignInput.value = foreignOffset;

  const geminiInput = document.getElementById('gemini-api-key');
  if (geminiInput) {
    geminiInput.value = localStorage.getItem('gemini_api_key') || '';
  }

  initializeExportDateInputs();
}

function adjustSetting(key, delta) {
  const map = {
    'total_beds': 'cfg-total-beds',
    'bed_offset': 'cfg-bed-offset',
    'foreign_offset': 'cfg-foreign-offset',
  };
  const input = document.getElementById(map[key]);
  if (!input) return;

  const oldVal = parseInt(input.value) || 0;
  const newVal = key === 'total_beds' ? Math.max(0, oldVal + delta) : oldVal + delta;
  if (newVal === oldVal) return;

  const stepper = input.closest('.stepper');
  animateNumber(input, newVal, false, stepper);
}
async function saveDormSettings() {
  const totalBeds = parseInt(document.getElementById('cfg-total-beds').value) || 0;
  const bedOffset = parseInt(document.getElementById('cfg-bed-offset').value) || 0;
  const foreignOffset = parseInt(document.getElementById('cfg-foreign-offset')?.value) || 0;
  if (![totalBeds, bedOffset, foreignOffset].every(Number.isSafeInteger) || totalBeds < 0 || ['cfg-total-beds','cfg-bed-offset','cfg-foreign-offset'].some(id => !/^-?\d+$/.test(document.getElementById(id).value.trim()))) {
    showToast('請輸入有效整數，總床數不可小於 0', 'error'); return;
  }
  try {
    await window._api.setConfig({
      total_beds: String(totalBeds),
      bed_offset: String(bedOffset),
      foreign_offset: String(foreignOffset),
    });
    state.config['total_beds'] = String(totalBeds);
    state.config['bed_offset'] = String(bedOffset);
    state.config['foreign_offset'] = String(foreignOffset);
    showToast('宿舍參數已儲存', 'success');
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  }
}

async function saveRolePIN(roleId, inputId) {
  const input = document.getElementById(inputId);
  const pin = input ? input.value.trim() : '';
  if (!pin) { showToast('請輸入密碼', 'error'); return; }
  if (!/^\d{6}$/.test(pin)) { showToast('密碼必須為 6 位數字', 'error'); return; }
  const key = `pin_${roleId}`;
  try {
    await window._api.setConfig({ [key]: pin });
    state.config[key] = pin;
    input.value = '';
    showToast('密碼已儲存並同步至雲端 <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>', 'success');
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  }
}

async function saveRoleAppearance(roleId) {
  const suffix = roleId === 'vice_president' ? 'vice-president' : roleId;
  const iconEl = document.getElementById(`dev-icon-${suffix}`);
  const labelEl = document.getElementById(`dev-label-${suffix}`);
  const icon = iconEl ? iconEl.value.trim() : '';
  const label = labelEl ? labelEl.value.trim() : '';
  if (!icon && !label) { showToast('請輸入 EMOJI 或名稱', 'error'); return; }
  const updates = {};
  if (icon) updates[`role_icon_${roleId}`] = icon;
  if (label) updates[`role_label_${roleId}`] = label;
  try {
    await window._api.setConfig(updates);
    Object.assign(state.config, updates);
    showToast('外觀已儲存並即時生效 <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>', 'success');
    if (iconEl) iconEl.value = '';
    if (labelEl) labelEl.value = '';
    // 即時重繪首頁讓變化立刻看得到
    if (currentPage === 'home') renderHome();
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 中隊卡片自訂客製化 (中隊長上傳照片)
// 照片會壓成小張的 WebP/JPEG data URL 存進雲端設定 (key: squad_img_<中隊>)，
// 因為 /api/config 每次開 App 都會整包抓回來，所以這裡把每張照片壓在 ~20KB 以內。
// 使用者端預設「關閉」顯示，開了才看得到，避免首頁版面被照片弄亂。
// ═════════════════════════════════════════════════════════════════════════════
const SQ_CUST_KEY_PREFIX = 'squad_img_';
const SQ_CUST_BUDGET = 20000;   // data URL 字串長度上限 (約 14.6KB 圖檔)
const _sqCust = { squad: null, dataUrl: null, changed: false, busy: false };

function squadCustomKey(squadId) { return SQ_CUST_KEY_PREFIX + squadId; }

function openSquadCustomModal(squadId) {
  const squad = squadId || state.currentSquad;
  if (!squad) { showToast('請先選擇中隊', 'error'); return; }
  _sqCust.squad = squad;
  _sqCust.dataUrl = isSafeImageDataUrl(state.config[squadCustomKey(squad)]) ? state.config[squadCustomKey(squad)] : null;
  _sqCust.changed = false;
  const title = document.getElementById('sq-cust-title');
  if (title) title.textContent = '自訂「' + squad + '」卡片';
  const fileEl = document.getElementById('sq-cust-file');
  if (fileEl) fileEl.value = '';
  renderSquadCustomPreview();
  document.getElementById('squad-custom-modal').classList.add('visible');
}

function renderSquadCustomPreview() {
  const box = document.getElementById('sq-cust-preview');
  const meta = document.getElementById('sq-cust-meta');
  const removeBtn = document.getElementById('sq-cust-remove');
  if (!box) return;
  const sq = (window.CONFIG.SQUADS || []).find(x => x.id === _sqCust.squad);
  const color = sq ? sq.color : 'var(--indigo)';
  const floorLabel = sq ? sq.floor + '樓' : '';
  if (_sqCust.dataUrl) {
    box.classList.add('has-img');
    box.style.setProperty('--sq-c', color);
    box.innerHTML = '<img class="sq-photo-img" src="' + _sqCust.dataUrl + '" alt="預覽">' +
      '<div class="sq-photo-pill"><span class="sq-photo-dot"></span>' + _sqCust.squad +
      '<span class="sq-photo-sub">' + floorLabel + '</span></div>';
    if (meta) {
      const kb = Math.round(_sqCust.dataUrl.length * 0.75 / 1024 * 10) / 10;
      meta.textContent = _sqCust.changed ? ('新照片已壓縮為約 ' + kb + ' KB，按「儲存並同步」才會上傳') : ('目前照片約 ' + kb + ' KB');
    }
    if (removeBtn) removeBtn.style.display = state.config[squadCustomKey(_sqCust.squad)] ? 'block' : 'none';
  } else {
    box.classList.remove('has-img');
    box.innerHTML = '<span class="sq-cust-empty">還沒有照片<br>會用預設的中隊方塊</span>';
    if (meta) meta.textContent = '';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

// 把照片縮小並壓到預算內。square=true 置中裁成正方形 (中隊卡片)；false 保留原比例 (背景)。
function compressImage(file, { square, sides, budget }) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('這個檔案不是有效的圖片'));
      img.onload = () => {
        try {
          const qualities = [0.82, 0.7, 0.58, 0.46, 0.34];
          const types = ['image/webp', 'image/jpeg'];
          const iw = img.naturalWidth, ih = img.naturalHeight;
          let best = null;
          for (const side of sides) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (square) {
              canvas.width = side; canvas.height = side;
              const crop = Math.min(iw, ih);
              ctx.drawImage(img, (iw - crop) / 2, (ih - crop) / 2, crop, crop, 0, 0, side, side);
            } else {
              const k = Math.min(1, side / Math.max(iw, ih));
              canvas.width = Math.max(1, Math.round(iw * k));
              canvas.height = Math.max(1, Math.round(ih * k));
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }
            for (const type of types) {
              for (const q of qualities) {
                const url = canvas.toDataURL(type, q);
                // 瀏覽器不支援 WebP 時會退回 PNG，這種就跳過換下一個格式
                if (!url.startsWith('data:' + type)) break;
                if (!best || url.length < best.length) best = url;
                if (url.length <= budget) return resolve(url);
              }
            }
          }
          if (best) return resolve(best);
          reject(new Error('圖片壓縮失敗'));
        } catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function compressSquadPhoto(file) {
  return compressImage(file, { square: true, sides: [320, 256, 192, 144], budget: SQ_CUST_BUDGET });
}

async function onSquadCustomFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast('請選擇圖片檔', 'error'); input.value = ''; return; }
  const meta = document.getElementById('sq-cust-meta');
  if (meta) meta.textContent = '正在壓縮照片…';
  try {
    const url = await compressSquadPhoto(file);
    _sqCust.dataUrl = url;
    _sqCust.changed = true;
    renderSquadCustomPreview();
    haptic('light');
  } catch (err) {
    showToast('照片處理失敗：' + err.message, 'error');
    if (meta) meta.textContent = '';
  } finally {
    input.value = '';
  }
}

async function saveSquadCustom() {
  if (_sqCust.busy) return;
  if (state.viewSemester) { showToast('正在查看封存學期，不能修改', 'error'); return; }
  const squad = _sqCust.squad;
  if (!squad) return;
  if (!_sqCust.dataUrl) { showToast('請先選一張照片', 'error'); return; }
  if (!_sqCust.changed) { showToast('照片沒有變更', 'info'); return; }
  const btn = document.getElementById('sq-cust-save');
  _sqCust.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = '上傳中…'; }
  const key = squadCustomKey(squad);
  try {
    await window._api.setConfig({ [key]: _sqCust.dataUrl });
    state.config[key] = _sqCust.dataUrl;
    _sqCust.changed = false;
    closeModal('squad-custom-modal');
    if (squadCustomOn()) {
      showToast('卡片照片已同步至雲端', 'success');
    } else {
      showToast('已同步，但你的「顯示自訂客製化」是關閉的，所以首頁看不到', 'info');
    }
    if (currentPage === 'home') renderHome();
    if (currentPage === 'customize') renderCustomizePage();
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  } finally {
    _sqCust.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = '儲存並同步'; }
  }
}

async function removeSquadCustom() {
  if (_sqCust.busy) return;
  if (state.viewSemester) { showToast('正在查看封存學期，不能修改', 'error'); return; }
  const squad = _sqCust.squad;
  if (!squad) return;
  if (!confirm('要移除「' + squad + '」的卡片照片，恢復預設樣式嗎？')) return;
  const key = squadCustomKey(squad);
  _sqCust.busy = true;
  try {
    await window._api.setConfig({ [key]: '' });
    state.config[key] = '';
    _sqCust.dataUrl = null;
    _sqCust.changed = false;
    renderSquadCustomPreview();
    closeModal('squad-custom-modal');
    showToast('已恢復預設卡片樣式', 'success');
    if (currentPage === 'home') renderHome();
    if (currentPage === 'customize') renderCustomizePage();
  } catch (err) {
    showToast('移除失敗：' + err.message, 'error');
  } finally {
    _sqCust.busy = false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 客製化選單 (設定 → 顯示自訂客製化 → 客製化選單)
// 首頁背景：key custom_bg_img / custom_bg_opacity
// 中隊卡片：沿用上面的 squad_img_<中隊>
// 全部存雲端設定，所有人下次開 App 就會拿到；看不看得到由各自的開關決定。
// ═════════════════════════════════════════════════════════════════════════════
const CUST_BG_KEY = 'custom_bg_img';
const CUST_BG_OPACITY_KEY = 'custom_bg_opacity';
const CUST_BG_BUDGET = 90000;   // data URL 字串上限 (約 66KB)：背景要全螢幕，但也不能拖慢開 App
const _custBg = { dataUrl: null, opacity: 0.35, imgChanged: false, opChanged: false, busy: false };

function clampBgOpacity(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0.1, n)) : 0.35;
}

// 有自訂背景就畫出來並回傳 true；沒有 (或開關關著) 回傳 false，讓原本的背景影片接手
function applyCustomBackground() {
  const raw = squadCustomOn() ? state.config[CUST_BG_KEY] : '';
  if (!isSafeImageDataUrl(raw)) return false;
  const container = document.getElementById('custom-video-bg');
  if (!container) return false;
  const op = clampBgOpacity(state.config[CUST_BG_OPACITY_KEY]);
  container.innerHTML = '<img class="custom-bg-img" alt="" style="--target-opacity:' + op + '">';
  container.querySelector('img').src = raw;
  const animBg = document.querySelector('.home-anim-bg');
  if (animBg) animBg.style.display = 'none';
  return true;
}

function renderCustomizePage() {
  if (!_custBg.imgChanged) {
    const saved = state.config[CUST_BG_KEY];
    _custBg.dataUrl = isSafeImageDataUrl(saved) ? saved : null;
  }
  if (!_custBg.opChanged) _custBg.opacity = clampBgOpacity(state.config[CUST_BG_OPACITY_KEY]);
  renderCustomBgPreview();

  const grid = document.getElementById('cust-squad-grid');
  if (!grid) return;
  grid.innerHTML = CONFIG.SQUADS.map(sq => {
    const onclick = ' onclick="editSquadCard(\'' + sq.id + '\')"';
    if (isSafeImageDataUrl(state.config[squadCustomKey(sq.id)])) {
      return '<div class="sq-card sq-photo" data-squad="' + sq.id + '" style="--sq-c:' + sq.color + '"' + onclick + '>' +
        '<img class="sq-photo-img" alt="' + sq.id + ' 目前照片">' +
        '<div class="sq-photo-pill"><span class="sq-photo-dot"></span>' + sq.id + '</div></div>';
    }
    return '<div class="sq-card" style="--sq-c:' + sq.color + '"' + onclick + '>' +
      '<div class="sq-badge" style="background:' + sq.color + '">' + sq.floor + '</div>' +
      '<div class="sq-name">' + sq.id + '</div><div class="sq-desc">點我換照片</div></div>';
  }).join('');
  // data URL 很長，用屬性設定比塞進 HTML 字串安全
  grid.querySelectorAll('.sq-photo[data-squad]').forEach(card => {
    card.querySelector('img').src = state.config[squadCustomKey(card.dataset.squad)];
  });
}

function renderCustomBgPreview() {
  const box = document.getElementById('cust-bg-preview');
  const meta = document.getElementById('cust-bg-meta');
  const range = document.getElementById('cust-bg-opacity');
  const val = document.getElementById('cust-bg-opacity-val');
  const removeBtn = document.getElementById('cust-bg-remove');
  if (!box) return;
  if (range) range.value = _custBg.opacity;
  if (val) val.textContent = Math.round(_custBg.opacity * 100) + '%';
  if (_custBg.dataUrl) {
    box.innerHTML = '<img alt="背景預覽">';
    const img = box.querySelector('img');
    img.src = _custBg.dataUrl;
    img.style.opacity = _custBg.opacity;
    if (meta) {
      const kb = Math.round(_custBg.dataUrl.length * 0.75 / 1024 * 10) / 10;
      meta.textContent = (_custBg.imgChanged || _custBg.opChanged)
        ? ('約 ' + kb + ' KB，按「儲存並同步」才會套用給所有人')
        : ('目前背景約 ' + kb + ' KB');
    }
  } else {
    box.innerHTML = '<span class="sq-cust-empty">還沒有自訂背景<br>使用預設背景</span>';
    if (meta) meta.textContent = '';
  }
  if (removeBtn) removeBtn.style.display = isSafeImageDataUrl(state.config[CUST_BG_KEY]) ? 'block' : 'none';
}

function onCustomBgOpacity(v) {
  _custBg.opacity = clampBgOpacity(v);
  _custBg.opChanged = _custBg.opacity !== clampBgOpacity(state.config[CUST_BG_OPACITY_KEY]);
  renderCustomBgPreview();
}

async function onCustomBgFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast('請選擇圖片檔', 'error'); input.value = ''; return; }
  const meta = document.getElementById('cust-bg-meta');
  if (meta) meta.textContent = '正在壓縮照片…';
  try {
    _custBg.dataUrl = await compressImage(file, { square: false, sides: [1280, 1080, 900, 720, 540], budget: CUST_BG_BUDGET });
    _custBg.imgChanged = true;
    renderCustomBgPreview();
    haptic('light');
  } catch (err) {
    showToast('照片處理失敗：' + err.message, 'error');
    if (meta) meta.textContent = '';
  } finally {
    input.value = '';
  }
}

function saveCustomBg() {
  if (_custBg.busy) return;
  if (state.viewSemester) { showToast('正在查看封存學期，不能修改', 'error'); return; }
  if (!_custBg.dataUrl) { showToast('請先選一張照片', 'error'); return; }
  if (!_custBg.imgChanged && !_custBg.opChanged) { showToast('沒有變更', 'info'); return; }
  doSaveCustomBg();
}

async function doSaveCustomBg() {
  const updates = {};
  if (_custBg.imgChanged) updates[CUST_BG_KEY] = _custBg.dataUrl;
  updates[CUST_BG_OPACITY_KEY] = String(_custBg.opacity);
  const btn = document.getElementById('cust-bg-save');
  _custBg.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = '上傳中…'; }
  try {
    await window._api.setConfig(updates);
    Object.assign(state.config, updates);
    _custBg.imgChanged = false;
    _custBg.opChanged = false;
    loadGlobalBgVideo();
    renderCustomBgPreview();
    showToast('背景已同步，所有人下次打開 App 就會看到', 'success');
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  } finally {
    _custBg.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = '儲存並同步'; }
  }
}

async function removeCustomBg() {
  if (_custBg.busy) return;
  if (state.viewSemester) { showToast('正在查看封存學期，不能修改', 'error'); return; }
  if (!confirm('要移除自訂背景，恢復預設嗎？所有人都會一起恢復。')) return;
  _custBg.busy = true;
  try {
    await window._api.setConfig({ [CUST_BG_KEY]: '' });
    state.config[CUST_BG_KEY] = '';
    _custBg.dataUrl = null;
    _custBg.imgChanged = false;
    loadGlobalBgVideo();
    renderCustomBgPreview();
    showToast('已恢復預設背景', 'success');
  } catch (err) {
    showToast('移除失敗：' + err.message, 'error');
  } finally {
    _custBg.busy = false;
  }
}

function editSquadCard(squadId) {
  openSquadCustomModal(squadId);
}

async function testWorkerConnection() {
  return refreshSystemHealth();
}

// ═════════════════════════════════════════════════════════════════════════════
// 系統穩定度（設定頁「系統狀態」→ 點進去看全部檢測項目）
// ═════════════════════════════════════════════════════════════════════════════
const HEALTH_RANK = { ok: 0, na: 1, warn: 2, bad: 3 };
const HEALTH_WORD = { ok: '正常', warn: '注意', bad: '異常', na: '無法偵測' };
const healthUI = { report: null, running: false, pending: null, liveTimer: null, open: false };

function measureFps(ms = 600) {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'function' || document.hidden) return resolve(null);
    let frames = 0, done = false;
    const t0 = performance.now();
    const finish = v => { if (!done) { done = true; clearTimeout(guard); resolve(v); } };
    // 分頁被切到背景時瀏覽器會停掉 requestAnimationFrame，沒有保險就會永遠卡住
    const guard = setTimeout(() => finish(null), ms + 1200);
    const tick = () => {
      if (done) return;
      frames++;
      const dt = performance.now() - t0;
      if (dt >= ms) finish(Math.round(frames * 1000 / dt));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function healthEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

async function collectSystemHealth() {
  const items = [];
  const add = o => items.push(o);

  // ── 連線 ──
  const online = navigator.onLine !== false;
  const netInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const slow = ['slow-2g', '2g'].includes(netInfo && netInfo.effectiveType);
  let netValue = online ? '已連上網路' : '目前離線';
  if (online && netInfo && netInfo.effectiveType) {
    const q = { 'slow-2g': '很慢', '2g': '慢', '3g': '普通', '4g': '良好' }[netInfo.effectiveType] || netInfo.effectiveType;
    netValue = `已連上網路 · 訊號${q}`;
    if (netInfo.downlink) netValue += `（約 ${netInfo.downlink} Mbps）`;
  }
  add({
    group: '連線', label: '網路', value: netValue,
    status: online ? (slow ? 'warn' : 'ok') : 'bad',
    hint: online ? (slow ? '網路很慢，同步可能要等比較久' : '這台裝置本身的上網狀況') : '這台裝置沒有網路，所有同步都會失敗'
  });

  let pingMs = null, pingErr = null;
  const t0 = performance.now();
  try {
    await window._api.ping();
    pingMs = Math.round(performance.now() - t0);
  } catch (err) {
    pingErr = (err && err.message) ? err.message : String(err);
  }
  add({
    group: '連線', label: '雲端主機（Worker）',
    value: pingErr ? '連不上' : `正常 · 回應 ${pingMs} 毫秒`,
    status: pingErr ? 'bad' : (pingMs > 2000 ? 'warn' : 'ok'),
    hint: pingErr ? `錯誤訊息：${pingErr}` : (pingMs > 2000 ? '主機回得慢，點名送出會卡一下' : '存放全部點名資料的後端主機')
  });

  // ── 資料 ──
  const visible = (state.students || []).filter(s => !s.hidden);
  add({
    group: '資料', label: '住宿生名單',
    value: visible.length ? `${visible.length} 位學生 · ${(state.dateColumns || []).length} 個日期欄位` : '一位學生都沒讀到',
    status: visible.length ? ((state.dateColumns || []).length ? 'ok' : 'warn') : 'bad',
    hint: visible.length
      ? ((state.dateColumns || []).length ? '名單與點名表都有抓到' : '名單有了，但點名表還沒有任何日期欄位')
      : '名單是空的，通常是連線失敗或學期選錯'
  });

  let pendingCount = 0;
  for (const iso of Object.keys(state.pendingByDate || {})) {
    pendingCount += Object.keys(state.pendingByDate[iso] || {}).length;
  }
  add({
    group: '資料', label: '暫存在這台裝置的點名',
    value: pendingCount ? `${pendingCount} 筆還沒寫回雲端` : '沒有待同步資料',
    status: pendingCount ? 'warn' : 'ok',
    hint: pendingCount ? '後端還沒有那天的欄位，資料先存在這台裝置，等欄位開好會自動補上' : '所有點名都已經進到雲端'
  });

  const changeCount = (state.changes || []).length;
  add({
    group: '資料', label: '未送出的變更',
    value: changeCount ? `${changeCount} 筆改了還沒按提交` : '沒有未送出的變更',
    status: changeCount ? 'warn' : 'ok',
    hint: changeCount ? '現在關掉頁面這些會不見，記得回點名頁按提交' : '畫面上的修改都已經送出'
  });

  const semName = (state.semester && state.semester.current && state.semester.current.name) || '';
  add({
    group: '資料', label: '目前學期',
    value: state.viewSemester ? `唯讀：封存學期 ${state.viewSemester}` : (semName || '本學期（未命名）'),
    status: state.viewSemester ? 'warn' : 'ok',
    hint: state.viewSemester ? '正在看舊學期，所有寫入動作都會被擋下來' : '正在使用本學期的資料，可以正常點名'
  });

  // ── 快取與儲存 ──
  let swValue = '這個瀏覽器不支援', swStatus = 'na', swHint = '離線快取功能無法使用';
  if ('serviceWorker' in navigator) {
    try {
      const scope = new URL('./', location.href).href;
      const regs = await navigator.serviceWorker.getRegistrations();
      const reg = regs.find(r => r.scope === scope);
      const names = ('caches' in window) ? await caches.keys() : [];
      const ver = names.filter(n => n.startsWith('biyuan-')).sort().pop();
      if (!reg) {
        swValue = '沒有安裝'; swStatus = 'warn';
        swHint = '離線時打不開系統，重新整理一次通常就會裝回來';
      } else if (reg.waiting) {
        swValue = `有新版本等待套用${ver ? ` · 目前 ${ver}` : ''}`; swStatus = 'warn';
        swHint = '關掉所有分頁重開，或按下面的強制清除快取，就會換到新版';
      } else {
        swValue = `運作中${ver ? ` · ${ver}` : ''}`; swStatus = 'ok';
        swHint = '離線也能打開系統，畫面檔案存在本機';
      }
    } catch (err) {
      swValue = '查不到'; swStatus = 'na';
      swHint = (err && err.message) ? err.message : '瀏覽器拒絕讀取快取狀態';
    }
  }
  add({ group: '快取與儲存', label: '離線快取', value: swValue, status: swStatus, hint: swHint });

  let stValue = '無法偵測', stStatus = 'na', stHint = '這個瀏覽器不給看儲存空間';
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (Number.isFinite(est.usage) && Number.isFinite(est.quota) && est.quota > 0) {
        const pct = Math.round(est.usage / est.quota * 100);
        stValue = `已用 ${formatBytes(est.usage)} / ${formatBytes(est.quota)}（${pct}%）`;
        stStatus = pct >= 90 ? 'bad' : (pct >= 75 ? 'warn' : 'ok');
        stHint = pct >= 75 ? '空間快滿了，瀏覽器可能會自己清掉快取' : '這個系統在裝置上佔的空間';
      }
    } catch (_) { /* 保持無法偵測 */ }
  }
  add({ group: '快取與儲存', label: '裝置儲存空間', value: stValue, status: stStatus, hint: stHint });

  // ── 效能 ──
  const fps = await measureFps();
  add({
    group: '效能', label: '畫面流暢度',
    value: fps == null ? '無法偵測' : `${fps} FPS`,
    // 流暢度只算「注意」不算異常：畫面頓不影響資料正確性，不該讓整體亮紅燈
    status: fps == null ? 'na' : (fps >= 50 ? 'ok' : 'warn'),
    hint: fps == null ? '瀏覽器沒給量測' : (fps >= 50 ? '滑動很順' : '會頓，可以開「省電順暢模式」把特效關掉')
  });

  const mem = performance.memory;
  add({
    group: '效能', label: '記憶體用量',
    value: mem ? `${formatBytes(mem.usedJSHeapSize)} / 上限 ${formatBytes(mem.jsHeapSizeLimit)}` : '無法偵測（非 Chrome 核心）',
    status: mem ? (mem.usedJSHeapSize / mem.jsHeapSizeLimit > 0.8 ? 'warn' : 'ok') : 'na',
    hint: mem ? '超過八成瀏覽器可能會把分頁砍掉重載' : 'Safari／Firefox 不提供這個數字'
  });

  const navEntry = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
  const boot = navEntry && navEntry.duration ? Math.round(navEntry.duration) : null;
  add({
    group: '效能', label: '這次開啟耗時',
    value: boot == null ? '無法偵測' : `${boot} 毫秒`,
    status: boot == null ? 'na' : (boot <= 3000 ? 'ok' : (boot <= 6000 ? 'warn' : 'bad')),
    hint: boot == null ? '瀏覽器沒給量測' : '從按下開啟到畫面能用的時間'
  });

  const ps = localStorage.getItem('power_save_mode') === 'true';
  add({
    group: '效能', label: '省電順暢模式',
    value: ps ? '已開啟（特效全關）' : '關閉（完整特效）',
    status: 'ok',
    hint: ps ? '畫面比較樸素但最順' : '如果會頓，可以到上面的顯示設定把它打開'
  });

  // ── 總結 ──
  let score = 0, counted = 0, worst = 'ok';
  for (const it of items) {
    if (it.status === 'na') continue;
    counted++;
    score += it.status === 'ok' ? 1 : (it.status === 'warn' ? 0.5 : 0);
    if (HEALTH_RANK[it.status] > HEALTH_RANK[worst]) worst = it.status;
  }
  const percent = counted ? Math.round(score / counted * 100) : 100;
  const bad = items.filter(i => i.status === 'bad');
  const warn = items.filter(i => i.status === 'warn');
  let summary;
  if (bad.length) summary = `${bad.length} 項異常：${bad.map(i => i.label).join('、')}`;
  else if (warn.length) summary = `${warn.length} 項要注意：${warn.map(i => i.label).join('、')}`;
  else summary = '全部檢測項目都正常';

  return { items, overall: worst, percent, summary, checkedAt: new Date(), badCount: bad.length, warnCount: warn.length };
}

function renderHealthEntry(report) {
  const entry = document.getElementById('health-entry');
  if (!entry) return;
  const dot = document.getElementById('health-entry-dot');
  const title = document.getElementById('health-entry-title');
  const sub = document.getElementById('health-entry-sub');
  if (!report) {
    entry.dataset.status = 'loading';
    if (dot) dot.dataset.status = 'loading';
    if (title) title.textContent = '檢查中…';
    if (sub) sub.textContent = '正在讀取系統狀態';
    return;
  }
  const head = { ok: '系統一切正常', warn: '系統可用，有幾項要注意', bad: '系統有異常', na: '系統狀態' }[report.overall];
  entry.dataset.status = report.overall;
  if (dot) dot.dataset.status = report.overall;
  if (title) title.textContent = `${head} · 穩定度 ${report.percent}%`;
  if (sub) sub.textContent = report.summary;
}

function renderHealthModal(report) {
  const listEl = document.getElementById('health-list');
  if (!listEl) return;
  const ringEl = document.getElementById('health-ring');
  const pctEl = document.getElementById('health-percent');
  const titleEl = document.getElementById('health-overall-title');
  const subEl = document.getElementById('health-overall-sub');

  if (!report) {
    listEl.innerHTML = '<div class="health-empty">檢測中…</div>';
    if (pctEl) pctEl.textContent = '—';
    if (titleEl) titleEl.textContent = '檢測中…';
    if (subEl) subEl.textContent = '正在逐項檢查';
    if (ringEl) { ringEl.dataset.status = 'loading'; ringEl.style.setProperty('--pct', '0'); }
    return;
  }

  if (ringEl) { ringEl.dataset.status = report.overall; ringEl.style.setProperty('--pct', String(report.percent)); }
  if (pctEl) pctEl.textContent = `${report.percent}%`;
  if (titleEl) titleEl.textContent = { ok: '一切正常', warn: '可以用，但要注意', bad: '有異常要處理', na: '系統狀態' }[report.overall];
  if (subEl) {
    const t = report.checkedAt;
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    subEl.textContent = `${report.summary} · 檢測於 ${hh}:${mm}:${ss}`;
  }

  const groups = [];
  for (const it of report.items) {
    let g = groups.find(x => x.name === it.group);
    if (!g) { g = { name: it.group, rows: [] }; groups.push(g); }
    g.rows.push(it);
  }
  listEl.innerHTML = groups.map(g => `
    <div class="health-group">
      <div class="health-group-title">${g.name}</div>
      ${g.rows.map(r => `
        <div class="health-row" data-status="${r.status}">
          <span class="health-row-dot" data-status="${r.status}"></span>
          <div class="health-row-main">
            <div class="health-row-top">
              <span class="health-row-label">${healthEsc(r.label)}</span>
              <span class="health-row-tag" data-status="${r.status}">${HEALTH_WORD[r.status]}</span>
            </div>
            <div class="health-row-value">${healthEsc(r.value)}</div>
            <div class="health-row-hint">${healthEsc(r.hint)}</div>
          </div>
        </div>`).join('')}
    </div>`).join('');
}

async function refreshSystemHealth() {
  // 同時被呼叫時共用同一次檢測，不要回傳還沒填好的舊結果
  if (healthUI.running) return healthUI.pending;
  healthUI.running = true;
  let settle;
  healthUI.pending = new Promise(r => { settle = r; });
  const btn = document.getElementById('health-recheck');
  if (btn) { btn.disabled = true; btn.textContent = '檢測中…'; }
  if (!healthUI.report) { renderHealthEntry(null); if (healthUI.open) renderHealthModal(null); }
  try {
    const report = await collectSystemHealth();
    healthUI.report = report;
    renderHealthEntry(report);
    if (healthUI.open) renderHealthModal(report);
    return report;
  } finally {
    healthUI.running = false;
    settle(healthUI.report);
    healthUI.pending = null;
    if (btn) { btn.disabled = false; btn.textContent = '重新檢測'; }
  }
}

function openHealthModal() {
  const m = document.getElementById('health-modal');
  if (!m) return;
  healthUI.open = true;
  renderHealthModal(healthUI.report);
  m.classList.add('visible');
  refreshSystemHealth();
  clearInterval(healthUI.liveTimer);
  healthUI.liveTimer = setInterval(() => { if (healthUI.open) refreshSystemHealth(); }, 15000);
}

function closeHealthModal() {
  const m = document.getElementById('health-modal');
  if (m) m.classList.remove('visible');
  healthUI.open = false;
  clearInterval(healthUI.liveTimer);
  healthUI.liveTimer = null;
}

window.addEventListener('online', () => { if (document.getElementById('health-entry')) refreshSystemHealth(); });
window.addEventListener('offline', () => { if (document.getElementById('health-entry')) refreshSystemHealth(); });

async function saveGlobalPinAuth() {
  const isEnabled = document.getElementById('dev-global-pin-auth').checked;
  showLoading(true);
  try {
    const val = isEnabled ? 'true' : 'false';
    await window._api.setConfig({ 'global_pin_auth': val });
    state.config['global_pin_auth'] = val;
    showToast('已更新全域密碼設定，將套用於所有裝置', 'success');
  } catch (err) {
    document.getElementById('dev-global-pin-auth').checked = state.config['global_pin_auth'] !== 'false';
    showToast('設定失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── PIN ────────────────────────────────────────────────────────────────────
let pinCallback = null, pinSquadId = null;

function setupPinDialog() {
  document.getElementById('pin-cancel').onclick = () => { document.getElementById('pin-dialog').classList.remove('visible'); pinCallback = null; };
  document.getElementById('pin-confirm').onclick = () => {
    const input = document.getElementById('pin-input');
    const pin = input.value;
    const expected = state.config[`pin_${pinSquadId}`];
    if (pin === expected || pin === state.config['pin_admin']) {
      document.getElementById('pin-dialog').classList.remove('visible');
      input.value = ''; if (pinCallback) pinCallback();
    } else { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 500); showToast('PIN 碼錯誤', 'error'); }
  };
  document.getElementById('pin-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('pin-confirm').click(); });
}

function showPinDialog(squadId, callback, customTitle) {
  if (state.config['global_pin_auth'] === 'false') {
    if (callback) callback();
    return;
  }
  pinSquadId = squadId; pinCallback = callback;
  document.getElementById('pin-dialog-title').textContent = customTitle || `${squadId} 中隊點名`;
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-dialog').classList.add('visible');
  setTimeout(() => document.getElementById('pin-input').focus(), 100);
}

// ─── 數據校準與本地狀態整合 ───────────────────────────────────────────
/**
 * 將從伺服器抓回來的 Roster 與本地尚未同步(changes)或剛同步(recentSyncs)的狀態合併
 * 防止背景輪詢因為 eventual consistency 導致 UI 閃爍
 */
// 所有成功送出的點名/請假 (任何日期、任何入口) 都記下來。
// Notion 寫入後幾秒內查詢可能還是舊值，背景刷新會把剛按的請假洗掉，看起來像「沒按到」。
const RECENT_SYNC_MS = 60000;
function rememberRecentSyncs(updates) {
  const now = Date.now();
  for (const u of updates || []) {
    if (!u || !u.pageId) continue;
    if (u.date) state.recentSyncs[u.pageId + '_' + u.date] = { value: u.value || '', ts: now };
    if (u.dates && typeof u.dates === 'object') {
      for (const [date, value] of Object.entries(u.dates)) state.recentSyncs[u.pageId + '_' + date] = { value: value || '', ts: now };
    }
  }
}

function applyLocalStateToRoster(rosterStudents, rosterDateColumns) {
  if (!Array.isArray(rosterStudents)) return [];
  const now = Date.now();

  // 清理過期的 recentSyncs
  Object.keys(state.recentSyncs).forEach(key => {
    if (now - state.recentSyncs[key].ts > RECENT_SYNC_MS) delete state.recentSyncs[key];
  });
  // 剛送出的值蓋回伺服器資料 (所有日期)；伺服器已經讀得到同樣的值就不用再保護
  const byId = new Map();
  for (const s of rosterStudents) if (s && s.id) byId.set(s.id, s);
  Object.keys(state.recentSyncs).forEach(key => {
    const cut = key.lastIndexOf('_');
    const student = byId.get(key.slice(0, cut));
    if (!student) return;
    const date = key.slice(cut + 1);
    if (!student.attendance || typeof student.attendance !== 'object') student.attendance = {};
    const want = state.recentSyncs[key].value || '';
    if ((student.attendance[date] || '') === want) { delete state.recentSyncs[key]; return; }
    if (want) student.attendance[date] = want; else delete student.attendance[date];
  });

  const merged = rosterStudents.filter(s => s && typeof s === 'object').map(s => {
    // 資料庫偶爾會出現「未勾空床，但姓名欄完全沒資料」的殘缺床位。
    // 前端統一以姓名為住宿生的最低條件，避免這類資料可被點名或算入人數。
    s.name = String(s.name == null ? '' : s.name).trim();
    s.isEmpty = !!s.isEmpty || !s.name;
    if (!s.attendance || typeof s.attendance !== 'object') s.attendance = {};

    // 1. 優先處理正在等待同步的變更 (Pending Changes)
    const pending = state.changes.find(c => c.pageId === s.id && c.date === state.currentDate);
    if (pending) {
      s.attendance[state.currentDate] = pending.value;
      return s;
    }

    // 2. 處理剛同步成功但在伺服器可能尚未穩定的變更 (Recent Syncs)
    const syncKey = s.id + '_' + state.currentDate;
    const recent = state.recentSyncs[syncKey];
    if (recent) {
      s.attendance[state.currentDate] = recent.value;
      return s;
    }

    return s;
  });
  applyPendingAttendance(merged, Array.isArray(rosterDateColumns) ? rosterDateColumns : state.dateColumns);
  return merged;
}

// ─── 後端缺日期欄位時的本機暫存 ───────────────────────────────────────────
// Notion 點名總表只有建檔時那個學期的日期欄位；沒有欄位的日期，後端不會保存任何變更。
// 這裡把這些變更留在本機 (localStorage)，每次背景刷新都重新蓋回去，等欄位出現後自動補送。
const PENDING_ATT_KEY = 'biyuan_pending_attendance';
let _pendingReplayBusy = false;

function loadPendingAttendance() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_ATT_KEY) || '{}');
    state.pendingByDate = raw && typeof raw === 'object' ? raw : {};
  } catch (_) { state.pendingByDate = {}; }
}

function savePendingAttendance() {
  try { localStorage.setItem(PENDING_ATT_KEY, JSON.stringify(state.pendingByDate)); } catch (_) {}
}

function pendingDateKey(dateKey) {
  return dateColumnToISO(dateKey) || String(dateKey || '');
}

// 後端是否已有這個日期的欄位 (接受 ISO 或 "X月Y日")
function serverHasDateColumn(dateKey) {
  const iso = pendingDateKey(dateKey);
  return getExportColumnEntries().some(entry => entry.iso === iso);
}

function recordPendingAttendance(pageId, dateKey, value) {
  const iso = pendingDateKey(dateKey);
  if (!iso || !pageId) return;
  if (!state.pendingByDate[iso]) state.pendingByDate[iso] = {};
  state.pendingByDate[iso][pageId] = value;
  savePendingAttendance();
}

function pendingAttendanceCount(dateKey) {
  const bucket = state.pendingByDate[pendingDateKey(dateKey)];
  return bucket ? Object.keys(bucket).length : 0;
}

function applyPendingAttendance(students, columns) {
  // 用「這次伺服器回傳」的欄位判斷，因為呼叫時 state.dateColumns 還是舊的
  const byISO = new Map();
  for (const column of columns || []) { const iso = dateColumnToISO(column); if (iso && !byISO.has(iso)) byISO.set(iso, column); }
  const replay = [];
  for (const iso of Object.keys(state.pendingByDate)) {
    const bucket = state.pendingByDate[iso];
    if (!bucket || typeof bucket !== 'object') { delete state.pendingByDate[iso]; continue; }
    const column = byISO.get(iso) || iso;
    for (const pageId of Object.keys(bucket)) {
      const student = students.find(st => st.id === pageId);
      if (!student) continue;
      if (!student.attendance) student.attendance = {};
      student.attendance[column] = bucket[pageId];
      if (byISO.has(iso)) replay.push({ pageId, date: column, value: bucket[pageId], iso });
    }
  }
  if (replay.length) replayPendingAttendance(replay);
}

async function replayPendingAttendance(replay) {
  if (_pendingReplayBusy) return;
  _pendingReplayBusy = true;
  try {
    for (let i = 0; i < replay.length; i += 45) {
      const sent = replay.slice(i, i + 45);
      await window._api.updateAttendance(sent.map(({ pageId, date, value }) => ({ pageId, date, value })));
      for (const item of sent) {
        const bucket = state.pendingByDate[item.iso];
        if (bucket && bucket[item.pageId] === item.value) delete bucket[item.pageId];
        if (bucket && !Object.keys(bucket).length) delete state.pendingByDate[item.iso];
        state.recentSyncs[item.pageId + '_' + item.date] = { value: item.value, ts: Date.now() };
      }
      savePendingAttendance();
    }
    showToast(`後端已建立日期欄位，補送了 ${replay.length} 筆暫存點名`, 'success');
  } catch (e) {
    console.warn('補送暫存點名失敗', e);
  } finally { _pendingReplayBusy = false; }
}

// ─── 老虎機數字捲動動畫 ───────────────────────────────────────────
function animateNumber(el, newValue, skipAnimation = false, customContainer = null) {
  if (!el) return;

  const previous = el._numberAnimation;
  if (previous) previous.cancel();
  const run = {cancel: () => {}};
  el._numberAnimation = run;
  const isInput = (el.tagName === 'INPUT');
  const getVal = () => isInput ? el.value : el.textContent;
  const setVal = (v) => { if (isInput) el.value = v; else el.textContent = v; };

  const oldValStr = getVal() || '0';
  const oldVal = parseInt(oldValStr) || 0;
  const container = customContainer || el.parentElement;

  // 1. 快速跳過檢查
  if (skipAnimation || window.sfReduceMotion() || (oldVal === newValue && container?.querySelector(`.stepper-anim-box[data-target-id="${el.id}"]`))) {
    setVal(newValue);
    el.style.transition = '';
    el.classList.remove('number-anim-hiding');
    if (container) {
      container.querySelectorAll(`.stepper-anim-box[data-target-id="${el.id}"]`).forEach(b => b.remove());
    }
    delete el._numberAnimation;
    return;
  }
  if (oldVal === newValue && getVal() !== '') { delete el._numberAnimation; return; }

  const delta = newValue - oldVal;
  const style = window.getComputedStyle(el);

  // 2. 核心原子化測量：在改變任何狀態前先抓取「絕對舊座標」
  const oldRect = el.getBoundingClientRect();
  const oldH = oldRect.height;

  // 3. 準備測量器 (提前建立避免在中途插入 DOM 導致多次重排)
  const measurer = document.createElement('span');
  measurer.style.cssText = `position:absolute;visibility:hidden;white-space:pre;pointer-events:none;font-family:${style.fontFamily};font-size:${style.fontSize};font-weight:${style.fontWeight};font-variant-numeric:${style.fontVariantNumeric};letter-spacing:${style.letterSpacing};`;
  document.body.appendChild(measurer);

  const getW = (ch) => {
    if (ch === ' ' || ch === '' || ch === undefined) return 0;
    measurer.textContent = ch;
    return measurer.getBoundingClientRect().width;
  };

  const oldW = getW(oldValStr);
  const newW = getW(String(newValue));
  const maxW = Math.max(oldW, newW) + 4;

  let color = style.color;
  if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent' || el.classList.contains('number-anim-hiding')) {
    color = el.dataset.origColor || window.getComputedStyle(container).color;
  }
  if (!el.dataset.origColor && style.color !== 'rgba(0, 0, 0, 0)' && style.color !== 'transparent' && !el.classList.contains('number-anim-hiding')) {
    el.dataset.origColor = style.color;
  }

  // 4. 執行狀態切換：隱藏舊文字，設定新數值以更新佈局
  el.style.transition = 'none';
  el.classList.add('number-anim-hiding');
  setVal(newValue);
  void el.offsetWidth; // 強制重排，讓新數值撐開佈局

  // 5. 抓取「新座標」與「新容器座標」
  const newRect = el.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  const h = newRect.height || oldH;

  // 重要：計算 startLeft 時，必須使用「舊的絕對位置」減去「新的容器位置」，
  // 這樣才能確保動畫框出現的第一幀與舊數字完全重疊，即使容器因為寬度改變而位移了。
  const oldCenter = oldRect.left + oldRect.width / 2;
  const newCenter = newRect.left + newRect.width / 2;
  const startLeft = oldCenter - cRect.left - container.clientLeft + container.scrollLeft - (maxW / 2);
  const endLeft = newCenter - cRect.left - container.clientLeft + container.scrollLeft - (maxW / 2);
  const top = newRect.top - cRect.top - container.clientTop + container.scrollTop;
  const dir = delta >= 0 ? -1 : 1;

  // 6. 清理舊動畫並建立新動畫盒
  let isInterrupt = !!previous;
  container.querySelectorAll(`.stepper-anim-box[data-target-id="${el.id}"]`).forEach(b => {
    isInterrupt = true;
    b.remove();
  });

  const oldStr = String(oldVal);
  const newStr = String(newValue);
  const maxLen = Math.max(oldStr.length, newStr.length);
  const oldDigits = oldStr.padStart(maxLen, ' ').split('');
  const newDigits = newStr.padStart(maxLen, ' ').split('');

  const box = document.createElement('div');
  box.className = 'stepper-anim-box';
  box.dataset.targetId = el.id;
  // 注意：初期 left 設為 startLeft，且先不給 transition 避免動畫初始化閃爍
  box.style.cssText = `position:absolute;width:${maxW}px;height:${h}px;left:${startLeft}px;top:${top}px;pointer-events:none;z-index:100;clip-path:inset(0);display:flex;align-items:center;justify-content:flex-start;`;

  const digitsWrapper = document.createElement('div');
  digitsWrapper.style.cssText = `display:flex;align-items:center;justify-content:flex-start;height:100%;gap:0px;`;

  const slotWidths = [];
  let realNewW = 0, leadSpaceW = 0, leadDone = false;
  for (let i = 0; i < maxLen; i++) {
    const cw = getW(newDigits[i] !== ' ' ? newDigits[i] : (oldDigits[i] !== ' ' ? oldDigits[i] : '0'));
    slotWidths.push(cw);
    if (newDigits[i] !== ' ') realNewW += cw;
    if (!leadDone && newDigits[i] === ' ') leadSpaceW += cw; else leadDone = true;
  }
  digitsWrapper.style.marginLeft = ((maxW - realNewW) / 2 - leadSpaceW) + 'px';

  const baseDur = isInterrupt ? 250 : 450;
  const stagger = isInterrupt ? 30 : 80;
  const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const changedIndices = [];
  for (let i = maxLen - 1; i >= 0; i--) if (oldDigits[i] !== newDigits[i]) changedIndices.push(i);

  for (let i = 0; i < maxLen; i++) {
    const oldD = oldDigits[i], newD = newDigits[i], cw = slotWidths[i];
    const digitContainer = document.createElement('div');
    digitContainer.style.cssText = `position:relative;height:${h}px;overflow:hidden;display:inline-block;width:${cw}px;`;
    const dStyle = `display:flex;align-items:center;justify-content:center;width:${cw}px;height:100%;position:absolute;left:0;top:0;font-family:${style.fontFamily};font-size:${style.fontSize};font-weight:${style.fontWeight};font-variant-numeric:${style.fontVariantNumeric};letter-spacing:${style.letterSpacing};color:${color};`;

    if (oldD === newD) {
      const s = document.createElement('span'); s.textContent = oldD; s.style.cssText = dStyle; digitContainer.appendChild(s);
    } else {
      const oS = document.createElement('span'); oS.textContent = oldD; oS.style.cssText = dStyle; if (oldD === ' ') oS.style.visibility = 'hidden';
      const nS = document.createElement('span'); nS.textContent = newD; nS.style.cssText = dStyle; nS.style.transform = `translateY(${-dir * h}px)`; if (newD === ' ') nS.style.visibility = 'hidden';
      digitContainer.appendChild(oS); digitContainer.appendChild(nS);
      const delay = changedIndices.indexOf(i) * stagger;
      setTimeout(() => {
        if (el._numberAnimation !== run || !box.isConnected) return;
        if (oldD !== ' ') oS.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${dir * h}px)` }], { duration: baseDur, easing: ease, fill: 'both' });
        if (newD !== ' ') nS.animate([{ transform: `translateY(${-dir * h}px)` }, { transform: 'translateY(0)' }], { duration: baseDur, easing: ease, fill: 'both' });
      }, delay);
    }
    digitsWrapper.appendChild(digitContainer);
  }

  box.appendChild(digitsWrapper);
  container.appendChild(box);
  document.body.removeChild(measurer);

  // 7. 啟動水平移動動畫 (確保在下一幀，讓 DOM 有機會渲染初始位置)
  requestAnimationFrame(() => {
    if (el._numberAnimation !== run) return;
    box.style.transition = `left ${baseDur}ms ${ease}`;
    box.style.left = endLeft + 'px';
  });

  // 8. 動畫結束後清理：移除覆蓋層，還原真實元素顯示
  const totalDur = baseDur + (changedIndices.length * stagger) + 50;
  const cleanupTimer = setTimeout(() => {
    if (el._numberAnimation !== run) return;
    // 只清理自己的 box（防止快速連點時清到新動畫）
    if (box.parentElement) box.remove();
    el.classList.remove('number-anim-hiding');
    // 注意：不能在這裡直接把 transition 還原成 ''，
    // 因為 .stepper-input 有一條較晚宣告的 `transition: all 0.2s`
    // 規則（style.css 內 .styled-input 共用樣式）會蓋掉原本只列
    // background-color/border-color/box-shadow 的那條規則，連 color
    // 也會跟著被 transition 化。文字色從 transparent 還原成正常色時，
    // 若當下就恢復 transition，會被這條 all 0.2s 抓到，造成數字淡入
    // 產生一次可見的閃爍。因此先保持 transition:none，等真實數字繪製
    // 完成（等兩個 rAF，確保已經 paint 過一次）之後才還原 transition，
    // 讓交接是瞬間完成、無閃爍。
    el.style.transition = 'none';
    void el.offsetWidth; // 強制重排套用 transition:none
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 若期間又觸發了新的動畫（會重新加上 number-anim-hiding），
        // 就不要動 transition，交給新動畫自己管理
        if (!el.classList.contains('number-anim-hiding')) el.style.transition = '';
      });
    });
    delete el._numberAnimation;
  }, totalDur);
  run.cancel = () => {
    clearTimeout(cleanupTimer);
    box.remove();
    el.classList.remove('number-anim-hiding');
    el.style.transition = '';
  };

}

// ─── 自動備份 ───────────────────────────────────────────────────────────────
let _backupBusy = false;
async function backupPendingChanges() {
  if (_backupBusy || !state.changes.length) return;
  _backupBusy = true;
  const batch = state.changes.map(c => ({...c}));
  try {
    for (let i = 0; i < batch.length; i += 45) {
      const sent = batch.slice(i, i + 45);
      await window._api.updateAttendance(sent);
      state.changes = state.changes.filter(c => !sent.some(v => v.pageId === c.pageId && v.date === c.date && v.value === c.value));
      sent.forEach(c => { state.recentSyncs[c.pageId + '_' + c.date] = {value:c.value,ts:Date.now()}; });
    }
    showToast('自動備份 ' + batch.length + ' 筆', 'info');
  } catch (e) { console.error('自動備份失敗', e); }
  finally { _backupBusy = false; }
}
setInterval(backupPendingChanges, CONFIG.AUTO_SAVE_INTERVAL);

// ─── UI 工具 ────────────────────────────────────────────────────────────────
function showLoading(show) {
  state.loading = show;
  const el = document.getElementById('loading-overlay');
  if (!el) return;

  if (show) {
    el.classList.remove('exit-drop');
    el.style.display = 'flex';
    if (typeof window._startHackingLog === 'function') window._startHackingLog();
  } else {
    // 給予終端機視窗掉落的隨機角度 (-35 到 35 度，避免翻滾太多，維持自然感)
    const rot = (Math.random() * 70 - 35).toFixed(1) + 'deg';
    el.style.setProperty('--rot', rot);
    el.classList.add('exit-drop');

    setTimeout(() => {
      if (!state.loading) el.style.display = 'none';
    }, 700);
  }
}

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container'); if (!c) return;
  // Toast 堆疊限制：最多 3 條，移除最舊的
  while (c.children.length >= 3) {
    const oldest = c.children[0];
    oldest.classList.remove('visible');
    oldest.remove();
  }
  const t = document.createElement('div'); t.className = `toast toast-${type}`; t.innerHTML = msg;
  // 錯誤類型增加搖晃提醒
  if (type === 'error') {
    t.classList.add('toast-error');
    haptic('error');
  }
  c.appendChild(t); setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ─── 匯出 ───────────────────────────────────────────────────────────────────
const EXPORT_START_KEY = 'export_start_date';
const EXPORT_END_KEY = 'export_end_date';

function localTodayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

// 後端舊欄位只有月日；只在它真的對應到今天時才沿用，
// 否則使用完整 ISO 日期，避免跨學期後被解讀成去年。
function resolveAttendanceDate(value) {
  const iso = dateColumnToISO(value);
  if (!iso) return '';
  return getExportColumnEntries().find(entry => entry.iso === iso)?.column || iso;
}

function getTodayAttendanceDate() {
  return resolveAttendanceDate(localTodayISO()) || localTodayISO();
}

function isTodayAttendanceDate(value) {
  return dateColumnToISO(value) === localTodayISO();
}

function getNavigableAttendanceDates() {
  const byISO = new Map();
  for (const entry of getExportColumnEntries()) byISO.set(entry.iso, entry.column);
  const todayISO = localTodayISO();
  const configured = getConfiguredExportRange();
  const startDate = parseISODate(configured.start);
  const todayDate = parseISODate(todayISO);
  const span = startDate && todayDate ? Math.round((todayDate - startDate) / 86400000) : -1;

  // 新學期的 Notion 欄位可能還沒建立，選單仍應按設定的學期起日連續列出。
  // 以 400 天為上限，避免錯誤設定造成過大的 DOM 清單。
  if (span >= 0 && span <= 400) {
    const cursor = new Date(startDate);
    for (let i = 0; i <= span; i++) {
      const iso = cursor.toISOString().slice(0, 10);
      if (!byISO.has(iso)) byISO.set(iso, iso);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  byISO.set(todayISO, getTodayAttendanceDate());
  return [...byISO.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, column]) => column);
}

function parseISODate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

// 目前資料所屬的學期名稱：後端回傳的 roster.semester 優先，其次本學期，最後 config.js 的預設值
function activeSemesterName() {
  return (state.rosterSemester && state.rosterSemester.name) || (state.semester && state.semester.current.name) || CONFIG.SEMESTER || '';
}

function dateColumnToISO(columnName) {
  return dateColumnToISOFor(columnName, activeSemesterName());
}

// 舊式 "X月Y日" 欄位沒有年份，用學期名稱 (例如 114-2) 推算
function dateColumnToISOFor(columnName, semesterName) {
  if (parseISODate(columnName)) return columnName;
  const match = String(columnName || '').match(/^(\d{1,2})月(\d{1,2})日$/);
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  const semesterMatch = String(semesterName || '').match(/^(\d+)-([12])$/);
  let year = new Date().getFullYear();
  if (semesterMatch) {
    const academicYear = Number(semesterMatch[1]) + 1911;
    const term = Number(semesterMatch[2]);
    year = term === 1 ? academicYear + (month <= 7 ? 1 : 0) : academicYear + 1;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getExportColumnEntries() {
  return state.dateColumns
    .map(column => ({ column, iso: dateColumnToISO(column) }))
    .filter(entry => entry.iso);
}

function getAvailableExportRange() {
  const dates = getExportColumnEntries().map(entry => entry.iso).sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: '', end: '' };
}

function getConfiguredExportRange() {
  const available = getAvailableExportRange();
  const today = localTodayISO();
  const sem = state.semester && state.semester.current;
  const semStart = sem && parseISODate(sem.start) ? sem.start : '';
  const start = parseISODate(state.config[EXPORT_START_KEY]) ? state.config[EXPORT_START_KEY] : (semStart || available.start || today);
  const end = parseISODate(state.config[EXPORT_END_KEY]) ? state.config[EXPORT_END_KEY] : today;
  return start && end && start <= end ? { start, end } : { start: today, end: today };
}

function setExportInputBounds(input, available) {
  if (!input) return;
  input.removeAttribute('min');
  input.removeAttribute('max');
}

function initializeExportDateInputs() {
  const available = getAvailableExportRange();
  const configured = getConfiguredExportRange();
  const startInput = document.getElementById('export-start-date');
  const endInput = document.getElementById('export-end-date');
  const devStartInput = document.getElementById('dev-export-start-date');
  const devEndInput = document.getElementById('dev-export-end-date');
  for (const input of [startInput, endInput, devStartInput, devEndInput]) setExportInputBounds(input, available);
  if (startInput) startInput.value = configured.start;
  if (endInput) endInput.value = configured.end;
  if (devStartInput) devStartInput.value = configured.start;
  if (devEndInput) devEndInput.value = configured.end;
  populateExportSemesterSelect();
  updateExportDateSummary();
}

function readExportRange(startId, endId) {
  const start = document.getElementById(startId)?.value || '';
  const end = document.getElementById(endId)?.value || '';
  if (!parseISODate(start) || !parseISODate(end)) return { error: '請選擇完整的開始與結束日期' };
  if (start > end) return { error: '結束日期不能早於開始日期' };
  const days = Math.round((parseISODate(end) - parseISODate(start)) / 86400000) + 1;
  if (days > 16379) return { error: '日期可自由選擇，但單份 Excel 最多容納 16,379 個日期，請分段匯出。' };
  const known = new Map(getExportColumnEntries().map(entry => [entry.iso, entry.column]));
  const columns = [];
  const cursor = parseISODate(start);
  for (let i=0;i<days;i++) {
    const iso = cursor.toISOString().slice(0,10);
    columns.push(known.get(iso) || iso);
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return { start, end, columns };
}

function formatExportDate(iso) {
  const date = parseISODate(iso);
  return date ? `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日` : '';
}

function updateExportDateSummary() {
  const summary = document.getElementById('export-date-summary');
  if (!summary) return;
  const range = readExportRange('export-start-date', 'export-end-date');
  summary.classList.toggle('is-error', !!range.error);
  summary.textContent = range.error || `${formatExportDate(range.start)}至${formatExportDate(range.end)} · ${range.columns.length} 個日期欄位`;
}

async function saveDefaultExportRange() {
  const range = readExportRange('dev-export-start-date', 'dev-export-end-date');
  if (range.error) { showToast(range.error, 'error'); return; }
  const button = document.getElementById('save-export-range-btn');
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '儲存中…'; }
  try {
    const updates = { [EXPORT_START_KEY]: range.start, [EXPORT_END_KEY]: range.end };
    await window._api.setConfig(updates);
    Object.assign(state.config, updates);
    const startInput = document.getElementById('export-start-date');
    const endInput = document.getElementById('export-end-date');
    if (startInput) startInput.value = range.start;
    if (endInput) endInput.value = range.end;
    updateExportDateSummary();
    showToast(`預設匯出時段已儲存（${range.columns.length} 個日期）`, 'success');
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  } finally {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = '儲存預設匯出時段'; }
  }
}

// 匯出下拉選單裡選的學期；'' = 目前畫面的資料
function selectedExportSemester() {
  const sel = document.getElementById('export-semester');
  return sel ? sel.value : '';
}

function populateExportSemesterSelect() {
  const sel = document.getElementById('export-semester');
  if (!sel) return;
  const sem = state.semester;
  const previous = sel.value;
  const options = [`<option value="">本學期${sem.current.name ? '（' + sem.current.name + '）' : ''}</option>`];
  for (const arc of sem.archives) options.push(`<option value="${arc.name}">封存 ${arc.name}${arc.start ? '（' + arc.start + ' ~ ' + arc.end + '）' : ''}</option>`);
  sel.innerHTML = options.join('');
  if ([...sel.options].some(o => o.value === previous)) sel.value = previous;
  const wrap = sel.closest('.export-semester-field');
  if (wrap) wrap.hidden = !sem.available || !sem.archives.length;
}

// 把日期範圍對到某一份 roster 的欄位 (封存學期的舊式欄位要用那個學期推年份)
function exportColumnsFor(range, dateColumns, semesterName) {
  const known = new Map();
  for (const column of dateColumns) { const iso = dateColumnToISOFor(column, semesterName); if (iso && !known.has(iso)) known.set(iso, column); }
  const cursor = parseISODate(range.start);
  const days = Math.round((parseISODate(range.end) - cursor) / 86400000) + 1;
  const columns = [];
  for (let i = 0; i < days; i++) { const iso = cursor.toISOString().slice(0, 10); columns.push(known.get(iso) || iso); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return columns;
}

function buildExportRows(students, columns) {
  return students.map(s => {
    const r = [s.name, s.room, s.bed, s.class, s.studentId];
    // 預設每個人每一天都是 ✓ (在宿舍)，沒有紀錄或後端沒有該日欄位也一樣
    for (const d of columns) r.push(s.attendance[d] || '✓');
    return r;
  });
}

// Excel 表頭只顯示「月/日」，不帶年份
function exportDateHeader(column, semesterName) {
  const iso = dateColumnToISOFor(column, semesterName);
  if (!iso) return column;
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 全部儲存格置中、表頭粗體、欄寬放寬 (樣式由 xlsx-js-style 寫入)
function styleExportSheet(ws, rowCount, colCount) {
  const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const border = { style: 'thin', color: { rgb: 'D0D0D0' } };
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const cell = ws[colName(c) + (r + 1)];
      if (!cell) continue;
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top: border, bottom: border, left: border, right: border },
        ...(r === 0 ? { font: { bold: true }, fill: { fgColor: { rgb: 'F2F2F2' } } } : {}),
      };
    }
  }
  ws['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 6 }, { wch: 14 }, { wch: 13 }, ...Array(Math.max(0, colCount - 5)).fill({ wch: 6 })];
  ws['!freeze'] = { xSplit: 5, ySplit: 1 };
}

async function exportExcel() {
  const range = readExportRange('export-start-date', 'export-end-date');
  if (range.error) { showToast(range.error, 'error'); return; }
  const btn = document.getElementById('export-btn');
  const semester = selectedExportSemester();
  try {
    let students = state.students, columns = range.columns, label = activeSemesterName();
    if (semester && semester !== (state.rosterSemester && state.rosterSemester.name)) {
      if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
      showToast(`正在讀取封存學期 ${semester}…`, 'info');
      const roster = await window._api.getRoster(semester);
      students = roster.students || [];
      columns = exportColumnsFor(range, roster.dateColumns || [], semester);
      label = semester;
    }
    if (!students.length) { showToast('沒有資料', 'error'); return; }
    const headers = ['名稱', '寢床號', '床號', '班別', '學號', ...columns.map(c => exportDateHeader(c, label))];
    const rows = buildExportRows(students, columns);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    styleExportSheet(ws, rows.length + 1, headers.length);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '點名總表');
    const fileRange = `${range.start.replaceAll('-', '')}-${range.end.replaceAll('-', '')}`;
    XLSX.writeFile(wb, `碧苑點名_${label || 'semester'}_${fileRange}.xlsx`);
    showToast(`Excel 已下載（${columns.length} 個日期）`, 'success');
  } catch (err) { showToast('匯出失敗：' + err.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}

// ─── 學期管理 (開發者調適區) ───────────────────────────────────────────────
async function loadSemesterState() {
  try {
    const data = await window._api.getSemester();
    if (!data || !data.current || typeof data.current !== 'object') { state.semester.available = false; return state.semester; }
    state.semester = {
      current: { name: data.current.name || '', dbId: data.current.dbId || '', start: data.current.start || '', end: data.current.end || '' },
      archives: Array.isArray(data.archives) ? data.archives : [],
      dateColumns: Array.isArray(data.dateColumns) ? data.dateColumns : [],
      available: true,
    };
  } catch (e) {
    state.semester.available = false;
  }
  return state.semester;
}

function semesterRangeText(start, end) {
  const a = parseISODate(start), b = parseISODate(end);
  if (!a || !b || a > b) return '';
  const days = Math.round((b - a) / 86400000) + 1;
  return `${formatExportDate(start)} ～ ${formatExportDate(end)}，共 ${days} 天`;
}

function updateSemesterRangeSummary() {
  const el = document.getElementById('sem-range-summary');
  if (!el) return;
  const start = document.getElementById('sem-start')?.value || '';
  const end = document.getElementById('sem-end')?.value || '';
  el.textContent = semesterRangeText(start, end) || '請選擇學期開始與結束日期';
}

function renderSemesterCard() {
  const card = document.getElementById('semester-card');
  if (!card) return;
  const sem = state.semester;
  const hint = document.getElementById('semester-hint');
  if (!sem.available) {
    if (hint) hint.textContent = '後端尚未更新到支援學期管理的版本。';
    card.classList.add('is-unavailable');
    return;
  }
  card.classList.remove('is-unavailable');
  const cur = sem.current;
  const cols = sem.dateColumns || [];
  const isoCols = cols.filter(c => parseISODate(c));
  const legacy = cols.length - isoCols.length;
  if (hint) {
    hint.textContent = `雲端目前：學期「${cur.name || '未命名'}」${cur.start ? '，' + cur.start + ' ~ ' + cur.end : '，尚未設定日期範圍'}；總表有 ${cols.length} 個日期欄位${legacy ? '（其中 ' + legacy + ' 個是舊式「X月Y日」欄位）' : ''}。套用後全宿舍所有裝置都會同步。`;
  }
  const nameEl = document.getElementById('sem-name');
  const startEl = document.getElementById('sem-start');
  const endEl = document.getElementById('sem-end');
  if (nameEl && !nameEl.dataset.touched) nameEl.value = cur.name || '';
  if (startEl && !startEl.dataset.touched) startEl.value = cur.start || '';
  if (endEl && !endEl.dataset.touched) endEl.value = cur.end || '';
  updateSemesterRangeSummary();

  const list = document.getElementById('sem-archive-list');
  if (list) {
    list.innerHTML = sem.archives.length
      ? sem.archives.slice().reverse().map(arc => `<div class="sem-archive-row">
          <div><b>${arc.name || '未命名'}</b><span>${arc.start ? arc.start + ' ~ ' + arc.end : '日期未記錄'}</span></div>
          <button type="button" class="action-btn" onclick="viewArchivedSemester('${arc.name}')">查看總表</button>
        </div>`).join('')
      : '<p class="dev-card-hint">還沒有封存的學期。</p>';
  }
}

function semesterInputsTouched() {
  for (const id of ['sem-name', 'sem-start', 'sem-end']) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { el.dataset.touched = '1'; updateSemesterRangeSummary(); }, { once: false });
  }
}

async function refreshSemesterUI() {
  await loadSemesterState();
  for (const id of ['sem-name', 'sem-start', 'sem-end']) { const el = document.getElementById(id); if (el) delete el.dataset.touched; }
  renderSemesterCard();
  populateExportSemesterSelect();
  initializeExportDateInputs();
}

async function applySemesterDates() {
  const name = (document.getElementById('sem-name')?.value || '').trim();
  const start = document.getElementById('sem-start')?.value || '';
  const end = document.getElementById('sem-end')?.value || '';
  if (!parseISODate(start) || !parseISODate(end)) { showToast('請選擇完整的學期開始與結束日期', 'error'); return; }
  if (start > end) { showToast('結束日期不能早於開始日期', 'error'); return; }
  const btn = document.getElementById('sem-apply-btn');
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = '套用中…'; }
  try {
    let res = await window._api.applySemesterDates({ name, start, end });
    if (res && res.needsConfirm) {
      const lost = res.toRemove.filter(d => d.nonDefault > 0);
      const rows = res.toRemove.map(d => `<li>${d.date}${d.nonDefault ? ` — 有 <b>${d.nonDefault}</b> 筆請假/未請假紀錄會消失` : ''}</li>`).join('');
      const ok = await showConfirmDialog({
        title: `縮小範圍會刪除 ${res.toRemove.length} 天的欄位`,
        message: `這些日期在新的範圍外，欄位和裡面的點名紀錄會從雲端刪除，無法還原：<ul class="sem-remove-list">${rows}</ul>${lost.length ? `<p>其中 ${lost.length} 天有非 ✓ 的紀錄。</p>` : ''}${res.toAdd.length ? `<p>同時會新增 ${res.toAdd.length} 天的欄位。</p>` : ''}`,
        confirmText: '確定刪除並套用', danger: true,
      });
      if (!ok) { showToast('已取消，沒有改動任何欄位', 'info'); return; }
      res = await window._api.applySemesterDates({ name, start, end, confirmRemove: true });
    }
    if (!res || !res.success) throw new Error(res && res.error ? res.error : '後端沒有回報成功');
    showToast(`學期日期已套用：新增 ${res.added.length} 天、刪除 ${res.removed.length} 天`, 'success');
    await refreshSemesterUI();
    await loadData();
  } catch (err) {
    showToast('套用失敗：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = '套用學期日期範圍'; }
  }
}

let _archiveBedsPending = null; // 封存後尚未建立的床位 (分批失敗時可重試)
let _archiveBedsDbId = '';

async function importArchiveBeds() {
  const progress = document.getElementById('sem-archive-progress');
  const total = _archiveBedsPending ? _archiveBedsPending.length : 0;
  let done = 0;
  while (_archiveBedsPending && _archiveBedsPending.length) {
    const batch = _archiveBedsPending.slice(0, 40);
    if (progress) { progress.hidden = false; progress.textContent = `正在建立新學期床位… ${done}/${total}`; }
    const res = await window._api.importBatch({ db_id: _archiveBedsDbId, students: batch });
    if (res && res.errors && res.errors.length) console.warn('床位建立部分失敗', res.errors);
    done += batch.length;
    _archiveBedsPending = _archiveBedsPending.slice(40);
  }
  _archiveBedsPending = null;
  if (progress) { progress.textContent = `新學期床位建立完成（${total} 張）`; }
}

async function archiveSemester() {
  const newName = (document.getElementById('sem-new-name')?.value || '').trim();
  const start = document.getElementById('sem-new-start')?.value || '';
  const end = document.getElementById('sem-new-end')?.value || '';
  const carry = !!document.getElementById('sem-carry')?.checked;
  const btn = document.getElementById('sem-archive-btn');

  // 上次床位沒建完 → 先把剩下的補完
  if (_archiveBedsPending && _archiveBedsPending.length) {
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    try { await importArchiveBeds(); showToast('剩餘床位已建立完成', 'success'); await refreshSemesterUI(); await loadData(); }
    catch (err) { showToast('床位建立又失敗了，稍後再按一次：' + err.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = '封存本學期並建立新學期'; } }
    return;
  }

  if (!newName) { showToast('請輸入新學期名稱（例如 115-2）', 'error'); return; }
  if (!parseISODate(start) || !parseISODate(end)) { showToast('請選擇新學期的開始與結束日期', 'error'); return; }
  if (start > end) { showToast('結束日期不能早於開始日期', 'error'); return; }
  const currentName = state.semester.current.name || CONFIG.SEMESTER || '舊學期';
  if (newName === currentName) { showToast('新學期名稱不能跟目前學期一樣', 'error'); return; }

  const ok = await showConfirmDialog({
    title: `封存「${currentName}」並建立「${newName}」？`,
    message: `<p>目前的總表會原封不動保留（改名為「碧苑點名總表 ${currentName}」），之後可在此查看。</p><p>系統會另外建立「碧苑點名總表 ${newName}」，日期範圍 ${semesterRangeText(start, end)}。</p><p>床位會照抄；${carry ? '目前住宿生的姓名、班級、學號會一起帶到新學期' : '新學期所有床位都是空床，之後用匯入精靈匯入名單'}。</p><p>所有幹部的裝置都會立刻切到新學期。</p>`,
    confirmText: '確定封存並建立', danger: true,
  });
  if (!ok) return;

  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = '建立新學期中…'; }
  const progress = document.getElementById('sem-archive-progress');
  try {
    const res = await window._api.archiveSemester({ newName, start, end, currentName, carryResidents: carry });
    if (!res || !res.success) throw new Error(res && res.error ? res.error : '後端沒有回報成功');
    _archiveBedsDbId = res.newDbId;
    _archiveBedsPending = Array.isArray(res.beds) ? res.beds.slice() : [];
    try {
      await importArchiveBeds();
    } catch (err) {
      showToast(`新學期已建立，但床位只建了一部分：${err.message}。再按一次按鈕會把剩下的補完`, 'error');
      if (btn) btn.textContent = `繼續建立剩餘 ${_archiveBedsPending.length} 張床位`;
      return;
    }
    showToast(`已封存 ${res.archived.name}，新學期 ${newName} 建立完成`, 'success');
    for (const id of ['sem-new-name', 'sem-new-start', 'sem-new-end']) { const el = document.getElementById(id); if (el) el.value = ''; }
    state.viewSemester = null;
    await refreshSemesterUI();
    await loadData();
  } catch (err) {
    showToast('封存失敗：' + err.message, 'error');
  } finally {
    if (btn && !(_archiveBedsPending && _archiveBedsPending.length)) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = '封存本學期並建立新學期'; }
    else if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    if (progress && !(_archiveBedsPending && _archiveBedsPending.length)) setTimeout(() => { progress.hidden = true; }, 4000);
  }
}

async function viewArchivedSemester(name) {
  const arc = state.semester.archives.find(a => a.name === name);
  if (!arc) { showToast('找不到這個封存學期', 'error'); return; }
  state.viewSemester = name;
  state.currentDate = arc.end && parseISODate(arc.end) ? arc.end : (state.currentDate || localTodayISO());
  navigateTo('summary');
  await loadData();
  // 封存資料的日期用該學期的欄位；沒有對到就退到最後一個欄位
  const entries = getExportColumnEntries();
  if (entries.length && !entries.some(e => e.column === state.currentDate || e.iso === state.currentDate)) {
    state.currentDate = entries[entries.length - 1].column;
  } else {
    state.currentDate = resolveAttendanceDate(state.currentDate) || state.currentDate;
  }
  renderCurrentPage(true);
  showToast(`正在查看封存學期 ${name}（唯讀）`, 'info');
}

async function exitArchiveView() {
  state.viewSemester = null;
  state.rosterSemester = null;
  state.currentDate = getTodayAttendanceDate();
  await loadData();
  const banner = document.getElementById('summary-archive-banner');
  if (banner) banner.hidden = true;
  showToast('已回到本學期', 'success');
}

window.applySemesterDates = applySemesterDates;
window.archiveSemester = archiveSemester;
window.viewArchivedSemester = viewArchivedSemester;
window.exitArchiveView = exitArchiveView;
window.updateSemesterRangeSummary = updateSemesterRangeSummary;
window.populateExportSemesterSelect = populateExportSemesterSelect;

// ─── 全域暴露 ───────────────────────────────────────────────────────────────
window.enterSquad = enterSquad;
window.toggleStatus = toggleStatus;
window.showDateDetail = showDateDetail;
window.exportExcel = exportExcel;
window.updateExportDateSummary = updateExportDateSummary;
window.saveDefaultExportRange = saveDefaultExportRange;
window.navigateTo = navigateTo;
window.loadData = loadData;
window.openEmptyBedModal = openEmptyBedModal;
window.updateBedOptions = updateBedOptions;
window.submitEmptyBed = submitEmptyBed;
window.closeModal = closeModal;
window.adjustSetting = adjustSetting;
window.saveDormSettings = saveDormSettings;

window.openSwapBedModal = openSwapBedModal;
window.updateSwapFromBeds = updateSwapFromBeds;
window.updateSwapToBeds = updateSwapToBeds;
window.submitSwapBed = submitSwapBed;

window.toggleDatePicker = toggleDatePicker;
window.selectRollCallDate = selectRollCallDate;
window.toggleSquadConfirm = toggleSquadConfirm;

// ═════════════════════════════════════════════════════════════════════════════
// 硬性房間規則
// ═════════════════════════════════════════════════════════════════════════════
function applyRoomRules() {
  for (const s of state.students) {
    // 儲藏室：整間隱藏
    if (CONFIG.STORAGE_ROOMS.includes(s.room)) {
      s.hidden = true;
      continue;
    }
    // 雙人房：C、D 床隱藏
    if (CONFIG.DOUBLE_ROOMS.includes(s.room) && (s.bed === 'C' || s.bed === 'D')) {
      s.hidden = true;
      continue;
    }
    s.hidden = false;
  }
}

const NAV_PAGES = [
  { page: 'home', emoji: '<svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', label: '點名' },
  { page: 'summary', emoji: '<svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>', label: '總表' },
  { page: 'history', emoji: '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>', label: '歷史' },
  { page: 'settings', emoji: '<svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>', label: '設定' },
];

// 導覽列 ICON 硬編碼映射
const NAV_ICON_MAP = {
  home: 'HOME',
  summary: 'PAGE2',
  history: 'HISTORY',
  settings: 'SETTIN',
};

function applyNavIcons() {
  if (document.querySelector('.liquid-nav')) return;
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    const page = item.dataset.page;
    const iconEl = item.querySelector('.nav-icon');
    if (!iconEl) return;
    const srcBase = NAV_ICON_MAP[page];
    if (srcBase) {
      const src = getIconSrc(srcBase);
      // 加上 onerror 備援機制，如果發生錯誤就 fallback 回 emoji (現在已改為 SVG)
      const defEmoji = NAV_PAGES.find(n => n.page === page)?.emoji || '<svg class="ui-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

      const img = document.createElement('img');
      img.className = 'nav-icon-img';
      img.src = src;
      img.alt = page;
      img.style.cssText = 'width:28px;height:28px;object-fit:contain;margin-bottom:-2px;';
      img.onerror = function () { this.outerHTML = defEmoji; };
      iconEl.innerHTML = '';
      iconEl.appendChild(img);
    } else {
      const def = NAV_PAGES.find(n => n.page === page);
      if (def) iconEl.textContent = def.emoji;
    }
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 開發者調適區（6 位密碼保護）
// ═════════════════════════════════════════════════════════════════════════════
const DEV_PASSWORD = '147258'; // 6 位開發者密碼
let devUnlocked = false;

function openDevAuth() {
  const panel = document.getElementById('dev-panel');
  // 如果已解鎖，切換顯示/隱藏
  if (devUnlocked) {
    if (!panel.classList.contains('open')) {
      const pinAuthCheckbox = document.getElementById('dev-global-pin-auth');
      if (pinAuthCheckbox) {
        pinAuthCheckbox.checked = state.config['global_pin_auth'] !== 'false';
      }
      initDevChangelog();
      checkUnreadFeedback();
      refreshSemesterUI();
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
    }
    return;
  }
  // 彈出密碼輸入
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay visible';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3><svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 開發者驗證</h3>
      <p class="modal-desc">請輸入 6 位數開發者密碼</p>
      <input type="password" id="dev-pin-input" class="pin-input" maxlength="6" placeholder="••••••" inputmode="numeric" autocomplete="off">
      <div class="modal-actions">
        <button class="modal-btn cancel" id="dev-pin-cancel">取消</button>
        <button class="modal-btn confirm" id="dev-pin-confirm">解鎖</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('dev-pin-input');
  setTimeout(() => input.focus(), 100);

  const tryUnlock = () => {
    if (input.value === DEV_PASSWORD) {
      // 提前 0.2 秒播放解鎖音效，讓音效搶先視覺一步
      playClickSound('dev_unlock');
      setTimeout(() => {
        devUnlocked = true;
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
        panel.classList.add('open');
        const pinAuthCheckbox = document.getElementById('dev-global-pin-auth');
        if (pinAuthCheckbox) {
          pinAuthCheckbox.checked = state.config['global_pin_auth'] !== 'false';
        }
        initDevChangelog();
        refreshSemesterUI();
        showToast('開發者模式已解鎖', 'success');
      }, 200);
    } else {
      playClickSound('dev_error'); // 錯誤密碼播放「錯誤音」而非成功音
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 500);
      showToast('密碼錯誤', 'error');
      input.value = '';
    }
  };

  document.getElementById('dev-pin-cancel').onclick = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
  };
  document.getElementById('dev-pin-confirm').onclick = tryUnlock;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('dev-pin-confirm').click(); });
}

window.openDevAuth = openDevAuth;
window.saveGlobalPinAuth = saveGlobalPinAuth;

// ═════════════════════════════════════════════════════════════════════════════
// 伺服器自訂背景影片 (全域 Notion Config 儲存)
// ═════════════════════════════════════════════════════════════════════════════
function loadGlobalBgVideo() {
  if (applyCustomBackground()) return;
  // 從 Notion 全域設定讀取
  const rawUrl = state.config['bg_video_url'];
  const url = (rawUrl || '').trim();
  const scale = state.config['bg_video_scale'] || 1.0;
  const opacity = state.config['bg_video_opacity'] || 0.25;

  const container = document.getElementById('custom-video-bg');
  const animBg = document.querySelector('.home-anim-bg');

  if (url && url.startsWith('http')) {
    container.innerHTML = `<video src="${url}" autoplay loop muted playsinline style="--target-scale: ${scale}; --target-opacity: ${opacity}; opacity: 0;"></video>`;
    const vid = container.querySelector('video');
    vid.addEventListener('loadeddata', () => {
      vid.style.animation = 'fadeInVideo 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
    }, { once: true });
    if (animBg) animBg.style.display = 'none'; // 隱藏預設動畫

    // 同步到 UI (如果在設定頁)
    const urlInput = document.getElementById('bg-video-url');
    if (urlInput) {
      urlInput.value = url;
      document.getElementById('bg-video-scale').value = scale;
      document.getElementById('bg-video-opacity').value = opacity;
    }
  } else {
    container.innerHTML = '';
    if (animBg) animBg.style.display = 'flex';
  }
}

function previewBgVideoStyle() {
  const scale = document.getElementById('bg-video-scale').value;
  const opacity = document.getElementById('bg-video-opacity').value;
  const video = document.querySelector('#custom-video-bg video');

  if (video) {
    video.style.transform = `scale(${scale})`;
    video.style.opacity = opacity;
  } else {
    // 若尚未載入影片，嘗試立刻用輸入的網址做預覽
    const url = document.getElementById('bg-video-url').value.trim();
    if (url) {
      document.getElementById('custom-video-bg').innerHTML = `<video src="${url}" autoplay loop muted playsinline style="transform: scale(${scale}); opacity: ${opacity};"></video>`;
    }
  }
}

async function applyBgVideoUrl() {
  const url = document.getElementById('bg-video-url').value.trim();
  const scale = document.getElementById('bg-video-scale').value;
  const opacity = document.getElementById('bg-video-opacity').value;

  if (!url) {
    return showToast('請先輸入影片網址', 'error');
  }

  showLoading(true);
  try {
    // 儲存至 Notion 全域 Config
    await window._api.setConfig({
      bg_video_url: url,
      bg_video_scale: scale,
      bg_video_opacity: opacity
    });

    // 更新本地狀態
    state.config['bg_video_url'] = url;
    state.config['bg_video_scale'] = scale;
    state.config['bg_video_opacity'] = opacity;

    showToast('全域背景影片已更新', 'success');
    loadGlobalBgVideo();
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  }
  showLoading(false);
}

async function clearBgVideo() {
  showLoading(true);
  try {
    // 將 URL 設為空字串，以清除 Notion 上的設定
    await window._api.setConfig({ bg_video_url: '' });

    state.config['bg_video_url'] = '';

    const urlInput = document.getElementById('bg-video-url');
    if (urlInput) {
      urlInput.value = '';
      document.getElementById('bg-video-scale').value = 1.0;
      document.getElementById('bg-video-opacity').value = 0.25;
    }

    showToast('已恢復全域預設光球動畫', 'success');
    loadGlobalBgVideo();
  } catch (err) {
    showToast('清除失敗：' + err.message, 'error');
  }
  showLoading(false);
}

// 清理所有空床的殘留資料（針對過往遺留資料）
async function cleanUpEmptyBeds() {
  const ok = await showConfirmDialog({
    title: '清理空床資料',
    message: '確定要將所有空床的「姓名、學號、班級」清空，並「所有日期的請假紀錄」覆寫為 <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>？此操作無法還原！',
    confirmText: '確定清理',
    danger: true,
    icon: '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'
  });
  if (!ok) return;

  const emptyBeds = state.students.filter(s => s.isEmpty);
  if (emptyBeds.length === 0) {
    showToast('目前沒有任何空床', 'info');
    return;
  }

  showLoading(true);
  try {
    const datesToClear = {};
    for (const d of state.dateColumns) datesToClear[d] = '✓';

    const updates = emptyBeds.map(student => {
      // 本地同步更新
      student.name = '';
      student.class = '';
      student.studentId = '';
      student.isForeign = false;
      for (const d of state.dateColumns) student.attendance[d] = '✓';

      return {
        pageId: student.id,
        markEmpty: true,
        clearProfile: true, // 清除學號姓名等
        dates: datesToClear // 覆寫請假紀錄為勾勾
      };
    });

    // 分批次發出 API 請求
    for (let i = 0; i < updates.length; i += 45) {
      await window._api.updateAttendance(updates.slice(i, i + 45));
    }

    showToast(`成功清理了 ${emptyBeds.length} 張空床的資料，請假全數補上勾勾！`, 'success');

    // 如果剛好在點名頁或總表，重新渲染一下確保畫面同步
    if (currentPage === 'rollcall') renderRollCall();
    if (currentPage === 'summary') renderSummary();

  } catch (err) {
    showToast('清理失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// 暫時按鈕：將所有空床的請假紀錄覆蓋為空床專用的勾勾
async function fillEmptyBedsWithCheckmarks() {
  const ok = await showConfirmDialog({
    title: '補上勾勾',
    message: '確定要將「目前所有空床」的請假紀錄全部強制補上「✓」嗎？',
    confirmText: '確定執行',
    danger: false,
    icon: '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
  });
  if (!ok) return;

  const emptyBeds = state.students.filter(s => s.isEmpty);
  if (emptyBeds.length === 0) {
    showToast('目前沒有任何空床', 'info');
    return;
  }

  showLoading(true);
  try {
    const datesToClear = {};
    for (const d of state.dateColumns) datesToClear[d] = '✓';

    const updates = emptyBeds.map(student => {
      // 本地同步更新
      for (const d of state.dateColumns) student.attendance[d] = '✓';

      return {
        pageId: student.id,
        dates: datesToClear // 僅覆寫請假紀錄為勾勾
      };
    });

    // 分批次發出 API 請求
    for (let i = 0; i < updates.length; i += 45) {
      await window._api.updateAttendance(updates.slice(i, i + 45));
    }

    showToast(`成功將 ${emptyBeds.length} 張空床的請假紀錄統一填上勾勾！`, 'success');

    if (currentPage === 'rollcall') renderRollCall();
    if (currentPage === 'summary') renderSummary();

  } catch (err) {
    showToast('更新失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 住宿生新增 幹部審核邏輯
// ═════════════════════════════════════════════════════════════════════════════
function openReviewPage() {
  navigateTo('review');
  renderResidentReviewList();
}

async function renderResidentReviewList() {
  const container = document.getElementById('management-review-list');
  if (!container) return;

  container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px;">讀取中...</div>';

  try {
    // 取得最新 config (包含所有暫存的新增請求)
    const config = await window._api.getConfig();
    const reqs = Object.keys(config)
      .filter(k => k.startsWith('add_req_') && config[k])
      .map(k => {
        try { return { id: k, ...JSON.parse(config[k]) }; }
        catch (e) { return null; }
      })
      .filter(x => x && x.name) // 過濾可用資料
      .sort((a, b) => b.timestamp - a.timestamp); // 新的在上面

    if (reqs.length === 0) {
      container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px;">目前沒有任何新增住宿生申請。</div>';
      return;
    }

    let html = '';
    reqs.forEach(req => {
      const timeStr = new Date(req.timestamp).toLocaleString();
      html += `
        <div class="review-card">
          <div class="review-card-info">
            <div class="review-card-name">${req.name}<span class="review-card-meta">${req.class} • ${req.studentId}</span></div>
            <div class="review-card-bed"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg> 申請補入: ${req.room} ${req.bed} 床</div>
            <div class="review-card-time">⏰ 送出時間: ${timeStr}</div>
            ${req.isForeign ? '<div class="review-card-badge foreign"><svg class="ui-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg> 外籍生</div>' : ''}
          </div>
          <div class="review-card-actions">
            <button class="review-approve-btn" onclick="approveResidentAddReq('${req.id}')"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 通過並寫入</button>
            <button class="review-reject-btn" onclick="rejectResidentAddReq('${req.id}')">✕ 駁回</button>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);text-align:center;padding:20px;">讀取失敗：${err.message}</div>`;
  }
}

async function approveResidentAddReq(reqId) {
  const ok = await showConfirmDialog({
    title: '核准申請',
    message: '確定要通過申請，將該學生正式寫入總表床位嗎？',
    confirmText: '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 通過並寫入',
    danger: false,
    icon: '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  });
  if (!ok) return;
  showLoading(true);
  try {
    const config = await window._api.getConfig();
    const reqStr = config[reqId];
    if (!reqStr) throw new Error('找不到該申請');
    const req = JSON.parse(reqStr);

    // 檢查床位現在是否依然是空床
    const student = state.students.find(s => s.room === req.room && s.bed === req.bed);
    if (!student || !student.isEmpty) {
      throw new Error(`目標床位 ${req.room} ${req.bed} 目前並非空床狀態！請先確認總表。`);
    }

    // 1. 寫入總表
    await window._api.updateAttendance([{
      pageId: req.pageId, // Notion 上的目標空床 PageID
      updateProfile: {
        name: req.name,
        class: req.class,
        studentId: req.studentId,
        isForeign: req.isForeign
      },
      markEmpty: false // 取消空床狀態
    }]);

    // 2. 本地狀態更新
    student.name = req.name;
    student.class = req.class;
    student.studentId = req.studentId;
    student.isForeign = req.isForeign;
    student.isEmpty = false;

    // 3. 從 config 清除該筆 request
    await window._api.setConfig({ [reqId]: '' });

    showToast('核准成功！該學生已正式寫入總表。', 'success');
    renderResidentReviewList(); // 重新讀取清單
    state.lastFetched = 0; // 強制下一次要重新讀取確保畫面乾淨
  } catch (err) {
    showToast('操作失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function rejectResidentAddReq(reqId) {
  const ok = await showConfirmDialog({
    title: '駁回申請',
    message: '確定要駁回此申請嗎？紀錄將被刪除。',
    confirmText: '駁回',
    danger: true,
    icon: '<svg class="ui-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
  });
  if (!ok) return;
  showLoading(true);
  try {
    await window._api.setConfig({ [reqId]: '' });
    showToast('已駁回，並移除申請紀錄。', 'success');
    renderResidentReviewList();
  } catch (err) {
    showToast('操作失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

window.applyBgVideoUrl = applyBgVideoUrl;
window.previewBgVideoStyle = previewBgVideoStyle;
window.clearBgVideo = clearBgVideo;
window.cleanUpEmptyBeds = cleanUpEmptyBeds;
window.fillEmptyBedsWithCheckmarks = fillEmptyBedsWithCheckmarks;

window.openAddResidentModal = openAddResidentModal;
window.updateAddResidentBeds = updateAddResidentBeds;
window.checkForeignStudentClass = checkForeignStudentClass;
window.submitAddResident = submitAddResident;
window.openReviewPage = openReviewPage;
window.renderResidentReviewList = renderResidentReviewList;
window.approveResidentAddReq = approveResidentAddReq;
window.rejectResidentAddReq = rejectResidentAddReq;

// ═════════════════════════════════════════════════════════════════════════════
// 櫃台請假與電話請假紀錄
// ═════════════════════════════════════════════════════════════════════════════
function openCounterLeaveModal() {
  document.getElementById('cl-search').value = '';
  document.getElementById('cl-handler').value = '';

  const today = localTodayISO();
  document.getElementById('cl-start-date').value = today;
  document.getElementById('cl-end-date').value = today;

  document.getElementById('cl-target').innerHTML = '<option value="">請先搜尋上方欄位...</option>';
  document.getElementById('counter-leave-modal').classList.add('visible');
}

function handleCounterLeaveSearch() {
  const query = document.getElementById('cl-search').value.trim().toLowerCase();
  const select = document.getElementById('cl-target');

  if (!query) {
    select.innerHTML = '<option value="">請先搜尋上方欄位...</option>';
    return;
  }

  // 模糊過濾
  const matches = state.students.filter(s => {
    if (s.isEmpty) return false;
    const txt = `${s.name} ${s.room} ${s.bed} ${s.studentId}`.toLowerCase();
    return txt.includes(query);
  }).slice(0, 50); // 最多 50 筆

  if (matches.length === 0) {
    select.innerHTML = '<option value="">找不到符合的學生</option>';
  } else {
    select.innerHTML = matches.map(s =>
      `<option value="${s.id}">${s.room} ${s.bed} - ${s.name}</option>`
    ).join('');
  }
}

function viewLeaveRecords() {
  closeModal('counter-leave-modal');
  navigateTo('leave-records');
  renderLeaveRecordsList();
}

// 請假紀錄的建立時間：2026/09/12 22:02，無效日期就留白
function formatLeaveStamp(value) {
  const d = new Date(value);
  if (!value || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function renderLeaveRecordsList() {
  const container = document.getElementById('leave-records-list');
  if (!container) return;

  container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px;">讀取中...</div>';

  try {
    const res = await fetch(CONFIG.WORKER_URL + '/api/leave-records');
    if (!res.ok) throw new Error('API 回應錯誤');
    const records = await res.json();

    if (!records || records.length === 0) {
      container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px;">目前沒有任何電話請假紀錄。<br><br><small style="color:var(--red);">若您確定有新增過，可能是 Cloudflare 中尚未設定 LEAVE_DB_ID，請至開發者區初始化資料庫並將 ID 填入 Cloudflare 環境變數。</small></div>';
      return;
    }

    container.innerHTML = records.map(r => `
      <div style="background:var(--card);border:1px solid var(--border);padding:16px;border-radius:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
          <div style="font-size:16px;font-weight:bold;color:var(--text);">${r.title}</div>
          <div style="font-size:12px;color:var(--dim);white-space:nowrap;flex:0 0 auto;margin-left:10px;">${formatLeaveStamp(r.createdAt)}</div>
        </div>
        <div style="font-size:14px;color:var(--dim);margin-bottom:4px;"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg> ${r.roomBed} ${r.name}</div>
        <div style="font-size:14px;color:var(--dim);margin-bottom:4px;"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> ${r.dateStart} ~ ${r.dateEnd}</div>
        <div style="font-size:14px;color:var(--dim);"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> 處理人：${r.handler || '未填寫'}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:#f87171;text-align:center;padding:20px;">載入失敗：${err.message}</div>`;
  }
}

async function submitCounterLeave() {
  if (state.viewSemester) { showToast(`正在查看封存學期 ${state.viewSemester}，不能登記請假`, 'error'); return; }
  const targetId = document.getElementById('cl-target').value;
  const startDateStr = document.getElementById('cl-start-date').value;
  const endDateStr = document.getElementById('cl-end-date').value;
  const handler = document.getElementById('cl-handler').value.trim();

  if (!targetId) {
    playClickSound('dev_error');
    showToast('請先搜尋並選擇要請假的學生！', 'error');
    return;
  }

  if (!startDateStr || !endDateStr) {
    playClickSound('dev_error');
    showToast('請填寫完整請假日期區間！', 'error');
    return;
  }

  if (startDateStr > endDateStr) {
    playClickSound('dev_error');
    showToast('結束日期不能早於開始日期！', 'error');
    return;
  }

  const student = state.students.find(s => s.id === targetId);
  if (!student) return;

  const btn = document.querySelector('#counter-leave-modal .modal-btn:last-child');
  if (btn) { btn.disabled = true; btn.textContent = '處理中...'; }
  showLoading(true);

  try {
    // 1. 以完整年月日配對點名欄位，同時相容舊式的 "X月Y日"。
    const updates = [];
    const matchedCols = getExportColumnEntries()
      .filter(entry => entry.iso >= startDateStr && entry.iso <= endDateStr)
      .map(entry => entry.column);
    // 後端沒有欄位的日期：只能先存在這台裝置 (總表會顯示，等欄位建立後自動補送)
    let localOnlyDays = 0;
    {
      const cursor = parseISODate(startDateStr);
      const endDate = parseISODate(endDateStr);
      const known = new Set(getExportColumnEntries().map(entry => entry.iso));
      while (cursor && endDate && cursor <= endDate && localOnlyDays < 400) {
        const iso = cursor.toISOString().slice(0, 10);
        if (!known.has(iso)) {
          student.attendance[iso] = '◎';
          recordPendingAttendance(student.id, iso, '◎');
          localOnlyDays++;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    if (matchedCols.length > 0) {
      const pageUpdate = { pageId: student.id, dates: {} };
      for (const c of matchedCols) {
        pageUpdate.dates[c] = '◎'; // 強制覆寫為請假
        student.attendance[c] = '◎'; // 本地更新
      }
      updates.push(pageUpdate);

      // 送出至總表 (分批每45筆)
      for (let i = 0; i < updates.length; i += 45) {
        await window._api.updateAttendance(updates.slice(i, i + 45));
      }
    } else if (localOnlyDays > 0) {
      showToast(`後端點名表還沒有這 ${localOnlyDays} 天的欄位，請假先暫存在這台裝置的總表`, 'info');
    } else {
      showToast('警告：選擇的請假範圍未涵蓋目前點名表的任何一天！將只記錄歷史，不修改總表。', 'info');
    }

    // 2. 紀錄至電話請假紀錄 DB
    const leaveAddRes = await fetch(CONFIG.WORKER_URL + '/api/leave-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: student.name,
        roomBed: `${student.room} - ${student.bed}`,
        dateStart: startDateStr,
        dateEnd: endDateStr,
        handler: handler
      })
    });

    // 若 worker 回傳 500 表示可能未設定環境變數
    if (!leaveAddRes.ok) {
      console.warn('電話紀錄寫入失敗，可能未配置 LEAVE_DB_ID。');
      showToast('總表已更新◎，但歷史紀錄寫入失敗 (請確認 Cloudflare 已設定 LEAVE_DB_ID)', 'info');
    } else {
      playClickSound('all_present');
      showToast(`已經為 ${student.name} 完成起迄請假設定並寫入紀錄！`, 'success');
    }

    if (currentPage === 'summary') renderSummary();
    if (currentPage === 'rollcall') renderRollCall();

    closeModal('counter-leave-modal');
  } catch (err) {
    showToast('更新失敗：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '送出請假'; }
    showLoading(false);
  }
}

window.openCounterLeaveModal = openCounterLeaveModal;
window.handleCounterLeaveSearch = handleCounterLeaveSearch;
window.submitCounterLeave = submitCounterLeave;
window.viewLeaveRecords = viewLeaveRecords;
window.renderLeaveRecordsList = renderLeaveRecordsList;

// ═════════════════════════════════════════════════════════════════════════════
// 個人請假查詢：挑一位住宿生，看他這學期每一天的請假狀況
// ═════════════════════════════════════════════════════════════════════════════
const LEAVE_LOOKUP_STATUS = {
  '◎': { text: '請假', className: 'leave' },
  '△': { text: '特殊', className: 'special' },
  '✘': { text: '未請假', className: 'absent' },
};

let leaveLookupStudentId = null;
let leaveLookupQuery = '';
let _llSearchTimer = 0;
let _llRecordsCache = null;   // 電話請假紀錄整份快取 (同一次進頁面只抓一次)
let _llRecordsError = '';
let _llRecordsLoading = false;

function openLeaveLookup() {
  leaveLookupStudentId = null;
  leaveLookupQuery = '';
  navigateTo('leave-lookup');
  const input = document.getElementById('ll-search-input');
  if (input) {
    input.value = '';
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 320);
  }
  renderLeaveLookup();
}

function onLeaveLookupSearch(value) {
  clearTimeout(_llSearchTimer);
  _llSearchTimer = setTimeout(() => {
    leaveLookupQuery = value;
    leaveLookupStudentId = null;
    renderLeaveLookup();
  }, 140);
}

function selectLeaveLookupStudent(id) {
  leaveLookupStudentId = id;
  haptic('light');
  renderLeaveLookup();
  ensureLeaveLookupRecords();
  const panel = document.getElementById('ll-detail');
  if (panel) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
}

function clearLeaveLookupStudent() {
  leaveLookupStudentId = null;
  haptic('light');
  renderLeaveLookup();
}

// 姓名／房號／床號／學號／班別皆可；姓名另外吃同音字 (跟資料微動查詢同一套)
function leaveLookupMatches(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  const phonetic = window.sfPhoneticSearch;
  return state.students.filter(s => {
    if (s.hidden) return false;
    if (s.isEmpty) return false;
    const txt = `${s.name || ''} ${s.room || ''} ${s.bed || ''} ${s.studentId || ''} ${s.class || ''}`.toLowerCase();
    if (txt.includes(q)) return true;
    return !!(phonetic && phonetic.matches(s.name || '', raw));
  }).slice(0, 30);
}

// 這位學生的逐日狀態：以點名欄位為主，再補上只存在本機的暫存日期
function leaveLookupTimeline(student) {
  const byIso = new Map();
  for (const entry of getExportColumnEntries()) {
    byIso.set(entry.iso, { iso: entry.iso, column: entry.column, status: student.attendance[entry.column] || '✓' });
  }
  for (const [key, value] of Object.entries(student.attendance || {})) {
    if (!parseISODate(key)) continue;
    if (byIso.has(key)) { if (value) byIso.get(key).status = value; continue; }
    byIso.set(key, { iso: key, column: key, status: value || '✓', localOnly: true });
  }
  return [...byIso.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

function leaveLookupDaysBetween(fromIso, toIso) {
  const a = parseISODate(fromIso);
  const b = parseISODate(toIso);
  if (!a || !b) return Infinity;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// 連續幾天同一種狀態就併成一段；中間隔超過 3 天 (例如寒暑假) 就拆開
function leaveLookupRanges(timeline) {
  const out = [];
  let previous = null;
  for (const day of timeline) {
    if (!LEAVE_LOOKUP_STATUS[day.status]) { previous = day; continue; }
    const last = out[out.length - 1];
    const contiguous = !!(last && previous && last.endIso === previous.iso &&
      leaveLookupDaysBetween(last.endIso, day.iso) <= 3);
    if (last && last.status === day.status && contiguous) {
      last.endIso = day.iso;
      last.days++;
    } else {
      out.push({ status: day.status, startIso: day.iso, endIso: day.iso, days: 1 });
    }
    previous = day;
  }
  return out.reverse(); // 最近的排最上面
}

function leaveLookupDateLabel(iso) {
  const d = parseISODate(iso);
  if (!d) return iso;
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${week})`;
}

function leaveLookupRangeRow(range) {
  const meta = LEAVE_LOOKUP_STATUS[range.status] || { text: '其他', className: 'empty' };
  const single = range.startIso === range.endIso;
  const label = single
    ? leaveLookupDateLabel(range.startIso)
    : `${leaveLookupDateLabel(range.startIso)} ～ ${leaveLookupDateLabel(range.endIso)}`;
  const detail = single ? sfEsc(range.startIso) : `${sfEsc(range.startIso)} 至 ${sfEsc(range.endIso)} ・ ${range.days} 天`;
  return `<li class="summary-detail-row">
    <div class="summary-detail-row-main">
      <strong>${sfEsc(label)}</strong>
      <span>${detail}</span>
    </div>
    <span class="summary-detail-status ${meta.className}">${meta.text}</span>
  </li>`;
}

function leaveLookupGroup(title, ranges, emptyText) {
  if (!ranges.length) {
    return `<section class="summary-detail-group">
      <div class="summary-detail-group-title"><h2>${sfEsc(title)}</h2><span>0 筆</span></div>
      <ul><li class="summary-detail-row"><div class="summary-detail-row-main"><strong>${sfEsc(emptyText)}</strong></div></li></ul>
    </section>`;
  }
  const totalDays = ranges.reduce((sum, r) => sum + r.days, 0);
  return `<section class="summary-detail-group">
    <div class="summary-detail-group-title"><h2>${sfEsc(title)}</h2><span>${ranges.length} 段 ・ ${totalDays} 天</span></div>
    <ul>${ranges.map(leaveLookupRangeRow).join('')}</ul>
  </section>`;
}

async function ensureLeaveLookupRecords() {
  if (_llRecordsCache || _llRecordsLoading) { renderLeaveLookupRecords(); return; }
  _llRecordsLoading = true;
  _llRecordsError = '';
  renderLeaveLookupRecords();
  try {
    const res = await fetch(CONFIG.WORKER_URL + '/api/leave-records');
    if (!res.ok) throw new Error('API 回應錯誤');
    const data = await res.json();
    _llRecordsCache = Array.isArray(data) ? data : [];
  } catch (err) {
    _llRecordsError = err.message || '載入失敗';
  } finally {
    _llRecordsLoading = false;
    renderLeaveLookupRecords();
  }
}

function leaveLookupRecordsFor(student) {
  if (!_llRecordsCache) return [];
  const name = String(student.name || '').trim();
  const room = String(student.room || '').trim();
  return _llRecordsCache.filter(r => {
    if (String(r.name || '').trim() !== name) return false;
    const roomBed = String(r.roomBed || '');
    if (room && roomBed && !roomBed.includes(room)) return false; // 同名不同房就排除
    return true;
  }).sort((a, b) => String(b.dateStart || '').localeCompare(String(a.dateStart || '')));
}

function renderLeaveLookupRecords() {
  const box = document.getElementById('ll-records');
  if (!box) return;
  const student = leaveLookupStudentId ? state.students.find(s => s.id === leaveLookupStudentId) : null;
  if (!student) { box.innerHTML = ''; return; }
  if (_llRecordsLoading) {
    box.innerHTML = '<div class="ll-hint">正在讀取電話請假紀錄…</div>';
    return;
  }
  if (_llRecordsError) {
    box.innerHTML = `<div class="ll-hint ll-hint-error">電話請假紀錄載入失敗：${sfEsc(_llRecordsError)}</div>`;
    return;
  }
  const records = leaveLookupRecordsFor(student);
  if (!records.length) {
    box.innerHTML = `<section class="summary-detail-group">
      <div class="summary-detail-group-title"><h2>電話／櫃台請假紀錄</h2><span>0 筆</span></div>
      <ul><li class="summary-detail-row"><div class="summary-detail-row-main"><strong>沒有替這位同學留下的通報紀錄</strong><span>總表上的請假仍以上面的逐日紀錄為準</span></div></li></ul>
    </section>`;
    return;
  }
  box.innerHTML = `<section class="summary-detail-group">
    <div class="summary-detail-group-title"><h2>電話／櫃台請假紀錄</h2><span>${records.length} 筆</span></div>
    <ul>${records.map(r => `<li class="summary-detail-row">
      <div class="summary-detail-row-main">
        <strong>${sfEsc(r.dateStart || '')} ～ ${sfEsc(r.dateEnd || '')}</strong>
        <span>處理人：${sfEsc(r.handler || '未填寫')}${r.createdAt ? ' ・ 登記於 ' + sfEsc(formatLeaveStamp(r.createdAt)) : ''}</span>
      </div>
      <span class="summary-detail-status leave">通報</span>
    </li>`).join('')}</ul>
  </section>`;
}

function renderLeaveLookupDetail(student) {
  const timeline = leaveLookupTimeline(student);
  const counts = { '✓': 0, '◎': 0, '△': 0, '✘': 0 };
  for (const day of timeline) counts[day.status] = (counts[day.status] || 0) + 1;
  const leaveTotal = counts['◎'] + counts['△'];
  const ranges = leaveLookupRanges(timeline);
  const leaveRanges = ranges.filter(r => r.status === '◎' || r.status === '△');
  const absentRanges = ranges.filter(r => r.status === '✘');
  const recorded = timeline.length;
  const rate = recorded > 0 ? Math.round((leaveTotal / recorded) * 100 * 10) / 10 : 0;
  const info = [student.class, student.studentId, student.squad].filter(Boolean).map(sfEsc).join(' ・ ');

  return `<section class="ll-person-card">
      <div class="ll-person-top">
        <div class="ll-person-main">
          <strong>${sfEsc(student.name || '未填姓名')}</strong>
          <span>${sfEsc(student.room || '未填房號')} ${sfEsc(student.bed || '未填')}床${info ? ' ・ ' + info : ''}</span>
        </div>
        <button type="button" class="ll-change-btn" onclick="clearLeaveLookupStudent()">換一位</button>
      </div>
    </section>
    <section class="summary-calculation-card" aria-label="請假統計">
      <div class="summary-calculation-heading"><span>請假天數</span><strong>${leaveTotal}</strong></div>
      <div class="summary-formula-rows">
        <div><span>請假 ◎</span><b>${counts['◎']}</b></div>
        <div><span>特殊 △</span><b>${counts['△']}</b></div>
        <div><span>未請假 ✘</span><b>${counts['✘']}</b></div>
        <div><span>正常在宿 ✓</span><b>${counts['✓']}</b></div>
        <div class="result"><span>已記錄天數 ・ 請假佔比</span><b>${recorded} 天 ・ ${rate}%</b></div>
      </div>
    </section>
    <div class="summary-detail-list-heading"><h2>逐段明細</h2><span>${ranges.length} 段</span></div>
    ${leaveLookupGroup('請假／特殊', leaveRanges, '這學期沒有請過假')}
    ${leaveLookupGroup('未請假', absentRanges, '沒有未請假紀錄')}
    <div id="ll-records"></div>`;
}

function renderLeaveLookup() {
  const subtitle = document.getElementById('ll-subtitle');
  const resultsEl = document.getElementById('ll-results');
  const detailEl = document.getElementById('ll-detail');
  if (!resultsEl || !detailEl) return;

  const recordedDays = getExportColumnEntries().length;
  if (subtitle) {
    const sem = activeSemesterName();
    subtitle.textContent = `${sem ? sem + ' ・ ' : ''}目前共有 ${recordedDays} 天點名紀錄`;
  }

  const student = leaveLookupStudentId ? state.students.find(s => s.id === leaveLookupStudentId) : null;
  if (student) {
    resultsEl.innerHTML = '';
    detailEl.innerHTML = renderLeaveLookupDetail(student);
    renderLeaveLookupRecords();
    return;
  }

  detailEl.innerHTML = '';
  const raw = String(leaveLookupQuery || '').trim();
  if (!raw) {
    resultsEl.innerHTML = '<div class="ll-hint">先在上面輸入姓名、房號、床號或學號，再從清單挑一位同學。</div>';
    return;
  }
  const matches = leaveLookupMatches(raw);
  if (!matches.length) {
    resultsEl.innerHTML = `<div class="ll-hint">找不到「${sfEsc(raw)}」這位住宿生。</div>`;
    return;
  }
  resultsEl.innerHTML = `<div class="summary-detail-list-heading"><h2>搜尋結果</h2><span>${matches.length} 位</span></div>
    ${matches.map(s => `<button type="button" class="ll-result-btn" onclick="selectLeaveLookupStudent('${sfEsc(s.id)}')">
      <div class="ll-result-main">
        <strong>${sfEsc(s.name || '未填姓名')}</strong>
        <span>${sfEsc(s.room || '未填房號')} ${sfEsc(s.bed || '未填')}床${s.class ? ' ・ ' + sfEsc(s.class) : ''}${s.studentId ? ' ・ ' + sfEsc(s.studentId) : ''}</span>
      </div>
      <span class="ll-result-arrow" aria-hidden="true">›</span>
    </button>`).join('')}`;
}

window.openLeaveLookup = openLeaveLookup;
window.onLeaveLookupSearch = onLeaveLookupSearch;
window.selectLeaveLookupStudent = selectLeaveLookupStudent;
window.clearLeaveLookupStudent = clearLeaveLookupStudent;
window.renderLeaveLookup = renderLeaveLookup;

// ═══════════════════════════════════════════════════════════════════════════════
// 通知報修系統
// ═══════════════════════════════════════════════════════════════════════════════
let repairPhotos = []; // base64 array

function openRepairForm() {
  repairPhotos = [];
  navigateTo('repair-form');
  const reporter = document.getElementById('repair-reporter');
  if (reporter) reporter.value = '';
  const reason = document.getElementById('repair-reason');
  if (reason) reason.value = '';
  const grid = document.getElementById('repair-preview-grid');
  if (grid) grid.innerHTML = '';
}

function handleRepairPhotos(input) {
  const files = Array.from(input.files);
  files.forEach(file => {
    if (repairPhotos.length >= 3) return; // 最多 3 張
    const reader = new FileReader();
    reader.onload = e => {
      // 壓縮圖片
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 600;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.6);
        repairPhotos.push(compressed);
        renderRepairPreviews();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function renderRepairPreviews() {
  const grid = document.getElementById('repair-preview-grid');
  if (!grid) return;
  grid.innerHTML = repairPhotos.map((src, i) => `
    <div class="repair-preview-item">
      <img src="${src}" alt="照片${i + 1}">
      <button class="repair-preview-remove" onclick="removeRepairPhoto(${i})">✕</button>
    </div>
  `).join('');
}

function removeRepairPhoto(index) {
  repairPhotos.splice(index, 1);
  renderRepairPreviews();
}

async function submitRepair() {
  const reporter = document.getElementById('repair-reporter')?.value?.trim();
  const reason = document.getElementById('repair-reason')?.value?.trim();
  if (!reporter) {
    showToast('請填寫報修人', 'error');
    return;
  }
  if (!reason) {
    showToast('請填寫報修原因', 'error');
    return;
  }

  showLoading(true);
  try {
    const res = await fetch(window.CONFIG.WORKER_URL + '/api/repair-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reporter: reporter,
        name: reporter, // Fallback for backend that checks 'name'
        reason: reason,
        photos: repairPhotos
      })
    });
    const data = await res.json();
    if (data.success) {
      playClickSound('all_present');
      showToast('報修通知已送出！', 'success');
      repairPhotos = [];
      navigateTo('tools');
    } else {
      throw new Error(data.error || '送出失敗');
    }
  } catch (err) {
    showToast('送出失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function openRepairReview() {
  navigateTo('repair-review');
  renderRepairReviewList();
}

async function renderRepairReviewList() {
  const container = document.getElementById('repair-review-list');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:20px;">讀取中...</div>';

  try {
    const res = await fetch(window.CONFIG.WORKER_URL + '/api/repair-records');
    const records = await res.json();

    if (!records || records.length === 0) {
      container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:40px;">目前沒有任何報修紀錄 <svg class="ui-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg></div>';
      return;
    }

    let html = '';
    records.forEach(rec => {
      const timeStr = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : '未知';
      const photosHtml = (rec.photos || []).map(src =>
        `<img src="${src}" alt="報修照片" onclick="openImagePreview('${src}')">`
      ).join('');

      html += `
        <div class="repair-record-card">
          <div class="repair-record-reporter"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0-9-9c0 1.48.36 2.89 1 4.12l-1.5 4.5 4.5-1.5c1.23.64 2.64 1 4.12 1z"/><path d="M12 12v.01"/><path d="M16 12v.01"/><path d="M8 12v.01"/></svg> 報修人：${rec.reporter || rec.name || rec.title || rec.Name || rec.author || '（未知填寫人）'}</div>
          <div class="repair-record-reason">${rec.reason || '（無描述）'}</div>
          ${photosHtml ? `<div class="repair-record-photos">${photosHtml}</div>` : ''}
          <div class="repair-record-time">⏰ ${timeStr}</div>
          <button class="repair-done-btn" onclick="markRepairDone('${rec.id}')"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 已回報處理</button>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);text-align:center;padding:20px;">讀取失敗：${err.message}</div>`;
  }
}

async function markRepairDone(id) {
  const ok = await showConfirmDialog({
    title: '確認處理完畢',
    message: '確定此報修已經回報處理完畢？紀錄將會被刪除。',
    confirmText: '確認完成',
    danger: false,
    icon: '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
  });
  if (!ok) return;
  showLoading(true);
  try {
    const res = await fetch(window.CONFIG.WORKER_URL + '/api/repair-records', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.success) {
      showToast('已標記為處理完畢', 'success');
      renderRepairReviewList();
    } else {
      throw new Error(data.error || '操作失敗');
    }
  } catch (err) {
    showToast('操作失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

window.openRepairForm = openRepairForm;
window.handleRepairPhotos = handleRepairPhotos;
window.removeRepairPhoto = removeRepairPhoto;
window.submitRepair = submitRepair;
window.openRepairReview = openRepairReview;
window.renderRepairReviewList = renderRepairReviewList;
window.markRepairDone = markRepairDone;

// ═══════════════════════════════════════════════════════════════════════════════
// 意見回饋系統
// ═══════════════════════════════════════════════════════════════════════════════
let feedbackPhotos = []; // base64 array

function openFeedbackForm() {
  feedbackPhotos = [];
  navigateTo('feedback-form');
  const nameInput = document.getElementById('feedback-name');
  if (nameInput) nameInput.value = '';
  const content = document.getElementById('feedback-content');
  if (content) content.value = '';
  const grid = document.getElementById('feedback-preview-grid');
  if (grid) grid.innerHTML = '';
  // 重置送出按鈕狀態
  const btn = document.getElementById('feedback-submit-btn');
  if (btn) btn.classList.remove('sent');
}

function handleFeedbackPhotos(input) {
  const files = Array.from(input.files);
  files.forEach(file => {
    if (feedbackPhotos.length >= 3) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 600;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', 0.6);
        feedbackPhotos.push(compressed);
        renderFeedbackPreviews();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function renderFeedbackPreviews() {
  const grid = document.getElementById('feedback-preview-grid');
  if (!grid) return;
  grid.innerHTML = feedbackPhotos.map((src, i) => `
    <div class="repair-preview-item">
      <img src="${src}" alt="截圖${i + 1}">
      <button class="repair-preview-remove" onclick="removeFeedbackPhoto(${i})">✕</button>
    </div>
  `).join('');
}

function removeFeedbackPhoto(index) {
  feedbackPhotos.splice(index, 1);
  renderFeedbackPreviews();
}

async function submitFeedback() {
  const name = document.getElementById('feedback-name')?.value?.trim() || '匿名';
  const content = document.getElementById('feedback-content')?.value?.trim();
  const btn = document.getElementById('feedback-submit-btn');

  if (!content) {
    showToast('請填寫您的建議或意見', 'error');
    // 確保按鈕沒有被 focus 所以不會觸發紙飛機動畫
    if (btn) btn.blur();
    return;
  }

  // 通過驗證才觸發送出動畫
  if (btn) btn.focus();

  try {
    const res = await fetch(window.CONFIG.WORKER_URL + '/api/feedback-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        content: content,
        photos: feedbackPhotos
      })
    });
    const data = await res.json();
    if (data.success) {
      playClickSound('all_present');
      showToast('感謝您的回饋！我們會認真閱讀 <svg class="ui-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>', 'success');
      feedbackPhotos = [];
      // 延遲跳轉讓送出動畫播完
      setTimeout(() => navigateTo('home'), 2000);
    } else {
      if (btn) btn.blur();
      throw new Error(data.error || '送出失敗');
    }
  } catch (err) {
    if (btn) btn.blur();
    showToast('送出失敗：' + err.message, 'error');
  }
}

function openFeedbackReview() {
  navigateTo('feedback-review');
  renderFeedbackReviewList();
}

async function renderFeedbackReviewList() {
  const container = document.getElementById('feedback-review-list');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:20px;">讀取中...</div>';

  try {
    const res = await fetch(window.CONFIG.WORKER_URL + '/api/feedback-records');
    const records = await res.json();

    // 隱藏未讀紅點
    const dot = document.getElementById('feedback-unread-dot');
    const badge = document.getElementById('feedback-badge');
    if (dot) dot.style.display = 'none';
    if (badge) badge.style.display = 'none';

    if (!records || records.length === 0) {
      container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:40px;">目前沒有任何用戶回饋 <svg class="ui-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg></div>';
      return;
    }

    let html = '';
    records.forEach(rec => {
      const timeStr = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : '未知';
      const photosHtml = (rec.photos || []).map(src =>
        `<img src="${src}" alt="回饋截圖" style="width:80px;height:80px;object-fit:cover;border-radius:8px;cursor:pointer;" onclick="openImagePreview('${src}')">`
      ).join('');

      html += `
        <div class="repair-record-card">
          <div class="repair-record-reporter"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="m16 11 2-2"/><path d="m18 9 2-2"/><path d="m18 9 2 2"/><path d="m18 9-2-2"/></svg> ${rec.name || '匿名'}</div>
          <div class="repair-record-reason">${rec.content || '（無內容）'}</div>
          ${photosHtml ? `<div class="repair-record-photos">${photosHtml}</div>` : ''}
          <div class="repair-record-time">⏰ ${timeStr}</div>
          <button class="repair-done-btn" onclick="markFeedbackRead('${rec.id}')"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 已讀並歸檔</button>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);text-align:center;padding:20px;">讀取失敗：${err.message}</div>`;
  }
}

async function markFeedbackRead(id) {
  const ok = await showConfirmDialog({
    title: '歸檔回饋',
    message: '確定要將此回饋標記為已讀並歸檔嗎？',
    confirmText: '已讀歸檔',
    danger: false,
    icon: '<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>'
  });
  if (!ok) return;
  showLoading(true);
  try {
    const res = await fetch(window.CONFIG.WORKER_URL + '/api/feedback-records', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (data.success) {
      showToast('已標記為已讀', 'success');
      renderFeedbackReviewList();
    } else {
      throw new Error(data.error || '操作失敗');
    }
  } catch (err) {
    showToast('操作失敗：' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// 檢查是否有未讀回饋（在開發者面板開啟時檢查）
async function checkUnreadFeedback() {
  try {
    const res = await fetch(window.CONFIG.WORKER_URL + '/api/feedback-records');
    const records = await res.json();
    if (records && records.length > 0) {
      const dot = document.getElementById('feedback-unread-dot');
      const badge = document.getElementById('feedback-badge');
      if (dot) dot.style.display = 'inline-block';
      if (badge) badge.style.display = 'block';
    }
  } catch (_) { }
}

window.openFeedbackForm = openFeedbackForm;
window.handleFeedbackPhotos = handleFeedbackPhotos;
window.removeFeedbackPhoto = removeFeedbackPhoto;
window.submitFeedback = submitFeedback;
window.openFeedbackReview = openFeedbackReview;
window.renderFeedbackReviewList = renderFeedbackReviewList;
window.markFeedbackRead = markFeedbackRead;
window.checkUnreadFeedback = checkUnreadFeedback;

// ═════════════════════════════════════════════════════════════════════════════
// 住宿生檔案管理（Excel 式表格；欄位順序與匯出檔一致，不顯示點名／請假日期）
// ═════════════════════════════════════════════════════════════════════════════
let _rmRenderMap = new WeakMap();
const _rmSaving = new Set();

function rmRowValues(row) {
  return {
    name: row.querySelector('.rm-input-name').value.trim(),
    class: row.querySelector('.rm-input-class').value.trim(),
    studentId: row.querySelector('.rm-input-id').value.trim(),
    phone: row.querySelector('.rm-input-phone').value.trim(),
    address: row.querySelector('.rm-input-address').value.trim(),
    remarks: row.querySelector('.rm-input-remarks').value.trim(),
    isForeign: row.querySelector('.rm-input-foreign').checked,
    isEmpty: row.querySelector('.rm-input-empty').checked,
  };
}

function rmFingerprint(values) {
  return JSON.stringify([
    values.name || '', values.class || '', values.studentId || '',
    values.phone || '', values.address || '', values.remarks || '',
    !!values.isForeign, !!values.isEmpty,
  ]);
}

function rmStudentFingerprint(student) {
  return rmFingerprint({
    name: student.name,
    class: student.class,
    studentId: student.studentId,
    phone: student.phone,
    address: student.address,
    remarks: student.remarks,
    isForeign: student.isForeign,
    isEmpty: student.isEmpty || !student.name,
  });
}

function updateResidentDirtyCount() {
  const dirtyRows = Array.from(document.querySelectorAll('#rm-table-body tr.is-dirty'));
  const button = document.getElementById('rm-save-all');
  const badge = document.getElementById('rm-dirty-count');
  if (!button || !badge) return;
  button.disabled = dirtyRows.length === 0 || button.classList.contains('is-saving');
  badge.hidden = dirtyRows.length === 0;
  badge.textContent = dirtyRows.length;
}

window.markResidentRowDirty = function (row) {
  const student = _rmRenderMap.get(row);
  if (!student) return;
  const dirty = rmFingerprint(rmRowValues(row)) !== rmStudentFingerprint(student);
  row.classList.toggle('is-dirty', dirty);
  const button = row.querySelector('.rm-row-save');
  if (button && !_rmSaving.has(student.id)) {
    button.disabled = !dirty;
    button.textContent = dirty ? '儲存此列' : '已同步';
    button.classList.remove('is-saved', 'is-error');
  }
  updateResidentDirtyCount();
};

function residentRowHTML(student, rowNumber) {
  const isEmpty = student.isEmpty || !student.name;
  const bedLabel = `${student.room || ''} ${student.bed || ''}`.trim() || `第 ${rowNumber} 列`;
  return `<tr oninput="markResidentRowDirty(this)" onchange="markResidentRowDirty(this)">
    <td class="rm-row-number">${rowNumber}</td>
    <td><input class="rm-cell-input rm-input-name" type="text" value="${sfEsc(student.name || '')}" aria-label="${sfEsc(bedLabel)} 名稱"></td>
    <td><span class="rm-readonly">${sfEsc(student.room || '')}</span></td>
    <td><span class="rm-readonly">${sfEsc(student.bed || '')}</span></td>
    <td><input class="rm-cell-input rm-input-class" type="text" value="${sfEsc(student.class || '')}" aria-label="${sfEsc(bedLabel)} 班別"></td>
    <td><input class="rm-cell-input rm-input-id" type="text" value="${sfEsc(student.studentId || '')}" aria-label="${sfEsc(bedLabel)} 學號"></td>
    <td><input class="rm-cell-input rm-input-phone" type="tel" inputmode="tel" value="${sfEsc(student.phone || '')}" aria-label="${sfEsc(bedLabel)} 電話"></td>
    <td><input class="rm-cell-input rm-input-address" type="text" value="${sfEsc(student.address || '')}" aria-label="${sfEsc(bedLabel)} 住址"></td>
    <td class="rm-check-cell"><label class="rm-check"><span class="sr-only">${sfEsc(bedLabel)} 外籍生</span><input class="rm-input-foreign" type="checkbox" ${student.isForeign ? 'checked' : ''}></label></td>
    <td class="rm-check-cell"><label class="rm-check"><span class="sr-only">${sfEsc(bedLabel)} 空床</span><input class="rm-input-empty" type="checkbox" ${isEmpty ? 'checked' : ''}></label></td>
    <td><textarea class="rm-cell-remarks rm-input-remarks" rows="1" aria-label="${sfEsc(bedLabel)} 備註">${sfEsc(student.remarks || '')}</textarea></td>
    <td class="rm-check-cell"><button type="button" class="rm-row-save" onpointerdown="this.dataset.savePress='1'" onpointerup="if(this.dataset.savePress){delete this.dataset.savePress;saveResidentRow(this)}" onpointerleave="delete this.dataset.savePress" onpointercancel="delete this.dataset.savePress" onclick="saveResidentRow(this)" disabled>已同步</button></td>
  </tr>`;
}

// ─── 觸控守門員 ───────────────────────────────────────────────────────────────
// 手機上手指在表格裡滑動，很容易被瀏覽器判成「點進某個輸入框」，鍵盤跳出來、畫面也跟著彈。
// 做法：觸控裝置上所有輸入框先設成唯讀 (唯讀 = 手指按著拖曳只會捲動，不會聚焦、不會彈鍵盤)，
// 真的是「原地點一下」才解開唯讀並聚焦。拖過的手勢連勾選框與按鈕也一併擋掉。
const RM_TAP_SLOP = 10;     // 位移超過 10px 就算是在滑動，不是在點
const RM_TAP_MS = 700;      // 按太久也不算單點
let _rmTouchGuardBound = false;
let _rmTouch = null;
let _rmMoved = false;

function rmIsTouchDevice() {
  return window.matchMedia?.('(pointer: coarse)')?.matches || 'ontouchstart' in window;
}

function rmLockEditors(scope) {
  if (!rmIsTouchDevice()) return;
  for (const el of scope.querySelectorAll('.rm-cell-input, .rm-cell-remarks')) {
    if (document.activeElement !== el) el.readOnly = true;
  }
}

function rmUnlockEditor(el) {
  if (!el || !el.readOnly) return;
  el.readOnly = false;
  el.focus({ preventScroll: true });
  // 點哪裡游標就在哪裡；解開唯讀當下 selection 會跑掉，補回文字尾端比較符合直覺
  const end = el.value.length;
  try { el.setSelectionRange(end, end); } catch (_) { }
}

function rmBindTouchGuard() {
  const shell = document.querySelector('.rm-table-shell');
  if (!shell || _rmTouchGuardBound) return;
  _rmTouchGuardBound = true;

  shell.addEventListener('touchstart', e => {
    const t = e.touches[0];
    _rmTouch = { x: t.clientX, y: t.clientY, at: Date.now() };
    _rmMoved = false;
  }, { passive: true });

  shell.addEventListener('touchmove', e => {
    if (!_rmTouch) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - _rmTouch.x) > RM_TAP_SLOP || Math.abs(t.clientY - _rmTouch.y) > RM_TAP_SLOP) _rmMoved = true;
  }, { passive: true });

  shell.addEventListener('touchend', () => {
    if (_rmTouch && Date.now() - _rmTouch.at > RM_TAP_MS) _rmMoved = true;
  }, { passive: true });

  // 捕獲階段：滑動途中產生的點擊 (誤觸勾選框、誤按儲存) 直接吃掉
  shell.addEventListener('click', e => {
    if (!_rmMoved) {
      const editor = e.target.closest?.('.rm-cell-input, .rm-cell-remarks');
      if (editor) rmUnlockEditor(editor);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    _rmMoved = false;
  }, true);

  // 離開欄位就重新上鎖，下一次滑動才不會又被攔截
  shell.addEventListener('focusout', e => {
    const el = e.target;
    if (rmIsTouchDevice() && el?.matches?.('.rm-cell-input, .rm-cell-remarks')) el.readOnly = true;
  });

  rmBindPinchZoom(shell);
}

// ─── 雙指縮放總表 ─────────────────────────────────────────────────────────────
// 整個 App 關掉了瀏覽器縮放，所以表格自己處理：兩指捏合改 --rm-zoom，手指中間那一格保持在原位。
// 電腦上按住 Ctrl 滾輪 (或觸控板捏合) 也行。倍率記在 localStorage，下次打開還是同樣大小。
const RM_ZOOM_MIN = 0.6;
const RM_ZOOM_MAX = 2.5;
const RM_ZOOM_KEY = 'rm-table-zoom';
let _rmZoom = 1;

function rmClampZoom(z) {
  return Math.min(RM_ZOOM_MAX, Math.max(RM_ZOOM_MIN, Math.round(z * 100) / 100));
}

function rmApplyZoom(shell, zoom, cx, cy) {
  const next = rmClampZoom(zoom);
  const prev = _rmZoom;
  if (next === prev) return;
  // 以 (cx, cy) 為錨點：縮放前後，這個位置底下的內容不動
  const contentX = (shell.scrollLeft + cx) / prev;
  const contentY = (shell.scrollTop + cy) / prev;
  _rmZoom = next;
  shell.style.setProperty('--rm-zoom', next);
  shell.scrollLeft = contentX * next - cx;
  shell.scrollTop = contentY * next - cy;
  rmShowZoomBadge(shell, next);
}

function rmShowZoomBadge(shell, zoom) {
  let badge = document.getElementById('rm-zoom-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'rm-zoom-badge';
    badge.className = 'rm-zoom-badge';
    shell.parentElement.insertBefore(badge, shell);
  }
  badge.textContent = `${Math.round(zoom * 100)}%`;
  badge.classList.add('is-visible');
  clearTimeout(badge._hideTimer);
  badge._hideTimer = setTimeout(() => badge.classList.remove('is-visible'), 900);
}

function rmBindPinchZoom(shell) {
  try { _rmZoom = rmClampZoom(parseFloat(localStorage.getItem(RM_ZOOM_KEY)) || 1); } catch (_) { _rmZoom = 1; }
  shell.style.setProperty('--rm-zoom', _rmZoom);
  const save = () => { try { localStorage.setItem(RM_ZOOM_KEY, String(_rmZoom)); } catch (_) { } };

  let pinch = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const center = (a, b) => {
    const r = shell.getBoundingClientRect();
    return { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top };
  };

  shell.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    pinch = { d: dist(e.touches[0], e.touches[1]), zoom: _rmZoom };
    _rmMoved = true; // 兩指手勢不算點擊
    document.activeElement?.blur?.();
  }, { passive: true });

  shell.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = e.touches;
    const c = center(a, b);
    rmApplyZoom(shell, pinch.zoom * dist(a, b) / pinch.d, c.x, c.y);
  }, { passive: false });

  const end = e => {
    if (!pinch || e.touches.length >= 2) return;
    pinch = null;
    save();
  };
  shell.addEventListener('touchend', end, { passive: true });
  shell.addEventListener('touchcancel', end, { passive: true });

  // iOS Safari 不理 user-scalable=no，會自己放大整頁，要擋掉
  shell.addEventListener('gesturestart', e => e.preventDefault());
  shell.addEventListener('gesturechange', e => e.preventDefault());

  shell.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = shell.getBoundingClientRect();
    rmApplyZoom(shell, _rmZoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    save();
  }, { passive: false });
}

function renderResidentManagement() {
  const body = document.getElementById('rm-table-body');
  if (!body) return;
  _rmRenderMap = new WeakMap();
  // 不額外排序：直接使用 Excel 匯出的 state.students 順序。
  body.innerHTML = state.students.map((student, index) => residentRowHTML(student, index + 1)).join('');
  Array.from(body.rows).forEach((row, index) => _rmRenderMap.set(row, state.students[index]));
  rmBindTouchGuard();
  rmLockEditors(body);
  filterResidentManagement();
  updateResidentDirtyCount();
}

window.filterResidentManagement = function () {
  const body = document.getElementById('rm-table-body');
  if (!body) return;
  const query = (document.getElementById('rm-search-input')?.value || '').trim().toLowerCase();
  const status = document.getElementById('rm-status-filter')?.value || 'all';
  let visible = 0;
  Array.from(body.rows).forEach(row => {
    const student = _rmRenderMap.get(row);
    if (!student) return;
    const values = rmRowValues(row);
    const text = [values.name, student.room, student.bed, values.class, values.studentId, values.phone, values.address, values.remarks, student.squad]
      .join(' ').toLowerCase();
    const statusMatch = status === 'all' ||
      (status === 'resident' && !values.isEmpty) ||
      (status === 'empty' && values.isEmpty) ||
      (status === 'foreign' && values.isForeign && !values.isEmpty);
    const show = statusMatch && (!query || text.includes(query));
    row.hidden = !show;
    if (show) visible++;
  });
  const total = state.students.length;
  const count = document.getElementById('rm-total-count');
  const countLabel = document.querySelector('.rm-total span');
  if (count) count.textContent = visible;
  if (countLabel) countLabel.textContent = visible === total ? '筆資料' : `筆資料（共 ${total} 筆）`;
  const empty = document.getElementById('rm-empty-state');
  if (empty) empty.hidden = visible !== 0;
};

window.saveResidentRow = async function (row, options = {}) {
  if (row?.matches?.('.rm-row-save')) row = row.closest('tr');
  const student = _rmRenderMap.get(row);
  if (!student || _rmSaving.has(student.id)) return false;
  const values = rmRowValues(row);
  if (rmFingerprint(values) === rmStudentFingerprint(student)) return true;
  _rmSaving.add(student.id);
  const button = row.querySelector('.rm-row-save');
  if (button) {
    button.disabled = true;
    button.textContent = '儲存中…';
    button.classList.add('is-saving');
    button.classList.remove('is-saved', 'is-error');
  }

  try {
    const updatePayload = {
      pageId: student.id,
      updateProfile: {
        name: values.isEmpty ? '' : values.name,
        class: values.class,
        studentId: values.isEmpty ? '' : values.studentId,
        phone: values.isEmpty ? '' : values.phone,
        address: values.isEmpty ? '' : values.address,
        isForeign: values.isForeign,
      },
      markEmpty: values.isEmpty,
    };
    if (values.isEmpty) updatePayload.clearProfile = true;
    await Promise.all([
      window._api.updateAttendance([updatePayload]),
      window._api.updateRemark(student.id, values.remarks),
    ]);

    student.name = values.isEmpty ? '' : values.name;
    student.class = values.class;
    student.studentId = values.isEmpty ? '' : values.studentId;
    student.phone = values.isEmpty ? '' : values.phone;
    student.address = values.isEmpty ? '' : values.address;
    student.remarks = values.remarks;
    student.isForeign = values.isForeign;
    student.isEmpty = values.isEmpty;
    row.querySelector('.rm-input-name').value = student.name;
    row.querySelector('.rm-input-id').value = student.studentId;
    row.querySelector('.rm-input-phone').value = student.phone;
    row.querySelector('.rm-input-address').value = student.address;
    row.classList.remove('is-dirty');
    localStorage.setItem('biyuan_temp_students_update', JSON.stringify(state.students));

    if (button) {
      button.textContent = '已儲存';
      button.classList.remove('is-saving');
      button.classList.add('is-saved');
      setTimeout(() => {
        if (!row.classList.contains('is-dirty')) {
          button.textContent = '已同步';
          button.classList.remove('is-saved');
          button.disabled = true;
        }
      }, 1200);
    }
    filterResidentManagement();
    if (!options.quiet) showToast(`${student.room || ''} ${student.bed || ''} 資料已儲存`, 'success');
    return true;
  } catch (err) {
    if (button) {
      button.textContent = '儲存失敗';
      button.classList.remove('is-saving');
      button.classList.add('is-error');
      button.disabled = false;
    }
    if (!options.quiet) showToast('儲存失敗：' + err.message, 'error');
    return false;
  } finally {
    _rmSaving.delete(student.id);
    updateResidentDirtyCount();
  }
};

window.saveAllResidentRows = async function () {
  const rows = Array.from(document.querySelectorAll('#rm-table-body tr.is-dirty'));
  const button = document.getElementById('rm-save-all');
  if (!rows.length || !button || button.classList.contains('is-saving')) return;
  button.classList.add('is-saving');
  button.disabled = true;
  const label = button.querySelector('span');
  if (label) label.textContent = `儲存中 0/${rows.length}`;
  let saved = 0;
  for (const row of rows) {
    if (await saveResidentRow(row, { quiet: true })) saved++;
    if (label) label.textContent = `儲存中 ${saved}/${rows.length}`;
  }
  button.classList.remove('is-saving');
  if (label) label.textContent = '儲存全部';
  updateResidentDirtyCount();
  if (saved === rows.length) showToast(`已儲存 ${saved} 筆住宿生資料`, 'success');
  else showToast(`已儲存 ${saved} 筆，${rows.length - saved} 筆失敗`, 'error');
};

window.initResidentManagement = function (resetFilters = true) {
  const body = document.getElementById('rm-table-body');
  if (!body) return;
  // 離開後再返回時保留尚未儲存的儲存格內容。
  if (body.querySelector('tr.is-dirty')) {
    filterResidentManagement();
    return;
  }
  if (resetFilters) {
    const search = document.getElementById('rm-search-input');
    const filter = document.getElementById('rm-status-filter');
    if (search) search.value = '';
    if (filter) filter.value = 'all';
  }
  renderResidentManagement();
};

// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// 住宿生檔案管理
// ═════════════════════════════════════════════════════════════════════════════
let _sfSearchTimer = null;
let _sfResults = [];
let _sfActiveIndex = 0;          // 虛擬索引 (整數，可正可負，會自動對應回名單)
let _sfRenderMap = new WeakMap(); // DOM 元素 -> 學生物件
let _sfRandomDefaults = [];

// ─── 虛擬化輪播：DOM 永遠只有 13 張卡片，滑到哪就把跑出畫面的卡片回收、換上新內容 ───
// 以前是把搜尋結果複製 5~60 次全部塞進 DOM (常常 60~500 張卡)，每張又有毛玻璃與上千個硬體圖層，
// 這就是 iPhone 左右滑會卡的主因。現在 DOM 固定 13 張，滑再多也不會變重。
// 軌道往右後方延伸，所以視窗是不對稱的：近端只留 3 本，深處留 13 本
// Fixed pool: four preceding files plus the dense forward rail, independent of roster size.
const SF_POOL_SIZE = 21;
const SF_HALF = 4;
let _sfPool = [];              // [{ el, vIndex, student }]
let _sfDrafts = new Map();     // student.id -> 尚未儲存的草稿 (卡片被回收時暫存，回來時還原)
let _sfWindowStart = null;

function getRandomStudents(count) {
  if (!state.students || state.students.length === 0) return [];
  const shuffled = [...state.students].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function sfStudentAt(vIndex) {
  // 無限循環：虛擬索引可正可負，取模對應名單，滑到底會自動接回第一張
  const n = _sfResults.length;
  if (!n) return null;
  return _sfResults[((vIndex % n) + n) % n];
}

function sfEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// 一本資料夾的摘要：名字、班別、標籤、學號 (顯示在前板玻璃上；草稿優先)
function sfSummary(s, draft) {
  const d = draft || {};
  const name = d.name !== undefined ? d.name : (s.name || '');
  const sid = d.studentId !== undefined ? d.studentId : (s.studentId || '');
  const cls = d.class !== undefined ? d.class : (s.class || s.squad || '');
  const remarks = d.remarks !== undefined ? d.remarks : (s.remarks || '');
  const isForeign = d.isForeign !== undefined ? d.isForeign : !!s.isForeign;
  const isEmpty = d.isEmpty !== undefined ? d.isEmpty : (s.isEmpty || !s.name);
  const tags = [];
  if (isEmpty) tags.push('<span class="fd-tag fd-tag-empty">空床</span>');
  if (isForeign) tags.push('<span class="fd-tag fd-tag-foreign">外籍</span>');
  if (!isEmpty && s.squad) tags.push('<span class="fd-tag">' + sfEsc(s.squad) + '</span>');
  if (remarks) tags.push('<span class="fd-tag fd-tag-remark">備註</span>');
  return {
    name: isEmpty || !name ? '空床' : name,
    nameEmpty: isEmpty || !name,
    cls: isEmpty ? '' : cls,
    sid: isEmpty ? '' : sid,
    tags: tags.join(''),
    dot: isEmpty ? 'is-empty' : isForeign ? 'is-foreign' : '',
    badge: isForeign ? '外籍生' : (isEmpty ? '空床' : (s.squad || '無班級'))
  };
}

// 把摘要寫回一本已經存在的資料夾 (儲存、清空之後用)
function sfUpdateSummary(el, s, draft) {
  if (!el || !s) return;
  const m = sfSummary(s, draft);
  const q = sel => el.querySelector(sel);
  const name = q('.fd-name'); if (name) { name.textContent = m.name; name.classList.toggle('is-empty', m.nameEmpty); }
  const rail = q('.fd-rail-label'); if (rail) rail.textContent = m.name;
  const cls = q('.fd-class'); if (cls) cls.textContent = m.cls;
  const sid = q('.fd-count'); if (sid) sid.textContent = m.sid;
  const tags = q('.fd-tags'); if (tags) tags.innerHTML = m.tags;
  for (const dot of el.querySelectorAll('.fd-tab i')) dot.className = m.dot;
  const badge = q('.sf-card-badge-relative'); if (badge) badge.textContent = m.badge;
}

// 資料夾 DOM：6 層真正有 Z 深度的殼 (背板+標籤 / 左右側邊 / 內頁 / 前板玻璃+摘要 / 邊緣高光) + 抽出來的詳細資料紙
function sfCardHTML(s, draft) {
  const d = draft || {};
  const name = d.name !== undefined ? d.name : (s.name || '');
  const sid = d.studentId !== undefined ? d.studentId : (s.studentId || '');
  const cls = d.class !== undefined ? d.class : (s.class || '');
  const remarks = d.remarks !== undefined ? d.remarks : (s.remarks || '');
  const isForeign = d.isForeign !== undefined ? d.isForeign : !!s.isForeign;
  const isEmpty = d.isEmpty !== undefined ? d.isEmpty : (s.isEmpty || !s.name);
  const m = sfSummary(s, draft);
  return `
      <div class="fd-back"></div>
      <div class="fd-tab"><span>${sfEsc(s.room)}</span><b>${sfEsc(s.bed)}</b><i class="${m.dot}"></i></div><div class="fd-tab fd-tab-r"><span>${sfEsc(s.room)}</span><b>${sfEsc(s.bed)}</b><i class="${m.dot}"></i></div>
      <div class="fd-spine"></div><div class="fd-spine fd-spine-r"></div>
      <div class="fd-top"></div>
      <div class="fd-paper" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="fd-front">
        <div class="fd-file-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3z"/><circle cx="18" cy="8" r="2"/><path d="M17 13a4 4 0 0 1 5 4v2h-5z"/></svg><span>${sfEsc(s.bed)}</span></div>
        <div class="fd-rail-label">${sfEsc(m.name)}</div>
        <div class="fd-summary">
          <div class="fd-name${m.nameEmpty ? ' is-empty' : ''}">${sfEsc(m.name)}</div>
          <div class="fd-class">${sfEsc(m.cls)}</div>
          <div class="fd-tags">${m.tags}</div>
          <div class="fd-count">${sfEsc(m.sid)}</div>
        </div>
      </div>
      <div class="fd-edge"></div>
      <div class="fd-sheet">
        <div class="sf-card-title">
          <span class="sf-title-text">${sfEsc(s.room)} ${sfEsc(s.bed)}</span>
          <div class="sf-card-badge-relative">${sfEsc(m.badge)}</div>
          <button class="sf-icon-btn sf-close-btn" onclick="sfCarousel.dismiss()" aria-label="關閉檔案">×</button>
          <button class="sf-icon-btn sf-broom-btn" onclick="clearStudentData(this)" title="清空床位資料"><svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
        </div>
        <div class="sf-edit-form">
          <div style="display:flex; gap: 8px;">
              <div class="sf-form-group" style="flex: 1;">
                <label>姓名</label>
                <input type="text" aria-label="姓名" class="sf-input-name styled-input" value="${sfEsc(name)}" placeholder="未登記">
              </div>
              <div class="sf-form-group" style="flex: 1;">
                <label>學號</label>
                <input type="text" aria-label="學號" class="sf-input-id styled-input" value="${sfEsc(sid)}" placeholder="無">
              </div>
          </div>
          <div style="display:flex; gap: 8px; align-items: flex-end;">
              <div class="sf-form-group" style="flex: 1;">
                <label>班別</label>
                <input type="text" aria-label="班別" class="sf-input-class styled-input" value="${sfEsc(cls)}" placeholder="無">
              </div>
              <div class="sf-toggles" style="flex: 1;">
                <label class="sf-toggle-item"><input type="checkbox" class="sf-chk-foreign" ${isForeign ? 'checked' : ''}> 外籍</label>
                <label class="sf-toggle-item"><input type="checkbox" class="sf-chk-empty" ${isEmpty ? 'checked' : ''}> 空床</label>
              </div>
          </div>
          <div class="sf-form-group">
            <label>備註 (情況註記)</label>
            <textarea aria-label="備註" class="sf-input-remarks styled-input" style="resize: none; font-size: 13px; line-height: 1.4;" placeholder="住宿生備註欄">${sfEsc(remarks)}</textarea>
          </div>
          <button class="sf-save-action-btn" onclick="autoSaveStudentFile(this)"><svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg> 儲存修改</button>
        </div>
      </div>
    `;
}

// 讀出一張卡目前的欄位內容，並判斷是否跟原始資料相同
function sfReadCard(el, s) {
  if (!s || !el) return null;
  const q = (sel) => el.querySelector(sel);
  const nameEl = q('.sf-input-name'); if (!nameEl) return null;
  const draft = {
    name: nameEl.value, studentId: q('.sf-input-id').value, class: q('.sf-input-class').value,
    remarks: q('.sf-input-remarks').value, isForeign: q('.sf-chk-foreign').checked, isEmpty: q('.sf-chk-empty').checked
  };
  const same = draft.name === (s.name || '') && draft.studentId === (s.studentId || '') && draft.class === (s.class || '') &&
    draft.remarks === (s.remarks || '') && draft.isForeign === !!s.isForeign && draft.isEmpty === (s.isEmpty || !s.name);
  return { draft, same };
}

// 名單少於回收池 (17 本) 時，同一個人會同時出現在好幾張卡上；找出另一張還在畫面上、已經被改過的卡
function sfLiveDraft(id, exceptEl) {
  for (const e of _sfPool) {
    if (!e.student || e.student.id !== id || e.el === exceptEl || e.vIndex === null) continue;
    const r = sfReadCard(e.el, e.student);
    if (r && !r.same) return r.draft;
  }
  return null;
}

// 卡片被回收前，把使用者打到一半的內容存成草稿
function sfSaveDraft(entry) {
  const s = entry.student, el = entry.el;
  const r = sfReadCard(el, s);
  if (!r) return;
  if (!r.same) _sfDrafts.set(s.id, r.draft);
  // 這張卡沒改，但同一個人的另一張卡可能改了：不能把那份草稿清掉
  else if (!sfLiveDraft(s.id, el)) _sfDrafts.delete(s.id);
}

function sfBindCard(entry, vIndex) {
  const s = sfStudentAt(vIndex);
  const el = entry.el;
  entry.vIndex = vIndex;
  entry.student = s;
  el.dataset.index = vIndex;
  el.className = 'sf-folder';
  el.style.transform = '';
  el.style.visibility = '';
  el.style.webkitMaskImage = ''; el.style.maskImage = '';
  el.style.removeProperty('--fd-alpha'); el.style.removeProperty('--fd-overlap');
  el._tf = el._op = el._nr = el._lf = null; el._bl = 0;   // 資料夾換人時清掉 carousel.js 的樣式快取 (className 重設會把 class 全清掉，快取也要一起清)
  if (vIndex === _sfActiveIndex) el.classList.add('active');
  if (s) {
    el.innerHTML = sfCardHTML(s, _sfDrafts.get(s.id) || sfLiveDraft(s.id, el));
    _sfRenderMap.set(el, s);
  } else {
    el.innerHTML = '';
    _sfRenderMap.delete(el);
  }
}

function sfEnsurePool(track) {
  if (_sfPool.length === SF_POOL_SIZE && _sfPool[0].el.parentElement === track) return;
  track.innerHTML = '';
  _sfPool = [];
  for (let i = 0; i < SF_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'sf-folder';
    track.appendChild(el);
    _sfPool.push({ el, vIndex: null, student: null });
  }
  _sfWindowStart = null;
}

// 依目前中心位置，決定哪 13 個虛擬索引該存在，把離開的卡片換成新的
function sfSyncWindow(centerFloat) {
  if (!_sfPool.length || !_sfResults.length) return;
  const start = Math.round(centerFloat) - SF_HALF;
  if (start === _sfWindowStart) return;
  _sfWindowStart = start;
  const end = start + SF_POOL_SIZE - 1;
  const present = new Set();
  const free = [];
  for (const entry of _sfPool) {
    if (entry.vIndex !== null && entry.vIndex >= start && entry.vIndex <= end) present.add(entry.vIndex);
    else free.push(entry);
  }
  for (let v = start; v <= end; v++) {
    if (present.has(v)) continue;
    const entry = free.pop();
    if (!entry) break;
    if (entry.vIndex !== null) sfSaveDraft(entry);
    sfBindCard(entry, v);
  }
}

function sfActiveEntry() {
  return _sfPool.find(e => e.vIndex === _sfActiveIndex) || null;
}

function sfRebindAll() {
  _sfWindowStart = null;
  for (const entry of _sfPool) { if (entry.vIndex !== null) sfSaveDraft(entry); entry.vIndex = null; entry.student = null; }
}

function onStudentFileSearch(query) {
  clearTimeout(_sfSearchTimer);
  const scene = document.getElementById('sf-scene');
  const mirror = document.getElementById('sf-search-mirror');
  if (!query || query.trim().length === 0) {
    if (mirror) mirror.style.display = 'none';
    if (scene) scene.classList.remove('is-searching');

    if (_sfRandomDefaults.length === 0) {
      _sfRandomDefaults = state.students.slice();
    }
    _sfResults = _sfRandomDefaults;
    renderStudentFileCards();
    return;
  }

  // 使用者開始打字，「立刻」顯示掃描鏡子與假搜尋動畫
  if (mirror) mirror.style.display = 'block';
  if (scene) scene.classList.add('is-searching');

  _sfSearchTimer = setTimeout(() => {
    const q = query.trim().toLowerCase();
    _sfResults = state.students.map((s, sourceIndex) => {
      const name = (s.name || '').toLowerCase();
      const room = (s.room || '').toLowerCase();
      const bed = (s.bed || '').toLowerCase();
      const studentId = (s.studentId || '').toLowerCase();
      const cls = (s.class || '').toLowerCase();
      const squad = (s.squad || '').toLowerCase();
      const nameMatch = name.includes(q);
      const detailMatch = room.includes(q) || bed.includes(q) || studentId.includes(q) ||
        cls.includes(q) || squad.includes(q) || (room + bed).includes(q);
      const phoneticMatch = !nameMatch && window.sfPhoneticSearch?.matches(name, q);
      if (!nameMatch && !detailMatch && !phoneticMatch) return null;
      // Keep literal name matches first, then room/bed/ID matches, then homophones.
      return { student: s, rank: nameMatch ? 0 : detailMatch ? 1 : 2, sourceIndex };
    }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.sourceIndex - b.sourceIndex).map(result => result.student);

    if (mirror) mirror.style.display = 'none';
    if (scene) scene.classList.remove('is-searching');

    _sfRandomDefaults = [];
    renderStudentFileCards(true);

    const area = document.getElementById('sf-card-area');
    if (area) {
      area.classList.remove('search-found-pop');
      void area.offsetWidth;
      area.classList.add('search-found-pop');
      area.addEventListener('animationend', () => area.classList.remove('search-found-pop'), { once: true });   // 別讓 fill:forwards 的 filter 留在 3D 舞台上
    }
  }, 220);
}

function renderStudentFileCards(sweepIn = false) {
  const track = document.getElementById('sf-card-track');
  if (!track) return;
  document.getElementById('sf-result-count').textContent = String(_sfResults.length).padStart(2, '0') + ' 份檔案';
  document.querySelector('.sf-selection').hidden = !_sfResults.length;
  document.querySelectorAll('.sf-rail-controls button').forEach(b => b.disabled = !_sfResults.length);
  if (window._sfAbortClear) window._sfAbortClear();   // 刪除動畫跑到一半就重新搜尋：先收掉那一場

  if (_sfResults.length === 0) {
    // 池子要整個丟掉：先把還沒儲存的輸入存成草稿
    window._sfStopMotion?.();
    for (const entry of _sfPool) if (entry.vIndex !== null) sfSaveDraft(entry);
    _sfPool = [];
    _sfWindowStart = null;
    track.innerHTML = `<div class="sf-empty-hint">
      <div style="font-size:48px; margin-bottom:12px;"><svg class="ui-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
      <div style="color:var(--dim); font-size:14px;">找不到符合的住宿生或床位</div>
      <div style="color:var(--dim); font-size:12px; margin-top:8px; opacity:.8;">可試試同音字、房號或學號</div>
    </div>`;
    return;
  }

  const firstMount = !_carouselAttached;
  sfEnsurePool(track);
  sfRebindAll();
  setup2DCarouselInteraction();

  _sfActiveIndex = 0;
  _currentX = 0;
  // 進場：整排資料夾先擠在中央再依序展開，中央那本最後抽出 (carousel.js)
  // 第一次進頁面保留展開動畫；搜尋換結果時直接套用同一組鏡頭與最終姿態，
  // 避免鍵盤/搜尋狀態讓整排資料夾看起來突然切成另一個俯視角。
  if (window.sfCarousel) window.sfCarousel.enter(0, { animate: firstMount && !sweepIn });
}

let _currentX = 0;
let _cardWidth = 320; // 拖一個虛擬索引要拖幾 px，carousel.js 依畫面寬度重算
let _carouselAttached = false;

// Carousel interactions are defined in carousel.js.

window.initStudentFiles = function () {
  if (window.sfDissolve) window.sfDissolve.init();   // 刪除用的粒子 canvas 現在就建好，按垃圾桶不用等
  _sfRandomDefaults = [];
  document.getElementById('sf-search-input').value = '';
  onStudentFileSearch('');
};

window.debouncedAutoSave = function (elem) {
  if (elem.dataset.timeout) clearTimeout(elem.dataset.timeout);
  elem.dataset.timeout = setTimeout(() => {
    autoSaveStudentFile(elem);
  }, 300);
}

const _sfSaving = new Set();
window.autoSaveStudentFile = async function (elem) {
  const activeCard = elem.closest('.sf-folder');
  if (!activeCard) return;

  const studentObj = _sfRenderMap.get(activeCard);
  if (!studentObj) return;
  if (_sfSaving.has(studentObj.id)) return;
  _sfSaving.add(studentObj.id);
  const fingerprint = c => JSON.stringify(Array.from(c.querySelectorAll('input,textarea'), e => e.type === 'checkbox' ? e.checked : e.value));
  const beforeViews = new Map(Array.from(document.querySelectorAll('.sf-folder'))
    .filter(c => _sfRenderMap.get(c)?.id === studentObj.id).map(c => [c, fingerprint(c)]));
  const beforeDraft = JSON.stringify(_sfDrafts.get(studentObj.id));

  const newName = activeCard.querySelector('.sf-input-name').value.trim();
  const newId = activeCard.querySelector('.sf-input-id').value.trim();
  const newClass = activeCard.querySelector('.sf-input-class').value.trim();
  const newRemarks = activeCard.querySelector('.sf-input-remarks').value.trim();
  const isForeign = activeCard.querySelector('.sf-chk-foreign').checked;
  const isEmpty = activeCard.querySelector('.sf-chk-empty').checked || !newName;
  // 姓名是判定床位有人的必要條件；刪空姓名時自動切成空床。
  activeCard.querySelector('.sf-chk-empty').checked = isEmpty;

  const btn = activeCard.querySelector('.sf-save-action-btn');
  let oldHtml = '';
  if (btn) {
    oldHtml = btn.innerHTML;
    btn.innerHTML = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 17H3"/><path d="m6 10-3 3 3 3"/><path d="M3 7h18"/><path d="m18 20 3-3-3-3"/></svg> 儲存中...';
    btn.disabled = true;
  } else {
    showToast('自動儲存中...', 'info');
  }

  try {
    const updatePayload = {
      pageId: studentObj.id,
      updateProfile: {
        name: isEmpty ? '' : newName,
        class: isEmpty ? '' : newClass,
        studentId: isEmpty ? '' : newId,
        isForeign: isEmpty ? false : isForeign
      },
      markEmpty: isEmpty
    };
    if (isEmpty) updatePayload.clearProfile = true;

    await Promise.all([
      window._api.updateAttendance([updatePayload]),
      window._api.updateRemark(studentObj.id, newRemarks)
    ]);

    // Update Local Cache Reference
    studentObj.name = isEmpty ? '' : newName;
    studentObj.studentId = isEmpty ? '' : newId;
    studentObj.squad = isEmpty ? '' : newClass;
    studentObj.class = isEmpty ? '' : newClass;
    studentObj.remarks = newRemarks;
    studentObj.isForeign = isEmpty ? false : isForeign;
    studentObj.isEmpty = isEmpty;
    if (JSON.stringify(_sfDrafts.get(studentObj.id)) === beforeDraft) _sfDrafts.delete(studentObj.id);

    // 同步更新畫面上所有複製人的顯示內容
    const cards = document.querySelectorAll('.sf-folder');
    cards.forEach(c => {
      const obj = _sfRenderMap.get(c);
      if (obj?.id === studentObj.id && beforeViews.get(c) === fingerprint(c)) {
        c.querySelector('.sf-input-name').value = studentObj.name;
        c.querySelector('.sf-input-id').value = studentObj.studentId;
        c.querySelector('.sf-input-class').value = studentObj.class;
        c.querySelector('.sf-input-remarks').value = studentObj.remarks;
        c.querySelector('.sf-chk-foreign').checked = studentObj.isForeign;
        c.querySelector('.sf-chk-empty').checked = studentObj.isEmpty;
      } else if (obj?.id === studentObj.id) {
        // Keep edits entered while the request was running (including recycled cards).
        sfSaveDraft({el:c, student:studentObj});
      }
      // 前板玻璃上的摘要 (名字 / 標籤) 跟著更新
      if (obj?.id === studentObj.id) sfUpdateSummary(c, studentObj, sfReadCard(c, studentObj)?.draft);
    });

    localStorage.setItem('biyuan_temp_students_update', JSON.stringify(state.students));

    if (btn) {
      btn.innerHTML = '<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 已儲存';
      btn.style.background = '#10b981';
      btn.style.color = '#fff';
      setTimeout(() => {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        btn.style.background = '';
        btn.style.color = '';
      }, 1500);
    } else {
      showToast('資料已自動同步至總表 <svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>', 'success');
    }

    if (typeof playClickSound === 'function') playClickSound('all_present');

  } catch (err) {
    if (btn) {
      btn.innerHTML = '儲存失敗';
      btn.style.background = '#ef4444';
      btn.style.color = '#fff';
      setTimeout(() => {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        btn.style.background = '';
        btn.style.color = '';
      }, 2000);
    }
    showToast('自動連動 Notion 失敗：' + err.message, 'error');
  } finally { _sfSaving.delete(studentObj.id); }
};

window.onStudentFileSearch = onStudentFileSearch;

// ═════════════════════════════════════════════════════════════════════════════
// 圖片預覽彈窗 (Image Preview Modal)
// ═════════════════════════════════════════════════════════════════════════════
window.openImagePreview = function (src) {
  const modal = document.getElementById('image-preview-modal');
  const img = document.getElementById('image-preview-img');
  if (modal && img) {
    img.src = src;
    modal.classList.add('visible');
  }
};

window.closeImagePreview = function () {
  const modal = document.getElementById('image-preview-modal');
  if (modal) {
    modal.classList.remove('visible');
    setTimeout(() => {
      document.getElementById('image-preview-img').src = '';
    }, 300);
  }
};

window.saveGeminiKey = function (val) {
  localStorage.setItem('gemini_api_key', (val || '').trim());
  showToast('API Key 已儲存本機', 'success');
};

window.handleDutyRosterUpload = async function (e) {
  const file = e.target.files[0];
  if (!file) return;

  // API Key 改由 Cloudflare Worker 後端隱藏保護

  const container = document.getElementById('duty-roster-content');
  const originalHtml = container.innerHTML;

  // Apple-style premium loading
  container.innerHTML = `
    <div style="text-align:center; padding:60px 20px; color:var(--dim);">
      <div class="ai-loading-spinner" style="width:60px; height:60px; margin:0 auto 24px; position:relative;">
        <div style="position:absolute; inset:0; border:4px solid rgba(10,132,255,0.1); border-radius:50%;"></div>
        <div style="position:absolute; inset:0; border:4px solid transparent; border-top-color:var(--blue); border-radius:50%; animation:spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;"></div>
      </div>
      <div style="font-size:18px; font-weight:700; color:var(--text); margin-bottom:8px; letter-spacing:-0.5px;"><svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg> AI 智慧辨識中</div>
      <p style="font-size:14px; opacity:0.6;">正在掃描輪值表細節，請稍候...</p>
      <div style="margin-top:24px; font-size:11px; font-weight:600; color:var(--blue); background:rgba(10,132,255,0.1); padding:4px 12px; border-radius:20px; display:inline-block; animation:pulse 2s infinite;">⚡ 暴力圖像 2.7 引擎運算中</div>
    </div>`;

  try {
    const reader = new FileReader();
    const base64Data = await new Promise(resolve => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
    });

    // ... rest of the logic remains same for API call
    const targetRooms = ['211', '311', '113', '112'];
    const officers = state.students
      .filter(s => targetRooms.some(r => s.room && s.room.includes(r)))
      .map(s => s.name)
      .filter(n => n && !n.includes('空床'));
    const officersText = officers.length > 0 ? `\n\n另外，本宿舍的幹部通常住在 211, 311, 113, 112 房。以下是這些房間的住宿生名單作為參考，如果辨識到的名字與這些人相似，請優先修正為名單上的正確名字：\n${officers.join(', ')}` : '';

    const prompt = `你是一個值星表資料擷取專家。請讀取這張圖片中的值星幹部輪值表，並輸出為純 JSON 陣列格式。
不要輸出任何 Markdown 標記，只要合法的 JSON 陣列。
陣列中的每個物件需包含：
- week: (整數，週次，如 1)
- start: (字串，開始日期，例如 "02/20")
- end: (字串，結束日期，例如 "02/26")
- dutyOfficer: (字串，值星官姓名)
- deputy: (字串，副值星官姓名)
若有任何辨識不清的地方請自行合理推斷，若有換行請視為同一個字串處理。${officersText}`;

    const res = await fetch(window.CONFIG.KV_API_URL + '/api/ai-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: file.type, data: base64Data } }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    let textResult = data.candidates[0].content.parts[0].text;
    textResult = textResult.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
    const parsedData = JSON.parse(textResult);

    if (Array.isArray(parsedData) && parsedData.length > 0) {
      await window._api.setConfig({ duty_roster: JSON.stringify(parsedData) });
      state.config.duty_roster = JSON.stringify(parsedData);
      window.CONFIG.DUTY_ROSTER = parsedData;

      showToast('值星表更新成功！', 'success');
      openDutyRosterModal();
      if (typeof renderHome === 'function') renderHome();
    } else {
      throw new Error("辨識結果格式不正確");
    }
  } catch (err) {
    showToast('辨識失敗: ' + err.message, 'error');
    container.innerHTML = originalHtml;
  }

  e.target.value = '';
};
