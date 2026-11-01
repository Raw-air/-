// 換版時：沒回應的舊畫面自動重新載入一次，已是新版的畫面不動 (真的 Service Worker，API 全部攔截)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
let swText = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
let pageIsOld = true;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }); return res.end(swText); }
  if (p === '/firebase-backend.js' && pageIsOld) { res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }); return res.end('// 舊版沒有這支'); }
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
// 在畫面放記號：記號不見 = 畫面被重新載入過
const mark = page => page.evaluate(() => { window.__sameLoad = true; });
const log = (...a) => console.error(new Date().toISOString().slice(14, 23), ...a);
const timeout = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
const stillSameLoad = page => timeout(page.evaluate(() => window.__sameLoad === true).catch(() => false), 3000, false);
// 畫面可能正在換頁，用短輪詢等系統載入完成，不卡在舊的執行環境
async function waitAppLoaded(page, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const ok = await timeout(page.evaluate(() => document.readyState === 'complete' && typeof CONFIG !== 'undefined').catch(() => false), 1500, false);
    if (ok) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('系統沒有載入完成：' + page.url());
}
const publish = (page, version) => {
  swText = swText.replace(/biyuan-v\d+/, version);
  return timeout(page.evaluate(() => { navigator.serviceWorker.getRegistration().then(r => r.update()); }), 5000);
};
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('**/*.workers.dev/**', route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/roster') return route.fulfill({ json: { students: [{ id: 's', name: '甲', room: '101', bed: 'A', squad: '一單', class: '', studentId: '', attendance: {} }], dateColumns: [] } });
      return route.fulfill({ json: {} });
    });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    log('goto ok');
    await waitAppLoaded(page, 30000);
    log('controlled');
    await page.waitForTimeout(3000); // 第一次安裝時舊畫面也會重載一次，等它結束

    // 舊畫面開著時發布新版
    await waitAppLoaded(page, 20000);
    await mark(page);
    log('marked');
    pageIsOld = false;
    await publish(page, 'biyuan-v99901');
    const t = Date.now();
    while (await stillSameLoad(page) && Date.now() - t < 25000) await page.waitForTimeout(200);
    assert.equal(await stillSameLoad(page), false, '舊畫面要自動重新載入');
    await waitAppLoaded(page, 15000);
    console.log('sw-reload-old: 舊畫面自動換新 PASS', Date.now() - t, 'ms');

    // 已是新版的畫面再換一版：不該被重新載入
    await page.waitForTimeout(1500);
    await waitAppLoaded(page, 15000);
    await mark(page);
    await publish(page, 'biyuan-v99902');
    await page.waitForTimeout(8000);
    assert.equal(await stillSameLoad(page), true, '新版畫面不該被重新載入');
    console.log('sw-reload-old: 新版畫面不被打斷 PASS');
  } finally { await browser.close(); server.closeAllConnections(); server.close(); }
})().then(() => process.exit(0)).catch(e => { console.error(String(e.message || e).slice(0, 500)); process.exit(1); });
