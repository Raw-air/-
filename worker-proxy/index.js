/**
 * 壁苑宿舍點名系統 - Cloudflare Worker v2
 * 以 CSV 總表為核心的簡化架構
 * 每個日期 = 一個 Notion Select 欄位
 */

// ─── CORS ──────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Notion API ────────────────────────────────────────────────────────────────
const NOTION_BASE = 'https://api.notion.com/v1';

// Notion 整個整合每秒只給約 3 個請求；很多人同時用時會回 429 (太忙) 或 409 (同時改同一頁)。
// 以前直接丟錯，點名/請假就這樣沒寫進去；現在照 Retry-After 等一下再試，最多 5 次。
const NOTION_RETRY_STATUS = new Set([409, 429, 500, 502, 503, 504]);
async function notion(path, method, body, env) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${NOTION_BASE}${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(600 * (attempt + 1));
      continue;
    }
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }
    if (res.ok) return data;
    // 建立新頁 (POST /pages) 除了 429 以外不重試：伺服器錯誤時可能其實建好了，重送會多一列
    const safeToRetry = res.status === 429 || method !== 'POST' || /\/query$/.test(path);
    if (attempt < 4 && safeToRetry && NOTION_RETRY_STATUS.has(res.status)) {
      const after = Number(res.headers && res.headers.get && res.headers.get('Retry-After'));
      const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 8000) : 500 * 2 ** attempt;
      await sleep(wait + Math.floor(Math.random() * 250));
      continue;
    }
    throw new Error(`Notion ${res.status}: ${JSON.stringify(data)}`);
  }
}

/** 查詢資料庫所有頁面（自動分頁） */
async function queryAll(dbId, filter, sorts, env) {
  const pages = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;
    const res = await notion(`/databases/${dbId}/query`, 'POST', body, env);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
    if (cursor) await sleep(340);
  } while (cursor);
  return pages;
}

// ─── 屬性讀取工具 ──────────────────────────────────────────────────────────────
function getTitle(prop) {
  return prop?.title?.[0]?.text?.content || '';
}
function getText(prop) {
  // 合併所有段落：長設定值 (例如學期狀態 JSON) 會被拆成多段 2000 字
  return (prop?.rich_text || []).map(t => t?.text?.content || t?.plain_text || '').join('');
}

/** Notion 單段 rich_text 最多 2000 字，超過就拆段 */
function richTextChunks(value) {
  const str = String(value == null ? '' : value);
  if (!str) return [];
  const chunks = [];
  for (let i = 0; i < str.length; i += 2000) chunks.push({ text: { content: str.slice(i, i + 2000) } });
  return chunks;
}
function getSelect(prop) {
  return prop?.select?.name || '';
}
function getCheckbox(prop) {
  return prop?.checkbox || false;
}

// ─── 固定欄位名稱 ──────────────────────────────────────────────────────────────
const FIXED_PROPS = ['姓名', '寢床號', '床號', '班別', '學號', '中隊', '外籍生', '空床'];
// 換床位時不能交換的屬性（物理位置）
const POSITION_PROPS = ['寢床號', '床號', '中隊'];

const ATTENDANCE_OPTIONS = [
  { name: '✓', color: 'green' },
  { name: '◎', color: 'orange' },
  { name: '✘', color: 'red' },
  { name: '△', color: 'yellow' },
];
const SQUAD_OPTIONS = [
  { name: '一單', color: 'purple' },
  { name: '一雙', color: 'pink' },
  { name: '二單', color: 'blue' },
  { name: '二雙', color: 'green' },
  { name: '三單', color: 'yellow' },
  { name: '三雙', color: 'orange' },
];

/** 總表固定欄位的 Notion schema (建新學期資料庫用) */
function masterFixedProperties() {
  return {
    '姓名': { title: {} },
    '寢床號': { rich_text: {} },
    '床號': { select: { options: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] } },
    '班別': { rich_text: {} },
    '學號': { rich_text: {} },
    '中隊': { select: { options: SQUAD_OPTIONS } },
    '外籍生': { checkbox: {} },
    '空床': { checkbox: {} },
    // 電話/住址：新學期表一開始就有，封存帶人過去時才寫得進去 (舊表沒有的話 ensureContactColumns 會補)
    '電話': { rich_text: {} },
    '住址': { rich_text: {} },
  };
}

/** 台灣時間 (+08:00) 的 YYYY-MM-DD；「今天」用途一律用這個，別用 toISOString (那是 UTC，台灣 00:00~07:59 會差一天) */
function taipeiDateString(ts) {
  return new Date((ts == null ? Date.now() : ts) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// ─── 日期欄位工具 ──────────────────────────────────────────────────────────────
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LEGACY_RE = /^(\d{1,2})月(\d{1,2})日$/;
const MAX_SEMESTER_DAYS = 400;

function parseISO(value) {
  const m = ISO_RE.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

/** 起迄 (含) 之間每一天的 ISO 字串；超過上限就丟錯 */
function isoRange(start, end) {
  const a = parseISO(start), b = parseISO(end);
  if (!a || !b) throw new Error('日期格式必須是 YYYY-MM-DD');
  if (a > b) throw new Error('結束日期不能早於開始日期');
  const days = Math.round((b - a) / 86400000) + 1;
  if (days > MAX_SEMESTER_DAYS) throw new Error(`學期最多 ${MAX_SEMESTER_DAYS} 天，目前是 ${days} 天`);
  const out = [];
  const cursor = new Date(a);
  for (let i = 0; i < days; i++) { out.push(toISO(cursor)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return out;
}

/** 是否為日期欄位名稱 (新式 2026-09-12 或舊式 9月12日) */
function isDateColumnName(name) {
  if (FIXED_PROPS.includes(name)) return false;
  return ISO_RE.test(name) || LEGACY_RE.test(name);
}

/** 在資料庫補上缺少的日期欄位 (select ✓◎✘△)；回傳新增的欄位名 */
async function ensureDateColumns(dbId, names, env, dbInfo) {
  const wanted = [...new Set((names || []).filter(isDateColumnName))];
  if (!wanted.length) return [];
  if (!dbInfo) { dbInfo = await notion(`/databases/${dbId}`, 'GET', null, env); await sleep(340); }
  const missing = wanted.filter(n => !dbInfo.properties[n]);
  for (let i = 0; i < missing.length; i += 60) {
    const properties = {};
    for (const n of missing.slice(i, i + 60)) properties[n] = { select: { options: ATTENDANCE_OPTIONS.map(o => ({ ...o })) } };
    await notion(`/databases/${dbId}`, 'PATCH', { properties }, env);
    await sleep(340);
  }
  return missing;
}

/** 確保總表有「電話」「住址」兩個文字欄位；沒有就自動補上（只在缺的時候動一次結構） */
const CONTACT_COLUMNS = ['電話', '住址'];
async function ensureContactColumns(dbId, env, dbInfo) {
  if (!dbInfo) { dbInfo = await notion(`/databases/${dbId}`, 'GET', null, env); await sleep(340); }
  const missing = CONTACT_COLUMNS.filter(n => !dbInfo.properties[n]);
  if (!missing.length) return [];
  const properties = {};
  for (const n of missing) properties[n] = { rich_text: {} };
  await notion(`/databases/${dbId}`, 'PATCH', { properties }, env);
  await sleep(340);
  return missing;
}

// ─── 學期狀態 (KV 為快取、系統設定資料庫為正本；都沒有就退回環境變數) ─────────
const SEMESTER_KEY = 'semester_state';

function normalizeSemesterState(raw, env) {
  const st = raw && typeof raw === 'object' ? raw : {};
  const cur = st.current && typeof st.current === 'object' ? st.current : {};
  return {
    current: {
      name: String(cur.name || ''),
      dbId: String(cur.dbId || env.MASTER_DB_ID || ''),
      start: parseISO(cur.start) ? cur.start : '',
      end: parseISO(cur.end) ? cur.end : '',
    },
    archives: Array.isArray(st.archives) ? st.archives.filter(a => a && a.dbId).map(a => ({
      name: String(a.name || ''), dbId: String(a.dbId), start: a.start || '', end: a.end || '', archivedAt: a.archivedAt || '',
    })) : [],
  };
}

async function getSemesterState(env) {
  let raw = null;
  if (env.POLL_KV) { try { raw = await env.POLL_KV.get(SEMESTER_KEY, 'json'); } catch (e) { console.error('KV read failed', e); } }
  if (!raw && env.CONFIG_DB_ID) {
    try {
      const cfg = await handleGetConfig(env);
      if (cfg[SEMESTER_KEY]) raw = JSON.parse(cfg[SEMESTER_KEY]);
      if (raw && env.POLL_KV) await env.POLL_KV.put(SEMESTER_KEY, JSON.stringify(raw));
    } catch (e) { console.error('config semester read failed', e); }
  }
  return normalizeSemesterState(raw, env);
}

async function saveSemesterState(state, env) {
  const st = normalizeSemesterState(state, env);
  const text = JSON.stringify(st);
  // 先寫 Notion 設定表 (正本)，成功後才寫 KV (快取)：Notion 失敗就直接丟錯、KV 維持原狀，
  // 不會出現「KV 指到新表、正本還是舊表」的半套狀態
  if (env.CONFIG_DB_ID) await handleSetConfig({ [SEMESTER_KEY]: text }, env);
  if (env.POLL_KV) await env.POLL_KV.put(SEMESTER_KEY, text);
  return st;
}

// 封存學期進行到一半的記號 (KV)：{ newName, newDbId, ts }。新表建好就記下來、學期切換成功才刪，
// 中途失敗重試時優先重用同一張新表，不會再建第二張孤兒表
const ARCHIVE_PENDING_KEY = 'archive_pending';
async function getArchivePending(env) {
  if (!env.POLL_KV) return null;
  try {
    const raw = await env.POLL_KV.get(ARCHIVE_PENDING_KEY, 'json');
    return raw && typeof raw === 'object' && raw.newDbId ? raw : null;
  } catch (e) { console.error('KV archive_pending read failed', e); return null; }
}

async function getMasterDbId(env) {
  const st = await getSemesterState(env);
  const id = st.current.dbId || env.MASTER_DB_ID;
  if (!id) throw new Error('MASTER_DB_ID 環境變數未設定');
  return id;
}

/** 依學期名稱找資料庫 (空字串或 current = 本學期) */
async function resolveSemesterDbId(name, env) {
  const st = await getSemesterState(env);
  if (!name || name === 'current' || name === st.current.name) return { dbId: st.current.dbId || env.MASTER_DB_ID, semester: st.current, isCurrent: true };
  const hit = st.archives.find(a => a.name === name || a.dbId === name);
  if (!hit) throw new Error(`找不到學期「${name}」`);
  return { dbId: hit.dbId, semester: hit, isCurrent: false };
}

// ─── KV 即時同步信號層 ─────────────────────────────────────────────────────────
// 出席變動與點名完成分開存兩個鍵：以前共用 poll_state「讀出來→改→寫回」，
// 點名 PATCH 同時發生時會把剛寫進去的 confirms 蓋回舊值，總表的「已回報」就一閃一閃。
// 即時同步中樞 (Durable Object)：KV 有兩個問題 —— 同一個鍵每秒只能寫 1 次 (大家同時點名會寫失敗、信號不見)，
// 以及不同機房之間最久要 60 秒才看得到新值。中樞是單一實體，寫完所有人馬上讀得到。
// 另外存「最近 300 筆點名變動」，別台裝置輪詢時直接拿變動套上去，不用再等整張總表 (約 4 秒) 從 Notion 抓回來。
const SYNC_MAX_CHANGES = 300;
export class SyncHub {
  constructor(ctx) {
    this.ctx = ctx;
    this.s = null;
  }
  async load() {
    if (!this.s) this.s = (await this.ctx.storage.get('s')) || { seq: 0, att_ts: 0, changes: [], conf: null };
    return this.s;
  }
  async fetch(request) {
    const s = await this.load();
    const url = new URL(request.url);
    if (request.method === 'POST') {
      const body = await request.json();
      if (Array.isArray(body.changes)) {
        for (const c of body.changes) s.changes.push({ q: ++s.seq, id: c.id, d: c.d, v: c.v || '' });
        if (s.changes.length > SYNC_MAX_CHANGES) s.changes.splice(0, s.changes.length - SYNC_MAX_CHANGES);
      }
      if (body.att_ts !== undefined) s.att_ts = Math.max(s.att_ts, body.att_ts);
      if (body.conf) s.conf = body.conf;
      await this.ctx.storage.put('s', s);
      return Response.json({ ok: true, seq: s.seq });
    }
    const since = Number(url.searchParams.get('since'));
    const out = { att_ts: s.att_ts, seq: s.seq, conf: s.conf };
    if (Number.isFinite(since) && since >= 0 && url.searchParams.has('since')) {
      const first = s.changes.length ? s.changes[0].q : s.seq + 1;
      // 落後太多 (中間的變動已經被擠掉) → 叫前端重抓整張總表
      if (since < first - 1 && since < s.seq) out.reset = true;
      else out.changes = s.changes.filter(c => c.q > since);
    }
    return Response.json(out);
  }
}
function syncHub(env) {
  if (!env.SYNC_HUB) return null;
  return env.SYNC_HUB.get(env.SYNC_HUB.idFromName('main'));
}
async function pushSync(env, body) {
  const hub = syncHub(env);
  if (!hub) return false;
  try {
    await hub.fetch('https://sync-hub/push', { method: 'POST', body: JSON.stringify(body) });
    return true;
  } catch (e) {
    console.error('SyncHub push failed:', e);
    return false;
  }
}
// 把 PATCH 內容轉成「哪張床、哪一天、改成什麼」
function attendanceChangesOf(updates) {
  const out = [];
  for (const u of (updates || []).slice(0, 45)) {
    if (!u || !u.pageId) continue;
    if (u.dates && typeof u.dates === 'object') {
      for (const [d, v] of Object.entries(u.dates)) if (isDateColumnName(d)) out.push({ id: u.pageId, d, v: v || '' });
    } else if (u.date && isDateColumnName(u.date)) {
      out.push({ id: u.pageId, d: u.date, v: u.value || '' });
    }
  }
  return out;
}

async function updatePollSignal(env, updates = {}) {
  const conf = updates.confirms !== undefined ? { ts: Date.now(), confirms: updates.confirms || '', date: updates.date || '' } : null;
  const hubOk = await pushSync(env, { att_ts: updates.att_ts, conf });
  if (!env.POLL_KV) return; // KV 未綁定時靜默跳過
  try {
    // 有中樞時出席信號不寫 KV (KV 每秒限寫 1 次，還會拖慢回應)
    if (updates.att_ts !== undefined && !hubOk) {
      await env.POLL_KV.put('poll_att', JSON.stringify({ att_ts: updates.att_ts }));
    }
    if (updates.confirms !== undefined) {
      await env.POLL_KV.put('poll_confirms', JSON.stringify({ ts: Date.now(), confirms: updates.confirms || '', date: updates.date || '' }));
    }
  } catch (e) {
    console.error('KV update failed:', e);
  }
}

async function readPollState(env, since) {
  const hub = syncHub(env);
  const hubRead = hub
    ? hub.fetch('https://sync-hub/read' + (since !== undefined && since !== null && since !== '' ? '?since=' + encodeURIComponent(since) : ''))
      .then(r => r.json()).catch(e => { console.error('SyncHub read failed:', e); return null; })
    : Promise.resolve(null);
  if (!env.POLL_KV) {
    const h = await hubRead;
    const out = { ts: 0, confirms: '', att_ts: 0 };
    if (h) Object.assign(out, h.conf || {}, { att_ts: h.att_ts, seq: h.seq }, h.changes ? { changes: h.changes } : {}, h.reset ? { reset: true } : {});
    delete out.conf;
    return out;
  }
  const [att, kvConf, legacy, h] = await Promise.all([
    env.POLL_KV.get('poll_att', 'json'),
    env.POLL_KV.get('poll_confirms', 'json'),
    env.POLL_KV.get('poll_state', 'json'),
    hubRead,
  ]);
  const old = legacy || {};
  // 點名完成回報：中樞與 KV 取比較新的那個 (剛換版時中樞還是空的)
  const conf = h && h.conf && (!kvConf || h.conf.ts >= kvConf.ts) ? h.conf : kvConf;
  const out = {
    ts: conf ? conf.ts : (old.ts || 0),
    confirms: conf ? conf.confirms : (old.confirms || ''),
    date: conf ? (conf.date || '') : '',
    att_ts: Math.max(att ? att.att_ts || 0 : 0, old.att_ts || 0, h ? h.att_ts || 0 : 0),
  };
  if (h) {
    out.seq = h.seq;
    if (h.changes) out.changes = h.changes;
    if (h.reset) out.reset = true;
  }
  return out;
}

// 總表快取 (Cloudflare 邊緣快取，不佔 KV 寫入額度)。
// 快取鍵含 att_ts：任何人寫入點名 att_ts 就變，舊快取自然作廢。
// 寫入後 3 秒內 Notion 查詢可能還讀到舊值，這段時間不存快取，免得把舊資料存起來。
const ROSTER_CACHE_SETTLE_MS = 3000;
function rosterCacheKey(dbId, attTs) {
  return new Request(`https://roster-cache.biyuan.internal/${encodeURIComponent(dbId)}/${attTs}`);
}
async function getRosterCached(env, dbId) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (!cache || !env.POLL_KV) return handleGetRoster(env, dbId);
  const { att_ts } = await readPollState(env);
  const key = rosterCacheKey(dbId, att_ts);
  try {
    const hit = await cache.match(key);
    if (hit) return await hit.json();
  } catch (e) { console.error('roster cache read failed', e); }
  const roster = await handleGetRoster(env, dbId);
  if (Date.now() - att_ts > ROSTER_CACHE_SETTLE_MS) {
    try {
      await cache.put(key, new Response(JSON.stringify(roster), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' },
      }));
    } catch (e) { console.error('roster cache write failed', e); }
  }
  return roster;
}

// ─── 路由 ──────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── 靜態頁面 ──
      if (path === '/' || path === '/setup') return new Response(getSetupHtml(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });

      // ── API ──
      if (path === '/api/ping') return json({ ok: true, time: new Date().toISOString() });

      // ⚡ 即時輪詢端點 — 僅讀取 KV，不觸碰 Notion，回應時間 < 5ms
      if (path === '/api/poll' && request.method === 'GET') {
        return json(await readPollState(env, url.searchParams.get('since')));
      }

      if (path === '/api/init-db' && request.method === 'POST') {
        const data = await request.json();
        return json(await handleInitDb(data, env));
      }

      if (path === '/api/import-batch' && request.method === 'POST') {
        const data = await request.json();
        const result = await handleImportBatch(data, env);
        await updatePollSignal(env, { att_ts: Date.now() });
        return json(result);
      }

      if (path === '/api/roster' && request.method === 'GET') {
        const semester = url.searchParams.get('semester') || '';
        const target = await resolveSemesterDbId(semester, env);
        const roster = target.isCurrent ? await getRosterCached(env, target.dbId) : await handleGetRoster(env, target.dbId);
        roster.semester = { name: target.semester.name, start: target.semester.start, end: target.semester.end, isCurrent: target.isCurrent };
        return json(roster);
      }

      // ── 學期管理 ──
      if (path === '/api/semester' && request.method === 'GET') {
        return json(await handleGetSemester(env));
      }
      if (path === '/api/semester/dates' && request.method === 'POST') {
        const data = await request.json();
        const result = await handleApplySemesterDates(data, env);
        if (result.success) await updatePollSignal(env, { att_ts: Date.now() });
        return json(result);
      }
      if (path === '/api/semester/archive' && request.method === 'POST') {
        const data = await request.json();
        const result = await handleArchiveSemester(data, env);
        await updatePollSignal(env, { att_ts: Date.now() });
        return json(result);
      }

      if (path === '/api/attendance' && request.method === 'PATCH') {
        const data = await request.json();
        // 先廣播再寫 Notion：一批 30 筆要寫十幾秒，以前寫完才通知，別台要等很久。
        // 萬一寫失敗，寫完後的 att_ts 會讓大家重抓總表校正回來。
        const changes = attendanceChangesOf(data && data.updates);
        if (changes.length) await pushSync(env, { changes });
        const result = await handleUpdateAttendance(data, env);
        // ⚡ 出席資料變更 → 更新 KV 信號
        await updatePollSignal(env, { att_ts: Date.now() });
        return json(result);
      }

      if (path === '/api/swap-beds' && request.method === 'POST') {
        const data = await request.json();
        const result = await handleSwapBeds(data, env);
        await updatePollSignal(env, { att_ts: Date.now() });
        return json(result);
      }

      // 點名完成回報：伺服器端讀最新值再加/減中隊，避免兩個中隊同時按互相蓋掉
      if (path === '/api/confirm' && request.method === 'POST') {
        const data = await request.json();
        return json(await handleConfirmSquad(data, env));
      }

      if (path === '/api/config' && request.method === 'GET') {
        return json(await handleGetConfig(env));
      }
      if (path === '/api/config' && request.method === 'POST') {
        const data = await request.json();
        const result = await handleSetConfig(data, env);
        // ⚡ 若寫入的是 confirm_ 欄位，同步更新 KV 信號
        const confirmKey = Object.keys(data).find(k => k.startsWith('confirm_'));
        if (confirmKey) {
          await updatePollSignal(env, { confirms: data[confirmKey] || '', date: confirmKey.slice('confirm_'.length) });
        }
        return json(result);
      }

      if (path === '/api/changelog' && request.method === 'GET') {
        return json(await handleGetChangelog(env));
      }
      if (path === '/api/changelog' && request.method === 'POST') {
        const data = await request.json();
        return json(await handlePostChangelog(data, env));
      }
      
      // 自動化建立日誌資料庫
      if (path === '/api/setup-changelog-db' && request.method === 'POST') {
        const configDbInfo = await notion(`/databases/${env.CONFIG_DB_ID}`, 'GET', null, env);
        if (!configDbInfo.parent || !configDbInfo.parent.page_id) throw new Error("找不到主頁面 ID");
        
        const dbRes = await notion('/databases', 'POST', {
          parent: { page_id: configDbInfo.parent.page_id },
          title: [{ text: { content: '碧苑系統日誌' } }],
          properties: {
             '名稱': { title: {} },
             '內容': { rich_text: {} }
          }
        }, env);
        return json({ success: true, CHANGELOG_DB_ID: dbRes.id });
      }

      if (path === '/api/setup-leave-db' && request.method === 'POST') {
        const configDbInfo = await notion(`/databases/${env.CONFIG_DB_ID}`, 'GET', null, env);
        if (!configDbInfo.parent || !configDbInfo.parent.page_id) throw new Error("找不到主頁面 ID");
        return json(await handleSetupLeaveDb(configDbInfo.parent.page_id, env));
      }

      if (url.pathname === '/api/leave-records') {
        if (request.method === 'GET') {
          // 回傳維持陣列 (前端直接當陣列用)；超過上限被截斷時多一個 X-Truncated: 1 header (前端不用讀)
          const records = await handleGetLeaveRecords(env, url.searchParams.get('from'), url.searchParams.get('to'), url.searchParams.get('name'));
          const res = json(records);
          if (records.truncated) res.headers.set('X-Truncated', '1');
          return res;
        }
        if (request.method === 'POST') {
          const data = await request.json();
          return json(await handleAddLeaveRecord(data, env));
        }
      }

      // 報修紀錄系統
      if (path === '/api/setup-repair-db' && request.method === 'POST') {
        const configDbInfo = await notion(`/databases/${env.CONFIG_DB_ID}`, 'GET', null, env);
        if (!configDbInfo.parent || !configDbInfo.parent.page_id) throw new Error("找不到主頁面 ID");
        return json(await handleSetupRepairDb(configDbInfo.parent.page_id, env));
      }

      if (url.pathname === '/api/repair-records') {
        if (request.method === 'GET') {
          return json(await handleGetRepairRecords(env));
        }
        if (request.method === 'POST') {
          const data = await request.json();
          return json(await handleAddRepairRecord(data, env));
        }
        if (request.method === 'DELETE') {
          const data = await request.json();
          return json(await handleDeleteRepairRecord(data, env));
        }
      }

      // 意見回饋系統
      if (path === '/api/setup-feedback-db' && request.method === 'POST') {
        const configDbInfo = await notion(`/databases/${env.CONFIG_DB_ID}`, 'GET', null, env);
        if (!configDbInfo.parent || !configDbInfo.parent.page_id) throw new Error("找不到主頁面 ID");
        return json(await handleSetupFeedbackDb(configDbInfo.parent.page_id, env));
      }

      // 備註紀錄系統
      if (path === '/api/setup-remarks-db' && request.method === 'POST') {
        const configDbInfo = await notion(`/databases/${env.CONFIG_DB_ID}`, 'GET', null, env);
        if (!configDbInfo.parent || !configDbInfo.parent.page_id) throw new Error("找不到主頁面 ID");
        return json(await handleSetupRemarksDb(configDbInfo.parent.page_id, env));
      }
      
      if (path === '/api/remarks' && request.method === 'GET') {
        return json(await handleGetRemarks(env));
      }
      
      if (path === '/api/remarks' && request.method === 'POST') {
        const data = await request.json();
        return json(await handleUpdateRemark(data, env));
      }

      if (url.pathname === '/api/feedback-records') {
        if (request.method === 'GET') {
          return json(await handleGetFeedbackRecords(env));
        }
        if (request.method === 'POST') {
          const data = await request.json();
          return json(await handleAddFeedbackRecord(data, env));
        }
        if (request.method === 'DELETE') {
          const data = await request.json();
          return json(await handleDeleteFeedbackRecord(data, env));
        }
      }

      return json({ error: '找不到端點' }, 404);

    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// API: 建立資料庫
// ════════════════════════════════════════════════════════════════════════════════
async function handleInitDb(data, env) {
  const { parent_page_id, date_columns } = data;
  if (!parent_page_id) throw new Error('缺少 parent_page_id');
  if (!date_columns || !date_columns.length) throw new Error('缺少 date_columns');

  // 建立固定欄位 + 所有日期欄位
  const properties = masterFixedProperties();
  for (const date of date_columns) {
    properties[date] = { select: { options: ATTENDANCE_OPTIONS.map(o => ({ ...o })) } };
  }

  // 建立總表資料庫
  const masterDb = await notion('/databases', 'POST', {
    parent: { page_id: parent_page_id },
    title: [{ text: { content: '碧苑點名總表' } }],
    properties,
  }, env);

  await sleep(500);

  // 建立系統設定資料庫
  const configDb = await notion('/databases', 'POST', {
    parent: { page_id: parent_page_id },
    title: [{ text: { content: '系統設定' } }],
    properties: {
      '鍵': { title: {} },
      '值': { rich_text: {} },
    },
  }, env);

  await sleep(350);

  // 寫入預設設定
  const defaults = [
    { key: 'pin_admin', value: '0000' },
    { key: 'pin_一單', value: '1111' },
    { key: 'pin_一雙', value: '2222' },
    { key: 'pin_二單', value: '3333' },
    { key: 'pin_二雙', value: '4444' },
    { key: 'pin_三單', value: '5555' },
    { key: 'pin_三雙', value: '6666' },
    { key: 'foreign_一單', value: '0' },
    { key: 'foreign_一雙', value: '0' },
    { key: 'foreign_二單', value: '0' },
    { key: 'foreign_二雙', value: '0' },
    { key: 'foreign_三單', value: '0' },
    { key: 'foreign_三雙', value: '0' },
    { key: 'total_beds', value: '0' },
    { key: 'bed_offset', value: '0' },
  ];

  for (const cfg of defaults) {
    await notion('/pages', 'POST', {
      parent: { database_id: configDb.id },
      properties: {
        '鍵': { title: [{ text: { content: cfg.key } }] },
        '值': { rich_text: [{ text: { content: cfg.value } }] },
      },
    }, env);
    await sleep(350);
  }

  return {
    success: true,
    master_db_id: masterDb.id,
    config_db_id: configDb.id,
    date_columns_count: date_columns.length,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 批次匯入學生 (單次最多 20 筆，受 CF 50 subrequest 限制：每床 1 次寫入 + 備註最多 1 次 + 查表)
//
// 回傳約定：{ success:boolean, imported, updated, errors:[{name,room,bed,error}], total }
//   ★ 有錯時「不帶 error 字串」，只用 success:false + errors 清單：前端 api.js 看到 data.error 會整包 throw，
//     這裡要讓前端自己看 success / errors 顯示哪幾床失敗、再重送那幾床就好
// 冪等：寫入前先查目標表建立「寢床號+床號 → pageId」對照，已存在的床位改用 PATCH (只覆蓋傳入的欄位)，
//   不存在的才 POST 建立；前端重送同一批不會產生重複床位
// 額外欄位：phone / address 寫進「電話」「住址」(舊表沒有這兩欄會先補)；remark 非空時寫進備註表 (REMARKS_DB_ID 沒設就略過)
// ════════════════════════════════════════════════════════════════════════════════
const IMPORT_BATCH_MAX = 20;
const hasStr = v => String(v == null ? '' : v).trim() !== '';
/** 寢床號+床號 的對照鍵；沒有寢床號就回空字串 (不做對照) */
function bedKey(room, bed) {
  const r = String(room || '').trim();
  return r ? `${r}|${String(bed || '').trim() || 'A'}` : '';
}
/** 匯入一床的 Notion 屬性；partial=true (更新既有床位) 時只放有傳入的欄位 */
function importBedProperties(s, partial) {
  const has = k => !partial || s[k] !== undefined;
  const properties = {};
  if (has('name')) properties['姓名'] = { title: [{ text: { content: s.name || '' } }] };
  if (has('room')) properties['寢床號'] = { rich_text: [{ text: { content: s.room || '' } }] };
  if (has('bed')) properties['床號'] = { select: { name: s.bed || 'A' } };
  if (has('class')) properties['班別'] = { rich_text: [{ text: { content: s.class || '' } }] };
  if (has('studentId')) properties['學號'] = { rich_text: [{ text: { content: s.studentId || '' } }] };
  if (has('squad')) properties['中隊'] = { select: { name: s.squad || '一單' } };
  if (has('isForeign')) properties['外籍生'] = { checkbox: !!s.isForeign };
  if (has('isEmpty')) properties['空床'] = { checkbox: !!s.isEmpty };
  // 電話/住址只在有值時才寫 (沒值就不碰，舊表沒這兩欄也不會因此失敗)
  if (hasStr(s.phone)) properties['電話'] = { rich_text: richTextChunks(String(s.phone).trim()) };
  if (hasStr(s.address)) properties['住址'] = { rich_text: richTextChunks(String(s.address).trim()) };

  // 加入日期欄位
  if (s.attendance) {
    for (const [date, value] of Object.entries(s.attendance)) {
      if (value) {
        properties[date] = { select: { name: value } };
      }
    }
  }
  return properties;
}

async function handleImportBatch(data, env) {
  const dbId = data.db_id || await getMasterDbId(env);

  const { students } = data;
  if (!students || !students.length) throw new Error('缺少 students');

  let imported = 0;
  let updated = 0;
  const errors = [];
  const batch = students.slice(0, IMPORT_BATCH_MAX);
  for (const s of students.slice(IMPORT_BATCH_MAX)) errors.push({ name: s.name, room: s.room, bed: s.bed, error: '超過單次上限，請分批' });

  // 有帶電話/住址才確認欄位存在 (舊表可能沒有這兩欄)
  if (batch.some(s => hasStr(s.phone) || hasStr(s.address))) await ensureContactColumns(dbId, env);

  // 既有床位對照 (寢床號+床號 → pageId)
  const byBed = new Map();
  for (const page of await queryAll(dbId, null, null, env)) {
    const key = bedKey(getText(page.properties['寢床號']), getSelect(page.properties['床號']));
    if (key && !byBed.has(key)) byBed.set(key, page.id);
  }

  // 備註：先查一次備註表 (pageId → { id, text })，之後每床最多 1 次寫入
  // (逐筆呼叫 handleUpdateRemark 每床要多查一次，20 床會撞到子請求上限)；內容一樣就不再寫
  let remarkIndex = null;
  if (env.REMARKS_DB_ID && batch.some(s => hasStr(s.remark))) {
    remarkIndex = new Map();
    // 只有「已存在的床位」才可能已經有備註列 (新建的頁 id 是全新的)；整批都是新床位就不用查備註表，省子請求
    if (batch.some(s => hasStr(s.remark) && byBed.has(bedKey(s.room, s.bed)))) {
      for (const p of await queryAll(env.REMARKS_DB_ID, null, null, env)) {
        const k = getTitle(p.properties['學號或姓名']);
        if (k && !remarkIndex.has(k)) remarkIndex.set(k, { id: p.id, text: getText(p.properties['備註內容']) });
      }
    }
  }

  for (const s of batch) {
    try {
      const key = bedKey(s.room, s.bed);
      const existingId = key ? byBed.get(key) : undefined;
      let pageId;
      if (existingId) {
        await notion(`/pages/${existingId}`, 'PATCH', { properties: importBedProperties(s, true) }, env);
        pageId = existingId;
        updated++;
      } else {
        const created = await notion('/pages', 'POST', {
          parent: { database_id: dbId },
          properties: importBedProperties(s, false),
        }, env);
        pageId = created.id;
        if (key) byBed.set(key, pageId); // 同一批裡重複的床位之後改成更新
        imported++;
      }
      await sleep(340);

      if (remarkIndex && hasStr(s.remark) && pageId) {
        const remark = String(s.remark);
        const hit = remarkIndex.get(pageId);
        if (!hit) {
          const r = await notion('/pages', 'POST', {
            parent: { database_id: env.REMARKS_DB_ID },
            properties: {
              '學號或姓名': { title: [{ text: { content: pageId } }] },
              '備註內容': { rich_text: richTextChunks(remark) },
            },
          }, env);
          remarkIndex.set(pageId, { id: r.id, text: remark });
          await sleep(340);
        } else if (hit.text !== remark) {
          await notion(`/pages/${hit.id}`, 'PATCH', { properties: { '備註內容': { rich_text: richTextChunks(remark) } } }, env);
          hit.text = remark;
          await sleep(340);
        }
      }
    } catch (err) {
      errors.push({ name: s.name, room: s.room, bed: s.bed, error: err.message });
    }
  }

  return { success: errors.length === 0, imported, updated, errors, total: students.length };
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 取得全部學生 + 全部日期資料
// ════════════════════════════════════════════════════════════════════════════════
async function handleGetRoster(env, dbIdOverride) {
  const dbId = dbIdOverride || await getMasterDbId(env);

  // 取得資料庫結構（知道哪些是日期欄位）
  const dbInfo = await notion(`/databases/${dbId}`, 'GET', null, env);
  await ensureContactColumns(dbId, env, dbInfo);
  const allProps = Object.keys(dbInfo.properties);
  const dateColumns = allProps
    .filter(name => isDateColumnName(name))
    .sort((a, b) => parseDateCol(a) - parseDateCol(b));

  await sleep(340);

  // 查詢所有頁面
  const pages = await queryAll(dbId, null, [
    { property: '寢床號', direction: 'ascending' },
    { property: '床號', direction: 'ascending' },
  ], env);

  // 轉換為精簡格式
  const students = pages.map(page => {
    const p = page.properties;
    const student = {
      id: page.id,
      name: getTitle(p['姓名']),
      room: getText(p['寢床號']),
      bed: getSelect(p['床號']),
      class: getText(p['班別']),
      studentId: getText(p['學號']),
      phone: getText(p['電話']),
      address: getText(p['住址']),
      squad: getSelect(p['中隊']),
      isForeign: getCheckbox(p['外籍生']),
      isEmpty: getCheckbox(p['空床']),
      attendance: {},
    };

    // 提取日期資料
    for (const date of dateColumns) {
      const val = getSelect(p[date]);
      if (val) student.attendance[date] = val;
    }

    return student;
  });

  return { students, dateColumns };
}

/** 解析日期欄位名稱為可排序的數字 (舊式 "2月20日" → 220；新式 "2026-09-12" → 20260912，一定排在舊式後面) */
function parseDateCol(name) {
  const iso = ISO_RE.exec(name);
  if (iso) return parseInt(iso[1]) * 10000 + parseInt(iso[2]) * 100 + parseInt(iso[3]);
  const m = name.match(/(\d+)月(\d+)日/);
  if (!m) return 99999999;
  return parseInt(m[1]) * 100 + parseInt(m[2]);
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 批次更新出席狀態
// ════════════════════════════════════════════════════════════════════════════════
async function handleUpdateAttendance(data, env) {
  const { updates } = data;
  if (!updates || !updates.length) throw new Error('缺少 updates');

  // 先確認這批更新用到的日期欄位都存在；沒有就自動建立，資料才不會無聲消失
  const dbId = await getMasterDbId(env);
  const dateNames = [];
  for (const u of updates.slice(0, 45)) {
    if (u.dates) dateNames.push(...Object.keys(u.dates));
    if (u.date) dateNames.push(u.date);
  }
  let addedColumns = [];
  if (dateNames.some(isDateColumnName)) addedColumns = await ensureDateColumns(dbId, dateNames, env);
  const touchesContact = updates.slice(0, 45).some(u => u.clearProfile ||
    (u.updateProfile && (u.updateProfile.phone !== undefined || u.updateProfile.address !== undefined)));
  if (touchesContact) await ensureContactColumns(dbId, env);

  let updated = 0;
  const errors = [];

  for (const u of updates.slice(0, 45)) {
    try {
      const properties = {};
      // 支援單筆更新一個日期，也支援多個日期
      if (u.dates) {
        // { pageId, dates: { "4月10日": "◎", "4月11日": "✓" } }
        for (const [date, value] of Object.entries(u.dates)) {
          properties[date] = value ? { select: { name: value } } : { select: null };
        }
      } else if (u.date) {
        // { pageId, date, value }
        properties[u.date] = u.value ? { select: { name: u.value } } : { select: null };
      }

      // 支援標記空床 checkbox
      if (u.markEmpty !== undefined) {
        properties['空床'] = { checkbox: !!u.markEmpty };
      }

      // 支援清除個人基本資料 (學號、班級、姓名、外籍生)
      if (u.clearProfile) {
        properties['姓名'] = { title: [] };
        properties['班別'] = { rich_text: [] };
        properties['學號'] = { rich_text: [] };
        properties['電話'] = { rich_text: [] };
        properties['住址'] = { rich_text: [] };
        properties['外籍生'] = { checkbox: false };
      }

      if (u.updateProfile) {
        properties['姓名'] = { title: [{ text: { content: u.updateProfile.name || '' } }] };
        properties['班別'] = { rich_text: [{ text: { content: u.updateProfile.class || '' } }] };
        properties['學號'] = { rich_text: [{ text: { content: u.updateProfile.studentId || '' } }] };
        if (u.updateProfile.phone !== undefined) properties['電話'] = { rich_text: [{ text: { content: u.updateProfile.phone || '' } }] };
        if (u.updateProfile.address !== undefined) properties['住址'] = { rich_text: [{ text: { content: u.updateProfile.address || '' } }] };
        properties['外籍生'] = { checkbox: !!u.updateProfile.isForeign };
        properties['空床'] = { checkbox: false }; // 自動取消空床標記
      }

      await notion(`/pages/${u.pageId}`, 'PATCH', { properties }, env);
      updated++;
      await sleep(340);
    } catch (err) {
      errors.push({ pageId: u.pageId, error: err.message });
    }
  }

  const result = { success: errors.length === 0, updated, errors, addedColumns };
  // 舊版只把失敗塞進 errors 仍回 200，前端會誤以為已存檔；現在帶 error 讓前端保留變更重試
  if (errors.length) result.error = `${errors.length} 筆更新失敗：${errors[0].error}`;
  return result;
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 學期管理
// ════════════════════════════════════════════════════════════════════════════════
async function handleGetSemester(env) {
  const st = await getSemesterState(env);
  let dateColumns = [];
  if (st.current.dbId) {
    const dbInfo = await notion(`/databases/${st.current.dbId}`, 'GET', null, env);
    dateColumns = Object.keys(dbInfo.properties).filter(isDateColumnName).sort((a, b) => parseDateCol(a) - parseDateCol(b));
  }
  return { ...st, dateColumns, legacyDbId: env.MASTER_DB_ID || '' };
}

/**
 * 套用學期日期範圍：範圍內缺的欄位補上；範圍外的新式欄位列出來，要 confirmRemove 才真的刪。
 * 舊式 "X月Y日" 欄位一律不動 (那是舊資料庫的格式)。
 */
async function handleApplySemesterDates(data, env) {
  const { start, end, name, confirmRemove } = data || {};
  const wanted = isoRange(start, end);
  const st = await getSemesterState(env);
  const dbId = st.current.dbId;
  if (!dbId) throw new Error('目前沒有點名總表資料庫');

  const dbInfo = await notion(`/databases/${dbId}`, 'GET', null, env);
  await sleep(340);
  const existing = Object.keys(dbInfo.properties).filter(isDateColumnName);
  const wantedSet = new Set(wanted);
  const toAdd = wanted.filter(d => !dbInfo.properties[d]);
  const toRemove = existing.filter(n => ISO_RE.test(n) && !wantedSet.has(n)).sort();

  if (toRemove.length && !confirmRemove) {
    // 先算每個要刪的欄位裡有幾筆「不是 ✓ 也不是空白」的紀錄，讓使用者知道會失去什麼
    const pages = await queryAll(dbId, null, null, env);
    const details = toRemove.map(date => {
      let nonDefault = 0;
      for (const page of pages) { const v = getSelect(page.properties[date]); if (v && v !== '✓') nonDefault++; }
      return { date, nonDefault };
    });
    return { success: false, needsConfirm: true, toAdd, toRemove: details };
  }

  await ensureDateColumns(dbId, toAdd, env, dbInfo);
  for (let i = 0; i < toRemove.length; i += 60) {
    const properties = {};
    for (const n of toRemove.slice(i, i + 60)) properties[n] = null;
    await notion(`/databases/${dbId}`, 'PATCH', { properties }, env);
    await sleep(340);
  }

  st.current.start = start;
  st.current.end = end;
  if (name !== undefined && String(name).trim()) st.current.name = String(name).trim();
  await saveSemesterState(st, env);

  return { success: true, added: toAdd, removed: toRemove, current: st.current };
}

/** Notion id 有時帶連字號有時沒有 (環境變數常是沒有的)，比對前先拿掉 */
const sameNotionId = (a, b) => !!a && !!b && String(a).replace(/-/g, '') === String(b).replace(/-/g, '');
/** 資料庫物件的標題純文字 */
const dbTitleOf = db => (Array.isArray(db?.title) ? db.title : []).map(t => t?.plain_text ?? t?.text?.content ?? '').join('').trim();

/** 舊表的床位清單 (帶或不帶目前住宿生)，給前端分批呼叫 /api/import-batch 建到新表 */
async function archiveBedList(oldDbId, carry, env) {
  const pages = await queryAll(oldDbId, null, [
    { property: '寢床號', direction: 'ascending' },
    { property: '床號', direction: 'ascending' },
  ], env);
  // 備註存在另一張表、以舊 pageId 為鍵：一次查完整張表，不逐床查
  const remarks = carry ? await handleGetRemarks(env) : {};
  return pages.map(page => {
    const p = page.properties;
    const isEmpty = getCheckbox(p['空床']) || !getTitle(p['姓名']).trim();
    const keep = carry && !isEmpty;
    return {
      room: getText(p['寢床號']), bed: getSelect(p['床號']) || 'A', squad: getSelect(p['中隊']) || '一單',
      name: keep ? getTitle(p['姓名']) : '', class: keep ? getText(p['班別']) : '', studentId: keep ? getText(p['學號']) : '',
      isForeign: keep ? getCheckbox(p['外籍生']) : false, isEmpty: !keep, attendance: {},
      // 電話 / 住址 / 備註也一起帶過去 (以前封存後這三樣就不見了)
      phone: keep ? getText(p['電話']) : '', address: keep ? getText(p['住址']) : '', remark: keep ? (remarks[page.id] || '') : '',
    };
  }).filter(b => b.room);
}

/**
 * 封存本學期並建立新學期資料庫 (順序以「任何一步失敗都不會留下半套狀態」為原則)：
 * 1. 先查舊表床位清單 (純讀取，失敗什麼都沒動)
 * 2. 在同一個 Notion 父頁面建立「碧苑點名總表 <新學期>」，欄位 = 固定欄位 + 新學期每一天
 *    冪等：KV 有 archive_pending 記號或 Notion 搜尋到同名未封存的表就重用，不會再建第二張孤兒表
 * 3. 切換目前學期指向新資料庫 (saveSemesterState 先寫 Notion 正本、再寫 KV)
 * 4. 最後才把舊表改名「碧苑點名總表 <舊學期>」原封保留 (改名失敗只記錄，學期已經切換成功)
 * 5. 回傳床位清單，由前端分批呼叫 /api/import-batch 建立床位 (Worker 單次請求有子請求上限)
 * 若 st.current.name 已經等於新名稱 (上次已切換成功、只剩床位沒建完)，回 alreadyCurrent:true 讓前端接著建床位
 */
async function handleArchiveSemester(data, env) {
  const { newName, start, end, currentName, carryResidents } = data || {};
  const cleanNew = String(newName || '').trim();
  if (!cleanNew) throw new Error('缺少新學期名稱');
  const dates = isoRange(start, end);
  const st = await getSemesterState(env);
  const oldDbId = st.current.dbId;
  if (!oldDbId) throw new Error('目前沒有點名總表資料庫');
  const carry = carryResidents !== false;

  const clientCurrent = String(currentName || '').trim();
  if (st.current.name && st.current.name === cleanNew && st.archives.length && clientCurrent && clientCurrent !== cleanNew) {
    // 上次已經切換成功 (只剩床位沒建完就斷線)，前端還以為目前是舊學期 (currentName ≠ 新名稱) 又送了一次：
    // 不報錯，回傳床位清單讓前端把剩下的建完。前端送的 currentName 就是新名稱 (或沒送) 仍照舊報「跟目前學期一樣」。
    // 床位從剛封存的舊表 (archives 最後一筆) 查；安全起見只回傳新表裡「還沒有」的床位，
    // 新表已有的一律不動 (萬一是誤把目前學期名稱當新名稱送進來，也不會被舊資料蓋掉)
    const last = st.archives[st.archives.length - 1];
    const existing = new Set((await queryAll(st.current.dbId, null, null, env))
      .map(p => bedKey(getText(p.properties['寢床號']), getSelect(p.properties['床號']))));
    const beds = (await archiveBedList(last.dbId, carry, env)).filter(b => !existing.has(bedKey(b.room, b.bed)));
    return { success: true, alreadyCurrent: true, newDbId: st.current.dbId, archived: { name: last.name, dbId: last.dbId }, current: st.current, beds };
  }

  const oldName = String(st.current.name || currentName || '').trim() || '舊學期';
  if (oldName === cleanNew) throw new Error('新學期名稱不能跟目前學期一樣');
  if (st.archives.some(a => a.name === cleanNew)) throw new Error(`已經有封存的學期「${cleanNew}」`);

  const dbInfo = await notion(`/databases/${oldDbId}`, 'GET', null, env);
  const parentPageId = dbInfo.parent?.page_id;
  if (!parentPageId) throw new Error('目前總表不在 Notion 頁面底下，無法在旁邊建立新學期總表');
  await sleep(340);

  // 1. 床位清單 (純讀取；這裡失敗 Notion 什麼都沒動)
  const beds = await archiveBedList(oldDbId, carry, env);

  // 2. 建新表 —— 先找上次建到一半的：KV 記號優先，再用 Notion 搜尋 (剛建的表搜尋不一定馬上找得到，所以兩個都要)
  const newTitle = `碧苑點名總表 ${cleanNew}`;
  const usable = db => db && !db.archived && !db.in_trash && dbTitleOf(db) === newTitle
    && !sameNotionId(db.id, oldDbId) && !st.archives.some(a => sameNotionId(a.dbId, db.id));
  let newDbId = '';
  let newDbInfo = null;
  const pending = await getArchivePending(env);
  if (pending && pending.newName === cleanNew) {
    try {
      const info = await notion(`/databases/${pending.newDbId}`, 'GET', null, env);
      await sleep(340);
      if (usable(info)) { newDbId = info.id; newDbInfo = info; }
    } catch (e) { console.error('archive_pending 指到的新表讀不到，忽略', e); }
  }
  if (!newDbId) {
    try {
      const found = await notion('/search', 'POST', { query: newTitle, filter: { value: 'database', property: 'object' }, page_size: 100 }, env);
      await sleep(340);
      const hit = (found.results || []).find(db => db.object === 'database' && usable(db) && sameNotionId(db.parent?.page_id, parentPageId));
      if (hit) { newDbId = hit.id; newDbInfo = hit.properties ? hit : null; }
    } catch (e) { console.error('Notion 搜尋同名新表失敗，改直接建立：' + (e && e.message)); }
  }
  if (newDbId) {
    // 重用上次建到一半的新表：補齊可能缺的欄位
    if (!newDbInfo) { newDbInfo = await notion(`/databases/${newDbId}`, 'GET', null, env); await sleep(340); }
    await ensureContactColumns(newDbId, env, newDbInfo);
    await ensureDateColumns(newDbId, dates, env, newDbInfo);
  } else {
    const properties = masterFixedProperties();
    for (const d of dates) properties[d] = { select: { options: ATTENDANCE_OPTIONS.map(o => ({ ...o })) } };
    const newDb = await notion('/databases', 'POST', {
      parent: { page_id: parentPageId },
      title: [{ text: { content: newTitle } }],
      properties,
    }, env);
    await sleep(340);
    newDbId = newDb.id;
  }
  if (env.POLL_KV) {
    try { await env.POLL_KV.put(ARCHIVE_PENDING_KEY, JSON.stringify({ newName: cleanNew, newDbId, ts: Date.now() })); }
    catch (e) { console.error('KV archive_pending write failed', e); }
  }

  // 3. 切換學期 (Notion 正本成功才寫 KV；失敗就丟錯，舊表還是目前學期、新表留著下次重用)
  st.archives.push({ name: oldName, dbId: oldDbId, start: st.current.start, end: st.current.end, archivedAt: new Date().toISOString() });
  st.current = { name: cleanNew, dbId: newDbId, start, end };
  const saved = await saveSemesterState(st, env);
  if (env.POLL_KV && typeof env.POLL_KV.delete === 'function') {
    try { await env.POLL_KV.delete(ARCHIVE_PENDING_KEY); } catch (e) { console.error('KV archive_pending delete failed', e); }
  }

  // 4. 最後才改舊表標題：學期已經切換成功，改名失敗只記錄不影響結果
  try {
    await notion(`/databases/${oldDbId}`, 'PATCH', { title: [{ text: { content: `碧苑點名總表 ${oldName}` } }] }, env);
  } catch (e) { console.error('舊表改名失敗 (學期已切換，可到 Notion 手動改名)', e); }

  return { success: true, newDbId, archived: { name: oldName, dbId: oldDbId }, current: saved.current, beds };
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 換床位（整行資料交換）
// 保持 寢床號/床號/中隊 不變，交換其餘所有屬性（姓名/班別/學號/外籍生/空床/出席紀錄）
// ════════════════════════════════════════════════════════════════════════════════
async function handleSwapBeds(data, env) {
  const { pageIdA, pageIdB } = data;
  if (!pageIdA || !pageIdB) throw new Error('缺少 pageIdA 或 pageIdB');
  if (pageIdA === pageIdB) throw new Error('不能跟自己交換');

  // 1. 從 Notion 讀取兩個頁面的完整屬性
  const [pageA, pageB] = await Promise.all([
    notion(`/pages/${pageIdA}`, 'GET', null, env),
    notion(`/pages/${pageIdB}`, 'GET', null, env),
  ]);

  const propsA = pageA.properties;
  const propsB = pageB.properties;

  // 2. 建立互換的屬性 patch（排除物理位置欄位）
  const patchForA = {}; // 要寫入 pageA 的資料（來自 pageB）
  const patchForB = {}; // 要寫入 pageB 的資料（來自 pageA）

  for (const [key, valB] of Object.entries(propsB)) {
    if (POSITION_PROPS.includes(key)) continue;
    const cloned = clonePropValue(valB);
    if (cloned) patchForA[key] = cloned;
  }

  for (const [key, valA] of Object.entries(propsA)) {
    if (POSITION_PROPS.includes(key)) continue;
    const cloned = clonePropValue(valA);
    if (cloned) patchForB[key] = cloned;
  }

  // 3. 寫回 Notion
  await notion(`/pages/${pageIdA}`, 'PATCH', { properties: patchForA }, env);
  await sleep(350);
  await notion(`/pages/${pageIdB}`, 'PATCH', { properties: patchForB }, env);

  return { success: true, message: '床位資料已完整交換' };
}

/**
 * 將 Notion 讀取到的屬性值轉換為可寫入的格式
 */
function clonePropValue(prop) {
  switch (prop.type) {
    case 'title':
      return { title: prop.title.map(t => ({ text: { content: t.plain_text || '' } })) };
    case 'rich_text':
      return { rich_text: prop.rich_text.map(t => ({ text: { content: t.plain_text || '' } })) };
    case 'select':
      return prop.select ? { select: { name: prop.select.name } } : { select: null };
    case 'checkbox':
      return { checkbox: prop.checkbox };
    case 'number':
      return { number: prop.number };
    case 'multi_select':
      return { multi_select: prop.multi_select.map(s => ({ name: s.name })) };
    case 'date':
      return { date: prop.date };
    case 'email':
      return { email: prop.email };
    case 'phone_number':
      return { phone_number: prop.phone_number };
    case 'url':
      return { url: prop.url };
    default:
      // 未知類型跳過（如 formula, rollup, relation 等唯讀欄位）
      return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 系統設定
// ════════════════════════════════════════════════════════════════════════════════
async function handleGetConfig(env) {
  const dbId = env.CONFIG_DB_ID;
  if (!dbId) throw new Error('CONFIG_DB_ID 環境變數未設定');

  const pages = await queryAll(dbId, null, null, env);
  const config = {};
  const editedAt = {};
  for (const page of pages) {
    const key = getTitle(page.properties['鍵']);
    const value = getText(page.properties['值']);
    if (!key) continue;
    // 兩個人同時第一次寫同一個鍵，Notion 會多出同名列；Notion 回傳順序不固定，
    // 以前每次刷新可能拿到不同列 → 「已回報」一閃一閃。現在固定取最後編輯的那列。
    const t = Date.parse(page.last_edited_time || '') || 0;
    if (!(key in config) || t >= editedAt[key]) { config[key] = value; editedAt[key] = t; }
  }
  return config;
}

async function handleSetConfig(data, env) {
  const dbId = env.CONFIG_DB_ID;
  if (!dbId) throw new Error('CONFIG_DB_ID 環境變數未設定');

  const pages = await queryAll(dbId, null, null, env);
  const existing = {};
  for (const page of pages) {
    const key = getTitle(page.properties['鍵']);
    if (key) (existing[key] = existing[key] || []).push(page.id);
  }

  const results = {};
  for (const [key, value] of Object.entries(data)) {
    await sleep(340);
    if (existing[key]) {
      // 同名重複列全部一起改，不管讀的時候拿到哪一列都一樣
      for (const pageId of existing[key]) {
        await notion(`/pages/${pageId}`, 'PATCH', {
          properties: { '值': { rich_text: richTextChunks(value) } },
        }, env);
      }
      results[key] = 'updated';
    } else {
      await notion('/pages', 'POST', {
        parent: { database_id: dbId },
        properties: {
          '鍵': { title: [{ text: { content: key } }] },
          '值': { rich_text: richTextChunks(value) },
        },
      }, env);
      results[key] = 'created';
    }
  }

  return { success: true, results };
}

/**
 * 點名完成回報 { date, squad, confirmed }。
 * 以前前端用「自己手上的名單」整串寫回，兩個中隊差不多時間按，後寫的會把先寫的蓋掉。
 * 現在伺服器讀最新值只加/減自己這一隊，寫完再讀一次確認，被別人蓋掉就重做 (最多 3 次)。
 */
async function handleConfirmSquad(data, env) {
  const { date, squad } = data || {};
  const confirmed = !!(data && data.confirmed);
  if (!date || !squad) throw new Error('缺少 date 或 squad');
  const key = 'confirm_' + date;
  let list = [];
  for (let round = 0; round < 3; round++) {
    const cfg = await handleGetConfig(env);
    list = String(cfg[key] || '').split(',').filter(Boolean);
    if (round > 0 && list.includes(squad) === confirmed) break;
    list = list.filter(s => s !== squad);
    if (confirmed) list.push(squad);
    await handleSetConfig({ [key]: list.join(',') }, env);
    await updatePollSignal(env, { confirms: list.join(','), date });
    await sleep(400);
  }
  return { success: true, confirms: list };
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 公告日誌
// ════════════════════════════════════════════════════════════════════════════════
async function handleGetChangelog(env) {
  const dbId = env.CHANGELOG_DB_ID;
  if (!dbId) return []; // 尚未設定的相容處理

  // 使用 timestamp 來排序內建的建立時間，而不是 property
  const pages = await queryAll(dbId, null, [{ timestamp: 'created_time', direction: 'descending' }], env);
  const logs = [];
  for (const page of pages) {
    // 支援多段 rich_text (例如換行)
    let content = '';
    const richTextArr = page.properties['內容']?.rich_text || [];
    for (const rt of richTextArr) {
      content += rt.text?.content || '';
    }
    
    if (content) {
      logs.push({
        id: page.id,
        content: content,
        time: page.created_time
      });
    }
  }
  return logs;
}

async function handlePostChangelog(data, env) {
  const dbId = env.CHANGELOG_DB_ID;
  if (!dbId) throw new Error('CHANGELOG_DB_ID 環境變數未設定');
  const { content } = data;
  if (!content) throw new Error('缺少 content');

  const res = await notion('/pages', 'POST', {
    parent: { database_id: dbId },
    properties: {
      '名稱': { title: [{ text: { content: '更新日誌 ' + new Date().toISOString() } }] },
      '內容': { rich_text: [{ text: { content: String(content) } }] },
    },
  }, env);

  return { success: true, id: res.id };
}

// ════════════════════════════════════════════════════════════════════════════════
// Setup 精靈頁面
// ════════════════════════════════════════════════════════════════════════════════
// ─── 電話請假紀錄系統 ─────────────────────────────────────────────────────────────

async function handleSetupLeaveDb(parentPageId, env) {
  const db = await notion('/databases', 'POST', {
    parent: { page_id: parentPageId },
    title: [{ text: { content: '電話請假紀錄' } }],
    properties: {
      '標題': { title: {} },
      '姓名': { rich_text: {} },
      '房號床位': { rich_text: {} },
      '請假範圍': { date: {} },
      '處理人': { rich_text: {} },
      '來電號碼': { phone_number: {} },
      '來電者備註': { rich_text: {} },
      '建立時間': { created_time: {} }
    }
  }, env);
  return { success: true, LEAVE_DB_ID: db.id };
}

// 舊的電話請假資料庫沒有「來電號碼 / 來電者備註」欄位：第一次寫入時自動補上 (每個 isolate 只檢查一次)
const LEAVE_EXTRA_COLUMNS = { '來電號碼': { phone_number: {} }, '來電者備註': { rich_text: {} } };
let _leaveColumnsReady = null;
function ensureLeaveColumns(dbId, env) {
  if (!_leaveColumnsReady || _leaveColumnsReady.dbId !== dbId) {
    const promise = (async () => {
      const db = await notion(`/databases/${dbId}`, 'GET', null, env);
      const missing = {};
      for (const [key, def] of Object.entries(LEAVE_EXTRA_COLUMNS)) {
        if (!db.properties || !db.properties[key]) missing[key] = def;
      }
      if (Object.keys(missing).length) await notion(`/databases/${dbId}`, 'PATCH', { properties: missing }, env);
      return true;
    })().catch(err => { _leaveColumnsReady = null; console.warn('補電話請假欄位失敗', err); return false; });
    _leaveColumnsReady = { dbId, promise };
  }
  return _leaveColumnsReady.promise;
}

const plainText = arr => (Array.isArray(arr) ? arr.map(t => t.plain_text ?? t.text?.content ?? '').join('') : '');

// from / to = 來電日 YYYY-MM-DD (台灣時間)；沒給就回最新的紀錄。name = 姓名包含 (個人查詢用)
// 最多 30 頁 (3000 筆)；超過就截斷並在回傳陣列掛 truncated=true (路由會轉成 X-Truncated header，JSON 本身還是純陣列)
const LEAVE_RECORDS_MAX_PAGES = 30;
async function handleGetLeaveRecords(env, from, to, name) {
  const dbId = env.LEAVE_DB_ID;
  if (!dbId) return [];
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const query = { sorts: [{ timestamp: 'created_time', direction: 'descending' }], page_size: 100 };
  const conds = [];
  if (isDay(from) && isDay(to)) {
    const end = new Date(to + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    conds.push(
      { timestamp: 'created_time', created_time: { on_or_after: `${from}T00:00:00+08:00` } },
      { timestamp: 'created_time', created_time: { before: `${end.toISOString().slice(0, 10)}T00:00:00+08:00` } },
    );
  }
  const cleanName = String(name || '').trim().slice(0, 50);
  if (cleanName) conds.push({ property: '姓名', rich_text: { contains: cleanName } });
  if (conds.length === 1) query.filter = conds[0];
  else if (conds.length > 1) query.filter = { and: conds };

  const pages = [];
  let truncated = false;
  for (let i = 0; i < LEAVE_RECORDS_MAX_PAGES; i++) {
    if (i > 0) await sleep(340); // 頁與頁之間歇一下，別連打 Notion
    const res = await notion(`/databases/${dbId}/query`, 'POST', query, env);
    pages.push(...(res.results || []));
    if (!res.has_more || !res.next_cursor) break;
    query.start_cursor = res.next_cursor;
    if (i === LEAVE_RECORDS_MAX_PAGES - 1) truncated = true;
  }

  const out = pages.map(page => {
    const props = page.properties || {};
    return {
      id: page.id,
      title: plainText(props['標題']?.title),
      name: plainText(props['姓名']?.rich_text),
      roomBed: plainText(props['房號床位']?.rich_text),
      dateStart: props['請假範圍']?.date?.start || '',
      dateEnd: props['請假範圍']?.date?.end || '',
      handler: plainText(props['處理人']?.rich_text),
      callerPhone: props['來電號碼']?.phone_number || '',
      callerNote: plainText(props['來電者備註']?.rich_text),
      createdAt: props['建立時間']?.created_time || page.created_time || ''
    };
  });
  if (truncated) out.truncated = true; // 陣列上的額外屬性不會進 JSON
  return out;
}

async function handleAddLeaveRecord(data, env) {
  const dbId = env.LEAVE_DB_ID;
  const { name, roomBed, dateStart, dateEnd, handler } = data;
  const callerPhone = String(data.callerPhone || '').trim().slice(0, 40);
  const callerNote = String(data.callerNote || '').trim().slice(0, 500);
  if (!dbId) throw new Error('缺少 LEAVE_DB_ID 環境變數，請在 Cloudflare 設定');

  const hasColumns = (callerPhone || callerNote) ? await ensureLeaveColumns(dbId, env) : true;
  const properties = {
    '標題': { title: [{ text: { content: `${name} 的請假申請` } }] },
    '姓名': { rich_text: [{ text: { content: name || '' } }] },
    '房號床位': { rich_text: [{ text: { content: roomBed || '' } }] },
    '請假範圍': { date: { start: dateStart, end: dateEnd } },
    '處理人': { rich_text: [{ text: { content: handler || '' } }] }
  };
  if (hasColumns) {
    if (callerPhone) properties['來電號碼'] = { phone_number: callerPhone };
    if (callerNote) properties['來電者備註'] = { rich_text: [{ text: { content: callerNote } }] };
  } else if (callerPhone || callerNote) {
    // 補欄位失敗 (整合沒有改資料庫的權限)：至少把來電資訊寫進標題，不要弄丟
    properties['標題'].title[0].text.content += ` (來電 ${[callerPhone, callerNote].filter(Boolean).join(' ')})`;
  }

  await notion('/pages', 'POST', { parent: { database_id: dbId }, properties }, env);

  return { success: true };
}

// ─── 報修通知紀錄系統 ─────────────────────────────────────────────────────────────

async function handleSetupRepairDb(parentPageId, env) {
  const db = await notion('/databases', 'POST', {
    parent: { page_id: parentPageId },
    title: [{ text: { content: '報修紀錄' } }],
    properties: {
      '標題': { title: {} },
      '報修人': { rich_text: {} },
      '原因': { rich_text: {} },
      '照片': { rich_text: {} },
      '建立時間': { created_time: {} }
    }
  }, env);
  return { success: true, REPAIR_DB_ID: db.id };
}

/** 依建立時間新到舊分頁抓最多 maxPages 頁 (每頁 100，頁間歇 340ms)；報修與回饋紀錄共用 */
async function queryLatest(dbId, maxPages, env) {
  const query = { sorts: [{ property: '建立時間', direction: 'descending' }], page_size: 100 };
  const pages = [];
  for (let i = 0; i < maxPages; i++) {
    if (i > 0) await sleep(340);
    const res = await notion(`/databases/${dbId}/query`, 'POST', query, env);
    pages.push(...(res.results || []));
    if (!res.has_more || !res.next_cursor) break;
    query.start_cursor = res.next_cursor;
  }
  return pages;
}

async function handleGetRepairRecords(env) {
  const dbId = env.REPAIR_DB_ID;
  if (!dbId) return [];
  // 以前只取最新 50 筆，舊的看不到；現在分頁抓到最多 500 筆，回傳格式不變 (陣列)
  const results = await queryLatest(dbId, 5, env);

  return results.map(page => {
    const props = page.properties;
    // 照片存在 rich_text 中，以 JSON array 格式
    let photos = [];
    try {
      const photoStr = props['照片']?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
      if (photoStr) photos = JSON.parse(photoStr);
    } catch (e) { /* ignore parse error */ }

    return {
      id: page.id,
      reporter: props['報修人']?.rich_text?.map(rt => rt.text?.content || '').join('') || '',
      title: props['標題']?.title?.[0]?.text?.content || '',
      reason: props['原因']?.rich_text?.map(rt => rt.text?.content || '').join('') || '',
      photos: photos,
      createdAt: props['建立時間']?.created_time || ''
    };
  });
}

async function handleAddRepairRecord(data, env) {
  const dbId = env.REPAIR_DB_ID;
  if (!dbId) throw new Error('缺少 REPAIR_DB_ID 環境變數，請在 Cloudflare 設定');
  const { reason, photos, reporter } = data;
  if (!reason) throw new Error('缺少報修原因');

  // 照片以 JSON 字串存放（Notion rich_text 單段最多 2000 字元，需要拆分）
  const photoJson = JSON.stringify(photos || []);
  const photoChunks = [];
  for (let i = 0; i < photoJson.length; i += 2000) {
    photoChunks.push({ text: { content: photoJson.slice(i, i + 2000) } });
  }

  const properties = {
    // 日期用台灣時間 (以前用 UTC，台灣 00:00~07:59 報修會顯示成前一天)
    '標題': { title: [{ text: { content: (reporter || '未知') + ' 的報修通知 ' + taipeiDateString() } }] },
    '原因': { rich_text: [{ text: { content: reason } }] },
    '照片': { rich_text: photoChunks.length > 0 ? photoChunks : [] },
  };

  // 報修人欄位（相容舊資料庫沒有此欄位的情況）
  if (reporter) {
    properties['報修人'] = { rich_text: [{ text: { content: reporter } }] };
  }

  await notion('/pages', 'POST', {
    parent: { database_id: dbId },
    properties
  }, env);

  return { success: true };
}

async function handleDeleteRepairRecord(data, env) {
  const { id } = data;
  if (!id) throw new Error('缺少紀錄 ID');
  await notion(`/pages/${id}`, 'PATCH', { archived: true }, env);
  return { success: true };
}

// ─── 意見回饋紀錄系統 ─────────────────────────────────────────────────────────────

async function handleSetupFeedbackDb(parentPageId, env) {
  const db = await notion('/databases', 'POST', {
    parent: { page_id: parentPageId },
    title: [{ text: { content: '📬 意見回饋紀錄' } }],
    properties: {
      '稱呼': { title: {} },
      '內容': { rich_text: {} },
      '照片': { rich_text: {} },
      '建立時間': { created_time: {} }
    }
  }, env);
  return { success: true, FEEDBACK_DB_ID: db.id };
}

// ─── 備註紀錄系統 ─────────────────────────────────────────────────────────────

async function handleSetupRemarksDb(parentPageId, env) {
  const db = await notion('/databases', 'POST', {
    parent: { page_id: parentPageId },
    title: [{ text: { content: '📝 住宿生備註紀錄' } }],
    properties: {
      '學號或姓名': { title: {} },
      '備註內容': { rich_text: {} },
      '建立時間': { created_time: {} },
      '最後更新時間': { last_edited_time: {} }
    }
  }, env);
  return { success: true, REMARKS_DB_ID: db.id };
}

async function handleGetRemarks(env) {
  if (!env.REMARKS_DB_ID) return {};
  const pages = await queryAll(env.REMARKS_DB_ID, null, null, env);
  const map = {};
  for(const p of pages) {
    const pageId = getTitle(p.properties['學號或姓名']);
    const text = getText(p.properties['備註內容']);
    if(pageId && text) map[pageId] = text;
  }
  return map;
}

async function handleUpdateRemark(data, env) {
  if(!env.REMARKS_DB_ID) throw new Error("REMARKS_DB_ID 未設定，請在環境設定中補齊");
  const { pageId, remark } = data;
  
  // 檢查是否已經有這個學生的備註記錄
  const existing = await notion(`/databases/${env.REMARKS_DB_ID}/query`, 'POST', {
     filter: { property: '學號或姓名', title: { equals: pageId } }
  }, env);
  
  if (existing.results.length > 0) {
     const docId = existing.results[0].id;
     await notion(`/pages/${docId}`, 'PATCH', {
        properties: { '備註內容': { rich_text: [{text:{content:remark || ''}}] } }
     }, env);
  } else if (remark) {
     await notion(`/pages`, 'POST', {
        parent: { database_id: env.REMARKS_DB_ID },
        properties: {
           '學號或姓名': { title: [{text:{content:pageId}}] },
           '備註內容': { rich_text: [{text:{content:remark}}] }
        }
     }, env);
  }
  return { success: true };
}

async function handleGetFeedbackRecords(env) {
  const dbId = env.FEEDBACK_DB_ID;
  if (!dbId) return [];
  // 以前只取最新 50 筆；現在分頁抓到最多 500 筆，回傳格式不變 (陣列)
  const results = await queryLatest(dbId, 5, env);

  return results.map(page => {
    const props = page.properties;
    let photos = [];
    try {
      const photoStr = props['照片']?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
      if (photoStr) photos = JSON.parse(photoStr);
    } catch (e) { /* ignore parse error */ }

    return {
      id: page.id,
      name: props['稱呼']?.title?.[0]?.text?.content || '匿名',
      content: props['內容']?.rich_text?.map(rt => rt.text?.content || '').join('') || '',
      photos: photos,
      createdAt: props['建立時間']?.created_time || ''
    };
  });
}

async function handleAddFeedbackRecord(data, env) {
  const dbId = env.FEEDBACK_DB_ID;
  if (!dbId) throw new Error('缺少 FEEDBACK_DB_ID 環境變數，請在開發者調試區設定');
  const { name, content, photos } = data;
  if (!content) throw new Error('缺少回饋內容');

  const photoJson = JSON.stringify(photos || []);
  const photoChunks = [];
  for (let i = 0; i < photoJson.length; i += 2000) {
    photoChunks.push({ text: { content: photoJson.slice(i, i + 2000) } });
  }

  await notion('/pages', 'POST', {
    parent: { database_id: dbId },
    properties: {
      '稱呼': { title: [{ text: { content: name || '匿名' } }] },
      '內容': { rich_text: [{ text: { content: content } }] },
      '照片': { rich_text: photoChunks.length > 0 ? photoChunks : [] }
    }
  }, env);

  return { success: true };
}

async function handleDeleteFeedbackRecord(data, env) {
  const { id } = data;
  if (!id) throw new Error('缺少紀錄 ID');
  await notion(`/pages/${id}`, 'PATCH', { archived: true }, env);
  return { success: true };
}

function getSetupHtml() {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>碧苑宿舍 - 系統初始化</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',sans-serif; background:#0a0a14; color:#e0e0e0; min-height:100vh;
         display:flex; align-items:center; justify-content:center; padding:20px; }
  .card { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
           border-radius:16px; padding:32px; max-width:600px; width:100%; }
  h1 { font-size:24px; margin-bottom:8px; }
  .sub { color:#888; margin-bottom:24px; font-size:14px; }
  label { display:block; margin-bottom:6px; font-size:13px; color:#aaa; }
  input[type=text] { width:100%; padding:12px; background:rgba(255,255,255,0.08);
    border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#fff;
    font-size:14px; margin-bottom:16px; outline:none; }
  input[type=text]:focus { border-color:#6366f1; }
  .drop-zone { border:2px dashed rgba(255,255,255,0.2); border-radius:12px; padding:40px;
    text-align:center; cursor:pointer; margin-bottom:16px; transition:border-color 0.3s; }
  .drop-zone:hover { border-color:#6366f1; }
  .drop-zone.active { border-color:#22c55e; background:rgba(34,197,94,0.05); }
  .drop-zone p { color:#888; font-size:14px; }
  .drop-zone .icon { font-size:36px; margin-bottom:8px; }
  .btn { width:100%; padding:14px; border:none; border-radius:10px; font-size:15px;
    font-weight:600; cursor:pointer; transition:all 0.3s; }
  .btn-primary { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; }
  .btn-primary:hover { transform:translateY(-1px); box-shadow:0 4px 20px rgba(99,102,241,0.4); }
  .btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
  .progress-wrap { margin:16px 0; display:none; }
  .progress-bar { height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden; }
  .progress-fill { height:100%; background:linear-gradient(90deg,#6366f1,#22c55e);
    border-radius:4px; transition:width 0.3s; width:0%; }
  .progress-text { font-size:12px; color:#888; margin-top:6px; text-align:center; }
  .result { margin-top:16px; padding:16px; background:rgba(34,197,94,0.1);
    border:1px solid rgba(34,197,94,0.3); border-radius:10px; display:none; }
  .result h3 { color:#22c55e; margin-bottom:8px; }
  .result .id-box { background:rgba(0,0,0,0.3); padding:10px; border-radius:6px;
    font-family:monospace; font-size:12px; word-break:break-all; margin:6px 0;
    cursor:pointer; position:relative; }
  .result .id-box:hover::after { content:'點擊複製'; position:absolute; right:8px; top:8px;
    font-size:11px; color:#6366f1; }
  .preview { margin:12px 0; padding:12px; background:rgba(255,255,255,0.03);
    border-radius:8px; font-size:13px; display:none; }
  .preview .stat { display:flex; justify-content:space-between; padding:4px 0;
    border-bottom:1px solid rgba(255,255,255,0.05); }
  .log { margin-top:12px; max-height:200px; overflow-y:auto; font-size:12px;
    font-family:monospace; color:#888; }
  .log .err { color:#ef4444; }
  .log .ok { color:#22c55e; }
</style>
</head>
<body>
<div class="card">
  <h1>🏠 碧苑宿舍點名系統</h1>
  <p class="sub">系統初始化精靈 - 上傳 CSV 自動建立 Notion 資料庫</p>

  <label>Notion 父頁面 ID</label>
  <input type="text" id="pageId" placeholder="貼上 Notion 頁面的 32 碼 ID">

  <div class="drop-zone" id="dropZone">
    <div class="icon">📄</div>
    <p>拖曳你的 CSV 點名單到這裡<br>或點擊選擇檔案</p>
  </div>
  <input type="file" id="fileInput" accept=".csv" style="display:none">

  <div class="preview" id="preview"></div>

  <button class="btn btn-primary" id="startBtn" disabled>🚀 開始建立資料庫 + 匯入資料</button>

  <div class="progress-wrap" id="progressWrap">
    <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
    <div class="progress-text" id="progressText">準備中...</div>
  </div>

  <div class="result" id="result"></div>
  <div class="log" id="log"></div>
</div>

<script>
const $ = id => document.getElementById(id);
let parsedData = null;

// ── Drop zone ──
const dropZone = $('dropZone');
const fileInput = $('fileInput');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('active'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('active');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      parsedData = parseCSV(e.target.result);
      showPreview(parsedData);
      dropZone.innerHTML = '<div class="icon">✅</div><p>' + file.name + ' 已載入</p>';
      $('startBtn').disabled = !$('pageId').value;
    } catch (err) {
      dropZone.innerHTML = '<div class="icon">❌</div><p>解析失敗: ' + err.message + '</p>';
    }
  };
  reader.readAsText(file, 'UTF-8');
}

$('pageId').addEventListener('input', () => {
  $('startBtn').disabled = !($('pageId').value && parsedData);
});

// ── CSV 解析 ──
function parseCSV(text) {
  // 簡易 CSV 解析器（處理引號內的逗號）
  const lines = text.split(/\\r?\\n/).filter(l => l.trim());
  const parseLine = line => {
    const result = []; let current = ''; let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };

  const header = parseLine(lines[0]);
  // 找出日期欄位（格式: X月X日）
  const dateRegex = /^\\d{1,2}月\\d{1,2}日$/;
  const dateColumns = header.filter(h => dateRegex.test(h));
  const dateIndices = dateColumns.map(d => header.indexOf(d));

  // 中隊判斷
  function getSquad(room) {
    if (!room) return '一單';
    const match = room.match(/B?(\\d)(\\d{2})/);
    if (!match) return '一單';
    const floor = match[1];
    const roomNum = parseInt(match[2]);
    const isOdd = roomNum % 2 === 1;
    if (floor === '1') return isOdd ? '一單' : '一雙';
    if (floor === '2') return isOdd ? '二單' : '二雙';
    if (floor === '3') return isOdd ? '三單' : '三雙';
    return '一單';
  }

  // 外籍生判斷
  function isForeignStudent(className) {
    if (!className) return false;
    return /越南|華語專班|產攜班/i.test(className);
  }

  // 解析學生
  const students = [];
  const roomBeds = {}; // 追蹤每個房間有哪些床

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const room = cols[1] || '';
    const bed = cols[2] || '';
    if (!room || !bed || !['A','B','C','D'].includes(bed)) continue;
    // 跳過底部的符號模板行（沒有房號的行）
    if (!room.match(/B?\\d{3}/)) continue;

    const name = cols[0] || '';
    const className = cols[3] || '';
    const studentId = cols[4] || '';
    const normalizedRoom = room.startsWith('B') ? room : 'B' + room;

    // 記錄此房間有的床位
    if (!roomBeds[normalizedRoom]) roomBeds[normalizedRoom] = new Set();
    roomBeds[normalizedRoom].add(bed);

    const attendance = {};
    for (let j = 0; j < dateColumns.length; j++) {
      const val = cols[dateIndices[j]] || '';
      if (['✓','◎','✘','△'].includes(val)) {
        attendance[dateColumns[j]] = val;
      }
    }

    students.push({
      name, room: normalizedRoom, bed, class: className, studentId,
      squad: getSquad(normalizedRoom),
      isForeign: isForeignStudent(className),
      isEmpty: !name,
      attendance,
    });
  }

  // ── 硬性房間規則 ──
  const DOUBLE_ROOMS = ['B118','B120','B122','B124','B126'];
  const STORAGE_ROOMS = ['B128'];

  // ── 自動補齊：依規則補齊床位 ──
  const rooms = [...new Set(students.map(s => s.room))];
  let added = 0;
  for (const room of rooms) {
    // 儲藏室不補
    if (STORAGE_ROOMS.includes(room)) continue;
    // 雙人房只補 A/B
    const allBeds = DOUBLE_ROOMS.includes(room) ? ['A','B'] : ['A','B','C','D'];
    const existing = roomBeds[room] || new Set();
    for (const bed of allBeds) {
      if (!existing.has(bed)) {
        // 補一個空床
        const defaultAttendance = {};
        for (const d of dateColumns) defaultAttendance[d] = '✓';
        students.push({
          name: '', room, bed, class: '', studentId: '',
          squad: getSquad(room),
          isForeign: false, isEmpty: true,
          attendance: defaultAttendance,
        });
        added++;
      }
    }
  }

  // 依房號+床號排序
  students.sort((a, b) => a.room.localeCompare(b.room) || a.bed.localeCompare(b.bed));

  return { dateColumns, students, added };
}

function showPreview(data) {
  const squads = {};
  let foreign = 0, empty = 0;
  for (const s of data.students) {
    squads[s.squad] = (squads[s.squad] || 0) + 1;
    if (s.isForeign) foreign++;
    if (s.isEmpty) empty++;
  }
  let html = '<div class="stat"><span>總學生數</span><b>' + data.students.length + '</b></div>';
  html += '<div class="stat"><span>日期欄位數</span><b>' + data.dateColumns.length + '</b></div>';
  html += '<div class="stat"><span>外籍生</span><b>' + foreign + '</b></div>';
  html += '<div class="stat"><span>空床</span><b>' + empty + '</b></div>';
  if (data.added > 0) html += '<div class="stat"><span>🔧 自動補齊床位</span><b style="color:#f59e0b">+' + data.added + '</b></div>';
  for (const [sq, count] of Object.entries(squads).sort()) {
    html += '<div class="stat"><span>' + sq + '</span><b>' + count + '</b></div>';
  }
  $('preview').innerHTML = html;
  $('preview').style.display = 'block';
}

// ── 執行 ──
$('startBtn').addEventListener('click', run);

async function run() {
  const pageId = $('pageId').value.replace(/-/g, '').trim();
  if (!pageId || !parsedData) return;

  $('startBtn').disabled = true;
  $('progressWrap').style.display = 'block';
  const log = $('log');
  log.innerHTML = '';

  function addLog(msg, type) {
    log.innerHTML += '<div class="' + (type||'') + '">' + msg + '</div>';
    log.scrollTop = log.scrollHeight;
  }

  try {
    // Step 1: 建立資料庫
    addLog('⏳ 建立 Notion 資料庫（' + parsedData.dateColumns.length + ' 個日期欄位）...');
    $('progressText').textContent = '建立資料庫...';
    $('progressFill').style.width = '5%';

    const initRes = await fetch('/api/init-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent_page_id: pageId,
        date_columns: parsedData.dateColumns,
      }),
    }).then(r => r.json());

    if (initRes.error) throw new Error(initRes.error);
    addLog('✅ 資料庫建立成功！', 'ok');
    addLog('   MASTER_DB_ID: ' + initRes.master_db_id, 'ok');
    addLog('   CONFIG_DB_ID: ' + initRes.config_db_id, 'ok');

    // Step 2: 批次匯入
    const BATCH_SIZE = 20; // 後端 import-batch 單次上限 20 筆
    const total = parsedData.students.length;
    let imported = 0;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = parsedData.students.slice(i, i + BATCH_SIZE);
      const pct = Math.round(10 + (i / total) * 85);
      $('progressFill').style.width = pct + '%';
      $('progressText').textContent = '匯入中... ' + imported + '/' + total;
      addLog('⏳ 匯入第 ' + (Math.floor(i/BATCH_SIZE)+1) + ' 批（' + batch.length + ' 筆）...');

      const batchRes = await fetch('/api/import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db_id: initRes.master_db_id, students: batch }),
      }).then(r => r.json());

      if (batchRes.error) throw new Error(batchRes.error);
      imported += batchRes.imported;
      if (batchRes.errors.length) {
        for (const e of batchRes.errors) addLog('⚠️ ' + e.name + ' ' + e.room + e.bed + ': ' + e.error, 'err');
      }
      addLog('✅ 已匯入 ' + imported + '/' + total, 'ok');
    }

    $('progressFill').style.width = '100%';
    $('progressText').textContent = '完成！共匯入 ' + imported + ' 筆';

    // 顯示結果
    const result = $('result');
    result.style.display = 'block';
    result.innerHTML = '<h3>🎉 初始化完成！</h3>'
      + '<p>請到 Cloudflare Worker 設定以下環境變數：</p>'
      + '<label style="margin-top:12px;display:block">MASTER_DB_ID</label>'
      + '<div class="id-box" onclick="navigator.clipboard.writeText(this.textContent)">' + initRes.master_db_id + '</div>'
      + '<label>CONFIG_DB_ID</label>'
      + '<div class="id-box" onclick="navigator.clipboard.writeText(this.textContent)">' + initRes.config_db_id + '</div>';

  } catch (err) {
    addLog('❌ 錯誤：' + err.message, 'err');
    $('progressText').textContent = '發生錯誤';
    $('startBtn').disabled = false;
  }
}
</script>
</body>
</html>`;
}
