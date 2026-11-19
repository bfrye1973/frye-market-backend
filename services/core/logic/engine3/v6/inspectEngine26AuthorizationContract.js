// Phase3 preparation only: validate Engine26-owned authorization metadata.
// No synthetic history, no rescoring, no trade authority.
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

 // Engine3 may only call the Engine26 timestamp authoritative when Engine26
 // explicitly proves that its source state is ready, storage is healthy, and
 // the current continuity record was durably persisted/read back.
 const sourceReady=
   handoff?.engine3AuthorizationSourceReady===true;
 const storageHealthy=
   handoff?.engine3AuthorizationStorageHealthy===true;
 const persisted=
   handoff?.engine3AuthorizationPersisted===true;
 const persistenceMode=
   handoff?.engine3AuthorizationPersistenceMode??null;
 const persistenceModeValid=persistenceMode==="PERSISTENT_MONOTONIC";
 const sourceHealthValid=
   sourceReady&&storageHealthy&&persisted&&persistenceModeValid;

 const sourceAsOf=milliseconds(
   handoff?.engine3AuthorizationSourceAsOf??
   candidate?.engine3AuthorizationSourceAsOf??
   null
 );
 const sourceAsOfFuture=
   sourceAsOf!==null&&at!==null&&sourceAsOf>at;
 const sourceAsOfBeforeAuthorization=
   sourceAsOf!==null&&published!==null&&sourceAsOf<published;

 const valid=active&&published!==null&&at!==null&&!after&&!conflict&&
   !continuityChanged&&sourceHealthValid&&!sourceAsOfFuture&&
   !sourceAsOfBeforeAuthorization;
 return {
  schema:"engine3.v6.engine26AuthorizationReadiness.v2",mode:"SHADOW_DIAGNOSTIC_ONLY",
  candidateId,zoneId,evaluationTimeMs:at,
  status:valid?"AUTHORITATIVE_TIMESTAMP_VALID":
   !active?"AUTHORIZATION_NOT_ELIGIBLE":
   raw==null?"FIELD_NOT_YET_PUBLISHED":
   !sourceReady?"ENGINE26_SOURCE_NOT_READY":
   !storageHealthy?"ENGINE26_STORAGE_UNHEALTHY":
   !persisted?"ENGINE26_AUTHORIZATION_NOT_PERSISTED":
   !persistenceModeValid?"ENGINE26_PERSISTENCE_MODE_UNVERIFIED":
   sourceAsOfBeforeAuthorization?"ENGINE26_SOURCE_ASOF_BEFORE_AUTHORIZATION":
   sourceAsOfFuture?"ENGINE26_SOURCE_ASOF_IN_FUTURE":
   conflict?"ENGINE26_SOURCE_TIMESTAMP_CONFLICT":
   after?"AUTHORIZATION_TIMESTAMP_IN_FUTURE":
   continuityChanged?"ENGINE26_CONTINUITY_CHANGED_WITHOUT_RUN_RESET":
   "ENGINE26_SOURCE_TIME_UNVERIFIED",
  authoritativeTimestampMs:valid?published:null,
  observedFallbackAllowed:active&&!valid,
  sourceHealth:{
   sourceReady,storageHealthy,persisted,
   storageStatus:handoff?.engine3AuthorizationStorageStatus??null,
   persistenceMode,
   sourceAsOfTimeMs:sourceAsOf,
  },
  externalOwner:"ENGINE26",
  candidateLifecycleStartTimeAccepted:false,
  noDirectionAuthority:true,noPermissionCreated:true,
 };
}
export default inspectEngine26AuthorizationContract;
