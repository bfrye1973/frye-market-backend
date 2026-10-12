// Engine22 V3 Phase 2: deterministic, read-only, wave-specific Fibonacci research.
// This does NOT replace projectDegreeFib.js or any official production Fib authority.
import {ENGINE22_V3_DEGREES,validateEngine22V3Canonical} from "./canonicalStructure.js";

const TF={INTRADAY_SUBMICRO:"5m",MICRO:"10m",SUBMINUTE:"1h",MINUTE:"4h",
 MINOR:"1d",INTERMEDIATE:"1w",PRIMARY:"1mo"};
const RATIOS={
 W1:[["p0618",.618],["p1000",1],["p1618",1.618]],
 W2:[["r236",.236],["r382",.382],["r500",.5],["r618",.618],["r786",.786]],
 W3:[["e1000",1],["e1272",1.272],["e1618",1.618],["e2000",2],["e2618",2.618]],
 W4:[["r236",.236],["r382",.382],["r500",.5],["r618",.618],["r786",.786]],
 W5:[["e618",.618],["e1000",1],["e1272",1.272],["e1618",1.618],["e2000",2]],
};
const valid=x=>typeof x==="number"&&Number.isFinite(x);
const missing=(reason,degree)=>({available:false,reasonCodes:[reason],degree,levels:[],
 shadowOnly:true,officialFibAuthorityChanged:false,noPermissionCreated:true,
 noExecution:true,publishAuthorized:false});
const anchor=(a)=>a&&valid(a.price)&&a.price>0&&typeof a.time==="string"&&
 Number.isFinite(Date.parse(a.time))&&["CONFIRMED","LOCKED"].includes(a.status);
const tick=(x,t)=>Number((Math.round(x/t)*t).toFixed(8));
const stamp=b=>Date.parse(b.sourceTimestamp);
function safeBars(bars,tf){
 if(!Array.isArray(bars)||bars.length<3)return "INSUFFICIENT_HISTORY";
 const ids=new Set(),first=bars[0]?.timeframe;
 let last=-Infinity;
 for(const b of bars){
  const ts=stamp(b);
  if(b?.closed!==true||b.timeframe!==tf||b.timeframe!==first||
     !b.sourceBarId||ids.has(b.sourceBarId)||!Number.isFinite(ts)||ts<=last||
     !valid(b.high)||!valid(b.low)||!valid(b.close)||b.high<b.low||
     b.close<b.low||b.close>b.high) return "INVALID_OR_UNCOMPLETED_SOURCE_HISTORY";
  ids.add(b.sourceBarId);last=ts;
 }
 return null;
}
// Each degree receives its own pinned evidence manifest. No cross-degree borrowing.
export function projectEngine22V3ActiveWaveFibShadow({
 canonical=null,degree=null,source=null,previous=null,tickSize=.25,
}={}){
 const validation=validateEngine22V3Canonical(canonical);
 if(!validation.ok)return missing("CANONICAL_INVALID",degree);
 if(!ENGINE22_V3_DEGREES.includes(degree))return missing("UNKNOWN_DEGREE",degree);
 if(!valid(tickSize)||tickSize<=0)return missing("INVALID_TICK_SIZE",degree);
 const s=canonical.degrees[degree],wave=s.activeWave,dir=s.sequenceDirection;
 if(!RATIOS[wave])return missing("ACTIVE_WAVE_REQUIRED",degree);
 if(!["UP","DOWN"].includes(dir))return missing("SEQUENCE_DIRECTION_REQUIRED",degree);
 if(["INVALIDATED","RECOUNT_REQUIRED"].includes(s.lifecycle))
  return missing("INVALIDATED_OR_RECOUNT_REQUIRED",degree);
 if(s.lifecycle==="LOCKED")return missing("LOCKED_WAVE_NO_NEW_PROJECTION",degree);
 if(!source||source.structuralEligible!==true||source.coverageComplete!==true||
    !source.seriesId||!source.datasetVersion||!source.priceBasis||
    source.sourceCountId!==s.countId||source.timeframe!==TF[degree])
  return missing("SOURCE_UNAVAILABLE",degree);
 const historyError=safeBars(source.bars,TF[degree]);
 if(historyError)return missing(historyError,degree);
 const a=s.anchors||{},pos=dir==="UP"?"LOW":"HIGH",end=dir==="UP"?"HIGH":"LOW";
 const start=a["W1_"+pos],w1End=a["W1_"+end],
   w2End=a["W2_"+pos],w3End=a["W3_"+end],w4End=a["W4_"+pos];
 let base,length,sign,keys=[],provisional=false;
 const needed=wave==="W1"?[start]:wave==="W2"?[start,w1End]:
   wave==="W3"?[start,w1End,w2End]:wave==="W4"?[w2End,w3End]:
   [start,w1End,w3End,w4End];
 if(!needed.every(anchor))return missing("VERIFIED_ANCHORS_REQUIRED",degree);
 const earliest=Math.min(...needed.map(x=>Date.parse(x.time)));
 const last=stamp(source.bars.at(-1));
 if(last<earliest)return missing("HISTORY_DOES_NOT_COVER_ANCHORS",degree);
 const impulseSign=dir==="UP"?1:-1;
 if(wave==="W1"){
  // W1 is an observed developing-range WATCH model, not an invented W1 endpoint.
  const eligible=source.bars.filter(b=>stamp(b)>=Date.parse(start.time));
  if(eligible.length<3)return missing("INSUFFICIENT_W1_DEVELOPING_RANGE",degree);
  const extreme=dir==="UP"?Math.max(...eligible.map(b=>b.high)):
    Math.min(...eligible.map(b=>b.low));
  base=start.price;length=(extreme-base)*impulseSign;sign=impulseSign;
  provisional=true;keys=["W1_"+pos,"COMPLETED_RANGE_EXTREME"];
 }else if(wave==="W2"){
  base=w1End.price;length=(w1End.price-start.price)*impulseSign;
  sign=-impulseSign;keys=["W1_"+pos,"W1_"+end];
 }else if(wave==="W3"){
  base=w2End.price;length=(w1End.price-start.price)*impulseSign;
  sign=impulseSign;keys=["W1_"+pos,"W1_"+end,"W2_"+pos];
 }else if(wave==="W4"){
  base=w3End.price;length=(w3End.price-w2End.price)*impulseSign;
  sign=-impulseSign;keys=["W2_"+pos,"W3_"+end];
 }else{
  base=w4End.price;length=(w1End.price-start.price)*impulseSign;
  sign=impulseSign;keys=["W1_"+pos,"W1_"+end,"W3_"+end,"W4_"+pos];
 }
 if(!valid(length)||length<=0)return missing("INCONSISTENT_IMPULSE_ANCHORS",degree);
 const waveOrigin=wave==="W1"?start:
  wave==="W2"?w1End:wave==="W3"?w2End:wave==="W4"?w3End:w4End;
 if(last<Date.parse(waveOrigin.time))return missing("NO_COMPLETED_WAVE_OBSERVATIONS",degree);
 const modelKey=[degree,s.countId,s.sequenceId,wave,dir,source.seriesId,
  source.datasetVersion,source.priceBasis,
  ...keys.map(key=>key==="COMPLETED_RANGE_EXTREME"?"DEVELOPING":
   [key,a[key]?.price,a[key]?.time].join(":")),base,length,tickSize].join("|");
 const compatible=previous?.available===true&&previous.modelKey===modelKey&&
   previous.sourceCountId===s.countId&&previous.degree===degree&&
   previous.seriesId===source.seriesId&&previous.datasetVersion===source.datasetVersion;
 const observations=source.bars.filter(b=>stamp(b)>=Date.parse(waveOrigin.time));
 const levels=RATIOS[wave].map(([key,ratio])=>{
  const price=tick(base+sign*ratio*length,tickSize);
  const observed=observations.find(b=>sign>0?b.high>=price:b.low<=price);
  const prior=compatible?previous.levels?.find(x=>x.key===key&&x.price===price):null;
  const touched=Boolean(observed)||prior?.status==="TOUCHED";
  const touchedAt=observed?.sourceTimestamp||prior?.firstTouchedAt||null;
  const touchedBarId=observed?.sourceBarId||prior?.firstTouchedBarId||null;
  return {key,ratio,price,status:touched?"TOUCHED":"WATCH",
   firstTouchedAt:touchedAt,firstTouchedBarId:touchedBarId};
 });
 return {available:true,reasonCodes:provisional?["W1_RANGE_PROVISIONAL"]:[],
  degree,activeWave:wave,sequenceDirection:dir,sourceCountId:s.countId,
  sequenceId:s.sequenceId,seriesId:source.seriesId,datasetVersion:source.datasetVersion,
  priceBasis:source.priceBasis,sourceTimeframe:source.timeframe,
  modelKey,modelType:wave==="W1"?"DEVELOPING_RANGE":
   (wave==="W2"||wave==="W4"?"RETRACEMENT":"EXTENSION"),
  anchorKeys:keys,projectionBase:base,projectionLength:length,
  provisional,levels,evidenceThrough:source.bars.at(-1).sourceTimestamp,
  waveCompletionConfirmed:false,shadowOnly:true,officialFibAuthorityChanged:false,
  noPermissionCreated:true,noExecution:true,publishAuthorized:false};
}
