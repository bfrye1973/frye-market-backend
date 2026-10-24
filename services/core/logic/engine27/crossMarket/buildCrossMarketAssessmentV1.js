// Engine27 read-only cross-market level assessment. Never changes Engine6 permission.
const valid=x=>x?.available===true&&Array.isArray(x.levels)&&Number.isFinite(x.close);
function assessMarket(read,market){
 if(!valid(read))return {state:"UNAVAILABLE",reasonCodes:read?.reasonCodes??["SOURCE_UNAVAILABLE"],evidence:[]};
 const near=read.levels.filter(z=>Number.isFinite(z.low)&&Number.isFinite(z.high))
  .map(z=>({...z,distance:read.close<z.low?z.low-read.close:read.close>z.high?read.close-z.high:0}))
  .sort((a,b)=>a.distance-b.distance).slice(0,3);
 // No directional inference from position near a candidate zone alone.
 return {state:"OBSERVATION_ONLY",lastClose:read.close,asOf:read.lastCandleTime,
  evidence:near.map(z=>({low:z.low,high:z.high,type:z.type,observationCount:z.observationCount,
    proximity:z.distance,zoneStatus:z.status})),reasonCodes:["NO_VERIFIED_BREAK_RECLAIM_OR_REJECTION"]};
}
export function buildEngine27CrossMarketAssessmentV1({publication=null}={}){
 const qqq=assessMarket(publication?.instruments?.QQQ,"QQQ");
 const vix=assessMarket(publication?.instruments?.VIX,"VIX");
 return {schema:"engine27.crossMarketAssessment.v1",mode:"READ_ONLY",
   qqq,vix,state:qqq.state==="UNAVAILABLE"||vix.state==="UNAVAILABLE"?"UNAVAILABLE":"MIXED",
   interpretation:"QQQ and VIX zones are observations only until qualified breaks, reclaims or rejections are independently verified.",
   noPermissionCreated:true,noExecution:true};
}
