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
          if (!env.GEMINI_API_KEY) {
            return new Response(JSON.stringify({ error: { message: '伺服器尚未設定 GEMINI_API_KEY' } }), { 
              status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });
          }
          
          const body = await request.text();
          
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
          });
          
          const data = await geminiRes.text();
          return new Response(data, {
            status: geminiRes.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
