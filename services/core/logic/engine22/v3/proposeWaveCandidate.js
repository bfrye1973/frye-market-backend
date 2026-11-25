// Engine 22 V3 — map closed-bar swing evidence to a degree's active wave.
// Candidate generation only; an Elliott completion requires additional structural rules.
import {detectEngine22V3SwingEvidence} from "./detectSwingEvidence.js";
const VALID_WAVES=new Set(["W1","W2","W3","W4","W5"]);
export function proposeEngine22V3WaveCandidate({
 degreeState=null,bars=[],left=2,right=2,
}={}){
 if(!degreeState||!VALID_WAVES.has(degreeState.activeWave))
  return {available:false,reasonCodes:["ACTIVE_WAVE_REQUIRED"],candidate:null};
 if(degreeState.lifecycle==="LOCKED"||degreeState.lifecycle==="INVALIDATED"||
    degreeState.lifecycle==="RECOUNT_REQUIRED")
  return {available:false,reasonCodes:["PROTECTED_OR_INVALID_LIFECYCLE"],candidate:null};
 const dir=degreeState.sequenceDirection;
 if(!["UP","DOWN"].includes(dir))
  return {available:false,reasonCodes:["SEQUENCE_DIRECTION_REQUIRED"],candidate:null};
 const wave=degreeState.activeWave;
 const trendLeg=["W1","W3","W5"].includes(wave);
 const side=(dir==="UP")===trendLeg?"HIGH":"LOW";
 const pivots=detectEngine22V3SwingEvidence({bars,left,right,side});
 if(!pivots.available)return {available:false,reasonCodes:pivots.reasonCodes,candidate:null};
 const baseTime=degreeState.waveStartTimestamp;
 if(typeof baseTime!=="string"||!Number.isFinite(Date.parse(baseTime)))
  return {available:false,reasonCodes:["WAVE_START_TIMESTAMP_REQUIRED"],candidate:null};
 const eligible=pivots.candidates.filter(p=>Date.parse(p.sourceTimestamp)>Date.parse(baseTime));
 const pivot=eligible.at(-1);
 if(!pivot)return {available:false,reasonCodes:["NO_COMPLETED_SWING_CANDIDATE"],candidate:null};
 // A candidate needs a new bar identity; repeated snapshots cannot reissue it.
 if(degreeState.lastCandidateEvidenceId===pivot.sourceBarId)
   return {available:false,reasonCodes:["ALREADY_OBSERVED_CANDIDATE"],candidate:null};
 if(degreeState.lastEvaluatedEvidenceTimestamp &&
    Date.parse(pivot.confirmationTimestamp)<=Date.parse(degreeState.lastEvaluatedEvidenceTimestamp))
   return {available:false,reasonCodes:["CANDIDATE_EVIDENCE_NOT_NEWER"],candidate:null};
 return {available:true,reasonCodes:["PIVOT_CANDIDATE_ONLY_NOT_WAVE_COMPLETION"],candidate:{
   degreeId:degreeState.degreeId,countId:degreeState.countId,
   activeWave:wave,sequenceDirection:dir,side,
   price:pivot.price,sourceTimestamp:pivot.sourceTimestamp,
   evidenceConfirmedAt:pivot.confirmationTimestamp,sourceBarId:pivot.sourceBarId,
   sourceTimeframe:pivot.sourceTimeframe,
   state:"COMPLETION_CANDIDATE",waveCompletionConfirmed:false,
 },noPermissionCreated:true,noExecution:true};
}
