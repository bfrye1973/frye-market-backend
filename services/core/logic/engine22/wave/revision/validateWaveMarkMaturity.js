// services/core/logic/engine22/wave/revision/validateWaveMarkMaturity.js

/**
 * Engine 22 Wave Mark Maturity / Revision Memory
 *
 * Purpose:
 * - Do NOT treat every manual wave mark as instantly confirmed.
 * - Keep snapshot builds read-only.
 * - Do NOT mutate active-wave-state-es.json.
 * - Produce a runtime markMaturity summary that lifecycle/resolver can use.
 *
 * Step 1 scope:
 * - Support W2 maturity.
 * - Support optional active JSON fields:
 *   status, confidence, basis, replaces.
 * - Default missing W2 status safely to CANDIDATE.
 * - Preserve the 7473 -> 7415.25 lesson when replaces is present.
 */

const VALID_STATUSES = new Set([
  "CANDIDATE",
  "CONFIRMED",
  "SUPERSEDED",
  "INVALIDATED",
]);

const VALID_CONFIDENCE = new Set([
  "LOW",
  "MEDIUM",
  "HIGH",
]);

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

function normalizeUpper(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.toUpperCase();
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBasis(basis) {
  if (!Array.isArray(basis)) return [];
  return basis
    .map((item) => normalizeUpper(item))
    .filter(Boolean);
}

function normalizeStatus(status, fallback = "CANDIDATE") {
  const normalized = normalizeUpper(status);
  if (normalized && VALID_STATUSES.has(normalized)) return normalized;
  return fallback;
}

function normalizeConfidence(confidence, fallback = "MEDIUM") {
  const normalized = normalizeUpper(confidence);
  if (normalized && VALID_CONFIDENCE.has(normalized)) return normalized;
  return fallback;
}

function scoreFromConfidence(confidence) {
  switch (confidence) {
    case "HIGH":
      return 70;
    case "MEDIUM":
      return 50;
    case "LOW":
      return 25;
    default:
      return 40;
  }
}

function confidenceFromScore(score) {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function statusFromScoreForW2(score) {
  if (score >= 70) return "CONFIRMED";
  return "CANDIDATE";
}

function normalizePreviousMark(replaces) {
  if (!replaces || typeof replaces !== "object") return null;

  const price = toFiniteNumber(replaces.price);
  const time = normalizeText(replaces.time);
  const status = normalizeStatus(replaces.status, "SUPERSEDED");
  const reason = normalizeUpper(replaces.reason);

  if (price === null && !time && !reason) return null;

  return {
    price,
    time,
    status,
    reason,
  };
}

function buildReasonCodesForW2({
  declaredStatus,
  declaredConfidence,
  basis,
  previousMark,
  inferredFromMissingStatus,
}) {
  const reasonCodes = [];

  if (inferredFromMissingStatus) {
    reasonCodes.push("W2_STATUS_MISSING_DEFAULTED_TO_CANDIDATE");
    reasonCodes.push("DO_NOT_CONFIRM_W2_FROM_MARK_ALONE");
  }

  if (basis.includes("ABC_C_LOW_COMPLETED")) {
    reasonCodes.push("ABC_C_LOW_COMPLETED");
  }

  if (basis.includes("INSTITUTIONAL_ZONE_TESTED")) {
    reasonCodes.push("INSTITUTIONAL_ZONE_TESTED");
  }

  if (basis.includes("REACTION_BOUNCE_PRESENT")) {
    reasonCodes.push("REACTION_BOUNCE_PRESENT");
  }

  if (basis.includes("POSSIBLE_B_WAVE_LIQUIDITY_RALLY_AFTER_W2_CANDIDATE")) {
    reasonCodes.push("POSSIBLE_B_WAVE_LIQUIDITY_RALLY_AFTER_W2_CANDIDATE");
    reasonCodes.push("NO_CHASE_AFTER_B_WAVE_RALLY");
  }

  if (basis.includes("FINAL_C_DOWN_SWEEP_RISK_BELOW_PRIOR_W2_CANDIDATE")) {
    reasonCodes.push("FINAL_C_DOWN_SWEEP_RISK_BELOW_PRIOR_W2_CANDIDATE");
    reasonCodes.push("WAIT_FOR_C_LOW_REACTION_OR_RECLAIM");
  }

  if (previousMark?.status === "SUPERSEDED") {
    reasonCodes.push("EARLY_W2_MARK_SUPERSEDED_BY_DEEPER_ABC_C_LOW");
  }

  if (previousMark?.reason) {
    reasonCodes.push(previousMark.reason);
  }

  if (declaredStatus === "CONFIRMED" && declaredConfidence === "HIGH") {
    reasonCodes.push("W2_MARK_DECLARED_CONFIRMED_HIGH_CONFIDENCE");
  }

  return [...new Set(reasonCodes)];
}

/**
 * Validate one W2 mark.
 *
 * This function is intentionally conservative:
 * - If status is missing, W2 starts as CANDIDATE.
 * - If status/confidence/basis are provided, use them.
 * - If B-wave fakeout / final C-down risk is present, do not blindly promote.
 */
export function validateW2MarkMaturity({
  symbol = "ES",
  degree,
  mark,
} = {}) {
  const wave = "W2";
  const price = toFiniteNumber(mark?.price);
  const time = normalizeText(mark?.time);

  const rawStatus = normalizeUpper(mark?.status);
  const rawConfidence = normalizeUpper(mark?.confidence);
  const basis = normalizeBasis(mark?.basis);
  const previousMark = normalizePreviousMark(mark?.replaces);

  const statusWasMissing = !rawStatus;
  const confidenceWasMissing = !rawConfidence;

  let status = normalizeStatus(rawStatus, "CANDIDATE");
  let confidence = normalizeConfidence(rawConfidence, status === "CONFIRMED" ? "HIGH" : "MEDIUM");
  let score = scoreFromConfidence(confidence);

  // Critical W2 safety rule:
  // Missing status must NOT mean confirmed.
  if (statusWasMissing) {
    status = "CANDIDATE";
    confidence = confidenceWasMissing ? "MEDIUM" : confidence;
    score = Math.min(scoreFromConfidence(confidence), 50);
  }

  // If the file provides strong evidence but no explicit status, allow runtime upgrade.
  // But keep B-wave / final C-down risk conservative.
  const hasStrongCompletionBasis =
    basis.includes("ABC_C_LOW_COMPLETED") &&
    basis.includes("INSTITUTIONAL_ZONE_TESTED") &&
    basis.includes("REACTION_BOUNCE_PRESENT");

  const hasBWaveFakeoutRisk =
    basis.includes("POSSIBLE_B_WAVE_LIQUIDITY_RALLY_AFTER_W2_CANDIDATE") ||
    basis.includes("FINAL_C_DOWN_SWEEP_RISK_BELOW_PRIOR_W2_CANDIDATE");

  if (statusWasMissing && hasStrongCompletionBasis && !hasBWaveFakeoutRisk) {
    score = 70;
    confidence = "HIGH";
    status = "CONFIRMED";
  }

  // If the user explicitly marks W2 confirmed/high, respect it,
  // unless the basis also says final C-down sweep risk is still active.
  if (rawStatus === "CONFIRMED" && rawConfidence === "HIGH" && !hasBWaveFakeoutRisk) {
    score = Math.max(score, 70);
    confidence = "HIGH";
    status = "CONFIRMED";
  }

  // If B-wave fakeout / final C-down risk exists, keep W2 from being too aggressive.
  if (hasBWaveFakeoutRisk && status !== "INVALIDATED") {
    score = Math.min(score, 60);
    confidence = confidenceFromScore(score);
    status = statusFromScoreForW2(score);
  }

  const reasonCodes = buildReasonCodesForW2({
    declaredStatus: rawStatus,
    declaredConfidence: rawConfidence,
    basis,
    previousMark,
    inferredFromMissingStatus: statusWasMissing,
  });

  return {
    symbol,
    degree,
    wave,
    price,
    time,

    status,
    confidence,
    score,

    basis,

    supersededPreviousMark: Boolean(previousMark),
    previousMark,

    confirmationRequired: status !== "CONFIRMED",
    noExecution: true,
    noPermissionCreated: true,
    noChase: true,

    reasonCodes,
  };
}

/**
 * Validate mark maturity for active degrees.
 *
 * Expected input is flexible so we can wire this into the current code safely.
 *
 * Example:
 * activeStructures = {
 *   intermediate: {
 *     tf: "1h",
 *     direction: "UP",
 *     marks: {
 *       W1: { price: 7648, time: "2026-06-15 09:00" },
 *       W2: { price: 7415.25, time: "2026-06-23 13:30", ... }
 *     }
 *   }
 * }
 */
export function validateWaveMarkMaturity({
  symbol = "ES",
  activeStructures = {},
} = {}) {
  const byDegree = {};
  const flat = [];

  for (const [degree, structure] of Object.entries(activeStructures || {})) {
    const marks = structure?.marks || {};
    const degreeResult = {};

    if (marks.W2) {
      degreeResult.W2 = validateW2MarkMaturity({
        symbol,
        degree,
        mark: marks.W2,
      });

      flat.push(degreeResult.W2);
    }

    byDegree[degree] = degreeResult;
  }

  const current =
    flat.find((item) => item.degree === "intermediate" && item.wave === "W2") ||
    flat[0] ||
    null;

  return {
    ok: true,
    symbol,
    current,
    byDegree,
    all: flat,
  };
}

export default validateWaveMarkMaturity;
