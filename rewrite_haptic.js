const fs = require('fs');

let js = fs.readFileSync('app.js', 'utf8');

const newHapticCode = `// ─── 觸覺回饋 (進階波形引擎 Web Audio API) ─────────────────────────────
let audioCtx = null;

function initAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

/**
 * 播放自訂觸覺波形 (支援 ADSR 包絡線)
 * @param {Array} curve - 強度起伏陣列 (0.0 ~ 1.0)
 * @param {number} durationMs - 總時長 (毫秒)
 * @param {string} waveType - 波形類型 ('sine', 'square', 'sawtooth')
 * @param {number} frequency - 震動基頻 (Hz)
 */
function playHapticCurve(curve, durationMs, waveType = 'sine', frequency = 120) {
  if (localStorage.getItem('mute_haptic') === 'true') return;
  
  if (navigator.vibrate && /Android/i.test(navigator.userAgent)) {
    // Android 原生震動降級方案
    navigator.vibrate(durationMs);
    return;
  }

  try {
    initAudioCtx();
    const t = audioCtx.currentTime;
    const duration = durationMs / 1000;
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = waveType;
    osc.frequency.setValueAtTime(frequency, t);
    
    gain.gain.setValueAtTime(0, t);
    if (curve && curve.length > 0) {
      const step = duration / curve.length;
      for (let i = 0; i < curve.length; i++) {
        const val = Math.max(0.0001, curve[i]);
        gain.gain.exponentialRampToValueAtTime(val, t + (i + 1) * step);
      }
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch (e) {
    console.error('Haptic curve error:', e);
  }
}

function haptic(type = 'light') {
  if (localStorage.getItem('mute_haptic') === 'true') return;
  
  if (navigator.vibrate && /Android/i.test(navigator.userAgent)) {
    switch (type) {
      case 'light': navigator.vibrate(8); break;
      case 'medium': navigator.vibrate(20); break;
      case 'heavy': navigator.vibrate([15, 20, 25]); break;
      case 'error': navigator.vibrate([30, 40, 30, 40, 50]); break;
    }
    return;
  }

  // iOS 預設高精度波形
  switch (type) {
    case 'light':
      playHapticCurve([0.03, 0.01, 0.001], 30, 'sine', 150);
      break;
    case 'medium':
      playHapticCurve([0.08, 0.04, 0.001], 45, 'sine', 100);
      break;
    case 'heavy':
      playHapticCurve([0.2, 0.05, 0.001], 60, 'square', 80);
      break;
    case 'error':
      playHapticCurve([0.2, 0.01, 0.2, 0.01, 0.3], 250, 'sawtooth', 60);
      break;
  }
}

// ─── 自訂確認對話框`;

// Replace the old haptic code
const oldHapticRegex = /\/\/ ─── 音訊上下文.*?─── 自訂確認對話框/s;
js = js.replace(oldHapticRegex, newHapticCode);


const oldToggleHapticRegex = /\/\/ 漸漸放大的波紋震動效果.*?\}\s*if \(\!document\.startViewTransition\)/s;

const newToggleHapticCode = `// 漸變展開的漣漪波形震動 (Ripple Effect 400ms 完全同步視覺)
  if (localStorage.getItem('mute_haptic') !== 'true') {
    if (navigator.vibrate && /Android/i.test(navigator.userAgent)) {
      navigator.vibrate([8, 60, 20, 60, 40, 60, 80]); 
    } else {
      // 1:1 同步 400ms 動畫的完美曲線：[微起步, 落, 爬升, 落, 極強衝擊收尾]
      const rippleCurve = [0.02, 0.01, 0.05, 0.02, 0.15, 0.25, 0.001];
      playHapticCurve(rippleCurve, 400, 'sine', 120);
    }
  }

  if (!document.startViewTransition)`;

js = js.replace(oldToggleHapticRegex, newToggleHapticCode);

fs.writeFileSync('app.js', js, 'utf8');
console.log('Update successful.');
