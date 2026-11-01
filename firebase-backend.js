/**
 * 前端直連 Firebase 的轉接層。
 * 系統原本打 WORKER_URL 的請求在這裡接走改讀寫 Firestore，回傳格式跟後端一模一樣，app.js 不用改。
 * 每筆寫入成功後在背景原樣送一份給原後端 (靜默寫回 Notion)，Firebase 出事時 Notion 還有完整資料。
 * Firebase 連不上或寫入失敗：這次開啟改走原後端，使用者不會卡住。
 * CONFIG.BACKEND 改成 'notion' 就完全不會接手，等於退回舊版。
 */
(function () {
  // 新版 SW 用這個認出已經是新版的畫面；沒回應的舊畫面會被自動重新載入 (見 sw.js)
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data === 'biyuan-ping' && e.ports[0]) e.ports[0].postMessage('biyuan-pong');
    });
  }

  const CONFIG = window.CONFIG || {};
  if (CONFIG.BACKEND !== 'firebase' || !window.firebase || !CONFIG.FIREBASE) return;
  if (navigator.webdriver && !window.__FIREBASE_TEST__) return; // 其他自動化測試不准碰到正式 Firebase

  const WORKER = CONFIG.WORKER_URL;
  const realFetch = window.fetch.bind(window);
  const WRITE_TIMEOUT_MS = 12000;
  const READY_TIMEOUT_MS = 12000;
  const MIRROR_KEY = 'biyuan_notion_mirror';
  const MIRROR_MAX_TRIES = 50;
  const MIRROR_TIMEOUT_MS = 90000;
  const CHANGE_LOG_MAX = 500;
  const SQUAD_ORDER = ['一單', '一雙', '二單', '二雙', '三單', '三雙'];
  const ATTENDANCE_VALUES = ['✓', '◎', '✘', '△'];
  const BED_FIELDS = ['id', 'name', 'room', 'bed', 'class', 'studentId', 'phone', 'address', 'squad', 'isForeign', 'isEmpty'];
  const SWAP_FIELDS = ['name', 'class', 'studentId', 'phone', 'address', 'isForeign', 'isEmpty', 'attendance'];
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const LEGACY_RE = /^(\d{1,2})月(\d{1,2})日$/;
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  firebase.initializeApp(CONFIG.FIREBASE);
  const db = firebase.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  const { FieldPath, FieldValue } = firebase.firestore;

  // ── 狀態 ──
  const live = {
    failover: false,        // true = 這次開啟改走原後端
    semester: null,         // system/semester
    beds: new Map(),        // 目前學期每床資料
    bedsReady: false,
    dateColumns: [],
    semesterMeta: null,
    config: {},
    configReady: false,
    remarks: {},
    remarksReady: false,
    seq: 0,
    changes: [],            // 別台裝置剛改的點名 { seq, id, d, v }
    attTs: Date.now(),
    confirmTs: Date.now(),
    unsubBeds: null,
    unsubMeta: null,
  };

  // 額度估算：每台裝置累計自己的讀寫次數，定期加進 usage/<太平洋時間日期> (Firebase 額度照這個時區歸零)
  const USAGE_FLUSH_MS = 60000;
  const pendingUsage = { reads: 0, writes: 0, deletes: 0 };
  const countUsage = (kind, n = 1) => { pendingUsage[kind] += n; };
  const countServerDocs = snap => {
    countUsage('reads', snap.docChanges().filter(ch => !ch.doc.metadata.hasPendingWrites).length);
  };
  const pacificDay = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  function nextResetLabel() {
    // 找下一個太平洋時間 00:00 換成本機時間
    const now = Date.now();
    for (let t = now + 60000; t < now + 90000000; t += 60000) {
      if (pacificDay(new Date(t)) !== pacificDay(new Date(now))) {
        return new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }
    return '';
  }
  async function flushUsage() {
    const { reads, writes, deletes } = pendingUsage;
    if (!reads && !writes && !deletes) return;
    pendingUsage.reads = pendingUsage.writes = pendingUsage.deletes = 0;
    try {
      await withTimeout(db.collection('usage').doc(pacificDay()).set({
        reads: FieldValue.increment(reads), writes: FieldValue.increment(writes + 1), deletes: FieldValue.increment(deletes),
      }, { merge: true }), WRITE_TIMEOUT_MS, '用量');
    } catch (_) {
      pendingUsage.reads += reads; pendingUsage.writes += writes; pendingUsage.deletes += deletes;
    }
  }
  setInterval(flushUsage, USAGE_FLUSH_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUsage(); });
  async function getUsage() {
    await ready;
    await flushUsage();
    const snap = await withTimeout(db.collection('usage').doc(pacificDay()).get(), WRITE_TIMEOUT_MS, '用量');
    countUsage('reads');
    const d = snap.data() || {};
    return { reads: d.reads || 0, writes: d.writes || 0, deletes: d.deletes || 0, resetAt: nextResetLabel() };
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 別台一改就叫 app.js 馬上更新，不用等下一輪輪詢 (閒置時輪詢要 30 秒)
  const notifyRemoteChange = () => window.dispatchEvent(new Event('biyuan-remote-change'));
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' 逾時')), ms)),
  ]);
  const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const taipeiDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

  function parseDateCol(name) {
    const iso = ISO_RE.exec(name);
    if (iso) return parseInt(iso[1]) * 10000 + parseInt(iso[2]) * 100 + parseInt(iso[3]);
    const m = name.match(/(\d+)月(\d+)日/);
    return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 99999999;
  }
  function isValidDateColumn(name) {
    const iso = ISO_RE.exec(name);
    if (iso) {
      const y = +iso[1], t = new Date(Date.UTC(y, +iso[2] - 1, +iso[3]));
      return y >= 2000 && y <= 2100 && t.toISOString().slice(0, 10) === name;
    }
    const m = LEGACY_RE.exec(name);
    return !!m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= DAYS_IN_MONTH[+m[1] - 1];
  }
  const isValidAttendance = v => v === undefined || v === null || v === '' || ATTENDANCE_VALUES.includes(v);

  // 設定表分組，跟搬資料的腳本 tools/firebase/migrate.cjs 同一套
  function configBucket(key) {
    const snap = /^snapshot_(\d{4}-\d{2})/.exec(key);
    return snap ? 'snapshot_' + snap[1] : key.split('_')[0];
  }

  // ── 即時資料：只有第一次讀整張，之後只收有變動的那幾筆，省讀取額度 ──
  function failover(reason) {
    if (!live.failover) console.warn('[firebase] 這次開啟改走原後端：', reason);
    live.failover = true;
  }

  function attachBeds(name) {
    if (live.unsubBeds) live.unsubBeds();
    if (live.unsubMeta) live.unsubMeta();
    live.beds = new Map();
    live.bedsReady = false;
    const semRef = db.collection('semesters').doc(name);
    live.unsubMeta = semRef.onSnapshot(snap => {
      if (!snap.exists) return;
      countUsage('reads');
      live.semesterMeta = snap.data();
      live.dateColumns = (live.semesterMeta.dateColumns || []).slice().sort((a, b) => parseDateCol(a) - parseDateCol(b));
    }, err => failover('學期資料 ' + err.code));
    live.unsubBeds = semRef.collection('beds').onSnapshot({ includeMetadataChanges: false }, snap => {
      countServerDocs(snap);
      for (const ch of snap.docChanges()) {
        const id = ch.doc.id;
        const before = live.beds.get(id);
        if (ch.type === 'removed') { live.beds.delete(id); live.attTs = Date.now(); continue; }
        const data = ch.doc.data();
        live.beds.set(id, data);
        // 自己這台剛寫的不用廣播；別台改的記下來，下一次 poll 馬上套到畫面
        if (!live.bedsReady || ch.doc.metadata.hasPendingWrites || !before) continue;
        const a = before.attendance || {}, b = data.attendance || {};
        for (const d of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if ((a[d] || '') !== (b[d] || '')) live.changes.push({ seq: ++live.seq, id, d, v: b[d] || '' });
        }
        live.attTs = Date.now();
      }
      if (live.changes.length > CHANGE_LOG_MAX) live.changes.splice(0, live.changes.length - CHANGE_LOG_MAX);
      const wasReady = live.bedsReady;
      live.bedsReady = true;
      if (wasReady) notifyRemoteChange();
    }, err => failover('總表 ' + err.code));
  }

  function attachListeners() {
    db.collection('config').onSnapshot(snap => {
      countServerDocs(snap);
      const today = 'confirm_' + localToday();
      const remoteChange = live.configReady && snap.docChanges().some(ch => !ch.doc.metadata.hasPendingWrites);
      const before = live.config[today];
      const merged = {};
      snap.forEach(doc => Object.assign(merged, doc.data().entries || {}));
      live.config = merged;
      if (live.configReady && before !== merged[today]) { live.confirmTs = Date.now(); notifyRemoteChange(); }
      if (remoteChange) { live.attTs = Date.now(); notifyRemoteChange(); } // 別台改了晚歸等設定
      live.configReady = true;
    }, err => failover('設定 ' + err.code));
    db.collection('remarks').onSnapshot(snap => {
      countServerDocs(snap);
      const remoteChange = live.remarksReady && snap.docChanges().some(ch => !ch.doc.metadata.hasPendingWrites);
      const map = {};
      snap.forEach(doc => { if (doc.data().text) map[doc.id] = doc.data().text; });
      live.remarks = map;
      live.remarksReady = true;
      if (remoteChange) { live.attTs = Date.now(); notifyRemoteChange(); }
    }, err => failover('備註 ' + err.code));
    db.collection('system').doc('semester').onSnapshot(snap => {
      countUsage('reads');
      if (!snap.exists) { failover('沒有學期資料'); return; }
      const next = snap.data();
      const name = next.current && next.current.name;
      const changed = !live.semester || live.semester.current.name !== name;
      live.semester = next;
      if (changed) attachBeds(name);
    }, err => failover('學期 ' + err.code));
  }

  const ready = (async () => {
    await withTimeout(firebase.auth().signInAnonymously(), READY_TIMEOUT_MS, '登入');
    attachListeners();
    const until = Date.now() + READY_TIMEOUT_MS;
    while (!(live.bedsReady && live.configReady && live.remarksReady && live.semesterMeta)) {
      if (live.failover) throw new Error('連線失敗');
      if (Date.now() > until) throw new Error('第一次讀取逾時');
      await sleep(30);
    }
  })().catch(err => {
    failover(err.message);
    if (err.message !== '第一次讀取逾時') return;
    const timer = setInterval(() => {
      if (!(live.bedsReady && live.configReady && live.remarksReady && live.semesterMeta)) return;
      clearInterval(timer);
      live.failover = false;
      console.warn('[firebase] 資料到齊，切回 Firebase');
    }, 500);
  });

  // ── 組回原後端的回應格式 ──
  function bedToStudent(doc) {
    const student = {};
    for (const k of BED_FIELDS) student[k] = doc[k];
    student.attendance = {};
    for (const d of live.dateColumns) {
      if (doc.attendance && doc.attendance[d]) student.attendance[d] = doc.attendance[d];
    }
    return student;
  }
  const rosterResponse = () => ({
    students: [...live.beds.values()].sort((a, b) => (a.order || 0) - (b.order || 0)).map(bedToStudent),
    dateColumns: live.dateColumns,
    semester: { name: live.semesterMeta.name, start: live.semesterMeta.start, end: live.semesterMeta.end, isCurrent: live.semesterMeta.isCurrent },
  });
  async function archivedRoster(name) {
    const semRef = db.collection('semesters').doc(name);
    const meta = (await semRef.get()).data();
    if (!meta) throw new Error('找不到封存學期');
    const snap = await semRef.collection('beds').orderBy('order').get();
    countUsage('reads', snap.size + 1);
    const dates = (meta.dateColumns || []).slice().sort((a, b) => parseDateCol(a) - parseDateCol(b));
    return {
      students: snap.docs.map(d => {
        const s = {}; const data = d.data();
        for (const k of BED_FIELDS) s[k] = data[k];
        s.attendance = {};
        for (const date of dates) if (data.attendance && data.attendance[date]) s.attendance[date] = data.attendance[date];
        return s;
      }),
      dateColumns: dates,
      semester: { name: meta.name, start: meta.start, end: meta.end, isCurrent: false },
    };
  }
  async function listRecords(coll, timeField) {
    const snap = await db.collection(coll).get();
    countUsage('reads', snap.size);
    return snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => {
      const t = String(b[timeField] || '').localeCompare(String(a[timeField] || ''));
      return t || (a.order || 0) - (b.order || 0);
    }).map(({ order, ...r }) => r);
  }

  // ── 靜默寫回 Notion：排隊一筆一筆送，關掉 APP 下次開再送，使用者完全不用等 ──
  let memoryOnly = [];
  const readQueue = () => { try { return JSON.parse(localStorage.getItem(MIRROR_KEY) || '[]'); } catch { return []; } };
  const saveQueue = q => { try { localStorage.setItem(MIRROR_KEY, JSON.stringify(q)); return true; } catch { return false; } };
  function enqueueMirror(item) {
    if (live.failover) return; // 這次開啟直接寫原後端，不用再寫回一次
    item.qid = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    item.tries = 0;
    const q = readQueue();
    q.push(item);
    if (!saveQueue(q)) memoryOnly.push(item); // 照片太大存不進本機就只留記憶體
    pumpMirror();
  }

  // 每台裝置各自排隊寫回，到達順序不一定：A 先改、B 後改，A 卻晚送到，Notion 就會留下舊值。
  // 所以點名送出前一律換成 Firebase 現在的值，不管誰先到，最後都會跟 Firebase 一樣。
  function latestAttendanceBody(body) {
    if (!live.bedsReady || live.failover) return body;
    const data = JSON.parse(body);
    const current = (pageId, date, queued) => {
      const bed = live.beds.get(pageId);
      return bed ? ((bed.attendance || {})[date] || '') : queued;
    };
    for (const u of data.updates || []) {
      if (u.date) u.value = current(u.pageId, u.date, u.value);
      if (u.dates) for (const d of Object.keys(u.dates)) u.dates[d] = current(u.pageId, d, u.dates[d]);
    }
    return JSON.stringify(data);
  }

  async function sendMirror(item) {
    let body = item.path === '/api/attendance' ? latestAttendanceBody(item.body) : item.body;
    if (item.match) {
      // 搬過來之後才新增的紀錄，Notion 的編號不一樣，用內容找到同一筆再刪
      const list = await (await realFetch(WORKER + item.path)).json();
      const found = (Array.isArray(list) ? list : []).find(r => Object.entries(item.match).every(([k, v]) => r[k] === v));
      if (!found) return;
      body = JSON.stringify({ id: found.id });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
    try {
      const res = await realFetch(WORKER + item.path, {
        method: item.method, headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);
    } finally { clearTimeout(timer); }
  }

  function reportMirrorFailure(item, err) {
    console.warn('[firebase] 寫回 Notion 放棄：', item.path, err.message);
    db.collection('mirror_failures').add({
      path: item.path, method: item.method, body: String(item.body || '').slice(0, 2000), error: String(err.message).slice(0, 500), at: new Date().toISOString(),
    }).catch(() => {});
  }

  let pumping = false;
  async function pumpMirrorOnce() {
    for (;;) {
      const next = memoryOnly[0] || readQueue()[0];
      if (!next) return;
      try {
        await sendMirror(next);
      } catch (err) {
        next.tries++;
        if (next.tries < MIRROR_MAX_TRIES) {
          const q = readQueue();
          const stored = q.find(i => i.qid === next.qid);
          if (stored) { stored.tries = next.tries; saveQueue(q); }
          setTimeout(pumpMirror, Math.min(300000, 5000 * 2 ** Math.min(next.tries, 6)));
          return;
        }
        reportMirrorFailure(next, err);
      }
      if (memoryOnly[0] && memoryOnly[0].qid === next.qid) memoryOnly.shift();
      else saveQueue(readQueue().filter(i => i.qid !== next.qid));
    }
  }
  function pumpMirror() {
    if (pumping) return;
    pumping = true;
    // 多個分頁同時開時，只讓一個分頁送，不會重複寫
    const run = () => pumpMirrorOnce().catch(e => console.warn('[firebase] 寫回 Notion 暫停：', e.message));
    const done = navigator.locks ? navigator.locks.request('biyuan-notion-mirror', run) : run();
    Promise.resolve(done).finally(() => { pumping = false; });
  }
  async function flushMirror(maxMs) {
    const until = Date.now() + maxMs;
    pumpMirror();
    while ((memoryOnly.length || readQueue().length) && Date.now() < until) await sleep(300);
  }
  window.addEventListener('online', pumpMirror);

  // ── 寫入 ──
  async function writeAttendance({ updates }) {
    if (!updates || !updates.length) throw new Error('缺少 updates');
    const batch = db.batch();
    const beds = db.collection('semesters').doc(live.semester.current.name).collection('beds');
    const errors = [];
    const newDates = new Set();
    let updated = 0;
    for (const u of updates) {
      try {
        if (!u || typeof u !== 'object' || !u.pageId) throw new Error('缺少 pageId');
        const args = [];
        const setDate = (date, value) => {
          if (!isValidDateColumn(date)) throw new Error(`日期欄位名稱不合法：${date}`);
          if (!isValidAttendance(value)) throw new Error(`狀態值不合法：${value}`);
          if (!live.dateColumns.includes(date)) newDates.add(date);
          args.push(new FieldPath('attendance', date), value ? value : FieldValue.delete());
        };
        if (u.dates && typeof u.dates === 'object') for (const [d, v] of Object.entries(u.dates)) setDate(d, v);
        else if (u.date) setDate(u.date, u.value);
        const put = (field, value) => args.push(field, value);
        if (u.markEmpty !== undefined) put('isEmpty', !!u.markEmpty);
        if (u.clearProfile) {
          put('name', ''); put('class', ''); put('studentId', ''); put('phone', ''); put('address', ''); put('isForeign', false);
        }
        if (u.updateProfile) {
          const p = u.updateProfile;
          // 同一筆同時有清除和更新時以更新為準 (Firestore 同一欄不能寫兩次)
          for (let i = args.length - 2; i >= 0; i -= 2) if (typeof args[i] === 'string') args.splice(i, 2);
          put('name', p.name || ''); put('class', p.class || ''); put('studentId', p.studentId || '');
          if (p.phone !== undefined) put('phone', p.phone || '');
          if (p.address !== undefined) put('address', p.address || '');
          put('isForeign', !!p.isForeign); put('isEmpty', false);
        }
        if (args.length) batch.update(beds.doc(u.pageId), ...args);
        updated++;
      } catch (err) {
        errors.push({ pageId: u && u.pageId, error: err.message });
      }
    }
    const addedColumns = [...newDates];
    if (addedColumns.length) {
      batch.update(db.collection('semesters').doc(live.semester.current.name), { dateColumns: FieldValue.arrayUnion(...addedColumns) });
      batch.update(db.collection('system').doc('semester'), { dateColumns: FieldValue.arrayUnion(...addedColumns) });
    }
    await withTimeout(batch.commit(), WRITE_TIMEOUT_MS, '寫入');
    countUsage('writes', updated + addedColumns.length * 2);
    countUsage('reads', updated + addedColumns.length * 2);
    const result = { success: errors.length === 0, updated, errors, addedColumns };
    if (errors.length) result.error = `${errors.length} 筆更新失敗：${errors[0].error}`;
    return result;
  }

  async function writeConfig(data) {
    const batch = db.batch();
    const results = {};
    for (const [key, value] of Object.entries(data)) {
      batch.set(db.collection('config').doc(configBucket(key)), { entries: { [key]: value } }, { merge: true });
      results[key] = key in live.config ? 'updated' : 'created';
    }
    await withTimeout(batch.commit(), WRITE_TIMEOUT_MS, '寫入');
    countUsage('writes', Object.keys(data).length);
    countUsage('reads', Object.keys(data).length);
    return { success: true, results };
  }

  // 點名回報：交易內讀最新值再加/減，兩隊同時按也不會互相蓋掉
  async function writeConfirm({ date, squad, confirmed }) {
    if (!date || !squad) throw new Error('缺少 date 或 squad');
    if (typeof squad !== 'string' || squad.includes('_') || squad.includes(',')) throw new Error('squad 格式不正確');
    const key = 'confirm_' + date;
    const ref = db.collection('config').doc(configBucket(key));
    const list = await withTimeout(db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const set = new Set(String(((snap.data() || {}).entries || {})[key] || '').split(',').filter(Boolean));
      if (confirmed) set.add(squad); else set.delete(squad);
      const ordered = SQUAD_ORDER.filter(s => set.has(s)).concat([...set].filter(s => !SQUAD_ORDER.includes(s)));
      tx.set(ref, { entries: { [key]: ordered.join(',') } }, { merge: true });
      return ordered;
    }), WRITE_TIMEOUT_MS, '寫入');
    countUsage('writes'); countUsage('reads', 2);
    return { result: { success: true, confirms: list }, mirror: { path: '/api/config', body: { [key]: list.join(',') } } };
  }

  async function writeSwap({ pageIdA, pageIdB }) {
    if (!pageIdA || !pageIdB) throw new Error('缺少 pageIdA 或 pageIdB');
    if (pageIdA === pageIdB) throw new Error('不能跟自己交換');
    const beds = db.collection('semesters').doc(live.semester.current.name).collection('beds');
    await withTimeout(db.runTransaction(async tx => {
      const [a, b] = await Promise.all([tx.get(beds.doc(pageIdA)), tx.get(beds.doc(pageIdB))]);
      if (!a.exists || !b.exists) throw new Error('找不到床位');
      const pick = d => Object.fromEntries(SWAP_FIELDS.map(k => [k, d[k] === undefined ? '' : d[k]]));
      tx.update(beds.doc(pageIdA), pick(b.data()));
      tx.update(beds.doc(pageIdB), pick(a.data()));
    }), WRITE_TIMEOUT_MS, '換床');
    countUsage('writes', 2); countUsage('reads', 4);
    return { success: true, message: '床位資料已完整交換' };
  }

  async function writeRemark({ pageId, remark }) {
    const ref = db.collection('remarks').doc(pageId);
    await withTimeout(remark ? ref.set({ text: remark }) : ref.delete(), WRITE_TIMEOUT_MS, '寫入');
    countUsage(remark ? 'writes' : 'deletes'); countUsage('reads');
    return { success: true };
  }

  async function addRecord(coll, doc) {
    await withTimeout(db.collection(coll).add({ ...doc, createdAt: new Date().toISOString() }), WRITE_TIMEOUT_MS, '寫入');
    countUsage('writes');
    return { success: true };
  }

  async function deleteRecord(coll, id, path, matchFields) {
    if (!id) throw new Error('缺少紀錄 ID');
    const ref = db.collection(coll).doc(id);
    const snap = await ref.get();
    const data = snap.data() || {};
    await withTimeout(ref.delete(), WRITE_TIMEOUT_MS, '寫入');
    countUsage('deletes'); countUsage('reads');
    // 搬過來的舊紀錄編號跟 Notion 一樣；之後新增的要用內容比對
    const match = data.order === undefined ? Object.fromEntries(matchFields.map(k => [k, data[k]])) : null;
    enqueueMirror({ path, method: 'DELETE', body: JSON.stringify({ id }), match });
    return { success: true };
  }

  async function leaveRecords(url) {
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    const name = String(url.searchParams.get('name') || '').trim().slice(0, 50);
    const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    let rows = await listRecords('leave_records', 'createdAt');
    if (isDay(from) && isDay(to)) {
      const start = Date.parse(`${from}T00:00:00+08:00`), end = Date.parse(`${to}T00:00:00+08:00`) + 86400000;
      rows = rows.filter(r => { const t = Date.parse(r.createdAt); return t >= start && t < end; });
    }
    if (name) rows = rows.filter(r => String(r.name || '').includes(name));
    return rows;
  }

  // ── 少用的管理動作 (匯入、學期)：牽涉 Notion 建新表，維持由原後端做，做完把結果複製回 Firebase ──
  let resyncTimer = null, resyncPromise = null;
  async function resyncFromNotion() {
    const [roster, semester] = await Promise.all([
      realFetch(WORKER + '/api/roster').then(r => r.json()),
      realFetch(WORKER + '/api/semester').then(r => r.json()),
    ]);
    if (!roster.students || !roster.semester) throw new Error('原後端回應不完整');
    const semRef = db.collection('semesters').doc(roster.semester.name);
    const writes = roster.students.map((s, order) => b => b.set(semRef.collection('beds').doc(s.id), { ...s, order }));
    writes.push(b => b.set(semRef, { ...roster.semester, dateColumns: roster.dateColumns }));
    writes.push(b => b.set(db.collection('system').doc('semester'), semester));
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach(w => w(batch));
      await batch.commit();
    }
    countUsage('writes', writes.length);
    // 學期換了就等新的總表到齊
    const until = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < until && !(live.bedsReady && live.semester && live.semester.current.name === roster.semester.name)) await sleep(50);
  }
  function scheduleResync() {
    clearTimeout(resyncTimer);
    resyncPromise = new Promise((resolve, reject) => {
      resyncTimer = setTimeout(() => sleep(1500).then(resyncFromNotion).then(resolve, reject), 300);
    }).catch(err => { failover('複製回 Firebase 失敗：' + err.message); });
  }

  // ── 路由 ──
  async function handle(request, url) {
    const path = url.pathname, method = request.method;
    const body = async () => JSON.parse(await request.clone().text() || '{}');
    const mirrored = (result, data) => { enqueueMirror({ path, method, body: JSON.stringify(data) }); return jsonResponse(result); };

    if (method === 'GET') {
      if (path === '/api/poll') {
        const since = Number(url.searchParams.get('since'));
        const today = localToday();
        return jsonResponse({
          seq: live.seq,
          changes: Number.isFinite(since) ? live.changes.filter(c => c.seq > since).map(({ id, d, v }) => ({ id, d, v })) : [],
          ts: live.confirmTs, date: today, confirms: live.config['confirm_' + today] || '', att_ts: live.attTs,
        });
      }
      if (path === '/api/roster') {
        if (resyncPromise) await resyncPromise;
        const name = url.searchParams.get('semester') || '';
        if (name && name !== live.semester.current.name) return jsonResponse(await archivedRoster(name));
        return jsonResponse(rosterResponse());
      }
      if (path === '/api/semester') {
        if (resyncPromise) await resyncPromise;
        return jsonResponse({ ...live.semester, dateColumns: live.dateColumns });
      }
      if (path === '/api/config') return jsonResponse(live.config);
      if (path === '/api/remarks') return jsonResponse(live.remarks);
      if (path === '/api/changelog') return jsonResponse(await listRecords('changelog', 'time'));
      if (path === '/api/leave-records') return jsonResponse(await leaveRecords(url));
      if (path === '/api/repair-records') return jsonResponse(await listRecords('repair_records', 'createdAt'));
      if (path === '/api/feedback-records') return jsonResponse(await listRecords('feedback_records', 'createdAt'));
      return null;
    }

    if (path === '/api/attendance' && method === 'PATCH') { const d = await body(); return mirrored(await writeAttendance(d), d); }
    if (path === '/api/config' && method === 'POST') { const d = await body(); return mirrored(await writeConfig(d), d); }
    if (path === '/api/swap-beds' && method === 'POST') { const d = await body(); return mirrored(await writeSwap(d), d); }
    if (path === '/api/remarks' && method === 'POST') { const d = await body(); return mirrored(await writeRemark(d), d); }
    if (path === '/api/confirm' && method === 'POST') {
      const { result, mirror } = await writeConfirm(await body());
      enqueueMirror({ path: mirror.path, method: 'POST', body: JSON.stringify(mirror.body) });
      return jsonResponse(result);
    }
    if (path === '/api/changelog' && method === 'POST') {
      const d = await body();
      if (!d.content) throw new Error('缺少 content');
      const ref = await withTimeout(db.collection('changelog').add({ content: String(d.content), time: new Date().toISOString() }), WRITE_TIMEOUT_MS, '寫入');
      countUsage('writes');
      return mirrored({ success: true, id: ref.id }, d);
    }
    if (path === '/api/leave-records' && method === 'POST') {
      const d = await body();
      const callerPhone = String(d.callerPhone || '').trim().slice(0, 40), callerNote = String(d.callerNote || '').trim().slice(0, 500);
      return mirrored(await addRecord('leave_records', {
        title: `${d.name} 的請假申請`, name: d.name || '', roomBed: d.roomBed || '', dateStart: d.dateStart || '', dateEnd: d.dateEnd || '', handler: d.handler || '', callerPhone, callerNote,
      }), d);
    }
    if (path === '/api/repair-records' && method === 'POST') {
      const d = await body();
      if (!d.reason) throw new Error('缺少報修原因');
      return mirrored(await addRecord('repair_records', {
        reporter: d.reporter || '', title: `${d.reporter || '未知'} 的報修通知 ${taipeiDate()}`, reason: d.reason, photos: d.photos || [],
      }), d);
    }
    if (path === '/api/feedback-records' && method === 'POST') {
      const d = await body();
      if (!d.content) throw new Error('缺少回饋內容');
      return mirrored(await addRecord('feedback_records', { name: d.name || '匿名', content: d.content, photos: d.photos || [] }), d);
    }
    if (path === '/api/repair-records' && method === 'DELETE') return jsonResponse(await deleteRecord('repair_records', (await body()).id, path, ['reporter', 'reason']));
    if (path === '/api/feedback-records' && method === 'DELETE') return jsonResponse(await deleteRecord('feedback_records', (await body()).id, path, ['name', 'content']));
    return null;
  }

  const ADMIN_PATHS = ['/api/import-batch', '/api/init-db', '/api/semester/dates', '/api/semester/archive'];

  window.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : input.url;
    if (!href || !href.startsWith(WORKER + '/')) return realFetch(input, init);
    const url = new URL(href);
    const request = new Request(href, init);

    await ready;
    if (live.failover) {
      const res = await realFetch(input, init);
      // 改走原後端時也盡量寫一份到 Firebase，別台才看得到；失敗就算了，Notion 已經有了
      if (res.ok && request.method !== 'GET' && live.semester && !ADMIN_PATHS.includes(url.pathname)) handle(request, url).catch(() => {});
      return res;
    }

    if (ADMIN_PATHS.includes(url.pathname)) {
      await flushMirror(60000); // 先把排隊的寫回 Notion，複製回來才不會蓋掉新資料
      const res = await realFetch(input, init);
      if (res.ok) scheduleResync();
      return res;
    }
    try {
      const res = await handle(request, url);
      return res || realFetch(input, init);
    } catch (err) {
      // 資料驗證錯誤照原後端回報；Firebase 本身出問題就改走原後端，使用者不會發現
      if (err && err.code === undefined && !/逾時/.test(err.message)) return jsonResponse({ error: err.message }, 500);
      if (url.pathname === '/api/poll') throw err;
      console.warn('[firebase] 操作失敗，改走原後端：', url.pathname, err.message);
      const res = await realFetch(input, init);
      failover(err.message);
      return res;
    }
  };

  window._firebaseBackend = { live, ready, getUsage, pumpMirror, flushMirror, mirrorQueue: () => readQueue().length + memoryOnly.length };
  pumpMirror();
})();
