// 點名資料不遺失：未同步變更存 localStorage 並跨中隊保留、分批送出時部分失敗只留失敗的那幾筆、
// 背景刷新保護「所有日期」的待送變更（不只目前檢視的那天）、標記空床不動過去的紀錄、
// 換床前會先送完待同步的點名 (送不出去就中止換床)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayISO = iso(today);
    const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    const yestISO = iso(yest);
    let dateColumns = [yestISO, todayISO];

    const mk = (id, name, room, bed, extra) => ({
      id, name, room, bed, squad: '一單', class: '測試班', studentId: id.toUpperCase(),
      isForeign: false, attendance: { [todayISO]: '✓' }, ...extra,
    });
    const students = [];
    for (let i = 1; i <= 21; i++) students.push(mk('b' + i, '生' + i, '2' + String(i).padStart(2, '0'), 'A'));
    students.push(mk('failStudent', '會失敗', '299', 'A'));
    students.push(mk('multiDateStudent', '跨日待送', '501', 'A'));
    students.push(mk('ebStudent', '空床測試', '301', 'A', { attendance: { [yestISO]: '◎', [todayISO]: '✓' } }));
    students.push(mk('swapA', 'Alice', '401', 'A'));
    students.push(mk('swapB', 'Bob', '402', 'A'));

    let failMode = 'none'; // 'none' | 'silent' (success:false 但不拋錯) | 'throw' (data.error 觸發 api.js 拋錯)
    let networkDown = false;
    let swapCalled = false;
    const attRequests = []; // 每次 PATCH /api/attendance 的 updates 陣列

    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === 'rollcallsync.test') {
        const file = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
        return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
      }
      if (u.pathname === '/api/roster') {
        return route.fulfill({ json: { students: students.map(s => ({ ...s, attendance: { ...s.attendance } })), dateColumns } });
      }
      if (u.pathname === '/api/config') return route.fulfill({ json: {} });
      if (u.pathname === '/api/attendance') {
        const updates = JSON.parse(route.request().postData()).updates;
        attRequests.push(updates);
        if (networkDown) return route.fulfill({ status: 500, json: { error: '模擬網路錯誤' } });
        const hasFail = updates.some(x => x.pageId === 'failStudent');
        if (hasFail && failMode === 'silent') {
          return route.fulfill({ json: { success: false, errors: [{ pageId: 'failStudent', error: '測試失敗' }] } });
        }
        if (hasFail && failMode === 'throw') {
          return route.fulfill({ json: { success: false, error: '部分失敗', errors: [{ pageId: 'failStudent', error: '測試失敗' }] } });
        }
        return route.fulfill({ json: { success: true, updated: updates.length } });
      }
      if (u.pathname === '/api/swap-beds') { swapCalled = true; return route.fulfill({ json: { success: true } }); }
      if (u.pathname.includes('marked')) return route.fulfill({ body: 'window.marked={parse:s=>s}', contentType: 'application/javascript' });
      return route.fulfill({ json: {} });
    });

    await page.goto('https://rollcallsync.test/');
    await page.waitForFunction(() => !state.loading);

    // ── 情境一 (BUG 22)：22 筆變更分兩批 (20+2) 送出，其中一筆失敗；成功的移除、失敗的留在 state.changes 等下次重送 ──
    failMode = 'throw';
    attRequests.length = 0;
    const r1 = await page.evaluate(async ({ todayISO }) => {
      state.currentSquad = '一單'; state.currentDate = todayISO;
      const items = [];
      for (let i = 1; i <= 21; i++) items.push({ pageId: 'b' + i, date: todayISO, value: '✓' });
      items.push({ pageId: 'failStudent', date: todayISO, value: '◎' });
      state.changes = items;
      saveUnsyncedChanges();
      await backupPendingChanges();
      return {
        remaining: state.changes.map(c => c.pageId),
        stored: (JSON.parse(localStorage.getItem('biyuan_unsynced_changes')) || []).map(c => c.pageId),
        gotRecentSync: !!state.recentSyncs['b1_' + todayISO],
        failedGotRecentSync: !!state.recentSyncs['failStudent_' + todayISO],
      };
    }, { todayISO });
    assert.deepEqual(r1.remaining, ['failStudent'], '只有失敗的那筆留在 state.changes');
    assert.deepEqual(r1.stored, ['failStudent'], 'localStorage 也只留失敗的那筆');
    assert.equal(r1.gotRecentSync, true, '成功的那幾筆要記進 recentSyncs 避免畫面閃回舊值');
    assert.equal(r1.failedGotRecentSync, false, '失敗的那筆不能被誤標記為已同步');
    assert.equal(attRequests.length, 2, '21+1 筆應該分兩批送出');
    assert.equal(attRequests[0].length, 20, '每批上限 20 筆');
    assert.equal(attRequests[1].length, 2, '第二批是剩下的 2 筆');

    // ── 情境二 (BUG 7)：離線時點名留在 state.changes + localStorage；換中隊不清空；重開頁面後還在；徽章可點擊重送 ──
    failMode = 'none';
    await page.evaluate(() => { state.changes = []; saveUnsyncedChanges(); });
    networkDown = true;
    await page.evaluate(() => { toggleStatus('b1'); });
    await page.waitForTimeout(1200); // 等 800ms debounce + 同步失敗
    const afterFail = await page.evaluate(() => state.changes.length);
    assert.equal(afterFail, 1, '同步失敗的變更要留在 state.changes');

    await page.evaluate(() => { enterSquad('一單'); });
    const afterEnterSquad = await page.evaluate(() => state.changes.length);
    assert.equal(afterEnterSquad, 1, 'enterSquad 不能清空還沒送出的變更');

    await page.reload();
    await page.waitForFunction(() => !state.loading);
    const afterReload = await page.evaluate(() => state.changes.length);
    assert.equal(afterReload, 1, '重開 APP 後未同步的變更要從 localStorage 載回來');

    await page.waitForTimeout(2700); // 徽章延遲 2.5 秒才顯示
    const badge1 = await page.evaluate(() => {
      const el = document.getElementById('unsynced-badge');
      return el ? { hidden: el.hidden, text: el.textContent } : null;
    });
    assert.ok(badge1 && !badge1.hidden, '有未同步變更時，畫面上要有小標示');
    assert.match(badge1.text, /未同步\s*1\s*筆/, '小標示要顯示筆數');

    networkDown = false;
    await page.evaluate(() => document.getElementById('unsynced-badge').click());
    await page.waitForFunction(() => state.changes.length === 0, { timeout: 5000 });
    const badge2 = await page.evaluate(() => document.getElementById('unsynced-badge').hidden);
    assert.equal(badge2, true, '全部送出後小標示要隱藏');

    // ── 情境三 (BUG 16)：背景刷新合併時，非「目前檢視日期」的待送變更也要保護 ──
    const r3 = await page.evaluate(async ({ todayISO, yestISO }) => {
      state.currentDate = todayISO; // 目前檢視的是今天
      state.changes = [{ pageId: 'multiDateStudent', date: yestISO, value: '◎' }]; // 但待送變更是昨天的
      saveUnsyncedChanges();
      const rosterStudents = state.students.map(s =>
        s.id === 'multiDateStudent' ? { ...s, attendance: { ...s.attendance, [yestISO]: '✓' } } : { ...s, attendance: { ...s.attendance } }
      );
      state.students = applyLocalStateToRoster(rosterStudents, state.dateColumns);
      return state.students.find(s => s.id === 'multiDateStudent').attendance[yestISO];
    }, { todayISO, yestISO });
    assert.equal(r3, '◎', '背景刷新不能洗掉非目前檢視日期的待送點名');

    await page.evaluate(() => { state.changes = []; saveUnsyncedChanges(); });

    // ── 情境四 (BUG 18)：標記空床只把「今天以後」填成勾勾，過去的點名紀錄不能動 ──
    attRequests.length = 0;
    const r4 = await page.evaluate(async ({ yestISO }) => {
      openEmptyBedModal();
      document.getElementById('eb-room').value = '301';
      updateBedOptions();
      document.getElementById('eb-bed').value = 'A';
      await submitEmptyBed();
      const s = state.students.find(x => x.id === 'ebStudent');
      return { past: s.attendance[yestISO], isEmpty: s.isEmpty };
    }, { yestISO });
    assert.equal(r4.past, '◎', '空床的過去請假紀錄不能被覆寫成勾勾');
    assert.equal(r4.isEmpty, true);
    assert.equal(attRequests.length, 1);
    assert.ok(!Object.prototype.hasOwnProperty.call(attRequests[0][0].dates, yestISO), '送給後端的 dates 也不該包含過去的日期');

    // ── 情境五 (BUG 19)：換床前若還有未同步的點名，先嘗試送出；送不出去就中止換床 ──
    networkDown = true;
    const r5a = await page.evaluate(async ({ todayISO }) => {
      state.changes = [{ pageId: 'swapA', date: todayISO, value: '◎' }];
      saveUnsyncedChanges();
      openSwapBedModal();
      document.getElementById('sw-from-room').value = '401'; updateSwapFromBeds();
      document.getElementById('sw-from-bed').value = 'A';
      document.getElementById('sw-to-room').value = '402'; updateSwapToBeds();
      document.getElementById('sw-to-bed').value = 'A';
      await submitSwapBed();
      return { changesLen: state.changes.length, nameA: state.students.find(s => s.id === 'swapA').name };
    }, { todayISO });
    assert.equal(r5a.changesLen, 1, '同步失敗時變更仍要留著');
    assert.equal(r5a.nameA, 'Alice', '有未同步的點名送不出去時，換床要中止');
    assert.equal(swapCalled, false, '換床失敗時不能呼叫 swap-beds API');

    networkDown = false;
    const r5b = await page.evaluate(async () => {
      await submitSwapBed();
      return {
        changesLen: state.changes.length,
        nameA: state.students.find(s => s.id === 'swapA').name,
        nameB: state.students.find(s => s.id === 'swapB').name,
      };
    });
    assert.equal(r5b.changesLen, 0, '網路恢復後未同步的點名要先送完');
    assert.equal(r5b.nameA, 'Bob', '待送點名送完後才真的換床');
    assert.equal(r5b.nameB, 'Alice');
    assert.equal(swapCalled, true, '待送點名送完後應該呼叫 swap-beds API');

    assert.deepEqual(errors, []);
    console.log('rollcall-sync: unsynced changes persist + badge, batched partial-failure, multi-date protection, empty-bed future-only, swap flush-before-swap PASS');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
