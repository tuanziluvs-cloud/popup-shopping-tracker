'use strict';
const yuan=n=>n===null?'待完善':'¥'+n.toFixed(2);
const productName=p=>Finance.productName(p);
function legacyUnspecified(p){return /^miniteen-(2|3|4|5|8|9)$/.test(p.presetKey||'')}
function visibleProducts(e){return e.products.filter(p=>!legacyUnspecified(p)||(p.bought||0)>0||qty(e,p)>0)}
function orderedProducts(e){const products=visibleProducts(e),groups=[...new Set(products.map(p=>p.series))],preset=PRESETS[cloudKind(e)];if(preset){const rank=series=>{const matches=products.filter(p=>p.series===series).map(p=>preset.rows.findIndex(r=>r[1]===p.original)).filter(n=>n>=0);return matches.length?Math.min(...matches):Infinity};groups.sort((a,b)=>rank(a)===rank(b)?0:rank(a)-rank(b))}return groups.flatMap(series=>products.filter(p=>p.series===series).sort((a,b)=>{const x=Finance.variantNumber(a),y=Finance.variantNumber(b);return x===y?0:x-y}))}
function upgradeMiniteen(e){
 if(cloudKind(e)!=='miniteen')return false;let changed=false;const keys=new Set(e.products.map(p=>p.presetKey));
 for(const p of presetProducts('miniteen'))if(!keys.has(p.presetKey)&&Number.isFinite(Finance.variantNumber(p))){e.products.push({...p,id:p.presetKey});keys.add(p.presetKey);changed=true}
 return changed;
}
function priceCaption(e,p){const pair=Finance.prices(p),rate=Finance.totals({...e,orders:[]}).rate;return '<div class="muted">原价 '+(pair.cost===null?'未填':'₩'+pair.cost.toLocaleString('en-US'))+' · 代购价 '+(pair.sale===null?'未填':yuan(pair.sale))+(pair.cost!==null&&pair.sale!==null&&rate!==null?' · 单件差价 '+yuan(Finance.money(pair.sale-pair.cost*rate)):'')+'</div>'}
function editPrices(ids,label){
 const e=ev(),targets=e.products.filter(p=>ids.includes(p.id));if(!targets.length)return;
 const same=key=>targets.every(p=>p[key]===targets[0][key])?targets[0][key]:'';
 const costRaw=prompt(label+'：商品原价（韩元整数；留空保留各款现值）',same('price')??'');if(costRaw===null)return;
 const saleRaw=prompt(label+'：代购单价（人民币；留空表示尚未定价）',same('salePriceCny')??'');if(saleRaw===null)return;
 const cost=costRaw.trim()===''?undefined:Number(costRaw),sale=saleRaw.trim()===''?null:Number(saleRaw);
 if(cost!==undefined&&(!Number.isInteger(cost)||cost<0)||sale!==null&&(!Finance.known(sale)||Math.abs(sale*100-Math.round(sale*100))>1e-6))return alert('原价请填非负韩元整数，代购价请填最多两位小数的非负人民币金额。');
 for(const p of targets){if(cost!==undefined)p.price=cost;p.salePriceCny=sale}if(save())render();
}
function priceProduct(id){editPrices([id],productName(ev().products.find(p=>p.id===id)))}
function priceSeries(encoded){const series=decodeURIComponent(encoded);editPrices(ev().products.filter(p=>p.series===series).map(p=>p.id),series+'（整系列）')}
let rateDrafts={};
function saveRate(){const raw=document.getElementById('rate-per-1000').value.trim(),n=raw===''?null:Number(raw);if(n!==null&&(!Number.isFinite(n)||n<=0||n>1000))return alert('请填写有效的人民币金额（大于 0，表示每 1,000 韩元的换汇成本）。');ev().krwToCny=n===null?null:n/1000;if(save()){delete rateDrafts[current];render()}}
function income(e){
 const t=Finance.totals(e);const summary=(title,s)=>'<div class="card"><h2>'+title+'</h2><div class="row"><span>代购金额 '+yuan(s.sales)+'</span><span>原价成本 '+yuan(s.cost)+'</span></div><p><b>商品差价 '+yuan(s.margin)+'</b></p><p class="muted">已纳入 '+s.priced+' / '+s.quantity+' 件'+(s.missing?' · '+s.missing+' 件缺少价格，尚未计入':'')+'</p></div>';
 return '<div class="card"><h2>汇率设置</h2><label for="rate-per-1000">每 1,000 韩元折合人民币</label><div class="row"><input id="rate-per-1000" type="number" inputmode="decimal" min="0" step="0.01" placeholder="实际换汇成本" oninput="rateDrafts[current]=this.value" value="'+esc(Object.hasOwn(rateDrafts,current)?rateDrafts[current]:t.rate===null?'':Number((t.rate*1000).toFixed(6)))+'"><button onclick="saveRate()">保存汇率</button></div><p class="muted">差价＝人民币代购价－韩元原价×汇率。请填写本次换汇成本。</p></div>'+(t.rate===null?'<div class="notice">请先设置汇率，才能计算人民币成本和差价。</div>':'')+summary('预计差价 · 全部订单',t.all)+summary('已购分配差价',t.allocated)+'<p class="muted">这里不扣材料费、邮费及其他费用，也不表示顾客已付款。缺少原价或代购价的件数不计入金额；超出订单需求的采购 '+t.overbought+' 件暂不计入已购分配差价。</p>'+(t.floating?'<p class="muted">'+t.floating+' 件订单尚未锁定完整单价，暂按当前商品价估算；重新保存该订单后会记录已填写的单价。</p>':'')+'<div class="card"><h2>商品定价</h2><p class="muted">同系列可一次设置全部款式；不同款的价格也可单独调整。已保存的明确订单单价保持不变。</p>'+[...new Set(orderedProducts(e).map(p=>p.series))].map(series=>{const items=orderedProducts(e).filter(p=>p.series===series),encoded=encodeURIComponent(series).replace(/'/g,'%27');return '<details class="item"><summary>'+esc(series)+' · '+items.length+' 款</summary><p><button onclick="priceSeries(\''+encoded+'\')">整系列定价</button></p>'+items.map(p=>'<div class="item row"><div><b>'+esc(productName(p))+'</b>'+priceCaption(e,p)+'</div><button onclick="priceProduct(\''+p.id+'\')">设置价格</button></div>').join('')+'</details>'}).join('')+'</div>';
}
let basketPrices={};
function basketSale(id){return Object.hasOwn(basketPrices,id)?basketPrices[id]:ev().products.find(p=>p.id===id)?.salePriceCny}
function setBasketSale(id,value){basketPrices[id]=value.trim()===''?null:Number(value)}
function draftLine(id,q){
 const p=ev().products.find(p=>p.id===id),old=editId?ev().orders.find(o=>o.id===editId)?.lines.find(l=>l.id===id):null;
 const line={id,q};const cost=old&&Object.hasOwn(old,'unitCostKrw')?old.unitCostKrw:p?.price,sale=basketSale(id);
 if(Finance.known(cost))line.unitCostKrw=cost;
 if(Finance.known(sale))line.unitSaleCny=sale;
 // Explicitly clearing a previously saved price must not silently fall back to the catalogue.
 if(Object.hasOwn(basketPrices,id)&&sale===null)line.unitSaleCny=null;
 return line;
}

function renameSeries(encoded){
 const e=ev(),previous=decodeURIComponent(encoded),next=prompt('新的品类名称（此品类全部款式一起修改）',previous);
 if(next===null||!next.trim()||next.trim()===previous)return;
 if(e.products.some(p=>p.series===next.trim()&&p.series!==previous))return alert('已有同名品类，请使用不同名称。');
 for(const p of e.products)if(p.series===previous)p.series=next.trim();
 if(save())render();
}
