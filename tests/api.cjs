const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
let calls=0;
const ctx=vm.createContext({window:{},AbortController,setTimeout,clearTimeout,fetch:async()=>{calls++;return {ok:false,status:503,json:async()=>({})};}});
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../api.js'),'utf8'),ctx);
(async()=>{
  await assert.rejects(()=>ctx.window._api.setConfig({test:true}),/HTTP 503/);
  assert.equal(calls,1,'Writes must not be replayed after an uncertain response');
  calls=0;await assert.rejects(()=>ctx.window._api.getConfig(),/HTTP 503/);
  assert.equal(calls,2,'Read requests may retry');
  assert.equal(await ctx.window._api.poll(),null);
  console.log('HTTP errors, safe write retry policy and poll failure PASS');
})().catch(e=>{console.error(e);process.exit(1);});
