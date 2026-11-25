// Engine 27 QQQ / direct-VIX daily source adapter.
// Fetches only existing provider candles; never infers missing prices or a proxy.
// Isolated direct fetch: the legacy Engine25 helper references an undefined fetchJson.
async function fetchDirectDailyBars({symbol,apiKey,from,to,adjusted=false}){
 const params=new URLSearchParams({adjusted:String(adjusted),sort:"asc",limit:"5000",apiKey});
 const url="https://api.polygon.io/v2/aggs/ticker/"+encodeURIComponent(symbol)+"/range/1/day/"+from+"/"+to+"?"+params;
 let response;
 try{response=await fetch(url);}catch{throw new Error("PROVIDER_NETWORK_FAILURE");}
 if(!response.ok)throw new Error("PROVIDER_HTTP_"+response.status);
 let json;
 try{json=await response.json();}catch{throw new Error("PROVIDER_INVALID_JSON");}
 if(!Array.isArray(json?.results))throw new Error("PROVIDER_NO_OHLC_RESULTS");
 return {ok:true,symbol,bars:json.results.map(b=>({time:b.t,high:b.h,low:b.l,close:b.c}))};
}
import {buildQqqKeyLevelsV1} from "../logic/engine27/crossMarket/buildQqqKeyLevelsV1.js";
import {buildVixKeyLevelsV1} from "../logic/engine27/crossMarket/buildVixKeyLevelsV1.js";
const DAY=86400000;
const isoDay=ms=>new Date(ms).toISOString().slice(0,10);
const valid=bar=>Number.isFinite(bar?.time)&&Number.isFinite(bar?.high)&&Number.isFinite(bar?.low)&&Number.isFinite(bar?.close);
export async function buildEngine27CrossMarketSourceV1({apiKey,now=new Date(),fetchBars=fetchDirectDailyBars,lookbackDays=120}={}){
 const asOf=now instanceof Date?now.toISOString():null;
 const base={schema:"engine27.crossMarketSource.v1",asOf,mode:"READ_ONLY",noExecution:true,instruments:{}};
 if(!apiKey||!asOf||!Number.isFinite(now.getTime()))return {...base,reasonCodes:["API_KEY_OR_TIME_UNAVAILABLE"]};
 // End at prior UTC calendar date. Final qualification is still based on the source
 // candle's date and completed-day boundary; do not certify today's forming bar.
 const end=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
 const from=isoDay(end-lookbackDays*DAY),to=isoDay(end-DAY);
 for(const [key,symbol,build] of [
   ["QQQ","QQQ",buildQqqKeyLevelsV1],
   ["VIX","I:VIX",buildVixKeyLevelsV1],
 ]){
  try{
   const result=await fetchBars({symbol,apiKey,from,to,adjusted:false});
   if(result?.symbol!==symbol||result?.ok!==true)throw new Error("SYMBOL_OR_FEED_MISMATCH");
   const bars=(Array.isArray(result.bars)?result.bars:[])
     .filter(valid)
     .filter(b=>b.time>=end-lookbackDays*DAY&&b.time<end)
     .map(b=>({time:isoDay(b.time),high:b.high,low:b.low,close:b.close,completed:true}));
   const publication=build({symbol,source:"POLYGON_DAILY_DIRECT",asOf,candles:bars,timeframe:"1d"});
   base.instruments[key]={...publication,sourceSymbol:symbol,adjusted:false,
    sourceBars:bars.length,sourceEndDate:to};
  }catch(err){
   base.instruments[key]={available:false,symbol,reasonCodes:["SOURCE_FETCH_FAILED"],errorClass:/^PROVIDER_HTTP_[0-9]{3}$/.test(err?.message||"") ? err.message : /^PROVIDER_(NETWORK_FAILURE|INVALID_JSON|NO_OHLC_RESULTS)$/.test(err?.message||"") ? err.message : "SOURCE_UNAVAILABLE"};
  }
 }
 return {...base,reasonCodes:[]};
}
