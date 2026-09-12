// 後端 (worker-proxy/index.js) 學期管理測試：用假的 Notion API 與假 KV 跑真正的 handler
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

// ── 假 Notion：記憶體裡的資料庫與頁面 ──
function makeNotion(){
  const dbs={}, pages={}; let seq=0;
  const id=()=>'id-'+(++seq);
  function selectProp(name){return name?{type:'select',select:{name}}:{type:'select',select:null};}
  function pageOut(pid){const p=pages[pid];const props={};for(const [k,v] of Object.entries(p.props)){props[k]=v;}return {id:pid,properties:props};}
  const calls=[];
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
      let results=Object.keys(pages).filter(pid=>pages[pid].db===mm[1]).map(pageOut);
      if(body.filter&&body.filter.title){results=results.filter(r=>(r.properties[body.filter.property]?.title?.[0]?.text?.content||'')===body.filter.title.equals);}
      return ok({results,has_more:false});}
    if(m==='POST'&&u.pathname==='/v1/pages'){const db=dbs[body.parent.database_id];if(!db)return bad('db not found',404);
      for(const k of Object.keys(body.properties)){if(!db.properties[k])return bad(`${k} is not a property that exists.`);}
      const pid=id();pages[pid]={db:body.parent.database_id,props:body.properties};return ok({id:pid});}
    if((mm=u.pathname.match(/^\/v1\/pages\/([^/]+)$/))){const p=pages[mm[1]];if(!p)return bad('Could not find page',404);
      if(m==='GET')return ok(pageOut(mm[1]));
      if(m==='PATCH'){const db=dbs[p.db];for(const [k,v] of Object.entries(body.properties||{})){if(!db.properties[k])return bad(`${k} is not a property that exists.`);p.props[k]=v;}return ok({id:mm[1]});}}
    return bad('unhandled '+m+' '+u.pathname,404);
  }
  return {dbs,pages,calls,handle,selectProp};
}
function makeKV(){const store={};return {store,async get(k,t){const v=store[k];if(v===undefined)return null;return t==='json'?JSON.parse(v):v;},async put(k,v){store[k]=v;}};}

(async()=>{
  const src=fs.readFileSync(path.join(root,'worker-proxy','index.js'),'utf8').replace(/await sleep\((\d+)\)/g,'await sleep(0)');
  const tmp=path.join(os.tmpdir(),'biyuan-worker-test-'+Date.now()+'.mjs');fs.writeFileSync(tmp,src);
  const worker=(await import('file:///'+tmp.replace(/\\/g,'/'))).default;
  fs.unlinkSync(tmp);

  const notion=makeNotion();
  global.fetch=async(url,init={})=>{if(String(url).startsWith('https://api.notion.com'))return notion.handle(url,init);throw new Error('unexpected fetch '+url);};

  // 舊學期資料庫：固定欄位 + 兩個舊式日期
  const master='id-master';const cfg='id-config';
  notion.dbs[master]={title:'碧苑點名總表',parent:{type:'page_id',page_id:'page-root'},properties:{'姓名':{title:{}},'寢床號':{rich_text:{}},'床號':{select:{}},'班別':{rich_text:{}},'學號':{rich_text:{}},'中隊':{select:{}},'外籍生':{checkbox:{}},'空床':{checkbox:{}},'6月26日':{select:{}},'6月27日':{select:{}}}};
  notion.dbs[cfg]={title:'系統設定',parent:{type:'page_id',page_id:'page-root'},properties:{'鍵':{title:{}},'值':{rich_text:{}}}};
  const mk=(name,room,bed,squad,empty)=>({db:master,props:{'姓名':{type:'title',title:name?[{text:{content:name},plain_text:name}]:[]},'寢床號':{type:'rich_text',rich_text:[{text:{content:room},plain_text:room}]},'床號':{type:'select',select:{name:bed}},'班別':{type:'rich_text',rich_text:[{text:{content:'四室四Ａ'}}]},'學號':{type:'rich_text',rich_text:[{text:{content:'D1'}}]},'中隊':{type:'select',select:{name:squad}},'外籍生':{type:'checkbox',checkbox:false},'空床':{type:'checkbox',checkbox:!!empty},'6月26日':{type:'select',select:{name:'◎'}}}});
  notion.pages['p1']=mk('甲','B101','A','一單');notion.pages['p2']=mk('乙','B101','B','一單');notion.pages['p3']=mk('','B101','C','一單',true);
  const kv=makeKV();
  const env={NOTION_TOKEN:'t',MASTER_DB_ID:master,CONFIG_DB_ID:cfg,POLL_KV:kv};
  const call=async(p,method='GET',body)=>{const r=await worker.fetch(new Request('https://x.test'+p,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,data:await r.json()};};

  // 1. 預設學期狀態退回環境變數
  let r=await call('/api/semester');
  assert.equal(r.status,200);assert.equal(r.data.current.dbId,master);assert.deepEqual(r.data.dateColumns,['6月26日','6月27日']);

  // 2. 點名寫到不存在的日期 → 自動建欄位再寫入
  r=await call('/api/attendance','PATCH',{updates:[{pageId:'p1',date:'2026-09-12',value:'◎'}]});
  assert.equal(r.data.success,true);assert.deepEqual(r.data.addedColumns,['2026-09-12']);assert.ok(notion.dbs[master].properties['2026-09-12']);
  assert.equal(notion.pages.p1.props['2026-09-12'].select.name,'◎');
  r=await call('/api/roster');assert.deepEqual(r.data.dateColumns,['6月26日','6月27日','2026-09-12']);assert.equal(r.data.students.find(s=>s.id==='p1').attendance['2026-09-12'],'◎');assert.equal(r.data.semester.isCurrent,true);

  // 3. 更新失敗要回 error，前端才會保留變更
  r=await call('/api/attendance','PATCH',{updates:[{pageId:'nope',date:'2026-09-12',value:'✓'}]});
  assert.equal(r.status,200);assert.equal(r.data.success,false);assert.match(r.data.error,/1 筆更新失敗/);

  // 4. 套用學期範圍：補欄位；縮小範圍要先確認
  r=await call('/api/semester/dates','POST',{name:'115-1',start:'2026-09-10',end:'2026-09-14'});
  assert.equal(r.data.success,true);assert.deepEqual(r.data.added,['2026-09-10','2026-09-11','2026-09-13','2026-09-14']);assert.deepEqual(r.data.removed,[]);
  assert.equal(JSON.parse(kv.store.semester_state).current.name,'115-1');
  r=await call('/api/config');assert.equal(JSON.parse(r.data.semester_state).current.end,'2026-09-14','設定資料庫也有正本');
  r=await call('/api/semester/dates','POST',{start:'2026-09-11',end:'2026-09-13'});
  assert.equal(r.data.needsConfirm,true);assert.deepEqual(r.data.toRemove,[{date:'2026-09-10',nonDefault:0},{date:'2026-09-14',nonDefault:0}]);assert.ok(notion.dbs[master].properties['2026-09-10'],'未確認前不刪');
  notion.pages.p2.props['2026-09-14']={type:'select',select:{name:'✘'}};
  r=await call('/api/semester/dates','POST',{start:'2026-09-11',end:'2026-09-13'});assert.deepEqual(r.data.toRemove[1],{date:'2026-09-14',nonDefault:1},'會算出要失去幾筆非 ✓ 紀錄');
  r=await call('/api/semester/dates','POST',{start:'2026-09-11',end:'2026-09-13',confirmRemove:true});
  assert.equal(r.data.success,true);assert.deepEqual(r.data.removed,['2026-09-10','2026-09-14']);assert.equal(notion.dbs[master].properties['2026-09-10'],undefined);assert.ok(notion.dbs[master].properties['6月26日'],'舊式欄位永遠不動');
  r=await call('/api/semester/dates','POST',{start:'2026-09-11',end:'2028-09-13'});assert.equal(r.status,500);assert.match(r.data.error,/最多 400 天/);

  // 5. 封存並開新學期
  r=await call('/api/semester/archive','POST',{newName:'115-2',start:'2027-02-01',end:'2027-02-03',carryResidents:true});
  assert.equal(r.data.success,true);const newDb=r.data.newDbId;
  assert.equal(notion.dbs[master].title,'碧苑點名總表 115-1');assert.equal(notion.dbs[newDb].title,'碧苑點名總表 115-2');assert.deepEqual(notion.dbs[newDb].parent,{page_id:'page-root'});
  assert.deepEqual(Object.keys(notion.dbs[newDb].properties).filter(k=>/^\d{4}-/.test(k)),['2027-02-01','2027-02-02','2027-02-03']);
  assert.equal(r.data.beds.length,3);assert.equal(r.data.beds[0].name,'甲');assert.equal(r.data.beds[2].isEmpty,true);assert.equal(r.data.beds[2].name,'');
  // 前端會分批匯入床位
  r=await call('/api/import-batch','POST',{db_id:newDb,students:r.data.beds});assert.equal(r.data.imported,3);
  r=await call('/api/semester');assert.equal(r.data.current.name,'115-2');assert.equal(r.data.current.dbId,newDb);assert.equal(r.data.archives.length,1);assert.equal(r.data.archives[0].name,'115-1');assert.equal(r.data.archives[0].dbId,master);
  r=await call('/api/roster');assert.equal(r.data.students.length,3);assert.deepEqual(r.data.dateColumns,['2027-02-01','2027-02-02','2027-02-03']);assert.equal(r.data.semester.name,'115-2');
  r=await call('/api/roster?semester=115-1');assert.equal(r.data.semester.isCurrent,false);assert.equal(r.data.students.find(s=>s.id==='p1').attendance['6月26日'],'◎','封存學期照舊可讀');
  r=await call('/api/roster?semester=nothing');assert.equal(r.status,500);
  // 新學期不帶住宿生
  r=await call('/api/semester/archive','POST',{newName:'116-1',start:'2027-09-01',end:'2027-09-02',carryResidents:false});
  assert.ok(r.data.beds.every(b=>b.isEmpty&&!b.name));
  r=await call('/api/semester/archive','POST',{newName:'115-1',start:'2027-09-01',end:'2027-09-02'});assert.match(r.data.error,/已經有封存/);r=await call('/api/semester/archive','POST',{newName:'116-1',start:'2027-09-01',end:'2027-09-02'});assert.match(r.data.error,/跟目前學期一樣/);
  // import-batch 不給 db_id 就用目前學期
  r=await call('/api/import-batch','POST',{students:[{room:'B999',bed:'A',squad:'一單',isEmpty:true}]});assert.equal(r.data.imported,1);
  const cur=JSON.parse(kv.store.semester_state).current.dbId;assert.ok(Object.values(notion.pages).some(p=>p.db===cur&&p.props['寢床號'].rich_text[0].text.content==='B999'));

  // 6. 設定值超過 2000 字要拆段、讀回完整
  const long='x'.repeat(4500);
  r=await call('/api/config','POST',{long_value:long});assert.equal(r.data.success,true);
  r=await call('/api/config');assert.equal(r.data.long_value.length,4500);

  // 7. 人多時 Notion 回 429：要等一下重試，不能直接丟掉這筆點名
  {
    const realHandle=notion.handle;let failed=0;
    notion.handle=async(url,init)=>{if(init.method==='PATCH'&&/\/v1\/pages\//.test(new URL(url).pathname)&&failed<2){failed++;return {ok:false,status:429,headers:{get:()=>'0'},json:async()=>({code:'rate_limited'})};}return realHandle(url,init);};
    const pid=Object.keys(notion.pages).find(k=>notion.pages[k].db===cur);
    r=await call('/api/attendance','PATCH',{updates:[{pageId:pid,date:'2027-09-01',value:'◎'}]});
    notion.handle=realHandle;
    assert.equal(r.data.success,true,'429 兩次後重試成功');assert.equal(failed,2);assert.equal(notion.pages[pid].props['2027-09-01'].select.name,'◎');
  }

  // 8. 設定表同名重複列：讀固定取最後編輯那列，寫要全部一起改
  {
    const mkCfg=(v,t)=>({db:cfg,props:{'鍵':{type:'title',title:[{text:{content:'confirm_2027-09-01'}}]},'值':{type:'rich_text',rich_text:[{text:{content:v}}]}},t});
    notion.pages['dupA']=mkCfg('一單','2027-09-01T00:00:05.000Z');notion.pages['dupB']=mkCfg('','2027-09-01T00:00:01.000Z');
    const realHandle=notion.handle;
    notion.handle=async(url,init)=>{const res=await realHandle(url,init);if(/\/query$/.test(new URL(url).pathname)){const d=await res.json();d.results.forEach(p=>{if(notion.pages[p.id]&&notion.pages[p.id].t)p.last_edited_time=notion.pages[p.id].t;});return {ok:true,status:200,json:async()=>d};}return res;};
    r=await call('/api/config');assert.equal(r.data['confirm_2027-09-01'],'一單','取最後編輯的那列');
    // 9. 點名完成：伺服器合併，不蓋掉別隊
    r=await call('/api/confirm','POST',{date:'2027-09-01',squad:'二雙',confirmed:true});
    assert.deepEqual(r.data.confirms,['一單','二雙']);
    assert.equal(notion.pages.dupA.props['值'].rich_text[0].text.content,'一單,二雙');assert.equal(notion.pages.dupB.props['值'].rich_text[0].text.content,'一單,二雙','重複列一起改');
    r=await call('/api/confirm','POST',{date:'2027-09-01',squad:'一單',confirmed:false});
    assert.deepEqual(r.data.confirms,['二雙']);
    // 10. 點名 PATCH 不會把 confirms 蓋回舊值
    r=await call('/api/attendance','PATCH',{updates:[{pageId:Object.keys(notion.pages).find(k=>notion.pages[k].db===cur),date:'2027-09-01',value:'✓'}]});
    r=await call('/api/poll');assert.equal(r.data.confirms,'二雙');assert.equal(r.data.date,'2027-09-01');assert.ok(r.data.att_ts>0);
    notion.handle=realHandle;
  }

  console.log('worker: semester state, auto date columns, error surfacing, range apply/confirm, archive/new semester, long config, 429 retry, config duplicates, confirm merge, poll split PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
