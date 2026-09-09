const {chromium,webkit}=require('playwright');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const {PNG}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const server=require('http').createServer((req,res)=>res.end('<html></html>'));
// Every material edge is shared by exactly two triangles: no unsealed top/bottom
// caps, including rounded corners and the full U bend.
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'archive-model.js'),'utf8').replace('window.createArchiveModel=create;','window.geometryForTest=makeGeometry;'),sandbox);
for(const w of [256,279,360]){
  const g=sandbox.window.geometryForTest(w,Math.round(w*1.18)),edges=new Map();
  for(const data of [g.shell,g.edges])for(let i=0;i<data.length;i+=27){
    const p=[0,9,18].map(j=>Array.from(data.slice(i+j,i+j+3)).map(n=>n.toFixed(3)).join(','));
    for(const [a,b] of [[0,1],[1,2],[2,0]]){const k=[p[a],p[b]].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}
  }
  assert.equal([...edges.values()].filter(n=>n!==2).length,0,'watertight thin shell at width '+w);
}
async function run(engine){
 const browser=await engine.launch();try{
  const page=await browser.newPage({viewport:{width:900,height:650},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.setContent('<style>body{margin:0;background:#0c0e0c}.stage{position:relative;width:900px;height:590px}.sf-model-canvas{position:absolute;inset:0;width:100%;height:100%}</style><div class="stage"></div>');
  await page.addScriptTag({path:path.join(root,'archive-model.js')});
  await page.evaluate(()=>{
    const area=document.querySelector('.stage');window.model=createArchiveModel(area);
    const records=[-125,0,125].map((x,i)=>{const el=document.createElement('div');el.innerHTML='<span class="fd-name">合成測試 '+i+'</span>';return {x,y:0,z:0,rot:86-Math.atan2(x,1500)*180/Math.PI,scale:1,alpha:1,entry:{el,student:{bed:String(i+1)}}};});
    model.paint(records,{fw:360,fh:425});
  });
  assert.equal(await page.evaluate(()=>model.canvas.getContext('webgl').getError()),0);
  await page.locator('.stage').screenshot({path:path.join(out,engine.name()+'-folded-shell.png')});
  const original=await page.evaluate(()=>model.canvas.toDataURL());
  await page.evaluate(()=>model.records[1].entry.el._modelWipe=0);
  await page.evaluate(()=>model.repaint());
  assert.notEqual(await page.evaluate(()=>model.canvas.toDataURL()),original,'dissolve clips GPU geometry');
  await page.evaluate(()=>{delete model.records[1].entry.el._modelWipe;model.repaint();});
  const restored=await page.evaluate(()=>model.canvas.toDataURL());
  const a=PNG.sync.read(Buffer.from(original.split(',')[1],'base64')).data,b=PNG.sync.read(Buffer.from(restored.split(',')[1],'base64')).data;
  const meanError=a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
  assert.ok(meanError<1,'cancel restores geometry within one channel level of rasterization tolerance: '+meanError);
  const h=await page.evaluate(()=>model.hitTest(450,295)?.querySelector('.fd-name').textContent);
  assert.equal(h,'合成測試 1','ray picking matches the visible side-on model');
  await page.evaluate(()=>{model.paint([], {fw:360,fh:425});const g=model.canvas.getContext('webgl'),p=new Uint8Array(g.drawingBufferWidth*g.drawingBufferHeight*4);g.readPixels(0,0,g.drawingBufferWidth,g.drawingBufferHeight,g.RGBA,g.UNSIGNED_BYTE,p);window.empty=p.every(v=>v===0);});
  assert.equal(await page.evaluate(()=>empty),true,'empty search clears all GPU pixels');
  await page.setContent('<style>body{margin:0;background:#171722;font-family:Arial}.grid{position:fixed;inset:0;background:repeating-linear-gradient(90deg,transparent 0 9px,#55dda8 9px 11px),repeating-linear-gradient(0deg,#151525 0 9px,#dacefa 9px 11px)}.word{position:fixed;bottom:35px;left:320px;color:white;font-size:20px}.bottom-nav{display:flex;box-sizing:border-box}.nav-row{width:100%}.nav-item{display:flex;flex-direction:column;align-items:center;justify-content:center}</style><div class="grid"></div><div class="word">REFRACTION 12345</div><nav class="bottom-nav liquid-nav"><span class="liquid-lens"><span class="lens-shape"></span></span><span class="nav-row"><button class="nav-item">一</button><button class="nav-item">二</button><button class="nav-item">三</button><button class="nav-item">四</button></span></nav>');
  await page.addStyleTag({path:path.join(root,'liquid-nav.css')});await page.addScriptTag({path:path.join(root,'liquid-glass.js')});
  await page.evaluate(()=>{window.glass=createLiquidGlass(document.querySelector('nav'),document.querySelector('.lens-shape'));glass.snapshot();});
  await page.waitForTimeout(250);
  const nav=page.locator('nav'),bent=PNG.sync.read(await nav.screenshot({path:path.join(out,engine.name()+'-refraction.png')}));
  await page.evaluate(()=>document.querySelectorAll('feDisplacementMap').forEach(e=>e.setAttribute('scale','0')));
  await page.waitForTimeout(50);
  const plain=PNG.sync.read(await nav.screenshot());let edge=0,centre=0;
  for(let y=0;y<bent.height;y++)for(let x=120;x<250;x++){
    const k=(y*bent.width+x)*4,d=Math.abs(bent.data[k]-plain.data[k])+Math.abs(bent.data[k+1]-plain.data[k+1])+Math.abs(bent.data[k+2]-plain.data[k+2]);
    if(d>20){if(y<16||y>bent.height-16)edge++;else if(y>23&&y<40)centre++;}
  }
  assert.ok(edge>300,'background pixels must actually bend at the glass perimeter: '+edge);
  assert.ok(centre<edge*.2,'centre is optically stable, not whole-surface noise: '+centre+'/'+edge);
  assert.equal(await page.locator('nav button').count(),4);
  assert.equal(await page.locator('nav [id]').count(),0,'snapshot has no duplicate IDs');
  if(engine===webkit){
    const before=await page.evaluate(()=>glass.revision);await page.evaluate(()=>document.querySelector('.word').textContent='UPDATED');await page.waitForTimeout(250);
    assert.ok(await page.evaluate(()=>glass.revision)>before,'mirror refreshes after page updates');
    const rev=await page.evaluate(()=>glass.revision);await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>glass.revision),rev,'no idle snapshot loop');
  }
  assert.deepEqual(errors,[]);console.log(engine.name()+': closed U mesh, clipping/restoration, picking, empty pixels, edge refraction '+edge+' px, stable centre '+centre+' px PASS');
 }finally{await browser.close();}
}
server.listen(0,'127.0.0.1',async()=>{try{await run(chromium);await run(webkit);}catch(e){console.error(e);process.exitCode=1;}finally{server.close();}});
