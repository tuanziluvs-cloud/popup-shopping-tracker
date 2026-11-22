'use strict';
function orderCap(p){return Number.isSafeInteger(p.orderLimit)&&p.orderLimit>=0?p.orderLimit:null}
function otherOrdered(e,p,excluded=null){return e.orders.filter(o=>o.id!==excluded).reduce((n,o)=>n+o.lines.filter(l=>l.id===p.id).reduce((n,l)=>n+l.q,0),0)}
function availableForBasket(e,p){const cap=orderCap(p);return cap===null?Infinity:Math.max(0,cap-otherOrdered(e,p,editId)-(basket[p.id]||0))}
function quotaCaption(e,p){const cap=orderCap(p),used=otherOrdered(e,p);return '<div class="muted">已接单 '+used+' · 上限 '+(cap===null?'不限':cap)+' · '+(cap===null?'可继续接单':used>=cap?'已接满':'剩余 '+(cap-used))+'</div>'}
function quotaIssues(data){const issues=[];for(const e of data.events)for(const p of e.products){const cap=orderCap(p);if(cap!==null&&otherOrdered(e,p)>cap)issues.push((p.cn||p.id)+'：已接 '+otherOrdered(e,p)+' / 上限 '+cap)}return issues}
function setOrderLimits(ids){
 const e=ev(),targets=e.products.filter(p=>ids.includes(p.id));if(!targets.length)return;
 const same=targets.every(p=>orderCap(p)===orderCap(targets[0]))?orderCap(targets[0]):null;
 const raw=prompt('每款的整场可接单总数（不是每位顾客限购）。留空不限，0 表示暂停接单。',same===null?'':same);if(raw===null)return;
 const n=raw.trim()===''?null:Number(raw);
 if(n!==null&&(!Number.isSafeInteger(n)||n<0))return alert('请填非负整数，或留空不限。');
 const over=targets.filter(p=>n!==null&&otherOrdered(e,p)>n);
 if(over.length)return alert('上限不能低于已有接单数量：\n'+over.map(p=>productName(p)+' 已接 '+otherOrdered(e,p)).join('\n'));
 for(const p of targets)p.orderLimit=n;
 if(save())render();
}
function limitProduct(id){setOrderLimits([id])}
function limitSeries(encoded){const series=decodeURIComponent(encoded);setOrderLimits(ev().products.filter(p=>p.series===series).map(p=>p.id))}
