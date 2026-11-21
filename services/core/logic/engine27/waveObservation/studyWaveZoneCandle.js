// Engine27 V6 — research-only completed-candle and Fibonacci response features.
// Never confirms Elliott completion, rewrites Engine22 touches, or grants trade permission.
const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const ts=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
export function studyWaveZoneCandle({bar=null,priorBar=null,direction=null,levels=[],asOf=null}={}){
 const time=ts(bar?.closedAt),clock=ts(asOf),o=num(bar?.open),h=num(bar?.high),
   l=num(bar?.low),c=num(bar?.close);
 if(time===null||clock===null||time>clock||bar?.completed!==true||
   [o,h,l,c].some(v=>v===null)||l>Math.min(o,c)||h<Math.max(o,c)||h<=l)
   return {available:false,reason:"QUALIFIED_COMPLETED_CANDLE_UNAVAILABLE"};
 const range=h-l,body=Math.abs(c-o),upperWick=h-Math.max(o,c),lowerWick=Math.min(o,c)-l;
 const pclose=num(priorBar?.close);
 const confirmed=Array.isArray(levels)?levels.filter(x=>num(x?.price)!==null&&x?.status==="TOUCHED"&&ts(x.touchedAt)!==null&&ts(x.touchedAt)<=clock):[];
 confirmed.sort((a,b)=>ts(b.touchedAt)-ts(a.touchedAt));
 const last=confirmed[0]??null;
 const ordered=Array.isArray(levels)?levels.filter(x=>num(x?.price)!==null).slice().sort((a,b)=>a.price-b.price):[];
 const ratio=x=>Number(x?.label??x?.ratio);
 const band=ordered.filter(x=>{const v=ratio(x);return Math.abs(v-.5)<.0005||Math.abs(v-.618)<.0005});
 const inBand=band.length===2&&Math.min(band[0].price,band[1].price)<=c&&c<=Math.max(band[0].price,band[1].price);
 const oppositeWick=direction==="UP"?upperWick:direction==="DOWN"?lowerWick:null;
 return {available:true,schema:"engine27.v6.waveZoneCandleStudy.v1",candleClosedAt:bar.closedAt,
  candle:{open:o,high:h,low:l,close:c,range,body,upperWick,lowerWick,
   upperWickFraction:upperWick/range,lowerWickFraction:lowerWick/range,
   closeLocation:(c-l)/range,priorClose:pclose},
  expectedWaveDirection:direction??null,oppositeWickFraction:oppositeWick===null?null:oppositeWick/range,
  lastPublishedFibTouch:last?{key:last.key??null,ratio:ratio(last)||null,price:last.price,touchedAt:last.touchedAt}:null,
  middleFibBand:band.length===2?{lower:Math.min(...band.map(x=>x.price)),
   upper:Math.max(...band.map(x=>x.price)),closeInside:inBand}:null,
  // "80%" and 0.5-0.618 are hypotheses, not measured population estimates.
  researchHypotheses:["OPPOSITE_WICK_AT_ZONE","LAST_FIB_TOUCH_BEFORE_REVERSAL",
   "COMPLETION_NEAR_FIB_0_500_TO_0_618"],
  completionConfirmed:false,percentOfCases:null,noWaveAuthority:true,noExecution:true};
}
