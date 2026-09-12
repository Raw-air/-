const { chromium, webkit } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });

const now = new Date();
const date = `${now.getMonth() + 1}月${now.getDate()}日`;
const roster = [
  { id: 'empty-1', name: '', studentId: '', class: '', squad: '一單', room: 'B101', bed: 'A', attendance: {}, isForeign: false, isEmpty: true },
  { id: 'foreign-1', name: '合成外籍生', studentId: 'TEST-F1', class: '測試班', squad: '一單', room: 'B103', bed: 'A', attendance: {}, isForeign: true, isEmpty: false },
  { id: 'leave-1', name: '合成請假生', studentId: 'TEST-L1', class: '測試班', squad: '二單', room: 'B201', bed: 'A', attendance: { [date]: '◎' }, isForeign: false, isEmpty: false },
  { id: 'absent-1', name: '合成未請假生', studentId: 'TEST-A1', class: '測試班', squad: '三單', room: 'B301', bed: 'A', attendance: { [date]: '✘' }, isForeign: false, isEmpty: false },
  { id: 'present-1', name: '合成在場生', studentId: 'TEST-P1', class: '測試班', squad: '三雙', room: 'B302', bed: 'A', attendance: { [date]: '✓' }, isForeign: false, isEmpty: false },
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
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') {
      const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname === '/api/roster' ? { students: roster, dateColumns: [date] }
        : url.pathname === '/api/config' ? { total_beds: '7', bed_offset: '1', foreign_offset: '1' }
        : url.pathname === '/api/poll' ? { ts: 0, att_ts: 0 }
        : url.pathname === '/api/ping' ? { ok: true }
        : {};
      return route.fulfill({ json: body });
    }
    if (url.pathname.includes('marked')) return route.fulfill({ body: 'window.marked={parse:s=>s};', contentType: 'application/javascript' });
    return route.fulfill({ status: 200, body: '' });
  });
  const page = await context.newPage();
  await page.addInitScript(mode => {
    localStorage.setItem('power_save_mode', 'true');
    localStorage.setItem('white_mode', String(mode));
  }, lightMode);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading);
  await page.evaluate(() => navigateTo('summary'));
  await page.waitForTimeout(220);

  assert.equal(await page.locator('#page-summary .summary-stat-link').count(), 5);
  const labels = await page.locator('#page-summary .summary-stat-link').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
  assert.ok(labels.every(Boolean));
  for (const button of await page.locator('#page-summary .summary-stat-link').all()) {
    const box = await button.boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44);
  }

  const cases = [
    ['empty', '空床數明細', ['B101 A床', '空床修正值', '空床合計', '2']],
    ['foreign', '外籍生明細', ['合成外籍生', '外籍生修正值', '外籍生合計', '2']],
    ['leave', '請假名單', ['合成請假生', '請假合計', '1']],
    ['absent', '未請假名單', ['合成未請假生', '未請假合計', '1']],
    ['rate', '住宿率計算明細', ['5 ÷ 7 × 100% = 71.4%', '總床數', '空床數', '住宿人數']],
  ];
  for (const [kind, title, expected] of cases) {
    if (kind === 'empty') await page.locator('[aria-label="查看空床數計算明細"]').click();
    else await page.evaluate(value => openSummaryDetail(value), kind);
    await page.waitForTimeout(220);
    assert.ok(await page.locator('#page-summary-detail').evaluate(element => element.classList.contains('active')));
    assert.equal(await page.locator('#summary-detail-title').innerText(), title);
    const text = await page.locator('#summary-detail-content').innerText();
    expected.forEach(fragment => assert.ok(text.includes(fragment), `${kind} detail should contain ${fragment}`));
    assert.equal(await page.locator('.liquid-nav [aria-current="page"]').getAttribute('data-page'), 'summary');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }

  await page.evaluate(() => {
    const snapshotDate = '2026-09-10';
    state.currentDate = snapshotDate;
    state.config['snapshot_' + snapshotDate] = JSON.stringify({
      totalBeds: 7, totalEmpty: 2, residents: 5, rate: 71.4, bedOffset: 1,
      present: 3, leave: 2, absent: 0, shouldAttend: 5, foreign: 2, foreignOffset: 1, squads: [],
    });
    openSummaryDetail('leave');
  });
  await page.waitForTimeout(220);
  const lockedText = await page.locator('#page-summary-detail').innerText();
  assert.ok(lockedText.includes('已鎖定快照'));
  assert.ok(lockedText.includes('歷史快照名單差額'));
  assert.ok(lockedText.includes('為什麼有差額？'));
  assert.ok(lockedText.includes('這天的快照沒有存名字'));

  await page.evaluate(() => {
    const snapshotDate = '2026-09-10';
    state.config['snapshot_' + snapshotDate] = JSON.stringify({
      totalBeds: 7, totalEmpty: 2, residents: 5, rate: 71.4, bedOffset: 1,
      present: 3, leave: 2, absent: 0, shouldAttend: 5, foreign: 2, foreignOffset: 1, squads: [],
      lists: { leave: ['leave-1', 'ghost-id'], absent: [], empty: [], foreign: [] },
    });
    openSummaryDetail('leave');
  });
  await page.waitForTimeout(220);
  const whoText = await page.locator('#page-summary-detail').innerText();
  assert.ok(whoText.includes('差額是誰'));
  assert.ok(whoText.includes('合成請假生'));
  assert.ok(whoText.includes('已刪除的住宿生'));
  await page.evaluate(() => { state.currentDate = getTodayColumnName(); });

  const screenshotKind = viewport.width < viewport.height ? (lightMode ? 'rate' : 'foreign') : 'empty';
  await page.evaluate(value => openSummaryDetail(value), screenshotKind);
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, `summary-detail-${engine.name()}-${viewport.width}x${viewport.height}-${lightMode ? 'light' : 'dark'}.png`), fullPage: true });

  await page.locator('.summary-detail-back').click();
  await page.waitForTimeout(220);
  assert.ok(await page.locator('#page-summary').evaluate(element => element.classList.contains('active')));
  await browser.close();
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await verify(chromium, { width: 375, height: 812 });
    await verify(chromium, { width: 844, height: 390 });
    await verify(chromium, { width: 768, height: 1024 }, true);
    if (process.env.TEST_WEBKIT) await verify(webkit, { width: 390, height: 844 });
    console.log('Summary drill-down details, formulas, responsive layout and navigation PASS');
  } finally {
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
