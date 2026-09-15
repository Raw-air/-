// 後端 (worker-proxy/index.js) 點名寫入/換床/回報/輪詢測試：用假的 Notion API、假 KV、假同步中樞跑真正的 handler
// 對應 BUG #9 換床回滾、#15 寫成功才廣播、#21 輪詢不讀 KV、#22 單次上限 25 筆、#23 回報每隊一列、#44 日期與狀態值驗證
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── 假 Notion：記憶體裡的資料庫與頁面 (頁面會帶 parent.database_id，換床防呆要用) ──
function makeNotion(){
  const dbs={}, pages={}; let seq=0;
  const id=()=>'id-'+(++seq);
  function pageOut(pid){const p=pages[pid];const props={};for(const [k,v] of Object.entries(p.props)){props[k]=v;}return {id:pid,parent:{type:'database_id',database_id:p.db},properties:props};}
  const calls=[];
  const api={dbs,pages,calls,queryDelay:0,beforePatch:null};
  async function handle(url,init){
    const u=new URL(url);const m=init.method||'GET';const body=init.body?JSON.parse(init.body):null;calls.push({m,path:u.pathname,body});
    const ok=(d)=>({ok:true,status:200,json:async()=>d});
    const bad=(msg,status=400)=>({ok:false,status,json:async()=>({message:msg})});
    let mm;
    if(m==='POST'&&u.pathname==='/v1/databases'){const did=id();dbs[did]={title:body.title[0].text.content,parent:body.parent,properties:{...body.properties}};return ok({id:did});}
    if((mm=u.pathname.match(/^\/v1\/databases\/([^/]+)$/))){const db=dbs[mm[1]];if(!db)return bad('db not found',404);
      if(m==='GET')return ok({id:mm[1],title:[{text:{content:db.title}}],parent:db.parent,properties:Object.fromEntries(Object.entries(db.properties).map(([k,v])=>[k,{...v,type:Object.keys(v)[0]}]))});
      if(m==='PATCH'){if(body.title)db.title=body.title[0].text.content;for(const [k,v] of Object.entries(body.properties||{})){if(v===null)delete db.properties[k];else db.properties[k]=v;}return ok({id:mm[1]});}}
    if((mm=u.pathname.match(/^\/v1\/databases\/([^/]+)\/query$/))){const db=dbs[mm[1]];if(!db)return bad('db not found',404);
      if(api.queryDelay)await sleep(api.queryDelay);
      let results=Object.keys(pages).filter(pid=>pages[pid].db===mm[1]).map(pageOut);
      if(body.filter&&body.filter.title){results=results.filter(r=>(r.properties[body.filter.property]?.title?.[0]?.text?.content||'')===body.filter.title.equals);}
      return ok({results,has_more:false});}
    if(m==='POST'&&u.pathname==='/v1/pages'){const db=dbs[body.parent.database_id];if(!db)return bad('db not found',404);
      for(const k of Object.keys(body.properties)){if(!db.properties[k])return bad(`${k} is not a property that exists.`);}
      const pid=id();pages[pid]={db:body.parent.database_id,props:body.properties};return ok({id:pid});}
    if((mm=u.pathname.match(/^\/v1\/pages\/([^/]+)$/))){const p=pages[mm[1]];if(!p)return bad('Could not find page',404);
      if(m==='GET')return ok(pageOut(mm[1]));
      if(m==='PATCH'){if(api.beforePatch){const r=api.beforePatch(mm[1],body);if(r)return r;}
        const db=dbs[p.db];for(const [k,v] of Object.entries(body.properties||{})){if(!db.properties[k])return bad(`${k} is not a property that exists.`);p.props[k]=v;}return ok({id:mm[1]});}}
    return bad('unhandled '+m+' '+u.pathname,404);
  }
  api.handle=handle;
  return api;
}
function makeKV(){const store={};const kv={store,gets:[],puts:[],failGet:false,async get(k,t){kv.gets.push(k);if(kv.failGet)throw new Error('KV get() limit exceeded');const v=store[k];if(v===undefined)return null;return t==='json'?JSON.parse(v):v;},async put(k,v){kv.puts.push(k);store[k]=v;}};return kv;}
// 假同步中樞：直接跑真正的 SyncHub 類別，另外記下每次 push 進來的內容
function makeHub(mod){
  const mem={};const hub=new mod.SyncHub({storage:{async get(k){return mem[k]?JSON.parse(mem[k]):undefined;},async put(k,v){mem[k]=JSON.stringify(v);}}});
  const pushes=[];
  const binding={pushes,idFromName:()=>'main',get:()=>({fetch:async(u,init)=>{if(init&&init.method==='POST')pushes.push(JSON.parse(init.body));return hub.fetch(new Request(u,init));}})};
  return binding;
}

(async()=>{
  const src=fs.readFileSync(path.join(root,'worker-proxy','index.js'),'utf8').replace(/await sleep\((\d+)\)/g,'await sleep(0)');
  const tmp=path.join(os.tmpdir(),'biyuan-worker-sync-test-'+Date.now()+'.mjs');fs.writeFileSync(tmp,src);
  const mod=await import('file:///'+tmp.replace(/\\/g,'/'));const worker=mod.default;
  fs.unlinkSync(tmp);

  const notion=makeNotion();
  global.fetch=async(url,init={})=>{if(String(url).startsWith('https://api.notion.com'))return notion.handle(url,init);throw new Error('unexpected fetch '+url);};

  const master='id-master';const cfg='id-config';const other='id-other';
  const fixed={'姓名':{title:{}},'寢床號':{rich_text:{}},'床號':{select:{}},'班別':{rich_text:{}},'學號':{rich_text:{}},'中隊':{select:{}},'外籍生':{checkbox:{}},'空床':{checkbox:{}},'電話':{rich_text:{}},'住址':{rich_text:{}}};
  notion.dbs[master]={title:'碧苑點名總表',parent:{type:'page_id',page_id:'page-root'},properties:{...fixed,'6月26日':{select:{}},'2026-09-12':{select:{}}}};
  notion.dbs[other]={title:'舊學期總表',parent:{type:'page_id',page_id:'page-root'},properties:{...fixed,'6月26日':{select:{}}}};
  notion.dbs[cfg]={title:'系統設定',parent:{type:'page_id',page_id:'page-root'},properties:{'鍵':{title:{}},'值':{rich_text:{}}}};
  const mk=(db,name,room,bed,squad,sid,att)=>({db,props:{'姓名':{type:'title',title:name?[{text:{content:name},plain_text:name}]:[]},'寢床號':{type:'rich_text',rich_text:[{text:{content:room},plain_text:room}]},'床號':{type:'select',select:{name:bed}},'班別':{type:'rich_text',rich_text:[{text:{content:'四室四Ａ'},plain_text:'四室四Ａ'}]},'學號':{type:'rich_text',rich_text:[{text:{content:sid},plain_text:sid}]},'中隊':{type:'select',select:{name:squad}},'外籍生':{type:'checkbox',checkbox:false},'空床':{type:'checkbox',checkbox:!name},'6月26日':{type:'select',select:att?{name:att}:null}}});
  notion.pages['pA']=mk(master,'甲','B101','A','一單','D1','◎');notion.pages['pB']=mk(master,'乙','B101','B','一單','D2','✓');
  notion.pages['pC']=mk(master,'丙','B102','A','一雙','D3','✘');notion.pages['pX']=mk(other,'舊','B101','A','一單','D9','✓');
  const kv=makeKV();
  const env={NOTION_TOKEN:'t',MASTER_DB_ID:master,CONFIG_DB_ID:cfg,POLL_KV:kv};
  const call=async(p,method='GET',body)=>{const r=await worker.fetch(new Request('https://x.test'+p,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,data:await r.json()};};
  const snapshot=(pid)=>JSON.parse(JSON.stringify(notion.pages[pid].props));
  let r;

  // ── #9 換床不是原子操作 ──
  {
    // 正常交換：兩床的姓名/學號/出席互換，位置欄位不動
    r=await call('/api/swap-beds','POST',{pageIdA:'pA',pageIdB:'pB'});
    assert.equal(r.status,200);assert.equal(r.data.success,true);
    assert.equal(notion.pages.pA.props['姓名'].title[0].text.content,'乙');assert.equal(notion.pages.pB.props['姓名'].title[0].text.content,'甲');
    assert.equal(notion.pages.pA.props['6月26日'].select.name,'✓');assert.equal(notion.pages.pB.props['6月26日'].select.name,'◎');
    assert.equal(notion.pages.pA.props['床號'].select.name,'A');assert.equal(notion.pages.pB.props['床號'].select.name,'B');
    assert.ok(kv.store.poll_att,'換床成功要更新出席信號');
    // 第二個 PATCH (寫 B) 失敗 → A 要用先前讀到的資料完整寫回
    const beforeA=snapshot('pA'),beforeB=snapshot('pB');
    kv.puts.length=0;
    notion.beforePatch=(pid)=>pid==='pB'?{ok:false,status:400,json:async()=>({message:'boom B'})}:null;
    r=await call('/api/swap-beds','POST',{pageIdA:'pA',pageIdB:'pB'});
    notion.beforePatch=null;
    assert.equal(r.status,500);assert.match(r.data.error,/已還原/);assert.match(r.data.error,/boom B/);
    assert.deepEqual(notion.pages.pA.props,beforeA,'B 失敗後 A 已被還原成原本的資料');assert.deepEqual(notion.pages.pB.props,beforeB,'B 未變');
    assert.ok(kv.puts.includes('poll_att'),'換床失敗也要更新出席信號讓大家重抓');
    // B 失敗、回滾 A 也失敗 → 明確錯誤，訊息含兩個 pageId 與「請到 Notion 檢查」
    let patchA=0;
    notion.beforePatch=(pid)=>{if(pid==='pB')return {ok:false,status:400,json:async()=>({message:'boom B'})};if(pid==='pA'&&++patchA>=2)return {ok:false,status:400,json:async()=>({message:'boom A rollback'})};return null;};
    r=await call('/api/swap-beds','POST',{pageIdA:'pA',pageIdB:'pB'});
    notion.beforePatch=null;
    assert.equal(r.status,500);assert.match(r.data.error,/pA/);assert.match(r.data.error,/pB/);assert.match(r.data.error,/請到 Notion 檢查/);assert.match(r.data.error,/boom A rollback/);
    // 這時 A 真的是 B 的資料 (模擬損毀)，手動還原繼續測
    notion.pages.pA.props=beforeA;
    // 防呆：不同總表的床位不能交換，而且什麼都不寫
    const callsBefore=notion.calls.length;
    r=await call('/api/swap-beds','POST',{pageIdA:'pA',pageIdB:'pX'});
    assert.equal(r.status,500);assert.match(r.data.error,/不在同一張總表/);
    assert.ok(!notion.calls.slice(callsBefore).some(c=>c.m==='PATCH'),'不同總表時不能有任何寫入');
    assert.deepEqual(notion.pages.pA.props,beforeA);
  }

  // ── #22 單次上限 25 筆：超過的回報錯誤讓前端分批重送，不靜默丟掉 ──
  {
    const many=[];for(let i=0;i<27;i++)many.push({pageId:i<25?'pA':'pC',date:'2026-09-12',value:'✓'});
    r=await call('/api/attendance','PATCH',{updates:many});
    assert.equal(r.status,200);assert.equal(r.data.success,false);assert.equal(r.data.updated,25);
    assert.equal(r.data.errors.length,2);assert.deepEqual(r.data.errors[0],{pageId:'pC',error:'超過單次上限，請分批'});assert.match(r.data.error,/超過單次上限/);
    assert.equal(notion.pages.pC.props['2026-09-12'],undefined,'第 26 筆以後沒寫');
    r=await call('/api/attendance','PATCH',{updates:many.slice(0,25)});assert.equal(r.data.success,true);assert.equal(r.data.updated,25);
    assert.equal(r.data.okUpdates,undefined,'內部用的成功清單不會回給前端');
  }

  // ── #44 日期欄位名稱與狀態值驗證 ──
  {
    const bad=[['2月30日','✓'],['13月1日','✓'],['2026-02-30','✓'],['1999-01-01','✓'],['2101-12-31','✓'],['2026-9-1','✓'],['2026-09-13','X'],['2026-09-13','✓ '],['姓名','✓']];
    for(const [date,value] of bad){
      r=await call('/api/attendance','PATCH',{updates:[{pageId:'pA',date,value}]});
      assert.equal(r.data.success,false,`${date}=${value} 應該被擋`);assert.equal(r.data.errors[0].pageId,'pA');assert.match(r.data.errors[0].error,/不合法/);
      if(date!=='2026-09-13')assert.deepEqual(r.data.addedColumns,[],'不合法的日期不建欄位');
    }
    for(const n of ['2月30日','13月1日','2026-02-30','1999-01-01','2101-12-31'])assert.equal(notion.dbs[master].properties[n],undefined,`不合法的日期 ${n} 不建欄位`);
    assert.equal(notion.pages.pA.props['2026-09-13'],undefined,'狀態值不合法就整筆不寫');
    // dates 物件裡有一個壞的：整筆記錯，好的日期欄位也不會白建
    r=await call('/api/attendance','PATCH',{updates:[{pageId:'pA',dates:{'2026-09-14':'◎','2月31日':'✓'}}]});
    assert.equal(r.data.success,false);assert.equal(notion.dbs[master].properties['2月31日'],undefined);assert.ok(notion.dbs[master].properties['2026-09-14'],'合法的那個日期欄位照建');
    // 合法的照常：2月29日 放行、2100 年放行、空字串 = 清掉
    r=await call('/api/attendance','PATCH',{updates:[{pageId:'pA',dates:{'2月29日':'△','2100-12-31':'✘'}},{pageId:'pB',date:'6月26日',value:''}]});
    assert.equal(r.data.success,true);assert.deepEqual(r.data.addedColumns,['2月29日','2100-12-31']);
    assert.equal(notion.pages.pA.props['2月29日'].select.name,'△');assert.deepEqual(notion.pages.pB.props['6月26日'],{select:null});
    // 缺 pageId 的一筆進 errors，其他照寫
    r=await call('/api/attendance','PATCH',{updates:[{date:'6月26日',value:'✓'},{pageId:'pB',date:'6月26日',value:'✓'}]});
    assert.equal(r.data.success,false);assert.equal(r.data.updated,1);assert.equal(r.data.errors.length,1);assert.equal(notion.pages.pB.props['6月26日'].select.name,'✓');
  }

  // ── #15 點名寫成功的那些筆才廣播；#21 有中樞就完全不讀 KV ──
  {
    env.SYNC_HUB=makeHub(mod);const pushes=env.SYNC_HUB.pushes;
    kv.gets.length=0;
    r=await call('/api/poll');assert.equal(r.status,200);const base=r.data.seq;assert.equal(typeof base,'number');
    assert.deepEqual(kv.gets,[],'有中樞時輪詢完全不讀 KV');
    // pB 寫失敗、pA 與 pC 成功 → 中樞只收到 pA、pC 的變動；失敗那筆在 errors
    notion.beforePatch=(pid)=>pid==='pB'?{ok:false,status:400,json:async()=>({message:'boom B'})}:null;
    r=await call('/api/attendance','PATCH',{updates:[{pageId:'pA',date:'2026-09-12',value:'◎'},{pageId:'pB',date:'2026-09-12',value:'✘'},{pageId:'pC',dates:{'2026-09-12':'△'}},{pageId:'pA',markEmpty:false}]});
    notion.beforePatch=null;
    assert.equal(r.data.success,false);assert.equal(r.data.updated,3);assert.deepEqual(r.data.errors.map(e=>e.pageId),['pB']);
    const changePushes=pushes.filter(p=>Array.isArray(p.changes));
    assert.equal(changePushes.length,1);
    assert.deepEqual(changePushes[0].changes,[{id:'pA',d:'2026-09-12',v:'◎'},{id:'pC',d:'2026-09-12',v:'△'}],'只廣播寫成功的');
    r=await call('/api/poll?since='+base);
    assert.deepEqual(r.data.changes.map(c=>[c.id,c.d,c.v]),[['pA','2026-09-12','◎'],['pC','2026-09-12','△']]);assert.ok(r.data.att_ts>0);
    // 整批丟例外 (缺 updates)：不廣播，但 att_ts 仍更新讓大家重抓校正
    pushes.length=0;const attBefore=r.data.att_ts;await sleep(5);
    r=await call('/api/attendance','PATCH',{});
    assert.equal(r.status,500);assert.ok(!pushes.some(p=>Array.isArray(p.changes)),'整批失敗不廣播變動');assert.ok(pushes.some(p=>p.att_ts),'仍要送 att_ts');
    r=await call('/api/poll');assert.ok(r.data.att_ts>attBefore);
    // 超過上限的那 2 筆也不會被廣播
    pushes.length=0;
    const many=[];for(let i=0;i<27;i++)many.push({pageId:'pA',date:'2026-09-12',value:i%2?'✓':'◎'});
    r=await call('/api/attendance','PATCH',{updates:many});
    assert.equal(pushes.filter(p=>Array.isArray(p.changes)).reduce((n,p)=>n+p.changes.length,0),25);
    delete env.SYNC_HUB;
  }

  // ── #21 沒中樞：只讀 poll_att / poll_confirms，不讀舊版 poll_state；KV 讀失敗不能 500 ──
  {
    kv.store.poll_state=JSON.stringify({ts:999,confirms:'三雙',att_ts:5});
    kv.gets.length=0;
    r=await call('/api/poll');assert.equal(r.status,200);
    assert.ok(kv.gets.includes('poll_att')&&kv.gets.includes('poll_confirms'));assert.ok(!kv.gets.includes('poll_state'),'不再讀舊版 poll_state');
    assert.notEqual(r.data.confirms,'三雙');
    // 額度用完：get() 丟例外
    kv.failGet=true;
    r=await call('/api/poll');assert.equal(r.status,200,'KV 讀失敗輪詢不能 500');assert.equal(r.data.att_ts,0);assert.equal(r.data.confirms,'');
    // /api/roster 走快取路徑 (有 caches) 也不能 500，而且拿不到信號就不快取
    let cachePuts=0;global.caches={default:{async match(){return undefined;},async put(){cachePuts++;}}};
    r=await call('/api/roster');assert.equal(r.status,200,'KV 讀失敗總表不能 500');assert.ok(r.data.students.length>=3);assert.equal(cachePuts,0,'拿不到信號就不存快取');
    kv.failGet=false;
    kv.store.poll_att=JSON.stringify({att_ts:Date.now()-10000}); // 離上次寫入超過 3 秒才會存快取
    r=await call('/api/roster');assert.equal(r.status,200);assert.equal(cachePuts,1,'信號正常就照常快取');
    delete global.caches;
    // 有中樞但中樞讀失敗 → 退回 KV，也不能 500
    env.SYNC_HUB={idFromName:()=>'main',get:()=>({fetch:async()=>{throw new Error('hub down');}})};
    r=await call('/api/poll');assert.equal(r.status,200);assert.ok(r.data.att_ts>0,'中樞掛了退回 KV 的 att_ts');
    delete env.SYNC_HUB;
  }

  // ── #23 兩個中隊同時按「回報完成」不會互相蓋掉 ──
  {
    env.SYNC_HUB=makeHub(mod);
    const date='2026-09-15';
    // 讓兩隊都先讀完設定表才寫 (以前的讀→改→寫回這樣會互相蓋掉)
    notion.queryDelay=15;
    const [a,b]=await Promise.all([
      call('/api/confirm','POST',{date,squad:'二雙',confirmed:true}),
      call('/api/confirm','POST',{date,squad:'一單',confirmed:true}),
    ]);
    notion.queryDelay=0;
    assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.success,true);
    r=await call('/api/config');
    assert.equal(r.data['confirm_'+date],'一單,二雙','兩隊都在、順序照 SQUAD_OPTIONS');
    assert.equal(r.data['confirm_'+date+'_一單'],'true');assert.equal(r.data['confirm_'+date+'_二雙'],'true');
    r=await call('/api/poll');assert.equal(r.data.date,date);assert.equal(r.data.confirms,'一單,二雙','信號是寫完再讀的聚合結果');
    // 取消回報：只改自己那列
    r=await call('/api/confirm','POST',{date,squad:'二雙',confirmed:false});
    assert.deepEqual(r.data.confirms,['一單']);
    r=await call('/api/config');assert.equal(r.data['confirm_'+date],'一單');assert.equal(r.data['confirm_'+date+'_二雙'],'');
    // 三隊同時：兩隊確認、一隊取消，全都不能丟
    notion.queryDelay=15;
    await Promise.all([
      call('/api/confirm','POST',{date,squad:'三單',confirmed:true}),
      call('/api/confirm','POST',{date,squad:'一單',confirmed:false}),
      call('/api/confirm','POST',{date,squad:'三雙',confirmed:true}),
    ]);
    notion.queryDelay=0;
    r=await call('/api/config');assert.equal(r.data['confirm_'+date],'三單,三雙');
    // 舊資料相容：舊式整串單列 confirm_<date> 當初始值併入；舊列裡的隊可以被取消
    const old='9月16日';
    notion.pages['legacy']={db:cfg,props:{'鍵':{type:'title',title:[{text:{content:'confirm_'+old},plain_text:'confirm_'+old}]},'值':{type:'rich_text',rich_text:[{text:{content:'三單,一雙'},plain_text:'三單,一雙'}]}}};
    r=await call('/api/config');assert.equal(r.data['confirm_'+old],'三單,一雙','沒有每隊列時舊列照原樣');
    r=await call('/api/confirm','POST',{date:old,squad:'二單',confirmed:true});
    assert.deepEqual(r.data.confirms,['一雙','二單','三單'],'舊列的隊併入，新隊加上，順序照 SQUAD_OPTIONS');
    r=await call('/api/confirm','POST',{date:old,squad:'三單',confirmed:false});
    assert.deepEqual(r.data.confirms,['一雙','二單'],'舊列裡的隊也能取消');
    r=await call('/api/config');assert.equal(r.data['confirm_'+old],'一雙,二單');
    assert.equal(notion.pages.legacy.props['值'].rich_text[0].text.content,'一雙,二單','舊列鏡射聚合結果');
    r=await call('/api/poll');assert.equal(r.data.date,old);assert.equal(r.data.confirms,'一雙,二單');
    // 奇怪的 squad 不收 (底線會弄壞鍵名)
    r=await call('/api/confirm','POST',{date:old,squad:'a_b',confirmed:true});assert.equal(r.status,500);
    delete env.SYNC_HUB;
  }

  console.log('worker-sync: swap rollback, batch cap 25, date/value validation, broadcast-after-write, poll without KV, KV failure tolerance, per-squad confirm PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
