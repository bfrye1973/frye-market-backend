import {buildEngine27QualifiedReactionsV1} from "./buildEngine27QualifiedReactionsV1.js";
export async function buildEngine27LiveCrossMarketReactionsV1({levels,apiKey,now=new Date(),fetchAggregates}={}){
 const results={};
 for(const [key,symbol] of [["QQQ","QQQ"],["VIX","I:VIX"]]){
  const source=levels?.instruments?.[key];
  if(source?.available!==true||!Array.isArray(source.levels)||!source.levels.length){
   results[key]={state:"UNAVAILABLE",events:[],reasonCodes:["VERIFIED_LEVEL_SOURCE_UNAVAILABLE"]};continue;
  }
  const zones=source.levels.filter(z=>Number.isFinite(z.low)&&Number.isFinite(z.high)&&z.high>z.low)
   .map(z=>({...z,id:key+":"+z.type+":"+z.low+":"+z.high}));
  if(!zones.length){results[key]={state:"UNAVAILABLE",events:[],reasonCodes:["NO_VALID_PRICE_ZONES"]};continue;}
  results[key]=await buildEngine27QualifiedReactionsV1({symbol,zones,timeframe:"1h",apiKey,now,
   ...(fetchAggregates?{fetchAggregates}:{})});
 }
 return {schema:"engine27.liveCrossMarketReactions.v1",mode:"READ_ONLY",instruments:results,
  noPermissionCreated:true,noExecution:true,noJournalWrite:true};
}
