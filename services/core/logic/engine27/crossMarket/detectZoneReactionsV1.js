// Evidence-only zone event classifier. No signal is inferred from a level alone.
// Accepts completed, chronological candles supplied by the owning source.
const isNum=x=>typeof x==="number"&&Number.isFinite(x);
export function detectEngine27ZoneReactionsV1({symbol,zones=[],candles=[],source=null}={}){
 const base={schema:"engine27.zoneReactions.v1",symbol,source:source??null,mode:"READ_ONLY",
 state:"UNAVAILABLE",events:[],reasonCodes:[],noPermissionCreated:true,noExecution:true};
 if(!source||!["ES","QQQ","I:VIX"].includes(symbol))return {...base,reasonCodes:["SOURCE_OR_SYMBOL_UNAVAILABLE"]};
 if(!Array.isArray(candles)||candles.length<3)return {...base,reasonCodes:["COMPLETED_CANDLES_REQUIRED"]};
 if(candles.some((b,i)=>b?.completed!==true||!isNum(b?.open)||!isNum(b?.high)||!isNum(b?.low)||!isNum(b?.close)||!b?.time||
 b.low>b.high||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high||
 (i>0&&Date.parse(b.time)<=Date.parse(candles[i-1].time))))return {...base,reasonCodes:["INVALID_OR_UNORDERED_CANDLES"]};
 const [prior,last]=candles.slice(-2), events=[];
 for(const z of zones){
  const lo=z?.lower??z?.low,hi=z?.upper??z?.high;
  if(!isNum(lo)||!isNum(hi)||hi<=lo)continue;
  const id=z.id??String(lo)+"-"+String(hi);
  let event=null;
  if(prior.close<lo&&last.low<=hi&&last.close>hi)event="RECLAIM_CONFIRMED";
  else if(prior.close>hi&&last.high>=lo&&last.close<lo)event="BREAKDOWN_CONFIRMED";
  else if(last.low<=hi&&last.low>=lo&&last.close>hi&&prior.close>=lo)event="DEFENSE_CANDIDATE";
  else if(last.high>=lo&&last.high<=hi&&last.close<lo&&prior.close<=hi)event="REJECTION_CANDIDATE";
  if(event)events.push({id,lower:lo,upper:hi,event,time:last.time,
   confirmation:event.endsWith("_CONFIRMED")?"TWO_CLOSE_TRANSITION":"SINGLE_CANDLE_REACTION",
   source});
 }
 return {...base,state:events.length?"EVENTS_OBSERVED":"NO_QUALIFIED_EVENT",events,
  lastCandleTime:candles[candles.length-1].time,reasonCodes:events.length?[]:["NO_LEVEL_REACTION"]};
}
