'use strict';
const SB_URL='https://fjxinlhaqryliccbtytf.supabase.co';
const SB_KEY='sb_publishable_sheQaxc9LpCMhk85mDR-iQ_9fukX6ef';
const {clone,equal,merge,importLegacy,validate}=SyncCore;
let session=null,baseState=null,revision=0,dirty=false,syncBusy=false,cloudReady=false,conflict=false,cacheKey=null,syncMessage='本机保存 · 登录后同步',draftName='',lastSaved=clone(db),resolution=null,inflight=null;
let ownsAccount=true,releaseAccount=null;
async function claimAccount(){
 if(releaseAccount){releaseAccount();releaseAccount=null}
 if(!navigator.locks){ownsAccount=true;return}
 ownsAccount=await new Promise(resolve=>{navigator.locks.request('popup-editor:'+session.user.id,{ifAvailable:true},async lock=>{resolve(!!lock);if(lock)await new Promise(release=>releaseAccount=release)})});
}
let legacyRaw=localStorage.getItem(KEY),legacyData=clone(db),migrationPending=false;
function status(message){syncMessage=message;document.getElementById('sync-status').textContent=message+(session&&!ownsAccount?' · 此标签页只读，另一标签页正在编辑':'');document.getElementById('account-button').textContent=session?'账户 / 同步':'登录云同步';syncPanel()}
function syncPanel(){let box=document.getElementById('sync-panel');if(!box)return;
 box.innerHTML=(migrationPending?'<div class="notice"><b>检测到此浏览器的旧版数据</b><p>目标账户：'+esc(session?.user.email)+'</p><p>含 '+legacyData.events.reduce((n,e)=>n+e.orders.length,0)+' 笔订单。合并会保留原编号与排队顺序，保留云端已有订单，重复导入不会重复添加。</p><button class="primary" onclick="migrateLocal()">合并本机数据到云端</button> <button onclick="backupLegacy()">先下载本机备份</button></div>':'')+(conflict?'<div class="notice"><b>同一项发生并发修改，已暂停上传</b><p>原始待同步数据仍保存在本机。请选择冲突字段的版本；其他设备新增的订单都会保留。</p><button onclick="resolveConflict(\'remote\')">冲突项采用云端版本</button> <button onclick="resolveConflict(\'local\')">冲突项采用本机版本</button> <button onclick="backup()">下载当前备份</button></div>':'');
}
function persist(){if(!cacheKey||!ownsAccount)return;localStorage.setItem(cacheKey,JSON.stringify({base:baseState,data:db,revision,dirty,inflight}));}
function cloudSave(){
 try{validate(db);if(!session){localStorage.setItem(KEY,JSON.stringify(db));legacyRaw=localStorage.getItem(KEY);legacyData=clone(db);lastSaved=clone(db);status('本机保存 · 尚未登录');return true}
 if(!ownsAccount)throw Error('同一账户正在另一标签页编辑，请关闭此页并使用原标签页');
 if(!cloudReady)throw Error('云端正在加载，请稍后重试');
 dirty=true;persist();lastSaved=clone(db);status('待同步 · 已保存在本机');queueMicrotask(()=>void syncNow());return true;
 }catch(err){db=clone(lastSaved);alert('保存失败：'+err.message);return false}
}
async function api(path,{method='GET',body,auth=true,headers={}}={}){
 if(auth&&session&&session.expires_at<Date.now()/1000+90)await refreshSession();
 const response=await fetch(SB_URL+path,{method,headers:{apikey:SB_KEY,...(auth&&session?{Authorization:'Bearer '+session.access_token}:{}),'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=null}
 if(!response.ok)throw Error(data?.msg||data?.message||data?.error_description||'请求失败 '+response.status);return data;
}
function storeSession(value){session=value;if(value){session.expires_at=value.expires_at||Math.floor(Date.now()/1000)+(value.expires_in||3600);localStorage.setItem('popup-auth-v1',JSON.stringify(session))}else localStorage.removeItem('popup-auth-v1')}
async function refreshSession(){let result=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},auth:false});storeSession(result)}
async function syncNow(){
 if(!session||syncBusy||conflict||!cloudReady)return;
 syncBusy=true;const originalFocus=document.activeElement?.id;
 try{
  for(let attempt=0;attempt<5;attempt++){
   status(dirty?'正在上传云端…':'正在检查更新…');
   if(inflight){
    const result=await api('/rest/v1/rpc/apply_shopping_write',{method:'POST',body:{expected_revision:inflight.revision,mutation_id:inflight.id,candidate:inflight.candidate}});
    if(result.applied){db=merge(inflight.snapshot,db,inflight.candidate,'data','local');baseState=clone(inflight.candidate);revision=result.revision;dirty=!equal(db,baseState);lastSaved=clone(db)}
    inflight=null;persist();safeRender();
   }
   let rows=await api('/rest/v1/shopping_state?select=data,revision&user_id=eq.'+session.user.id);
   let remote=rows[0];
   if(!remote){
    try{await api('/rest/v1/shopping_state',{method:'POST',body:{user_id:session.user.id,data:{events:[],next:1}},headers:{Prefer:'return=minimal'}})}catch(e){if(!/duplicate|unique/i.test(e.message))throw e}
    continue;
   }
   if(!dirty){
    const changed=!equal(db,remote.data);baseState=clone(remote.data);db=clone(remote.data);revision=remote.revision;lastSaved=clone(db);persist();if(changed)safeRender();status('云端已同步 · '+new Date().toLocaleTimeString());break;
   }
   const localSnapshot=clone(db),oldBase=clone(baseState),candidate=validate(merge(oldBase,localSnapshot,remote.data,'data',resolution));
   inflight={id:crypto.randomUUID(),revision:remote.revision,candidate,snapshot:localSnapshot};persist();
   const written=await api('/rest/v1/rpc/apply_shopping_write',{method:'POST',body:{expected_revision:inflight.revision,mutation_id:inflight.id,candidate}});
   if(!written.applied){inflight=null;persist();continue}
   db=merge(localSnapshot,db,candidate,'data','local');baseState=clone(candidate);revision=written.revision;dirty=!equal(db,candidate);inflight=null;lastSaved=clone(db);persist();safeRender();
   if(!dirty){resolution=null;status('云端已同步 · '+new Date().toLocaleTimeString());break}
  }
  if(dirty)status('待同步 · 将自动重试');
 }catch(err){
  if(err.message.startsWith('两台设备')){conflict=true;status('同步冲突 · 需要选择版本')}
  else status('同步失败 · '+err.message+' · 自动重试');
 }finally{syncBusy=false}
}
function safeRender(){
 // Background updates preserve unsaved nickname, search text, basket and focused input.
 const input=document.getElementById('customer');if(input)draftName=input.value;
 const focus=document.activeElement?.id,start=document.activeElement?.selectionStart,end=document.activeElement?.selectionEnd;
 render();const name=document.getElementById('customer');if(name)name.value=draftName;
 const field=focus&&document.getElementById(focus);if(field){field.focus();try{field.setSelectionRange(start,end)}catch{}}
}
function resolveConflict(choice){resolution=choice;conflict=false;void syncNow()}
async function loadAccount(){
 await claimAccount();cloudReady=false;current=null;basket={};basketPrices={};editId=null;draftName='';status('正在加载云端…');
 cacheKey='popup-cloud-v2:'+session.user.id;
 let cached;try{cached=JSON.parse(localStorage.getItem(cacheKey))}catch{}
 if(cached&&!ownsAccount)cached={...cached,data:cached.base,dirty:false,inflight:null};
 if(cached){baseState=cached.base;db=cached.data;dirty=cached.dirty;revision=cached.revision;inflight=cached.inflight||null}
 else{db={events:[],next:1};baseState=clone(db);dirty=false;revision=0;inflight=null}
 lastSaved=clone(db);render();cloudReady=true;await syncNow();
 if(ownsAccount&&!db.events.length&&!dirty&&!syncMessage.startsWith('同步失败')){seedCatalogs();cloudSave();await syncNow()}
 if(ownsAccount){let upgraded=false;for(const e of db.events)upgraded=upgradeMiniteen(e)||upgraded;if(upgraded){cloudSave();await syncNow()}}
 migrationPending=ownsAccount&&!!legacyRaw&&!localStorage.getItem('popup-migrated-v2:'+session.user.id+':'+await hash(legacyRaw));syncPanel();render();
}
function seedCatalogs(){for(const kind of ['nmixx','miniteen']){if(db.events.some(e=>e.presetKind===kind))continue;const preset=PRESETS[kind];db.events.push({id:'preset-'+kind,name:preset.name,group:preset.group,archived:false,presetKind:kind,products:presetProducts(kind).map(p=>({...p,id:p.presetKey})),orders:[]})}}
async function hash(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')}
function backupLegacy(){downloadJson(legacyData,'popup-legacy-backup.json')}
function downloadJson(data,name){let a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function migrateLocal(){
 if(!session||!cloudReady||syncBusy||dirty||conflict)return alert('请等待云端同步成功后再合并。');
 try{
  const merged=importLegacy(db,validate(legacyData));validate(merged.data);
  db=merged.data;if(!cloudSave())return;await syncNow();
  if(dirty||conflict)throw Error('数据已保存在本机待同步，尚未完成云端确认。');
  // Confirm an actual server roundtrip before recording the import receipt.
  const rows=await api('/rest/v1/shopping_state?select=data&user_id=eq.'+session.user.id);
  for(const e of legacyData.events)for(const o of e.orders)if(!rows[0]?.data.events.some(x=>x.orders.some(y=>y.id===o.id&&equal(y.number,o.number))))throw Error('订单核验未通过，旧数据保持原样。');
  localStorage.setItem('popup-migrated-v2:'+session.user.id+':'+await hash(legacyRaw),'verified');migrationPending=false;syncPanel();safeRender();alert('合并已确认：新增 '+merged.report.orders+' 笔订单。旧版本机数据仍完整保留。');
 }catch(err){alert('合并未完成：'+err.message)}
}
function showAccount(){
 const box=document.getElementById('account');box.classList.toggle('hide');if(box.classList.contains('hide'))return;
 box.innerHTML=session?'<h2>云端账户</h2><p>'+esc(session.user.email)+'</p><p>'+esc(syncMessage)+'</p><button onclick="syncNow()">立即同步</button> <button onclick="signOut()">退出登录</button><details><summary>修改账户密码</summary><label for="current-password">当前密码</label><input id="current-password" type="password" autocomplete="current-password"><label for="new-password">新密码（至少 8 位）</label><input id="new-password" type="password" autocomplete="new-password" minlength="8"><label for="repeat-password">再次输入新密码</label><input id="repeat-password" type="password" autocomplete="new-password"><p><button id="change-password" onclick="changePassword()">保存新密码</button></p><p id="password-message" role="status"></p></details>':
 '<h2>登录云同步</h2><p class="muted">电脑和手机使用同一个邮箱账户。每个账户的数据独立且受权限保护。</p><label for="email">邮箱</label><input id="email" type="email" autocomplete="username"><label for="password">密码（至少 8 位）</label><input id="password" type="password" autocomplete="current-password" minlength="8"><p><button class="primary" onclick="authenticate(false)">登录</button> <button onclick="authenticate(true)">注册</button></p><p id="auth-message" role="status"></p><p class="muted">已点击邮件中的确认按钮？请直接在上方输入邮箱和密码并点“登录”。</p><details><summary>备用：用确认邮件链接验证</summary><p class="muted">仅在无法打开确认邮件链接时使用。这里需要邮件中确认按钮的完整 https:// 链接，不能填写邮箱地址。</p><label for="confirm-link">确认邮件中的完整链接</label><input id="confirm-link" type="url" inputmode="url" autocomplete="off" placeholder="https://…/auth/v1/verify?token=…"><button onclick="confirmEmail()">验证确认链接</button></details>';
}
async function changePassword(){
 const msg=document.getElementById('password-message'),button=document.getElementById('change-password');
 if(!session){msg.textContent='请先登录账户。';return}
 const old=document.getElementById('current-password'),first=document.getElementById('new-password'),second=document.getElementById('repeat-password');
 if(!old.value){msg.textContent='请输入当前密码。';return}
 if(first.value.length<8){msg.textContent='新密码至少需要 8 位。';return}
 if(first.value!==second.value){msg.textContent='两次输入的新密码不一致。';return}
 button.disabled=true;msg.textContent='正在修改…';
 try{
  await api('/auth/v1/user',{method:'PUT',body:{password:first.value,current_password:old.value}});
  old.value='';first.value='';second.value='';msg.textContent='密码已修改。其他设备下次登录请使用新密码。';
 }catch(err){msg.textContent=/reauthentication|nonce/i.test(err.message)?'请先同步完成，再退出并重新登录后修改密码。':authErrorMessage(err)}
 finally{button.disabled=false}
}
async function authenticate(signup){
 const msg=document.getElementById('auth-message'),email=document.getElementById('email').value.trim(),password=document.getElementById('password').value;
 if(!email.includes('@')||password.length<8){msg.textContent='请输入有效邮箱和至少 8 位密码';return}
 msg.textContent='正在连接…';
 try{const r=await api(signup?'/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+location.pathname):'/auth/v1/token?grant_type=password',{method:'POST',auth:false,body:{email,password}});
  if(!r.access_token){msg.textContent='注册已提交，请打开邮箱确认邮件后返回登录。';return}
  storeSession(r);document.getElementById('password').value='';document.getElementById('account').classList.add('hide');await loadAccount();
 }catch(err){msg.textContent=authErrorMessage(err)}
}
function authErrorMessage(err){
 const message=err.message||'';
 if(/invalid login credentials|invalid_credentials/i.test(message))return '邮箱或密码不匹配。已确认邮箱后请点“登录”，并输入注册时的密码。';
 if(/email not confirmed/i.test(message))return '邮箱尚未确认，请先打开注册确认邮件中的链接，再返回登录。';
 if(/already registered/i.test(message))return '此邮箱已注册，请点击“登录”。';
 if(/rate limit|too many requests|security purposes/i.test(message))return '操作过于频繁，请稍后再试，避免连续点击注册。';
 if(/expired|invalid.*token|otp_expired/i.test(message))return '确认链接已失效或已使用。若之前已经确认，请直接登录。';
 return message;
}
async function confirmEmail(){try{const raw=document.getElementById('confirm-link').value.trim();let url;try{url=new URL(raw)}catch{throw Error('这里需要确认邮件中的完整 https:// 链接，不能填写邮箱地址。邮箱已确认的话，请直接点击上方“登录”。')}const token=url.searchParams.get('token'),type=url.searchParams.get('type');if(!['signup','email'].includes(type)||!token||url.origin!==SB_URL||url.pathname!=='/auth/v1/verify')throw Error('请粘贴本项目发送的完整邮箱确认链接');const r=await api('/auth/v1/verify',{method:'POST',auth:false,body:{token_hash:token,type}});storeSession(r);document.getElementById('account').classList.add('hide');await loadAccount()}catch(err){document.getElementById('auth-message').textContent=authErrorMessage(err)}}
async function signOut(){if(dirty||syncBusy||conflict)return alert('还有尚未同步的数据，请先完成同步并导出备份。');try{await api('/auth/v1/logout',{method:'POST'})}catch{}storeSession(null);if(releaseAccount){releaseAccount();releaseAccount=null}ownsAccount=true;cacheKey=null;cloudReady=false;db=clone(legacyData);lastSaved=clone(db);current=null;basket={};basketPrices={};editId=null;draftName='';migrationPending=false;document.getElementById('account').classList.add('hide');status('本机保存 · 已退出登录');render()}
async function bootCloud(){
 try{
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.get('access_token')){
   const access=fragment.get('access_token'),user=await api('/auth/v1/user',{auth:false,headers:{Authorization:'Bearer '+access}});
   storeSession({access_token:access,refresh_token:fragment.get('refresh_token'),expires_in:Number(fragment.get('expires_in')),user});history.replaceState(null,'',location.pathname+location.search);
  }else{const saved=localStorage.getItem('popup-auth-v1');if(saved)storeSession(JSON.parse(saved))}
  validate(db);
  if(session)await loadAccount();else{ensureSharedCatalogs();render();status('本机保存 · 登录后同步')}
 }catch(err){status('云端连接失败 · '+err.message);render()}
}
window.addEventListener('online',()=>void syncNow());
window.addEventListener('focus',()=>void syncNow());
window.addEventListener('beforeunload',event=>{if(dirty||syncBusy){event.preventDefault();event.returnValue='尚有待同步数据'}});
// Avoid two tabs of this browser racing over one outbox. Other devices use revision checks.
async function lockedSync(){if(navigator.locks)return navigator.locks.request('popup-cloud-sync',{ifAvailable:true},lock=>lock?syncNow():undefined);return syncNow()}
setInterval(()=>{if(!document.hidden)void lockedSync()},5000);
void bootCloud();
