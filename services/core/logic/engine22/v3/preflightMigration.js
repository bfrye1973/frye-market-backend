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
    const identity = degreeIdentities[degree] || {};
    if (!str(identity.countId) || !str(identity.sequenceId))
      blockers.push(degree + "_IDENTITY_UNRESOLVED");
    const parent = ENGINE22_V3_PARENT[degree];
    const parentWave = parent ? parentWaves[degree] : null;
    if (parent && !str(parentWave)) blockers.push(degree + "_PARENT_WAVE_UNRESOLVED");
    // Do not synthesize structural anchors from projections or timestamp-less marks.
    const legacyManualDegree = degree !== "MICRO" && degree !== "INTRADAY_SUBMICRO";
    if (!Array.isArray(source.history) && !legacyManualDegree)
      blockers.push(degree + "_HISTORY_SOURCE_REQUIRED");
    if (source.history?.some(event => event == null || typeof event !== "object"))
      blockers.push(degree + "_HISTORY_INVALID");
    const raw = source.anchors ?? source.marks ?? {};
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
      history:Array.isArray(source.history) ? clone(source.history) :
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
