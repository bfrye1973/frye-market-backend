// Engine 6B advisory-only canonical context. This module cannot grant, reduce or veto PAPER permission.
import {readAuthorizedWorkingStructure} from "../../engine27/v2/readAuthorizedWorkingStructure.js";
const object=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:null;
const pick=(...xs)=>xs.find(x=>x!==undefined&&x!==null)??null;
function published(degree){
  if(!object(degree)) return {available:false};
  return {available:degree.available===true,activeWave:degree.activeWave??null,
    workingDirection:degree.direction??null,stage:degree.stage??null,
    selectionStatus:degree.selectionStatus??null,modelVersion:degree.modelVersion??null,
    sourcePath:degree.sourcePath??null,levels:Array.isArray(degree.levels)?structuredClone(degree.levels):[],
    completionConfirmed:degree.completionConfirmed===true};
}
export function buildEngine6AdvisoryContext({snapshot=null,engine25Participation=null,engine29Stress=null}={}){
  const wave=readAuthorizedWorkingStructure(snapshot);
  const strategy=snapshot?.strategies?.["intraday_scalp@10m"];
  const engine25=object(engine25Participation);
  const market25=object(strategy?.engine25Context);
  const e29=object(engine29Stress);
  const participation=object(engine25?.participation);
  const pressure=object(participation?.distributionPressure);
  const tactical=object(e29?.marketCharacter);
  const result={
    schema:"engine6.marketIntelligenceAdvisory.v1",mode:"READ_ONLY_ADVISORY",
    noPermissionCreated:true,noEntryVeto:true,noSizingAuthority:true,noExecution:true,
    wave:{
      available:wave.available===true,reasonCode:wave.reasonCode??null,
      ownerRevision:wave.publication?.publicationRevision??null,
      ownerApprovalReference:wave.publication?.selectionApprovalReference??null,
      publishedAt:wave.publication?.publishedAt??null,
      selectionStatus:wave.publication?.status??"UNAVAILABLE",
      submicro:published(wave.publication?.degrees?.submicro),
      micro:published(wave.publication?.degrees?.micro)
    },
    marketHealth:{
      available:Boolean(engine25||market25),timestamp:pick(engine25?.timestamp,engine25?.generatedAt,market25?.timestamp,market25?.generatedAt),
      intradayFreshness:engine25?.freshness?.intraday?.state??null,
      distributionPressure:{
        state:pressure?.state??null,
        oneHour:pressure?.oneHourTrend?.state??null,
        thirtyMinute:pressure?.thirtyMinuteConfirmation?.state??null,
        tenMinute:pressure?.tenMinuteAcceleration?.state??null,
        observations:Array.isArray(pressure?.observations)?structuredClone(pressure.observations):[]
      },
      alignment:market25?.marketInternals?.alignment?.overall??null,
      regime:market25?.regime??null,
      source:"ENGINE25_CANONICAL"
    },
    intraday:{
      available:Boolean(e29),timestamp:e29?.timestamp??null,
      dataDegraded:e29?.dataDegraded===true,
      tacticalState:e29?.tacticalState??null,
      fastTacticalState:e29?.fastTacticalState??null,
      parentMove:object(tactical?.move?.parent)?structuredClone(tactical.move.parent):null,
      liveConditionDiagnosticOnly:object(tactical?.move?.liveCondition)?structuredClone(tactical.move.liveCondition):null,
      liquidity:object(tactical?.liquidity)?structuredClone(tactical.liquidity):null,
      trap:object(tactical?.trap)?structuredClone(tactical.trap):null,
      squeeze:object(e29?.squeezeV2Observation)?structuredClone(e29.squeezeV2Observation):null,
      source:"ENGINE29_CANONICAL_NO_DOUBLE_COUNT"
    }
  };
  return result;
}
export default buildEngine6AdvisoryContext;
