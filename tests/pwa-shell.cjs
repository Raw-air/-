// PWA 殼層：sw.js 的 ASSETS 清單完整且都真的存在、index.html 引用的本機 js/css 都有進快取、
// SW 改版提示條只有使用者點了才 reload、電話請假抓取失敗 30 秒內不重抓 (點重試才立刻重抓)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });

// ── 1. 靜態檢查：sw.js 的 ASSETS 每一項都真的存在於 repo ─────────────────────
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const assetsMatch = swSrc.match(/const ASSETS\s*=\s*(\[[\s\S]*?\]);/);
assert.ok(assetsMatch, 'sw.js 找得到 ASSETS 陣列');
const ASSETS = new Function(`return ${assetsMatch[1]}`)();
assert.ok(Array.isArray(ASSETS) && ASSETS.length > 0, 'ASSETS 是非空陣列');
for (const entry of ASSETS) {
  const rel = entry.replace(/^\.\//, '').split('?')[0] || 'index.html';
  const file = path.join(root, rel);
  assert.ok(fs.existsSync(file), `sw.js ASSETS 裡的 ${entry} 對應的檔案 ${rel} 必須存在`);
}
console.log('pwa-shell: sw.js ASSETS 全部檔案都存在 PASS (' + ASSETS.length + ' 項)');

// ── 2. 靜態檢查：index.html 引用的每個本機 js/css 都要在 ASSETS 裡 (離線才不會破圖/白畫面) ──
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const isLocal = href => !/^https?:\/\//.test(href);
const scriptSrcs = [...htmlSrc.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(isLocal);
const linkHrefs = [...htmlSrc.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]).filter(isLocal);
const assetSet = new Set(ASSETS.map(u => u.replace(/^\.\//, '')));
for (const href of [...scriptSrcs, ...linkHrefs]) {
  assert.ok(assetSet.has(href), `index.html 引用的本機檔案 ${href} 必須列在 sw.js ASSETS 裡`);
}
console.log('pwa-shell: index.html 本機 js/css 都有進 ASSETS PASS (' + (scriptSrcs.length + linkHrefs.length) + ' 項)');

// ── 3. 靜態檢查：manifest.json orientation 是 any (平板橫放能轉) ────────────
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.orientation, 'any', 'manifest.json orientation 應該是 any，橫放才會轉');
console.log('pwa-shell: manifest.json orientation=any PASS');

// ── 4. 靜態檢查：sw.js install 用 cache:'reload' 繞過 HTTP 快取，./index.html 走 network-first ──
assert.match(swSrc, /cache:\s*'reload'/, "sw.js install 事件要用 cache:'reload' 抓 ASSETS");
assert.match(swSrc, /isShell/, 'sw.js fetch 事件要區分殼層 (network-first) 跟其他版號檔案 (cache-first)');
console.log('pwa-shell: sw.js install cache:reload + shell network-first PASS');

// ── 瀏覽器測試共用的假資料/路由 ──────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const roster = [
  { id: 'pw-1', name: '測試生', studentId: 'PW1', class: '測試班', squad: '一單', room: 'B101', bed: 'A', attendance: {}, isForeign: false, isEmpty: false },
];

function baseRoute(context, extra) {
  return context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1') {
      const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (extra) { const handled = await extra(route, req, url); if (handled) return; }
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname === '/api/roster' ? { students: roster, dateColumns: [today] }
        : url.pathname === '/api/config' ? { total_beds: '1' }
        : url.pathname === '/api/poll' ? { ts: 0, att_ts: 0 }
        : url.pathname === '/api/attendance' ? { success: true }
        : {};
      return route.fulfill({ json: body });
    }
    if (url.pathname.includes('marked')) return route.fulfill({ body: 'window.marked={parse:s=>s};', contentType: 'application/javascript' });
    return route.fulfill({ status: 200, body: '' });
  });
}

// ── 5. 瀏覽器測試：phone-leave 抓取失敗後 30 秒內不重抓，點重試才立刻重抓 ──────
async function phoneLeaveRetryGate() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  let leaveRecordsCalls = 0;
  let failLeaveRecords = true;
  await baseRoute(context, (route, req, url) => {
    if (url.pathname === '/api/leave-records' && req.method() === 'GET') {
      leaveRecordsCalls++;
      if (failLeaveRecords) { route.fulfill({ status: 500, body: 'boom' }); return true; }
      route.fulfill({ json: [] });
      return true;
    }
    return false;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:1/');
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading);

  await page.evaluate(() => openPhoneLeaveRecords());
  await page.waitForFunction(() => document.getElementById('leave-records-list')?.textContent.includes('載入失敗'));
  assert.equal(leaveRecordsCalls, 1, '第一次進頁面只打一次 API');
  assert.match(await page.locator('#leave-records-list').textContent(), /載入失敗，點此重試/, '失敗時顯示「載入失敗，點此重試」而不是自動重抓');

  // 30 秒冷卻期內：多次觸發重新渲染 (換日期、切月份、直接呼叫 render) 都不該再打 API
  await page.evaluate(() => { phoneLeaveShiftMonth(0); phoneLeaveRender(); phoneLeaveRender(); });
  await page.waitForTimeout(500);
  assert.equal(leaveRecordsCalls, 1, '30 秒內重複觸發 render 不會再打 API (不是無限重抓)');

  // 使用者按「點此重試」→ 清掉 error、立刻重抓 (不受 30 秒冷卻限制)
  failLeaveRecords = false;
  await page.locator('#leave-records-list .ll-change-btn').click();
  await page.waitForFunction(() => !document.getElementById('leave-records-list')?.textContent.includes('載入失敗'));
  assert.equal(leaveRecordsCalls, 2, '點重試會立刻再打一次 API');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('pwa-shell: phone-leave 失敗後 30 秒內不重抓、點重試才重抓 PASS');
}

// ── 6. 瀏覽器測試：SW 有新版本時顯示提示條，點了才 reload (不自動蓋掉未同步的變更) ──
async function swUpdateToast() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await baseRoute(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // serviceWorkers:'block' 讓瀏覽器不會真的裝 SW，這裡直接模擬「controllerchange 事件」，
    // 驗證提示條的顯示/點擊邏輯本身 (location.reload 不能覆寫，所以用「有沒有真的重新導覽」判斷)
    await page.goto('http://127.0.0.1:1/');
    await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading);
    let navigations = 0;
    page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });

    const toast = page.locator('#sw-update-toast');
    await toast.waitFor({ state: 'attached', timeout: 2000 });
    assert.equal(await toast.isVisible(), false, '一開始不該顯示更新提示');

    // 第一次安裝 (之前沒有 SW 在控制) 的 controllerchange 不該提示
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await page.waitForTimeout(400);
    assert.equal(await toast.isVisible(), false, '第一次安裝的 controllerchange 不該顯示更新提示');

    // 之前已有 SW 在控制 → 新 SW 接手才提示，而且不能自動 reload
    await page.evaluate(() => { document.documentElement.dataset.swControlled = '1'; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
    await page.waitForFunction(() => document.getElementById('sw-update-toast').classList.contains('show'));
    await page.waitForTimeout(600);
    assert.equal(navigations, 0, 'controllerchange 後不能自動 reload');

    await Promise.all([page.waitForNavigation({ timeout: 10000 }), toast.click()]);
    assert.ok(navigations >= 1, '點了提示條才 reload');
    assert.deepEqual(errors, []);
    console.log('pwa-shell: SW 更新提示條只在點擊後才 reload PASS');
  } finally { await browser.close(); }
}

(async () => {
  await phoneLeaveRetryGate();
  await swUpdateToast();
})().catch(e => { console.error(e); process.exitCode = 1; });
