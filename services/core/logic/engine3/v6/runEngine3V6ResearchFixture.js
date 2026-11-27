// Research-only production-shaped v6 fixture runner. Pure: no journal,
// no disk reads/writes, no execution. Mirrors production Phase2 causal path
// for subsequent immutable evidence calibration; does not replay original data.
import {buildEngine3V6Phase2Evidence} from "./buildEngine3V6Phase2Evidence.js";
import {buildEngine3V6CausalControl} from "./buildEngine3V6CausalControl.js";
import {buildEngine3V6Phase1Shadow} from "./buildEngine3V6Phase1Shadow.js";
import {buildEngine3V6ResearchTrace} from "./buildEngine3V6ResearchTrace.js";
import {inspectEngine26AuthorizationContract} from "./inspectEngine26AuthorizationContract.js";

export function runEngine3V6ResearchFixture({
 normalizedZoneInput=null,engine26LocationCandidate=null,engine26ReactionHandoff=null,
 bars1m=[],bars5m=[],evaluationTimeMs=null,priorShadow=null,v5=null,
 policy=null,
}={}){
 const candidateId=engine26LocationCandidate?.candidateId??null;
 const zoneId=engine26LocationCandidate?.zoneId??null;
 const common={
  priorActivation:priorShadow?.phase2ActivationRun??null,
  candidateId,zoneId,eligible:normalizedZoneInput?.eligible===true,
  authorizedStartedAt:engine26ReactionHandoff?.engine3AuthorizationStartedAt??
    engine26LocationCandidate?.engine3AuthorizationStartedAt??null,
  zone:normalizedZoneInput?.zone??null,bars1m,bars5m,evaluationTimeMs,
  policy:{wideMultiplier:2,bandFraction:0.25,bandFloorPoints:1,
    atrPeriod:14,observedUncertaintyMs:180000,...policy?.geometry},
 };
 const priorDirection=priorShadow?.canonicalDirection??"NEUTRAL";
 const held=["LONG","SHORT"].includes(priorDirection)&&
   priorShadow?.convictionState!=="INVALIDATED";
 const filter=buildEngine3V6Phase2Evidence({
  ...common,
  observedDirection:held?priorDirection:"NEUTRAL",
  priorReactionAnchor:held?priorShadow?.phase2ReactionAnchor:null,
  priorAnchorDirection:held?priorShadow?.phase2AnchorDirection:null,
  priorReactionSite:held?priorShadow?.phase2ReactionSite:null,
 });
 const causal=buildEngine3V6CausalControl({
  phase2Evidence:filter,normalizedZoneInput,evaluationTimeMs,
 });
 const observed=held?priorDirection:causal.qualified?causal.observedDirection:"NEUTRAL";
 const evidence=buildEngine3V6Phase2Evidence({
  ...common,observedDirection:observed,
  priorReactionAnchor:held?priorShadow?.phase2ReactionAnchor:null,
  priorAnchorDirection:held?priorShadow?.phase2AnchorDirection:null,
  priorReactionSite:held?priorShadow?.phase2ReactionSite:null,
  progressExtreme:priorShadow?.progressExtreme??null,
  establishingNow:causal.qualified&&!held,
 });
 const shadow=buildEngine3V6Phase1Shadow({
  priorState:priorShadow,v5,causalControl:causal,phase2Evidence:evidence,
  candidateId,zoneId,bars1m,bars5m,evaluationTimeMs,
  policy:{invalidationCloses1m:2,deteriorationEvidenceCount:2,
    deteriorationTimeoutMs:720000,...policy?.stability},
  // No Engine10 lock in an offline fixture; never infer it from a v5 result.
  openTradeActive:false,lockedTradeDirection:"NEUTRAL",
 });
 const readiness=inspectEngine26AuthorizationContract({
  handoff:engine26ReactionHandoff,candidate:engine26LocationCandidate,
  normalizedZoneInput,evaluationTimeMs,
  priorActivation:priorShadow?.phase2ActivationRun??null,
 });
 const trace=buildEngine3V6ResearchTrace({
  evaluationTimeMs,shadow,priorShadow,phase2Evidence:evidence,
  phase2Causal:causal,engine26:engine26ReactionHandoff,
 });
 return {
  schema:"engine3.v6.phase3ResearchFixture.v1",mode:"READ_ONLY_FIXTURE",
  readiness,causal,evidence,shadow,trace,
  nextShadowState:{...shadow,phase2ActivationRun:evidence.activationRun,
   phase2ReactionAnchor:shadow.invalidatedNow?null:evidence.reactionAnchor,
   phase2AnchorDirection:shadow.invalidatedNow?null:evidence.anchorDirection,
   phase2ReactionSite:shadow.invalidatedNow?null:evidence.reactionSite},
  noPermissionCreated:true,noExecution:true,recordingActivated:false,
 };
}
export default runEngine3V6ResearchFixture;
