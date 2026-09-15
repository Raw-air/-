/**
 * 碧苑宿舍管理系統 - Cloudflare Worker API
 * 部署教學：
 * 1. 安裝 Wrangler: npm install -g wrangler
 * 2. 登入: wrangler login
 * 3. 建立 KV: wrangler kv:namespace create "DORM_DB"
 * 4. 將生成的 id 填入 wrangler.toml
 * 5. 部署: wrangler deploy
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ===== /api/ai-parse 防護 =====
// 這條路由會拿 GEMINI_API_KEY 幫忙轉發，不能讓任何人隨便打；系統沒有真正登入，改用來源白名單 + 速率限制
// 白名單：正式站、本機測試；env.ALLOWED_ORIGINS (逗號分隔，可選) 可以再補
const AI_ALLOWED_ORIGIN_RULES = [
  /^https:\/\/raw-air\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
const AI_RATE_LIMIT_IP_PER_HOUR = 30; // 每個 IP 每小時上限
const AI_RATE_LIMIT_DAY_TOTAL = 300;  // 全站每天上限
// 值星表照片是整張 base64 放在 body 裡 (手機原圖動輒數 MB)，上限比照 Gemini inline data 的 20MB
const AI_MAX_BODY_BYTES = 20 * 1024 * 1024;

// 從 Origin (沒有就退回 Referer) 判斷來源；命中回傳那個 origin 字串，否則回 null
function matchAiOrigin(request, env) {
  let origin = request.headers.get('Origin');
  if (!origin) {
    const referer = request.headers.get('Referer');
    if (!referer) return null;
    try { origin = new URL(referer).origin; } catch { return null; }
  }
  if (AI_ALLOWED_ORIGIN_RULES.some(re => re.test(origin))) return origin;
  const extra = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return extra.includes(origin) ? origin : null;
}

// KV 計數器 (最終一致，容許少量超額)：超限回傳中文訊息；沒超限就把計數 +1 並回 null
async function checkAiRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const tw = new Date(Date.now() + 8 * 3600 * 1000).toISOString(); // 台灣時間
  const ipKey = `ai_rl_ip_${ip}_${tw.slice(0, 13)}`; // 例：ai_rl_ip_1.2.3.4_2026-09-15T08
  const dayKey = `ai_rl_day_${tw.slice(0, 10)}`;     // 例：ai_rl_day_2026-09-15
  const [ipCount, dayCount] = (await Promise.all([env.DORM_DB.get(ipKey), env.DORM_DB.get(dayKey)])).map(v => parseInt(v, 10) || 0);
  if (ipCount >= AI_RATE_LIMIT_IP_PER_HOUR) return `這個網路位址本小時的 AI 辨識次數已達上限 (${AI_RATE_LIMIT_IP_PER_HOUR} 次)，請稍後再試`;
  if (dayCount >= AI_RATE_LIMIT_DAY_TOTAL) return `今天全站的 AI 辨識次數已達上限 (${AI_RATE_LIMIT_DAY_TOTAL} 次)，請明天再試`;
  // 先計數再轉發，失敗的請求也算次數；KV 同一鍵每秒只能寫一次，撞到就略過，不能因此擋掉正常請求
  await Promise.all([
    env.DORM_DB.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 }),
    env.DORM_DB.put(dayKey, String(dayCount + 1), { expirationTtl: 86400 }),
  ].map(p => p.catch(() => {})));
  return null;
}

export default {
  async fetch(request, env) {
    // 處理 CORS 預檢請求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ===== 請假紀錄 API =====
      if (path === '/api/leave-records') {
        if (request.method === 'GET') {
          const records = await env.DORM_DB.get('leave-records', { type: 'json' }) || [];
          return new Response(JSON.stringify(records), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (request.method === 'POST') {
          const body = await request.json();
          const records = await env.DORM_DB.get('leave-records', { type: 'json' }) || [];
          
          const newRecord = {
            id: Date.now().toString(),
            name: body.name,
            room: body.room,
            date: body.date,
            reason: body.reason,
            timestamp: Date.now()
          };
          
          records.push(newRecord);
          // 僅保留最近的 100 筆紀錄
          if (records.length > 100) records.shift();
          
          await env.DORM_DB.put('leave-records', JSON.stringify(records));
          return new Response(JSON.stringify({ success: true, record: newRecord }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (request.method === 'DELETE') {
          const body = await request.json();
          let records = await env.DORM_DB.get('leave-records', { type: 'json' }) || [];
          records = records.filter(r => r.id !== body.id);
          await env.DORM_DB.put('leave-records', JSON.stringify(records));
          return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // ===== 報修紀錄 API =====
      if (path === '/api/repair-records') {
        if (request.method === 'GET') {
          const records = await env.DORM_DB.get('repair-records', { type: 'json' }) || [];
          return new Response(JSON.stringify(records), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (request.method === 'POST') {
          const body = await request.json();
          const records = await env.DORM_DB.get('repair-records', { type: 'json' }) || [];
          
          const newRecord = {
            id: Date.now().toString(),
            reporter: body.reporter || body.name,
            location: body.location,
            equipment: body.equipment,
            description: body.description,
            timestamp: Date.now()
          };
          
          records.push(newRecord);
          if (records.length > 100) records.shift();
          
          await env.DORM_DB.put('repair-records', JSON.stringify(records));
          return new Response(JSON.stringify({ success: true, record: newRecord }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (request.method === 'DELETE') {
          const body = await request.json();
          let records = await env.DORM_DB.get('repair-records', { type: 'json' }) || [];
          records = records.filter(r => r.id !== body.id);
          await env.DORM_DB.put('repair-records', JSON.stringify(records));
          return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // ===== 意見回饋 API =====
      if (path === '/api/feedback-records') {
        if (request.method === 'GET') {
          const records = await env.DORM_DB.get('feedback-records', { type: 'json' }) || [];
          return new Response(JSON.stringify(records), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (request.method === 'POST') {
          const body = await request.json();
          const records = await env.DORM_DB.get('feedback-records', { type: 'json' }) || [];
          
          const newRecord = {
            id: Date.now().toString(),
            name: body.name || '匿名用戶',
            content: body.content,
            timestamp: Date.now()
          };
          
          records.push(newRecord);
          if (records.length > 100) records.shift();
          
          await env.DORM_DB.put('feedback-records', JSON.stringify(records));
          return new Response(JSON.stringify({ success: true, record: newRecord }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (request.method === 'DELETE') {
          const body = await request.json();
          let records = await env.DORM_DB.get('feedback-records', { type: 'json' }) || [];
          records = records.filter(r => r.id !== body.id);
          await env.DORM_DB.put('feedback-records', JSON.stringify(records));
          return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // ===== Gemini API Proxy =====
      if (path === '/api/ai-parse') {
        if (request.method === 'POST') {
          // 1. 來源白名單：沒有 Origin 也沒有 Referer (例如 curl) 一律 403
          const origin = matchAiOrigin(request, env);
          if (!origin) {
            return new Response(JSON.stringify({ error: { message: '不允許的來源' } }), {
              status: 403, headers: { 'Content-Type': 'application/json' }
            });
          }
          // CORS 只回「命中的那個 origin」，不再回 *
          const aiHeaders = { ...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Content-Type': 'application/json' };

          if (!env.GEMINI_API_KEY) {
            return new Response(JSON.stringify({ error: { message: '伺服器尚未設定 GEMINI_API_KEY' } }), {
              status: 500, headers: aiHeaders
            });
          }

          // 2. body 大小上限：先看 Content-Length 省得白讀，讀完再確認一次
          const tooLarge = () => new Response(JSON.stringify({ error: { message: '圖片太大，請縮小後再試' } }), { status: 413, headers: aiHeaders });
          if ((parseInt(request.headers.get('Content-Length'), 10) || 0) > AI_MAX_BODY_BYTES) return tooLarge();

          // 3. 速率限制 (每 IP 每小時、全站每天)
          const limited = await checkAiRateLimit(request, env);
          if (limited) {
            return new Response(JSON.stringify({ error: { message: limited } }), { status: 429, headers: aiHeaders });
          }

          const body = await request.arrayBuffer();
          if (body.byteLength > AI_MAX_BODY_BYTES) return tooLarge();

          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
          });

          const data = await geminiRes.text();
          return new Response(data, {
            status: geminiRes.status,
            headers: aiHeaders
          });
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
      
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }
};
