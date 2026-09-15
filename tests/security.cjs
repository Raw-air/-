// XSS / 影片網址驗證 / CDN 延遲載入的離線行為
// 對應修的 BUG：4 (背景影片網址驗證)、5 (Notion 資料跳脫)、33/34 (CDN 延遲載入)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // 姓名/班別/房號/床號/學號都塞進惡意內容，模擬 Notion 被填入攻擊字串
    const xssName = '<img src=x onerror="window.__xssFired=true">';
    const students = [{
      id: 'sec-1', name: xssName, room: '101<b>注入</b>', bed: 'A"\'注入',
      squad: '一單', class: '測試班"\'<i>', studentId: 'T<001>',
      isEmpty: false, hidden: false, isForeign: false,
      attendance: { '2026-09-16': '✓' },
    }];

    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === 'security.test') {
        const file = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
        return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
      }
      if (u.pathname === '/api/roster') return route.fulfill({ json: { students, dateColumns: ['2026-09-16'] } });
      if (u.pathname === '/api/config') return route.fulfill({ json: {} });
      // 刻意讓 xlsx-js-style / marked 的 CDN 連線全部失敗，模擬離線環境
      if (u.hostname.includes('jsdelivr') || u.hostname.includes('cdnjs')) return route.abort();
      return route.fulfill({ json: {} });
    });

    await page.goto('https://security.test/');
    await page.waitForFunction(() => !state.loading);

    // ── 1. Notion 資料 XSS：姓名含 <img onerror> 渲染後不會變成真的 <img>，也不會觸發 onerror ──
    const xssResult = await page.evaluate(() => {
      state.currentSquad = '一單';
      state.currentDate = state.dateColumns[0];
      renderRollCall(true);
      const list = document.getElementById('rc-student-list');
      return {
        imgCount: list.querySelectorAll('img').length,
        fired: !!window.__xssFired,
        showsAsText: list.textContent.includes('<img'),
      };
    });
    assert.equal(xssResult.imgCount, 0, '姓名含 <img onerror> 不應該在點名列表產生真的 <img> 元素');
    assert.equal(xssResult.fired, false, 'onerror 不應該被執行');
    assert.equal(xssResult.showsAsText, true, '姓名應該以跳脫後的純文字顯示，不是被當成標籤吃掉');

    // 總表、日期選單、資料夾輪播、學期匯出下拉也要能正常渲染同一批惡意資料，不能炸掉
    const otherRenders = await page.evaluate(() => {
      const out = {};
      try { renderSummary(); out.summaryOk = true; } catch (e) { out.summaryOk = 'THROW:' + e.message; }
      out.summaryImg = document.getElementById('summary-squad-grid').querySelectorAll('img').length;
      try { renderDatePicker(); out.datePickerOk = true; } catch (e) { out.datePickerOk = 'THROW:' + e.message; }
      try {
        onStudentFileSearch(''); // 資料夾輪播：用目前住宿生名單重新渲染
        out.folderOk = true;
        out.folderImg = document.getElementById('sf-card-track').querySelectorAll('img').length;
      } catch (e) { out.folderOk = 'THROW:' + e.message; }
      try { populateExportSemesterSelect(); out.exportSelectOk = true; } catch (e) { out.exportSelectOk = 'THROW:' + e.message; }
      return out;
    });
    assert.equal(otherRenders.summaryOk, true, '總表渲染不應該丟例外：' + otherRenders.summaryOk);
    assert.equal(otherRenders.summaryImg, 0, '總表也不應該被注入 <img>');
    assert.equal(otherRenders.datePickerOk, true, '日期選單渲染不應該丟例外：' + otherRenders.datePickerOk);
    assert.equal(otherRenders.folderOk, true, '資料夾輪播渲染不應該丟例外：' + otherRenders.folderOk);
    assert.equal(otherRenders.folderImg, 0, '資料夾輪播也不應該被注入 <img>');
    assert.equal(otherRenders.exportSelectOk, true, '匯出學期下拉渲染不應該丟例外：' + otherRenders.exportSelectOk);

    assert.deepEqual(errors, [], '姓名 XSS 測試流程不應該有任何 pageerror：' + errors.join('; '));

    // ── 2. 背景影片網址驗證：javascript: 一律擋下；含引號的網址不能讓 <video> 被注入額外屬性/標籤 ──
    const videoResult = await page.evaluate(() => {
      const out = {};
      const container = document.getElementById('custom-video-bg');

      // javascript: 協定應該整個被當成沒有影片
      state.config['bg_video_url'] = 'javascript:window.__vidXSS_js=true';
      loadGlobalBgVideo();
      out.jsProtocol = { video: !!container.querySelector('video'), script: !!container.querySelector('script') };

      // data: 協定 (常見的另一種危險協定) 也應該被擋下
      state.config['bg_video_url'] = 'data:text/html,<script>window.__vidXSS_data=true<\/script>';
      loadGlobalBgVideo();
      out.dataProtocol = { video: !!container.querySelector('video') };

      // 網址含引號：舊寫法會用字串拼接把 onerror="..." 注入進 <video> 標籤；
      // 新寫法用 createElement + .src 屬性賦值，就算網址含引號也只會變成 src 的一部分，不會多出屬性或標籤
      state.config['bg_video_url'] = 'http://x.test/a.mp4" onerror="window.__vidXSS_attr=true';
      loadGlobalBgVideo();
      const vid = container.querySelector('video');
      out.quoteBreakout = {
        hasVideo: !!vid,
        hasOnerrorAttr: vid ? vid.hasAttribute('onerror') : null,
        onerrorProp: vid ? vid.onerror : 'no-video',
        childCount: container.children.length,
        script: !!container.querySelector('script'),
        fired: !!(window.__vidXSS_js || window.__vidXSS_data || window.__vidXSS_attr),
      };

      // 合法 https 網址：應該正常建立 <video>，且縮放/透明度會被限制在合理範圍內
      state.config['bg_video_url'] = 'https://example.com/good.mp4';
      state.config['bg_video_scale'] = '999';
      state.config['bg_video_opacity'] = '-5';
      loadGlobalBgVideo();
      const vid2 = container.querySelector('video');
      out.valid = {
        hasVideo: !!vid2,
        srcOk: vid2 ? vid2.src.startsWith('https://example.com/good.mp4') : false,
        scale: vid2 ? vid2.style.getPropertyValue('--target-scale') : null,
        opacity: vid2 ? vid2.style.getPropertyValue('--target-opacity') : null,
      };

      return out;
    });
    assert.deepEqual(videoResult.jsProtocol, { video: false, script: false }, 'javascript: 網址不應該建立 video');
    assert.equal(videoResult.dataProtocol.video, false, 'data: 網址不應該建立 video');
    assert.equal(videoResult.quoteBreakout.hasVideo, true, '含引號但協定合法的網址仍然可以建立 video (src 屬性賦值本身就是安全的)');
    assert.equal(videoResult.quoteBreakout.hasOnerrorAttr, false, '含引號的網址不應該讓 video 被多注入 onerror 屬性');
    assert.equal(videoResult.quoteBreakout.onerrorProp, null, 'video.onerror 不應該被設定');
    assert.equal(videoResult.quoteBreakout.childCount, 1, '容器裡應該只有一個 video 元素，沒有被拆成多個標籤');
    assert.equal(videoResult.quoteBreakout.script, false, '不應該被注入 <script>');
    assert.equal(videoResult.quoteBreakout.fired, false, '任何一種惡意網址都不應該被執行');
    assert.equal(videoResult.valid.hasVideo, true, '合法 https 網址應該正常建立 video');
    assert.equal(videoResult.valid.srcOk, true, 'video src 應該完整保留合法網址');
    assert.equal(videoResult.valid.scale, '5', '超出範圍的縮放值應該被限制在最大值 5');
    assert.equal(videoResult.valid.opacity, '0', '超出範圍的透明度應該被限制在最小值 0');

    // previewBgVideoStyle (設定頁即時預覽) 也要擋掉非法輸入
    const previewResult = await page.evaluate(() => {
      document.getElementById('custom-video-bg').innerHTML = '';
      document.getElementById('bg-video-url').value = 'javascript:window.__vidXSS_preview=true';
      document.getElementById('bg-video-scale').value = '1';
      document.getElementById('bg-video-opacity').value = '0.5';
      previewBgVideoStyle();
      return { video: !!document.querySelector('#custom-video-bg video'), fired: !!window.__vidXSS_preview };
    });
    assert.equal(previewResult.video, false, 'previewBgVideoStyle 也不該用非法網址建立 video');
    assert.equal(previewResult.fired, false, 'previewBgVideoStyle 不該執行任何注入的程式碼');

    assert.deepEqual(errors, [], '背景影片網址測試流程不應該有任何 pageerror：' + errors.join('; '));

    // ── 3. ensureXLSX / ensureMarked：離線時要 reject 中文錯誤訊息，且失敗後仍可重試 ──
    const cdnResult = await page.evaluate(async () => {
      delete window.XLSX;
      delete window.marked;
      const out = {};
      try { await window.ensureXLSX(); out.xlsxErr = null; } catch (e) { out.xlsxErr = e.message; }
      out.hasXLSX = typeof window.XLSX !== 'undefined';
      try { await window.ensureMarked(); out.markedErr = null; } catch (e) { out.markedErr = e.message; }
      out.hasMarked = typeof window.marked !== 'undefined';
      // 同一個 Promise 失敗後不應該被永久快取：立刻再呼叫一次應該仍然重新嘗試 (而不是直接複用舊的 rejected promise)
      let secondCallRan = false;
      try { await window.ensureXLSX(); } catch (e) { secondCallRan = true; out.xlsxErr2 = e.message; }
      out.secondCallRan = secondCallRan;
      return out;
    });
    assert.ok(cdnResult.xlsxErr && cdnResult.xlsxErr.includes('Excel'), 'ensureXLSX 離線時應該丟出中文錯誤訊息，實際：' + cdnResult.xlsxErr);
    assert.equal(cdnResult.hasXLSX, false, '離線時不應該有 window.XLSX');
    assert.ok(cdnResult.markedErr, 'ensureMarked 離線時也應該 reject');
    assert.equal(cdnResult.hasMarked, false, '離線時不應該有 window.marked');
    assert.equal(cdnResult.secondCallRan, true, '失敗後重試 ensureXLSX 應該再次嘗試而不是卡住');

    assert.deepEqual(errors, [], '整個測試流程不應該有任何 pageerror：' + errors.join('; '));
    console.log('security: XSS-safe rendering, background video URL validation, offline ensureXLSX/ensureMarked reject PASS');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
