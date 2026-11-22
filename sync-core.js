/* Pure merge rules shared by the browser and regression tests. */
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x)),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function merge(base,local,remote,path='data',resolution=null){
 if(equal(local,base))return clone(remote);
 if(equal(remote,base))return clone(local);
 if(Array.isArray(local)&&Array.isArray(remote)){
  if([...local,...remote,...(base||[])].every(x=>x&&typeof x==='object'&&typeof x.id==='string')){
   const b=new Map((base||[]).map(x=>[x.id,x])),l=new Map(local.map(x=>[x.id,x])),r=new Map(remote.map(x=>[x.id,x]));
   return [...new Set([...r.keys(),...l.keys()])].map(id=>{
    if(!l.has(id))return clone(r.get(id)); // Never infer deletion from a stale snapshot.
    if(!r.has(id))return clone(l.get(id));
    return merge(b.get(id),l.get(id),r.get(id),path+'/'+id,resolution);
   });
  }
 }else if(local&&remote&&typeof local==='object'&&typeof remote==='object'){
  const out={};for(const key of new Set([...Object.keys(remote),...Object.keys(local)])){
   if(!(key in local)){out[key]=clone(remote[key]);continue}
   if(!(key in remote)){out[key]=clone(local[key]);continue}
   out[key]=merge(base?.[key],local[key],remote[key],path+'/'+key,resolution);
  }return out;
 }
 if(path.endsWith('/bought')&&[base,local,remote].every(Number.isFinite))return Math.max(0,remote+local-base);
 if(path==='data/next')return Math.max(local,remote);
 if(equal(local,remote))return clone(local);
 if(resolution)return clone(resolution==='local'?local:remote);
 throw Error('两台设备同时修改了同一项：'+path+'。请在同步提示中选择保留版本。');
}
function importLegacy(cloud,legacy){
 const result=clone(cloud),report={events:0,orders:0,products:0};
 for(const source of legacy.events){
  let target=result.events.find(e=>e.id===source.id||(source.presetKind&&e.presetKind===source.presetKind)||(e.name===source.name&&e.group===source.group));
  if(!target){target=clone(source);result.events.push(target);report.events++;report.orders+=target.orders.length;continue}
  if(target.id.startsWith('preset-')&&!target.orders.length&&target.products.every(p=>!(p.bought||0))){
   for(const [key,value] of Object.entries(source))if(!['id','products','orders'].includes(key))target[key]=clone(value);
  }
  const ids=new Map();for(const p of source.products){
   let existing=target.products.find(x=>x.id===p.id||(p.presetKey&&x.presetKey===p.presetKey)||(x.original===p.original&&x.series===p.series&&x.cn===p.cn));
   if(existing){ids.set(p.id,existing.id);if(!target.orders.length&&!(existing.bought||0))existing.bought=p.bought||0}
   else{const item=clone(p);if(/^miniteen-(2|3|4|5|8|9)$/.test(item.presetKey||'')&&!item.cn.includes('旧版'))item.cn+=' · 款式待确认（旧版）';target.products.push(item);ids.set(p.id,p.id);report.products++}
  }
  for(const order of source.orders){
   const o=clone(order);o.lines=o.lines.map(l=>({...l,id:ids.get(l.id)||l.id}));
   const existing=target.orders.find(x=>x.id===o.id);
   if(existing){
    // An earlier import may since have been edited in the cloud. Its immutable ID
    // remains the import receipt; never replay stale local contents over it.
    if(!equal(existing.number,o.number))throw Error('同一订单 ID 的编号不一致，已停止导入；原数据未更改。');
    continue;
   }
   target.orders.push(o);report.orders++;
  }
 }
 result.next=Math.max(result.next||1,legacy.next||1);
 return {data:result,report};
}
function validate(data){
 if(!data||!Array.isArray(data.events))throw Error('活动数据格式错误');
 const optionalPrice=(obj,key)=>obj[key]===undefined||obj[key]===null||(typeof obj[key]==='number'&&Number.isFinite(obj[key])&&obj[key]>=0);
 const safeId=id=>typeof id==='string'&&/^[\p{L}\p{N}_.: -]+$/u.test(id);
 const ids=new Set();for(const e of data.events){
  if(!safeId(e.id)||ids.has(e.id)||!Array.isArray(e.products)||!Array.isArray(e.orders))throw Error('活动或 ID 格式错误');ids.add(e.id);
  if(!optionalPrice(e,'krwToCny'))throw Error('汇率格式错误');
  const products=new Set();for(const p of e.products){if(!safeId(p.id)||products.has(p.id)||!Number.isInteger(p.bought||0)||(p.bought||0)<0)throw Error('商品或采购数量格式错误');if(!optionalPrice(p,'price')||!optionalPrice(p,'salePriceCny'))throw Error('商品价格格式错误');products.add(p.id)}
  const orders=new Set();for(const o of e.orders){if(!safeId(o.id)||orders.has(o.id)||o.number===undefined||!Number.isFinite(o.rank)||!o.name?.trim()||!Array.isArray(o.lines)||!o.lines.length)throw Error('订单格式错误');orders.add(o.id);for(const l of o.lines){if(!products.has(l.id)||!Number.isInteger(l.q)||l.q<1)throw Error('订单商品或数量格式错误');if(!optionalPrice(l,'unitCostKrw')||!optionalPrice(l,'unitSaleCny'))throw Error('订单价格格式错误')}}
 }return data;
}
const api={clone,equal,merge,importLegacy,validate};root.SyncCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
