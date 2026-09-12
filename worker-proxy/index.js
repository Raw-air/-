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

async function notion(path, method, body, env) {
  const res = await fetch(`${NOTION_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
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
  };
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
  if (env.POLL_KV) await env.POLL_KV.put(SEMESTER_KEY, text);
  if (env.CONFIG_DB_ID) await handleSetConfig({ [SEMESTER_KEY]: text }, env);
  return st;
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
async function updatePollSignal(env, updates = {}) {
  if (!env.POLL_KV) return; // KV 未綁定時靜默跳過
  try {
    const existing = await env.POLL_KV.get('poll_state', 'json') || {};
    const newState = {
      ts: Date.now(),
      confirms: existing.confirms || '',
      att_ts: existing.att_ts || 0,
      ...updates,
    };
    await env.POLL_KV.put('poll_state', JSON.stringify(newState));
  } catch (e) {
    console.error('KV update failed:', e);
  }
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
        if (!env.POLL_KV) return json({ ts: 0, confirms: '', att_ts: 0 });
        const state = await env.POLL_KV.get('poll_state', 'json');
        return json(state || { ts: 0, confirms: '', att_ts: 0 });
      }

      if (path === '/api/init-db' && request.method === 'POST') {
        const data = await request.json();
        return json(await handleInitDb(data, env));
      }

      if (path === '/api/import-batch' && request.method === 'POST') {
        const data = await request.json();
        return json(await handleImportBatch(data, env));
      }

      if (path === '/api/roster' && request.method === 'GET') {
        const semester = url.searchParams.get('semester') || '';
        const target = await resolveSemesterDbId(semester, env);
        const roster = await handleGetRoster(env, target.dbId);
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
        const result = await handleUpdateAttendance(data, env);
        // ⚡ 出席資料變更 → 更新 KV 信號
        await updatePollSignal(env, { att_ts: Date.now() });
        return json(result);
      }

      if (path === '/api/swap-beds' && request.method === 'POST') {
        const data = await request.json();
        return json(await handleSwapBeds(data, env));
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
          await updatePollSignal(env, { confirms: data[confirmKey] || '' });
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
          return json(await handleGetLeaveRecords(env));
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
// API: 批次匯入學生（每次最多 45 筆，受 CF 50 subrequest 限制）
// ════════════════════════════════════════════════════════════════════════════════
async function handleImportBatch(data, env) {
  const dbId = data.db_id || await getMasterDbId(env);

  const { students } = data;
  if (!students || !students.length) throw new Error('缺少 students');

  let imported = 0;
  const errors = [];

  for (const s of students.slice(0, 45)) {
    try {
      const properties = {
        '姓名': { title: [{ text: { content: s.name || '' } }] },
        '寢床號': { rich_text: [{ text: { content: s.room || '' } }] },
        '床號': { select: { name: s.bed || 'A' } },
        '班別': { rich_text: [{ text: { content: s.class || '' } }] },
        '學號': { rich_text: [{ text: { content: s.studentId || '' } }] },
        '中隊': { select: { name: s.squad || '一單' } },
        '外籍生': { checkbox: !!s.isForeign },
        '空床': { checkbox: !!s.isEmpty },
      };

      // 加入日期欄位
      if (s.attendance) {
        for (const [date, value] of Object.entries(s.attendance)) {
          if (value) {
            properties[date] = { select: { name: value } };
          }
        }
      }

      await notion('/pages', 'POST', {
        parent: { database_id: dbId },
        properties,
      }, env);

      imported++;
      await sleep(340);
    } catch (err) {
      errors.push({ name: s.name, room: s.room, bed: s.bed, error: err.message });
    }
  }

  return { success: true, imported, errors, total: students.length };
}

// ════════════════════════════════════════════════════════════════════════════════
// API: 取得全部學生 + 全部日期資料
// ════════════════════════════════════════════════════════════════════════════════
async function handleGetRoster(env, dbIdOverride) {
  const dbId = dbIdOverride || await getMasterDbId(env);

  // 取得資料庫結構（知道哪些是日期欄位）
  const dbInfo = await notion(`/databases/${dbId}`, 'GET', null, env);
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
        properties['外籍生'] = { checkbox: false };
      }

      if (u.updateProfile) {
        properties['姓名'] = { title: [{ text: { content: u.updateProfile.name || '' } }] };
        properties['班別'] = { rich_text: [{ text: { content: u.updateProfile.class || '' } }] };
        properties['學號'] = { rich_text: [{ text: { content: u.updateProfile.studentId || '' } }] };
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

/**
 * 封存本學期並建立新學期資料庫：
 * 1. 目前總表改名「碧苑點名總表 <舊學期>」原封保留
 * 2. 在同一個 Notion 父頁面建立「碧苑點名總表 <新學期>」，欄位 = 固定欄位 + 新學期每一天
 * 3. 切換目前學期指向新資料庫
 * 4. 回傳床位清單，由前端分批呼叫 /api/import-batch 建立床位 (Worker 單次請求有子請求上限)
 */
async function handleArchiveSemester(data, env) {
  const { newName, start, end, currentName, carryResidents } = data || {};
  const cleanNew = String(newName || '').trim();
  if (!cleanNew) throw new Error('缺少新學期名稱');
  const dates = isoRange(start, end);
  const st = await getSemesterState(env);
  const oldDbId = st.current.dbId;
  if (!oldDbId) throw new Error('目前沒有點名總表資料庫');
  const oldName = String(st.current.name || currentName || '').trim() || '舊學期';
  if (oldName === cleanNew) throw new Error('新學期名稱不能跟目前學期一樣');
  if (st.archives.some(a => a.name === cleanNew)) throw new Error(`已經有封存的學期「${cleanNew}」`);

  const dbInfo = await notion(`/databases/${oldDbId}`, 'GET', null, env);
  const parentPageId = dbInfo.parent?.page_id;
  if (!parentPageId) throw new Error('目前總表不在 Notion 頁面底下，無法在旁邊建立新學期總表');
  await sleep(340);

  // 1. 舊表改名保留
  await notion(`/databases/${oldDbId}`, 'PATCH', { title: [{ text: { content: `碧苑點名總表 ${oldName}` } }] }, env);
  await sleep(340);

  // 2. 建新表
  const properties = masterFixedProperties();
  for (const d of dates) properties[d] = { select: { options: ATTENDANCE_OPTIONS.map(o => ({ ...o })) } };
  const newDb = await notion('/databases', 'POST', {
    parent: { page_id: parentPageId },
    title: [{ text: { content: `碧苑點名總表 ${cleanNew}` } }],
    properties,
  }, env);
  await sleep(340);

  // 3. 床位清單 (帶或不帶目前住宿生)
  const pages = await queryAll(oldDbId, null, [
    { property: '寢床號', direction: 'ascending' },
    { property: '床號', direction: 'ascending' },
  ], env);
  const carry = carryResidents !== false;
  const beds = pages.map(page => {
    const p = page.properties;
    const isEmpty = getCheckbox(p['空床']) || !getTitle(p['姓名']).trim();
    const keep = carry && !isEmpty;
    return {
      room: getText(p['寢床號']), bed: getSelect(p['床號']) || 'A', squad: getSelect(p['中隊']) || '一單',
      name: keep ? getTitle(p['姓名']) : '', class: keep ? getText(p['班別']) : '', studentId: keep ? getText(p['學號']) : '',
      isForeign: keep ? getCheckbox(p['外籍生']) : false, isEmpty: !keep, attendance: {},
    };
  }).filter(b => b.room);

  // 4. 切換學期
  st.archives.push({ name: oldName, dbId: oldDbId, start: st.current.start, end: st.current.end, archivedAt: new Date().toISOString() });
  st.current = { name: cleanNew, dbId: newDb.id, start, end };
  const saved = await saveSemesterState(st, env);

  return { success: true, newDbId: newDb.id, archived: { name: oldName, dbId: oldDbId }, current: saved.current, beds };
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
  for (const page of pages) {
    const key = getTitle(page.properties['鍵']);
    const value = getText(page.properties['值']);
    if (key) config[key] = value;
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
    if (key) existing[key] = page.id;
  }

  const results = {};
  for (const [key, value] of Object.entries(data)) {
    await sleep(340);
    if (existing[key]) {
      await notion(`/pages/${existing[key]}`, 'PATCH', {
        properties: { '值': { rich_text: richTextChunks(value) } },
      }, env);
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
      '建立時間': { created_time: {} }
    }
  }, env);
  return { success: true, LEAVE_DB_ID: db.id };
}

async function handleGetLeaveRecords(env) {
  const dbId = env.LEAVE_DB_ID;
  if (!dbId) return [];
  const res = await notion(`/databases/${dbId}/query`, 'POST', {
    sorts: [{ property: '建立時間', direction: 'descending' }],
    page_size: 50
  }, env);
  
  if (!res.results) return [];
  
  return res.results.map(page => {
    const props = page.properties;
    return {
      id: page.id,
      title: props['標題']?.title[0]?.plain_text || '',
      name: props['姓名']?.rich_text[0]?.plain_text || '',
      roomBed: props['房號床位']?.rich_text[0]?.plain_text || '',
      dateStart: props['請假範圍']?.date?.start || '',
      dateEnd: props['請假範圍']?.date?.end || '',
      handler: props['處理人']?.rich_text[0]?.plain_text || '',
      createdAt: props['建立時間']?.created_time || ''
    };
  });
}

async function handleAddLeaveRecord(data, env) {
  const dbId = env.LEAVE_DB_ID;
  const { name, roomBed, dateStart, dateEnd, handler } = data;
  if (!dbId) throw new Error('缺少 LEAVE_DB_ID 環境變數，請在 Cloudflare 設定');
  
  await notion('/pages', 'POST', {
    parent: { database_id: dbId },
    properties: {
      '標題': { title: [{ text: { content: `${name} 的請假申請` } }] },
      '姓名': { rich_text: [{ text: { content: name || '' } }] },
      '房號床位': { rich_text: [{ text: { content: roomBed || '' } }] },
      '請假範圍': { date: { start: dateStart, end: dateEnd } },
      '處理人': { rich_text: [{ text: { content: handler || '' } }] }
    }
  }, env);
  
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

async function handleGetRepairRecords(env) {
  const dbId = env.REPAIR_DB_ID;
  if (!dbId) return [];
  const res = await notion(`/databases/${dbId}/query`, 'POST', {
    sorts: [{ property: '建立時間', direction: 'descending' }],
    page_size: 50
  }, env);

  if (!res.results) return [];

  return res.results.map(page => {
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
    '標題': { title: [{ text: { content: (reporter || '未知') + ' 的報修通知 ' + new Date().toISOString().slice(0, 10) } }] },
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
  const res = await notion(`/databases/${dbId}/query`, 'POST', {
    sorts: [{ property: '建立時間', direction: 'descending' }],
    page_size: 50
  }, env);

  if (!res.results) return [];

  return res.results.map(page => {
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
    const BATCH_SIZE = 40;
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
