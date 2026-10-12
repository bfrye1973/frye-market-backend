// Phase 1: isolated proof of existing Engine22 V3 modules. Never writes canonical state.
// Confirmation rules are separately provided structural evidence, never created by this replay.
import {proposeEngine22V3WaveCandidate} from "./proposeWaveCandidate.js";
import {verifyEngine22V3WaveCompletion} from "./verifyWaveCompletion.js";
import {evaluateEngine22V3WaveTransition} from "./evaluateWaveTransition.js";

const clone = x => structuredClone(x);
const WAVES = ["W1","W2","W3","W4","W5"];
const KEY = {W1:"W1_HIGH",W2:"W2_LOW",W3:"W3_HIGH",W4:"W4_LOW",W5:"W5_HIGH"};
const fail = (reason,events=[]) => ({ok:false,reasonCodes:[reason],events,
  shadowOnly:true,publishAuthorized:false,noExecution:true,noPermissionCreated:true});
export function replayConfirmedEngine22V3LifecycleShadow({
 degreeState=null,bars=[],rulesByWave={},left=2,right=2,
}={}) {
 if (!degreeState || !WAVES.includes(degreeState.activeWave) || !Array.isArray(bars))
   return fail("DEGREE_AND_BARS_REQUIRED");
 if (!["UP","DOWN"].includes(degreeState.sequenceDirection))
   return fail("SEQUENCE_DIRECTION_REQUIRED");
 if (bars.some((b,i)=>b?.closed!==true || !b.sourceBarId ||
   !Number.isFinite(Date.parse(b.sourceTimestamp)) || !b.timeframe ||
   typeof b.high!=="number" || typeof b.low!=="number" ||
   typeof b.close!=="number" || b.high<b.low || b.close>b.high || b.close<b.low ||
   (i>0 && (Date.parse(b.sourceTimestamp)<=Date.parse(bars[i-1].sourceTimestamp) ||
     b.timeframe!==bars[0].timeframe || b.sourceBarId===bars[i-1].sourceBarId))))
   return fail("INVALID_OR_UNCOMPLETED_SOURCE_HISTORY");
 if (new Set(bars.map(b=>b.sourceBarId)).size!==bars.length)
   return fail("DUPLICATE_SOURCE_BAR_ID");
 let state=clone(degreeState),pending=null;
 const events=[];
 for (let i=0;i<bars.length;i++) {
   const history=bars.slice(0,i+1),current=bars[i];
   if (pending && i>pending.index) {
     const wave=state.activeWave,rule=rulesByWave?.[wave];
     // Structural rule must be an independently established, count-bound packet.
     if (rule?.passed===true && rule.countId===state.countId && rule.wave===wave &&
         rule.evidenceBarId===rule.reversalBarId &&
         history.some(b=>b.sourceBarId===rule.evidenceBarId)) {
       const confirming=history.find(b=>b.sourceBarId===rule.evidenceBarId);
       const verified=verifyEngine22V3WaveCompletion({
         degreeState:{...state,degreeId:state.degreeId,confirmationRule:rule},
         candidate:{...pending.candidate,evidenceConfirmedAt:confirming.sourceTimestamp},
         bars:history,
       });
       if (verified.verified) {
         const key=KEY[wave],prior=state.anchors?.[key];
         const a=verified.proof.anchor;
         if (prior?.status==="LOCKED" &&
             (prior.price!==a.price || prior.time!==a.time)) {
           events.push({wave,kind:"LOCKED_ANCHOR_CONFLICT",reasonCodes:["LOCKED_ANCHOR_NO_REPAINT"]});
           return {...fail("LOCKED_ANCHOR_NO_REPAINT",events),finalState:state};
         }
         const decision=evaluateEngine22V3WaveTransition({degreeState:state,evidence:{
           completed:true,sourceTimestamp:current.sourceTimestamp,
           sourceBarId:current.sourceBarId,sourceTimeframe:current.timeframe,
           completionConfirmed:true,independentConfirmation:true,structuralRuleId:rule.id,
         }});
         if (!decision.ok) return {...fail(decision.reasonCodes[0],events),finalState:state};
         const before=wave;
         state={...state,...decision.proposal,anchors:{
           ...(state.anchors||{}),[key]:prior?.status==="LOCKED"?prior:{
             price:a.price,time:a.time,status:"CONFIRMED",
             evidenceId:verified.proof.sourceBarId,structuralRuleId:rule.id,
           },
         }};
         if (decision.advanceProposed)
           state.waveStartTimestamp=a.time;
         events.push({kind:"STRUCTURAL_WAVE_CONFIRMED",waveBefore:before,
           waveAfter:state.activeWave,proof:verified.proof,
           reasonCodes:decision.reasonCodes,observedAt:current.sourceTimestamp});
         pending=null;
         if (before==="W5") break;
       }
     }
   }
   if (pending) continue;
   if (state.lifecycle==="LOCKED" || state.lifecycle==="INVALIDATED" ||
       state.lifecycle==="RECOUNT_REQUIRED") break;
   const candidate=proposeEngine22V3WaveCandidate({degreeState:state,bars:history,left,right});
   if (!candidate.available || candidate.candidate.evidenceConfirmedAt!==current.sourceTimestamp)
     continue;
   const proposal=evaluateEngine22V3WaveTransition({degreeState:state,evidence:{
     completed:true,sourceTimestamp:current.sourceTimestamp,sourceBarId:current.sourceBarId,
     sourceTimeframe:current.timeframe,completionCandidate:true,
   }});
   if (!proposal.ok || !proposal.reasonCodes.includes("COMPLETION_CANDIDATE_OBSERVED"))
     continue;
   state={...state,...proposal.proposal,lastCandidateEvidenceId:candidate.candidate.sourceBarId};
   pending={candidate:candidate.candidate,index:i};
   events.push({kind:"COMPLETION_CANDIDATE",wave:state.activeWave,
     pivotBarId:pending.candidate.sourceBarId,observedAt:current.sourceTimestamp});
 }
 return {ok:true,events,finalState:state,
   pendingCandidate:pending?.candidate||null,shadowOnly:true,
   publishAuthorized:false,noExecution:true,noPermissionCreated:true,
   officialFibAuthorityChanged:false};
}
