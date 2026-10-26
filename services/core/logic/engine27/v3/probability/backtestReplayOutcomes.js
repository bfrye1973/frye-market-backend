// Research-only backtest: original Engine12 replay snapshots, no engine reruns.
// This is NOT a historical live-prediction accuracy claim.
import {extractReplayResearchSeed} from "./extractReplayResearchSeed.js";
import {labelEsOutcome} from "./labelEsOutcome.js";
const isTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
export function backtestReplayOutcomes({snapshots=[],contractBySnapshot=null,thresholdPoints=2,toleranceMs=120000}={}){
 const rejected=[],observations=[],outcomes=[];
 if(!Array.isArray(snapshots)||typeof contractBySnapshot!=="function")
  return {ok:false,reason:"REPLAY_INPUT_OR_CONTRACT_RESOLVER_MISSING",noExecution:true};
 const sorted=[...snapshots].sort((a,b)=>Date.parse(a?.snapshotTime)-Date.parse(b?.snapshotTime));
 let last=-Infinity;
 for(const replay of sorted){
  const at=isTime(replay?.snapshotTime)?Date.parse(replay.snapshotTime):null;
  if(at===null||at<=last){rejected.push({reason:"INVALID_OR_DUPLICATE_REPLAY_TIMESTAMP"});continue}
  last=at;
  const exactContract=contractBySnapshot(replay);
  const seed=extractReplayResearchSeed(replay,{resolvedContract:exactContract});
  if(seed.available!==true){rejected.push({at:replay.snapshotTime,reasons:seed.reasons});continue}
  observations.push(seed);
 }
 for(const seed of observations){
  const later=observations.filter(x=>x.resolvedEsContract===seed.resolvedEsContract)
   .map(x=>({contract:x.resolvedEsContract,price:x.predictionPrice,observedAt:x.predictionTimestampUtc}));
  const label=labelEsOutcome(seed,later,{thresholdPoints,toleranceMs});
  if(label.available)outcomes.push(label);
  else rejected.push({at:seed.predictionTimestampUtc,reason:label.reason});
 }
 const counts={UP:0,DOWN:0,SIDEWAYS:0};
 for(const row of outcomes)counts[row.outcome]++;
 return {schema:"engine27.v3.replayOutcomeBacktest.v1",ok:true,
  source:"ORIGINAL_ENGINE12_REPLAY",historicalEnginesRerun:false,
  retrospectiveResearchOnly:true,wasIssuedLive:false,
  totalSnapshots:snapshots.length,eligibleSeeds:observations.length,
  labeledOutcomes:outcomes.length,outcomeCounts:counts,rejected,
  thresholdPoints,toleranceMs,probabilities:{up:null,down:null,sideways:null},
  accuracy:null,calibration:"NOT_CALIBRATED",
  // No prediction was issued at the original timestamp, so accuracy is unavailable.
  observations,outcomes,noExecution:true,noJournalWrite:true};
}
