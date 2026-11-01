// 把備份 JSON 搬進 Firestore (可重跑：同 ID 覆蓋，來源已沒有的文件會刪掉)。不會碰 Notion。
// 用法：node migrate.cjs <備份資料夾>
const fs = require('fs'), path = require('path');
const { accessToken, PROJECT } = require('./auth.cjs');
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API = 'https://firestore.googleapis.com/v1/';
const MAX_DOC = 1000000;        // Firestore 單筆上限 1 MiB，留一點餘裕
const MAX_BATCH_BYTES = 8e6;    // 單次請求上限 10 MiB
const MAX_BATCH_DOCS = 200;

const toValue = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
};
const toFields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

// 設定表分組：快照按月份一份，其他按前綴一份，一次讀十幾筆就夠
function configBucket(key) {
  const snap = /^snapshot_(\d{4}-\d{2})/.exec(key);
  if (snap) return 'snapshot_' + snap[1];
  return key.split('_')[0];
}

// 備份 → 要寫進 Firestore 的文件清單 ({ 路徑: 內容 })
function buildDocs(dir) {
  const read = n => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8'));
  const docs = {};
  const semester = read('semester');
  docs['system/semester'] = semester;
  docs['system/poll'] = read('poll');

  const roster = read('roster');
  const name = roster.semester.name;
  docs[`semesters/${name}`] = { ...roster.semester, dateColumns: roster.dateColumns };
  roster.students.forEach((s, order) => { docs[`semesters/${name}/beds/${s.id}`] = { ...s, order }; });
  if ((semester.archives || []).length) throw new Error('有封存學期，這份腳本要先補上封存學期的搬法');

  const config = read('config');
  const buckets = {};
  for (const [k, v] of Object.entries(config)) (buckets[configBucket(k)] = buckets[configBucket(k)] || {})[k] = v;
  for (const [b, entries] of Object.entries(buckets)) docs[`config/${b}`] = { entries };

  for (const [k, text] of Object.entries(read('remarks'))) docs[`remarks/${k}`] = { text };
  for (const coll of ['changelog', 'leave_records', 'repair_records', 'feedback_records']) {
    read(coll).forEach((r, order) => { docs[`${coll}/${r.id}`] = { ...r, order }; });
  }
  return docs;
}

async function call(method, url, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + url, {
      method,
      headers: { Authorization: 'Bearer ' + accessToken(), 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (attempt >= 5 || ![409, 429, 500, 502, 503, 504].includes(res.status)) throw new Error(`${method} ${url} ${res.status}: ${text.slice(0, 300)}`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
}

async function commit(writes) {
  let batch = [], size = 0, total = 0;
  const flush = async () => { if (!batch.length) return; await call('POST', `${ROOT}:commit`, { writes: batch }); total += batch.length; batch = []; size = 0; };
  for (const w of writes) {
    const bytes = Buffer.byteLength(JSON.stringify(w));
    if (batch.length >= MAX_BATCH_DOCS || size + bytes > MAX_BATCH_BYTES) await flush();
    batch.push(w); size += bytes;
  }
  await flush();
  return total;
}

async function listIds(parent, coll) {
  const ids = [];
  let token = '';
  do {
    const qs = `pageSize=300&mask.fieldPaths=order${token ? '&pageToken=' + encodeURIComponent(token) : ''}`;
    const j = await call('GET', `${ROOT}/${parent ? parent + '/' : ''}${encodeURIComponent(coll)}?${qs}`);
    for (const d of j.documents || []) ids.push(d.name.split('/').pop());
    token = j.nextPageToken || '';
  } while (token);
  return ids;
}

(async () => {
  const dir = process.argv[2];
  if (!dir) throw new Error('要給備份資料夾');
  const docs = buildDocs(dir);
  const paths = Object.keys(docs);
  for (const p of paths) {
    const bytes = Buffer.byteLength(JSON.stringify(docs[p]));
    if (bytes > MAX_DOC) throw new Error(`${p} 有 ${bytes} bytes，超過單筆上限`);
  }
  const writes = paths.map(p => ({ update: { name: `${ROOT}/${p}`, fields: toFields(docs[p]) } }));
  const written = await commit(writes);

  // 來源已經沒有的文件要刪掉，重跑才不會留舊資料
  const want = new Set(paths);
  const stale = [];
  const name = JSON.parse(fs.readFileSync(path.join(dir, 'roster.json'), 'utf8')).semester.name;
  for (const [parent, coll] of [['', 'system'], ['', 'semesters'], [`semesters/${name}`, 'beds'], ['', 'config'], ['', 'remarks'], ['', 'changelog'], ['', 'leave_records'], ['', 'repair_records'], ['', 'feedback_records']]) {
    for (const id of await listIds(parent, coll)) {
      const p = `${parent ? parent + '/' : ''}${coll}/${id}`;
      if (!want.has(p)) stale.push({ delete: `${ROOT}/${p}` });
    }
  }
  const removed = await commit(stale);
  const biggest = paths.map(p => [p, Buffer.byteLength(JSON.stringify(docs[p]))]).sort((a, b) => b[1] - a[1])[0];
  console.log(`寫入 ${written} 筆，刪除舊文件 ${removed} 筆，最大一筆 ${biggest[0]} = ${biggest[1]} bytes`);
})().catch(e => { console.error(e.message); process.exit(1); });
