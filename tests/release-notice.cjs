// 大改版通知：開機結束後跳一次、按「知道了」後重開不再跳、已看過舊通知的裝置換 ID 會再跳 (API 全部攔截)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results'); fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false })); // 當成真人，通知才會跳
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === 'notice.test') {
        const file = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
        return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
      }
      if (u.pathname === '/api/roster') return route.fulfill({ json: { students: [] } });
      if (u.pathname === '/api/config') return route.fulfill({ json: {} });
      if (u.pathname.includes('marked')) return route.fulfill({ body: 'window.marked={parse:s=>s}', contentType: 'application/javascript' });
      return route.fulfill({ json: {} });
    });

    // 第一次打開：開機畫面結束後才跳
    await page.goto('https://notice.test/');
    await page.waitForSelector('#release-notice.visible', { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('rawair-booting')), false, '通知不可比開機畫面早跳');
    assert.match(await page.textContent('#release-notice'), /系統大改版/);
    assert.match(await page.textContent('#release-notice'), /資料庫搬家/);
    assert.equal(await page.locator('#release-notice svg').count(), 1, '要有搬家小圖');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, 'release-notice.png') });

    // 真的點得到 (沒有被別的東西蓋住)
    await page.click('#release-notice button', { timeout: 3000 });
    await page.waitForSelector('#release-notice', { state: 'detached' });
    assert.equal(await page.evaluate(() => localStorage.getItem('biyuan_release_notice_seen')), 'v33-moving-day');

    // 重開不再跳
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains('rawair-booting'), null, { timeout: 30000 });
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#release-notice').count(), 0, '看過就不該再跳');

    // 看過舊通知的裝置，換新 ID 會再跳
    await page.evaluate(() => localStorage.setItem('biyuan_release_notice_seen', 'older'));
    await page.reload();
    await page.waitForSelector('#release-notice.visible', { timeout: 30000 });

    assert.deepEqual(errors, []);
    console.log('release-notice OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
