// Engine 22E T1.1 — PURE validation contract. No state writes or authority promotion.
import { ENGINE22_V3_DEGREES, ENGINE22_V3_PARENT, validateEngine22V3Canonical } from "../v3/canonicalStructure.js";
import { classifyEngine22Provenance, isSyntheticV3Identity } from "./provenanceClassifier.js";

export const ENGINE22_HISTORY_CONTRACT_SCHEMA = "engine22.historyContract.v1";
export const ENGINE22_OWNER_MODELS_20261025 = Object.freeze({
  INTRADAY_SUBMICRO: "engine22.submicroCDownOwnerWatch.v1",
  MICRO: "engine22.microCDownOwnerWatch.v1",
  SUBMINUTE: "engine22.subminuteCurrentCDownReference.v1",
  MINUTE: "engine22.minuteW2RetracementOwner.v1",
  MINOR: "engine22.minorW5StructuralReference.v1",
  INTERMEDIATE: null,
  PRIMARY: null,
});
const hasText = v => typeof v === "string" && v.trim().length > 0;
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const unique = values => values.length === new Set(values).size;

// This checks proposed history records, NOT production count authority.
// Owner-selected models are a working baseline only, never fabricated canonical IDs.
export function validateEngine22HistoryRecord(record, { canonical = null } = {}) {
  const errors = [];
  if (!isObject(record) || record.schema !== ENGINE22_HISTORY_CONTRACT_SCHEMA)
    return { ok: false, errors: ["INVALID_HISTORY_CONTRACT"] };
  if (record.instrument !== "ES") errors.push("UNSUPPORTED_INSTRUMENT");
  if (!ENGINE22_V3_DEGREES.includes(record.degree)) errors.push("UNKNOWN_DEGREE");
  const expectedParent = ENGINE22_V3_PARENT[record.degree];
  if (expectedParent !== undefined && record.parentDegree !== expectedParent)
    errors.push("PARENT_DEGREE_MISMATCH");
  if (!hasText(record.modelVersion)) errors.push("MODEL_VERSION_REQUIRED");
  if (!hasText(record.sourceTimestamp)) errors.push("SOURCE_TIMESTAMP_REQUIRED");
  else if (!Number.isFinite(Date.parse(record.sourceTimestamp)) || !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(record.sourceTimestamp))
    errors.push("TIMESTAMP_MUST_BE_OFFSET_AWARE");
  if (!isObject(record.provenance)) errors.push("PROVENANCE_REQUIRED");
  const classification = classifyEngine22Provenance(record);
  if (!classification.valid) errors.push(...classification.reasonCodes);
  if (record.verifiedHistorical === true && classification.classification !== "VERIFIED_HISTORICAL")
    errors.push("UNVERIFIED_CANNOT_CLAIM_HISTORY");
  if (record.activationEligible === true && classification.classification !== "VERIFIED_HISTORICAL")
    errors.push("UNVERIFIED_CANNOT_ACTIVATE");
  if (record.activationEligible === true && !hasText(record.authorizationId))
    errors.push("ENGINE22G_AUTHORIZATION_REQUIRED");
  if (isSyntheticV3Identity(record.countId) && (record.activationEligible === true || record.verifiedHistorical === true))
    errors.push("SYNTHETIC_V3_ID_NOT_AUTHORITATIVE");
  if (canonical !== null) {
    const validation = validateEngine22V3Canonical(canonical);
    if (!validation.ok) errors.push(...validation.errors.map(e => "V3_" + e));
    if (canonical.symbol !== record.instrument) errors.push("CANONICAL_INSTRUMENT_MISMATCH");
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], classification: classification.classification };
}

export function validateEngine22OwnerWorkingSelection({ degree, modelVersion, proposedOverrideVersion = null } = {}) {
  if (!ENGINE22_V3_DEGREES.includes(degree))
    return { ok: false, reasonCodes: ["UNKNOWN_DEGREE"] };
  const expected = ENGINE22_OWNER_MODELS_20261025[degree];
  if (!expected)
    return { ok: true, reasonCodes: ["OWNER_SELECTION_REQUIRES_INDEPENDENT_VERIFICATION"], expectedVersion: null };
  if (modelVersion !== expected)
    return { ok: false, reasonCodes: ["APPROVED_OWNER_VERSION_MISMATCH"], expectedVersion: expected };
  if (proposedOverrideVersion !== null && proposedOverrideVersion !== expected)
    return { ok: false, reasonCodes: ["STALE_MODEL_CANNOT_OVERRIDE_OWNER"], expectedVersion: expected };
  return { ok: true, reasonCodes: ["APPROVED_WORKING_MODEL_MATCH"], expectedVersion: expected };
}

// Structural records must be unique, but this function cannot approve or write an active pointer.
export function validateEngine22SevenDegreeRegistryCandidate(records) {
  if (!Array.isArray(records)) return { ok: false, errors: ["RECORDS_ARRAY_REQUIRED"] };
  const errors = [];
  const degrees = records.map(r => r?.degree);
  if (records.length !== ENGINE22_V3_DEGREES.length || !unique(degrees) ||
      !ENGINE22_V3_DEGREES.every(d => degrees.includes(d)))
    errors.push("EXACTLY_ONE_RECORD_PER_DEGREE_REQUIRED");
  for (const r of records) {
    const result = validateEngine22HistoryRecord(r);
    if (!result.ok) errors.push(...result.errors.map(e => String(r?.degree ?? "UNKNOWN") + ":" + e));
  }
  return { ok: errors.length === 0, errors };
}
