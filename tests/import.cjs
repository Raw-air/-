// Excel 匯入精靈 (import.js) 專屬回歸測試：合併儲存格/全形正規化、電話補零、批次部分失敗重試、
// 清空床位保護與二次確認、localStorage 殘留清理、XLSX 延遲載入、重複列偵測。
// 全部離線執行：攔截所有 /api/* 與外部資源，不連正式後端；直接呼叫 window.__impTest 暴露的內部函式。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });

function mkStudent(o) {
  return Object.assign({
    id: 'x', name: '', studentId: '', class: '', squad: '一單',
    room: '', bed: '', attendance: {}, remarks: '', phone: '', address: '',
    isForeign: false, isEmpty: false, hidden: false,
  }, o);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
  const errors = [];
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1') {
      const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname === '/api/roster' ? { students: [], dateColumns: [] }
        : url.pathname === '/api/config' ? { total_beds: '10' }
        : url.pathname === '/api/poll' ? { ts: 0, att_ts: 0 }
        : url.pathname === '/api/ping' ? { ok: true }
        : url.pathname === '/api/attendance' ? { success: true }
        : {};
      return route.fulfill({ json: body });
    }
    // 其餘一律回空內容 200；外部 CDN (含 xlsx.bundle.js) 也會落到這裡，
    // 所以頁面預設 window.XLSX 是 undefined —— 剛好拿來測 BUG 34「尚未載入」的情境。
    return route.fulfill({ status: 200, body: '' });
  });

  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('power_save_mode', 'true'));
  await page.goto('http://127.0.0.1:1/');
  await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading);
  assert.ok(await page.evaluate(() => !!window.__impTest), '__impTest 測試掛鉤存在');

  // ────────────────────────────────────────────────────────────
  // BUG 27(2)：合併儲存格/全形字元不能讓比對失敗 —— NFKC + 大小寫正規化
  // ────────────────────────────────────────────────────────────
  const r27a = await page.evaluate(() => {
    state.students = [
      { id: 's1', name: '學生一', studentId: 'ID001', class: '一班', squad: '一單', room: 'B101', bed: 'A', attendance: {}, remarks: '', phone: '0911000001', address: '', isForeign: false, isEmpty: false, hidden: false },
    ];
    // Excel：全形房號/床位、全形空白包住姓名、學號大小寫不同 —— 都應視為「沒有變動」
    const rows = [['Ｂ１０１', 'ａ', '　學生一　', 'id001', '一班', '', '']];
    const mapping = { room: 0, bed: 1, name: 2, studentId: 3, class: 4, phone: -1, address: -1 };
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    return { room: preview.items[0].room, bed: preview.items[0].bed, action: preview.items[0].action, matched: preview.items[0].matched };
  });
  assert.equal(r27a.room, 'B101', 'NFKC 正規化：全形房號比對到半形房號');
  assert.equal(r27a.bed, 'A', 'NFKC + 大小寫：全形小寫床位比對到半形大寫');
  assert.equal(r27a.matched, true);
  assert.equal(r27a.action, 'unchanged', '學號大小寫不同、姓名多全形空白都不算異動');

  // ────────────────────────────────────────────────────────────
  // BUG 27(1)：房號欄空白就沿用上一列 (buildPreview 內建的 fallback)
  // ────────────────────────────────────────────────────────────
  const r27b = await page.evaluate(() => {
    state.students = [
      { id: 's3', name: '學生三', studentId: 'ID003', class: '三班', squad: '一單', room: 'B102', bed: 'A', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false },
      { id: 's4', name: '', studentId: '', class: '', squad: '一單', room: 'B102', bed: 'B', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: true, hidden: false },
    ];
    const rows = [
      ['B102', 'A', '學生三', 'ID003', '三班'],
      ['', 'B', '新生四', 'NEW004', '四班'],   // 房號沿用上一列的 B102 (合併儲存格常見)
    ];
    const mapping = { room: 0, bed: 1, name: 2, studentId: 3, class: 4, phone: -1, address: -1 };
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    return preview.items.map(it => ({ room: it.room, bed: it.bed, roomInherited: it.roomInherited, action: it.action, matched: it.matched }));
  });
  assert.equal(r27b[0].roomInherited, false);
  assert.equal(r27b[1].room, 'B102', '房號空白時沿用上一列的房號');
  assert.equal(r27b[1].roomInherited, true, '有標示「沿用上一列」');
  assert.equal(r27b[1].matched, true, '沿用房號後才能比對到床位');
  assert.equal(r27b[1].action, 'update');

  // ────────────────────────────────────────────────────────────
  // BUG 27(1) 另一半：SheetJS 合併儲存格 (!merges) 要把左上格的值往下填
  // ────────────────────────────────────────────────────────────
  const r27c = await page.evaluate(() => {
    // 造一個假的 window.XLSX：sheet_to_json 直接回傳預先做好的列資料，decode_range 解析 "A1:E3" 這種格式
    window.XLSX = {
      utils: {
        decode_range(ref) {
          const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
          const colNum = s => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
          return { s: { r: +m[2] - 1, c: colNum(m[1]) }, e: { r: +m[4] - 1, c: colNum(m[3]) } };
        },
        sheet_to_json(ws) { return ws.__rows.map(r => r.slice()); },
      },
    };
    const ws = {
      '!ref': 'A1:E3',
      '!merges': [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }], // 房號欄 (col 0)，第 2~3 列合併
      __rows: [
        ['房號', '床位', '姓名', '學號', '班別'],
        ['B201', 'A', '甲同學', 'ID201', '甲班'],
        ['', 'B', '乙同學', 'ID202', '乙班'],   // 合併儲存格：實際存的房號只在上一列
      ],
    };
    const workbook = { SheetNames: ['Sheet1'], Sheets: { Sheet1: ws } };
    const rows = window.__impTest.sheetToRows(workbook, 'Sheet1');
    delete window.XLSX;
    return rows[2][0]; // 資料列(第3列)的房號欄，理論上該被填成 B201
  });
  assert.equal(r27c, 'B201', '合併儲存格：左上格的值有往下填到範圍內所有格');

  // ────────────────────────────────────────────────────────────
  // BUG 48：同一床在 Excel 出現兩次 —— 只取第一列，第二列標「重複列」不處理
  // ────────────────────────────────────────────────────────────
  const r48 = await page.evaluate(() => {
    state.students = [
      { id: 's1', name: '學生一', studentId: 'ID001', class: '一班', squad: '一單', room: 'B101', bed: 'A', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false },
    ];
    const rows = [
      ['B101', 'A', '學生一改名', 'ID001', '一班'],
      ['B101', 'a', '學生一又改一次', 'ID001', '一班'],  // 全形/大小寫正規化後與上一列同一床
    ];
    const mapping = { room: 0, bed: 1, name: 2, studentId: 3, class: 4, phone: -1, address: -1 };
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    return { actions: preview.items.map(it => it.action), duplicates: preview.stats.duplicates, warnings: preview.warnings };
  });
  assert.deepEqual(r48.actions, ['update', 'duplicate'], '第一列正常處理、第二列標記重複列');
  assert.equal(r48.duplicates, 1);
  assert.equal(r48.warnings.length, 1);
  assert.match(r48.warnings[0], /重複/);

  // ────────────────────────────────────────────────────────────
  // BUG 28：電話開頭 0 遺失的還原，以及比對「有無變動」要先正規化格式
  // ────────────────────────────────────────────────────────────
  const phoneChecks = await page.evaluate(() => {
    const t = window.__impTest;
    return {
      already09: t.normalizePhone('0911000001'),         // 本來就有 0，不動
      missing0: t.normalizePhone('911000001'),            // 9 碼、9 開頭 → 補 0
      sci: t.normalizePhone('9.11E+8'),                    // 科學記號 → 還原成數字字串再補 0
      fullwidth: t.normalizePhone('９１１０００００１'),      // 全形數字 → 先轉半形再補 0
      keyEqual: t.phoneKey('0911-000-001') === t.phoneKey('0911000001'),
    };
  });
  assert.equal(phoneChecks.already09, '0911000001');
  assert.equal(phoneChecks.missing0, '0911000001');
  assert.equal(phoneChecks.sci, '0911000000');
  assert.equal(phoneChecks.fullwidth, '0911000001');
  assert.equal(phoneChecks.keyEqual, true, '格式不同但數字相同不該被當成異動');

  const r28b = await page.evaluate(() => {
    state.students = [
      { id: 's1', name: '學生一', studentId: 'ID001', class: '一班', squad: '一單', room: 'B101', bed: 'A', attendance: {}, remarks: '', phone: '0911000001', address: '', isForeign: false, isEmpty: false, hidden: false },
      { id: 's2', name: '學生二', studentId: 'ID002', class: '二班', squad: '一單', room: 'B101', bed: 'B', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false },
    ];
    const rows = [
      ['B101', 'A', '學生一', 'ID001', '一班', '0911-000-001'],  // 只是格式不同，電話沒有真的變
      ['B101', 'B', '學生二', 'ID002', '二班', '911000002'],      // 新電話缺開頭 0
    ];
    const mapping = { room: 0, bed: 1, name: 2, studentId: 3, class: 4, phone: 5, address: -1 };
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    return preview.items.map(it => ({ phone: it.phone, action: it.action }));
  });
  assert.equal(r28b[0].action, 'unchanged', '電話只是分隔符號不同，不該算異動');
  assert.equal(r28b[1].phone, '0911000002', '寫回總表時電話已補上開頭 0');
  assert.equal(r28b[1].action, 'update');

  // ────────────────────────────────────────────────────────────
  // BUG 26：沒對應姓名欄就不能用「清空」，且清空數量過多要二次確認
  // ────────────────────────────────────────────────────────────
  const r26a = await page.evaluate(() => {
    state.students = [
      { id: 's1', name: '學生一', studentId: '', class: '', squad: '一單', room: 'B101', bed: 'A', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false },
    ];
    const rows = [['B101', 'A', '', '']];
    // 姓名沒對應 (name:-1)，就算勾了 blankAsEmpty 也絕對不能清空
    const mapping = { room: 0, bed: 1, name: -1, studentId: 2, class: 3, phone: -1, address: -1 };
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: true, noteContact: false, skipUnchanged: true });
    return { actions: preview.items.map(it => it.action), willChange: preview.stats.willChange };
  });
  assert.deepEqual(r26a.actions, ['skip-blank'], '沒對應姓名欄，即使勾選清空選項也不會產生 clear 動作');
  assert.equal(r26a.willChange, 0);

  const r26b = await page.evaluate(() => {
    const IMP = window.__impTest.IMP;
    IMP.rows = [['B101', 'A', '', '']];
    IMP.mapping = { room: 0, bed: 1, name: -1, studentId: 2, class: 3, phone: -1, address: -1 };
    IMP.options.blankAsEmpty = false;
    IMP._previewError = '';
    window._impToggleOpt('blankAsEmpty', true);
    const el = document.getElementById('imp-preview-error');
    return { blankAsEmpty: IMP.options.blankAsEmpty, previewError: IMP._previewError, domHidden: el.hidden, domText: el.textContent };
  });
  assert.equal(r26b.blankAsEmpty, false, '勾選當下就被擋下，選項沒有真的打開');
  assert.match(r26b.previewError, /請先對應姓名欄位/);
  assert.equal(r26b.domHidden, false, '錯誤訊息有顯示在畫面上');
  assert.match(r26b.domText, /請先對應姓名欄位/);

  // 清空床位數 > 30% 或 > 20 張時要跳二次確認；取消就不會真的送出
  const r26c = await page.evaluate(async () => {
    state.students = [1, 2, 3, 4, 5].map(i => ({
      id: 'mc' + i, name: '住宿生' + i, studentId: 'MC' + i, class: '班' + i, squad: '一單',
      room: 'B2' + i, bed: 'A', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false,
    }));
    const rows = [
      ['B21', 'A', '', ''],  // 空白 → 清空 mc1
      ['B22', 'A', '', ''],  // 空白 → 清空 mc2  (2 / 5 = 40% > 30%，應該觸發二次確認)
    ];
    const mapping = { room: 0, bed: 1, name: 2, studentId: 3, class: -1, phone: -1, address: -1 };
    const IMP = window.__impTest.IMP;
    IMP.rows = rows; IMP.mapping = mapping;
    IMP.options.blankAsEmpty = true; IMP.options.noteContact = false; IMP.options.skipUnchanged = true;
    IMP.preview = window.__impTest.buildPreview(rows, mapping, IMP.options);

    let apiCalls = 0;
    window._api.updateAttendance = async () => { apiCalls++; return { success: true }; };

    // 第一次：取消對話框 → 不應該真的送出
    let confirmMessages = [];
    window.showConfirmDialog = async (opts) => { confirmMessages.push(opts.message); return false; };
    await window._impStartImport();
    const afterCancel = { calls: confirmMessages.length, apiCalls, msg: confirmMessages[0] || '' };

    // 第二次：確認對話框 → 應該真的送出
    IMP.preview = window.__impTest.buildPreview(rows, mapping, IMP.options);
    window.showConfirmDialog = async (opts) => { confirmMessages.push(opts.message); return true; };
    await window._impStartImport();
    await new Promise(r => setTimeout(r, 50));
    return { afterCancel, confirmCalls: confirmMessages.length, apiCallsAfterConfirm: apiCalls };
  });
  assert.equal(r26c.afterCancel.calls, 1, '清空數量超標時會跳一次二次確認');
  assert.match(r26c.afterCancel.msg, /2/, '訊息裡有列出將清空的數量');
  assert.equal(r26c.afterCancel.apiCalls, 0, '取消二次確認就不會真的呼叫後端');
  assert.equal(r26c.confirmCalls, 2);
  assert.equal(r26c.apiCallsAfterConfirm, 1, '確認後才會真的送出批次');

  // ────────────────────────────────────────────────────────────
  // BUG 29：一批裡只有部分床位失敗，不該整批算失敗；要能只重試失敗項目；備註失敗要顯示
  // ────────────────────────────────────────────────────────────
  function fourStudentRoster() {
    return [1, 2, 3, 4].map(i => ({
      id: 'p' + i, name: '舊名' + i, studentId: 'OLD' + i, class: '舊班' + i, squad: '一單',
      room: 'B3' + i, bed: 'A', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false,
    }));
  }
  function fourRows() {
    return [1, 2, 3, 4].map(i => ['B3' + i, 'A', '新名' + i, 'NEW' + i, '新班' + i]);
  }
  const mapping29 = { room: 0, bed: 1, name: 2, studentId: 3, class: 4, phone: -1, address: -1 };

  // 29a：後端回 {success:false, errors:[...]}（未來 worker 直接回這種格式的情境）—— 只有那一筆標失敗
  const r29a = await page.evaluate(async ({ roster, rows, mapping }) => {
    state.students = roster;
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    window._api.updateAttendance = async (payloads) => ({ success: false, errors: [{ pageId: 'p2', error: 'Notion 逾時' }] });
    const result = await window.__impTest.runImport(preview.items, null);
    return {
      ok: result.ok, fail: result.fail,
      p1name: state.students.find(s => s.id === 'p1').name,
      p2name: state.students.find(s => s.id === 'p2').name,
      failedIds: (window.__impTest.IMP._failedItems || []).map(it => it.target.id),
    };
  }, { roster: fourStudentRoster(), rows: fourRows(), mapping: mapping29 });
  assert.equal(r29a.ok, 3, 'success:false 情境：只有 1 筆真的失敗，其餘 3 筆算成功');
  assert.equal(r29a.fail, 1);
  assert.equal(r29a.p1name, '新名1', '沒失敗的項目本機狀態已同步更新');
  assert.equal(r29a.p2name, '舊名2', '失敗的項目本機狀態不能被改動');
  assert.deepEqual(r29a.failedIds, ['p2']);

  // 29b：api.js 之後會丟出帶 err.data.errors 的 Error（fix-rollcall 包會加）——同樣只標那幾筆失敗
  const r29b = await page.evaluate(async ({ roster, rows, mapping }) => {
    state.students = roster;
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    window._api.updateAttendance = async () => {
      const err = new Error('部分寫入失敗');
      err.data = { success: false, errors: [{ pageId: 'p3', error: '欄位衝突' }] };
      throw err;
    };
    const result = await window.__impTest.runImport(preview.items, null);
    return {
      ok: result.ok, fail: result.fail,
      p3name: state.students.find(s => s.id === 'p3').name,
      p4name: state.students.find(s => s.id === 'p4').name,
    };
  }, { roster: fourStudentRoster(), rows: fourRows(), mapping: mapping29 });
  assert.equal(r29b.ok, 3, 'err.data.errors 情境：只有 1 筆真的失敗');
  assert.equal(r29b.fail, 1);
  assert.equal(r29b.p3name, '舊名3');
  assert.equal(r29b.p4name, '新名4');

  // 29c：純網路錯（沒有 err.data）—— 這種才整批算失敗
  const r29c = await page.evaluate(async ({ roster, rows, mapping }) => {
    state.students = roster;
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    window._api.updateAttendance = async () => { throw new Error('連線逾時'); };
    const result = await window.__impTest.runImport(preview.items, null);
    return { ok: result.ok, fail: result.fail, anyChanged: state.students.some(s => s.name.startsWith('新名')) };
  }, { roster: fourStudentRoster(), rows: fourRows(), mapping: mapping29 });
  assert.equal(r29c.ok, 0, '純網路錯：整批算失敗');
  assert.equal(r29c.fail, 4);
  assert.equal(r29c.anyChanged, false, '整批失敗時本機狀態完全不會被改動');

  // 29d：重試失敗項目 —— 只重送上次失敗的那幾筆，不會重送已成功的
  const r29d = await page.evaluate(async ({ roster, rows, mapping }) => {
    state.students = roster;
    const IMP = window.__impTest.IMP;
    IMP.rows = rows; IMP.mapping = mapping;
    IMP.options = { blankAsEmpty: false, noteContact: false, skipUnchanged: true };
    IMP.preview = window.__impTest.buildPreview(rows, mapping, IMP.options);
    IMP._result = null; IMP._failedItems = [];

    window._api.updateAttendance = async (payloads) => ({ success: false, errors: [{ pageId: 'p2', error: 'Notion 逾時' }] });
    await window._impStartImport();
    const afterFirst = {
      retryBtn: document.getElementById('imp-retry-failed') ? document.getElementById('imp-retry-failed').textContent : null,
      fail: IMP._result.fail, ok: IMP._result.ok,
    };

    const retriedPageIds = [];
    window._api.updateAttendance = async (payloads) => { payloads.forEach(p => retriedPageIds.push(p.pageId)); return { success: true }; };
    await window._impRetryFailed();
    await new Promise(r => setTimeout(r, 50));

    return {
      afterFirst,
      retriedPageIds,
      finalOk: IMP._result.ok, finalFail: IMP._result.fail,
      retryBtnGone: !document.getElementById('imp-retry-failed'),
      p2nameAfterRetry: state.students.find(s => s.id === 'p2').name,
    };
  }, { roster: fourStudentRoster(), rows: fourRows(), mapping: mapping29 });
  assert.match(r29d.afterFirst.retryBtn || '', /重試失敗項目.*1/);
  assert.equal(r29d.afterFirst.fail, 1);
  assert.deepEqual(r29d.retriedPageIds, ['p2'], '重試只送出上次失敗的那一筆，沒有重送成功過的');
  assert.equal(r29d.finalOk, 4, '重試成功後總成功數變成全部 4 筆');
  assert.equal(r29d.finalFail, 0);
  assert.equal(r29d.retryBtnGone, true, '沒有失敗項目了，重試按鈕消失');
  assert.equal(r29d.p2nameAfterRetry, '新名2');

  // 29e：床位資料寫入成功，但備註 (電話/地址複製) 失敗 —— 要記下來，不能無聲吞掉
  const r29e = await page.evaluate(async () => {
    state.students = [
      { id: 'r1', name: '舊名', studentId: 'OLD', class: '舊班', squad: '一單', room: 'B41', bed: 'A', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false },
    ];
    const rows = [['B41', 'A', '新名', 'NEW', '新班', '0911222333', '台北市']];
    const mapping = { room: 0, bed: 1, name: 2, studentId: 3, class: 4, phone: 5, address: 6 };
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: true, skipUnchanged: true });
    window._api.updateAttendance = async () => ({ success: true });
    window._api.updateRemark = async () => { throw new Error('remarks api 掛了'); };
    const result = await window.__impTest.runImport(preview.items, null);
    return { ok: result.ok, remarkFail: result.remarkFail, logFlag: result.log[0].remarkFailed === true, r1name: state.students[0].name };
  });
  assert.equal(r29e.ok, 1, '主要床位資料仍然寫入成功');
  assert.equal(r29e.remarkFail, 1, '備註失敗有被算進 remarkFail，不是靜默吞掉');
  assert.equal(r29e.logFlag, true);
  assert.equal(r29e.r1name, '新名');

  // ────────────────────────────────────────────────────────────
  // BUG 30：不再寫入沒人讀的 localStorage 殘留 key；runImport 一定會把 IMP.running 重設
  // ────────────────────────────────────────────────────────────
  const r30a = await page.evaluate(async () => {
    state.students = [
      { id: 'l1', name: '舊名', studentId: 'OLD', class: '舊班', squad: '一單', room: 'B51', bed: 'A', attendance: {}, remarks: '', phone: '', address: '', isForeign: false, isEmpty: false, hidden: false },
    ];
    const rows = [['B51', 'A', '新名', 'NEW', '新班']];
    const mapping = { room: 0, bed: 1, name: 2, studentId: 3, class: 4, phone: -1, address: -1 };
    const preview = window.__impTest.buildPreview(rows, mapping, { blankAsEmpty: false, noteContact: false, skipUnchanged: true });
    window._api.updateAttendance = async () => ({ success: true });
    const keys = [];
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { keys.push(k); return origSet.call(this, k, v); };
    await window.__impTest.runImport(preview.items, null);
    Storage.prototype.setItem = origSet;
    return { keys, running: window.__impTest.IMP.running };
  });
  assert.equal(r30a.keys.includes('biyuan_temp_students_update'), false, 'runImport 不再寫入沒人讀的暫存 key');
  assert.equal(r30a.running, false);

  const r30b = await page.evaluate(async () => {
    // 故意塞一個 target 是 null 的異常項目，讓迴圈內部丟出非預期例外，驗證 finally 還是會重設 IMP.running
    const bogusItem = { action: 'update', target: null, room: 'X', bed: 'X', name: '壞資料' };
    let threw = false;
    try { await window.__impTest.runImport([bogusItem], null); } catch (_) { threw = true; }
    return { threw, running: window.__impTest.IMP.running };
  });
  assert.equal(r30b.threw, true, '確實丟出了非預期例外');
  assert.equal(r30b.running, false, '就算迴圈中途炸掉，finally 仍把 IMP.running 重設，不會卡在「匯入中」');

  // ────────────────────────────────────────────────────────────
  // BUG 34：XLSX 延遲載入 —— 沒載入時要顯示錯誤訊息、之後 ensureXLSX 補上就能繼續
  // ────────────────────────────────────────────────────────────
  await page.evaluate(() => { delete window.XLSX; delete window.ensureXLSX; window.openImportWizard(); });
  await page.waitForSelector('#imp-modal.visible', { timeout: 4000 });
  const r34a = await page.evaluate(() => {
    window._impOnFileChosen({ target: { files: [{ name: 'test.xlsx' }] } });
    return true;
  });
  await page.waitForFunction(() => {
    const el = document.getElementById('imp-drop-error');
    return el && !el.hidden && el.textContent.length > 0;
  }, { timeout: 4000 });
  const errText = await page.evaluate(() => document.getElementById('imp-drop-error').textContent);
  assert.match(errText, /尚未載入/, '沒有 XLSX 元件時顯示友善錯誤，不是卡住不動');

  const r34b = await page.evaluate(async () => {
    document.getElementById('imp-drop-error').hidden = true;
    document.getElementById('imp-drop-error').textContent = '';
    let ensureCalled = 0;
    window.ensureXLSX = async () => {
      ensureCalled++;
      window.XLSX = {
        read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: { '!ref': 'A1:B2', __rows: [['房號', '床位'], ['B601', 'A']] } } }),
        utils: {
          decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }),
          sheet_to_json(ws) { return ws.__rows.map(r => r.slice()); },
        },
      };
    };
    const file = new File(['dummy'], 'test2.xlsx', { type: 'application/octet-stream' });
    window._impOnFileChosen({ target: { files: [file] } });
    await new Promise(r => setTimeout(r, 200));
    return { ensureCalled, headers: window.__impTest.IMP.headers.slice() };
  });
  assert.equal(r34b.ensureCalled, 1, 'window.ensureXLSX 有被呼叫來按需載入');
  assert.deepEqual(r34b.headers, ['房號', '床位'], 'ensureXLSX 補上後可以繼續正常解析檔案');

  await page.evaluate(() => window._impClose());

  assert.deepEqual(errors, [], '整個過程沒有未捕捉的 pageerror: ' + JSON.stringify(errors));
  await browser.close();
  console.log('import.cjs: 合併儲存格/全形正規化、電話補零、批次部分失敗與重試、清空保護與二次確認、localStorage 清理、XLSX 延遲載入、重複列偵測 PASS');
})().catch(e => { console.error(e); process.exit(1); });
