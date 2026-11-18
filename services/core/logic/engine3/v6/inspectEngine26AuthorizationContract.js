// Phase3 preparation only: validate future Engine26-owned authorization metadata.
// No synthetic history, no rescoring, no change to the shadow's current fallback.
const milliseconds=x=>typeof x==="number"&&Number.isFinite(x)?x:
 typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const validId=x=>typeof x==="string"&&x.trim().length>0;
export function inspectEngine26AuthorizationContract({
 handoff=null,candidate=null,normalizedZoneInput=null,
 evaluationTimeMs=null,priorActivation=null,
}={}){
 const at=milliseconds(evaluationTimeMs);
 const candidateId=candidate?.candidateId??handoff?.candidateId??null;
 const zoneId=candidate?.zoneId??handoff?.zoneId??null;
 const active=normalizedZoneInput?.eligible===true&&
  handoff?.authorizeEngine3Evaluation===true&&
  handoff?.terminalLifecycle!==true&&
  validId(candidateId)&&validId(zoneId)&&
  normalizedZoneInput?.identity?.candidateId===candidateId&&
  normalizedZoneInput?.identity?.zoneId===zoneId;
 const raw=handoff?.engine3AuthorizationStartedAt??candidate?.engine3AuthorizationStartedAt??null;
 const published=milliseconds(raw);
 const selectedCandidate=handoff?.engine3AuthorizationStartedAt??null;
 const selectedLocation=candidate?.engine3AuthorizationStartedAt??null;
 const conflict=selectedCandidate!=null&&selectedLocation!=null&&
   milliseconds(selectedCandidate)!==milliseconds(selectedLocation);
 const after=published!==null&&at!==null&&published>at;
 const prior=priorActivation?.active===true&&
   priorActivation?.candidateId===candidateId&&priorActivation?.zoneId===zoneId;
 const continuityChanged=prior&&priorActivation?.source==="ENGINE26_AUTHORIZED"&&
   published!==null&&published!==priorActivation.startedAtMs;
 const valid=active&&published!==null&&at!==null&&!after&&!conflict&&!continuityChanged;
 return {
  schema:"engine3.v6.engine26AuthorizationReadiness.v1",mode:"SHADOW_DIAGNOSTIC_ONLY",
  candidateId,zoneId,evaluationTimeMs:at,
  status:valid?"AUTHORITATIVE_TIMESTAMP_VALID":
   !active?"AUTHORIZATION_NOT_ELIGIBLE":
   raw==null?"FIELD_NOT_YET_PUBLISHED":
   conflict?"ENGINE26_SOURCE_TIMESTAMP_CONFLICT":
   after?"AUTHORIZATION_TIMESTAMP_IN_FUTURE":
   continuityChanged?"ENGINE26_CONTINUITY_CHANGED_WITHOUT_RUN_RESET":
   "ENGINE26_SOURCE_TIME_UNVERIFIED",
  authoritativeTimestampMs:valid?published:null,
  observedFallbackAllowed:active&&!valid,
  externalOwner:"ENGINE26",
  candidateLifecycleStartTimeAccepted:false,
  noDirectionAuthority:true,noPermissionCreated:true,
 };
}
export default inspectEngine26AuthorizationContract;
