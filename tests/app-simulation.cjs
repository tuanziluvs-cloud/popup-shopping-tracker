/* Application integration tests with isolated browser/storage contexts and a shared
   simulated HTTP transport. Real database permissions/RPCs are tested separately. */
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');const core=fs.readFileSync(__dirname+'/../sync-core.js','utf8'),cloud=fs.readFileSync(__dirname+'/../cloud.js','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));let state=null,receipts=new Map(),hold=false,waiters=[],drop=false,offline=new Set(),calls=0;
const user={id:'00000000-0000-4000-8000-000000000001',email:'test@example.invalid'};
function app(id,initial){
 const nodes=new Map();function element(key){if(nodes.has(key))return nodes.get(key);let content='';const obj={id:key,value:'',textContent:'',classList:{toggle(){return false},contains(){return false},add(){},remove(){}},set innerHTML(s){content=s;for(const m of s.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){const el=element(m[1]);el.value=(m[0].match(/\bvalue="([^"]*)"/)||[])[1]||''}},get innerHTML(){return content},focus(){},click(){},setSelectionRange(){}};nodes.set(key,obj);return obj}
 for(const key of ['app','sync-status','account-button','account','sync-panel'])element(key);
 const storage=new Map(initial||[]);storage.set('popup-auth-v1',JSON.stringify({user,access_token:'simulation',refresh_token:'simulation',expires_at:4000000000}));
 const ctx=vm.createContext({console,URL,URLSearchParams,crypto:webcrypto,TextEncoder,AbortSignal,Blob,Date,Math,JSON,Map,Set,Promise,Error,Number,String,Array,Object,Infinity,
 document:{hidden:false,querySelector:s=>element(s.slice(1)),getElementById:element,createElement:()=>element('generated'),activeElement:null},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 location:{origin:'https://test.invalid',pathname:'/',hash:'',search:''},history:{replaceState(){}},navigator:{},
 alert:()=>{},confirm:()=>true,prompt:()=>null,setInterval:()=>0,setTimeout,queueMicrotask,addEventListener(){},
 fetch:async(url,opts)=>{calls++;if(offline.has(id))throw Error('offline');const path=new URL(url).pathname,body=opts.body&&JSON.parse(opts.body);let result;
 if(path==='/rest/v1/shopping_state'){if(opts.method==='GET')result=state?[clone(state)]:[];else if(opts.method==='POST'){if(state)throw Error('duplicate');state={data:body.data,revision:1};result=null}}
 else if(path==='/rest/v1/rpc/apply_shopping_write'){
  if(hold)await new Promise(r=>waiters.push(r));
  if(receipts.has(body.mutation_id))result=receipts.get(body.mutation_id);
  else if(state.revision!==body.expected_revision)result={applied:false};
  else{state={data:clone(body.candidate),revision:state.revision+1};result={applied:true,revision:state.revision};receipts.set(body.mutation_id,result);if(drop){drop=false;throw Error('response lost')}}
 }else throw Error('Unexpected request '+path);
 return {ok:true,status:200,text:async()=>JSON.stringify(result)};
 }});ctx.window=ctx;vm.runInContext(html.split('<script>')[1].split('</script>')[0],ctx);vm.runInContext(core,ctx);vm.runInContext(cloud,ctx);
 return {ctx,storage,run:s=>vm.runInContext(s,ctx),element};
}
async function idle(a){for(let i=0;i<300;i++){if(a.run('cloudReady&&!syncBusy&&!dirty&&!inflight'))return;await new Promise(r=>setTimeout(r,5))}throw Error('Not idle: '+a.run('syncMessage'))}
(async()=>{
 const a=app('a');await idle(a);const b=app('b');await idle(b);assert.equal(a.run('db.events.length'),2);
 a.run("current=db.events[0].id;tab='orders';render();basket={[ev().products[0].id]:2,[ev().products[1].id]:1}");a.element('customer').value='顾客 A';a.run('submitOrder()');await idle(a);
 const first=a.run('clone(ev().orders[0])');assert.equal(first.lines.length,2);assert.equal(a.run('Object.keys(basket).length'),0);
 await b.run('syncNow()');assert.equal(b.run('db.events[0].orders.length'),1);
 a.run('editOrder(ev().orders[0].id)');a.element('customer').value='修改昵称';a.run('submitOrder()');await idle(a);assert.equal(a.run('ev().orders[0].number'),first.number);assert.equal(a.run('ev().orders[0].createdAt'),first.createdAt);
 a.run("basket={[ev().products[0].id]:1}");a.element('customer').value='修改昵称';a.run('submitOrder()');await idle(a);assert.equal(a.run('ev().orders.length'),2);
 a.run('buy(ev().products[0].id,1)');await idle(a);assert.match(a.run('allocation(ev(),ev().orders[0])'),/已分配 1 \/ 3/);
 a.run('moveOrder(ev().orders[1].id,-1)');await idle(a);assert.match(a.run('allocation(ev(),queue(ev())[0])'),/已分配 1 \/ 1/);
 const lines=a.run('JSON.stringify(ev().orders)');a.run('buy(ev().products[0].id,-1)');await idle(a);assert.equal(a.run('JSON.stringify(ev().orders)'),lines);
 await b.run('syncNow()');b.run('current=db.events[0].id');hold=true;a.run('buy(ev().products[0].id,1)');b.run('buy(ev().products[0].id,1)');await new Promise(r=>setTimeout(r,25));hold=false;waiters.splice(0).forEach(r=>r());await Promise.all([idle(a),idle(b)]);await a.run('syncNow()');assert.equal(a.run('ev().products[0].bought'),2);
 drop=true;a.run('buy(ev().products[0].id,1)');await new Promise(r=>setTimeout(r,30));assert.ok(a.run('inflight'));await a.run('syncNow()');await idle(a);assert.equal(a.run('ev().products[0].bought'),3);
 offline.add('a');a.run('buy(ev().products[0].id,1)');await new Promise(r=>setTimeout(r,30));assert.ok(a.run('dirty'));offline.delete('a');const reloaded=app('a',a.storage);await idle(reloaded);reloaded.run('current=db.events[0].id');assert.equal(reloaded.run('ev().products[0].bought'),4);
 reloaded.run("let old=clone(db.events[0]);old.id='legacy-event';old.products=old.products.map(p=>({...p,id:'old-'+p.id}));old.orders=[{id:'old-order',number:17,rank:-1,name:'旧顾客',lines:[{id:old.products[0].id,q:1}]}];legacyData={events:[old],next:18};legacyRaw=JSON.stringify(legacyData);localStorage.setItem(KEY,legacyRaw);migrationPending=true");await reloaded.run('migrateLocal()');await idle(reloaded);assert.equal(reloaded.run('migrationPending'),false);assert.equal(reloaded.run('db.events[0].orders.filter(o=>o.id===\'old-order\').length'),1);
 await reloaded.run('migrateLocal()');await idle(reloaded);assert.equal(reloaded.run('db.events[0].orders.filter(o=>o.id===\'old-order\').length'),1);assert.ok(reloaded.storage.get('popup-proxy-v1'));
 await b.run('syncNow()');assert.equal(b.run("db.events[0].orders.find(o=>o.id==='old-order').number"),17);
 // Simultaneous edits of the same order pause instead of dropping either version.
 await reloaded.run('syncNow()');hold=true;reloaded.run("ev().orders[0].name='left';save()");b.run("ev().orders[0].name='right';save()");await new Promise(r=>setTimeout(r,25));hold=false;waiters.splice(0).forEach(r=>r());await new Promise(r=>setTimeout(r,30));assert.ok(reloaded.run('conflict')||b.run('conflict'));
 const conflicting=reloaded.run('conflict')?reloaded:b;conflicting.run("resolveConflict('remote')");await idle(conflicting);
 assert.equal(a.run("presetProducts('nmixx').length"),75);assert.equal(a.run("presetProducts('miniteen').length"),84);
 for(const kind of ['nmixx','miniteen']){
  const e=a.run('db.events.find(e=>e.presetKind===\''+kind+'\')');const imgs=new Set(e.products.map(p=>a.run('seriesImage('+JSON.stringify(e)+','+JSON.stringify(p)+')')));assert.equal(imgs.size,kind==='nmixx'?20:12);for(const img of imgs)assert.ok(fs.existsSync(__dirname+'/../'+img));
 }
 console.log(JSON.stringify({passed:true,transport:'simulated; real SQL tests recorded separately',checks:['new multi-item order, empty basket','order edit preserves number and creation time','same customer multiple orders','queue reversal and first-come allocation','minus leaves orders intact','two independent application contexts','identical concurrent increments','lost-response idempotency','offline reload preserves pending write','legacy merge preserves IDs/rank and deduplicates','same-field conflict and resolution','32 series image paths','75 NMIXX variants and 84 MINITEEN variants'],httpCalls:calls},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
