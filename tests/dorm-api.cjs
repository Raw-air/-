// 後端 (worker.js，dorm-api) /api/ai-parse 防護測試：來源白名單、速率限制、body 上限；用假 KV 與假 Gemini 跑真正的 handler
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

// 假 KV：get 支援 worker.js 用的 {type:'json'} 寫法，put 記下 expirationTtl 方便檢查
function makeKV(){const store={},puts=[];return {store,puts,
  async get(k,opt){const v=store[k];if(v===undefined)return null;const t=typeof opt==='string'?opt:(opt&&opt.type);return t==='json'?JSON.parse(v):v;},
  async put(k,v,opt){store[k]=v;puts.push({k,v,opt});}};}

(async()=>{
  const src=fs.readFileSync(path.join(root,'worker.js'),'utf8');
  const tmp=path.join(os.tmpdir(),'biyuan-dorm-api-test-'+Date.now()+'.mjs');fs.writeFileSync(tmp,src);
  const mod=await import('file:///'+tmp.replace(/\\/g,'/'));const worker=mod.default;
  fs.unlinkSync(tmp);

  // 假 Gemini：記下收到的東西，回一個固定答案
  const gemini=[];
  global.fetch=async(url,init={})=>{
    if(String(url).startsWith('https://generativelanguage.googleapis.com')){gemini.push({url:String(url),init});return {status:200,text:async()=>JSON.stringify({candidates:[{content:{parts:[{text:'[]'}]}}]})};}
    throw new Error('unexpected fetch '+url);
  };

  let kv=makeKV();
  const env={GEMINI_API_KEY:'secret-key',DORM_DB:kv};
  const payload=JSON.stringify({contents:[{parts:[{text:'hi'}]}]});
  const call=async(p,{method='POST',headers={},body=payload,e=env}={})=>{const r=await worker.fetch(new Request('https://dorm-api.test'+p,{method,headers:{'Content-Type':'application/json',...headers},body:method==='GET'||method==='OPTIONS'?undefined:body}),e);let data=null;try{data=await r.json();}catch{}return {status:r.status,data,h:r.headers};};

  // 1. 沒 Origin 也沒 Referer (curl) → 403，也不會碰 Gemini
  let r=await call('/api/ai-parse');
  assert.equal(r.status,403);assert.match(r.data.error.message,/來源/);assert.equal(gemini.length,0);
  // 不在白名單的來源一樣 403
  r=await call('/api/ai-parse',{headers:{Origin:'https://evil.example'}});assert.equal(r.status,403);
  r=await call('/api/ai-parse',{headers:{Origin:'https://raw-air.github.io.evil.example'}});assert.equal(r.status,403);
  r=await call('/api/ai-parse',{headers:{Origin:'http://localhost.evil.example:3000'}});assert.equal(r.status,403);
  r=await call('/api/ai-parse',{headers:{Referer:'https://evil.example/page'}});assert.equal(r.status,403);
  assert.equal(gemini.length,0);

  // 2. 白名單 Origin → 轉發到 Gemini，key 只在後端 URL 裡，CORS 回命中的 origin 而不是 *
  r=await call('/api/ai-parse',{headers:{Origin:'https://raw-air.github.io','CF-Connecting-IP':'1.1.1.1'}});
  assert.equal(r.status,200);assert.equal(r.data.candidates[0].content.parts[0].text,'[]');
  assert.equal(gemini.length,1);assert.match(gemini[0].url,/key=secret-key/);assert.equal(Buffer.from(gemini[0].init.body).toString(),payload,'body 原樣轉發');
  assert.equal(r.h.get('Access-Control-Allow-Origin'),'https://raw-air.github.io');assert.equal(r.h.get('Vary'),'Origin');
  // 本機測試：localhost / 127.0.0.1 任意埠
  r=await call('/api/ai-parse',{headers:{Origin:'http://localhost:5173','CF-Connecting-IP':'1.1.1.2'}});assert.equal(r.status,200);assert.equal(r.h.get('Access-Control-Allow-Origin'),'http://localhost:5173');
  r=await call('/api/ai-parse',{headers:{Origin:'http://127.0.0.1:8080','CF-Connecting-IP':'1.1.1.3'}});assert.equal(r.status,200);
  r=await call('/api/ai-parse',{headers:{Origin:'https://localhost:5173','CF-Connecting-IP':'1.1.1.3'}});assert.equal(r.status,403,'https 的 localhost 不在白名單');
  // 只有 Referer (沒 Origin) 也認得出來源
  r=await call('/api/ai-parse',{headers:{Referer:'https://raw-air.github.io/-/index.html','CF-Connecting-IP':'1.1.1.4'}});assert.equal(r.status,200);assert.equal(r.h.get('Access-Control-Allow-Origin'),'https://raw-air.github.io');
  // env.ALLOWED_ORIGINS 可以再補來源
  r=await call('/api/ai-parse',{headers:{Origin:'https://staging.example','CF-Connecting-IP':'1.1.1.5'}});assert.equal(r.status,403);
  r=await call('/api/ai-parse',{headers:{Origin:'https://staging.example','CF-Connecting-IP':'1.1.1.5'},e:{...env,ALLOWED_ORIGINS:' https://a.example, https://staging.example '}});assert.equal(r.status,200);assert.equal(r.h.get('Access-Control-Allow-Origin'),'https://staging.example');
  // 沒設 key 照舊回 500 (但要先過白名單)
  r=await call('/api/ai-parse',{headers:{Origin:'https://raw-air.github.io'},e:{DORM_DB:kv}});assert.equal(r.status,500);assert.match(r.data.error.message,/GEMINI_API_KEY/);
  r=await call('/api/ai-parse',{e:{DORM_DB:kv}});assert.equal(r.status,403);

  // 3. 速率限制：同 IP 第 31 次 → 429；別的 IP 不受影響；KV 鍵有帶 expirationTtl
  kv=makeKV();env.DORM_DB=kv;gemini.length=0;
  const ipHeaders={Origin:'https://raw-air.github.io','CF-Connecting-IP':'9.9.9.9'};
  for(let i=0;i<30;i++){r=await call('/api/ai-parse',{headers:ipHeaders});assert.equal(r.status,200,'第 '+(i+1)+' 次應該放行');}
  assert.equal(gemini.length,30);
  r=await call('/api/ai-parse',{headers:ipHeaders});
  assert.equal(r.status,429);assert.match(r.data.error.message,/上限/);assert.equal(gemini.length,30,'超限不會再打 Gemini');
  assert.equal(r.h.get('Access-Control-Allow-Origin'),'https://raw-air.github.io','429 也要帶 CORS，前端才讀得到訊息');
  r=await call('/api/ai-parse',{headers:{...ipHeaders,'CF-Connecting-IP':'9.9.9.10'}});assert.equal(r.status,200,'別的 IP 不受影響');
  const ipKeys=Object.keys(kv.store).filter(k=>k.startsWith('ai_rl_ip_9.9.9.9_'));assert.equal(ipKeys.length,1);assert.equal(kv.store[ipKeys[0]],'30');
  const dayKeys=Object.keys(kv.store).filter(k=>k.startsWith('ai_rl_day_'));assert.equal(dayKeys.length,1);assert.match(dayKeys[0],/^ai_rl_day_\d{4}-\d{2}-\d{2}$/);assert.equal(kv.store[dayKeys[0]],'31');
  assert.ok(kv.puts.every(p=>p.opt&&p.opt.expirationTtl>0),'計數器都要有過期時間');
  assert.equal(kv.puts.find(p=>p.k===ipKeys[0]).opt.expirationTtl,3600);assert.equal(kv.puts.find(p=>p.k===dayKeys[0]).opt.expirationTtl,86400);
  // 全站每天 300 次
  kv.store[dayKeys[0]]='300';
  r=await call('/api/ai-parse',{headers:{...ipHeaders,'CF-Connecting-IP':'9.9.9.11'}});assert.equal(r.status,429);assert.match(r.data.error.message,/今天/);
  kv.store[dayKeys[0]]='299';
  r=await call('/api/ai-parse',{headers:{...ipHeaders,'CF-Connecting-IP':'9.9.9.11'}});assert.equal(r.status,200);
  // KV 寫入撞到每秒一次限制 (put 拋錯) 不能擋掉正常請求
  kv.store[dayKeys[0]]='0';
  {const realPut=kv.put;kv.put=async()=>{throw new Error('KV PUT failed: 429');};
   r=await call('/api/ai-parse',{headers:{...ipHeaders,'CF-Connecting-IP':'9.9.9.12'}});assert.equal(r.status,200,'KV 寫入失敗仍放行');kv.put=realPut;}

  // 4. body 太大 → 413 (Content-Length 先擋；沒帶 Content-Length 讀完也擋)
  kv=makeKV();env.DORM_DB=kv;gemini.length=0;
  const big='x'.repeat(20*1024*1024+1);
  r=await call('/api/ai-parse',{headers:{...ipHeaders,'Content-Length':String(big.length)},body:big});assert.equal(r.status,413);assert.match(r.data.error.message,/太大/);
  r=await call('/api/ai-parse',{headers:ipHeaders,body:big});assert.equal(r.status,413);
  assert.equal(gemini.length,0);
  // 幾 MB 的照片 (base64) 要能過
  const photo=JSON.stringify({contents:[{parts:[{text:'p'},{inlineData:{mimeType:'image/jpeg',data:'A'.repeat(5*1024*1024)}}]}]});
  r=await call('/api/ai-parse',{headers:ipHeaders,body:photo});assert.equal(r.status,200);assert.equal(gemini.length,1);

  // 5. 其他路由行為不變：不看來源、CORS 仍回 *；OPTIONS 預檢照常
  r=await call('/api/leave-records',{method:'GET'});assert.equal(r.status,200);assert.deepEqual(r.data,[]);assert.equal(r.h.get('Access-Control-Allow-Origin'),'*');
  r=await call('/api/leave-records',{body:JSON.stringify({name:'甲',room:'B101',date:'2026-09-15',reason:'x'})});assert.equal(r.data.success,true);assert.equal(r.h.get('Access-Control-Allow-Origin'),'*');
  r=await call('/api/leave-records',{method:'GET'});assert.equal(r.data.length,1);assert.equal(r.data[0].name,'甲');
  r=await call('/api/ai-parse',{method:'OPTIONS'});assert.equal(r.status,200);assert.equal(r.h.get('Access-Control-Allow-Origin'),'*');
  r=await call('/api/nope',{method:'GET'});assert.equal(r.status,404);

  console.log('dorm-api: ai-parse origin whitelist, per-origin CORS, IP/day rate limit, body cap, other routes untouched PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
