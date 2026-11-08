// Isolated Engine27 V6 evidence recording orchestration, explicit inputs only.
// Production scheduling/deployment not enabled. Never assumes same Replay contract.
import {assembleWaveEvidence,WAVE_DEGREES} from "./assembleWaveEvidence.js";
import {createWaveEvidenceArchive} from "./createWaveEvidenceArchive.js";
export function createWaveEvidenceRecorder({root}={}){
 const archive=createWaveEvidenceArchive({root});
 function record({snapshot,sourceReplay,ohlc,zoneCandidate=null,waveExtremePrices={},asOf}={}){
  if(!sourceReplay?.sha256||!snapshot||!ohlc)return {ok:false,reason:"REQUIRED_PROVENANCE_OR_OHLC_ABSENT"};
  const outcomes=[];
  for(const degree of WAVE_DEGREES){
   const result=assembleWaveEvidence({snapshot,degree,sourceReplay,ohlc,zoneCandidate,
     waveExtremePrice:waveExtremePrices[degree]??null,asOf});
   if(!result.ok){outcomes.push({degree,ok:false,reason:result.reason});continue}
   // Per-degree evidence not accepted where its required primary timeframe is missing.
   // Other degrees require explicit future primary-timeframe policy before persistence.
   if(!["micro","submicro"].includes(degree)){
    outcomes.push({degree,ok:false,reason:"DEGREE_PRIMARY_TIMEFRAME_NOT_APPROVED"});continue;
   }
   const written=archive.append(result);
   outcomes.push({degree,ok:written.ok,reason:written.reason??null,
     evidenceKey:written.ok?written.key:null});
  }
  return {ok:outcomes.every(x=>x.ok||x.reason==="DEGREE_PRIMARY_TIMEFRAME_NOT_APPROVED"),
    degreeResults:outcomes,productionActivated:false,sourceReplaySha256:sourceReplay.sha256};
 }
 return Object.freeze({record,storagePath:archive.storagePath});
}
