/**
 * 碧苑宿舍點名系統 - 主應用邏輯 v2.2
 * 新增: 硬性房間規則 / 斜線動畫 / 導覽列自訂圖示
 */

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
};

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
// ─── UI 清脆音效 (Web Audio API) ───────────────────────────────────────────
let audioCtx = null;
function playClickSound(type = 'default') {
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
      // 到齊：清脆高頻上揚 ⬆️
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
      // 請假/課外：溫和中頻下滑 🟡
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
      // 缺席：低沉鍛擊雙擊 🔴
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
  const target = e.target.closest('button, .nav-item, .sq-card, .rc-date-clickable, .date-item, .student-row, .dev-trigger, .changelog-btn, .action-btn, .modal-overlay');
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

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 初始狀態：全白模式
    if (localStorage.getItem('white_mode') === 'true') {
      document.body.classList.add('light-mode');
      const whiteToggle = document.getElementById('setting-white-mode');
      if (whiteToggle) whiteToggle.checked = true;
      if (typeof updateAllImagesToTheme === 'function') updateAllImagesToTheme();
    }
    
    // 初始狀態：靜音模式
    if (localStorage.getItem('mute_sound') === 'true') {
      const muteToggle = document.getElementById('setting-mute');
      if (muteToggle) muteToggle.checked = true;
    }

    state.currentDate = getTodayColumnName();
    setupNav();
    setupPinDialog();
    applyNavIcons();
    navigateTo('home');
    await loadData();

    // 背景輪詢同步點名狀態
    setInterval(async () => {
      try {
        const newConfig = await window._api.getConfig();
        state.config = newConfig;
        const today = getTodayColumnName();
        const confVal = state.config['confirm_' + today];
        const newConfirmed = confVal ? confVal.split(',').filter(Boolean) : [];
        if (newConfirmed.join(',') !== state.confirmedSquads.join(',')) {
          state.confirmedSquads = newConfirmed;
          if (currentPage === 'summary') renderSummary();
        }
      } catch (e) { }
    }, 15000);

  } catch (err) {
    showLoading(false);
    showToast('初始化嚴重錯誤：' + err.message, 'error');
  }
});

// 個人化設定 Toggle
function toggleMute(el) {
  localStorage.setItem('mute_sound', el.checked);
}

function performAppearanceChange(isLight) {
  if (isLight) document.body.classList.add('light-mode');
  else document.body.classList.remove('light-mode');
  if (typeof updateAllImagesToTheme === 'function') updateAllImagesToTheme();
}

let vtStartTime = 0;
let vtRadiusFn = null;

function easeOutQuad(t) { return t * (2 - t); }

function toggleWhiteMode(el, event) {
  const isLight = el.checked;
  localStorage.setItem('white_mode', isLight);
  const isDark = !isLight;

  let x = lastTapX;
  let y = lastTapY;
  
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  if (!document.startViewTransition) {
    performAppearanceChange(isLight);
    return;
  }

  // 👑 獨家防閃爍算法：推算當前畫面光圈半徑，實現「狂點完美折返」
  let startRadius = isDark ? endRadius : 0;
  const now = Date.now();
  const duration = 400;

  if (vtRadiusFn && (now - vtStartTime) < duration) {
      startRadius = vtRadiusFn(now); 
  }

  const targetRadius = isDark ? 0 : endRadius;
  vtStartTime = now;
  
  vtRadiusFn = (evalTime) => {
      let t = Math.min((evalTime - vtStartTime) / duration, 1);
      let progress = easeOutQuad(t);
      return Math.max(0, startRadius + (targetRadius - startRadius) * progress);
  };

  if(isDark) document.documentElement.classList.add('transition-dark');
  
  const transition = document.startViewTransition(() => performAppearanceChange(isLight));

  transition.ready.then(() => {
    const clipPathStart = `circle(${startRadius}px at ${x}px ${y}px)`;
    const clipPathEnd = `circle(${targetRadius}px at ${x}px ${y}px)`;

    try {
      document.documentElement.animate(
        { clipPath: [clipPathStart, clipPathEnd] },
        {
          duration: duration,
          easing: 'ease-out',
          fill: 'forwards',
          pseudoElement: isDark ? '::view-transition-old(root)' : '::view-transition-new(root)'
        }
      );
    } catch (animErr) {
      let fallbackStyle = document.getElementById('vt-fallback');
      if (!fallbackStyle) {
        fallbackStyle = document.createElement('style');
        fallbackStyle.id = 'vt-fallback';
        document.head.appendChild(fallbackStyle);
      }
      const pseudo = isDark ? '::view-transition-old(root)' : '::view-transition-new(root)';
      const prefix = isDark ? 'html.transition-dark' : '';
      fallbackStyle.innerHTML = `
        @keyframes vt-circle-anim {
          0% { clip-path: ${clipPathStart}; }
          100% { clip-path: ${clipPathEnd}; }
        }
        ${prefix}${pseudo} {
          animation: vt-circle-anim ${duration}ms ease-out forwards !important;
        }
      `;
    }
  }).catch(() => {});

  transition.finished.finally(() => {
    document.documentElement.classList.remove('transition-dark');
    const styleEl = document.getElementById('vt-fallback');
    if (styleEl) styleEl.remove();
  });
}

function getIconSrc(baseName) {
  const isLight = document.body.classList.contains('light-mode');
  if (!isLight) return `./Lp/ICON/${baseName}.svg`;
  
  if (baseName === 'SETTIN') return './Lp/ICON/BLACK/SETTINGS__BLACK.svg';
  if (baseName === 'SAVE') return './Lp/ICON/BLACK/SAVE.svg';
  return `./Lp/ICON/BLACK/${baseName}_BLACK.svg`;
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
    const [roster, config, changelogs] = await Promise.all([
      window._api.getRoster(),
      window._api.getConfig(),
      window._api.getChangelog().catch(() => []) // 容錯處理：若尚未設定 DB 不會整個炸掉
    ]);
    state.students = roster.students || [];
    state.dateColumns = roster.dateColumns || [];
    state.config = config || {};
    state.changelogs = changelogs || [];

    // 套用硬性房間規則
    applyRoomRules();

    // 套用全域背景影片設定
    loadGlobalBgVideo();

    const today = getTodayColumnName();
    const confVal = state.config['confirm_' + today];
    if (confVal) state.confirmedSquads = confVal.split(',').filter(Boolean);
    else state.confirmedSquads = [];

    showLoading(false);
    renderCurrentPage();
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
          `$1<span class="changelog-time" style="font-size:11px;margin:-2px 0 8px 2px;font-weight:400;letter-spacing:0.5px;display:block;">🕐 ${timeLabel}</span>`
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

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });
}

function navigateTo(page) {
  if (page === currentPage) { renderCurrentPage(); return; }

  const fromPage = currentPage;
  currentPage = page;

  // 立刻更新導覽列 & 按鈕狀態
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
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

  function showNewPage() {
    document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.animation = ''; });
    if (toEl) toEl.classList.add('active');
    renderCurrentPage();
  }

  if (fromEl && fromEl.classList.contains('active')) {
    fromEl.style.animation = 'pageExit 0.18s ease forwards';
    setTimeout(showNewPage, 170);
  } else {
    showNewPage();
  }
}

function renderCurrentPage() {
  switch (currentPage) {
    case 'home': renderHome(); break;
    case 'rollcall': renderRollCall(); break;
    case 'summary': renderSummary(); break;
    case 'history': renderHistory(); break;
    case 'settings': renderSettings(); break;
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

  // 中隊卡片 (3列)
  const grid = document.getElementById('squad-grid');
  const floorLabels = { 1: '1樓', 2: '2樓', 3: '3樓' };

  grid.innerHTML = CONFIG.SQUADS.map((sq, i) => {
    const count = state.students.filter(s => s.squad === sq.id && !s.isEmpty && !s.hidden).length;
    const floor = sq.floor;
    const type = sq.odd ? '單數房' : '雙數房';

    const animClass = isInitialHomeRender ? 'pop-initial' : 'pop-return';

    const baseDelay = isInitialHomeRender ? 3.0 : 0; // 折衷給您 3.0 秒
    const delay = (baseDelay + i * 0.03).toFixed(2) + 's';

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
        icon: state.config['role_icon_president'] || '😒'
      },
      {
        id: 'vice_president',
        label: state.config['role_label_vice_president'] || '副社長管理選單',
        color: '#10b981',
        icon: state.config['role_icon_vice_president'] || '🥝'
      }
    ];
    // 接續中隊卡片的動畫延遲時間
    const squadCount = CONFIG.SQUADS.length;
    managementGrid.innerHTML = roles.map((role, i) => {
      const animClass = isInitialHomeRender ? 'pop-initial' : 'pop-return';
      const baseDelay = isInitialHomeRender ? 3.0 : 0;
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
      state.currentDate = getTodayColumnName();
      state.changes = [];
      navigateTo('rollcall');
    });
  } else {
    state.currentSquad = squadId;
    state.currentDate = getTodayColumnName();
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
  }, `🔐 ${title} 身分驗證`);
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
  }
}

function closeDatePicker() {
  document.getElementById('date-picker-panel')?.classList.remove('open');
  document.getElementById('rc-date-btn')?.classList.remove('open');
}

function renderDatePicker() {
  const today = getTodayColumnName();
  const list = document.getElementById('date-picker-list');
  // 倒序排列：最新的在最上面
  const dates = [...state.dateColumns].reverse();
  list.innerHTML = dates.map(d => {
    const isActive = d === state.currentDate;
    const isToday = d === today;
    return `<div class="date-item${isActive ? ' active' : ''}${isToday ? ' today-marker' : ''}"
                 onclick="selectRollCallDate('${d}')">${d}</div>`;
  }).join('');
  // 自動捲到選中的日期
  setTimeout(() => {
    const active = list.querySelector('.date-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, 50);
}

function selectRollCallDate(date) {
  state.currentDate = date;
  closeDatePicker();
  renderRollCall();
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
function renderRollCall() {
  if (!state.currentSquad) return;

  document.getElementById('rc-squad-name').textContent = state.currentSquad;
  document.getElementById('rc-date').textContent = state.currentDate;

  // 更新提交按鈕顯示目前日期
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.textContent = `✅ 提交 ${state.currentDate} 點名`;

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
            <div class="student-name">${s.isEmpty ? '（空床）' : s.name}${s.isForeign ? ' 🌏' : ''}</div>
            <div class="student-meta">${s.class || ''} ${s.studentId || ''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          ${s.isEmpty ? '<span class="empty-tag">空床</span>' :
        `<div class="status-badge" style="background:${si.color}20;color:${si.color};border:1px solid ${si.color}40">${si.icon} ${si.label}</div>`}
          <span class="sync-dot${isPending ? ' pending' : ''}"></span>
        </div>
      </div>`;
  }
  document.getElementById('rc-student-list').innerHTML = html;
  updateRollCallStats();
  setupSubmitButton();
}

// 每位學生的 debounce timer
const _syncTimers = {};

function toggleStatus(pageId) {
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

  // 即時更新 UI
  renderRollCall();

  // 立即同步到 Notion（debounce 800ms 防止快速連點重複 API）
  clearTimeout(_syncTimers[pageId]);
  _syncTimers[pageId] = setTimeout(async () => {
    try {
      await window._api.updateAttendance([change]);
      // 同步成功：移除 changes 中已成功的那筆
      const i = state.changes.findIndex(c => c.pageId === pageId && c.date === state.currentDate && c.value === next);
      if (i >= 0) state.changes.splice(i, 1);
      // 微小的成功提示（不打擾操作）
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

function updateRollCallStats() {
  const ss = state.students.filter(s => s.squad === state.currentSquad && !s.isEmpty && !s.hidden);
  let p = 0, l = 0, a = 0;
  for (const s of ss) { const v = s.attendance[state.currentDate] || '✓'; if (v === '✓') p++; else if (v === '◎' || v === '△') l++; else a++; }
  document.getElementById('rc-stat-should').textContent = ss.length;
  document.getElementById('rc-stat-present').textContent = p;
  document.getElementById('rc-stat-leave').textContent = l;
  document.getElementById('rc-stat-absent').textContent = a;

  const confirmBtn = document.getElementById('rc-confirm-btn');
  if (state.currentDate === getTodayColumnName()) {
    confirmBtn.style.display = 'flex';
    const isConfirmed = state.confirmedSquads.includes(state.currentSquad);
    confirmBtn.className = 'rc-confirm-action' + (isConfirmed ? ' done' : '');
    document.getElementById('rc-confirm-icon').textContent = isConfirmed ? '🟢' : '⭕';
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
  document.getElementById('rc-confirm-text').textContent = '⏳ 即時同步中...';

  // 預計要變成的最終結果
  let targetSquads = [];
  if (isCurrentlyConfirmed) {
    targetSquads = state.confirmedSquads.filter(s => s !== sq);
  } else {
    targetSquads = [...state.confirmedSquads, sq];
  }

  const today = getTodayColumnName();
  try {
    // 儲存到 Notion (系統全域共用)，需等候完成才改變本地狀態
    await window._api.setConfig({ ['confirm_' + today]: targetSquads.join(',') });

    // 如果沒有拋出錯誤，代表網路更新成功！
    state.confirmedSquads = targetSquads;
    state.config['confirm_' + today] = targetSquads.join(',');

    showToast(isCurrentlyConfirmed ? '已取消回報' : '✅ 點名回報成功！已即時同步至總表', 'success');

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
    btn.disabled = true; btn.textContent = '⏳ 提交中...';
    try {
      for (let i = 0; i < state.changes.length; i += 45)
        await window._api.updateAttendance(state.changes.slice(i, i + 45));
      showToast(`已提交 ${state.changes.length} 筆變更`, 'success');
      showSubmitSuccess();
      state.changes = [];
    } catch (err) { showToast('提交失敗：' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = '✅ 提交今日點名'; }
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
    const keysToSwap = ['name', 'class', 'studentId', 'isForeign', 'isEmpty', 'attendance'];
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
    const msg = `✅ 已完整交換：${fromRoom}${fromBed} ${nameA} ↔ ${toRoom}${toBed} ${nameB}`;
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
  const todayStr = getTodayColumnName();
  if (date !== todayStr) {
    const snap = state.config['snapshot_' + date];
    if (snap) {
      try {
        const cachedSt = JSON.parse(snap);
        if (cachedSt && typeof cachedSt === 'object') return cachedSt;
      } catch(e) { console.error('Failed to parse snapshot', e); }
    }
  }

  const totalBeds = parseInt(state.config['total_beds']) || state.students.filter(s => !s.hidden).length;
  const bedOffset = parseInt(state.config['bed_offset']) || 0;

  // --- 各中隊明細 ---
  const squads = [];
  let gShouldAttend = 0, gLeave = 0, gAbsent = 0, gPresent = 0;
  let gEmptyCount = 0, gForeignCount = 0;

  for (const sq of CONFIG.SQUADS) {
    // 排除隱藏的學生（雙人房 C/D 和儲藏室）
    const members = state.students.filter(s => s.squad === sq.id && !s.hidden);
    // 空床 = isEmpty 的學生（靜態屬性，來自 Notion 的「空床」checkbox）
    let emptyInSquad = members.filter(s => s.isEmpty).length;

    // 應到 = 非空床的住宿生
    const residents = members.filter(s => !s.isEmpty);
    const shouldAttend = residents.length;

    let sqLeave = 0, sqAbsent = 0;
    for (const s of residents) {
      const v = s.attendance[date] || '✓';
      if (v === '◎' || v === '△') sqLeave++;
      else if (v === '✘') sqAbsent++;
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

  return {
    totalBeds, totalEmpty, residents, rate, bedOffset,
    present: gPresent, leave: gLeave, absent: gAbsent,
    shouldAttend: gShouldAttend, foreign: gForeignCount,
    squads,
  };
}

function renderSummary() {
  const date = state.currentDate || getTodayColumnName();
  const todayStr = getTodayColumnName();
  const st = computeDailyStats(date);

  if (date !== todayStr && state.config['snapshot_' + date]) {
    document.getElementById('summary-date').textContent = date + ' 🔒';
  } else {
    document.getElementById('summary-date').textContent = date;
  }

  // 核心功能：當觀看的是「今天」的總表時，背景自動紀錄快照。
  // 這確保 11 點鐘他們拉開來看數字回報時，系統就會自動存下那瞬間的結果。
  if (date === todayStr) {
    const snapshotStr = JSON.stringify(st);
    if (state.config['snapshot_' + date] !== snapshotStr) {
      state.config['snapshot_' + date] = snapshotStr;
      // 靜默儲存到 Notion DB 的設定表裡
      window._api.setConfig({ ['snapshot_' + date]: snapshotStr }).catch(e => console.error('Auto snapshot failed', e));
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
    const isConfirmed = state.confirmedSquads.includes(sq.id) && date === getTodayColumnName();
    const confHtml = isConfirmed ? `<div class="sqd-conf-badge"><div class="conf-ring">✓</div><span>已回報</span></div>` : '';
    return `
    <div class="sqd-card" style="--sq-c:${sq.color}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
        <div class="sqd-title" style="margin-bottom:0">${sq.id}</div>
        ${confHtml}
      </div>
      <div class="sqd-row">
        <span>應到 <b>${sq.shouldAttend}</b></span>
        <span style="color:var(--green)">到 <b>${sq.present}</b></span>
        <span style="color:var(--yellow)">假 <b>${sq.leave}</b></span>
        <span style="color:var(--red)">缺 <b>${sq.absent}</b></span>
      </div>
      <div class="sqd-foreign">🌏 外籍 ${sq.foreign} ・ 🛏️ 空床 ${sq.empty}</div>
    </div>`;
  }).join('');

  document.getElementById('summary-prev-date').onclick = () => changeSummaryDate(-1);
  document.getElementById('summary-next-date').onclick = () => changeSummaryDate(1);
  document.getElementById('copy-summary-btn').onclick = () => copySummary(date);
  document.getElementById('refresh-summary-btn').onclick = () => loadData();
}

function changeSummaryDate(delta) {
  const idx = state.dateColumns.indexOf(state.currentDate);
  const ni = idx + delta;
  if (ni >= 0 && ni < state.dateColumns.length) {
    state.currentDate = state.dateColumns[ni];
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
    const col = `${month + 1}月${d}日`;
    const has = state.dateColumns.includes(col);
    const today = col === getTodayColumnName();
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
  } else html += '<p style="color:var(--dim);text-align:center;padding:20px">全員到齊 🎉</p>';
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
  const totalBeds = parseInt(state.config['total_beds']) || visibleStudents.length;
  const bedOffset = parseInt(state.config['bed_offset']) || 0;
  document.getElementById('cfg-total-beds').value = totalBeds;
  document.getElementById('cfg-bed-offset').value = bedOffset;

}

function adjustSetting(key, delta) {
  const map = {
    'total_beds': 'cfg-total-beds',
    'bed_offset': 'cfg-bed-offset',
  };
  const input = document.getElementById(map[key]);
  if (!input) return;
  let val = parseInt(input.value) || 0;
  if (key === 'total_beds') val = Math.max(0, val + delta);
  else val = val + delta;
  input.value = val;
}

async function saveDormSettings() {
  const totalBeds = parseInt(document.getElementById('cfg-total-beds').value) || 0;
  const bedOffset = parseInt(document.getElementById('cfg-bed-offset').value) || 0;
  try {
    await window._api.setConfig({
      total_beds: String(totalBeds),
      bed_offset: String(bedOffset),
    });
    state.config['total_beds'] = String(totalBeds);
    state.config['bed_offset'] = String(bedOffset);
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
    showToast('密碼已儲存並同步至雲端 ✅', 'success');
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
  if (icon) { updates[`role_icon_${roleId}`] = icon; state.config[`role_icon_${roleId}`] = icon; }
  if (label) { updates[`role_label_${roleId}`] = label; state.config[`role_label_${roleId}`] = label; }
  try {
    await window._api.setConfig(updates);
    showToast('外觀已儲存並即時生效 ✅', 'success');
    if (iconEl) iconEl.value = '';
    if (labelEl) labelEl.value = '';
    // 即時重繪首頁讓變化立刻看得到
    if (currentPage === 'home') renderHome();
  } catch (err) {
    showToast('儲存失敗：' + err.message, 'error');
  }
}

async function testWorkerConnection() {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.textContent = '⏳ 測試連線中...';
  el.style.background = 'rgba(255,255,255,.05)'; el.style.color = 'var(--dim)';
  try {
    await window._api.ping();
    el.textContent = '✅ Worker 連線正常';
    el.style.background = 'rgba(34,197,94,.1)'; el.style.color = 'var(--green)';
  } catch (err) {
    el.textContent = '❌ 連線失敗';
    el.style.background = 'rgba(239,68,68,.1)'; el.style.color = 'var(--red)';
  }
}

async function saveGlobalPinAuth() {
  const isEnabled = document.getElementById('dev-global-pin-auth').checked;
  showLoading(true);
  try {
    const val = isEnabled ? 'true' : 'false';
    await window._api.setConfig({ 'global_pin_auth': val });
    state.config['global_pin_auth'] = val;
    showToast('已更新全域密碼設定，將套用於所有裝置', 'success');
  } catch (err) {
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

// ─── 自動備份 ───────────────────────────────────────────────────────────────
setInterval(async () => {
  if (state.changes.length > 0) {
    try {
      for (let i = 0; i < state.changes.length; i += 45) await window._api.updateAttendance(state.changes.slice(i, i + 45));
      showToast(`自動備份 ${state.changes.length} 筆`, 'info');
      state.changes = [];
    } catch (e) { console.error('自動備份失敗', e); }
  }
}, CONFIG.AUTO_SAVE_INTERVAL);

// ─── UI 工具 ────────────────────────────────────────────────────────────────
function showLoading(show) {
  state.loading = show;
  const el = document.getElementById('loading-overlay');
  if (!el) return;

  if (show) {
    el.classList.remove('exit-drop');
    el.style.display = 'flex';
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
  const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = msg;
  c.appendChild(t); setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ─── 匯出 ───────────────────────────────────────────────────────────────────
function exportExcel() {
  if (!state.students.length) { showToast('沒有資料', 'error'); return; }
  try {
    const headers = ['名稱', '寢床號', '床號', '班別', '學號', ...state.dateColumns];
    const rows = state.students.map(s => {
      const r = [s.name, s.room, s.bed, s.class, s.studentId];
      for (const d of state.dateColumns) r.push(s.attendance[d] || '✓');
      return r;
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '點名總表');
    XLSX.writeFile(wb, `碧苑點名_${CONFIG.SEMESTER}_${getTodayColumnName()}.xlsx`);
    showToast('Excel 已下載', 'success');
  } catch (err) { showToast('匯出失敗：' + err.message, 'error'); }
}

// ─── 全域暴露 ───────────────────────────────────────────────────────────────
window.enterSquad = enterSquad;
window.toggleStatus = toggleStatus;
window.showDateDetail = showDateDetail;
window.exportExcel = exportExcel;
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
  { page: 'home', emoji: '🏠', label: '點名' },
  { page: 'summary', emoji: '📊', label: '總表' },
  { page: 'history', emoji: '📅', label: '歷史' },
  { page: 'settings', emoji: '⚙️', label: '設定' },
];

// 導覽列 ICON 硬編碼映射
const NAV_ICON_MAP = {
  home: 'HOME',
  summary: 'PAGE2',
  history: 'HISTORY',
  settings: 'SETTIN',
};

function applyNavIcons() {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    const page = item.dataset.page;
    const iconEl = item.querySelector('.nav-icon');
    if (!iconEl) return;
    const srcBase = NAV_ICON_MAP[page];
    if (srcBase) {
      const src = getIconSrc(srcBase);
      // 加上 onerror 備援機制，如果發生錯誤就 fallback 回 emoji
      const defEmoji = NAV_PAGES.find(n => n.page === page)?.emoji || '⚙️';
      iconEl.innerHTML = `<img class="nav-icon-img" src="${src}" alt="${page}" style="width:28px;height:28px;object-fit:contain;margin-bottom:-2px;" onerror="this.outerHTML='${defEmoji}'">`;
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
      <h3>🔐 開發者驗證</h3>
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
        showToast('🔓 開發者模式已解鎖', 'success');
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
  // 從 Notion 全域設定讀取
  const url = state.config['bg_video_url'];
  const scale = state.config['bg_video_scale'] || 1.0;
  const opacity = state.config['bg_video_opacity'] || 0.25;

  const container = document.getElementById('custom-video-bg');
  const animBg = document.querySelector('.home-anim-bg');

  if (url) {
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
  if (!confirm("確定要將所有空床的「姓名、學號、班級」清空，並「所有日期的請假紀錄」覆寫為 ✅ 嗎？此操作無法還原！")) return;

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
  if (!confirm("確定要將「目前所有空床」的請假紀錄全部強制補上「✓」嗎？")) return;

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
            <div class="review-card-bed">🛏️ 申請補入: ${req.room} ${req.bed} 床</div>
            <div class="review-card-time">⏰ 送出時間: ${timeStr}</div>
            ${req.isForeign ? '<div class="review-card-badge foreign">🌍 外籍生</div>' : ''}
          </div>
          <div class="review-card-actions">
            <button class="review-approve-btn" onclick="approveResidentAddReq('${req.id}')">✅ 通過並寫入</button>
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
  if (!confirm('確定要通過申請，將該學生正式寫入總表床位嗎？')) return;
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
  if (!confirm('確定要駁回此申請嗎？紀錄將被刪除。')) return;
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
  
  const today = new Date().toISOString().split('T')[0];
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
      <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:16px;border-radius:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
          <div style="font-size:16px;font-weight:bold;color:var(--text);">${r.title}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.5);">${new Date(r.createdAt).toLocaleString()}</div>
        </div>
        <div style="font-size:14px;color:var(--dim);margin-bottom:4px;">🧑‍🎓 ${r.roomBed} ${r.name}</div>
        <div style="font-size:14px;color:var(--dim);margin-bottom:4px;">📅 ${r.dateStart} ~ ${r.dateEnd}</div>
        <div style="font-size:14px;color:var(--dim);">👤 處理人：${r.handler || '未填寫'}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:#f87171;text-align:center;padding:20px;">載入失敗：${err.message}</div>`;
  }
}

async function submitCounterLeave() {
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
    // 1. 找出區間對應的 state.dateColumns (點名表的欄位)
    // 我們需要將 Date string "YYYY-MM-DD" 與 dateColumns "X月Y日" 配對
    const updates = [];
    const localStart = new Date(startDateStr);
    const localEnd = new Date(endDateStr);
    
    // 產生期間內所有日期的 X月Y日
    const targetDates = [];
    let cur = new Date(startDateStr);
    while (cur <= localEnd) {
      const m = cur.getMonth() + 1;
      const d = cur.getDate();
      targetDates.push(`${m}月${d}日`);
      cur.setDate(cur.getDate() + 1);
    }
    
    // 篩選出總表確實存在的欄位
    const matchedCols = state.dateColumns.filter(c => targetDates.includes(c));
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
    } else {
      showToast('警告：選擇的請假範圍未涵蓋目前點名表的任何一天！將只記錄歷史，不修改總表。', 'info');
    }
    
    // 2. 紀錄至電話請假紀錄 DB
    const leaveAddRes = await fetch(CONFIG.WORKER_URL + '/api/leave-records', {
       method: 'POST',
       headers: {'Content-Type': 'application/json'},
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

// ═══════════════════════════════════════════════════════════════════════════════
// 通知報修系統
// ═══════════════════════════════════════════════════════════════════════════════
let repairPhotos = []; // base64 array

function openRepairForm() {
  repairPhotos = [];
  navigateTo('repair-form');
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
  const reason = document.getElementById('repair-reason')?.value?.trim();
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
      container.innerHTML = '<div style="color:var(--dim);text-align:center;padding:40px;">目前沒有任何報修紀錄 🎉</div>';
      return;
    }

    let html = '';
    records.forEach(rec => {
      const timeStr = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : '未知';
      const photosHtml = (rec.photos || []).map(src =>
        `<img src="${src}" alt="報修照片" onclick="window.open('${src}','_blank')">`
      ).join('');

      html += `
        <div class="repair-record-card">
          <div class="repair-record-reason">${rec.reason || '（無描述）'}</div>
          ${photosHtml ? `<div class="repair-record-photos">${photosHtml}</div>` : ''}
          <div class="repair-record-time">⏰ ${timeStr}</div>
          <button class="repair-done-btn" onclick="markRepairDone('${rec.id}')">✅ 已回報處理</button>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);text-align:center;padding:20px;">讀取失敗：${err.message}</div>`;
  }
}

async function markRepairDone(id) {
  if (!confirm('確定此報修已經回報處理完畢？紀錄將會被刪除。')) return;
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
