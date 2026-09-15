// 備份：把後端所有「讀取」端點抓下來存成 JSON (不寫入任何資料)
const fs=require('fs'),path=require('path');
const BASE='https://biyuan-proxy.s010828.workers.dev';
const stamp=new Date(Date.now()+8*3600e3).toISOString().slice(0,16).replace('T','_').replace(':','');
const dir=path.join('D:/壁院宿舍系統/backups',stamp);fs.mkdirSync(dir,{recursive:true});
const eps=['/api/roster','/api/config','/api/semester','/api/changelog','/api/leave-records','/api/repair-records','/api/feedback-records','/api/remarks','/api/poll'];
(async()=>{
  const summary=[];
  for(const ep of eps){
    const t0=Date.now();
    try{const r=await fetch(BASE+ep);const txt=await r.text();
      const name=ep.replace('/api/','').replace(/\W/g,'_')+'.json';fs.writeFileSync(path.join(dir,name),txt);
      let n='';try{const j=JSON.parse(txt);n=Array.isArray(j)?j.length:(j.students?j.students.length:Object.keys(j).length);}catch{}
      summary.push(`${ep} ${r.status} ${txt.length}B items=${n} ${Date.now()-t0}ms`);
    }catch(e){summary.push(`${ep} ERR ${e.message}`);}
  }
  // 封存學期的名單也抓
  try{const sem=JSON.parse(fs.readFileSync(path.join(dir,'semester.json'),'utf8'));
    for(const a of (sem.archives||[])){const r=await fetch(BASE+'/api/roster?semester='+encodeURIComponent(a.name));fs.writeFileSync(path.join(dir,'roster_'+a.name.replace(/\W/g,'_')+'.json'),await r.text());summary.push('archive '+a.name+' '+r.status);}
  }catch(e){summary.push('archives ERR '+e.message);}
  fs.writeFileSync(path.join(dir,'_summary.txt'),summary.join('\n'));
  console.log(dir);console.log(summary.join('\n'));
})();
