// Engine22 replay research helper. No IO and no production wiring.
// Fixture-based ES scenario unless caller supplies independently verified bars.
// A replayed watch is observational; it never changes a canonical wave count.
import {buildEngine22IntegratedObservationShadow} from "./buildIntegratedObservationShadow.js";
import {validateEngine22EsReplayManifest} from "./validateReplaySourceManifest.js";

const timeframes=Object.freeze({"5m":300000,"10m":600000,"1h":3600000,"4h":14400000,"1d":86400000});
function eligibleBars(bars,timeframe){
 if(!Array.isArray(bars)||!timeframes[timeframe]||bars.length<5)return false;
 const step=timeframes[timeframe];
 const ids=new Set();
 for(let i=0;i<bars.length;i++){
   const b=bars[i],ms=Date.parse(b?.sourceTimestamp);
   if(b?.closed!==true||b?.timeframe!==timeframe||typeof b.sourceBarId!=="string"||
     !b.sourceBarId||ids.has(b.sourceBarId)||!Number.isFinite(ms)||
     (i && ms-Date.parse(bars[i-1].sourceTimestamp)!==step))return false;
   ids.add(b.sourceBarId);
 }
 return true;
}
export function replayEngine22CompletionShadow({
  bars=[],timeframe="5m",degree="MICRO",ownerCount=null,canonical=null,
  reviewRule=null,expectedSource=null,sourceManifest=null,
}={}){
 if(!eligibleBars(bars,timeframe))
   return {available:false,reasonCodes:["CONTIGUOUS_CLOSED_BAR_HISTORY_REQUIRED"],events:[],
     shadowOnly:true,noExecution:true};
 const sourceGate=sourceManifest===null?null:validateEngine22EsReplayManifest({manifest:sourceManifest,bars});
 if(sourceGate?.accepted===false)return {available:false,reasonCodes:sourceGate.reasonCodes,events:[],
   sourceGate,shadowOnly:true,noExecution:true};
 const chronological=[],events=[],seen=new Set();
 let previous=null;
 for(let i=5;i<=bars.length;i++){
   const page=bars.slice(0,i);
   // First run exposes qualified pivot observations only.
   const first=buildEngine22IntegratedObservationShadow({
     degree,ownerCount,bars:page,timeframe,canonical,reviewRule,expectedSource,previousCompletion:previous,
   });
   const selection=first.recognition?.pivotEvidence?.pivots?.filter(p=>p.side==="LOW").at(-1);
   const candidate=selection && ownerCount?.countId ? {
     countId:ownerCount.countId,degreeId:degree,side:selection.side,price:selection.price,
     sourceBarId:selection.sourceBarId,sourceTimestamp:selection.sourceTimestamp,
     evidenceConfirmedAt:selection.confirmationTimestamp,
   }:null;
   const next=candidate?buildEngine22IntegratedObservationShadow({
     degree,ownerCount,bars:page,timeframe,canonical,reviewRule,expectedSource,
     completionCandidate:candidate,previousCompletion:previous,
   }):first;
   const watch=next.completionWatch;
   if(!next.available || watch?.available!==true)
     return {available:false,reasonCodes:["SHADOW_EVIDENCE_NOT_AVAILABLE"],
       atBarId:page.at(-1)?.sourceBarId??null,events:[],shadowOnly:true,noExecution:true};
   const before=previous?.status??"DEVELOPING";
   // Emission only on a meaningful forward state change.
   if(watch.status!==before && watch.status!=="DEVELOPING"){
     const eventId=[ownerCount.countId,degree,watch.status,watch.targetEvidence?.sourceBarId??"-",
       watch.reversalEvidence?.confirmingBarId??"-"].join(":");
     if(!seen.has(eventId)){
       seen.add(eventId);
       events.push({eventId,countId:ownerCount.countId,degree,status:watch.status,
         observedAtBarId:page.at(-1).sourceBarId,
         sourceTimestamp:page.at(-1).sourceTimestamp,
         historicalClaim:false,fixtureReplayOnly:true,authorization:false});
     }
   }
   chronological.push({sourceBarId:page.at(-1).sourceBarId,status:watch.status,
     countId:ownerCount.countId,waveCompletionConfirmed:false});
   previous=watch;
 }
 return {available:true,schema:"engine22.completionReplayShadow.v1",degree,
   sourceDataClass:sourceGate?"LINEAGE_METADATA_CHECKED_UNAUTHENTICATED":"CALLER_SUPPLIED_REQUIRE_EXTERNAL_VERIFICATION",
   sourceGate:sourceGate??{accepted:false,reasonCodes:["NO_SOURCE_MANIFEST"],independentlyAuthenticated:false},
   events,chronological,finalStatus:previous?.status??"DEVELOPING",
   shadowOnly:true,noExecution:true,noPermissionCreated:true,
   publishAuthorized:false,countTransitionAuthorized:false};
}
