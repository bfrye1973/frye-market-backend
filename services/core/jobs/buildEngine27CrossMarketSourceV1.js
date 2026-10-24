// Engine 27 QQQ / direct-VIX daily source adapter.
// Fetches only existing provider candles; never infers missing prices or a proxy.
import {fetchPolygonDailyBars} from "../engine25DataSources.js";
import {buildQqqKeyLevelsV1} from "../logic/engine27/crossMarket/buildQqqKeyLevelsV1.js";
import {buildVixKeyLevelsV1} from "../logic/engine27/crossMarket/buildVixKeyLevelsV1.js";
const DAY=86400000;
const isoDay=ms=>new Date(ms).toISOString().slice(0,10);
const valid=bar=>Number.isFinite(bar?.time)&&Number.isFinite(bar?.high)&&Number.isFinite(bar?.low)&&Number.isFinite(bar?.close);
export async function buildEngine27CrossMarketSourceV1({apiKey,now=new Date(),fetchBars=fetchPolygonDailyBars,lookbackDays=120}={}){
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
   base.instruments[key]={available:false,symbol,reasonCodes:["SOURCE_FETCH_FAILED"],errorClass:"SOURCE_UNAVAILABLE"};
  }
 }
 return {...base,reasonCodes:[]};
}
