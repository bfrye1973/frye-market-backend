// Engine 27 V3 Micro: immutable Polygon daily zone geometry + direct live ticks.
// Observation only: a touch/crossing is NOT a confirmed break, rejection or reversal.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const stamp=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const ids={QQQ:["QQQ","engine27.qqqKeyLevels.v1"],VIX:["I:VIX","engine27.vixKeyLevels.v1"]};
const relation=(p,z)=>p<z.low?"BELOW":p>z.high?"ABOVE":"INSIDE";
const round=x=>Number(x.toFixed(4));
export function validateLiveZonePublication(levels,key,nowMs=Date.now()){
 const [symbol,schema]=ids[key]??[];
 const src=levels?.schema==="engine27.crossMarketSource.v1"?levels?.instruments?.[key]:null;
 if(!symbol||src?.available!==true||src?.schema!==schema||src.symbol!==symbol||
    !Array.isArray(src.levels)||!src.levels.length||!stamp(src.lastCandleTime)||
    Date.parse(src.lastCandleTime)>nowMs||nowMs-Date.parse(src.lastCandleTime)>4*86400000)
  return {ok:false,reason:"VERIFIED_DAILY_ZONE_SOURCE_UNAVAILABLE"};
 const zones=src.levels.slice(0,12).map((z,i)=>{
  if(!finite(z.low)||!finite(z.high)||z.low<=0||z.high<=z.low||
    !["SUPPORT_CANDIDATE","RESISTANCE_CANDIDATE"].includes(z.type)||
    z.qualification!=="DAILY_OHLC_CLUSTER"||!Number.isInteger(z.observationCount)||z.observationCount<2)
   return null;
  return {id:key+":"+z.type+":"+z.low+":"+z.high,low:z.low,high:z.high,
   center:finite(z.center)?z.center:round((z.low+z.high)/2),
   type:z.type,observationCount:z.observationCount,distinctReactions:z.distinctReactions??null};
 });
 if(zones.some(x=>!x))return {ok:false,reason:"DAILY_ZONE_GEOMETRY_INVALID"};
 return {ok:true,key,sourceTimestamp:src.lastCandleTime,zones};
}
export function observeLiveCrossMarketZones({publication,key,tick,previous=null,nowMs=Date.now()}={}){
 const source=validateLiveZonePublication(publication,key,nowMs);
 const unavailable=(reason)=>({schema:"engine27.v3.liveCrossMarketZones.v1",symbol:key,
  available:false,state:"UNAVAILABLE",reasonCodes:[reason],near:null,atZone:[],observedEvents:[],
  noExecution:true,noTradeConfirmation:true,previous:null});
 if(!source.ok)return unavailable(source.reason);
 if(tick?.symbol!==key||!finite(tick.price)||tick.price<=0||!stamp(tick.sourceTime)||
   tick.sourceMs!==Date.parse(tick.sourceTime)||tick.sourceMs>nowMs||
   nowMs-tick.sourceMs>15000||tick.sourceLatencyQualified!==true)
  return unavailable("DIRECT_LIVE_PRICE_NOT_QUALIFIED");
 const previousValid=previous?.symbol===key&&previous.sourceTimeMs<tick.sourceMs&&
   tick.sourceMs-previous.sourceTimeMs<=15000&&previous.zoneSignature===source.zones.map(z=>z.id).join("|");
 const ranked=source.zones.map(z=>{
  const side=relation(tick.price,z);
  const distance=side==="BELOW"?z.low-tick.price:side==="ABOVE"?tick.price-z.high:0;
  // Only a display proximity threshold: never source confirmation/entry authority.
  const approachWindow=Math.max(z.high-z.low,z.center*0.001);
  return {...z,side,distance:round(distance),
   proximity:side==="INSIDE"?"TOUCH_OBSERVED":distance<=approachWindow?"APPROACHING":"AWAY"};
 }).sort((a,b)=>a.distance-b.distance||b.observationCount-a.observationCount);
 const events=[];
 if(previousValid)for(const z of ranked){
  const old=previous.zones?.[z.id];
  if(!old)continue;
  if(old==="INSIDE"&&z.side!=="INSIDE")events.push({zoneId:z.id,type:"EXITED_ZONE",side:z.side});
  if(old!=="INSIDE"&&z.side==="INSIDE")events.push({zoneId:z.id,type:"TOUCH_OBSERVED",from:old});
  if((old==="ABOVE"&&z.side==="BELOW")||(old==="BELOW"&&z.side==="ABOVE"))
   events.push({zoneId:z.id,type:"CROSSED_RANGE_BETWEEN_TICKS",from:old,to:z.side});
 }
 const near=ranked[0]??null;
 const state=near?.proximity??"UNAVAILABLE";
 return {schema:"engine27.v3.liveCrossMarketZones.v1",symbol:key,available:true,state,
  source:"POLYGON_DIRECT_EVENT_VS_DAILY_ZONES",price:tick.price,sourceTime:tick.sourceTime,
  zoneSourceTime:source.sourceTimestamp,totalZones:source.zones.length,
  near:near?{id:near.id,type:near.type,low:near.low,high:near.high,center:near.center,
    side:near.side,distance:near.distance,proximity:near.proximity,observationCount:near.observationCount}:null,
  atZone:ranked.filter(z=>z.side==="INSIDE").map(z=>z.id),
  observedEvents:events.slice(0,12),reasonCodes:[],
  noExecution:true,noTradeConfirmation:true,
  previous:{symbol:key,sourceTimeMs:tick.sourceMs,zoneSignature:source.zones.map(z=>z.id).join("|"),
   zones:Object.fromEntries(ranked.map(z=>[z.id,z.side]))}};
}
export function projectLiveCrossMarketZonesForDisplay(result){
 if(!result?.available)return {available:false,state:"UNAVAILABLE",reasonCodes:result?.reasonCodes??["SOURCE_UNAVAILABLE"],
  nearest:null,events:[],noExecution:true};
 return {available:true,state:result.state,zoneCount:result.totalZones,
  price:result.price,sourceTime:result.sourceTime,zoneSourceTime:result.zoneSourceTime,
  nearest:result.near,events:result.observedEvents,noExecution:true};
}
