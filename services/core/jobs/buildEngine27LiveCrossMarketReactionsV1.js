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
 const read=(key)=>{
  const data=results[key];
  if(data?.state==="UNAVAILABLE")return "UNAVAILABLE";
  const event=data?.events?.at(-1)?.event;
  if(!event)return "UNCONFIRMED";
  const bullish=event==="RECLAIM_CONFIRMED"||event==="DEFENSE_CANDIDATE";
  const bearish=event==="BREAKDOWN_CONFIRMED"||event==="REJECTION_CANDIDATE";
  if(!bullish&&!bearish)return "UNCONFIRMED";
  const esSupport=key==="QQQ"?bullish:bearish;
  return esSupport?"SUPPORTIVE":"ADVERSE";
 };
 const qqqSignal=read("QQQ"),vixSignal=read("VIX");
 const signal=qqqSignal==="UNAVAILABLE"||vixSignal==="UNAVAILABLE"?"UNAVAILABLE":
  qqqSignal==="UNCONFIRMED"&&vixSignal==="UNCONFIRMED"?"UNCONFIRMED":
  qqqSignal==="SUPPORTIVE"&&vixSignal==="SUPPORTIVE"?"SUPPORTIVE":
  qqqSignal==="ADVERSE"&&vixSignal==="ADVERSE"?"ADVERSE":"MIXED";
 return {schema:"engine27.liveCrossMarketReactions.v1",mode:"READ_ONLY",
   interpretation:{state:signal,qqq:qqqSignal,vix:vixSignal,
     note:"Completed hourly zone reactions are contextual evidence, not a confirmed ES reversal or trade permission."},
   instruments:results,
  noPermissionCreated:true,noExecution:true,noJournalWrite:true};
}
