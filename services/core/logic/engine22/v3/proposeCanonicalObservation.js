// Engine22 V3 — evidence-only canonical lifecycle reconciliation.
// Produces an immutable proposal and refuses to publish without a complete,
// unique structural evidence identity and monotonic observation.
import {validateEngine22V3Canonical,validateEngine22V3Transition} from "./canonicalStructure.js";
import {evaluateEngine22V3WaveTransition} from "./evaluateWaveTransition.js";
const clone=x=>structuredClone(x);
const valid=x=>typeof x==="string"&&x.trim().length>0;
export function proposeEngine22V3CanonicalObservation({
 canonical=null,degree=null,evidence=null,approvedRecountIds=[],
}={}){
 const check=validateEngine22V3Canonical(canonical);
 if(!check.ok)return {ok:false,reasonCodes:check.errors,proposedCanonical:null};
 const source=canonical.degrees?.[degree];
 if(!source)return {ok:false,reasonCodes:["DEGREE_NOT_PRESENT"],proposedCanonical:null};
 if(!evidence || !valid(evidence.sourceTimestamp)||!valid(evidence.sourceBarId)||
    !valid(evidence.sourceTimeframe)||evidence.completed!==true)
  return {ok:false,reasonCodes:["COMPLETE_UNIQUE_SOURCE_EVIDENCE_REQUIRED"],proposedCanonical:null};
 const COMPLETION_ANCHORS={W1:"W1_HIGH",W2:"W2_LOW",W3:"W3_HIGH",W4:"W4_LOW",W5:"W5_HIGH"};
 // The observer is only allowed to assess independently sourced market evidence.
 // Its structural rule must be bound to this exact degree/count/wave rather
 // than merely accepting an arbitrary confirmation boolean.
 if(evidence.completionConfirmed===true) {
   const proof=evidence.structuralProof;
   if(!proof || proof.countId!==source.countId ||
      proof.degreeId!==degree || proof.activeWave!==source.activeWave ||
      proof.sourceBarId!==evidence.sourceBarId ||
      proof.sourceTimestamp!==evidence.sourceTimestamp ||
      proof.ruleId!==evidence.structuralRuleId ||
      proof.validated!==true || proof.anchorKey!==COMPLETION_ANCHORS[source.activeWave] ||
      !proof.anchor || !Number.isFinite(proof.anchor.price) || proof.anchor.price<=0 ||
      Math.abs(proof.anchor.price/0.25-Math.round(proof.anchor.price/0.25))>1e-8 ||
      !valid(proof.anchor.time) || !Number.isFinite(Date.parse(proof.anchor.time)) ||
      Date.parse(proof.anchor.time)>Date.parse(evidence.sourceTimestamp))
     return {ok:false,reasonCodes:["UNBOUND_COMPLETION_PROOF"],proposedCanonical:null};
 }
 const transition=evaluateEngine22V3WaveTransition({degreeState:source,evidence});
 if(!transition.ok)return {ok:false,reasonCodes:transition.reasonCodes,proposedCanonical:null};
 const proposed=clone(canonical);
 proposed.degrees[degree]={...proposed.degrees[degree],...transition.proposal};
 if(evidence.completionCandidate===true && transition.reasonCodes.includes("COMPLETION_CANDIDATE_OBSERVED")) {
   proposed.degrees[degree].lastCandidateEvidenceId=evidence.candidatePivotBarId ?? evidence.sourceBarId;
 }

 if(evidence.completionConfirmed===true && transition.ok &&
    (transition.advanceProposed===true ||
     transition.reasonCodes.includes("W5_CONFIRMED_PARENT_REVIEW_REQUIRED"))) {
   const proof=evidence.structuralProof;
   const key=proof.anchorKey;
   const priorAnchor=source.anchors[key];
   if(priorAnchor?.status==="LOCKED") {
     if(priorAnchor.price!==proof.anchor.price || priorAnchor.time!==proof.anchor.time)
       return {ok:false,reasonCodes:["LOCKED_COMPLETION_ANCHOR_CONFLICT"],proposedCanonical:null};
   } else {
     proposed.degrees[degree].anchors[key]={
       price:proof.anchor.price,time:proof.anchor.time,status:"CONFIRMED",
       evidenceId:evidence.sourceBarId,structuralRuleId:proof.ruleId,
     };
   }
 }
 // Every accepted observation has an immutable audit entry. Never silently
 // rewrite historical context when a pivot is merely proposed.
 const entry={
   kind:"EVIDENCE_EVALUATED",sourceTimestamp:evidence.sourceTimestamp,
   sourceBarId:evidence.sourceBarId,sourceTimeframe:evidence.sourceTimeframe,
   countId:source.countId,degreeId:degree,waveBefore:source.activeWave,
   waveAfter:proposed.degrees[degree].activeWave,
   lifecycleAfter:proposed.degrees[degree].lifecycle,
   reasonCodes:transition.reasonCodes,
 };
 proposed.degrees[degree].history=[...source.history,entry];
 const after=validateEngine22V3Transition(canonical,proposed,{approvedRecountIds});
 if(!after.ok)return {ok:false,reasonCodes:after.errors,proposedCanonical:null};
 return {ok:true,reasonCodes:transition.reasonCodes,proposedCanonical:proposed,
   publishAuthorized:false,shadowOnly:true,noExecution:true,noPermissionCreated:true};
}
