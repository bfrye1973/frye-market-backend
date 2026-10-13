// Pure Engine 22 V3 canonical-derived snapshot bundle. Never reads or writes
// persistence, and never replaces a live contract. All projections share one count.
import {validateEngine22V3Canonical, ENGINE22_V3_DEGREES} from "./canonicalStructure.js";
import {projectEngine22V3DegreeFib} from "./projectDegreeFib.js";
import {projectEngine22V3ActiveWaveFibShadow} from "./projectActiveWaveFibShadow.js";
import {buildEngine22V3IndependentNodeShadow,DEGREE_CANDLE_TIMEFRAMES} from "./buildIndependentNodeShadow.js";
import {replayConfirmedEngine22V3LifecycleShadow} from "./replayConfirmedLifecycleShadow.js";
import {inspectEngine11V2SevenDegreeShadow} from "./inspectEngine11SourceIdentityShadow.js";
import {buildEngine22V3CrossDegreeWatch} from "./buildCrossDegreeWatch.js";
import {proposeEngine22V3CanonicalObservation} from "./proposeCanonicalObservation.js";
const clone=x=>structuredClone(x);
// Price-only W2 planning map where the owner has confirmed both prices but
// not the W1 high timestamp. This cannot provide structural confirmation,
// authoritative Fibonacci, completed-bar touches, or execution permission.
function provisionalMicroW2Map(state){
 const low=state.anchors?.W1_LOW;
 const high=state.ownerW1HighPrice;
 if(state.ownerCorrectionState!=="MICRO_W2_OWNER_RECOUNT" ||
    low?.status!=="CONFIRMED" || !Number.isFinite(low.price) ||
    !Number.isFinite(high) || high<=low.price)return null;
 const ratios=[["r236",.236],["r382",.382],["r500",.5],
               ["r618",.618],["r786",.786]];
 return {
  available:true,degree:"MICRO",activeWave:"W2",modelType:"RETRACEMENT",
  modelKey:["MICRO_OWNER_PRICE_ONLY_W2",low.price,low.time,high].join("|"),
  projectionBase:high,projectionLength:high-low.price,
  levels:ratios.map(([key,ratio])=>({
   key,ratio,price:Math.round((high-(high-low.price)*ratio)*4)/4,
   status:"WATCH",firstTouchedAt:null,firstTouchedBarId:null,
  })),
  sourceTimeframe:"10m",anchorOnly:true,provisional:true,
  touchEvidenceAvailable:false,waveCompletionConfirmed:false,
  reasonCodes:["OWNER_PRICE_ONLY","W1_HIGH_TIMESTAMP_UNVERIFIED",
               "NO_VALIDATED_TOUCH_EVIDENCE"],
  shadowOnly:true,noExecution:true,noPermissionCreated:true,
  officialFibAuthorityChanged:false,publishAuthorized:false,
 };
}

export function buildEngine22V3ShadowSnapshot({
 canonical=null,evidenceByDegree=null,barsByTf=null,evaluationTimeMs=null,
 sourceByDegree=null,previousFibByDegree=null,rulesByDegree=null,
 engine11V2SourcePagesByDegree=null,
}={}){
 const v=validateEngine22V3Canonical(canonical);
 if(!v.ok)return {available:false,reasonCodes:v.errors,shadowOnly:true};
 let effective=canonical;
 const observed=[];
 if(evidenceByDegree!==null){
   if(!evidenceByDegree || typeof evidenceByDegree!=="object" || Array.isArray(evidenceByDegree))
     return {available:false,reasonCodes:["INVALID_EVIDENCE_MAP"],shadowOnly:true};
   for(const degree of ENGINE22_V3_DEGREES){
     if(!Object.prototype.hasOwnProperty.call(evidenceByDegree,degree))continue;
     const result=proposeEngine22V3CanonicalObservation({
       canonical:effective,degree,evidence:evidenceByDegree[degree],
     });
     if(!result.ok)return {available:false,reasonCodes:[degree,...result.reasonCodes],shadowOnly:true};
     effective=result.proposedCanonical;
     observed.push({degree,reasonCodes:result.reasonCodes});
   }
 }
 // Live-shadow is additive: legacy Fib, official anchors and downstream contracts
 // remain exactly as they were. Unvalidated source data never becomes Fib authority.
 const nodes=buildEngine22V3IndependentNodeShadow({
   canonical:effective,barsByTf,evaluationTimeMs,
 });
 const sourceIdentities=inspectEngine11V2SevenDegreeShadow({canonical:effective,
   sourcePagesByDegree:engine11V2SourcePagesByDegree});
 const degreeStates={}, wavelengthDegrees={}, displayDegrees={},v3Cards={};
 for(const d of ENGINE22_V3_DEGREES){
  const state=effective.degrees[d],key=d.toLowerCase();
  const fib=projectEngine22V3DegreeFib({canonical:effective,degree:d});
  const source=sourceByDegree?.[d]??null;
  const node=nodes.degrees?.[key]??null;
  const candidate=node?.waveCandidate??null;
  let shadowState=state, replay=null;
  // Only an independently eligible source and explicit structural rules may
  // propose transitions. These proposals never overwrite the canonical object.
  if(source?.structuralEligible===true && source.coverageComplete===true &&
     source.sourceCountId===state.countId && source.timeframe===DEGREE_CANDLE_TIMEFRAMES[d] &&
     Array.isArray(source.bars) && rulesByDegree?.[d]){
    replay=replayConfirmedEngine22V3LifecycleShadow({
      degreeState:state,bars:source.bars,rulesByWave:rulesByDegree[d],
    });
    if(replay.ok)shadowState=replay.finalState;
  }
  const projected=shadowState===state?effective:{
    ...effective,degrees:{...effective.degrees,[d]:shadowState},
  };
  const provisionalMicroFib=d==="MICRO" ? provisionalMicroW2Map(state) : null;
  const shadowFib=provisionalMicroFib || projectEngine22V3ActiveWaveFibShadow({
    canonical:projected,degree:d,source,
    previous:previousFibByDegree?.[d]??null,
    anchorOnly:true,
  });
  const validatedHistory=source?.structuralEligible===true &&
     source.coverageComplete===true &&
     source.sourceCountId===state.countId &&
     source.timeframe===DEGREE_CANDLE_TIMEFRAMES[d] &&
     shadowFib.reasonCodes?.[0]!=="SOURCE_UNAVAILABLE";
  const dataStatus=shadowFib.available===true && shadowFib.anchorOnly===true
    ? "PROVISIONAL_ANCHOR_FIB"
    : !validatedHistory
    ? (node?.nodeEvidenceAvailable===true ? "PROVISIONAL_NODE_EVIDENCE" : "INSUFFICIENT_HISTORY")
    : !shadowFib.available?"EVIDENCE_PENDING":
      shadowFib.provisional?"PROVISIONAL":"SHADOW_READY";
  v3Cards[key]={
    degree:d,sourceTimeframe:DEGREE_CANDLE_TIMEFRAMES[d],
    activeWave:shadowState.activeWave,lifecycle:shadowState.lifecycle,
    ownerCorrectionState:state.ownerCorrectionState??null,
    ownerRole:state.ownerRole??null,
    correctionDirection:state.correctionDirection??null,
    ownerW1HighPrice:state.ownerW1HighPrice??null,
    ownerW1HighTimeVerified:state.ownerW1HighTimeVerified??null,
    ownerApproxW2Low:state.ownerApproxW2Low??null,
    ownerAbcTurns:state.ownerCorrectionState==="SUBMICRO_ABC_INSIDE_MICRO_W2"
      ? clone(state.ownerAbcTurns??null):null,
    abcLeg:state.ownerCorrectionState==="SUBMICRO_ABC_INSIDE_MICRO_W2"
      ? "C_DOWN_DEVELOPING_UNCONFIRMED":"UNCONFIRMED",
    parentWaveCompletionConfirmed:false,
    ownerW1High:state.ownerCorrectionState==="SUBMICRO_W2_OWNER_CORRECTED"
      ? clone(state.anchors?.W1_HIGH??null):null,
    ownerW1Low:state.ownerCorrectionState==="SUBMICRO_W2_OWNER_CORRECTED"
      ? clone(state.anchors?.W1_LOW??null):null,
    ownerW1LowPending:state.ownerCorrectionState==="SUBMICRO_W2_OWNER_CORRECTED" &&
      !state.anchors?.W1_LOW,
    sourceCountId:state.countId,sequenceId:state.sequenceId,
    sequenceDirection:shadowState.sequenceDirection??null,
    dataStatus,sourceCandleCount:node?.sourceCandleCount??0,
    latestCompletedCandle:node?.latestCompletedCandle??null,
    nodeEvidenceAvailable:node?.nodeEvidenceAvailable===true,
    swingHighCount:node?.detectedNodes?.HIGH?.length??0,
    swingLowCount:node?.detectedNodes?.LOW?.length??0,
    waveCandidate:candidate?clone(candidate):null,
    lifecycleReplay:replay?{
      ok:replay.ok,eventCount:replay.events?.length??0,
      lastEvent:replay.events?.at(-1)??null,
    }:null,
    fibonacci:shadowFib,
    engine11SourceIdentity:sourceIdentities.degrees[key],
    levels:shadowFib.available?clone(shadowFib.levels):[],
    reasonCodes:!validatedHistory?
      ["INSUFFICIENT_HISTORY","VALIDATED_ENGINE11_SOURCE_REQUIRED",...(node?.reasonCodes??[])]:
      [...(shadowFib.reasonCodes??[]),...(node?.reasonCodes??[])],
    shadowOnly:true,publishAuthorized:false,
    officialFibAuthorityChanged:false,anchorPromotionAllowed:false,
    noExecution:true,noPermissionCreated:true,
  };
  degreeStates[key]={
   degree:d,sourceCountId:state.countId,sequenceId:state.sequenceId,
   parentDegree:state.parentDegree,parentWave:state.parentWave,
   activeWave:state.activeWave,lifecycle:state.lifecycle,
   anchors:clone(state.anchors),invalidation:clone(state.invalidation),
   sourceTimestamp:canonical.sourceTimestamp??null,
  };
  wavelengthDegrees[key]={
   degree:d,sourceCountId:state.countId,activeWave:state.activeWave,
   lifecycle:state.lifecycle,fibModel:fib,
  };
  displayDegrees[key]={
   degree:key,label:d.replace(/_/g," "),active:state.activeWave!==null,
   badge:state.lifecycle,rows:Object.entries(state.anchors).map(([wave,a])=>({
    label:wave,value:a.price===null?"Unknown":String(a.price),
    status:a.status,sourceCountId:state.countId,
   })),levels:fib.available?clone(fib.levels):[],
   noPermissionCreated:true,noExecution:true,
  };
 }
 const watch=buildEngine22V3CrossDegreeWatch({canonical:effective});
 return {
  available:true,shadowOnly:true,automationEligible:false,
  sourceSchema:effective.schema,sourceTimestamp:effective.sourceTimestamp??null,
  observed,
  // Consumer-safe V3-specific read model. Never replace official degreeStates.
  v3LiveShadow:{available:true,shadowOnly:true,publishAuthorized:false,
    engine11SourceIdentityOnly:true,
    degreeOrder:ENGINE22_V3_DEGREES.map(d=>d.toLowerCase()),
    degrees:v3Cards,noExecution:true,noPermissionCreated:true,
    officialFibAuthorityChanged:false,anchorPromotionAllowed:false},
  degreeStates:{degrees:degreeStates},
  currentWavelength:{degrees:wavelengthDegrees},
  engine22Display:{degreeOrder:ENGINE22_V3_DEGREES.map(d=>d.toLowerCase()),degrees:displayDegrees},
  crossDegreeWatch:watch,
  // Micro timing context is deliberately NOT repurposed until legacy consumer
  // identity migration is accepted; no competing machine authority.
  microExecutionContext:null,
  reasonCodes:["V3_CANONICAL_SHADOW_ONLY","DOWNSTREAM_NOT_PUBLISHED"],
  noPermissionCreated:true,noExecution:true,
 };
}
