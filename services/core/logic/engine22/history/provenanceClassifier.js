// Engine 22E T1.1 — Pure provenance classification, never an activation decision.
export const ENGINE22_PROVENANCE_CLASSES = Object.freeze([
  "VERIFIED_HISTORICAL", "OWNER_WORKING", "IMPORTED_UNRESOLVED", "SYNTHETIC_V3_SHADOW",
]);
const validText = value => typeof value === "string" && value.trim().length > 0;
export function isSyntheticV3Identity(countId) {
  return validText(countId) && /^ES-V3-BASELINE-/i.test(countId.trim());
}
export function classifyEngine22Provenance(record) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return { valid: false, classification: "IMPORTED_UNRESOLVED", reasonCodes: ["RECORD_REQUIRED"] };
  const p = record.provenance;
  if (!p || typeof p !== "object" || Array.isArray(p))
    return { valid: false, classification: "IMPORTED_UNRESOLVED", reasonCodes: ["PROVENANCE_REQUIRED"] };
  if (isSyntheticV3Identity(record.countId) || p.historicalMigration === "DEFERRED" ||
      p.source === "OWNER_V3_BASELINE")
    return { valid: true, classification: "SYNTHETIC_V3_SHADOW", reasonCodes: ["SYNTHETIC_ID_OR_UNMIGRATED_V3"] };
  if (p.status === "VERIFIED_HISTORICAL") {
    if (!validText(record.countId) || !validText(p.sourceId) || !validText(p.sourceHash) ||
        !validText(p.evidenceRef))
      return { valid: false, classification: "IMPORTED_UNRESOLVED", reasonCodes: ["HISTORICAL_PROOF_INCOMPLETE"] };
    return { valid: true, classification: "VERIFIED_HISTORICAL", reasonCodes: [] };
  }
  if (p.status === "OWNER_WORKING" && validText(record.modelVersion) && validText(p.ownerApprovalRef))
    return { valid: true, classification: "OWNER_WORKING", reasonCodes: [] };
  return { valid: true, classification: "IMPORTED_UNRESOLVED", reasonCodes: ["INSUFFICIENT_PROVENANCE_FOR_VERIFICATION"] };
}
