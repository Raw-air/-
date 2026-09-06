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

  function normalizeBed(raw, rosterUsesLetters) {
    if (raw === null || raw === undefined) return '';
    let v = String(raw).trim().toUpperCase();
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
    return String(raw).trim().toUpperCase().replace(/\s+/g, '');
  }

  function cellStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  // 沒有姓名也沒有學號就是空床；只填了班別 (例如「華語專班」保留床) 不算有人住
  function isBlankRow(row, mapping) {
    const fields = ['name', 'studentId'];
    return fields.every(f => mapping[f] < 0 || !cellStr(row[mapping[f]]));
  }

  // ────────────────────────── 檔案解析 ──────────────────────────

  function ensureXLSX() {
    return typeof window !== 'undefined' && window.XLSX;
  }

  function readFileAsWorkbook(file) {
    return new Promise((resolve, reject) => {
      if (!ensureXLSX()) { reject(new Error('XLSX_NOT_LOADED')); return; }
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
    return rows;
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
    const stats = { total: 0, matched: 0, willChange: 0, unchanged: 0, unmatchedRows: 0, blankRows: 0 };

    dataRows.forEach((row, idx) => {
      if (!row || row.every(c => cellStr(c) === '')) return; // 完全空列略過(非資料床位)
      stats.total++;

      const blank = isBlankRow(row, mapping);
      if (blank) stats.blankRows++;

      const rawRoom = mapping.room >= 0 ? row[mapping.room] : '';
      const rawBed = mapping.bed >= 0 ? row[mapping.bed] : '';
      const room = normalizeRoom(rawRoom);
      const bed = normalizeBed(rawBed, useLetters);

      const name = mapping.name >= 0 ? cellStr(row[mapping.name]) : '';
      const studentId = mapping.studentId >= 0 ? cellStr(row[mapping.studentId]) : '';
      const klass = mapping.class >= 0 ? cellStr(row[mapping.class]) : '';
      const phone = mapping.phone >= 0 ? cellStr(row[mapping.phone]) : '';
      const address = mapping.address >= 0 ? cellStr(row[mapping.address]) : '';

      const target = (state.students || []).find(s => !s.hidden && s.room === room && s.bed === bed);

      const item = {
        rowIndex: idx, room, bed, name, studentId, class: klass, phone, address,
        blank, matched: !!target, target: target || null,
        action: 'skip', changed: false,
      };

      if (!target) {
        stats.unmatchedRows++;
        item.action = 'unmatched';
      } else {
        stats.matched++;
        if (blank) {
          if (options.blankAsEmpty) {
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
          const nameChanged = (target.name || '') !== name;
          const idChanged = (target.studentId || '') !== studentId;
          const classChanged = (target.class || '') !== klass;
          const changed = nameChanged || idChanged || classChanged;
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

    return { items, stats };
  }

  // ────────────────────────── 匯入執行 ──────────────────────────

  async function runImport(items, onProgress) {
    const toApply = items.filter(it => it.action === 'update' || it.action === 'clear');
    const total = toApply.length;
    const log = [];
    let done = 0, ok = 0, fail = 0;
    IMP.cancelled = false;
    IMP.running = true;

    const BATCH = 15;
    for (let i = 0; i < toApply.length; i += BATCH) {
      if (IMP.cancelled) break;
      const batch = toApply.slice(i, i + BATCH);
      const payloads = batch.map(it => {
        if (it.action === 'clear') {
          return { pageId: it.target.id, updateProfile: { name: '', class: '', studentId: '', isForeign: false }, markEmpty: true, clearProfile: true };
        }
        return {
          pageId: it.target.id,
          updateProfile: { name: it.name, class: it.class, studentId: it.studentId, isForeign: !!it.target.isForeign },
          markEmpty: false,
        };
      });

      try {
        await window._api.updateAttendance(payloads);
        batch.forEach(it => {
          if (it.action === 'clear') {
            it.target.name = ''; it.target.studentId = ''; it.target.class = ''; it.target.squad = '';
            it.target.isForeign = false; it.target.isEmpty = true;
          } else {
            it.target.name = it.name; it.target.studentId = it.studentId;
            it.target.class = it.class; it.target.squad = it.class;
            it.target.isEmpty = false;
          }
          ok++; done++;
          log.push({ room: it.room, bed: it.bed, name: it.name || '(清空)', ok: true });
        });

        // 備註（電話/地址）需另外呼叫，逐筆但不阻斷整批
        if (window._api.updateRemark) {
          await Promise.all(batch.map(it => {
            if (it.action === 'update' && it.remarksAppend) {
              return window._api.updateRemark(it.target.id, it.remarksAppend).catch(() => { });
            }
            return Promise.resolve();
          }));
        }
      } catch (err) {
        batch.forEach(it => {
          fail++; done++;
          log.push({ room: it.room, bed: it.bed, name: it.name || '(清空)', ok: false, error: err.message });
        });
      }

      localStorage.setItem('biyuan_temp_students_update', JSON.stringify(state.students));
      if (typeof onProgress === 'function') onProgress({ done, total, ok, fail, log: log.slice() });

      if (typeof renderCurrentPage === 'function') renderCurrentPage(true);
    }

    IMP.running = false;
    return { done, total, ok, fail, log, cancelled: IMP.cancelled };
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
    const rows = items.slice(0, 12).map(it => `
      <tr class="imp-row-${it.action}">
        <td>${escapeHtml(it.room)} ${escapeHtml(it.bed)}</td>
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
      </div>
      <div class="imp-table-wrap">
        <table class="imp-table">
          <thead><tr><th>床位</th><th>姓名</th><th>學號</th><th>班別</th><th>動作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${items.length > 12 ? `<div class="imp-more-hint">... 另外 ${items.length - 12} 筆未顯示</div>` : ''}
      <div class="imp-opts">
        <label class="imp-opt-row"><input type="checkbox" id="imp-opt-blank" ${IMP.options.blankAsEmpty ? 'checked' : ''} onchange="window._impToggleOpt('blankAsEmpty',this.checked)"> 空白列視為空床並清空該床</label>
        <label class="imp-opt-row"><input type="checkbox" id="imp-opt-contact" ${IMP.options.noteContact ? 'checked' : ''} onchange="window._impToggleOpt('noteContact',this.checked)"> 電話/地址寫進備註</label>
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
    const r = IMP._result || { done: 0, total: 0, ok: 0, fail: 0, cancelled: false };
    return `
      <h3>${r.cancelled ? '匯入已取消' : '匯入完成'}</h3>
      <div class="imp-stats-grid">
        ${statTile('成功', r.ok, 'ok')}
        ${statTile('失敗', r.fail, r.fail ? 'danger' : '')}
        ${statTile('總筆數', r.total)}
      </div>
      <div class="imp-log-list">${(r.log || []).map(l => `<div class="imp-log-item ${l.ok ? 'ok' : 'fail'}">${l.ok ? '✓' : '✗'} ${escapeHtml(l.room)} ${escapeHtml(l.bed)} ${escapeHtml(l.name)}${l.error ? ' — ' + escapeHtml(l.error) : ''}</div>`).join('')}</div>
      <div class="modal-actions">
        <button class="modal-btn confirm" onclick="window._impClose()">完成</button>
      </div>`;
  }

  // ────────────────────────── 事件處理（掛在 window） ──────────────────────────

  window.openImportWizard = function () {
    IMP.workbook = null; IMP.rows = []; IMP.preview = null; IMP._result = null;
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
    if (!ensureXLSX()) {
      const el = errEl();
      if (el) {
        el.hidden = false;
        el.innerHTML = 'Excel 解析套件尚未載入完成，請稍候再試。 <button class="imp-retry-btn" onclick="window._impRetryLib()">重試</button>';
      }
      return;
    }
    try {
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

  window._impRetryLib = function () {
    const el = document.getElementById('imp-drop-error');
    if (ensureXLSX()) { if (el) el.hidden = true; }
    else if (el) el.textContent = '仍未偵測到 XLSX 套件，請確認網路連線後重新整理頁面。';
  };

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
    IMP.preview = buildPreview(IMP.rows, IMP.mapping, IMP.options);
    renderModal('preview');
  };

  window._impToggleOpt = function (key, val) {
    IMP.options[key] = val;
    IMP.preview = buildPreview(IMP.rows, IMP.mapping, IMP.options);
    renderModal('preview');
  };

  window._impStartImport = async function () {
    renderModal('importing');
    const result = await runImport(IMP.preview.items, (progress) => {
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
    });
    IMP._result = result;
    if (typeof showToast === 'function') {
      showToast(result.cancelled ? '匯入已取消' : `匯入完成，成功 ${result.ok} 筆${result.fail ? '，失敗 ' + result.fail + ' 筆' : ''}`, result.fail ? 'error' : 'success');
    }
    renderModal('summary');
  };

  window._impCancelImport = function () {
    IMP.cancelled = true;
  };

})();
