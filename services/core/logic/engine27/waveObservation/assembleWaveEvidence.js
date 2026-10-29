// Engine27 V6 read-only multi-degree evidence assembly. No network, writes, or wave authority.
// Consumers supply original Replay and bounded Backend-1 futures bars explicitly.
import {deriveCandleCompletionTruth} from "../../engine3/candleCompletionTruth.js";
import {studyFibReactionSequence} from "./studyFibReactionSequence.js";
import {studyWaveZoneCandle} from "./studyWaveZoneCandle.js";
import {studyWaveNegotiatedZone} from "./studyWaveNegotiatedZone.js";

export const WAVE_DEGREES=Object.freeze(["submicro","micro","subminute","minute","minor","intermediate","primary"]);
const validTime=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const durations={"1m":60000,"5m":300000,"10m":600000};
// Owner-selected research signal for Micro/Submicro: completed 10m bar only.
// Smaller bars remain supporting evidence, never a substitute for missing 10m data.
export function wickTimeframePolicy(degree){
 return ["micro","submicro"].includes(degree)
  ? {primary:"10m",supporting:["5m","1m"],status:"OWNER_APPROVED_RESEARCH_CONFIGURATION"}
  : {primary:null,supporting:["10m","5m","1m"],status:"DEGREE_PRIMARY_TIMEFRAME_NOT_SET"};
}
function selectedWave(snapshot,degree){
 const states=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.authorizedWorkingStructure;
 if(states?.status!=="COMPLETE_WORKING_SELECTION")return null;
 const wave=states?.degrees?.[degree];
 return wave?.available===true?wave:null;
}
export function assembleWaveEvidence({snapshot,degree,sourceReplay=null,ohlc=null,zoneCandidate=null,
  waveExtremePrice=null,asOf=null}={}){
 if(!WAVE_DEGREES.includes(degree)||!validTime(snapshot?.snapshotTime))
  return {ok:false,reason:"INVALID_REPLAY_OR_DEGREE"};
 const wave=selectedWave(snapshot,degree);
 if(!wave)return {ok:false,reason:"ORIGINAL_AUTHORIZED_WAVE_UNAVAILABLE"};
 const observedAt=asOf??snapshot.snapshotTime;
 if(!validTime(observedAt)||Date.parse(observedAt)<Date.parse(snapshot.snapshotTime))
  return {ok:false,reason:"INVALID_OBSERVATION_TIME"};
 const replayKey=sourceReplay?.date&&/^\d{4}-\d{2}-\d{2}$/.test(sourceReplay.date)&&
  /^\d{4}$/.test(sourceReplay.time??"")&&
  /^[a-f0-9]{64}$/i.test(sourceReplay.sha256??"");
 const missing=[];
 if(!replayKey)missing.push("SOURCE_REPLAY_RAW_HASH_UNAVAILABLE");
 const results={};
 for(const timeframe of ["1m","5m","10m"]){
  const packet=ohlc?.[timeframe];
  const contract=packet?.resolvedSymbol;
  const verified=typeof contract==="string"&&/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(contract)&&
   packet?.source==="BACKEND1_FUTURES_OHLC"&&packet?.priceBasis==="PHYSICAL_PROVIDER_AGGREGATES";
  if(!verified||!Array.isArray(packet.bars)){
   results[timeframe]={available:false,reason:"QUALIFIED_OHLC_SOURCE_UNAVAILABLE"};
   missing.push(timeframe.toUpperCase()+"_OHLC_UNAVAILABLE");
   continue;
  }
  // Historical bars must be judged using their recorded completion time, not a present-day market clock.
  const truth=deriveCandleCompletionTruth({bars:packet.bars,timeframe,evaluationTimeMs:Date.parse(observedAt)});
  const dur=durations[timeframe];
  const bars=truth.completedBars.map(b=>({
   open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,
   closedAt:new Date(Number(b.time)*1000+dur).toISOString(),completed:true
  })).filter(b=>[b.open,b.high,b.low,b.close].every(finite));
  const qualified=bars.filter(b=>Date.parse(b.closedAt)<=Date.parse(observedAt));
  const sequence=studyFibReactionSequence({bars:qualified,levels:wave.levels??[],
    asOf:observedAt,direction:wave.direction});
  const last=qualified.at(-1)??null;
  const candle=last?studyWaveZoneCandle({bar:last,priorBar:qualified.at(-2)??null,
    direction:wave.direction,levels:wave.levels??[],asOf:observedAt}):null;
  results[timeframe]={available:sequence.available&&Boolean(candle?.available),
   sourceContract:contract,contractIdentifiesRetrievedBarsOnly:true,
   replaySameContractProven:false,barsExamined:qualified.length,
   lastClosedAt:last?.closedAt??null,
   fibSequence:sequence.available?sequence:null,
   lastCandle:candle?.available?candle:null,
   reason:!sequence.available?sequence.reason:!candle?.available?"NO_COMPLETED_CANDLE":null};
  if(!results[timeframe].available)missing.push(timeframe.toUpperCase()+"_RESEARCH_UNAVAILABLE");
 }
 const wickPolicy=wickTimeframePolicy(degree);
 const primaryStudy=wickPolicy.primary?results[wickPolicy.primary]??null:null;
 const zone=studyWaveNegotiatedZone({waveExtremePrice,engine26Candidate:zoneCandidate,
  sourceSnapshotTime:snapshot.snapshotTime});
 if(!zone.available)missing.push("ORIGINAL_NEGOTIATED_ZONE_UNAVAILABLE");
 return {ok:true,schema:"engine27.v6.waveEvidenceAssembly.v1",degree,
  sourceReplay:replayKey?{...sourceReplay}:null,sourceSnapshotTime:snapshot.snapshotTime,
  engine27AssembledAt:observedAt,
  wave:{activeWave:wave.activeWave??null,direction:wave.direction??null,stage:wave.stage??null,
   modelVersion:wave.modelVersion??null,levels:wave.levels??[]},
  candleStudies:results,wickDetection:{...wickPolicy,
   primaryAvailable:primaryStudy?.available===true,
   primaryCandle:primaryStudy?.available?primaryStudy.lastCandle:null,
   status:wickPolicy.primary?(primaryStudy?.available?"PRIMARY_COMPLETED_10M_AVAILABLE":"PRIMARY_COMPLETED_10M_UNAVAILABLE"):"NOT_CONFIGURED"},negotiatedZone:zone.available?zone:null,
  physicalReplayContract:null,contractIdentityStatus:"REPLAY_CONTRACT_UNVERIFIED",
  missingEvidence:missing,completionConfirmed:false,noWaveAuthority:true,noExecution:true};
}
