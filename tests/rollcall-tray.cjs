// 點名頁長按選取盤：輕點照舊、按住越震越快、拖曳選晚歸/電話/備註/外圈選項、捲動不誤觸、滑鼠也能用 (API 全部攔截)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results'); fs.mkdirSync(out, { recursive: true });
const SQUAD = '一單';

(async () => {
  const browser = await chromium.launch();
  try {
    const d = new Date();
    const todayISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const students = [];
    for (let i = 0; i < 24; i++) {
      students.push({ id: 's' + i, name: '住宿生' + i, room: String(201 + Math.floor(i / 4)), bed: 'ABCD'[i % 4], squad: SQUAD, class: '測試班', studentId: 'T' + i, phone: '09000000' + String(i).padStart(2, '0'), address: '台中市' + i, isForeign: false, isEmpty: false, attendance: {} });
    }
    students.push({ id: 'empty1', name: '', room: '299', bed: 'A', squad: SQUAD, class: '', studentId: '', phone: '', address: '', isForeign: false, isEmpty: true, attendance: {} });

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile', serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      window.__vib = [];
      navigator.vibrate = p => { window.__vib.push(performance.now()); return true; };
      localStorage.setItem('biyuan_release_notice_seen', 'test');
    });
    const writes = [];
    await ctx.route('**/*', route => {
      const req = route.request(), u = new URL(req.url());
      if (u.hostname === 'tray.test') {
        const file = path.join(root, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
        return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
      }
      if (req.method() !== 'GET' && u.hostname.endsWith('workers.dev')) { writes.push({ path: u.pathname, body: JSON.parse(req.postData() || '{}') }); return route.fulfill({ json: { success: true } }); }
      if (u.pathname === '/api/roster') return route.fulfill({ json: { students: JSON.parse(JSON.stringify(students)), dateColumns: [todayISO] } });
      return route.fulfill({ json: {} });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('https://tray.test/');
    await page.waitForFunction(() => typeof state !== 'undefined' && !state.loading && state.students.length > 0);
    await page.waitForFunction(() => !document.body.classList.contains('rawair-booting'), null, { timeout: 30000 });
    await page.evaluate(sq => { state.currentSquad = sq; state.currentDate = getTodayAttendanceDate(); navigateTo('rollcall'); }, SQUAD);
    await page.waitForSelector('.student-row[data-pid="s0"]');
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__sync = window._api; });

    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const center = sel => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const status = id => page.evaluate(i => state.students.find(s => s.id === i).attendance[state.currentDate] || '✓', id);
    const rowOf = id => `.student-row[data-pid="${id}"]`;
    const open = async id => {
      await page.locator(rowOf(id)).scrollIntoViewIfNeeded();
      const p = await center(rowOf(id));
      await touch('touchStart', p.x, p.y);
      await page.waitForSelector('#rc-tray.rct-show .rct-wheel', { timeout: 2000 });
      await page.waitForTimeout(220);
      return p;
    };
    const dragTo = async (from, slotId) => {
      const to = await page.evaluate(id => {
        const root = document.getElementById('rc-tray'), el = root.querySelector(`.rct-slot[data-id="${id}"]`);
        return { x: +root.dataset.ox + (+el.dataset.x - +root.dataset.cx), y: +root.dataset.oy + (+el.dataset.y - +root.dataset.cy) };
      }, slotId);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6); await page.waitForTimeout(25); }
      return to;
    };
    const settle = () => page.waitForTimeout(300);
    const pass = name => console.log('rollcall-wheel:', name, 'PASS');

    // 1. 輕點照舊切換，不會跳選單、不會震動加速
    let p = await center(rowOf('s0'));
    await touch('touchStart', p.x, p.y); await page.waitForTimeout(80); await touch('touchEnd');
    await page.waitForTimeout(150);
    assert.equal(await status('s0'), '◎', '輕點要切換');
    assert.equal(await page.locator('#rc-tray').count(), 0);
    pass('輕點切換狀態');

    // 2. 按住：震動間隔越來越短，選單跳出；不移動放開 = 取消，狀態不變
    await page.evaluate(() => { window.__vib.length = 0; });
    await page.locator(rowOf('s1')).scrollIntoViewIfNeeded();
    const shakeAt = await center(rowOf('s1'));
    await touch('touchStart', shakeAt.x, shakeAt.y);
    await page.waitForTimeout(450);
    const shaking = await page.locator(rowOf('s1')).evaluate(el => el.style.transform);
    assert.match(shaking, /translateX/, '按住時格子要抖');
    await touch('touchEnd');
    await page.waitForTimeout(100);
    assert.equal(await page.locator(rowOf('s1')).evaluate(el => el.style.transform), '', '提早放開要停止抖動');
    assert.equal(await page.locator('#rc-tray').count(), 0);
    await page.evaluate(() => { window.__vib.length = 0; });
    p = await open('s1');
    const gaps = await page.evaluate(() => window.__vib.slice(1).map((t, i) => t - window.__vib[i]));
    assert.ok(gaps.length >= 4, '要震好幾下 ' + gaps.length);
    const holdGaps = gaps.slice(0, 5);
    assert.ok(holdGaps[0] > holdGaps[holdGaps.length - 1], '間隔要越來越短 ' + holdGaps.map(Math.round));
    await page.screenshot({ path: path.join(out, 'tray-inner.png') });
    await touch('touchEnd'); await settle();
    assert.equal(await status('s1'), '✓', '放開取消不能切換狀態');
    assert.equal(await page.locator('#rc-tray').count(), 0);
    pass('按住越震越快、放開取消 ' + holdGaps.map(Math.round).join('>'));

    // 2-2. 選單開著時畫面完全鎖定：上下拖不會跑，關掉後回到原本位置
    await page.evaluate(() => window.scrollTo(0, 120));
    await page.waitForTimeout(150);
    const lockTop = await page.evaluate(() => window.scrollY);
    const rowBefore = await page.locator(rowOf('s5')).evaluate(el => el.getBoundingClientRect().top);
    const lockAt = await center(rowOf('s5'));
    await touch('touchStart', lockAt.x, lockAt.y);
    await page.waitForSelector('#rc-tray.rct-show', { timeout: 2000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).position), 'fixed', '頁面要固定住');
    for (let i = 1; i <= 10; i++) { await touch('touchMove', lockAt.x, lockAt.y + i * 40); await page.waitForTimeout(16); }
    for (let i = 10; i >= -10; i--) { await touch('touchMove', lockAt.x, lockAt.y + i * 40); await page.waitForTimeout(16); }
    const rowDuring = await page.locator(rowOf('s5')).evaluate(el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(rowDuring - rowBefore) < 1, `選單開著時背景不能動：${rowBefore} → ${rowDuring}`);
    await touch('touchMove', lockAt.x, lockAt.y); await touch('touchEnd');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).position), 'static', '關掉要解鎖');
    assert.equal(await page.evaluate(() => window.scrollY), lockTop, '要回到原本的捲動位置');
    assert.ok(Math.abs(await page.locator(rowOf('s5')).evaluate(el => el.getBoundingClientRect().top) - rowBefore) < 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    pass('選單開著時畫面鎖定，關掉回原位');

    // 3. 晚歸：請假的人拖到晚歸 → 在場 + 標記 + 總表算到 + 寫回設定
    assert.equal(await status('s0'), '◎');
    p = await open('s0');
    await dragTo(p, 'late');
    assert.match(await page.locator('.rct-caption').innerText(), /標記晚歸/);
    await touch('touchEnd'); await settle();
    assert.equal(await status('s0'), '✓', '晚歸算在場');
    assert.match(await page.locator(rowOf('s0')).innerText(), /晚歸/);
    const lateKey = `late_${todayISO}_${SQUAD}`;
    assert.equal(writes.filter(w => w.path === '/api/config').at(-1).body[lateKey], 's0');
    const stats = await page.evaluate(() => computeDailyStats(state.currentDate));
    assert.ok(JSON.stringify(stats).length > 2);
    const presentOk = await page.evaluate(() => {
      const ss = state.students.filter(s => s.id === 's0');
      return ss[0].attendance[state.currentDate] === '✓';
    });
    assert.ok(presentOk);
    pass('晚歸標記且算在場');

    // 晚歸的人改成請假：標記自動拿掉
    await page.evaluate(() => { toggleStatus('s0'); });
    await settle();
    assert.doesNotMatch(await page.locator(rowOf('s0')).innerText(), /晚歸/);
    assert.equal(writes.filter(w => w.path === '/api/config').at(-1).body[lateKey], '');
    await page.evaluate(() => { toggleStatus('s0', '✓'); });
    pass('改請假後晚歸標記消失');

    // 4. 電話：拖過去上方就看得到號碼，放開跳聯絡資料
    p = await open('s2');
    await dragTo(p, 'phone');
    assert.match(await page.locator('.rct-caption').innerText(), /0900000002/);
    await touch('touchEnd'); await settle();
    const dlg = page.locator('.rct-dialog');
    assert.match(await dlg.innerText(), /0900000002/);
    assert.match(await dlg.innerText(), /台中市2/);
    assert.equal(await dlg.locator('a.rct-call').getAttribute('href'), 'tel:0900000002');
    await dlg.locator('button').click(); await page.waitForTimeout(350);
    pass('電話顯示與撥打連結');

    // 5. 備註：拖到備註展開外圈，再拖到沒繳回瓷扣 → 文字 + 瓷扣圖示一直顯示
    p = await open('s3');
    let at = await dragTo(p, 'remark');
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#rc-tray.rct-outer-open').count(), 1, '要展開外圈');
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('#rc-tray .rct-outer')].every(el => getComputedStyle(el).opacity === '1')), '外圈展開完要全顯示');
    await page.screenshot({ path: path.join(out, 'tray-outer.png') });
    await dragTo(at, 'ceramic');
    await touch('touchEnd'); await settle();
    assert.equal(writes.filter(w => w.path === '/api/remarks').at(-1).body.remark, '沒繳回瓷扣');
    assert.equal(await page.locator(`${rowOf('s3')} [data-tag="ceramic"]`).count(), 1, '要有瓷扣圖案');
    assert.doesNotMatch(await page.locator(rowOf('s3')).innerText(), /沒繳回瓷扣/, '瓷扣要用圖案，不是文字');
    // 再加一個，不會蓋掉前一個
    p = await open('s3');
    at = await dragTo(p, 'remark'); await page.waitForTimeout(220);
    await dragTo(at, 'issue'); await touch('touchEnd'); await settle();
    assert.equal(writes.filter(w => w.path === '/api/remarks').at(-1).body.remark, '沒繳回瓷扣、有狀況!');
    // 重畫整張還在
    await page.evaluate(() => renderRollCall(true)); await settle();
    assert.equal(await page.locator(`${rowOf('s3')} [data-tag="issue"]`).count(), 1, '有狀況也要圖案');
    assert.equal(await page.locator(`${rowOf('s3')} [data-tag="ceramic"]`).count(), 1);
    assert.doesNotMatch(await page.locator(rowOf('s3')).innerText(), /有狀況/);
    await page.screenshot({ path: path.join(out, 'tray-row.png') });
    // 再選一次瓷扣 = 取消
    p = await open('s3');
    at = await dragTo(p, 'remark'); await page.waitForTimeout(220);
    await dragTo(at, 'ceramic'); await touch('touchEnd'); await settle();
    assert.equal(writes.filter(w => w.path === '/api/remarks').at(-1).body.remark, '有狀況!');
    assert.equal(await page.locator(`${rowOf('s3')} [data-tag="ceramic"]`).count(), 0);
    pass('外圈備註、瓷扣圖示、可疊加可取消');

    // 6. 備註本身放開：自由輸入
    p = await open('s4');
    await dragTo(p, 'remark'); await touch('touchEnd'); await settle();
    const editor = page.locator('.rct-dialog');
    await editor.locator('textarea').fill('對花生過敏');
    await editor.locator('.confirm').click(); await page.waitForTimeout(350);
    assert.equal(writes.filter(w => w.path === '/api/remarks').at(-1).body.remark, '對花生過敏');
    assert.match(await page.locator(rowOf('s4')).innerText(), /對花生過敏/);
    pass('自由輸入備註');

    // 7. 手指一按就滑 = 捲動，不跳選單
    p = await center(rowOf('s5'));
    await touch('touchStart', p.x, p.y);
    await touch('touchMove', p.x, p.y - 40);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#rc-tray').count(), 0, '捲動不能跳選單');
    await touch('touchEnd'); await settle();
    pass('捲動不誤觸');

    // 8. 空床不跳
    await page.locator(rowOf('empty1')).scrollIntoViewIfNeeded();
    p = await center(rowOf('empty1'));
    await touch('touchStart', p.x, p.y); await page.waitForTimeout(800);
    assert.equal(await page.locator('#rc-tray').count(), 0, '空床不跳選單');
    await touch('touchEnd');
    pass('空床不跳選單');

    // 9. 拖到一半畫面重畫 (別台改資料)，選單照常運作
    p = await open('s6');
    await page.evaluate(() => renderRollCall(true));
    await dragTo(p, 'late'); await touch('touchEnd'); await settle();
    assert.match(await page.locator(rowOf('s6')).innerText(), /晚歸/);
    pass('拖曳中畫面重畫不卡住');
    await ctx.close();

    // 10. 電腦滑鼠
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await desk.addInitScript(() => localStorage.setItem('biyuan_release_notice_seen', 'test'));
    await desk.route('**/*', route => {
      const req = route.request(), u = new URL(req.url());
      if (u.hostname === 'tray.test') {
        const file = path.join(root, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
        return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
      }
      if (req.method() !== 'GET' && u.hostname.endsWith('workers.dev')) return route.fulfill({ json: { success: true } });
      if (u.pathname === '/api/roster') return route.fulfill({ json: { students: JSON.parse(JSON.stringify(students)), dateColumns: [todayISO] } });
      return route.fulfill({ json: {} });
    });
    const dp = await desk.newPage();
    await dp.goto('https://tray.test/');
    await dp.waitForFunction(() => typeof state !== 'undefined' && !state.loading && state.students.length > 0);
    await dp.waitForFunction(() => !document.body.classList.contains('rawair-booting'), null, { timeout: 30000 });
    await dp.evaluate(sq => { state.currentSquad = sq; state.currentDate = getTodayAttendanceDate(); navigateTo('rollcall'); }, SQUAD);
    await dp.waitForSelector(rowOf('s1'));
    await dp.waitForTimeout(600);
    await dp.locator(rowOf('s1')).scrollIntoViewIfNeeded();
    await dp.waitForTimeout(300);
    const box = await dp.locator(rowOf('s1')).boundingBox();
    await dp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await dp.mouse.down();
    await dp.waitForSelector('#rc-tray.rct-show', { timeout: 2000 });
    await dp.waitForTimeout(220);
    const late = await dp.evaluate(() => {
      const root = document.getElementById('rc-tray'), el = root.querySelector('.rct-slot[data-id="late"]');
      return { x: +root.dataset.ox + (+el.dataset.x - +root.dataset.cx), y: +root.dataset.oy + (+el.dataset.y - +root.dataset.cy) };
    });
    await dp.mouse.move(late.x, late.y, { steps: 6 });
    await dp.mouse.up();
    await dp.waitForTimeout(300);
    assert.match(await dp.locator(rowOf('s1')).innerText(), /晚歸/);
    assert.equal(await dp.evaluate(() => state.students.find(s => s.id === 's1').attendance[state.currentDate] || '✓'), '✓', '滑鼠放開不能多切換一次');
    pass('電腦滑鼠可用');
    await desk.close();

    assert.deepEqual(errors, []);
    console.log('rollcall-tray 全部通過');
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL', String(e.message || e).slice(0, 900)); process.exit(1); });
