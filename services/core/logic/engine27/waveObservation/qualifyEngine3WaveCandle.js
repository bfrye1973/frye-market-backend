// Engine27 V6: qualify existing Engine3 bar input without polling market providers.
// The source must explicitly supply a verified physical contract and price basis.
import {deriveCandleCompletionTruth} from "../../engine3/candleCompletionTruth.js";
import {studyWaveZoneCandle} from "./studyWaveZoneCandle.js";
const valid=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const contract=x=>typeof x==="string"&&/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(x);
export function qualifyEngine3WaveCandle({bars=[],timeframe="10m",asOf=null,
 physicalContract=null,sourceIdentity=null,direction=null,levels=[]}={}){
 if(!["1m","5m","10m"].includes(timeframe)||!valid(asOf)||!contract(physicalContract)||
  !sourceIdentity?.providerTicker||!sourceIdentity?.priceBasis)
  return {available:false,reason:"CANDLE_SOURCE_PROVENANCE_UNVERIFIED",noExecution:true};
 const truth=deriveCandleCompletionTruth({bars,timeframe,evaluationTimeMs:Date.parse(asOf)});
 const completed=truth.completedBars;
 if(!completed.length)return {available:false,reason:"NO_QUALIFIED_COMPLETED_BARS",noExecution:true};
 const last=completed[completed.length-1], t=Number(last.time??last.t??last.tSec);
 const o=Number(last.open??last.o),h=Number(last.high??last.h),l=Number(last.low??last.l),c=Number(last.close??last.c);
 if(!Number.isFinite(t)||[o,h,l,c].some(v=>!Number.isFinite(v)))
  return {available:false,reason:"COMPLETED_BAR_GEOMETRY_UNAVAILABLE",noExecution:true};
 const closedAt=new Date(t*1000+truth.timeframeDurationMs).toISOString();
 const prior=completed.length>1?completed[completed.length-2]:null;
 const study=studyWaveZoneCandle({bar:{open:o,high:h,low:l,close:c,closedAt,completed:true},
  priorBar:prior?{close:Number(prior.close??prior.c)}:null,levels,direction,asOf});
 if(!study.available)return {available:false,reason:study.reason,noExecution:true};
 return {available:true,schema:"engine27.v6.qualifiedWaveCandle.v1",
  sourceIdentity:{providerTicker:sourceIdentity.providerTicker,priceBasis:sourceIdentity.priceBasis,
   physicalContract,timeframe},
  study,noWaveAuthority:true,noExecution:true};
}
