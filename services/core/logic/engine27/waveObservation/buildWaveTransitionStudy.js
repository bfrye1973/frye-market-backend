// Read-only research case assembly from independently verified source records.
// Never infer a physical ES contract or a completed candle from a Replay root price.
import {studyWaveNegotiatedZone} from "./studyWaveNegotiatedZone.js";
import {studyWaveZoneCandle} from "./studyWaveZoneCandle.js";
const valid=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
export function buildWaveTransitionStudy({before,after,degree,endingPrice,negotiatedCandidate,completedBar=null,priorBar=null}={}){
 if(!["micro","submicro"].includes(degree)||!valid(before?.snapshotTime)||!valid(after?.snapshotTime)||
 Date.parse(before.snapshotTime)>=Date.parse(after.snapshotTime))
  return {ok:false,reason:"INVALID_CHRONOLOGICAL_SOURCE_PAIR"};
 const b=before?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.authorizedWorkingStructure;
 const a=after?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.authorizedWorkingStructure;
 const old=b?.degrees?.[degree],next=a?.degrees?.[degree];
 if(b?.status!=="COMPLETE_WORKING_SELECTION"||a?.status!=="COMPLETE_WORKING_SELECTION"||
 !old?.available||!next?.available||old.modelVersion===next.modelVersion)
  return {ok:false,reason:"QUALIFIED_MODEL_TRANSITION_UNAVAILABLE"};
 const zone=studyWaveNegotiatedZone({waveExtremePrice:endingPrice,engine26Candidate:negotiatedCandidate,
  sourceSnapshotTime:after.snapshotTime});
 const candle=studyWaveZoneCandle({bar:completedBar,priorBar,direction:old.direction,
  levels:old.levels??[],asOf:after.snapshotTime});
 const touched=(old.levels??[]).filter(x=>x.status==="TOUCHED"&&valid(x.touchedAt)&&Date.parse(x.touchedAt)<=Date.parse(before.snapshotTime))
 .sort((x,y)=>Date.parse(y.touchedAt)-Date.parse(x.touchedAt))[0]??null;
 return {ok:true,schema:"engine27.v6.waveTransitionStudy.v1",degree,
  before:{snapshotTime:before.snapshotTime,activeWave:old.activeWave,modelVersion:old.modelVersion,
    direction:old.direction},after:{snapshotTime:after.snapshotTime,activeWave:next.activeWave,
    modelVersion:next.modelVersion,direction:next.direction},
  ownerReferencedEnding:typeof endingPrice==="number"&&Number.isFinite(endingPrice)?endingPrice:null,
  lastPublishedTouch:touched?{key:touched.key??null,price:touched.price,touchedAt:touched.touchedAt}:null,
  negotiatedZone:zone.available?zone:null,candleEvidence:candle.available?candle:null,
  candleStatus:candle.available?"QUALIFIED_COMPLETED_CANDLE":"OHLC_UNAVAILABLE",
  exactPhysicalContract:null,contractIdentityStatus:"UNVERIFIED",
  structuralCompletionIndependentlyVerified:false,
  noWaveAuthority:true,noExecution:true};
}
