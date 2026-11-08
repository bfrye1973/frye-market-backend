// Engine27 V6 compact research feature seed, read-only projection.
// Do not rerun historical engines or assert missing physical-contract provenance.
import {createHash} from "node:crypto";
const hash=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const validTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const price=x=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const compact=x=>x===undefined?null:JSON.parse(JSON.stringify(x));
const degrees=["submicro","micro","subminute","minute","minor","intermediate","primary"];
export function extractCompactWaveEvidence(replay,{ingestedAt,sourceReplay=null}={}){
 if(replay?.schema!=="engine12.multiStrategyReplay.v1"||
    replay?.replayContract!=="CANONICAL_MULTI_STRATEGY_REPLAY"||
    !validTime(replay?.snapshotTime)||!validTime(ingestedAt)||
    !replay?.strategies?.["intraday_scalp@10m"])
   return {ok:false,reason:"INVALID_CANONICAL_OR_TIMESTAMPS"};
 const strategy=replay.strategies["intraday_scalp@10m"];
 const e22=strategy.engine22WaveStrategy??null;
 const auth=e22?.authorizedWorkingStructure;
 const marketPrice=price(replay.currentPrice)?replay.currentPrice:null;
 const waves=Object.fromEntries(degrees.map(degree=>{
   const original=auth?.status==="COMPLETE_WORKING_SELECTION"&&auth?.degrees?.[degree]?.available===true?
     auth.degrees[degree]:null;
   return [degree,original?{
     activeWave:original.activeWave??null,direction:original.direction??null,stage:original.stage??null,
     modelVersion:original.modelVersion??null,parentDegree:original.parentDegree??null,
     parentWave:original.parentWave??null,selectionRevision:auth.publicationRevision??null,
     publishedAt:auth.publishedAt??null,
   }:null];
 }));
 // Preserve small, explicitly selected existing conclusions; never embed full Replay.
 const contextual={
   engine3Reaction:compact(strategy?.confluence?.context?.reaction?.engine3V5??null),
   engine4Participation:compact(strategy?.confluence?.context?.volume?.engine4AuthorizedReactionParticipation??null),
   engine26Candidate:compact(strategy?.engine26LocationCandidate??null),
   engine25Context:compact(replay?.engine25Context?.summary??null),
   engine29Context:compact(replay?.engine29Context?.summary??null)
 };
 const missing=[
   ...(marketPrice===null?["ROOT_ES_PRICE_UNAVAILABLE"]:[]),
   ...(!auth?["ORIGINAL_AUTHORIZED_WAVE_PUBLICATION_UNAVAILABLE"]:[]),
   "PHYSICAL_ES_CONTRACT_UNVERIFIED"
 ];
 const seed={schema:"engine27.v6.compactWaveEvidence.v1",snapshotTimeUtc:replay.snapshotTime,
   engine27IngestedAt:ingestedAt,sourceReplay:compact(sourceReplay),symbol:"ES",
   price:marketPrice,physicalEsContract:null,contractIdentityStatus:"UNVERIFIED",
   wavePublicationId:auth?.publicationId??null,waves,contextual,missing,
   historicalEnginesRerun:false,noTradePermission:true,retrospectiveAnnotation:false};
 return {ok:true,seed:{...seed,featureFingerprint:hash({
   snapshotTimeUtc:seed.snapshotTimeUtc,price:seed.price,waves:seed.waves,contextual:seed.contextual
 })}};
}
