// 前端直連 Firebase：真的 SDK 打測試專案 biyuan-dorm-test，原後端全部攔截，不碰正式資料和 Notion。
// 先跑：FIREBASE_PROJECT=biyuan-dorm-test node tools/firebase/migrate.cjs <備份資料夾>
// 用法：node tests/firebase-backend.cjs <備份資料夾>
const { chromium, webkit } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const backup = process.argv[2];
const TEST_FIREBASE = {
  apiKey: 'AIzaSyBPD5-joLY5BNyAPoKOSQOy_B1unENVgT4', authDomain: 'biyuan-dorm-test.firebaseapp.com',
  projectId: 'biyuan-dorm-test', appId: '1:96781388012:web:1a46247626e979d5c47dc9',
};
const API_FILES = { '/api/roster': 'roster', '/api/config': 'config', '/api/semester': 'semester', '/api/changelog': 'changelog', '/api/leave-records': 'leave_records', '/api/repair-records': 'repair_records', '/api/feedback-records': 'feedback_records', '/api/remarks': 'remarks', '/api/poll': 'poll' };
const read = n => JSON.parse(fs.readFileSync(path.join(backup, n + '.json'), 'utf8'));
const results = [];
const ok = (name, extra = '') => { results.push(name); console.log('PASS', name, extra); };

// 一台裝置。worker 決定原後端怎麼回；所有打到原後端的寫入記在 writes
async function device(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const writes = [], gets = [];
  const dev = { ctx, writes, gets, workerStatus: 200, rosterOverride: null, repairList: null };
  await ctx.addInitScript(() => { window.__FIREBASE_TEST__ = true; });
  await ctx.route('https://fbtest.test/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/config.js') {
      let src = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
      src = src.replace(/FIREBASE: \{[\s\S]*?\n  \},/, 'FIREBASE: ' + JSON.stringify(TEST_FIREBASE) + ',');
      if (opts.backend) src = src.replace("BACKEND: 'firebase'", `BACKEND: '${opts.backend}'`);
      assert.ok(src.includes('biyuan-dorm-test'), '測試一定要指到測試專案');
      return route.fulfill({ contentType: 'application/javascript', body: src });
    }
    const file = path.join(root, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
    return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
  });
  await ctx.route('**/*.workers.dev/**', route => {
    const req = route.request(), u = new URL(req.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() !== 'GET') {
      writes.push({ path: u.pathname, method: req.method(), body: JSON.parse(req.postData() || '{}') });
      if (dev.workerStatus !== 200) return route.fulfill({ status: dev.workerStatus, headers, json: { error: '模擬原後端失敗' } });
      return route.fulfill({ headers, json: { success: true } });
    }
    gets.push(u.pathname);
    if (u.pathname === '/api/roster' && dev.rosterOverride) return route.fulfill({ headers, json: dev.rosterOverride });
    if (u.pathname === '/api/repair-records' && dev.repairList) return route.fulfill({ headers, json: dev.repairList });
    if (API_FILES[u.pathname]) return route.fulfill({ headers, contentType: 'application/json', body: fs.readFileSync(path.join(backup, API_FILES[u.pathname] + '.json')) });
    return route.fulfill({ headers, json: {} });
  });
  if (opts.blockAuth) await ctx.route('**/identitytoolkit.googleapis.com/**', r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  dev.page = page; dev.errors = errors;
  await page.goto('https://fbtest.test/');
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading && state.students.length > 0, null, { timeout: 60000 });
  return dev;
}
const api = (dev, fn, ...args) => dev.page.evaluate(fn, ...args);
const until = async (fn, ms, label) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return Date.now() - t; if (Date.now() - t > ms) throw new Error('等太久：' + label); await new Promise(r => setTimeout(r, 100)); } };
const backendFetch = (dev, p) => api(dev, async p => (await fetch(CONFIG.WORKER_URL + p)).json(), p);
const mirrorDrained = dev => until(() => api(dev, () => window._firebaseBackend.mirrorQueue() === 0), 30000, '寫回佇列清空');

(async () => {
  if (!backup) throw new Error('要給備份資料夾');
  const browser = await (process.env.TEST_WEBKIT ? webkit : chromium).launch();
  try {
    const A = await device(browser), B = await device(browser);
    assert.equal(await api(A, () => window._firebaseBackend.live.failover), false, '應該走 Firebase');

    // 1. 讀回來的格式跟原後端完全相同
    for (const [p, n] of Object.entries(API_FILES)) {
      if (p === '/api/poll') continue;
      assert.deepStrictEqual(await backendFetch(A, p), read(n), p + ' 跟原後端不同');
    }
    const workerReads = A.gets.filter(p => p !== '/api/roster' || true).length;
    assert.equal(workerReads, 0, '正常時不該去讀原後端');
    ok('讀取格式與原後端相同 (8 個 API)，沒有打原後端');

    // 2. 點名：A 改，B 馬上看到，Notion 收到一模一樣的一批
    const roster = read('roster');
    const bed = roster.students.find(s => !s.isEmpty && s.name);
    const date = roster.dateColumns.find(d => /^\d{4}-/.test(d) && !bed.attendance[d]);
    await api(B, () => navigateTo('summary'));
    const body = { updates: [{ pageId: bed.id, date, value: '◎' }] };
    const t0 = Date.now();
    const res = await api(A, b => window._api.updateAttendance(b.updates), body);
    const writeMs = Date.now() - t0;
    assert.equal(res.success, true);
    const seenSdk = await until(() => api(B, ([id, d]) => (window._firebaseBackend.live.beds.get(id).attendance || {})[d] === '◎', [bed.id, date]), 10000, 'B 收到推送');
    const seenUi = await until(() => api(B, ([id, d]) => (state.students.find(s => s.id === id).attendance || {})[d] === '◎', [bed.id, date]), 10000, 'B 畫面更新');
    await mirrorDrained(A);
    assert.deepEqual(A.writes.filter(w => w.path === '/api/attendance').at(-1).body, body);
    assert.equal(B.writes.length, 0, 'B 沒改東西就不該寫回');
    ok('點名同步', `寫入 ${writeMs}ms、別台收到 ${seenSdk}ms、別台畫面 ${seenUi}ms`);

    // 清除：欄位要真的消失，跟原後端一樣不回傳空值
    await api(A, b => window._api.updateAttendance(b), [{ pageId: bed.id, date, value: '' }]);
    const cleared = (await backendFetch(A, '/api/roster')).students.find(s => s.id === bed.id);
    assert.ok(!(date in cleared.attendance));
    assert.deepStrictEqual(cleared, bed);
    ok('清除點名後資料還原');

    // 新日期：自動多一個日期欄，順序照原規則
    const newDate = '2027-01-19';
    const added = await api(A, b => window._api.updateAttendance(b), [{ pageId: bed.id, date: newDate, value: '✓' }]);
    assert.deepEqual(added.addedColumns, [newDate]);
    await until(async () => (await backendFetch(A, '/api/semester')).dateColumns.includes(newDate), 5000, '日期欄');
    const dates = (await backendFetch(A, '/api/roster')).dateColumns;
    assert.equal(dates.at(-1), newDate);
    await api(A, b => window._api.updateAttendance(b), [{ pageId: bed.id, date: newDate, value: '' }]);
    ok('新日期自動補欄');

    // 不合法的值不寫入，跟原後端同樣回報
    const bad = await api(A, b => window._api.updateAttendance(b).catch(e => ({ thrown: e.message })), [{ pageId: bed.id, date: '2026-13-45', value: '✓' }]);
    assert.ok(bad.thrown && bad.thrown.includes('不合法'), JSON.stringify(bad));
    ok('不合法資料被擋');

    // 基本資料：更新與清除都照原後端規則
    const empty = roster.students.find(s => s.isEmpty && s.squad);
    await api(A, b => window._api.updateAttendance(b), [{ pageId: empty.id, updateProfile: { name: '測試生', class: '測試班', studentId: 'T1', phone: '0900', address: '台中', isForeign: true } }]);
    let got = (await backendFetch(A, '/api/roster')).students.find(s => s.id === empty.id);
    assert.deepEqual([got.name, got.class, got.studentId, got.phone, got.address, got.isForeign, got.isEmpty], ['測試生', '測試班', 'T1', '0900', '台中', true, false]);
    await api(A, b => window._api.updateAttendance(b), [{ pageId: empty.id, clearProfile: true, markEmpty: true }]);
    got = (await backendFetch(A, '/api/roster')).students.find(s => s.id === empty.id);
    assert.deepEqual([got.name, got.class, got.studentId, got.phone, got.address, got.isForeign, got.isEmpty], ['', '', '', '', '', false, true]);
    ok('基本資料更新與清除');

    // 3. 兩隊同時按回報，互相不會蓋掉
    const day = '2099-01-01';
    await Promise.all([
      api(A, d => window._api.confirmSquad(d, '三雙', true), day),
      api(B, d => window._api.confirmSquad(d, '一單', true), day),
    ]);
    await until(async () => (await backendFetch(A, '/api/config'))['confirm_' + day] === '一單,三雙', 5000, '回報合併');
    await mirrorDrained(A); await mirrorDrained(B);
    const mirroredConfirm = [...A.writes, ...B.writes].filter(w => w.path === '/api/config' && w.body['confirm_' + day] !== undefined);
    assert.equal(mirroredConfirm.length, 2);
    ok('兩隊同時回報都留著', '寫回 Notion 2 次');

    // 回報在別台的 poll 看得到
    const today = await api(A, () => localTodayISO());
    await api(A, ([d]) => window._api.confirmSquad(d, '二單', true), [today]);
    await until(async () => (await api(B, () => window._api.poll())).confirms.split(',').includes('二單'), 5000, 'poll 回報');
    await api(A, ([d]) => window._api.confirmSquad(d, '二單', false), [today]);
    ok('今日回報即時傳到別台');

    // 4. 換床：只換人，床位不動
    const [x, y] = roster.students.filter(s => !s.isEmpty && s.name).slice(0, 2);
    await api(A, ([a, b]) => window._api.swapBeds(a, b), [x.id, y.id]);
    await until(async () => (await backendFetch(A, '/api/roster')).students.find(s => s.id === x.id).name === y.name, 5000, '換床');
    const after = (await backendFetch(A, '/api/roster')).students;
    const nx = after.find(s => s.id === x.id), ny = after.find(s => s.id === y.id);
    assert.deepEqual([nx.room, nx.bed, nx.squad, nx.name, nx.phone], [x.room, x.bed, x.squad, y.name, y.phone]);
    assert.deepEqual(nx.attendance, y.attendance);
    assert.deepEqual(ny.attendance, x.attendance);
    await api(A, ([a, b]) => window._api.swapBeds(a, b), [x.id, y.id]);
    await until(async () => (await backendFetch(A, '/api/roster')).students.find(s => s.id === x.id).name === x.name, 5000, '換回');
    await mirrorDrained(A);
    assert.equal(A.writes.filter(w => w.path === '/api/swap-beds').length, 2);
    ok('換床正確且寫回');

    // 5. 備註、設定、公告
    await api(A, ([p, r]) => window._api.updateRemark(p, r), [bed.id, '測試備註']);
    await until(async () => (await backendFetch(B, '/api/remarks'))[bed.id] === '測試備註', 5000, '備註同步');
    await api(A, ([p, r]) => window._api.updateRemark(p, r), [bed.id, '']);
    await until(async () => !(bed.id in (await backendFetch(B, '/api/remarks'))), 5000, '備註清除');
    await api(A, () => window._api.setConfig({ test_key: 'abc', 'snapshot_2099-01-02': 'snap' }));
    await until(async () => { const c = await backendFetch(B, '/api/config'); return c.test_key === 'abc' && c['snapshot_2099-01-02'] === 'snap'; }, 5000, '設定同步');
    const log = await api(A, () => window._api.postChangelog('測試公告'));
    assert.ok(log.id);
    assert.equal((await backendFetch(A, '/api/changelog'))[0].content, '測試公告');
    ok('備註、設定、公告');

    // 6. 請假、報修、意見：新增、篩選、刪除；Notion 那邊也跟著刪
    const post = (p, d, method = 'POST') => api(A, async ([p, d, m]) => (await fetch(CONFIG.WORKER_URL + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json(), [p, d, method]);
    await post('/api/leave-records', { name: '測試請假', roomBed: 'B112 - A', dateStart: '2099-01-01', dateEnd: '2099-01-02', handler: '幹部', callerPhone: '0911', callerNote: '備註' });
    const taipeiToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    let leaves = await backendFetch(A, `/api/leave-records?from=${taipeiToday}&to=${taipeiToday}&name=${encodeURIComponent('測試請假')}`);
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0].title, '測試請假 的請假申請');
    assert.equal((await backendFetch(A, '/api/leave-records?from=2000-01-01&to=2000-01-02')).length, 0);
    assert.equal((await backendFetch(A, '/api/leave-records'))[0].name, '測試請假');

    await post('/api/repair-records', { reason: '燈壞了', reporter: '測試人', photos: ['data:image/jpeg;base64,AAAA'] });
    const repairs = await backendFetch(A, '/api/repair-records');
    assert.equal(repairs[0].reason, '燈壞了');
    assert.deepEqual(repairs[0].photos, ['data:image/jpeg;base64,AAAA']);
    assert.ok(repairs[0].title.startsWith('測試人 的報修通知'));
    await mirrorDrained(A);
    A.repairList = [{ id: 'notion-page-1', reporter: '測試人', reason: '燈壞了', photos: [] }];
    await post('/api/repair-records', { id: repairs[0].id }, 'DELETE');
    await mirrorDrained(A);
    assert.equal(A.writes.filter(w => w.path === '/api/repair-records' && w.method === 'DELETE').at(-1).body.id, 'notion-page-1');
    assert.equal((await backendFetch(A, '/api/repair-records')).length, read('repair_records').length);

    const feedback0 = read('feedback_records');
    await post('/api/feedback-records', { content: '測試意見', photos: [] });
    const fb = await backendFetch(A, '/api/feedback-records');
    assert.equal(fb[0].name, '匿名');
    assert.equal(fb.length, feedback0.length + 1);
    ok('請假、報修、意見新增刪除', '新紀錄刪除時用內容對到 Notion 的那筆');

    // 7. 原後端掛掉：使用者照常成功，等後端好了自動補寫；重開 APP 也不會丟
    A.workerStatus = 503;
    const n0 = A.writes.length;
    const r2 = await api(A, b => window._api.updateAttendance(b), [{ pageId: bed.id, date, value: '△' }]);
    assert.equal(r2.success, true);
    await until(() => A.writes.length > n0, 5000, '第一次寫回嘗試');
    assert.ok(await api(A, () => window._firebaseBackend.mirrorQueue()) >= 1, '失敗要留在佇列');
    await A.page.reload();
    await A.page.waitForFunction(() => typeof state !== 'undefined' && !state.loading && state.students.length > 0, null, { timeout: 60000 });
    assert.ok(await api(A, () => window._firebaseBackend.mirrorQueue()) >= 1, '重開後佇列還在');
    assert.equal((await backendFetch(A, '/api/roster')).students.find(s => s.id === bed.id).attendance[date], '△');
    A.workerStatus = 200;
    await api(A, () => window._firebaseBackend.pumpMirror());
    await until(() => api(A, () => window._firebaseBackend.mirrorQueue() === 0), 70000, 'Notion 恢復後補寫');
    const last = A.writes.filter(w => w.path === '/api/attendance').at(-1);
    assert.deepEqual(last.body, { updates: [{ pageId: bed.id, date, value: '△' }] });
    await api(A, b => window._api.updateAttendance(b), [{ pageId: bed.id, date, value: '' }]);
    await mirrorDrained(A);
    ok('Notion 掛掉不影響點名，恢復後自動補寫');

    // 8. Firebase 開機就連不上：自動改走原後端
    const C = await device(browser, { blockAuth: true });
    assert.equal(await api(C, () => window._firebaseBackend.live.failover), true);
    assert.equal(await api(C, () => state.students.length), roster.students.length);
    await api(C, b => window._api.updateAttendance(b), [{ pageId: bed.id, date, value: '◎' }]);
    assert.equal(C.writes.filter(w => w.path === '/api/attendance').length, 1, '直接寫原後端');
    assert.equal(await api(C, () => window._firebaseBackend.mirrorQueue()), 0, '直接寫了就不用再排隊');
    assert.deepEqual(C.errors, []);
    await C.ctx.close();
    ok('Firebase 連不上時改走 Notion');

    // 9. Firebase 用到一半斷掉：這次寫入改走原後端，不會丟
    const D = await device(browser);
    await D.ctx.route('**/firestore.googleapis.com/**', r => r.abort());
    await D.ctx.setOffline(false);
    await D.page.evaluate(() => firebase.firestore().disableNetwork());
    const t1 = Date.now();
    const r3 = await api(D, b => window._api.updateAttendance(b), [{ pageId: bed.id, date, value: '✘' }]);
    assert.equal(r3.success, true);
    assert.equal(D.writes.filter(w => w.path === '/api/attendance').length, 1);
    assert.equal(await api(D, () => window._firebaseBackend.live.failover), true);
    ok('Firebase 中途斷線改走 Notion', `多等 ${Date.now() - t1}ms`);
    await D.ctx.close();

    // 10. 匯入等管理動作：先做 Notion，再把結果複製回 Firebase
    const changed = JSON.parse(JSON.stringify(roster));
    changed.students.find(s => s.id === bed.id).phone = '0987654321';
    A.rosterOverride = changed;
    await api(A, () => window._api.importBatch({ students: [] }));
    assert.equal(A.writes.filter(w => w.path === '/api/import-batch').length, 1);
    assert.equal((await backendFetch(A, '/api/roster')).students.find(s => s.id === bed.id).phone, '0987654321');
    ok('匯入走 Notion 後複製回 Firebase');

    // 11. 安全規則：匿名不能刪床位、學期、設定、請假
    const denied = await api(A, async id => {
      const db = firebase.firestore(), out = [];
      const tries = [
        ['bed', db.collection('semesters').doc('115-1').collection('beds').doc(id).delete()],
        ['semester', db.collection('semesters').doc('115-1').delete()],
        ['config', db.collection('config').doc('pin').delete()],
        ['leave', db.collection('leave_records').limit(1).get().then(s => s.docs[0].ref.delete())],
      ];
      for (const [n, p] of tries) await p.then(() => out.push(n + ':allowed'), e => out.push(n + ':' + e.code));
      return out;
    }, bed.id);
    assert.deepEqual(denied, ['bed:permission-denied', 'semester:permission-denied', 'config:permission-denied', 'leave:permission-denied']);
    ok('安全規則擋下刪除');

    // WebKit 重新整理時中斷連線會多一則錯誤訊息，不影響功能
    const realErrors = list => list.filter(m => !m.includes('/Listen/channel') && !m.includes('/Write/channel'));
    // 12. 系統狀態看得到的額度估算：有讀有寫就會累計，不是 0
    const usage = await api(A, () => window._firebaseBackend.getUsage());
    assert.ok(usage.reads > 0 && usage.writes > 0, JSON.stringify(usage));
    assert.match(usage.resetAt, /^\d{2}:\d{2}$/);
    ok('額度估算有累計', `讀 ${usage.reads}、寫 ${usage.writes}、刪 ${usage.deletes}，${usage.resetAt} 歸零`);

    assert.deepEqual(realErrors(A.errors), [], 'A 畫面錯誤');
    assert.deepEqual(realErrors(B.errors), [], 'B 畫面錯誤');
    console.log(`firebase-backend 全部通過：${results.length} 項`);
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL', String(e.message || e).slice(0, 1200)); process.exit(1); });
