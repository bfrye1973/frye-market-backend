// V3 Micro -> Intraday Submicro candidate. No writes or publication.
// Requires a separately reviewed legacy source and explicit migration approval ID.
const clone = x => structuredClone(x);
const str = x => typeof x === "string" ? x.trim() : "";
export function proposeEngine22V3SubmicroMigration({
  originalMicro = null, parentMicroCountId = null,
  managerApprovalId = null, migrationTimestamp = null,
  reason = "LEGACY_OPERATIONAL_MICRO_TO_INTRADAY_SUBMICRO",
} = {}) {
  const errors = [];
  if (!originalMicro || typeof originalMicro !== "object") errors.push("LEGACY_MICRO_REQUIRED");
  const sourceCountId = str(originalMicro?.countId);
  const sourceSequenceId = str(originalMicro?.sequenceId);
  if (!sourceCountId || !sourceSequenceId) errors.push("LEGACY_IDENTITY_REQUIRED");
  if (!str(parentMicroCountId)) errors.push("PARENT_MICRO_ID_REQUIRED");
  if (!str(managerApprovalId)) errors.push("MANAGER_APPROVAL_ID_REQUIRED");
  if (!str(migrationTimestamp)) errors.push("MIGRATION_TIMESTAMP_REQUIRED");
  if (!Array.isArray(originalMicro?.history) || originalMicro.history.length === 0) errors.push("LEGACY_HISTORY_REQUIRED");
  if (!originalMicro?.waves || typeof originalMicro.waves !== "object")
    errors.push("LEGACY_WAVES_REQUIRED");
  const waves=originalMicro?.waves;
  const preservedLocks={};
  if(waves && typeof waves==="object"){
    for(const [wave,record] of Object.entries(waves)){
      if(record?.lifecycle!=="LOCKED")continue;
      if(typeof record.lockedAnchor!=="number" || !Number.isFinite(record.lockedAnchor) ||
         record.lockedAnchor<=0 || !record.lockedAt){
        errors.push("LOCKED_WAVE_PROVENANCE_INCOMPLETE_"+wave);
      }else preservedLocks[wave]={
        lockedAnchor:record.lockedAnchor,lockedAt:record.lockedAt,
        completionEvidence:clone(record.completionEvidence ?? null),
        structuralEvidence:clone(record.structuralEvidence ?? null),
      };
    }
  }
  if (errors.length) return {ok:false,errors,candidate:null};
  const newCountId = "ES-SUBMICRO-FROM-" + sourceCountId;
  const newSequenceId = "ES-SUBMICRO-FROM-" + sourceSequenceId;
  if ([sourceCountId, str(parentMicroCountId)].includes(newCountId) ||
      sourceSequenceId === newSequenceId)
    return {ok:false,errors:["IDENTITY_COLLISION"],candidate:null};
  const candidate = {
    schema:"engine22.v3.migrationCandidate.v1",
    degreeId:"INTRADAY_SUBMICRO",
    countId:newCountId,sequenceId:newSequenceId,
    parentDegree:"MICRO",parentCountId:str(parentMicroCountId),
    parentWave:originalMicro.parentContext?.wave ?? null,
    migrationId:"ES-V3-SUBMICRO-FROM-"+sourceCountId,
    migrationReason:reason,migrationTimestamp,managerApprovalId,
    managerApprovalRequired:true,
    priorIdentity:{degreeId:"MICRO",countId:sourceCountId,sequenceId:sourceSequenceId,
      revision:originalMicro.revision ?? null,sourceTimestamp:originalMicro.sourceTimestamp ?? null},
    newIdentity:{degreeId:"INTRADAY_SUBMICRO",countId:newCountId,sequenceId:newSequenceId},
    preservedAnchors:clone(originalMicro.waves),
    preservedHistory:clone(originalMicro.history),
    preservedLocks:clone(preservedLocks),
    sourceProvenance:clone(originalMicro.sourceProvenance ?? originalMicro.parentContext ?? {}),
    publicationEligible:false,automationEligible:false,
    noExecution:true,noPermissionCreated:true,noSizing:true,
  };
  return {ok:true,errors:[],candidate};
}
