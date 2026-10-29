// Engine27 V6 research-only Fibonacci contact sequence. Never mutates Engine22.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const millis=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const ratio=x=>{const v=Number(x?.ratio??x?.label);return Number.isFinite(v)?v:null};
export function studyFibReactionSequence({bars=[],levels=[],asOf,direction=null}={}){
 const clock=millis(asOf);
 if(clock===null||!Array.isArray(bars)||!Array.isArray(levels)||!["UP","DOWN"].includes(direction))
  return {available:false,reason:"FIB_RESEARCH_INPUT_UNAVAILABLE"};
 const ladder=levels.filter(x=>finite(x?.price)).map(x=>({key:x.key??null,ratio:ratio(x),price:x.price,
  officialStatus:x.status??null,officialTouchedAt:x.touchedAt??null})).sort((a,b)=>a.price-b.price);
 if(!ladder.length)return {available:false,reason:"ENGINE22_LEVELS_UNAVAILABLE"};
 const sorted=bars.slice().sort((a,b)=>millis(a.closedAt)-millis(b.closedAt));
 let previous=-Infinity,contacts=[],deepest=null;
 for(const bar of sorted){
  const t=millis(bar?.closedAt);
  if(t===null||t>clock||t<=previous||bar?.completed!==true||
    ![bar.open,bar.high,bar.low,bar.close].every(finite)||
    bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close))
   return {available:false,reason:"UNQUALIFIED_OR_REORDERED_CANDLE"};
  previous=t;
  const bodyLow=Math.min(bar.open,bar.close),bodyHigh=Math.max(bar.open,bar.close);
  for(const level of ladder){
   if(bar.low>level.price||bar.high<level.price)continue;
   const bodyContact=bodyLow<=level.price&&level.price<=bodyHigh;
   const wickOnly=!bodyContact;
   const crossedFromAbove=bar.open>level.price&&bar.low<=level.price;
   const crossedFromBelow=bar.open<level.price&&bar.high>=level.price;
   const reclaimedUp=bar.open>level.price&&bar.low<level.price&&bar.close>level.price;
   const reclaimedDown=bar.open<level.price&&bar.high>level.price&&bar.close<level.price;
   const event={closedAt:bar.closedAt,key:level.key,ratio:level.ratio,price:level.price,
     type:wickOnly?"WICK_CONTACT":"BODY_CONTACT",wickOnly,
     penetratedTicks:null,crossedFromAbove,crossedFromBelow,reclaimedUp,reclaimedDown,
     closeAbove:bar.close>level.price,closeBelow:bar.close<level.price,
     officialStatus:level.officialStatus,officialTouchedAt:level.officialTouchedAt};
   // Bar OHLC gives contact within a candle, not the intrabar order of touches.
   contacts.push(event);
   if(level.ratio!==null && (deepest===null || level.ratio>deepest.ratio))
     deepest={key:level.key,ratio:level.ratio,price:level.price,closedAt:bar.closedAt};
  }
 }
 const lastCandleTime=contacts.length?contacts[contacts.length-1].closedAt:null;
 const finalCandleTouches=lastCandleTime?contacts.filter(x=>x.closedAt===lastCandleTime):[];
 return {available:true,schema:"engine27.v6.fibReactionSequence.v1",direction,
  barsExamined:sorted.length,contacts,deepestRatioReached:deepest,
  lastContactCandleAt:lastCandleTime,lastContactCandidates:finalCandleTouches,
  exactLastIntrabarContact:null,intrabarOrderKnown:false,
  completionConfirmed:false,noWaveAuthority:true,noExecution:true};
}
