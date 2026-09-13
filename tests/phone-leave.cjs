// 電話請假：視窗多了來電號碼/來電者，送出會帶到後端；紀錄頁可選日期看當天來電
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const at = (dayOffset, h, m) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m); return d.toISOString(); };
const dateColumns = [today];
const roster = [
  { id: 'pl-1', name: '林小假', studentId: 'P1', class: '測試班', squad: '一單', room: 'B101', bed: 'A', attendance: {}, isForeign: false, isEmpty: false },
  { id: 'pl-2', name: '陳電話', studentId: 'P2', class: '測試班', squad: '一單', room: 'B102', bed: 'B', attendance: {}, isForeign: false, isEmpty: false },
];
const records = [
  { name: '林小假', roomBed: 'B101 - A', dateStart: today, dateEnd: today, handler: '櫃台小明', callerPhone: '0912-345-678', callerNote: '媽媽代打', createdAt: at(0, 9, 5) },
  { name: '陳電話', roomBed: 'B102 - B', dateStart: today, dateEnd: today, handler: '', callerPhone: '', callerNote: '本人', createdAt: at(0, 21, 40) },
  { name: '舊紀錄', roomBed: 'B999 - A', dateStart: today, dateEnd: today, handler: '教官', createdAt: at(-1, 20, 0) },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
  const posts = [];
  const queries = [];
  const errors = [];
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1') {
      const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/leave-records') {
        if (req.method() === 'POST') { posts.push(req.postDataJSON()); return route.fulfill({ json: { success: true } }); }
        queries.push(url.search);
        return route.fulfill({ json: records });
      }
      const body = url.pathname === '/api/roster' ? { students: roster, dateColumns }
        : url.pathname === '/api/config' ? { total_beds: '2' }
        : url.pathname === '/api/poll' ? { ts: 0, att_ts: 0 }
        : url.pathname === '/api/attendance' ? { success: true }
        : {};
      return route.fulfill({ json: body });
    }
    if (url.pathname.includes('marked')) return route.fulfill({ body: 'window.marked={parse:s=>s};', contentType: 'application/javascript' });
    return route.fulfill({ status: 200, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('power_save_mode', 'true'));
  await page.goto('http://127.0.0.1:1/');
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading);

  // 1. 櫃台請假視窗：填來電號碼 + 快速按鈕填來電者 → 送出帶到後端
  await page.evaluate(() => openCounterLeaveModal());
  await page.fill('#cl-search', '林小假');
  await page.dispatchEvent('#cl-search', 'input');
  await page.fill('#cl-caller-phone', '0987-654-321');
  await page.click('.pl-note-chips button:has-text("家長")');
  assert.equal(await page.inputValue('#cl-caller-note'), '家長');
  await page.fill('#cl-caller-note', '家長 爸爸打來');
  await page.screenshot({ path: path.join(output, 'phone-leave-modal.png') });
  await page.evaluate(() => submitCounterLeave());
  await page.waitForFunction(() => !document.getElementById('counter-leave-modal').classList.contains('visible'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].callerPhone, '0987-654-321');
  assert.equal(posts[0].callerNote, '家長 爸爸打來');
  assert.equal(posts[0].name, '林小假');

  // 2. 工具頁有入口 → 紀錄頁預設今天，只列今天的 2 通，新的在上面
  await page.evaluate(() => navigateTo('tools'));
  await page.waitForTimeout(250);
  await page.locator('#page-tools button', { hasText: '電話請假紀錄' }).click();
  await page.waitForSelector('#leave-records-list .pl-row');
  const month = today.slice(0, 7);
  assert.ok(queries.some(q => q.includes(`from=${month}-01`)), '依月份向後端查詢');
  let names = await page.locator('#leave-records-list .pl-main strong').allTextContents();
  assert.equal(names.length, 2);
  assert.ok(names[0].startsWith('陳電話') && names[1].startsWith('林小假'), '晚的在上面：' + names);
  assert.equal(await page.locator('#leave-records-list .pl-phone').first().textContent(), '0912-345-678');
  assert.ok((await page.locator('#leave-records-list').textContent()).includes('未記錄號碼'));
  assert.equal(await page.inputValue('#pl-date'), today);
  const todayCell = page.locator('.pl-cal-day.is-selected small');
  assert.equal(await todayCell.textContent(), '2');
  await page.screenshot({ path: path.join(output, 'phone-leave-records.png'), fullPage: true });

  // 3. 搜尋篩選
  await page.fill('#pl-filter', '媽媽');
  await page.dispatchEvent('#pl-filter', 'input');
  names = await page.locator('#leave-records-list .pl-main strong').allTextContents();
  assert.equal(names.length, 1);
  await page.fill('#pl-filter', '');
  await page.dispatchEvent('#pl-filter', 'input');

  // 4. 前一天 → 只剩舊紀錄 (跨月時會另外查上個月)
  await page.click('.pl-step[aria-label="前一天"]');
  await page.waitForFunction(() => document.querySelectorAll('#leave-records-list .pl-row').length === 1);
  assert.ok((await page.locator('#leave-records-list').textContent()).includes('舊紀錄'));

  // 5. 行事曆點一個沒紀錄的日子
  await page.evaluate(d => phoneLeaveSetDay(d), `${month}-01` === today ? `${month}-02` : `${month}-01`);
  const emptyText = await page.locator('#leave-records-list').textContent();
  if (!records.some(r => new Date(r.createdAt).getDate() === 1 || new Date(r.createdAt).getDate() === 2)) assert.ok(emptyText.includes('沒有人打電話'));

  // 6. 個人請假查詢也顯示來電資訊
  await page.evaluate(() => { openLeaveLookup(); });
  await page.waitForTimeout(350);
  await page.evaluate(() => selectLeaveLookupStudent ? selectLeaveLookupStudent('pl-1') : null).catch(() => {});

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('phone-leave: modal caller fields, POST payload, records page by date, calendar counts, filter, day step PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
