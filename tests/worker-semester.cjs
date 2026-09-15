// 後端 (worker-proxy/index.js) 封存學期 / 批次匯入 / 紀錄查詢測試：用假的 Notion API 與假 KV 跑真正的 handler
// 涵蓋：封存不是原子操作 (#11)、import-batch 部分失敗與冪等 (#13)、封存帶電話住址備註 (#14)、
//       報修標題台灣日期 (#39)、請假紀錄分頁/name 篩選/截斷 (#45)、報修與回饋分頁 (#46)
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

// ── 假 Notion：記憶體裡的資料庫與頁面 (比 tests/worker.cjs 多支援 /v1/search、query 篩選/排序/分頁、archived 旗標、錯誤注入) ──
function makeNotion(){
  const dbs={}, pages={}; let seq=0; const calls=[];
  let clock=Date.UTC(2026,8,1,0,0,0);
  const id=()=>'id-'+(++seq);
  const propOut=props=>Object.fromEntries(Object.entries(props).map(([k,v])=>[k,{...v,type:Object.keys(v)[0]}]));
  const pageOut=pid=>{const p=pages[pid];return {object:'page',id:pid,created_time:p.created_time,last_edited_time:p.last_edited_time||p.created_time,properties:{...p.props}};};
  const dbOut=did=>{const db=dbs[did];return {object:'database',id:did,title:[{type:'text',text:{content:db.title},plain_text:db.title}],parent:db.parent,archived:!!db.archived,in_trash:!!db.in_trash,properties:propOut(db.properties)};};
  const textOf=v=>!v?'':Array.isArray(v.title)?v.title.map(t=>t.text?.content||t.plain_text||'').join(''):Array.isArray(v.rich_text)?v.rich_text.map(t=>t.text?.content||t.plain_text||'').join(''):v.select?.name||v.created_time||'';
  function match(page,f){
    if(!f)return true;
    if(f.and)return f.and.every(x=>match(page,x));
    if(f.or)return f.or.some(x=>match(page,x));
    if(f.timestamp==='created_time'){const t=Date.parse(page.created_time);const c=f.created_time||{};
      if(c.on_or_after&&t<Date.parse(c.on_or_after))return false;if(c.before&&t>=Date.parse(c.before))return false;return true;}
    const v=page.properties[f.property];const s=textOf(v);
    if(f.title){if('equals' in f.title)return s===f.title.equals;if('contains' in f.title)return s.includes(f.title.contains);}
    if(f.rich_text){if('equals' in f.rich_text)return s===f.rich_text.equals;if('contains' in f.rich_text)return s.includes(f.rich_text.contains);}
    if(f.select){if('equals' in f.select)return s===f.select.equals;}
    if(f.checkbox)return !!v?.checkbox===f.checkbox.equals;
    throw new Error('fake notion: unsupported filter '+JSON.stringify(f));
  }
  function sortBy(results,sorts){
    for(const srt of [...(sorts||[])].reverse()){
      const dir=srt.direction==='descending'?-1:1;
      results.sort((a,b)=>{const ka=srt.timestamp==='created_time'?a.created_time:textOf(a.properties[srt.property]);const kb=srt.timestamp==='created_time'?b.created_time:textOf(b.properties[srt.property]);return ka<kb?-dir:ka>kb?dir:0;});
    }
    return results;
  }
  const api={dbs,pages,calls,intercept:null,
    id,tick(){clock+=60000;return new Date(clock).toISOString();},
    addPage(db,props,createdAt){const pid=id();pages[pid]={db,props,created_time:createdAt||api.tick()};return pid;},
    ok:d=>({ok:true,status:200,headers:{get:()=>null},json:async()=>d}),
    bad:(msg,status=400)=>({ok:false,status,headers:{get:()=>null},json:async()=>({message:msg})}),
  };
  api.handle=async function(url,init){
    const u=new URL(url);const m=init.method||'GET';const body=init.body?JSON.parse(init.body):null;
    const call={m,path:u.pathname,body};calls.push(call);
    const {ok,bad}=api;
    if(api.intercept){const r=api.intercept(call);if(r)return r;}
    let mm;
    if(m==='POST'&&u.pathname==='/v1/search'){
      const q=String(body.query||'');
      const results=Object.keys(dbs).filter(did=>dbs[did].title.includes(q)&&(!body.filter||body.filter.value==='database')).map(dbOut);
      return ok({results,has_more:false,next_cursor:null});
    }
    if(m==='POST'&&u.pathname==='/v1/databases'){const did=id();dbs[did]={title:body.title[0].text.content,parent:body.parent,properties:{...body.properties}};return ok(dbOut(did));}
    if((mm=u.pathname.match(/^\/v1\/databases\/([^/]+)$/))){const db=dbs[mm[1]];if(!db)return bad('db not found',404);
      if(m==='GET')return ok(dbOut(mm[1]));
      if(m==='PATCH'){if(body.title)db.title=body.title[0].text.content;for(const [k,v] of Object.entries(body.properties||{})){if(v===null)delete db.properties[k];else db.properties[k]=v;}return ok(dbOut(mm[1]));}}
    if((mm=u.pathname.match(/^\/v1\/databases\/([^/]+)\/query$/))){const db=dbs[mm[1]];if(!db)return bad('db not found',404);
      let results=Object.keys(pages).filter(pid=>pages[pid].db===mm[1]).map(pageOut).filter(p=>match(p,body&&body.filter));
      results=sortBy(results,body&&body.sorts);
      const size=(body&&body.page_size)||100;const start=body&&body.start_cursor?parseInt(body.start_cursor,10):0;
      const slice=results.slice(start,start+size);const hasMore=start+size<results.length;
      return ok({results:slice,has_more:hasMore,next_cursor:hasMore?String(start+size):null});}
    if(m==='POST'&&u.pathname==='/v1/pages'){const db=dbs[body.parent.database_id];if(!db)return bad('db not found',404);
      for(const k of Object.keys(body.properties)){if(!db.properties[k])return bad(`${k} is not a property that exists.`);}
      const pid=api.addPage(body.parent.database_id,body.properties);return ok({id:pid});}
    if((mm=u.pathname.match(/^\/v1\/pages\/([^/]+)$/))){const p=pages[mm[1]];if(!p)return bad('Could not find page',404);
      if(m==='GET')return ok(pageOut(mm[1]));
      if(m==='PATCH'){const db=dbs[p.db];for(const [k,v] of Object.entries(body.properties||{})){if(!db.properties[k])return bad(`${k} is not a property that exists.`);p.props[k]=v;}if(body.archived)p.archived=true;return ok({id:mm[1]});}}
    return bad('unhandled '+m+' '+u.pathname,404);
  };
  return api;
}
function makeKV(){const store={};return {store,async get(k,t){const v=store[k];if(v===undefined)return null;return t==='json'?JSON.parse(v):v;},async put(k,v){store[k]=v;},async delete(k){delete store[k];}};}

const MASTER_PROPS=()=>({'姓名':{title:{}},'寢床號':{rich_text:{}},'床號':{select:{}},'班別':{rich_text:{}},'學號':{rich_text:{}},'中隊':{select:{}},'外籍生':{checkbox:{}},'空床':{checkbox:{}},'6月26日':{select:{}}});
const rt=s=>({type:'rich_text',rich_text:s?[{text:{content:s},plain_text:s}]:[]});
const bedProps=(name,room,bed,squad,extra={})=>({'姓名':{type:'title',title:name?[{text:{content:name},plain_text:name}]:[]},'寢床號':rt(room),'床號':{type:'select',select:{name:bed}},'班別':rt(extra.cls||'四室四Ａ'),'學號':rt(extra.sid||'D1'),'中隊':{type:'select',select:{name:squad}},'外籍生':{type:'checkbox',checkbox:!!extra.foreign},'空床':{type:'checkbox',checkbox:!name},...(extra.props||{})});
const roomOf=p=>p.props['寢床號'].rich_text[0]?.text.content||'';
const bedOf=p=>p.props['床號'].select.name;
const nameOf=p=>p.props['姓名'].title[0]?.text.content||'';

(async()=>{
  const src=fs.readFileSync(path.join(root,'worker-proxy','index.js'),'utf8').replace(/await sleep\((\d+)\)/g,'await sleep(0)');
  const tmp=path.join(os.tmpdir(),'biyuan-worker-semester-test-'+Date.now()+'.mjs');fs.writeFileSync(tmp,src);
  const mod=await import('file:///'+tmp.replace(/\\/g,'/'));const worker=mod.default;
  fs.unlinkSync(tmp);

  const notion=makeNotion();
  global.fetch=async(url,init={})=>{if(String(url).startsWith('https://api.notion.com'))return notion.handle(url,init);throw new Error('unexpected fetch '+url);};

  const master='id-master',cfg='id-config',remarksDb='id-remarks';
  notion.dbs[master]={title:'碧苑點名總表',parent:{type:'page_id',page_id:'page-root'},properties:MASTER_PROPS()}; // 舊表：沒有電話/住址欄
  notion.dbs[cfg]={title:'系統設定',parent:{type:'page_id',page_id:'page-root'},properties:{'鍵':{title:{}},'值':{rich_text:{}}}};
  notion.dbs[remarksDb]={title:'學生備註',parent:{type:'page_id',page_id:'page-root'},properties:{'學號或姓名':{title:{}},'備註內容':{rich_text:{}}}};
  const p1=notion.addPage(master,bedProps('甲','B101','A','一單'));
  const p2=notion.addPage(master,bedProps('乙','B101','B','一單',{foreign:true}));
  const p3=notion.addPage(master,bedProps('','B101','C','一單'));
  notion.addPage(remarksDb,{'學號或姓名':{type:'title',title:[{text:{content:p1},plain_text:p1}]},'備註內容':rt('對花生過敏')});
  const kv=makeKV();
  const env={NOTION_TOKEN:'t',MASTER_DB_ID:master,CONFIG_DB_ID:cfg,POLL_KV:kv,REMARKS_DB_ID:remarksDb};
  const call=async(p,method='GET',body)=>{const r=await worker.fetch(new Request('https://x.test'+p,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,headers:r.headers,data:await r.json()};};
  const pagesIn=db=>Object.values(notion.pages).filter(p=>p.db===db);
  const dbCount=()=>Object.keys(notion.dbs).length;
  const pathOf=c=>c.path;

  // ── #11 (1) saveSemesterState：Notion 設定表寫失敗 → 丟錯、KV 不變、舊表沒改名、新表留著 (archive_pending) ──
  let r;
  {
    const before=dbCount();
    notion.intercept=c=>(c.m==='POST'&&c.path==='/v1/pages'&&c.body.parent.database_id===cfg)?notion.bad('config write boom'):null;
    r=await call('/api/semester/archive','POST',{newName:'115-2',start:'2027-02-01',end:'2027-02-03',currentName:'115-1'});
    notion.intercept=null;
    assert.equal(r.status,500);assert.match(r.data.error,/config write boom/);
    assert.equal(kv.store.semester_state,undefined,'Notion 失敗 KV 不能先寫');
    assert.equal(notion.dbs[master].title,'碧苑點名總表','舊表最後才改名，失敗時不動');
    assert.equal(dbCount(),before+1,'新表建了一張');
    const pending=JSON.parse(kv.store.archive_pending);
    assert.equal(pending.newName,'115-2');assert.ok(notion.dbs[pending.newDbId],'KV 記著建到一半的新表');assert.ok(pending.ts>0);
    assert.ok(!notion.calls.some(c=>c.m==='PATCH'&&c.path===`/v1/databases/${master}`&&c.body.title),'失敗前完全沒碰舊表標題');

    // ── #11 (3) 重試：重用 pending 那張新表，不建第二張；(2) 順序 = 建表/查床位 → 寫設定表 → 寫 KV → 最後改舊表名 ──
    notion.calls.length=0;
    r=await call('/api/semester/archive','POST',{newName:'115-2',start:'2027-02-01',end:'2027-02-03',currentName:'115-1'});
    assert.equal(r.data.success,true);assert.equal(r.data.newDbId,pending.newDbId,'重用同一張新表');assert.equal(dbCount(),before+1,'沒有第二張孤兒表');
    assert.equal(notion.dbs[master].title,'碧苑點名總表 115-1');assert.equal(notion.dbs[r.data.newDbId].title,'碧苑點名總表 115-2');
    assert.deepEqual(Object.keys(notion.dbs[r.data.newDbId].properties).filter(k=>/^\d{4}-/.test(k)),['2027-02-01','2027-02-02','2027-02-03']);
    assert.ok(notion.dbs[r.data.newDbId].properties['電話']&&notion.dbs[r.data.newDbId].properties['住址'],'新學期表一開始就有電話/住址 (#13-5)');
    assert.equal(kv.store.archive_pending,undefined,'切換成功後刪掉 pending');
    assert.equal(JSON.parse(kv.store.semester_state).current.dbId,r.data.newDbId);
    assert.deepEqual(r.data.archived,{name:'115-1',dbId:master});assert.equal(r.data.current.name,'115-2');
    const idxCfg=notion.calls.findIndex(c=>c.m==='POST'&&c.path==='/v1/pages'&&c.body.parent.database_id===cfg);
    const idxRename=notion.calls.findIndex(c=>c.m==='PATCH'&&c.path===`/v1/databases/${master}`&&c.body.title);
    assert.ok(idxCfg>=0&&idxRename>idxCfg,'先寫設定表正本，最後才改舊表標題');
    assert.ok(!notion.calls.some(c=>c.m==='POST'&&c.path==='/v1/databases'),'重試沒有再建表');

    // ── #14 床位清單帶 phone / address / remark (備註一次查完，不逐床查) ──
    assert.equal(r.data.beds.length,3);
    const b1=r.data.beds[0];
    assert.equal(b1.name,'甲');assert.equal(b1.remark,'對花生過敏');assert.equal(b1.phone,'');assert.equal(b1.address,'');
    assert.equal(r.data.beds[1].isForeign,true);assert.equal(r.data.beds[1].remark,'');
    assert.equal(r.data.beds[2].isEmpty,true);assert.equal(r.data.beds[2].name,'');assert.equal(r.data.beds[2].remark,'');
    assert.equal(notion.calls.filter(c=>c.path===`/v1/databases/${remarksDb}/query`).length,1,'備註表只查一次');
    for(const b of r.data.beds)for(const k of ['room','bed','squad','name','class','studentId','isForeign','isEmpty','attendance','phone','address','remark'])assert.ok(k in b,'beds 缺欄位 '+k);
  }
  const newDb=r.data.newDbId;
  const bedsFromArchive=r.data.beds;

  // ── #11 (4) alreadyCurrent：前端還以為目前是舊學期又送一次 → 不報錯、回還沒建的床位；名稱真的一樣 (沒送 currentName) 照舊報錯 ──
  {
    r=await call('/api/semester/archive','POST',{newName:'115-2',start:'2027-02-01',end:'2027-02-03'});
    assert.equal(r.status,500);assert.match(r.data.error,/跟目前學期一樣/);
    r=await call('/api/semester/archive','POST',{newName:'115-2',start:'2027-02-01',end:'2027-02-03',currentName:'115-2'});
    assert.match(r.data.error,/跟目前學期一樣/);
    // 先建一張床，再重送：只回剩下兩張
    r=await call('/api/import-batch','POST',{db_id:newDb,students:[bedsFromArchive[0]]});assert.equal(r.data.success,true);assert.equal(r.data.imported,1);
    const before=dbCount();
    r=await call('/api/semester/archive','POST',{newName:'115-2',start:'2027-02-01',end:'2027-02-03',currentName:'115-1',carryResidents:true});
    assert.equal(r.status,200);assert.equal(r.data.success,true);assert.equal(r.data.alreadyCurrent,true);assert.equal(r.data.newDbId,newDb);
    assert.deepEqual(r.data.archived,{name:'115-1',dbId:master});assert.equal(r.data.current.name,'115-2');
    assert.deepEqual(r.data.beds.map(b=>b.room+b.bed),['B101B','B101C'],'新表已有的床位不再回傳');
    assert.equal(r.data.beds[0].name,'乙');
    assert.equal(dbCount(),before,'alreadyCurrent 不建表');assert.equal(notion.dbs[master].title,'碧苑點名總表 115-1');
    assert.equal(JSON.parse(kv.store.semester_state).archives.length,1,'學期狀態沒被重複 push');
  }

  // ── #13 import-batch：冪等 (重送同一批 → 更新不重建)、只覆蓋傳入欄位、phone/address/remark、部分失敗 success:false 且不帶 error ──
  {
    r=await call('/api/import-batch','POST',{db_id:newDb,students:bedsFromArchive});
    assert.equal(r.data.success,true);assert.equal(r.data.imported,2);assert.equal(r.data.updated,1,'第一張已存在 → 更新');assert.equal(r.data.total,3);assert.deepEqual(r.data.errors,[]);
    assert.equal(pagesIn(newDb).length,3);
    r=await call('/api/import-batch','POST',{db_id:newDb,students:bedsFromArchive});
    assert.equal(r.data.imported,0);assert.equal(r.data.updated,3);assert.equal(pagesIn(newDb).length,3,'重送同一批不會多床');
    assert.equal(r.data.error,undefined,'成功時也不帶 error');
    // 備註寫進備註表 (以新 pageId 為鍵)，重送內容一樣不再寫
    const np1Id=Object.keys(notion.pages).find(k=>notion.pages[k].db===newDb&&roomOf(notion.pages[k])==='B101'&&bedOf(notion.pages[k])==='A');
    const np1=notion.pages[np1Id];
    const remarkRows=()=>pagesIn(remarksDb).filter(p=>p.props['學號或姓名'].title[0].text.content===np1Id);
    assert.equal(remarkRows().length,1);assert.equal(remarkRows()[0].props['備註內容'].rich_text[0].text.content,'對花生過敏');
    const writes=notion.calls.filter(c=>c.path==='/v1/pages'&&c.m==='POST'&&c.body.parent.database_id===remarksDb).length;
    r=await call('/api/import-batch','POST',{db_id:newDb,students:bedsFromArchive});
    assert.equal(notion.calls.filter(c=>c.path==='/v1/pages'&&c.m==='POST'&&c.body.parent.database_id===remarksDb).length,writes,'備註沒變就不再寫');
    assert.equal(remarkRows().length,1,'備註不重複建');
    // 只覆蓋傳入的欄位：只送 phone/address → 姓名等不動；舊表沒電話欄會先補 (ensureContactColumns)
    const oldNames=pagesIn(newDb).map(nameOf);
    r=await call('/api/import-batch','POST',{db_id:master,students:[{room:'B101',bed:'A',phone:'0912-000-111',address:'台北市'}]});
    assert.equal(r.data.success,true);assert.equal(r.data.updated,1);assert.equal(r.data.imported,0);
    assert.ok(notion.dbs[master].properties['電話']&&notion.dbs[master].properties['住址'],'舊表自動補電話/住址欄');
    assert.equal(notion.pages[p1].props['電話'].rich_text[0].text.content,'0912-000-111');assert.equal(notion.pages[p1].props['住址'].rich_text[0].text.content,'台北市');
    assert.equal(nameOf(notion.pages[p1]),'甲','沒傳的欄位不動');assert.deepEqual(pagesIn(newDb).map(nameOf),oldNames);
    // 帶人過去：封存回來的 phone/address 寫進新表
    r=await call('/api/semester/archive','POST',{newName:'115-2',start:'2027-02-01',end:'2027-02-03',currentName:'115-1'});
    assert.equal(r.data.alreadyCurrent,true);assert.deepEqual(r.data.beds,[],'三張床都在了');
    r=await call('/api/import-batch','POST',{db_id:newDb,students:[{room:'B101',bed:'A',name:'甲',phone:'0912-000-111',address:'台北市',remark:'新備註'}]});
    assert.equal(r.data.success,true);assert.equal(np1.props['電話'].rich_text[0].text.content,'0912-000-111');assert.equal(np1.props['住址'].rich_text[0].text.content,'台北市');
    assert.equal(remarkRows()[0].props['備註內容'].rich_text[0].text.content,'新備註','備註變了就更新同一列');assert.equal(remarkRows().length,1);
    // 同一批裡重複床位 → 第二筆變更新
    r=await call('/api/import-batch','POST',{db_id:newDb,students:[{room:'B102',bed:'A',name:'丙',squad:'一單'},{room:'B102',bed:'A',name:'丙改',squad:'一單'}]});
    assert.equal(r.data.imported,1);assert.equal(r.data.updated,1);assert.equal(pagesIn(newDb).filter(p=>roomOf(p)==='B102').length,1);
    // 部分失敗：success:false、errors 列出哪床、不帶 error 字串 (前端 api.js 看到 error 會整包 throw)
    r=await call('/api/import-batch','POST',{db_id:newDb,students:[{room:'B103',bed:'A',name:'丁',squad:'一單'},{room:'B103',bed:'B',name:'戊',squad:'一單',attendance:{'2099-01-01':'✓'}}]});
    assert.equal(r.status,200);assert.equal(r.data.success,false);assert.equal(r.data.imported,1);assert.equal(r.data.errors.length,1);
    assert.equal(r.data.errors[0].name,'戊');assert.equal(r.data.errors[0].room,'B103');assert.equal(r.data.errors[0].bed,'B');assert.match(r.data.errors[0].error,/2099-01-01/);
    assert.equal(r.data.error,undefined,'不帶 error 字串');
    // 超過 20 筆：第 21 筆起進 errors，不寫入
    const many=[];for(let i=0;i<23;i++)many.push({room:'C'+(100+i),bed:'A',name:'學生'+i,squad:'二單'});
    const cnt=pagesIn(newDb).length;
    r=await call('/api/import-batch','POST',{db_id:newDb,students:many});
    assert.equal(r.data.success,false);assert.equal(r.data.imported,20);assert.equal(r.data.total,23);assert.equal(r.data.errors.length,3);
    assert.deepEqual(r.data.errors.map(e=>e.name),['學生20','學生21','學生22']);assert.match(r.data.errors[0].error,/超過單次上限/);
    assert.equal(pagesIn(newDb).length,cnt+20);
    // 備註表沒設定 → remark 略過、床位照建
    delete env.REMARKS_DB_ID;
    r=await call('/api/import-batch','POST',{db_id:newDb,students:[{room:'D101',bed:'A',name:'己',squad:'三單',remark:'x'}]});
    assert.equal(r.data.success,true);assert.equal(r.data.imported,1);
    env.REMARKS_DB_ID=remarksDb;
  }

  // ── #11 (3) 沒有 KV 記號時用 Notion 搜尋找同名新表重用；已刪除 (in_trash) 的同名表不算 ──
  {
    const st=JSON.parse(kv.store.semester_state);
    const trashed=notion.id();notion.dbs[trashed]={title:'碧苑點名總表 116-1',parent:{type:'page_id',page_id:'page-root'},properties:MASTER_PROPS(),in_trash:true};
    const other=notion.id();notion.dbs[other]={title:'碧苑點名總表 116-1',parent:{type:'page_id',page_id:'page-elsewhere'},properties:MASTER_PROPS()};
    const orphan=notion.id();notion.dbs[orphan]={title:'碧苑點名總表 116-1',parent:{type:'page_id',page_id:'page-root'},properties:MASTER_PROPS()};
    const before=dbCount();notion.calls.length=0;
    r=await call('/api/semester/archive','POST',{newName:'116-1',start:'2027-09-01',end:'2027-09-02',currentName:'115-2',carryResidents:false});
    assert.equal(r.data.success,true);assert.equal(r.data.newDbId,orphan,'重用同一父頁面下同名未刪除的表');assert.equal(dbCount(),before);
    assert.ok(notion.calls.some(c=>c.path==='/v1/search'&&c.body.query==='碧苑點名總表 116-1'&&c.body.filter.value==='database'));
    assert.deepEqual(Object.keys(notion.dbs[orphan].properties).filter(k=>/^\d{4}-/.test(k)),['2027-09-01','2027-09-02'],'重用的表補上日期欄');
    assert.ok(notion.dbs[orphan].properties['電話'],'重用的表補上電話欄');
    assert.equal(notion.dbs[st.current.dbId].title,'碧苑點名總表 115-2');
    assert.ok(r.data.beds.every(b=>b.isEmpty&&!b.name&&!b.remark&&!b.phone));
    r=await call('/api/semester');assert.equal(r.data.current.name,'116-1');assert.equal(r.data.archives.length,2);
  }

  // ── #11 (2) 舊表改名失敗只記錄：學期照樣切換成功 ──
  {
    const cur=JSON.parse(kv.store.semester_state).current.dbId;
    const errs=[];const realErr=console.error;console.error=(...a)=>errs.push(a.join(' '));
    notion.intercept=c=>(c.m==='PATCH'&&c.path===`/v1/databases/${cur}`&&c.body.title)?notion.bad('rename boom'):null;
    r=await call('/api/semester/archive','POST',{newName:'116-2',start:'2028-02-01',end:'2028-02-02',currentName:'116-1'});
    notion.intercept=null;console.error=realErr;
    assert.equal(r.data.success,true);assert.equal(JSON.parse(kv.store.semester_state).current.name,'116-2');
    assert.equal(notion.dbs[cur].title,'碧苑點名總表 116-1','改名沒成功 (下次手動改)');assert.ok(errs.some(s=>/舊表改名失敗/.test(s)));
    r=await call('/api/semester/archive','POST',{newName:'115-1',start:'2028-02-01',end:'2028-02-02',currentName:'116-2'});assert.match(r.data.error,/已經有封存/);
  }

  // ── #39 報修標題用台灣日期 (+08:00) ──
  {
    const repairDb='id-repair';
    notion.dbs[repairDb]={title:'報修',parent:{page_id:'page-root'},properties:{'標題':{title:{}},'原因':{rich_text:{}},'照片':{rich_text:{}},'報修人':{rich_text:{}},'建立時間':{created_time:{}}}};
    env.REPAIR_DB_ID=repairDb;
    const realNow=Date.now;Date.now=()=>Date.UTC(2026,8,14,20,30,0); // UTC 09-14 20:30 = 台灣 09-15 04:30
    r=await call('/api/repair-records','POST',{reason:'燈壞了',reporter:'甲'});
    Date.now=realNow;
    assert.equal(r.data.success,true);
    const rp=pagesIn(repairDb)[0];assert.equal(rp.props['標題'].title[0].text.content,'甲 的報修通知 2026-09-15');

    // ── #46 報修 / 回饋分頁抓到 500 筆 (每頁 100) ──
    for(let i=0;i<230;i++)notion.addPage(repairDb,{'標題':{type:'title',title:[{text:{content:'r'+i}}]},'原因':rt('x'),'照片':rt(''),'報修人':rt('甲'),'建立時間':{type:'created_time',created_time:new Date(Date.UTC(2026,0,1)+i*1000).toISOString()}});
    notion.calls.length=0;
    r=await call('/api/repair-records');
    assert.ok(Array.isArray(r.data));assert.equal(r.data.length,231,'不再只有 50 筆');
    const qs=notion.calls.filter(c=>c.path===`/v1/databases/${repairDb}/query`);assert.equal(qs.length,3);assert.equal(qs[0].body.page_size,100);assert.equal(qs[1].body.start_cursor,'100');
    const fbDb='id-feedback';
    notion.dbs[fbDb]={title:'回饋',parent:{page_id:'page-root'},properties:{'稱呼':{title:{}},'內容':{rich_text:{}},'照片':{rich_text:{}},'建立時間':{created_time:{}}}};
    env.FEEDBACK_DB_ID=fbDb;
    for(let i=0;i<620;i++)notion.addPage(fbDb,{'稱呼':{type:'title',title:[{text:{content:'f'+i}}]},'內容':rt('c'+i),'照片':rt(''),'建立時間':{type:'created_time',created_time:new Date(Date.UTC(2026,0,1)+i*1000).toISOString()}});
    notion.calls.length=0;
    r=await call('/api/feedback-records');
    assert.equal(r.data.length,500,'最多 500 筆');assert.equal(r.data[0].name,'f619','新到舊');assert.equal(notion.calls.filter(c=>c.path===`/v1/databases/${fbDb}/query`).length,5);
  }

  // ── #45 請假紀錄：回傳仍是陣列、name 篩選、最多 30 頁並加 X-Truncated header ──
  {
    const leaveDb='id-leave';
    notion.dbs[leaveDb]={title:'電話請假紀錄',parent:{page_id:'page-root'},properties:{'標題':{title:{}},'姓名':{rich_text:{}},'房號床位':{rich_text:{}},'請假範圍':{date:{}},'處理人':{rich_text:{}},'來電號碼':{phone_number:{}},'來電者備註':{rich_text:{}},'建立時間':{created_time:{}}}};
    env.LEAVE_DB_ID=leaveDb;
    const mkLeave=(name,day)=>notion.addPage(leaveDb,{'標題':{type:'title',title:[{text:{content:name+' 的請假申請'}}]},'姓名':rt(name),'房號床位':rt('B101 - A'),'請假範圍':{type:'date',date:{start:day,end:day}},'處理人':rt('櫃台'),'來電者備註':rt('')},day+'T02:00:00.000Z');
    mkLeave('王小明','2026-09-10');mkLeave('王小明','2026-09-12');mkLeave('李大華','2026-09-12');
    r=await call('/api/leave-records?name=王小明');
    assert.ok(Array.isArray(r.data));assert.equal(r.data.length,2);assert.ok(r.data.every(x=>x.name==='王小明'));assert.equal(r.headers.get('X-Truncated'),null);
    let q=notion.calls.filter(c=>c.path===`/v1/databases/${leaveDb}/query`).pop();
    assert.deepEqual(q.body.filter,{property:'姓名',rich_text:{contains:'王小明'}},'只有 name 時就是單一條件');
    r=await call('/api/leave-records?from=2026-09-12&to=2026-09-12&name=王小明');
    assert.equal(r.data.length,1);assert.equal(r.data[0].dateStart,'2026-09-12');
    q=notion.calls.filter(c=>c.path===`/v1/databases/${leaveDb}/query`).pop();
    assert.equal(q.body.filter.and.length,3);assert.deepEqual(q.body.filter.and[2],{property:'姓名',rich_text:{contains:'王小明'}});
    assert.deepEqual(q.body.filter.and.slice(0,2).map(f=>Object.values(f.created_time)[0]),['2026-09-12T00:00:00+08:00','2026-09-13T00:00:00+08:00'],'日期條件照舊排前面');
    r=await call('/api/leave-records?from=2026-09-12&to=2026-09-12');
    assert.equal(r.data.length,2);q=notion.calls.filter(c=>c.path===`/v1/databases/${leaveDb}/query`).pop();assert.equal(q.body.filter.and.length,2,'沒有 name 時查詢跟以前一模一樣');
    // 超過 3000 筆：拿 30 頁就停，header 標記截斷，JSON 還是純陣列
    for(let i=0;i<3050;i++)mkLeave('人'+i,'2026-08-01');
    notion.calls.length=0;
    r=await call('/api/leave-records');
    assert.ok(Array.isArray(r.data));assert.equal(r.data.length,3000);assert.equal(r.headers.get('X-Truncated'),'1');
    assert.equal(notion.calls.filter(c=>c.path===`/v1/databases/${leaveDb}/query`).length,30);
    r=await call('/api/leave-records?name=王小明');assert.equal(r.headers.get('X-Truncated'),null,'沒截斷就沒 header');
  }

  console.log('worker-semester: atomic archive (config-first, rename-last, pending reuse, search reuse, alreadyCurrent), import-batch idempotent/partial/limit/contact/remark, taipei date, leave name/truncate, repair+feedback paging PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
