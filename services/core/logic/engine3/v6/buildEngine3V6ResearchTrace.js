// Engine3 v6 Phase3: bounded point-in-time explanation only.
// Source truth remains the Phase2 shadow state and the separately verified
// Engine26 activation contract; this module cannot create/alter decisions.
const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const string=x=>typeof x==="string"&&x.trim()?x:null;
const labels=(xs,limit=32)=>[...new Set((Array.isArray(xs)?xs:[])
 .filter(x=>typeof x==="string"&&x.length<=128))].slice(0,limit);
const safeDirection=d=>["LONG","SHORT","NEUTRAL"].includes(d)?d:"NEUTRAL";
const evidenceSummary=x=>({
  controlState:string(x?.controlState)??"NO_CONTROL",
  quality:string(x?.quality)??"WEAK",
  controlGeometrySource:string(x?.controlGeometrySource)??"UNAVAILABLE",
  qualified:x?.qualified===true,
});
export function buildEngine3V6ResearchTrace({
 evaluationTimeMs=null,symbol="ES",strategyId="intraday_scalp@10m",
 priorShadow=null,shadow=null,phase2Evidence=null,phase2Causal=null,
 engine26=null,engine22Alignment=null,phase1Comparison=null,
}={}){
 const evaluation=num(evaluationTimeMs);
 const valid=evaluation!==null&&symbol==="ES"&&strategyId==="intraday_scalp@10m"&&
   shadow?.mode==="SHADOW_READ_ONLY"&&shadow?.noPermissionCreated===true&&
   shadow?.authoritativeDownstream===false;
 const site=phase2Evidence?.reactionSite;
 const source=phase2Causal?.controlGeometrySource;
 const first=phase2Evidence?.activationStartedAtMs;
 const start=num(first);
 const reasons=labels([
  ...(shadow?.reasonCodes??[]),
  ...(phase2Evidence?.reasonCodes??[]),
  ...(phase2Causal?.reasonCodes??[]),
  !valid?"RESEARCH_TRACE_INPUT_UNVERIFIED":null,
  start!==null&&evaluation!==null&&start>evaluation?"ACTIVATION_AFTER_EVALUATION_BLOCKED":null,
  phase2Evidence?.activationSource==="ENGINE3_OBSERVED"?
    "ENGINE3_ACTIVATION_OBSERVED_SHADOW_ONLY":null,
  phase2Causal?.controlGeometryEligible!==true?"CAUSAL_CONTROL_GEOMETRY_NOT_ELIGIBLE":null,
 ].filter(Boolean),48);
 const priorDirection=safeDirection(priorShadow?.canonicalDirection);
 const currentDirection=safeDirection(shadow?.canonicalDirection);
 const transition=shadow?.invalidatedNow===true?"INVALIDATION":
  shadow?.establishedNow===true?"ESTABLISHMENT":
  priorDirection===currentDirection?"HOLD":"OBSERVED_DIRECTION_CHANGE";
 return {
  ok:valid,mode:"SHADOW_READ_ONLY",
  schema:"engine3.v6.researchTrace.v1",
  evaluationTimeMs:evaluation,symbol,strategyId,
  candidateId:string(phase2Evidence?.candidateId)??null,
  zoneId:string(phase2Evidence?.zoneId)??null,
  priorDirection,currentDirection,convictionState:string(shadow?.convictionState)??null,
  transition,reasonCodes:reasons,
  activation:{
   source:string(phase2Evidence?.activationSource)??"UNAVAILABLE",
   startedAtMs:start,uncertaintyMs:num(phase2Evidence?.activationUncertaintyMs),
   postActivation1m:phase2Evidence?.completed1mEligible?.length??0,
   postActivation5m:phase2Evidence?.completed5mEligible?.length??0,
   preActivation1m:phase2Evidence?.preActivation1mCount??0,
   preActivation5m:phase2Evidence?.preActivation5mCount??0,
   upstreamAuthorizationStartedAt:engine26?.engine3AuthorizationStartedAt??null,
  },
  reaction:{
   site:string(site)??"UNRESOLVED",anchor:num(phase2Evidence?.reactionAnchor),
   anchorDirection:string(phase2Evidence?.anchorDirection),
   anchorSource:string(phase2Evidence?.anchorSource)??"UNAVAILABLE",
   geometrySource:string(source)??"UNAVAILABLE",
   engine26Zone:phase2Causal?.engine26Zone??null,
   controlLens:phase2Causal?.engine3ControlLens??null,
   frozenAtr5m:num(phase2Evidence?.geometry?.frozenAtr5m),
  },
  control:evidenceSummary({...phase2Causal?.control,
   controlGeometrySource:source,qualified:phase2Causal?.qualified}),
  barEvidenceSource:"STRICT_POST_ACTIVATION_COMPLETED_ONLY",
  warnings:{
   adverseWarning:phase2Evidence?.adverseWarning===true,
   anchorThreatened:phase2Evidence?.anchorThreatened===true,
   warningHasDirectionAuthority:false,
  },
  deterioration:{
   state:string(shadow?.convictionState)??null,
   votes:Math.max(0,Math.min(4,Number(shadow?.deteriorationEvidenceVotes)||0)),
   timeoutExceeded:shadow?.deteriorationResearch?.timeoutExceeded===true,
   timeoutHasInvalidationAuthority:false,
  },
  structuralAlignment:{
   state:string(engine22Alignment?.alignmentState)??"NO_STRUCTURAL_CONTEXT",
   authority:"DIAGNOSTIC_ONLY",
  },
  comparison:{
   v5Direction:safeDirection(phase1Comparison?.v5CanonicalDirection),
   phase1Direction:safeDirection(phase1Comparison?.canonicalDirection),
   phase2Direction:currentDirection,
  },
  noPermissionCreated:true,noExecution:true,authoritativeDownstream:false,
 };
}
export default buildEngine3V6ResearchTrace;
