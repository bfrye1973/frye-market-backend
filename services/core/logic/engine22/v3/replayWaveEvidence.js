// Engine22 V3 replay harness — pure and reproducible.
// Replays only completed, timestamp-ordered evidence, never persists or promotes it.
import {detectEngine22V3SwingEvidence} from "./detectSwingEvidence.js";
import {proposeEngine22V3WaveCandidate} from "./proposeWaveCandidate.js";
import {evaluateEngine22V3WaveTransition} from "./evaluateWaveTransition.js";
const clone=x=>structuredClone(x);
export function replayEngine22V3WaveEvidence({degreeState=null,bars=[],left=2,right=2}={}){
 if(!degreeState || !Array.isArray(bars))
  return {ok:false,reasonCodes:["DEGREE_AND_BARS_REQUIRED"],events:[]};
 const events=[];
 let simulated=clone(degreeState);
 for(let i=0;i<bars.length;i++){
  const history=bars.slice(0,i+1);
  const side=["W1","W3","W5"].includes(simulated.activeWave) ?
    (simulated.sequenceDirection==="UP"?"HIGH":"LOW") :
    (simulated.sequenceDirection==="UP"?"LOW":"HIGH");
  const observed=detectEngine22V3SwingEvidence({bars:history,left,right,side});
  if(!observed.available)continue;
  const proposed=proposeEngine22V3WaveCandidate({degreeState:simulated,bars:history,left,right});
  if(!proposed.available)continue;
  const candidate=proposed.candidate;
  // Do not emit a candidate before the right-side confirmation bar exists.
  if(candidate.evidenceConfirmedAt!==bars[i].sourceTimestamp)continue;
  const evidence={
   completed:true,sourceTimestamp:bars[i].sourceTimestamp,
   sourceBarId:bars[i].sourceBarId,sourceTimeframe:bars[i].timeframe,
   completionCandidate:true,
  };
  const next=evaluateEngine22V3WaveTransition({degreeState:simulated,evidence});
  if(!next.ok)continue;
  events.push({
   observedAt:evidence.sourceTimestamp,sourceBarId:evidence.sourceBarId,
   wave:simulated.activeWave,pivotAt:candidate.sourceTimestamp,
   pivotPrice:candidate.price,result:next.reasonCodes,
   predictedCompletion:false,
  });
  simulated={...simulated,...next.proposal};
 }
 return {ok:true,events,finalState:simulated,
  noExecution:true,noPermissionCreated:true,shadowOnly:true};
}
