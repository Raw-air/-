/**
 * 碧苑宿舍點名系統 - Excel 名單匯入模組
 * 讀取學校提供的 Excel/CSV 住宿生名單，比對房號/床位後自動寫回 Notion 總表。
 */
(function () {
  'use strict';

  // ────────────────────────── 內部狀態 ──────────────────────────
  const IMP = {
    workbook: null,
    sheetName: null,
    rows: [],           // 原始資料列 (array of array, 含表頭)
    headerRowIdx: 0,
    headers: [],
    mapping: { room: -1, bed: -1, name: -1, studentId: -1, class: -1, phone: -1, address: -1 },
    options: { blankAsEmpty: false, noteContact: false, skipUnchanged: true },
    preview: null,       // { items, stats }
    cancelled: false,
    running: false,
  };

  // ────────────────────────── 工具函式 ──────────────────────────

  function normHeader(s) {
    return String(s || '').replace(/[\s_　]/g, '').toLowerCase();
  }

  // 欄位模糊比對關鍵字表
  const FIELD_KEYWORDS = {
    room: ['宿舍編號', '房號', '寢室', 'room'],
    bed: ['宿舍分類', '床位', '床號', 'bed'],
    name: ['姓名', 'name'],
    studentId: ['學號', 'studentid', 'id'],
    class: ['班別', '班級', '系級', 'class'],
    phone: ['行動電話', '聯絡電話', '電話', 'phone'],
    address: ['通訊地址', '地址', 'address'],
  };

  function guessColumns(headers) {
    const guess = { room: -1, bed: -1, name: -1, studentId: -1, class: -1, phone: -1, address: -1 };
    const normed = headers.map(normHeader);
    const used = new Set();
    // 先找完全相同的標題，再找包含關鍵字的；同一欄不重複指派；「區號」欄永遠不當地址
    const bad = { address: /區號|郵遞/, phone: /區號/ };
    Object.keys(FIELD_KEYWORDS).forEach(field => {
      const ok = i => i !== -1 && !used.has(i) && !(bad[field] && bad[field].test(normed[i]));
      let found = -1;
      for (const pass of ['exact', 'includes']) {
        for (const kw of FIELD_KEYWORDS[field]) {
          const nk = normHeader(kw);
          const idx = normed.findIndex((h, i) => ok(i) && (pass === 'exact' ? h === nk : h.includes(nk)));
          if (idx !== -1) { found = idx; break; }
        }
        if (found !== -1) break;
      }
      if (found !== -1) { guess[field] = found; used.add(found); }
    });
    return guess;
  }

  // 床位代碼正規化：數字 1-4 <-> 字母 A-D
  const BED_DIGIT_TO_LETTER = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };
  const BED_LETTER_TO_DIGIT = { 'A': '1', 'B': '2', 'C': '3', 'D': '4' };

  // 比對用的正規化：全形轉半形 (NFKC)、去頭尾空白 (含全形空白)、可選擇統一大寫。
  // 只用來「比對」，不會改寫要寫回總表的值，避免姓名裡的罕見字被 NFKC 動到。
  function normKey(v, keepCase) {
    if (v === null || v === undefined) return '';
    let s = String(v).normalize('NFKC').replace(/^[\s　]+|[\s　]+$/g, '').replace(/[\s　]+/g, ' ');
    return keepCase ? s : s.toUpperCase();
  }

  function normalizeBed(raw, rosterUsesLetters) {
    if (raw === null || raw === undefined) return '';
    let v = String(raw).normalize('NFKC').trim().toUpperCase();
    // 只取最後一個有意義字元（例如 "B112-A" -> "A"、"1床" -> "1"）
    const m = v.match(/([A-D]|[1-4])\s*(?:床)?$/);
    if (m) v = m[1];
    if (rosterUsesLetters) {
      if (BED_DIGIT_TO_LETTER[v]) return BED_DIGIT_TO_LETTER[v];
      if (/^[A-D]$/.test(v)) return v;
    } else {
      if (BED_LETTER_TO_DIGIT[v]) return BED_LETTER_TO_DIGIT[v];
      if (/^[1-4]$/.test(v)) return v;
    }
    return v;
  }

  function normalizeRoom(raw) {
    if (raw === null || raw === undefined) return '';
    return String(raw).normalize('NFKC').trim().toUpperCase().replace(/[\s　]+/g, '');
  }

  function cellStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  // 電話：Excel 數字格式會吃掉開頭 0 (911000001)、太長還會變科學記號 (9.11E+8)，讀進來先還原
  function normalizePhone(raw) {
    let v = cellStr(raw).normalize('NFKC');
    if (!v) return '';
    if (/^\d+(?:\.\d+)?E\+?\d+$/i.test(v)) {
      const n = Number(v);
      if (Number.isFinite(n)) v = String(Math.round(n));
    }
    if (/^9\d{8}$/.test(v)) v = '0' + v;
    return v;
  }

  // 電話比對用：去空白、連字號、括號，全形數字轉半形，免得每次匯入都算成異動
  function phoneKey(v) {
    return String(v == null ? '' : v).normalize('NFKC').replace(/[\s　\-‐‑–—()（）]/g, '');
  }

  // 沒有姓名就不是有效住宿生；學號或班別的殘留值不能讓空床變成有人。
  function isBlankRow(row, mapping) {
    return mapping.name < 0 || !cellStr(row[mapping.name]);
  }

  // ────────────────────────── 檔案解析 ──────────────────────────

  function hasXLSX() {
    return typeof window !== 'undefined' && !!window.XLSX;
  }

  function readFileAsWorkbook(file) {
    return new Promise((resolve, reject) => {
      if (!hasXLSX()) { reject(new Error('Excel 元件尚未載入，請確認網路後重試')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('讀取檔案失敗'));
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const opts = { type: 'array', cellDates: false };
          // Windows 中文 Excel 存的 CSV 通常是 Big5：沒有 UTF-8 BOM 且不是合法 UTF-8 就用 950 解碼
          if (/\.csv$/i.test(file.name || '')) {
            const hasBom = data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF;
            if (!hasBom) {
              let utf8ok = true;
              try { new TextDecoder('utf-8', { fatal: true }).decode(data); } catch (_) { utf8ok = false; }
              if (!utf8ok) opts.codepage = 950;
            }
          }
          const wb = window.XLSX.read(data, opts);
          resolve(wb);
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function sheetToRows(workbook, sheetName) {
    const ws = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    fillMergedCells(ws, rows);
    return rows;
  }

  // 合併儲存格 (例如同房四床只在第一列填房號) 只有左上格有值，其餘讀出來是空的；
  // 把左上格的值往整個範圍填，後面比對才不會整房都對不到。失敗就當沒有合併，不影響讀檔。
  function fillMergedCells(ws, rows) {
    try {
      const merges = ws && ws['!merges'];
      if (!Array.isArray(merges) || !merges.length || !ws['!ref']) return;
      const range = window.XLSX.utils.decode_range(ws['!ref']);
      merges.forEach(m => {
        if (!m || !m.s || !m.e) return;
        const srcRow = rows[m.s.r - range.s.r];
        const val = srcRow ? srcRow[m.s.c - range.s.c] : '';
        if (cellStr(val) === '') return;
        for (let r = m.s.r; r <= m.e.r; r++) {
          const row = rows[r - range.s.r];
          if (!row) continue;
          for (let c = m.s.c; c <= m.e.c; c++) {
            const ci = c - range.s.c;
            if (cellStr(row[ci]) === '') row[ci] = val;
          }
        }
      });
    } catch (_) { /* 合併範圍解析失敗就照原樣 */ }
  }

  function findHeaderRow(rows) {
    // 找第一個「非全空」列作為表頭
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const nonEmpty = rows[i].filter(c => cellStr(c) !== '').length;
      if (nonEmpty >= 2) return i;
    }
    return 0;
  }

  function nonEmptySheets(workbook) {
    return workbook.SheetNames.filter(name => {
      const ws = workbook.Sheets[name];
      if (!ws || !ws['!ref']) return false;
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      return rows.some(r => r.some(c => cellStr(c) !== ''));
    });
  }

  // ────────────────────────── 比對 / 預覽 ──────────────────────────

  function rosterBedStyle() {
    // 判斷目前總表床位代碼是字母還是數字
    const sample = (state.students || []).find(s => s.bed);
    if (!sample) return true; // 預設字母
    return /^[A-D]$/.test(String(sample.bed).toUpperCase());
  }

  function buildPreview(dataRows, mapping, options) {
    const useLetters = rosterBedStyle();
    const items = [];
    const warnings = [];
    const stats = { total: 0, matched: 0, willChange: 0, unchanged: 0, unmatchedRows: 0, blankRows: 0, duplicates: 0, inherited: 0 };
    // 沒對應姓名欄就分不出「空床」和「沒填」，這時絕不能清空任何床位
    const canClear = !!options.blankAsEmpty && mapping.name >= 0;

    // 總表床位先建索引：房號/床位都用正規化後的鍵 (全形、大小寫、空白都不影響比對)
    const bedIndex = new Map();
    (state.students || []).forEach(s => {
      if (s.hidden) return;
      const key = normalizeRoom(s.room) + '|' + normKey(s.bed);
      if (!bedIndex.has(key)) bedIndex.set(key, s);
    });

    const seenBeds = new Map();   // room|bed → 第一次出現的資料列序號 (偵測重複列)
    let prevRoom = '';            // 房號欄空白就沿用上一列 (合併儲存格常見)

    dataRows.forEach((row, idx) => {
      if (!row || row.every(c => cellStr(c) === '')) return; // 完全空列略過(非資料床位)
      stats.total++;

      const blank = isBlankRow(row, mapping);
      if (blank) stats.blankRows++;

      const rawRoom = mapping.room >= 0 ? row[mapping.room] : '';
      const rawBed = mapping.bed >= 0 ? row[mapping.bed] : '';
      let room = normalizeRoom(rawRoom);
      let roomInherited = false;
      if (!room && mapping.room >= 0 && prevRoom) { room = prevRoom; roomInherited = true; stats.inherited++; }
      if (room) prevRoom = room;
      const bed = normalizeBed(rawBed, useLetters);

      const name = mapping.name >= 0 ? cellStr(row[mapping.name]) : '';
      const studentId = mapping.studentId >= 0 ? cellStr(row[mapping.studentId]) : '';
      const klass = mapping.class >= 0 ? cellStr(row[mapping.class]) : '';
      const phone = mapping.phone >= 0 ? normalizePhone(row[mapping.phone]) : '';
      const address = mapping.address >= 0 ? cellStr(row[mapping.address]) : '';

      const bedKey = room + '|' + normKey(bed);
      const target = bedIndex.get(bedKey) || null;

      const item = {
        rowIndex: idx, room, bed, name, studentId, class: klass, phone, address,
        blank, matched: !!target, target, roomInherited,
        action: 'skip', changed: false,
      };

      // 同一床在 Excel 出現兩次：只取第一列，後面的標「重複列」不處理，免得默默蓋掉前一列
      if (room && bed && seenBeds.has(bedKey)) {
        item.action = 'duplicate';
        item.duplicateOf = seenBeds.get(bedKey);
        stats.duplicates++;
        warnings.push(`資料第 ${idx + 1} 列 ${room} ${bed} 與第 ${item.duplicateOf + 1} 列重複，只採用第一列`);
        items.push(item);
        return;
      }
      if (room && bed) seenBeds.set(bedKey, idx);

      if (!target) {
        stats.unmatchedRows++;
        item.action = 'unmatched';
      } else {
        stats.matched++;
        if (blank) {
          if (canClear) {
            const willClear = !target.isEmpty;
            item.action = willClear ? 'clear' : 'unchanged';
            item.changed = willClear;
          } else {
            item.action = 'skip-blank';
          }
        } else {
          // 備註只「附加」在既有內容後面，不覆蓋；已經有同樣片段就不重複
          let remarksAppend = '';
          if (options.noteContact) {
            const snippet = [phone, address].filter(Boolean).join(' / ');
            const current = (target.remarks || '').trim();
            if (snippet && !current.includes(snippet)) remarksAppend = current ? current + ' / ' + snippet : snippet;
          }
          // 比對一律用正規化後的值 (全形/半形、頭尾空白、學號大小寫不算異動)；寫回仍用 Excel 原值
          const nameChanged = normKey(target.name, true) !== normKey(name, true);
          const idChanged = normKey(target.studentId) !== normKey(studentId);
          const classChanged = normKey(target.class, true) !== normKey(klass, true);
          // 電話/住址現在是總表的正式欄位；Excel 有值且和現有不同就算有變動
          const phoneChanged = !!phone && phoneKey(target.phone) !== phoneKey(phone);
          const addressChanged = !!address && normKey(target.address, true) !== normKey(address, true);
          const changed = nameChanged || idChanged || classChanged || phoneChanged || addressChanged;
          item.changed = changed;
          item.remarksAppend = remarksAppend;
          if (!changed && options.skipUnchanged) {
            item.action = 'unchanged';
          } else {
            item.action = 'update';
          }
        }
      }

      if (item.action === 'unchanged' || item.action === 'skip-blank') stats.unchanged++;
      if (item.action === 'update' || item.action === 'clear') stats.willChange++;

      items.push(item);
    });

    return { items, stats, warnings };
  }

  // ────────────────────────── 匯入執行 ──────────────────────────

  // 後端寫成功後，把同樣的值套到本機 state，畫面才不用等重抓總表
  function applyItemLocally(it) {
    if (it.action === 'clear') {
      it.target.name = ''; it.target.studentId = ''; it.target.class = ''; it.target.squad = '';
      it.target.phone = ''; it.target.address = '';
      it.target.isForeign = false; it.target.isEmpty = true;
    } else {
      it.target.name = it.name; it.target.studentId = it.studentId;
      it.target.class = it.class; it.target.squad = it.class;
      if (it.phone) it.target.phone = it.phone;
      if (it.address) it.target.address = it.address;
      it.target.isEmpty = false;
    }
  }

  function logEntry(it, ok, error) {
    const entry = { pageId: it.target.id, room: it.room, bed: it.bed, name: it.name || '(清空)', ok };
    if (error) entry.error = error;
    return entry;
  }

  async function runImport(items, onProgress) {
    const toApply = items.filter(it => it.action === 'update' || it.action === 'clear');
    const total = toApply.length;
    const log = [];
    const failedItems = [];   // 這次沒寫成功的項目，給「重試失敗項目」用
    let done = 0, ok = 0, fail = 0, remarkFail = 0;
    IMP.cancelled = false;
    IMP.running = true;

    // Notion/Worker 在大量資料一次寫入時容易超過一般 15 秒請求時限。
    // 小批次降低單次負載；此更新是完整欄位指派（冪等），暫時性中斷可安全重試。
    const BATCH = 20;
    try {
      for (let i = 0; i < toApply.length; i += BATCH) {
        if (IMP.cancelled) break;
        const batch = toApply.slice(i, i + BATCH);
        const payloads = batch.map(it => {
          if (it.action === 'clear') {
            return { pageId: it.target.id, updateProfile: { name: '', class: '', studentId: '', phone: '', address: '', isForeign: false }, markEmpty: true, clearProfile: true };
          }
          const profile = { name: it.name, class: it.class, studentId: it.studentId, isForeign: !!it.target.isForeign };
          // Excel 沒帶到的欄位就不要送，才不會把總表既有的電話/住址洗掉
          if (it.phone) profile.phone = it.phone;
          if (it.address) profile.address = it.address;
          return { pageId: it.target.id, updateProfile: profile, markEmpty: false };
        });

        let succeeded = batch;
        let failure = null;   // { errList, message }：這批有東西沒寫成功
        try {
          const res = await window._api.updateAttendance(payloads, {
            timeoutMs: 45000,
            retries: 2,
            retryDelayMs: 1200,
          });
          // 後端失敗仍可能回 200 (success:false + errors)，api.js 不一定會丟錯，要自己看
          if (res && res.success === false && Array.isArray(res.errors) && res.errors.length) {
            failure = { errList: res.errors, message: res.error || '寫入失敗' };
          }
        } catch (err) {
          // 後端會逐筆寫，只回報寫失敗的 pageId (err.data.errors)；沒有 err.data (純網路錯、逾時) 才整批當失敗
          const errList = err && err.data && Array.isArray(err.data.errors) ? err.data.errors : null;
          failure = { errList, message: (err && err.message) || '寫入失敗' };
        }
        if (failure) {
          // 只把後端點名失敗的那幾筆標 ✗，其他照樣算成功；認不出 pageId 就整批 ✗
          const errList = failure.errList;
          const partial = !!errList && errList.length > 0 && errList.every(e => e && e.pageId);
          const failedIds = new Set(partial ? errList.map(e => e.pageId) : batch.map(it => it.target.id));
          const errMsg = {};
          if (partial) errList.forEach(e => { errMsg[e.pageId] = e.error || failure.message; });
          succeeded = batch.filter(it => !failedIds.has(it.target.id));
          batch.forEach(it => {
            if (!failedIds.has(it.target.id)) return;
            fail++; done++;
            failedItems.push(it);
            log.push(logEntry(it, false, errMsg[it.target.id] || failure.message));
          });
        }

        succeeded.forEach(it => {
          applyItemLocally(it);
          ok++; done++;
          log.push(logEntry(it, true));
        });

        // 備註（電話/地址）需另外呼叫，逐筆但不阻斷整批；失敗要記下來，結果頁才看得到
        if (window._api.updateRemark) {
          await Promise.all(succeeded.map(it => {
            if (it.action === 'update' && it.remarksAppend) {
              return window._api.updateRemark(it.target.id, it.remarksAppend).catch(() => {
                remarkFail++;
                const entry = log.find(l => l.pageId === it.target.id && l.ok);
                if (entry) entry.remarkFailed = true;
              });
            }
            return Promise.resolve();
          }));
        }

        if (typeof onProgress === 'function') {
          try { onProgress({ done, total, ok, fail, remarkFail, log: log.slice() }); } catch (_) { }
        }
        if (typeof renderCurrentPage === 'function') {
          try { renderCurrentPage(true); } catch (_) { }
        }
      }
    } finally {
      IMP.running = false;
    }

    IMP._failedItems = failedItems.concat(toApply.slice(done)); // 取消時沒跑到的也留給重試
    return { done, total, ok, fail, remarkFail, log, cancelled: IMP.cancelled };
  }

  // ────────────────────────── 測試用外掛入口 ──────────────────────────
  // 供 Playwright 測試直接餵入已解析好的資料列（跳過檔案讀取階段）
  window._importRows = async function (rowsArray, mapping, options) {
    const opts = Object.assign({ blankAsEmpty: false, noteContact: false, skipUnchanged: true }, options || {});
    const map = Object.assign({ room: -1, bed: -1, name: -1, studentId: -1, class: -1, phone: -1, address: -1 }, mapping || {});
    const preview = buildPreview(rowsArray, map, opts);
    const result = await runImport(preview.items, null);
    return { preview, result };
  };

  // ────────────────────────── UI ──────────────────────────

  function iconSvg(path) {
    return `<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  function fieldLabel(f) {
    return { room: '房號', bed: '床位', name: '姓名', studentId: '學號', class: '班別', phone: '電話', address: '地址' }[f] || f;
  }

  function buildMappingRow(headers) {
    const fields = ['room', 'bed', 'name', 'studentId', 'class', 'phone', 'address'];
    return fields.map(f => {
      const options = headers.map((h, i) => `<option value="${i}" ${IMP.mapping[f] === i ? 'selected' : ''}>${escapeHtml(h || ('欄' + (i + 1)))}</option>`).join('');
      return `<div class="imp-map-row">
        <span class="imp-map-label">${fieldLabel(f)}</span>
        <select class="imp-map-select" data-field="${f}" onchange="window._impOnMappingChange(this)">
          <option value="-1">－ 未對應 －</option>
          ${options}
        </select>
      </div>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderModal(step) {
    let modal = document.getElementById('imp-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'imp-modal';
      modal.className = 'modal-overlay imp-modal-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `<div class="modal-card imp-modal-card">${stepHtml(step)}</div>`;
    requestAnimationFrame(() => modal.classList.add('visible'));
  }

  function closeModal() {
    const modal = document.getElementById('imp-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(() => modal.remove(), 250);
  }

  function stepHtml(step) {
    if (step === 'sheet') return sheetPickerHtml();
    if (step === 'mapping') return mappingHtml();
    if (step === 'preview') return previewHtml();
    if (step === 'importing') return importingHtml();
    if (step === 'summary') return summaryHtml();
    return dropHtml();
  }

  function dropHtml() {
    return `
      <h3>${iconSvg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>')} 匯入 Excel 名單</h3>
      <div class="modal-desc">選擇學校提供的住宿生 Excel/CSV 名單，系統會自動比對房號床位並寫回總表。</div>
      <div id="imp-drop" class="imp-dropzone" tabindex="0" role="button" aria-label="選擇或拖曳 Excel 檔案"
           onclick="document.getElementById('imp-file-input').click()"
           ondragover="event.preventDefault();this.classList.add('drag')"
           ondragleave="this.classList.remove('drag')"
           ondrop="window._impOnDrop(event)"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('imp-file-input').click();}">
        ${iconSvg('<path d="M21.2 15c.7-1.2 1-2.5.7-3.9-.6-2.3-2.6-4-5-4.1h-1.2c-.7-3-3.2-5-6.2-5-3.4 0-6.2 2.8-6.2 6.2 0 .6.1 1.2.2 1.8-2 .4-3.5 2.2-3.5 4.3 0 2.5 2 4.5 4.5 4.5H10"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>')}
        <div class="imp-drop-title">拖曳檔案到這裡，或點擊選擇</div>
        <div class="imp-drop-hint">支援 .xlsx / .xls / .csv</div>
      </div>
      <input id="imp-file-input" type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="window._impOnFileChosen(event)">
      <div id="imp-drop-error" class="imp-error" hidden></div>
      <div class="modal-actions">
        <button class="modal-btn cancel" onclick="window._impClose()">取消</button>
      </div>`;
  }

  function sheetPickerHtml() {
    const sheets = IMP._nonEmptySheets;
    const opts = sheets.map(s => `<button class="imp-sheet-btn ${s === IMP.sheetName ? 'active' : ''}" data-sheet="${escapeHtml(s)}" onclick="window._impChooseSheet(this.dataset.sheet)">${escapeHtml(s)}</button>`).join('');
    return `
      <h3>選擇工作表</h3>
      <div class="modal-desc">此檔案有多個工作表，請選擇要匯入的名單所在分頁。</div>
      <div class="imp-sheet-list">${opts}</div>
      <div class="modal-actions">
        <button class="modal-btn cancel" onclick="window._impBackToDrop()">上一步</button>
      </div>`;
  }

  function mappingHtml() {
    return `
      <h3>對應欄位</h3>
      <div class="modal-desc">系統已自動猜測欄位對應，請確認或修正（房號 / 床位為必填）。</div>
      <div class="imp-map-list">${buildMappingRow(IMP.headers)}</div>
      <div id="imp-map-error" class="imp-error" hidden></div>
      <div class="modal-actions">
        <button class="modal-btn cancel" onclick="window._impBackToDrop()">上一步</button>
        <button class="modal-btn confirm" onclick="window._impConfirmMapping()">下一步</button>
      </div>`;
  }

  function statTile(label, val, cls) {
    return `<div class="imp-stat ${cls || ''}"><div class="imp-stat-val">${val}</div><div class="imp-stat-label">${label}</div></div>`;
  }

  function previewHtml() {
    const { items, stats } = IMP.preview;
    const warnings = IMP.preview.warnings || [];
    const rows = items.slice(0, 12).map(it => `
      <tr class="imp-row-${it.action}">
        <td>${escapeHtml(it.room)} ${escapeHtml(it.bed)}${it.roomInherited ? ' <span class="imp-tag">沿用上一列</span>' : ''}</td>
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(it.studentId)}</td>
        <td>${escapeHtml(it.class)}</td>
        <td>${actionLabel(it.action)}</td>
      </tr>`).join('');

    return `
      <h3>預覽匯入結果</h3>
      <div class="imp-stats-grid">
        ${statTile('資料列', stats.total)}
        ${statTile('已比對床位', stats.matched)}
        ${statTile('將異動', stats.willChange, 'warn')}
        ${statTile('無需異動', stats.unchanged)}
        ${statTile('無法比對', stats.unmatchedRows, stats.unmatchedRows ? 'danger' : '')}
        ${statTile('空白列', stats.blankRows)}
        ${stats.duplicates ? statTile('重複列', stats.duplicates, 'warn') : ''}
      </div>
      <div class="imp-table-wrap">
        <table class="imp-table">
          <thead><tr><th>床位</th><th>姓名</th><th>學號</th><th>班別</th><th>動作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${items.length > 12 ? `<div class="imp-more-hint">... 另外 ${items.length - 12} 筆未顯示</div>` : ''}
      ${warnings.length ? `<div id="imp-preview-warn" class="imp-error">${warnings.slice(0, 20).map(w => escapeHtml(w)).join('<br>')}${warnings.length > 20 ? `<br>... 另外 ${warnings.length - 20} 筆` : ''}</div>` : ''}
      <div id="imp-preview-error" class="imp-error" ${IMP._previewError ? '' : 'hidden'}>${escapeHtml(IMP._previewError || '')}</div>
      <div class="imp-opts">
        <label class="imp-opt-row"><input type="checkbox" id="imp-opt-blank" ${IMP.options.blankAsEmpty ? 'checked' : ''} onchange="window._impToggleOpt('blankAsEmpty',this.checked)"> 空白列視為空床並清空該床</label>
        <label class="imp-opt-row"><input type="checkbox" id="imp-opt-contact" ${IMP.options.noteContact ? 'checked' : ''} onchange="window._impToggleOpt('noteContact',this.checked)"> 電話/地址另外複製一份到備註</label>
        <label class="imp-opt-row"><input type="checkbox" id="imp-opt-skip" ${IMP.options.skipUnchanged ? 'checked' : ''} onchange="window._impToggleOpt('skipUnchanged',this.checked)"> 略過與目前相同的資料</label>
      </div>
      <div class="modal-actions">
        <button class="modal-btn cancel" onclick="window._impBackToMapping()">上一步</button>
        <button class="modal-btn confirm" ${stats.willChange === 0 ? 'disabled' : ''} onclick="window._impStartImport()">開始匯入 (${stats.willChange})</button>
      </div>`;
  }

  function actionLabel(a) {
    return {
      update: '<span class="imp-tag imp-tag-warn">更新</span>',
      clear: '<span class="imp-tag imp-tag-danger">清空</span>',
      unchanged: '<span class="imp-tag">不變</span>',
      'skip-blank': '<span class="imp-tag">略過空白</span>',
      unmatched: '<span class="imp-tag imp-tag-danger">無法比對</span>',
      duplicate: '<span class="imp-tag imp-tag-warn">重複列</span>',
      skip: '<span class="imp-tag">略過</span>',
    }[a] || a;
  }

  function importingHtml() {
    return `
      <h3>匯入中...</h3>
      <div class="imp-progress-wrap">
        <div class="imp-progress-bar"><div id="imp-progress-fill" class="imp-progress-fill" style="width:0%"></div></div>
        <div id="imp-progress-text" class="imp-progress-text">0 / 0</div>
      </div>
      <div id="imp-log-list" class="imp-log-list"></div>
      <div class="modal-actions">
        <button class="modal-btn cancel" onclick="window._impCancelImport()">取消</button>
      </div>`;
  }

  function summaryHtml() {
    const r = IMP._result || { done: 0, total: 0, ok: 0, fail: 0, remarkFail: 0, cancelled: false };
    const retryCount = (IMP._failedItems || []).length;
    return `
      <h3>${r.cancelled ? '匯入已取消' : '匯入完成'}</h3>
      <div class="imp-stats-grid">
        ${statTile('成功', r.ok, 'ok')}
        ${statTile('失敗', r.fail, r.fail ? 'danger' : '')}
        ${statTile('總筆數', r.total)}
      </div>
      ${r.remarkFail ? `<div id="imp-remark-fail" class="imp-error">備註 ${r.remarkFail} 筆未更新（床位資料已寫入，只有電話/地址沒複製到備註）</div>` : ''}
      <div class="imp-log-list">${(r.log || []).map(l => `<div class="imp-log-item ${l.ok ? 'ok' : 'fail'}">${l.ok ? '✓' : '✗'} ${escapeHtml(l.room)} ${escapeHtml(l.bed)} ${escapeHtml(l.name)}${l.error ? ' — ' + escapeHtml(l.error) : ''}${l.remarkFailed ? ' — 備註未更新' : ''}</div>`).join('')}</div>
      <div class="modal-actions">
        ${retryCount ? `<button id="imp-retry-failed" class="modal-btn cancel" onclick="window._impRetryFailed()">重試失敗項目 (${retryCount})</button>` : ''}
        <button class="modal-btn confirm" onclick="window._impClose()">完成</button>
      </div>`;
  }

  // ────────────────────────── 事件處理（掛在 window） ──────────────────────────

  window.openImportWizard = function () {
    IMP.workbook = null; IMP.rows = []; IMP.preview = null; IMP._result = null;
    IMP._failedItems = []; IMP._previewError = '';
    renderModal('drop');
  };

  window._impClose = function () { closeModal(); };

  window._impOnDrop = function (ev) {
    ev.preventDefault();
    const dt = ev.dataTransfer;
    if (dt && dt.files && dt.files[0]) handleFile(dt.files[0]);
    document.getElementById('imp-drop')?.classList.remove('drag');
  };

  window._impOnFileChosen = function (ev) {
    const f = ev.target.files && ev.target.files[0];
    if (f) handleFile(f);
  };

  async function handleFile(file) {
    const errEl = () => document.getElementById('imp-drop-error');
    try {
      // XLSX 改成按需載入 (app.js 提供 window.ensureXLSX)；載不到就直接告訴使用者，不要卡住
      if (window.ensureXLSX) await window.ensureXLSX();
      if (typeof XLSX === 'undefined') throw new Error('Excel 元件尚未載入，請確認網路後重試');
      const wb = await readFileAsWorkbook(file);
      IMP.workbook = wb;
      const sheets = nonEmptySheets(wb);
      IMP._nonEmptySheets = sheets;
      if (sheets.length === 0) throw new Error('找不到任何有資料的工作表');
      if (sheets.length === 1) {
        chooseSheet(sheets[0]);
      } else {
        renderModal('sheet');
      }
    } catch (err) {
      const el = errEl();
      if (el) { el.hidden = false; el.textContent = '讀取失敗：' + err.message; }
    }
  }

  window._impBackToDrop = function () { renderModal('drop'); };
  window._impBackToMapping = function () { renderModal('mapping'); };

  window._impChooseSheet = function (name) { chooseSheet(name); };

  function chooseSheet(name) {
    IMP.sheetName = name;
    const allRows = sheetToRows(IMP.workbook, name);
    IMP.headerRowIdx = findHeaderRow(allRows);
    IMP.headers = (allRows[IMP.headerRowIdx] || []).map(h => cellStr(h));
    IMP.rows = allRows.slice(IMP.headerRowIdx + 1);
    IMP.mapping = guessColumns(IMP.headers);
    renderModal('mapping');
  }

  window._impOnMappingChange = function (sel) {
    const field = sel.dataset.field;
    IMP.mapping[field] = parseInt(sel.value, 10);
  };

  window._impConfirmMapping = function () {
    const errEl = document.getElementById('imp-map-error');
    if (IMP.mapping.room < 0 || IMP.mapping.bed < 0) {
      if (errEl) { errEl.hidden = false; errEl.textContent = '請至少對應「房號」與「床位」欄位。'; }
      return;
    }
    IMP._previewError = '';
    // 沒對應姓名欄就不能用清空功能 (分不出空床和沒填)，回到預覽時先把選項關掉
    if (IMP.options.blankAsEmpty && IMP.mapping.name < 0) {
      IMP.options.blankAsEmpty = false;
      IMP._previewError = '請先對應姓名欄位，才能使用清空功能';
    }
    IMP.preview = buildPreview(IMP.rows, IMP.mapping, IMP.options);
    renderModal('preview');
  };

  window._impToggleOpt = function (key, val) {
    IMP._previewError = '';
    if (key === 'blankAsEmpty' && val && IMP.mapping.name < 0) {
      // 直接擋下：沒有姓名欄，每一列都會被當成空白列，等於把所有床位清空
      IMP.options.blankAsEmpty = false;
      IMP._previewError = '請先對應姓名欄位，才能使用清空功能';
    } else {
      IMP.options[key] = val;
    }
    IMP.preview = buildPreview(IMP.rows, IMP.mapping, IMP.options);
    renderModal('preview');
  };

  function importProgress(progress) {
    const fill = document.getElementById('imp-progress-fill');
    const text = document.getElementById('imp-progress-text');
    const logList = document.getElementById('imp-log-list');
    if (fill) fill.style.width = (progress.total ? (progress.done / progress.total * 100) : 100) + '%';
    if (text) text.textContent = `${progress.done} / ${progress.total}（成功 ${progress.ok}／失敗 ${progress.fail}）`;
    if (logList) {
      logList.innerHTML = progress.log.slice(-30).map(l =>
        `<div class="imp-log-item ${l.ok ? 'ok' : 'fail'}">${l.ok ? '✓' : '✗'} ${escapeHtml(l.room)} ${escapeHtml(l.bed)} ${escapeHtml(l.name)}${l.error ? ' — ' + escapeHtml(l.error) : ''}</div>`
      ).join('');
    }
  }

  function finishImport(result) {
    IMP._result = result;
    if (typeof showToast === 'function') {
      const extra = (result.fail ? '，失敗 ' + result.fail + ' 筆' : '') + (result.remarkFail ? '，備註 ' + result.remarkFail + ' 筆未更新' : '');
      showToast(result.cancelled ? '匯入已取消' : `匯入完成，成功 ${result.ok} 筆${extra}`, (result.fail || result.remarkFail) ? 'error' : 'success');
    }
    renderModal('summary');
  }

  // 要清空的床位太多 (超過總床位三成或 20 張) 時再問一次，避免對錯欄位把整棟清光
  async function confirmMassClear(items) {
    const clearCount = items.filter(it => it.action === 'clear').length;
    const totalBeds = (state.students || []).filter(s => !s.hidden).length;
    if (!clearCount || !(clearCount > 20 || clearCount > totalBeds * 0.3)) return true;
    const message = `這次匯入會清空 ${clearCount} 張床位（總床位 ${totalBeds} 張），這些床的姓名、學號、班別、電話、住址都會被清掉。確定要繼續嗎？`;
    if (typeof showConfirmDialog === 'function') {
      return showConfirmDialog({ title: '確認清空床位', message, confirmText: '確定清空', cancelText: '取消', danger: true });
    }
    return window.confirm(message);
  }

  window._impStartImport = async function () {
    if (IMP.running) return;
    if (IMP.options.blankAsEmpty && IMP.mapping.name < 0) {
      IMP.options.blankAsEmpty = false;
      IMP._previewError = '請先對應姓名欄位，才能使用清空功能';
      IMP.preview = buildPreview(IMP.rows, IMP.mapping, IMP.options);
      renderModal('preview');
      return;
    }
    if (!(await confirmMassClear(IMP.preview.items))) return;
    renderModal('importing');
    try {
      finishImport(await runImport(IMP.preview.items, importProgress));
    } catch (err) {
      // 不該發生的錯也要收尾，不能讓畫面停在「匯入中…」
      if (typeof showToast === 'function') showToast('匯入中斷：' + (err && err.message || err), 'error');
      finishImport({ done: 0, total: 0, ok: 0, fail: 0, remarkFail: 0, log: [], cancelled: true });
    }
  };

  // 只重送上一輪失敗 (或取消時沒跑到) 的項目，成功的不會再寫一次
  window._impRetryFailed = async function () {
    const retry = IMP._failedItems || [];
    const prev = IMP._result;
    if (IMP.running || !retry.length || !prev) return;
    renderModal('importing');
    try {
      const r = await runImport(retry, importProgress);
      const retried = new Set(r.log.map(l => l.pageId));
      // 成功的紀錄留著，失敗的換成這一輪的結果；這輪沒跑到 (又取消) 的沿用上一輪的失敗紀錄
      const log = prev.log.filter(l => l.ok).concat(r.log, prev.log.filter(l => !l.ok && !retried.has(l.pageId)));
      const ok = log.filter(l => l.ok).length;
      const fail = log.length - ok;
      finishImport({
        done: ok + fail, total: prev.total, ok, fail,
        remarkFail: (prev.remarkFail || 0) + (r.remarkFail || 0),
        log, cancelled: r.cancelled,
      });
    } catch (err) {
      if (typeof showToast === 'function') showToast('重試中斷：' + (err && err.message || err), 'error');
      finishImport(prev);
    }
  };

  window._impCancelImport = function () {
    IMP.cancelled = true;
  };

  // 只供測試 (tests/import.cjs) 檢查精靈內部狀態與純函式，正式流程不會用到
  window.__impTest = { IMP, buildPreview, runImport, sheetToRows, normalizePhone, phoneKey, normKey, normalizeRoom, normalizeBed };

})();
