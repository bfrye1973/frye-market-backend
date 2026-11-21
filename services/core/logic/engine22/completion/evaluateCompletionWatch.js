// Engine 22F — observational completion lifecycle.
// Pure shadow evaluator. No count activation, invalidation authority or trading.
import { evaluateEngine22V3ReversalRule } from "../v3/evaluateReversalRule.js";
export const ENGINE22_F_SCHEMA="engine22.completionWatch.v1";
const STATES=new Set(["DEVELOPING","TARGET_REACHED_WATCH","REVERSAL_DETECTED","COMPLETION_CANDIDATE","REJECTED"]);
const safe = v=>v && typeof v==="object" && !Array.isArray(v);
const reject=(reason,extra={})=>({available:false,status:"UNAVAILABLE",reasonCodes:[reason],...extra,shadowOnly:true,publishAuthorized:false,noExecution:true,noPermissionCreated:true});
export function evaluateEngine22CompletionWatch({degreeState=null,targetObservation=null,candidate=null,bars=[],previous=null}={}) {
 if(!safe(degreeState) || typeof degreeState.countId!=="string" || !degreeState.countId ||
     typeof degreeState.degreeId!=="string" || !degreeState.degreeId)
  return reject("VERIFIED_COUNT_CONTEXT_REQUIRED");
 if(/^ES-V3-BASELINE-/i.test(degreeState.countId))
  return reject("SYNTHETIC_SHADOW_ID_NOT_CANONICAL");
 if(["LOCKED","INVALIDATED","RECOUNT_REQUIRED"].includes(degreeState.lifecycle))
  return reject("PROTECTED_OR_INVALIDATED_COUNT");
 if(!Array.isArray(bars)||!bars.length || bars.some((b,i)=>b?.closed!==true ||
     !b.sourceBarId || !Number.isFinite(Date.parse(b.sourceTimestamp)) ||
     (i>0 && Date.parse(b.sourceTimestamp)<=Date.parse(bars[i-1].sourceTimestamp))))
  return reject("VALID_COMPLETED_SOURCE_BARS_REQUIRED");
 const ids=new Set(bars.map(b=>b.sourceBarId));
 if(ids.size!==bars.length) return reject("DUPLICATE_SOURCE_BAR");
 const matchedPrevious=safe(previous) && previous.countId===degreeState.countId &&
    previous.degreeId===degreeState.degreeId && STATES.has(previous.status);
 const priorStatus=matchedPrevious?previous.status:"DEVELOPING";
 const hit=safe(targetObservation) && targetObservation.countId===degreeState.countId &&
     typeof targetObservation.levelKey==="string" && targetObservation.touched===true &&
     typeof targetObservation.sourceBarId==="string" && ids.has(targetObservation.sourceBarId);
 let status=hit?"TARGET_REACHED_WATCH":"DEVELOPING";
 const reasons=hit?["COUNT_SCOPED_TARGET_TOUCHED"]:["AWAITING_VERIFIED_TARGET_EVIDENCE"];
 let reversal=null;
 if(safe(candidate) && candidate.countId===degreeState.countId &&
     candidate.degreeId===degreeState.degreeId && candidate.sourceBarId &&
     ids.has(candidate.sourceBarId)){
   reversal=evaluateEngine22V3ReversalRule({candidate,bars,
     minimumReversalTicks:degreeState.minimumReversalTicks??8,
     tickSize:degreeState.tickSize??0.25});
   if(reversal.passed && (hit || ["TARGET_REACHED_WATCH","REVERSAL_DETECTED","COMPLETION_CANDIDATE"].includes(priorStatus))){
     status="REVERSAL_DETECTED";reasons.push("COMPLETED_BAR_REVERSAL_OBSERVED");
     if(candidate.evidenceConfirmedAt &&
       candidate.evidenceConfirmedAt===reversal.evidence?.confirmingTimestamp){
       status="COMPLETION_CANDIDATE";reasons.push("PIVOT_CANDIDATE_EVIDENCE_MATCHED");
     }
   }
 }
 // A later snapshot without the full historical lookback must not undo a prior watch.
 const rank={DEVELOPING:0,TARGET_REACHED_WATCH:1,REVERSAL_DETECTED:2,COMPLETION_CANDIDATE:3};
 if(matchedPrevious && priorStatus!=="REJECTED" && rank[priorStatus]>rank[status]){
   status=priorStatus;reasons.push("PRIOR_WATCH_PRESERVED_NO_FLIP_FLOP");
 }
 if(matchedPrevious && priorStatus==="REJECTED") return reject("REJECTED_REQUIRES_NEW_APPROVED_COUNT",{countId:degreeState.countId});
 return {
   schema:ENGINE22_F_SCHEMA,available:true,countId:degreeState.countId,
   degreeId:degreeState.degreeId,status,
   reasonCodes:reasons,sourceBarId:bars.at(-1).sourceBarId,
   sourceTimestamp:bars.at(-1).sourceTimestamp,
   reversalEvidence:reversal?.passed?reversal.evidence:null,
   targetEvidence:hit?{levelKey:targetObservation.levelKey,sourceBarId:targetObservation.sourceBarId}:null,
   waveCompletionConfirmed:false,countTransitionAuthorized:false,publishAuthorized:false,
   noExecution:true,noPermissionCreated:true,shadowOnly:true
 };
}
