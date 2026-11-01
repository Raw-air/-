// 用真的系統畫面比對：同一份程式分別吃「Notion 備份」和「從 Firestore 組回的資料」，
// 比 Excel 匯出的每一格、樣式、檔名和主要頁面文字。還會故意改壞一格，確認比對抓得到。
// 用法：node compare-app.cjs <備份資料夾> <組回資料夾>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..', '..');
const API_FILES = { '/api/roster': 'roster', '/api/config': 'config', '/api/semester': 'semester', '/api/changelog': 'changelog', '/api/leave-records': 'leave_records', '/api/repair-records': 'repair_records', '/api/feedback-records': 'feedback_records', '/api/remarks': 'remarks', '/api/poll': 'poll' };
const SQUADS = ['一單', '一雙', '二單', '二雙', '三單', '三雙'];
const PAGES = ['home', 'summary', 'student-files', 'leave-records', 'repair-review', 'feedback-review'];

async function capture(browser, source) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const req = route.request(), u = new URL(req.url());
    if (u.hostname === 'compare.test') {
      const file = path.join(root, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (u.hostname.endsWith('workers.dev')) {
      if (req.method() !== 'GET') { writes.push(req.method() + ' ' + u.pathname); return route.fulfill({ json: { success: true } }); }
      const name = API_FILES[u.pathname];
      if (name) return route.fulfill({ contentType: 'application/json', body: source(name) });
      return route.fulfill({ json: {} });
    }
    if (u.hostname.includes('jsdelivr') || u.hostname.includes('cdnjs')) return route.continue();
    if (u.hostname.includes('fonts.g')) return route.continue();
    return route.abort();
  });

  await page.goto('https://compare.test/');
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading && state.students.length > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.body.classList.contains('rawair-booting'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const text = {};
  for (const name of PAGES) {
    await page.evaluate(n => navigateTo(n), name);
    await page.waitForTimeout(1300);
    text[name] = await page.locator('#page-' + name).innerText();
  }
  for (const squad of SQUADS) {
    await page.evaluate(s => { // 跟 enterSquad 一樣，只是跳過 PIN 視窗
      state.currentSquad = s;
      state.currentDate = getTodayAttendanceDate();
      state.rollcallEnteredDate = localTodayISO();
      state.dateManuallyPicked = false;
      navigateTo('rollcall');
    }, squad);
    await page.waitForTimeout(900);
    text['rollcall ' + squad] = await page.locator('#page-rollcall').innerText();
  }
  const data = await page.evaluate(() => ({
    students: state.students.map(s => [s.id, s.name, s.room, s.bed, s.class, s.studentId, s.phone, s.address, s.squad, s.isForeign, s.isEmpty, s.hidden, s.remarks, s.attendance]),
    dateColumns: state.dateColumns,
  }));

  // Excel：整個學期 + 現在畫面預設的範圍都匯一次，攔下交給 writeFile 的內容
  await page.evaluate(() => window.ensureXLSX());
  await page.evaluate(() => {
    window.__exports = [];
    const orig = XLSX.writeFile;
    XLSX.writeFile = (wb, name) => {
      const ws = wb.Sheets[wb.SheetNames[0]];
      window.__exports.push({ name, sheetNames: wb.SheetNames, ws: JSON.parse(JSON.stringify(ws)), rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) });
      return orig(wb, name);
    };
  });
  const semester = JSON.parse(source('semester')).current;
  const dates = await page.evaluate(() => {
    initializeExportDateInputs();
    return [document.getElementById('export-start-date').value, document.getElementById('export-end-date').value];
  });
  for (const [start, end] of [[semester.start, semester.end], dates]) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.evaluate(([s, e]) => {
        document.getElementById('export-start-date').value = s;
        document.getElementById('export-end-date').value = e;
        return exportExcel();
      }, [start, end]),
    ]);
    await download.delete();
  }
  const exports = await page.evaluate(() => window.__exports);
  await ctx.close();
  return { text, data, exports, errors, writes };
}

function countCellDiffs(a, b) {
  let diffs = 0;
  for (let i = 0; i < Math.max(a.exports.length, b.exports.length); i++) {
    const x = a.exports[i].ws, y = b.exports[i].ws;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) diffs++;
  }
  return diffs;
}

(async () => {
  const [backup, rebuilt] = process.argv.slice(2);
  if (!backup || !rebuilt) throw new Error('要給備份資料夾和組回資料夾');
  const reader = dir => n => fs.readFileSync(path.join(dir, n + '.json'), 'utf8');
  const browser = await chromium.launch();
  try {
    const notion = await capture(browser, reader(backup));
    const firebase = await capture(browser, reader(rebuilt));
    assert.deepEqual(notion.errors, [], '備份版畫面有錯誤');
    assert.deepEqual(firebase.errors, [], 'Firebase 版畫面有錯誤');
    assert.deepEqual(firebase.writes, notion.writes, '兩邊送出的寫入要一樣');

    assert.deepStrictEqual(firebase.data, notion.data, '系統載入的住宿生資料不同');
    for (const k of Object.keys(notion.text)) assert.equal(firebase.text[k], notion.text[k], `頁面 ${k} 文字不同`);
    assert.ok(notion.exports.length === 2 && firebase.exports.length === 2, '要匯出 2 份');
    for (let i = 0; i < 2; i++) {
      assert.equal(firebase.exports[i].name, notion.exports[i].name);
      assert.deepStrictEqual(firebase.exports[i].sheetNames, notion.exports[i].sheetNames);
      assert.deepStrictEqual(firebase.exports[i].rows, notion.exports[i].rows, `第 ${i + 1} 份 Excel 內容不同`);
    }
    assert.equal(countCellDiffs(notion, firebase), 0, 'Excel 儲存格或樣式不同');

    // 反向測試：改壞 1 位住宿生的 1 個日期，比對一定要抓到
    const bad = JSON.parse(reader(rebuilt)('roster'));
    const victim = bad.students.find(s => !s.isEmpty && s.room);
    const date = bad.dateColumns.find(d => /^\d{4}-/.test(d) && d >= bad.semester.start && d <= bad.semester.end);
    victim.attendance[date] = victim.attendance[date] === '✗' ? '✓' : '✗';
    const badRead = n => n === 'roster' ? JSON.stringify(bad) : reader(rebuilt)(n);
    const broken = await capture(browser, badRead);
    const caught = countCellDiffs(notion, broken);
    assert.ok(caught > 0, '故意改壞一格卻沒被抓到，比對方法有問題');

    for (const [i, e] of notion.exports.entries()) {
      const cells = e.rows.reduce((n, r) => n + r.length, 0);
      console.log(`Excel ${i + 1}: ${e.name}，${e.rows.length} 列、${e.rows[0].length} 欄、${cells} 格相同；表頭前 7 欄 ${e.rows[0].slice(0, 7).join(' ')}`);
    }
    console.log(`頁面文字相同：${Object.keys(notion.text).length} 頁 (${Object.entries(notion.text).map(([k, v]) => k + ' ' + v.length + '字').join('、')})`);
    console.log(`系統載入住宿生 ${notion.data.students.length} 筆、日期欄 ${notion.data.dateColumns.length} 個相同；畫面錯誤 0；反向測試改 1 位住宿生的 1 天，抓到 ${caught} 處差異`);
  } finally { await browser.close(); }
})().catch(e => { console.error(String(e.message || e).slice(0, 1500)); process.exit(1); });
