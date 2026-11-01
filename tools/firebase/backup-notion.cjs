// 從線上後端把全部資料存成 JSON (只有 GET，不改 Notion)。用法：node backup-notion.cjs <輸出資料夾>
const fs = require('fs'), path = require('path');
const BASE = 'https://biyuan-proxy.s010828.workers.dev';
const DORM = 'https://dorm-api.s010828.workers.dev';
const out = process.argv[2];
if (!out) { console.error('要給輸出資料夾'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

async function save(name, url) {
  for (let attempt = 1; ; attempt++) {
    const t = Date.now();
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok && attempt < 3) continue;
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    JSON.parse(text); // 不是完整 JSON 就直接失敗，不留壞備份
    fs.writeFileSync(path.join(out, name + '.json'), text);
    console.log(name, res.status, text.length + 'B', (Date.now() - t) + 'ms');
    return JSON.parse(text);
  }
}

(async () => {
  const semester = await save('semester', `${BASE}/api/semester`);
  await save('roster', `${BASE}/api/roster`);
  for (const a of semester.archives || []) await save('roster_' + encodeURIComponent(a.name), `${BASE}/api/roster?semester=${encodeURIComponent(a.name)}`);
  await save('config', `${BASE}/api/config`);
  await save('changelog', `${BASE}/api/changelog`);
  await save('leave_records', `${BASE}/api/leave-records`);
  await save('repair_records', `${BASE}/api/repair-records`);
  await save('feedback_records', `${BASE}/api/feedback-records`);
  await save('remarks', `${BASE}/api/remarks`);
  await save('poll', `${BASE}/api/poll`);
  // 舊的第二後端，前端已經不用，只留備份看裡面有沒有東西
  for (const p of ['leave-records', 'repair-records', 'feedback-records']) {
    await save('dorm_' + p.replace('-', '_'), `${DORM}/api/${p}`).catch(e => console.log('dorm', p, e.message));
  }
})().catch(e => { console.error(e); process.exit(1); });
