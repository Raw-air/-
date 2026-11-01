// 從 Firestore 讀回全部資料，組回後端 API 的格式，跟備份逐欄比對。組回來的 JSON 存到 <輸出資料夾>。
// 用法：node verify.cjs <備份資料夾> <輸出資料夾>
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { accessToken, PROJECT } = require('./auth.cjs');
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API = 'https://firestore.googleapis.com/v1/';

const fromValue = v => {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  throw new Error('不認識的欄位型別 ' + JSON.stringify(v).slice(0, 80));
};
const fromFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

let reads = 0;
async function get(url) {
  const res = await fetch(API + url, { headers: { Authorization: 'Bearer ' + accessToken(), 'x-goog-user-project': PROJECT } });
  if (!res.ok) throw new Error(`GET ${url} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function list(coll) {
  const out = [];
  let token = '';
  do {
    const j = await get(`${ROOT}/${coll}?pageSize=300${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
    for (const d of j.documents || []) { reads++; out.push({ id: d.name.split('/').pop(), ...fromFields(d.fields || {}) }); }
    token = j.nextPageToken || '';
  } while (token);
  return out;
}
const one = async p => { reads++; return fromFields((await get(`${ROOT}/${p}`)).fields || {}); };
const stripOrder = rows => rows.sort((a, b) => a.order - b.order).map(({ order, ...r }) => r);
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));

(async () => {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) throw new Error('要給備份資料夾和輸出資料夾');
  fs.mkdirSync(out, { recursive: true });
  const backup = n => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8'));
  const rebuilt = {};

  rebuilt.semester = await one('system/semester');
  rebuilt.poll = await one('system/poll');

  const orig = backup('roster');
  const name = orig.semester.name;
  const sem = await one(`semesters/${encodeURIComponent(name)}`);
  const beds = stripOrder(await list(`semesters/${encodeURIComponent(name)}/beds`));
  // 欄位順序照後端原本輸出，日期照 dateColumns 排
  const fields = ['id', 'name', 'room', 'bed', 'class', 'studentId', 'phone', 'address', 'squad', 'isForeign', 'isEmpty'];
  rebuilt.roster = {
    students: beds.map(s => {
      const attendance = {};
      for (const d of sem.dateColumns) if (s.attendance && d in s.attendance) attendance[d] = s.attendance[d];
      return { ...pick(s, fields), attendance };
    }),
    dateColumns: sem.dateColumns,
    semester: pick(sem, ['name', 'start', 'end', 'isCurrent']),
  };

  rebuilt.config = {};
  for (const b of await list('config')) Object.assign(rebuilt.config, b.entries);
  rebuilt.remarks = {};
  for (const r of await list('remarks')) rebuilt.remarks[r.id] = r.text;
  for (const c of ['changelog', 'leave_records', 'repair_records', 'feedback_records']) rebuilt[c] = stripOrder(await list(c));

  const results = [];
  for (const [n, data] of Object.entries(rebuilt)) {
    fs.writeFileSync(path.join(out, n + '.json'), JSON.stringify(data));
    const source = backup(n);
    assert.deepStrictEqual(data, source, `${n} 跟備份不一樣`);
    results.push([n, Array.isArray(source) ? source.length : Object.keys(source).length, JSON.stringify(data) === JSON.stringify(source) ? '逐字相同' : '內容相同 (順序不同)']);
  }
  const att = orig.students.reduce((sum, s) => sum + Object.keys(s.attendance || {}).length, 0);
  for (const r of results) console.log(r.join('\t'));
  console.log(`點名格數 ${att}、Firestore 讀取 ${reads} 筆文件，全部相符`);
})().catch(e => { console.error(e.message.slice(0, 1500)); process.exit(1); });
