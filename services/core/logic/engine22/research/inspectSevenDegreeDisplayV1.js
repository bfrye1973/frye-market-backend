// Engine 22 seven-degree display contract proposal, V1 — research only.
// Additive, no runtime import. Engine 22 is authority; Engine 27 and frontend read only.
// This module MUST NOT synthesize or update touch events, wave counts or Fibonacci levels.
export const ENGINE22_SEVEN_DEGREES = Object.freeze([
  "submicro", "micro", "subminute", "minute",
  "minor", "intermediate", "primary",
]);

const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const string = value => typeof value === "string" && value.trim() ? value.trim() : null;
const finite = value => typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Normalizes one Engine22-sourced level for display ONLY.
 * Does not infer that price touching a number validates a structural event.
 * Historical "TOUCHED" is allowed ONLY when explicitly published with evidence
 * and a sourceCountId/modelKey/seriesId identifying the observation's model.
 */
export function inspectSevenDegreeDisplay({degrees = {}, source = "ENGINE22"} = {}) {
  const input = asObject(degrees) || {};
  return {
    schema: "engine22.sevenDegreeDisplayResearch.v1",
    scope: "SHADOW_RESEARCH_ONLY",
    source,
    noExecution: true,
    noCanonicalPromotion: true,
    degrees: Object.fromEntries(ENGINE22_SEVEN_DEGREES.map(degree => {
      const item = asObject(input[degree]);
      if (!item) return [degree, {
        degree, available: false, reasonCodes: ["DEGREE_UNAVAILABLE"], levels: [],
      }];
      const rawLevels = Array.isArray(item.levels) ? item.levels : [];
      const levels = rawLevels.map((level, index) => {
        const obj = asObject(level);
        if (!obj || finite(obj.price) === null) return null;
        const evidence = asObject(obj.touchEvidence);
        const modelKey = string(obj.modelKey) || string(item.modelKey);
        const countId = string(obj.sourceCountId) || string(item.sourceCountId);
        const seriesId = string(obj.seriesId) || string(item.seriesId);
        const observedAt = string(evidence?.sourceTimestamp) || string(obj.firstTouchedAt);
        const barId = string(evidence?.sourceBarId) || string(obj.firstTouchedBarId);
        const verified = obj.status === "TOUCHED" && Boolean(
          modelKey && countId && seriesId && observedAt && barId &&
          item.touchEvidenceAvailable === true
        );
        return {
          key: string(obj.key) || `level_${index}`,
          price: obj.price,
          label: string(obj.label) || string(obj.key) || "Level",
          status: verified ? "TOUCHED" : "WATCH",
          reportedStatus: string(obj.status) || "UNKNOWN",
          evidenceStatus: verified ? "VERIFIED_PUBLISHED_TOUCH" :
            obj.status === "TOUCHED" ? "REPORTED_TOUCH_UNVERIFIED" : "NOT_TOUCHED_OR_NOT_VERIFIED",
          modelKey, sourceCountId: countId, seriesId,
          firstTouchedAt: observedAt, firstTouchedBarId: barId,
        };
      }).filter(Boolean);
      const reasonCodes = [];
      if (!levels.length) reasonCodes.push("NO_PRICE_BEARING_LEVELS");
      if (item.provisional === true || item.anchorOnly === true)
        reasonCodes.push("PROVISIONAL_FIB_GEOMETRY");
      if (item.touchEvidenceAvailable !== true)
        reasonCodes.push("TOUCH_EVIDENCE_UNAVAILABLE");
      return [degree, {
        degree, available: true, activeWave: string(item.activeWave),
        reasonCodes, levels,
      }];
    })),
  };
}
