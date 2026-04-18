const fs = require('fs');

// 1. Update index.html
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('<span>觸覺震動反饋</span>', '<span>關閉震動</span>');
html = html.replace('<span style="color:var(--dim); font-size:11px;">開啟按鍵與互動震動 (支援的手機裝置)</span>', '<span style="color:var(--dim); font-size:11px;">關閉所有按鍵與互動震動回饋</span>');
html = html.replace('<input type="checkbox" id="setting-haptic" onchange="toggleHaptic(this)" checked>', '<input type="checkbox" id="setting-haptic" onchange="toggleHaptic(this)">');
fs.writeFileSync('index.html', html, 'utf8');

// 2. Update app.js
let js = fs.readFileSync('app.js', 'utf8');

// A. Fix textContent -> innerHTML for RC Confirm SVG
js = js.replace(/document\.getElementById\('rc-confirm-icon'\)\.textContent =/g, "document.getElementById('rc-confirm-icon').innerHTML =");

// B. Fix showToast using textContent
js = js.replace(/t\.textContent = msg;/g, "t.innerHTML = msg;");

// C. Fix haptic ignoring mute
js = js.replace(/function haptic\(type = 'light'\) \{/g, "function haptic(type = 'light') {\n  if (localStorage.getItem('mute_haptic') === 'true') return;");

// D. Invert toggleHaptic
js = js.replace(
  /function toggleHaptic\(el\) \{\s*localStorage\.setItem\('mute_haptic', !el\.checked\);\s*if \(el\.checked\) triggerHapticFeedback\('confirm'\);\s*\}/g,
  "function toggleHaptic(el) {\n  localStorage.setItem('mute_haptic', el.checked);\n  if (!el.checked) triggerHapticFeedback('confirm');\n}"
);

// E. Fix the init of hapticToggle in DOMContentLoaded
js = js.replace(
  /if \(localStorage\.getItem\('mute_haptic'\) === 'true'\) \{\s*const hapticToggle = document\.getElementById\('setting-haptic'\);\s*if \(hapticToggle\) hapticToggle\.checked = false;\s*\}/g,
  "if (localStorage.getItem('mute_haptic') === 'true') {\n      const hapticToggle = document.getElementById('setting-haptic');\n      if (hapticToggle) hapticToggle.checked = true;\n    }"
);

// F. Add haptic feedback when turning into 3D card
js = js.replace(/activeCard\.classList\.add\('is-3d-active'\);/g, "activeCard.classList.add('is-3d-active');\n        haptic('medium');");

fs.writeFileSync('app.js', js, 'utf8');
console.log('Updates completed successfully.');
