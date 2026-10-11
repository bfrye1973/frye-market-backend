// Engine 22 V3: read-only canonical import preflight. Never fabricates missing
// degree counts, publishes partial structure, or modifies the legacy source.
import { ENGINE22_V3_DEGREES, ENGINE22_V3_PARENT,
  ENGINE22_V3_SCHEMA, validateEngine22V3Canonical } from "./canonicalStructure.js";
const clone = x => structuredClone(x);
const str = x => typeof x === "string" ? x.trim() : "";
const degreeKey = d => d.toLowerCase();
export function preflightEngine22V3Migration({
  activeWaveState = null,
  micro = null,
  submicro = null,
  degreeIdentities = {},
  parentWaves = {},
  sourceTimestamp = null,
} = {}) {
  const blockers = [];
  if (activeWaveState?.symbol !== "ES" ||
    !activeWaveState.activeStructures || typeof activeWaveState.activeStructures !== "object")
    return { ready:false, blockers:["INVALID_ACTIVE_WAVE_SOURCE"], canonical:null };
  const legacy = activeWaveState.activeStructures;
  const degrees = {};
  for (const degree of ENGINE22_V3_DEGREES) {
    const source = degree === "MICRO" ? micro :
      degree === "INTRADAY_SUBMICRO" ? submicro : legacy[degreeKey(degree)];
    if (!source || typeof source !== "object") {
      blockers.push(degree + "_CANONICAL_SOURCE_MISSING");
      continue;
    }
    if (degree === "INTRADAY_SUBMICRO" && source.schema === "engine22.v3.migrationCandidate.v1") {
      if (source.degreeId !== "INTRADAY_SUBMICRO" ||
          source.parentDegree !== "MICRO" ||
          !str(source.managerApprovalId) ||
          source.priorIdentity?.degreeId !== "MICRO" ||
          source.newIdentity?.countId !== source.countId ||
          source.newIdentity?.sequenceId !== source.sequenceId ||
          source.publicationEligible !== false)
        blockers.push("SUBMICRO_MIGRATION_PROVENANCE_INVALID");
    }
    const identity = degreeIdentities[degree] || {};
    if (degree === "INTRADAY_SUBMICRO" && source.countId && identity.countId && source.countId !== identity.countId)
      blockers.push("SUBMICRO_MIGRATED_COUNT_ID_MISMATCH");
    if (!str(identity.countId) || !str(identity.sequenceId))
      blockers.push(degree + "_IDENTITY_UNRESOLVED");
    const parent = ENGINE22_V3_PARENT[degree];
    const parentWave = parent ? parentWaves[degree] : null;
    if (parent && !str(parentWave)) blockers.push(degree + "_PARENT_WAVE_UNRESOLVED");
    // Do not synthesize structural anchors from projections or timestamp-less marks.
    const legacyManualDegree = degree !== "MICRO" && degree !== "INTRADAY_SUBMICRO";
    const sourcedHistory=degree==="INTRADAY_SUBMICRO" && source.schema==="engine22.v3.migrationCandidate.v1"
      ? source.preservedHistory : source.history;
    if ((!Array.isArray(sourcedHistory) || sourcedHistory.length === 0) && !legacyManualDegree)
      blockers.push(degree + "_HISTORY_SOURCE_REQUIRED");
    if (sourcedHistory?.some(event => event == null || typeof event !== "object"))
      blockers.push(degree + "_HISTORY_INVALID");
    const raw = source.anchors ?? source.marks ?? source.preservedAnchors ?? {};
    if (degree === "INTRADAY_SUBMICRO" && source.schema === "engine22.v3.migrationCandidate.v1" &&
        Object.values(raw).some(w => w && typeof w === "object" &&
          w.price === undefined && !w.low && !w.high))
      blockers.push("SUBMICRO_WAVE_RECORD_CONVERSION_REQUIRED");
    if (degree === "MICRO" && !str(source.provenance?.managerApprovalId) &&
        !str(source.managerApprovalId))
      blockers.push("LARGER_MICRO_OWNER_ANCHOR_APPROVAL_REQUIRED");
    const anchors = {};
    for (const [wave, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object") continue;
      if (value.status === "LOCKED" && !str(value.lockApprovalId))
        blockers.push(degree + "_LOCK_PROVENANCE_MISSING_" + wave);
      if (value.price !== undefined) {
        anchors[wave] = {
          price:value.price ?? null,time:value.time ?? null,
          status:value.status === "LOCKED" ? "LOCKED" :
            value.status === "CONFIRMED" ? "CONFIRMED" : "DEVELOPING",
          ...(value.status === "LOCKED" ? {lockApprovalId:value.lockApprovalId ?? null} : {}),
        };
      } else if (value.low || value.high) {
        for (const side of ["low","high"]) {
          if (!value[side]) continue;
          if (value.status === "LOCKED" && !str(value.lockApprovalId))
            blockers.push(degree + "_LOCK_PROVENANCE_MISSING_" + wave + "_" + side.toUpperCase());
          anchors[wave+"_"+side.toUpperCase()] = {
            price:value[side].price ?? null,time:value[side].time ?? null,
            status:value.status === "LOCKED" ? "LOCKED" :
              value.status === "CONFIRMED" ? "CONFIRMED" : "DEVELOPING",
            ...(value.status === "LOCKED" ? {lockApprovalId:value.lockApprovalId} : {}),
          };
        }
      }
    }
    degrees[degree] = {
      degreeId:degree,countId:identity.countId ?? null,sequenceId:identity.sequenceId ?? null,
      parentDegree:parent,parentWave:parentWave || null,
      activeWave:source.activeWave ?? null,
      lifecycle:source.lifecycle ?? source.stage ?? "DEVELOPING",
      anchors,
      history:Array.isArray(sourcedHistory) ? clone(sourcedHistory) :
        [{
          event:"LEGACY_SOURCE_BASELINE_IMPORTED",
          source:"ACTIVE_WAVE_STATE_ES",
          sourceUpdatedAt:activeWaveState.updatedAt ?? null,
          importedAt:sourceTimestamp,
          originalDegree:degree,
          // A snapshot at migration is not claimed to be historical transition evidence.
          historicalTransitionsKnown:false,
          legacySourceSnapshot:clone(source),
        }],
      provenance:{
        originalDegree:degree,source:degree === "MICRO" ? "OWNER_REVIEW_MICRO" :
          degree === "INTRADAY_SUBMICRO" ? "APPROVED_LEGACY_MIGRATION" :
          "ACTIVE_WAVE_STATE_ES",
        priorStateSchema:activeWaveState.schema,
        priorUpdatedAt:activeWaveState.updatedAt ?? null,
        priorCountId:source.priorIdentity?.countId ?? null,
        migrationApprovalId:source.managerApprovalId ?? null,
        migrationReason:source.migrationReason ?? null,
      },
      invalidation:clone(source.invalidation ?? {}),
      fibModel:{levels:[],source:"DERIVED_ONLY"},
      legacyStructure:clone(source),
    };
  }
  if (!str(sourceTimestamp)) blockers.push("SOURCE_TIMESTAMP_REQUIRED");
  if (blockers.length) return {ready:false,blockers,canonical:null};
  const canonical={
    schema:ENGINE22_V3_SCHEMA,symbol:"ES",sourceTimestamp,
    noPermissionCreated:true,noExecution:true,degrees,
  };
  const validation=validateEngine22V3Canonical(canonical);
  if (!validation.ok) return {ready:false,blockers:validation.errors,canonical:null};
  return {ready:true,blockers:[],canonical};
}
