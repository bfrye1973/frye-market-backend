// Canonical, strictly completed Polygon OHLC adapter for the existing Engine27 reaction classifier.
// No order, permission, Engine22, or Engine10 mutations. No UVXY proxy for direct VIX.
import {fetchPolygonAggregatesPaginated} from "../../providers/polygonAggsProvider.js";
import {detectEngine27ZoneReactionsV1} from "../logic/engine27/crossMarket/detectZoneReactionsV1.js";
const PERIOD_MS={"10m":600000,"1h":3600000};
export async function buildEngine27QualifiedReactionsV1({
 symbol, zones=[], timeframe="10m", apiKey=null, now=new Date(),
 fetchAggregates=fetchPolygonAggregatesPaginated
}={}){
 const base={schema:"engine27.qualifiedReactions.v1",mode:"READ_ONLY",symbol,timeframe,
  state:"UNAVAILABLE",events:[],reasonCodes:[],noPermissionCreated:true,noExecution:true};
 if(!["QQQ","I:VIX"].includes(symbol)||!PERIOD_MS[timeframe])return {...base,reasonCodes:["SYMBOL_OR_TIMEFRAME_UNSUPPORTED"]};
 if(!apiKey||!Number.isFinite(now?.getTime?.()))return {...base,reasonCodes:["PROVIDER_NOT_CONFIGURED"]};
 const period=PERIOD_MS[timeframe],toMs=now.getTime();
 const from=new Date(toMs-3*86400000).toISOString().slice(0,10);
 const to=new Date(toMs).toISOString().slice(0,10);
 try{
  const result=await fetchAggregates({symbol,apiKey,from,to,adjusted:false,
   multiplier:timeframe==="10m"?10:1,timespan:timeframe==="10m"?"minute":"hour"});
  if(result?.ok!==true||result?.symbol!==symbol||!Array.isArray(result?.bars))return {...base,reasonCodes:["SOURCE_IDENTITY_OR_DATA_INVALID"]};
  const done=result.bars.filter(b=>Number.isFinite(b?.time)&&b.time+period<=toMs)
    .map(b=>({open:b.open,high:b.high,low:b.low,close:b.close,time:new Date(b.time).toISOString(),completed:true}));
  // Reject duplicate/out-of-order source bars rather than silently repair them.
  const output=detectEngine27ZoneReactionsV1({symbol,zones,candles:done.slice(-25),source:"POLYGON_DIRECT_"+timeframe});
  return {...base,...output,schema:"engine27.qualifiedReactions.v1",timeframe,
   sourceSymbol:symbol,completedBars:done.length,
   lastCompletedAt:done.length?done[done.length-1].time:null};
 }catch(e){return {...base,reasonCodes:["PROVIDER_FETCH_FAILED"],errorClass:"SOURCE_UNAVAILABLE"};}
}
