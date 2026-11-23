'use strict';
function bonusForOrder(e,o){
 if(cloudKind(e)!=='nmixx')return null;
 let krw=0,missing=0,estimated=false;
 for(const l of o.lines){
  const p=e.products.find(p=>p.id===l.id),cost=Finance.prices(p,l).cost;
  if(cost===null)missing+=l.q;else krw+=cost*l.q;
  if(!Object.hasOwn(l,'unitCostKrw'))estimated=true;
 }
 return {krw,count:Math.floor(krw/50000),missing,estimated};
}
function orderBonusSummary(e,orders){
 if(cloudKind(e)!=='nmixx')return '';
 const total=orders.reduce((sum,o)=>{
  const b=bonusForOrder(e,o);
  sum.krw+=b.krw;sum.missing+=b.missing;sum.estimated=sum.estimated||b.estimated;
  return sum;
 },{krw:0,count:0,missing:0,estimated:false});
 total.count=Math.floor(total.krw/50000);
 return '<div class="card"><h2>订单总额</h2><p><b>₩'+total.krw.toLocaleString('en-US')+'</b></p><p>满额卡合计：<b>'+total.count+' 张</b>'+(total.missing?'（待补全）':'')+'</p><p class="muted">按全部订单的韩元商品原价总额计算，每满 ₩50,000 赠 1 张（总额 ÷ 50,000，向下取整）。'+(total.missing?' '+total.missing+' 件缺少原价，金额与卡数待补全核算。':'')+(total.estimated?' 未锁定原价的旧订单按当前目录估算。':'')+'</p></div>';
}
function shortOrderNumber(o){const n=String(o.number);return /^P-[0-9A-F-]{36}$/i.test(n)?n.slice(0,10):n}
function checkOrderLine(orderId,productId,checked){
 const o=ev().orders.find(o=>o.id===orderId),l=o?.lines.find(l=>l.id===productId);if(!l)return;
 l.checkedQuantity=checked?l.q:0;if(save())render();
}
function checkBonus(orderId,checked){
 const e=ev(),o=e.orders.find(o=>o.id===orderId),b=o&&bonusForOrder(e,o);if(!b||!b.count)return;
 o.bonusCheckedFor=checked?b.count:0;if(save())render();
}
function orderCards(e,orders){
 return orderBonusSummary(e,orders)+'<h2>订单队列</h2><p class="muted">勾选表示本单商品已核对；实际已购数量仍在采购单记录。</p>'+orders.map((o,i)=>{
  const b=bonusForOrder(e,o);
  const list=o.lines.map(l=>{const p=e.products.find(p=>p.id===l.id),checked=l.checkedQuantity===l.q;
   return '<label class="order-task'+(checked?' task-checked':'')+'"><input type="checkbox" '+(checked?'checked':'')+' onchange="checkOrderLine(\''+o.id+'\',\''+l.id+'\',this.checked)"><span>'+esc(productName(p))+' <b>× '+l.q+'</b></span></label>';
  }).join('');
  const bonus=b?(b.count?'<label class="order-task bonus-task'+(o.bonusCheckedFor===b.count?' task-checked':'')+'"><input type="checkbox" '+(o.bonusCheckedFor===b.count?'checked':'')+' onchange="checkBonus(\''+o.id+'\',this.checked)"><span>满额随机卡 <b>× '+b.count+'</b></span></label>':'')+'<p class="muted">韩元商品原价合计 ₩'+b.krw.toLocaleString('en-US')+' · 每满 ₩50,000 赠 1 张'+(b.missing?' · '+b.missing+' 件缺少原价，卡数待补全核算':'')+(b.estimated?' · 未锁定原价的旧订单按当前目录估算':'')+'</p>':'';
  return '<div class="card"><div class="row"><b>第 '+(i+1)+' 单 · '+esc(o.name)+'</b><span class="pill">#'+esc(shortOrderNumber(o))+'</span></div><div class="order-tasks">'+list+bonus+'</div><div class="muted">'+allocation(e,o)+(o.createdAt?' · '+esc(new Date(o.createdAt).toLocaleString()):' · 旧版未记录创建时间')+'</div><details><summary class="muted">完整订单编号</summary><p class="muted">'+esc(o.number)+'</p></details><div class="row" style="margin-top:12px"><button '+(i===0?'disabled':'')+' onclick="moveOrder(\''+o.id+'\',-1)">↑</button><button '+(i===orders.length-1?'disabled':'')+' onclick="moveOrder(\''+o.id+'\',1)">↓</button><button onclick="editOrder(\''+o.id+'\')">修正</button></div></div>';
 }).join('');
}
