// Engine 22 V3 — single canonical seven-degree structural state contract.
// Pure validation and projection helpers. No I/O, snapshot wiring, or trading authority.
export const ENGINE22_V3_SCHEMA = "engine22.canonicalStructure.v3";
export const ENGINE22_V3_DEGREES = Object.freeze([
  "INTRADAY_SUBMICRO", "MICRO", "SUBMINUTE", "MINUTE",
  "MINOR", "INTERMEDIATE", "PRIMARY",
]);
export const ENGINE22_V3_PARENT = Object.freeze({
  INTRADAY_SUBMICRO: "MICRO", MICRO: "SUBMINUTE", SUBMINUTE: "MINUTE",
  MINUTE: "MINOR", MINOR: "INTERMEDIATE", INTERMEDIATE: "PRIMARY", PRIMARY: null,
});
export const ENGINE22_V3_WAVES = Object.freeze(["W1","W2","W3","W4","W5"]);
export const ENGINE22_V3_ANCHOR_STATES = Object.freeze([
  "UNKNOWN", "DEVELOPING", "COMPLETION_CANDIDATE", "CONFIRMED",
  "LOCKED", "INVALIDATED", "RECOUNT_REQUIRED",
]);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validPrice = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const nonblank = value => typeof value === "string" && value.trim().length > 0;
export function validateEngine22V3Canonical(state) {
  const errors = [];
  if (!record(state) || state.schema !== ENGINE22_V3_SCHEMA) {
    return { ok: false, errors: ["INVALID_V3_CANONICAL_SCHEMA"] };
  }
  if (state.symbol !== "ES") errors.push("UNSUPPORTED_SYMBOL");
  if (!record(state.degrees)) errors.push("DEGREES_REQUIRED");
  const degrees = record(state.degrees) ? state.degrees : {};
  for (const degree of ENGINE22_V3_DEGREES) {
    const count = degrees[degree];
    if (!record(count)) { errors.push(degree + "_MISSING"); continue; }
    if (count.degreeId !== degree) errors.push(degree + "_IDENTITY_MISMATCH");
    if (count.parentDegree !== ENGINE22_V3_PARENT[degree]) errors.push(degree + "_PARENT_MISMATCH");
    if (!nonblank(count.countId) || !nonblank(count.sequenceId)) errors.push(degree + "_COUNT_IDENTITY_REQUIRED");
    if (count.parentDegree && !nonblank(count.parentWave)) errors.push(degree + "_PARENT_WAVE_REQUIRED");
    if (count.activeWave !== null && !ENGINE22_V3_WAVES.includes(count.activeWave))
      errors.push(degree + "_ACTIVE_WAVE_INVALID");
    if (!record(count.anchors) || !record(count.history) && !Array.isArray(count.history))
      errors.push(degree + "_ANCHORS_OR_HISTORY_INVALID");
    if (!Array.isArray(count.history)) errors.push(degree + "_HISTORY_REQUIRED");
    if (!record(count.provenance)) errors.push(degree + "_PROVENANCE_REQUIRED");
    if (!record(count.invalidation)) errors.push(degree + "_INVALIDATION_REQUIRED");
    if (!record(count.fibModel)) errors.push(degree + "_FIB_MODEL_REQUIRED");
    if (!nonblank(count.lifecycle)) errors.push(degree + "_LIFECYCLE_REQUIRED");
    if (record(count.anchors)) {
      for (const [key, anchor] of Object.entries(count.anchors)) {
        if (!record(anchor) || !ENGINE22_V3_ANCHOR_STATES.includes(anchor.status))
          { errors.push(degree + "_ANCHOR_STATE_" + key); continue; }
        if (anchor.price !== null && !validPrice(anchor.price)) errors.push(degree + "_ANCHOR_PRICE_" + key);
        if (anchor.price === null && anchor.time !== null) errors.push(degree + "_TIME_WITHOUT_PRICE_" + key);
        if (anchor.price !== null && !nonblank(anchor.time)) errors.push(degree + "_PRICE_WITHOUT_TIME_" + key);
        if (anchor.status === "LOCKED" && !nonblank(anchor.lockApprovalId))
          errors.push(degree + "_LOCK_PROVENANCE_" + key);
      }
    }
  }
  const countIds = ENGINE22_V3_DEGREES.map(d => degrees[d]?.countId).filter(nonblank);
  const sequenceIds = ENGINE22_V3_DEGREES.map(d => degrees[d]?.sequenceId).filter(nonblank);
  if (new Set(countIds).size !== countIds.length) errors.push("DUPLICATE_COUNT_ID");
  if (new Set(sequenceIds).size !== sequenceIds.length) errors.push("DUPLICATE_SEQUENCE_ID");
  if (Object.keys(degrees).some(k => !ENGINE22_V3_DEGREES.includes(k))) errors.push("UNKNOWN_DEGREE");
  if (state.noPermissionCreated !== true || state.noExecution !== true)
    errors.push("STRUCTURAL_AUTHORITY_ONLY");
  return { ok: errors.length === 0, errors };
}
// A locked anchor may only change through a separately approved recount workflow.
// This function validates; it does not perform or approve recounts.
export function validateEngine22V3Transition(before, after, { approvedRecountIds = [] } = {}) {
  const current = validateEngine22V3Canonical(before);
  const next = validateEngine22V3Canonical(after);
  const errors = [...current.errors.map(e => "BEFORE_" + e), ...next.errors.map(e => "AFTER_" + e)];
  if (!current.ok || !next.ok) return {ok:false,errors};
  if (after.symbol !== before.symbol) errors.push("SYMBOL_CHANGED");
  for (const d of ENGINE22_V3_DEGREES) {
    const oldCount = before.degrees[d], newCount = after.degrees[d];
    const changedCount = oldCount.countId !== newCount.countId;
    const approved = changedCount && approvedRecountIds.includes(newCount.provenance?.managerApprovalId);
    if (changedCount && !approved) errors.push(d + "_UNAUTHORIZED_RECOUNT");
    for (const [key,oldAnchor] of Object.entries(oldCount.anchors)) {
      if (oldAnchor?.status !== "LOCKED") continue;
      const newer = newCount.anchors[key];
      if ((!newer || newer.price !== oldAnchor.price || newer.time !== oldAnchor.time
          || newer.status !== "LOCKED") && !approved)
        errors.push(d + "_LOCKED_ANCHOR_CHANGED_" + key);
    }
    if (newCount.history.length < oldCount.history.length) errors.push(d + "_HISTORY_TRUNCATED");
  }
  return {ok:errors.length===0,errors};
}
export function buildEngine22V3DegreeProjection(state) {
  const gate = validateEngine22V3Canonical(state);
  if (!gate.ok) return {available:false,reasonCodes:gate.errors};
  const degrees = Object.fromEntries(ENGINE22_V3_DEGREES.map(degree => {
    const c=state.degrees[degree];
    return [degree.toLowerCase(), {
      degree, sourceCountId:c.countId, sequenceId:c.sequenceId,
      parentDegree:c.parentDegree, parentWave:c.parentWave,
      activeWave:c.activeWave, lifecycle:c.lifecycle, anchors:structuredClone(c.anchors),
      invalidation:structuredClone(c.invalidation), fibModel:structuredClone(c.fibModel),
      sourceTimestamp:state.sourceTimestamp ?? null,
    }];
  }));
  return {available:true,sourceSchema:ENGINE22_V3_SCHEMA,degrees,
    noPermissionCreated:true,noExecution:true,automationEligible:false};
}
