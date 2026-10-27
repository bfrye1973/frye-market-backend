// Engine 22C v1 evidence adapter. Pure/read-only. Reuses V3 geometry.
import {projectEngine22V3DegreeFib} from "../v3/projectDegreeFib.js";
export const ENGINE22_C_SCHEMA="engine22.fibEvidenceShadow.v1";
export function buildEngine22FibEvidenceShadow({canonical=null,degree=null,bars=[],tickSize=0.25}={}){
 const projection=projectEngine22V3DegreeFib({canonical,degree,tickSize});
 if(!projection.available)return {available:false,reasonCodes:projection.reasonCodes,levels:[],shadowOnly:true,noExecution:true};
 const countId=projection.sourceCountId;
 if(/^ES-V3-BASELINE-/i.test(countId))return {available:false,reasonCodes:["SYNTHETIC_ID_NOT_HISTORICAL_AUTHORITY"],levels:[],shadowOnly:true,noExecution:true};
 if(!Array.isArray(bars)||bars.some((b,i)=>b?.closed!==true||typeof b.sourceBarId!=="string"||
  !Number.isFinite(Date.parse(b.sourceTimestamp))||!Number.isFinite(b.high)||!Number.isFinite(b.low)||
  b.high<b.low||(i>0&&Date.parse(b.sourceTimestamp)<=Date.parse(bars[i-1].sourceTimestamp))))
  return {available:false,reasonCodes:["INVALID_COMPLETED_BAR_EVIDENCE"],levels:[],shadowOnly:true,noExecution:true};
 const levels=projection.levels.map(l=>{
   const first=bars.find(b=>b.low<=l.price&&b.high>=l.price);
   return {...l,status:first?"TOUCHED":"WATCH",firstTouchedAt:first?.sourceTimestamp??null,
     evidenceBarId:first?.sourceBarId??null,evidenceClass:first?"COMPLETED_OHLC":"NOT_OBSERVED",
     waveCompletionConfirmed:false,structuralInvalidated:false};
 });
 return {available:true,schema:ENGINE22_C_SCHEMA,degree,countId,sourceCountId:countId,levels,
   shadowOnly:true,noExecution:true,noPermissionCreated:true,publishAuthorized:false};
}
