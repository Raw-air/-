// 個人請假查詢：搜尋 → 選人 → 逐日請假統計 → 電話請假紀錄
const { chromium, webkit } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });

// 連續 5 天的欄位，方便驗證「連假併成一段」
const dateColumns = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
const roster = [
  {
    id: 'll-1', name: '林小假', studentId: 'LL001', class: '測試班', squad: '一單', room: 'B101', bed: 'A',
    attendance: { '2026-09-07': '◎', '2026-09-08': '◎', '2026-09-09': '✓', '2026-09-10': '✘', '2026-09-11': '△' },
    isForeign: false, isEmpty: false,
  },
  {
    id: 'll-2', name: '陳全勤', studentId: 'LL002', class: '測試班', squad: '一單', room: 'B102', bed: 'B',
    attendance: {}, isForeign: false, isEmpty: false,
  },
  { id: 'll-empty', name: '', studentId: '', class: '', squad: '一單', room: 'B103', bed: 'A', attendance: {}, isForeign: false, isEmpty: true },
];

const leaveRecords = [
  { title: '林小假 請假', name: '林小假', roomBed: 'B101 - A', dateStart: '2026-09-07', dateEnd: '2026-09-08', handler: '值班教官', createdAt: '2026-09-06T12:00:00.000Z' },
  { title: '別人 請假', name: '王別人', roomBed: 'B999 - A', dateStart: '2026-09-01', dateEnd: '2026-09-02', handler: '櫃台', createdAt: '2026-09-01T01:00:00.000Z' },
];

const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, name === '/' ? 'index.html' : name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
});

async function verify(engine, viewport, lightMode = false) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') {
      const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname === '/api/roster' ? { students: roster, dateColumns }
        : url.pathname === '/api/leave-records' ? leaveRecords
        : url.pathname === '/api/config' ? { total_beds: '3' }
        : url.pathname === '/api/poll' ? { ts: 0, att_ts: 0 }
        : url.pathname === '/api/ping' ? { ok: true }
        : {};
      return route.fulfill({ json: body });
    }
    if (url.pathname.includes('marked')) return route.fulfill({ body: 'window.marked={parse:s=>s};', contentType: 'application/javascript' });
    return route.fulfill({ status: 200, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(mode => {
    localStorage.setItem('power_save_mode', 'true');
    localStorage.setItem('white_mode', String(mode));
  }, lightMode);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading);

  // 從「更多選項」的工具頁進入
  await page.evaluate(() => navigateTo('tools'));
  await page.waitForTimeout(250);
  const toolLabels = await page.locator('#page-tools .eb-title').allTextContents();
  assert.ok(toolLabels.includes('請假狀況查詢'), '工具頁應該有請假狀況查詢');
  await page.locator('#page-tools button', { hasText: '請假狀況查詢' }).click();
  await page.waitForTimeout(320);
  assert.ok(await page.locator('#page-leave-lookup').evaluate(el => el.classList.contains('active')));
  assert.equal(await page.locator('.liquid-nav [aria-current="page"]').getAttribute('data-page'), 'summary');
  assert.ok((await page.locator('#ll-results').innerText()).includes('先在上面輸入'));

  // 搜尋房號也找得到；空床不出現在結果裡
  await page.fill('#ll-search-input', 'B10');
  await page.waitForTimeout(300);
  const resultNames = await page.locator('#ll-results .ll-result-main strong').allTextContents();
  assert.deepEqual(resultNames, ['林小假', '陳全勤']);

  // 同音字搜尋
  await page.fill('#ll-search-input', '林小駕');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.locator('#ll-results .ll-result-main strong').allTextContents(), ['林小假']);

  await page.locator('#ll-results .ll-result-btn').first().click();
  await page.waitForTimeout(400);
  const detail = await page.locator('#ll-detail').innerText();
  assert.ok(detail.includes('林小假'), '應顯示學生姓名');
  assert.ok(detail.includes('B101 A床'), '應顯示房床');
  // ◎2 + △1 = 3 天請假；✘1；✓1；共 5 天
  assert.ok(/請假天數\s*3/.test(detail.replace(/\n/g, ' ')), '請假天數應為 3，實得：' + detail);
  assert.ok(detail.includes('5 天 ・ 60%'), '已記錄天數與佔比應為 5 天 ・ 60%');
  // 9/7~9/8 連續請假併成一段；9/11 特殊自成一段；9/10 未請假
  assert.ok(detail.includes('9/7 (一) ～ 9/8 (二)'), '連續兩天請假要併段');
  assert.ok(detail.includes('9/11 (五)'), '特殊日要列出');
  assert.ok(detail.includes('9/10 (四)'), '未請假日要列出');
  assert.ok(detail.includes('未請假'), '應有未請假區塊');

  // 電話請假紀錄只挑到這位同學的
  await page.waitForFunction(() => {
    const box = document.getElementById('ll-records');
    return box && box.innerText.includes('值班教官');
  }, null, { timeout: 5000 });
  const records = await page.locator('#ll-records').innerText();
  assert.ok(records.includes('2026-09-07 ～ 2026-09-08'));
  assert.ok(!records.includes('王別人'), '不應混入其他人的紀錄');

  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '不能有橫向捲動');
  await page.screenshot({ path: path.join(output, `leave-lookup-${engine.name()}-${viewport.width}x${viewport.height}-${lightMode ? 'light' : 'dark'}.png`), fullPage: true });

  // 換一位 → 回到搜尋結果
  await page.locator('.ll-change-btn').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#ll-detail').innerText(), '');
  assert.ok((await page.locator('#ll-results').innerText()).includes('林小假'));

  // 全勤的人：0 天請假
  await page.fill('#ll-search-input', '陳全勤');
  await page.waitForTimeout(300);
  await page.locator('#ll-results .ll-result-btn').first().click();
  await page.waitForTimeout(350);
  const clean = await page.locator('#ll-detail').innerText();
  assert.ok(clean.includes('這學期沒有請過假'));
  assert.ok(clean.includes('沒有未請假紀錄'));

  await page.locator('.ll-back').click();
  await page.waitForTimeout(320);
  assert.ok(await page.locator('#page-tools').evaluate(el => el.classList.contains('active')));

  assert.deepEqual(errors, []);
  await browser.close();
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await verify(chromium, { width: 375, height: 812 });
    await verify(chromium, { width: 768, height: 1024 }, true);
    if (process.env.TEST_WEBKIT) await verify(webkit, { width: 390, height: 844 });
    console.log('Leave lookup search, per-day stats, ranges and phone records PASS');
  } finally {
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
