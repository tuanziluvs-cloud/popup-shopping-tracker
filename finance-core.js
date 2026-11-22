/* All monetary totals are estimated product-price differences, not net income. */
(function(root){
'use strict';
const known=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const money=v=>Math.round((v+Number.EPSILON)*100)/100;
function prices(product,line={}){
 const cost=Object.hasOwn(line,'unitCostKrw')?line.unitCostKrw:product?.price;
 const sale=Object.hasOwn(line,'unitSaleCny')?line.unitSaleCny:product?.salePriceCny;
 return {cost:known(cost)?cost:null,sale:known(sale)?sale:null};
}
function variantNumber(p){const raw=String(p.variant||'').match(/^(?:图示\s*)?(\d+)$/)||String(p.presetKey||'').match(/-图示\s*(\d+)$/);return raw?Number(raw[1]):Infinity}
function productName(p){if(!p)return '未知商品';const n=variantNumber(p);return /^miniteen-/.test(p.presetKey||'')&&n>=1&&n<=13?String(p.cn).replace(/图示\s*0*(\d+)/,(_,n)=>Number(n)+'号'):p.cn}
function totals(e){
 const rate=known(e.krwToCny)&&e.krwToCny>0?e.krwToCny:null;
 const all={quantity:0,priced:0,missing:0,sales:0,costKrw:0,cost:null,margin:null};const allocated={...all};let floating=0;
 const products=new Map(e.products.map(p=>[p.id,p]));const remaining=new Map(e.products.map(p=>[p.id,p.bought||0]));
 const orders=e.orders.slice().sort((a,b)=>a.rank-b.rank||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id));
 function add(target,q,pair){target.quantity+=q;if(pair.cost===null||pair.sale===null){target.missing+=q;return}target.priced+=q;target.sales+=Math.round(pair.sale*100)*q;target.costKrw+=pair.cost*q}
 for(const order of orders)for(const line of order.lines){const pair=prices(products.get(line.id),line);const filled=Math.min(line.q,remaining.get(line.id)||0);remaining.set(line.id,Math.max(0,(remaining.get(line.id)||0)-line.q));add(all,line.q,pair);add(allocated,filled,pair);if(!Object.hasOwn(line,'unitCostKrw')||!Object.hasOwn(line,'unitSaleCny'))floating+=line.q}
 for(const target of [all,allocated]){const salesCents=target.sales;target.sales=salesCents/100;if(rate!==null){const costCents=Math.round(target.costKrw*rate*100);target.cost=costCents/100;target.margin=(salesCents-costCents)/100}}
 const overbought=e.products.reduce((sum,p)=>sum+Math.max(0,(p.bought||0)-e.orders.reduce((n,o)=>n+o.lines.filter(l=>l.id===p.id).reduce((q,l)=>q+l.q,0),0)),0);
 return {rate,all,allocated,floating,overbought};
}
const api={known,money,prices,variantNumber,productName,totals};root.Finance=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
