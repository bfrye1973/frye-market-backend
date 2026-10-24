// Read-only QQQ key-level discovery. No network requests or price inventions.
// Caller must provide source-qualified, completed, chronological QQQ OHLC candles.
// No Elliott counts or Engine 6 authority.
const finite=v=>typeof v==="number"&&Number.isFinite(v);
const rounded=v=>Math.round(v*100)/100;
export function buildQqqKeyLevelsV1({candles=[],asOf=null,source=null,symbol="QQQ",timeframe="1d"}={}){
 const base={schema:"engine27.qqqKeyLevels.v1",mode:"READ_ONLY",symbol:"QQQ",timeframe,
  source:source||null,asOf:asOf||null,available:false,levels:[],reasonCodes:[],
  noPermissionCreated:true,noExecution:true};
 if(symbol!=="QQQ"||timeframe!=="1d")return {...base,reasonCodes:["SYMBOL_OR_TIMEFRAME_NOT_APPROVED"]};
 if(!source||!asOf)return {...base,reasonCodes:["SOURCE_OR_ASOF_MISSING"]};
 const bars=Array.isArray(candles)?candles.filter(b=>b?.completed===true&&
  typeof b.time==="string"&&finite(Date.parse(b.time))&&
  finite(b.high)&&finite(b.low)&&finite(b.close)&&
  b.low>0&&b.low<=b.close+0.0001&&b.close<=b.high+0.0001):[];
 bars.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 const unique=bars.filter((b,i)=>i===0||b.time!==bars[i-1].time);
 if(unique.length<8)return {...base,reasonCodes:["INSUFFICIENT_QUALIFIED_HISTORY"]};
 if(Date.parse(unique[unique.length-1].time)>Date.parse(asOf))return {...base,reasonCodes:["FUTURE_CANDLE_PRESENT"]};
 const last=unique[unique.length-1];
 if(Date.parse(asOf)-Date.parse(last.time)>4*86400000)return {...base,reasonCodes:["STALE_DAILY_HISTORY"]};
 const ranges=unique.slice(-14).map(b=>b.high-b.low).sort((a,b)=>a-b);
 const median=ranges[Math.floor(ranges.length/2)]||1;
 const tolerance=Math.max(1,Math.min(4,median*0.26));
 const pts=[];
 for(let i=0;i<unique.length;i++){
  const b=unique[i];
  // Daily high/low from completed candles; no future-dependent pivot selection.
  // Older/multiple consecutive bars within one price cluster count as one local test.
  pts.push({price:b.low,time:b.time,kind:"LOW",index:i});
  pts.push({price:b.high,time:b.time,kind:"HIGH",index:i});
 }
 const groups=[];
 for(const p of pts.sort((a,b)=>a.price-b.price)){
  let g=groups.find(g=>Math.abs(p.price-g.center)<=tolerance&&g.kind===p.kind);
  if(!g){g={kind:p.kind,center:p.price,pts:[]};groups.push(g);}
  g.pts.push(p);g.center=g.pts.reduce((a,x)=>a+x.price,0)/g.pts.length;
 }
 const levels=groups.map(g=>{
  const touches=g.pts.slice().sort((a,b)=>a.index-b.index).filter((p,i,all)=>i===0||p.index-all[i-1].index>1);
  const independentDates=[...new Set(g.pts.map(p=>p.time))];
  return {low:rounded(Math.min(...g.pts.map(p=>p.price))),high:rounded(Math.max(...g.pts.map(p=>p.price))),
   center:rounded(g.center),type:g.kind==="LOW"?"SUPPORT_CANDIDATE":"RESISTANCE_CANDIDATE",
   observationCount:independentDates.length,distinctReactions:touches.length,
   evidence:independentDates.map(time=>({time,price:rounded(g.pts.find(p=>p.time===time).price)})),
   currentSide:last.close>=g.center?"ABOVE":"BELOW",status:"WATCH",qualification:"DAILY_OHLC_CLUSTER",verifiedBreak:false};
 }).filter(g=>g.observationCount>=2).sort((a,b)=>b.observationCount-a.observationCount||Math.abs(last.close-a.center)-Math.abs(last.close-b.center)).slice(0,12);
 return {...base,available:true,close:last.close,lastCandleTime:last.time,clusteringTolerance:rounded(tolerance),
  levels,reasonCodes:levels.length?[]:["NO_REPEATED_LEVEL_CLUSTERS"]};
}
