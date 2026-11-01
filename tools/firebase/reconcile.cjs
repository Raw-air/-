// 比對線上 Notion 和 Firestore 哪裡不一樣 (只讀)。加 --apply 才把 Notion 的值寫進 Firestore，
// 用在切換當下還開著舊版的手機只寫到 Notion 的情況。寫回排隊中的資料 Firestore 會比較新，--apply 前先看清單。
// 用法：node reconcile.cjs [--apply]
const { accessToken, PROJECT } = require('./auth.cjs');
const WORKER = 'https://biyuan-proxy.s010828.workers.dev';
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API = 'https://firestore.googleapis.com/v1/';
const headers = () => ({ Authorization: 'Bearer ' + accessToken(), 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT });

const fromValue = v => {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return Object.fromEntries(Object.entries((v.mapValue || {}).fields || {}).map(([k, x]) => [k, fromValue(x)]));
};
async function list(coll) {
  const out = [];
  let token = '';
  do {
    const res = await fetch(`${API}${ROOT}/${coll}?pageSize=300${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { headers: headers() });
    if (!res.ok) throw new Error(`${coll} ${res.status}`);
    const j = await res.json();
    for (const d of j.documents || []) out.push({ id: d.name.split('/').pop(), _updateTime: d.updateTime, ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromValue(v)])) });
    token = j.nextPageToken || '';
  } while (token);
  return out;
}
const notion = async p => (await fetch(WORKER + p)).json();
const FIELDS = ['name', 'room', 'bed', 'class', 'studentId', 'phone', 'address', 'squad', 'isForeign', 'isEmpty'];
function configBucket(key) {
  const snap = /^snapshot_(\d{4}-\d{2})/.exec(key);
  return snap ? 'snapshot_' + snap[1] : key.split('_')[0];
}

(async () => {
  const apply = process.argv.includes('--apply');
  const roster = await notion('/api/roster');
  const name = encodeURIComponent(roster.semester.name);
  const beds = new Map((await list(`semesters/${name}/beds`)).map(b => [b.id, b]));
  const diffs = [], writes = [];
  let skipped = 0;
  for (const s of roster.students) {
    const b = beds.get(s.id);
    if (!b) { diffs.push(`床位 ${s.room}${s.bed} Firestore 沒有`); continue; }
    const fields = {}, paths = [];
    for (const f of FIELDS) if (s[f] !== b[f]) { diffs.push(`${s.room}${s.bed} ${f}: Notion=${s[f]} / Firebase=${b[f]}`); fields[f] = typeof s[f] === 'boolean' ? { booleanValue: s[f] } : { stringValue: s[f] || '' }; paths.push(f); }
    const a = s.attendance || {}, c = b.attendance || {};
    for (const d of new Set([...Object.keys(a), ...Object.keys(c)])) {
      if ((a[d] || '') === (c[d] || '')) continue;
      diffs.push(`${s.room}${s.bed} ${d}: Notion=${a[d] || '空'} / Firebase=${c[d] || '空'}`);
      fields.attendance = fields.attendance || { mapValue: { fields: {} } };
      if (a[d]) fields.attendance.mapValue.fields[d] = { stringValue: a[d] };
      paths.push(`attendance.\`${d}\``);
    }
    // 最近 10 分鐘改過的床位可能是 Firebase 比較新 (寫回還在排隊)，不准用 Notion 蓋掉
    if (paths.length && Date.now() - Date.parse(b._updateTime) < 600000) { skipped++; continue; }
    if (paths.length) writes.push({ update: { name: `${ROOT}/semesters/${name}/beds/${s.id}`, fields }, updateMask: { fieldPaths: paths } });
  }
  const nc = await notion('/api/config');
  const fc = {};
  for (const b of await list('config')) Object.assign(fc, b.entries);
  for (const k of new Set([...Object.keys(nc), ...Object.keys(fc)])) {
    if (nc[k] === fc[k] || nc[k] === undefined) { if (nc[k] === undefined) diffs.push(`設定 ${k}: 只有 Firebase 有`); continue; }
    diffs.push(`設定 ${k}: 內容不同 (Notion ${String(nc[k]).length} 字 / Firebase ${String(fc[k] ?? '').length} 字)`);
    if (fc[k] !== undefined) continue; // 兩邊都有就不知道誰新，只列出來不覆蓋
    writes.push({ update: { name: `${ROOT}/config/${configBucket(k)}`, fields: { entries: { mapValue: { fields: { [k]: { stringValue: nc[k] } } } } } }, updateMask: { fieldPaths: [`entries.\`${k}\``] } });
  }
  const nr = await notion('/api/remarks');
  const fr = Object.fromEntries((await list('remarks')).filter(r => r.text).map(r => [r.id, r.text]));
  for (const k of new Set([...Object.keys(nr), ...Object.keys(fr)])) if (nr[k] !== fr[k]) diffs.push(`備註 ${k}: 不同`);
  for (const [path, coll] of [['/api/leave-records', 'leave_records'], ['/api/repair-records', 'repair_records'], ['/api/feedback-records', 'feedback_records'], ['/api/changelog', 'changelog']]) {
    const n = (await notion(path)).length, f = (await list(coll)).length;
    if (n !== f) diffs.push(`${coll}: Notion ${n} 筆 / Firebase ${f} 筆`);
  }
  const failures = await fetch(`${API}${ROOT}/mirror_failures?pageSize=5`, { headers: headers() }).then(r => r.ok ? r.json() : {});
  console.log(`差異 ${diffs.length} 處；可自動套用 ${writes.length} 筆；太新不套用 ${skipped} 床；寫回放棄紀錄 ${(failures.documents || []).length} 筆`);
  for (const d of diffs.slice(0, 40)) console.log(' -', d);
  if (apply && writes.length) {
    for (let i = 0; i < writes.length; i += 200) {
      const res = await fetch(`${API}${ROOT}:commit`, { method: 'POST', headers: headers(), body: JSON.stringify({ writes: writes.slice(i, i + 200) }) });
      if (!res.ok) throw new Error(`commit ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    console.log(`已把 Notion 的值寫進 Firebase：${writes.length} 筆`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
