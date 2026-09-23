// 點名頁「全部請假」：整隊改成請假、分批送出、空床不動、斷網時留在未同步清單 (API 全部攔截，不會寫到正式 Notion)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results'); fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const d = new Date();
    const todayISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const students = [];
    for (let i = 0; i < 28; i++) {
      students.push({ id: 's' + i, name: '住宿生' + i, room: String(201 + Math.floor(i / 4)), bed: String(i % 4 + 1),
        squad: '一單', class: '測試班', studentId: 'T' + i, isForeign: false, attendance: { [todayISO]: i === 3 ? '◎' : i === 5 ? '✘' : '✓' } });
    }
    students.push({ id: 'empty1', name: '', room: '299', bed: '1', squad: '一單', isEmpty: true, attendance: {} });
    students.push({ id: 'other', name: '別隊', room: '301', bed: '1', squad: '二單', class: '', studentId: 'X', attendance: { [todayISO]: '✓' } });

    let networkDown = false;
    const attRequests = [];
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === 'leaveall.test') {
        const file = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
        return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
      }
      if (u.pathname === '/api/roster') return route.fulfill({ json: { students: students.map(s => ({ ...s, attendance: { ...s.attendance } })), dateColumns: [todayISO] } });
      if (u.pathname === '/api/config') return route.fulfill({ json: {} });
      if (u.pathname === '/api/attendance') {
        attRequests.push(JSON.parse(route.request().postData()).updates);
        if (networkDown) return route.fulfill({ status: 500, json: { error: '模擬網路錯誤' } });
        return route.fulfill({ json: { success: true } });
      }
      if (u.pathname.includes('marked')) return route.fulfill({ body: 'window.marked={parse:s=>s}', contentType: 'application/javascript' });
      return route.fulfill({ json: {} });
    });

    await page.goto('https://leaveall.test/');
    await page.waitForFunction(() => !state.loading && state.students.length === 30);
    await page.evaluate(() => enterSquad('一單'));
    await page.waitForSelector('#rc-leave-all-btn');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, 'leave-all-0-before.png') });

    // 按鈕 → 確認框寫出要改幾位 (28 人 - 已請假 1 位 = 27)
    await page.click('#rc-leave-all-btn');
    await page.waitForSelector('.confirm-overlay.visible');
    assert.match(await page.locator('.confirm-msg').innerText(), /27/);
    // 取消 → 什麼都不動
    await page.click('#cfd-cancel');
    await page.waitForTimeout(350);
    assert.equal(attRequests.length, 0);
    assert.equal(await page.evaluate(() => state.students.find(s => s.id === 's0').attendance[state.currentDate]), '✓');

    // 確認 → 翻牌動畫中間截兩張圖
    await page.click('#rc-leave-all-btn');
    await page.waitForSelector('.confirm-overlay.visible');
    await page.click('#cfd-confirm');
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(out, 'leave-all-1-flipping.png') });
    assert.ok(await page.evaluate(() => document.getElementById('rc-student-list').classList.contains('la-running')), '翻牌中不能點');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, 'leave-all-2-flipping.png') });
    await page.waitForFunction(() => !document.getElementById('rc-student-list').classList.contains('la-running'), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, 'leave-all-3-after.png') });

    const r = await page.evaluate(() => {
      const mine = state.students.filter(s => s.squad === '一單' && !s.isEmpty);
      return {
        allLeave: mine.every(s => s.attendance[state.currentDate] === '◎'),
        emptyTouched: !!state.students.find(s => s.id === 'empty1').attendance[state.currentDate],
        otherSquad: state.students.find(s => s.id === 'other').attendance[state.currentDate],
        badges: [...document.querySelectorAll('#rc-student-list .student-row:not(.empty-bed) .status-badge')].map(b => b.textContent.trim()),
        leaveStat: document.getElementById('rc-stat-leave').textContent,
        changes: state.changes.length,
      };
    });
    assert.equal(r.allLeave, true, '本隊全部變請假');
    assert.equal(r.emptyTouched, false, '空床不動');
    assert.equal(r.otherSquad, '✓', '別的中隊不動');
    assert.equal(r.badges.length, 28);
    assert.ok(r.badges.every(t => t.includes('請假')), '畫面上每條都顯示請假');
    await page.waitForFunction(() => document.getElementById('rc-stat-leave').textContent === '28');
    assert.equal(r.changes, 0, '送成功後未同步清單清空');
    const sent = attRequests.flat();
    assert.equal(sent.length, 27, '只送原本不是請假的 27 位');
    assert.ok(sent.every(x => x.value === '◎' && x.pageId !== 's3' && x.pageId !== 'empty1'));
    assert.ok(attRequests.every(b => b.length <= 20), '每批最多 20 筆');

    // 再按一次：已經全部請假 → 只跳提示、不送東西
    const before = attRequests.length;
    await page.click('#rc-leave-all-btn');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.confirm-overlay.visible').count(), 0);
    assert.equal(attRequests.length, before);

    // 斷網：畫面照樣改，但變更留在未同步清單 (localStorage) 等重送
    await page.evaluate(() => { for (const s of state.students) if (s.squad === '一單' && !s.isEmpty) s.attendance[state.currentDate] = '✓'; renderRollCall(true); });
    networkDown = true;
    await page.click('#rc-leave-all-btn');
    await page.waitForSelector('.confirm-overlay.visible');
    await page.click('#cfd-confirm');
    await page.waitForFunction(() => !document.getElementById('rc-student-list').classList.contains('la-running'), null, { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('.toast, #toast')?.textContent.includes('還沒同步'), null, { timeout: 5000 }).catch(() => {});
    const off = await page.evaluate(() => ({
      changes: state.changes.length,
      stored: (JSON.parse(localStorage.getItem('biyuan_unsynced_changes')) || []).length,
    }));
    assert.equal(off.changes, 28, '斷網時 28 筆都留著');
    assert.equal(off.stored, 28, 'localStorage 也有 28 筆');

    assert.deepEqual(errors, []);
    console.log('leave-all: all checks passed');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
