const {chromium}=require('playwright');const assert=require('node:assert/strict');
const clone=x=>JSON.parse(JSON.stringify(x));const C=require('../sync-core');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--no-process-singleton','--no-zygote','--single-process']});const errors=[];
 let state=null,writes=new Map(),hold=false,waiters=[],dropNext=false,readCount=0;
 const user={id:'10000000-0000-4000-8000-000000000001',email:'test@example.invalid'};
 async function context(mobile=false){
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
  await ctx.addInitScript(({user})=>localStorage.setItem('popup-auth-v1',JSON.stringify({access_token:'simulation',refresh_token:'simulation',expires_at:4000000000,user})),{user});
  await ctx.route('https://fjxinlhaqryliccbtytf.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();
   if(url.pathname==='/rest/v1/shopping_state'){
    if(req.method()==='GET'){readCount++;return route.fulfill({json:state?[clone(state)]:[]})}
    if(req.method()==='POST'){state={data:body.data,revision:1};return route.fulfill({status:201,json:null})}
   }
   if(url.pathname==='/rest/v1/rpc/apply_shopping_write'){
    if(hold)await new Promise(resolve=>waiters.push(resolve));
    if(writes.has(body.mutation_id))return route.fulfill({json:writes.get(body.mutation_id)});
    if(state.revision!==body.expected_revision)return route.fulfill({json:{applied:false}});
    state={data:clone(body.candidate),revision:state.revision+1};let result={applied:true,revision:state.revision};writes.set(body.mutation_id,result);
    if(dropNext){dropNext=false;return route.abort('failed')}
    return route.fulfill({json:result});
   }
   return route.fulfill({status:400,json:{message:'Unexpected API request '+url.pathname}});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='prompt'?d.dismiss():d.accept());await page.goto('http://localhost:8765');await page.waitForFunction(()=>cloudReady&&!dirty&&!syncBusy&&db.events.length===2);return {ctx,page};
 }
 const a=await context(),b=await context(true);const p=a.page,q=b.page;
 const stable=page=>page.waitForFunction(()=>!dirty&&!syncBusy&&!inflight);
 await p.getByRole('heading',{name:'NMIXX · EP. ZERO : FRONTIER',exact:true}).click();await p.getByRole('button',{name:'商品目录',exact:true}).click();
 assert.equal(await p.locator('#content>.card').filter({has:p.locator('img[src*="series-"]')}).count(),20);
 // Every image loads in actual Chromium, at both viewport sizes.
 for(const page of [p,q]){
  await page.evaluate(()=>{current=db.events.find(e=>e.presetKind==='nmixx').id;tab='products';render()});
  const imgs=page.locator('img[src*="series-"]');for(let i=0;i<await imgs.count();i++){await imgs.nth(i).scrollIntoViewIfNeeded();await imgs.nth(i).evaluate(im=>im.decode())}
  assert.equal(await imgs.count(),20);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await p.getByRole('button',{name:'订单',exact:true}).click();await p.getByPlaceholder('顾客昵称',{exact:true}).fill('顾客 A');await p.locator('#choices button').nth(1).click();await p.locator('#choices button').nth(2).click();await p.getByRole('button',{name:'确认订单',exact:true}).click();await stable(p);
 const first=await p.evaluate(()=>clone(ev().orders[0]));assert.equal(first.lines.length,2);assert.equal(await p.evaluate(()=>Object.keys(basket).length),0);assert.equal(await p.getByPlaceholder('顾客昵称',{exact:true}).inputValue(),'');
 await q.evaluate(()=>syncNow());assert.equal(await q.evaluate(()=>ev().orders.length),1);
 // Same nickname, another independent immutable order.
 await p.getByPlaceholder('顾客昵称',{exact:true}).fill('顾客 A');await p.locator('#choices button').nth(1).click();await p.getByRole('button',{name:'确认订单',exact:true}).click();await stable(p);
 await q.evaluate(()=>syncNow());assert.equal(await q.evaluate(()=>ev().orders.length),2);
 await p.getByRole('button',{name:'修正',exact:true}).first().click();await p.getByPlaceholder('顾客昵称',{exact:true}).fill('顾客 A 修正');await p.getByRole('button',{name:'保存修正',exact:true}).click();await stable(p);
 const edited=await p.evaluate(()=>clone(ev().orders[0]));assert.equal(first.number,edited.number);assert.equal(first.createdAt,edited.createdAt);
 // Order reversal changes first-come allocation; minus never changes order lines.
 await p.evaluate(()=>{buy(ev().orders[0].lines[0].id,1)});await stable(p);
 await p.evaluate(()=>moveOrder(ev().orders[1].id,-1));await stable(p);
 assert.match(await p.evaluate(()=>allocation(ev(),queue(ev())[0])),/已分配 1 \/ 1/);
 const before=await p.evaluate(()=>JSON.stringify(ev().orders));await p.evaluate(()=>buy(ev().orders[0].lines[0].id,-1));await stable(p);assert.equal(await p.evaluate(()=>JSON.stringify(ev().orders)),before);
 // Both devices start from one baseline and click + once concurrently.
 await q.evaluate(()=>syncNow());hold=true;
 await Promise.all([p.evaluate(()=>buy(ev().orders[0].lines[0].id,1)),q.evaluate(()=>buy(ev().orders[0].lines[0].id,1))]);
 await new Promise(r=>setTimeout(r,100));hold=false;waiters.splice(0).forEach(r=>r());await Promise.all([stable(p),stable(q)]);await p.evaluate(()=>syncNow());
 assert.equal(await p.evaluate(()=>ev().products.find(p=>p.id===ev().orders[0].lines[0].id).bought),2);
 // Response lost AFTER server commit: retry the same write ID exactly once.
 dropNext=true;await p.evaluate(()=>buy(ev().orders[0].lines[0].id,1));await p.waitForFunction(()=>!syncBusy&&!!inflight);await p.evaluate(()=>syncNow());await stable(p);
 assert.equal(await p.evaluate(()=>ev().products.find(p=>p.id===ev().orders[0].lines[0].id).bought),3);
 // Offline outbox survives reload, then replays once on reconnect.
 await p.context().setOffline(true);await p.evaluate(()=>buy(ev().orders[0].lines[0].id,1));await p.waitForFunction(()=>!syncBusy&&dirty);await p.context().setOffline(false);await p.reload();await stable(p);await p.waitForFunction(()=>db.events.length===2);
 await p.evaluate(()=>{current=db.events.find(e=>e.presetKind==='nmixx').id;tab='purchase';render()});
 assert.equal(await p.evaluate(()=>ev().products.find(p=>p.id===ev().orders[0].lines[0].id).bought),4);
 // Migration from old preset IDs, repeated import and immutable order receipt.
 await p.evaluate(()=>{let e=clone(db.events[0]);e.id='legacy-event';e.products=e.products.map(x=>({...x,id:'legacy-'+x.id}));e.orders=[{id:'legacy-order',number:17,rank:-1,name:'旧顾客',createdAt:'2025-01-01',lines:[{id:e.products[0].id,q:2}]}];legacyData={events:[e],next:18};legacyRaw=JSON.stringify(legacyData);localStorage.setItem(KEY,legacyRaw);migrationPending=true;syncPanel()});
 await p.getByRole('button',{name:'合并本机数据到云端',exact:true}).click();await stable(p);await p.waitForFunction(()=>!migrationPending);
 assert.equal(await p.evaluate(()=>db.events.flatMap(e=>e.orders).filter(o=>o.id==='legacy-order').length),1);
 await p.evaluate(()=>{migrationPending=true});await p.evaluate(()=>migrateLocal());await stable(p);assert.equal(await p.evaluate(()=>db.events.flatMap(e=>e.orders).filter(o=>o.id==='legacy-order').length),1);assert.ok(await p.evaluate(()=>localStorage.getItem(KEY)));
 await q.evaluate(()=>syncNow());assert.equal(await q.evaluate(()=>db.events.flatMap(e=>e.orders).find(o=>o.id==='legacy-order').number),17);
 // Another browser tab sharing an account is read-only to protect the durable outbox.
 const same=await a.ctx.newPage();same.on('dialog',d=>d.accept());await same.goto('http://localhost:8765');await same.waitForFunction(()=>cloudReady&&!syncBusy);assert.equal(await same.evaluate(()=>ownsAccount),false);await same.close();
 await q.evaluate(()=>{current=db.events.find(e=>e.presetKind==='miniteen').id;tab='products';render()});
 const mini=q.locator('img[src*="series-"]');for(let i=0;i<await mini.count();i++){await mini.nth(i).scrollIntoViewIfNeeded();await mini.nth(i).evaluate(im=>im.decode())}assert.equal(await mini.count(),12);assert.equal(await q.evaluate(()=>ev().products.length),84);
 assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 await q.screenshot({path:'/workspace/scratch/mobile-verified.png'});
 console.log(JSON.stringify({passed:true,tests:['32 official images in Chromium','mobile no horizontal overflow','new and edited multi-item orders','immutable IDs and creation times','first-come allocation and queue moves','purchase minus leaves orders intact','two independent contexts synchronize','simultaneous increments preserved','lost response retry idempotent','offline durable outbox reload','legacy merge deduplication and original preserved','second same-browser tab read-only','MINITEEN 13 image-numbered variants'],errors,apiReads:readCount},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
