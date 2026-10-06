// services/core/logic/engine22/wave/revision/validateWaveMarkMaturity.js

/**
 * Engine 22 Wave Mark Maturity / Revision Memory
 *
 * Purpose:
 * - Do NOT treat every manual wave/correction mark as instantly confirmed.
 * - Keep snapshot builds read-only.
 * - Do NOT mutate active-wave-state-es.json.
 * - Produce runtime markMaturity summary and resolved correction marks.
 *
 * Supports:
 * - Existing W2 maturity behavior.
 * - ABC correction marks: A / B / C.
 * - ABCDE triangle marks: A / B / C / D / E.
 *
 * Safety:
 * - Structural only.
 * - No Engine 6 permission.
 * - No Engine 15 readiness.
 * - No Engine 8 execution.
 * - No Engine 26 ticket.
 */

const VALID_STATUSES = new Set([
  "WATCH",
  "CANDIDATE",
  "ACTIVE_CANDIDATE",
  "CONFIRMED",
  "SUPERSEDED",
  "INVALIDATED",
  "PROJECTED",
]);

const VALID_CONFIDENCE = new Set([
  "LOW",
  "MEDIUM",
  "HIGH",
  "MODEL",
  "MODEL_INTERNAL_FIB_WITH_CONFLUENCE",
]);

const CORRECTION_LEGS = ["A", "B", "C", "D", "E"];

const DEFAULT_TF_BY_DEGREE = {
  subminute: "10m",
  micro: "10m",
  minute: "10m",
  minor: "1h",
  intermediate: "4h",
  primary: "1d",
};

const SAFETY_FLAGS = {
  noExecution: true,
  noPermissionCreated: true,
  watchOnly: true,
};

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
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normalizeBasis(basis) {
  if (!Array.isArray(basis)) return [];
  return basis
    .map((item) => normalizeUpper(item))
    .filter(Boolean);
}

function normalizeReasonCodes(reasonCodes) {
  if (!Array.isArray(reasonCodes)) return [];
  return reasonCodes
    .map((item) => normalizeUpper(item))
    .filter(Boolean);
}

function normalizeStatus(status, fallback = "WATCH") {
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
    case "MODEL":
    case "MODEL_INTERNAL_FIB_WITH_CONFLUENCE":
      return 35;
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

function isConfirmedStatus(status) {
  return normalizeStatus(status, "WATCH") === "CONFIRMED";
}

function isFinalStatus(status) {
  const s = normalizeStatus(status, "WATCH");
  return s === "CONFIRMED" || s === "INVALIDATED" || s === "SUPERSEDED";
}

function getMarkPrice(mark) {
  if (!mark || typeof mark !== "object") return null;

  const direct = toFiniteNumber(mark.price ?? mark.p ?? mark.value);
  if (direct !== null) return direct;

  const high = toFiniteNumber(mark.high?.price ?? mark.high?.p ?? mark.high);
  if (high !== null) return high;

  const low = toFiniteNumber(mark.low?.price ?? mark.low?.p ?? mark.low);
  if (low !== null) return low;

  return null;
}

function getMarkTime(mark) {
  if (!mark || typeof mark !== "object") return null;

  return (
    mark.time ||
    mark.t ||
    mark.timestamp ||
    mark.high?.time ||
    mark.high?.t ||
    mark.low?.time ||
    mark.low?.t ||
    null
  );
}

function normalizePreviousMark(replaces) {
  if (!replaces || typeof replaces !== "object") return null;

  const price = toFiniteNumber(replaces.price ?? replaces.p ?? replaces.value);
  const time = normalizeText(replaces.time ?? replaces.t ?? replaces.timestamp);
  const status = normalizeStatus(replaces.status, "SUPERSEDED");
  const reason = normalizeUpper(replaces.reason);

  if (price === null && !time && !reason) return null;

  return {
    price: round2(price),
    time,
    status,
    reason,
  };
}

function normalizePreviousCandidates(value) {
  if (!value) return [];

  const raw = Array.isArray(value) ? value : [value];

  return raw
    .map((item) => normalizePreviousMark(item))
    .filter(Boolean);
}

function normalizeCandidateMark({
  symbol = "ES",
  degree = null,
  wave = null,
  mark = null,
  fallbackStatus = "WATCH",
  fallbackConfidence = "MEDIUM",
  source = "activeStructures",
} = {}) {
  if (!mark || typeof mark !== "object") return null;

  const rawStatus = normalizeUpper(mark.status ?? mark.maturity);
  const unknownStatus =
    rawStatus !== null && !VALID_STATUSES.has(rawStatus);

  const status = normalizeStatus(rawStatus, fallbackStatus);
  const confidence = normalizeConfidence(mark.confidence, fallbackConfidence);
  const price = round2(getMarkPrice(mark));
  const time = normalizeText(getMarkTime(mark));

  const previousCandidates = [
    ...normalizePreviousCandidates(mark.previousCandidates),
    ...normalizePreviousCandidates(mark.previousMark),
    ...normalizePreviousCandidates(mark.replaces),
  ];

  const basis = normalizeBasis(mark.basis);
  const reasonCodes = [
    ...normalizeReasonCodes(mark.reasonCodes),
    ...(unknownStatus ? ["UNKNOWN_STATUS_NORMALIZED_TO_WATCH"] : []),
  ];

  return {
    symbol,
    degree,
    wave,
    price,
    time,
    status,
    maturity: status,
    confidence,
    score: scoreFromConfidence(confidence),
    confirmed: mark.confirmed === true || status === "CONFIRMED",
    superseded:
      mark.superseded === true ||
      mark.supersededPreviousMark === true ||
      status === "SUPERSEDED",
    basis,
    previousCandidates,
    previousMark: previousCandidates[0] || null,
    source: mark.source || source,
    confirmationRequired: status !== "CONFIRMED",
    ...SAFETY_FLAGS,
    reasonCodes,
  };
}

function makeSupersededCandidate(mark, reason) {
  if (!mark || typeof mark !== "object") return null;

  return {
    price: round2(mark.price),
    time: mark.time || null,
    status: "SUPERSEDED",
    maturity: "SUPERSEDED",
    confidence: mark.confidence || "MEDIUM",
    reason: reason || "CORRECTION_MARK_SUPERSEDED_BY_BETTER_RUNTIME_CANDIDATE",
    basis: Array.isArray(mark.basis) ? mark.basis : [],
    ...SAFETY_FLAGS,
  };
}

function getBarsForDegree({ degree, tf = null, barsByTf = {} } = {}) {
  const preferredTf = tf || DEFAULT_TF_BY_DEGREE[String(degree || "").toLowerCase()] || "10m";

  if (Array.isArray(barsByTf?.[preferredTf]) && barsByTf[preferredTf].length) {
    return barsByTf[preferredTf];
  }

  if (Array.isArray(barsByTf?.["10m"]) && barsByTf["10m"].length) {
    return barsByTf["10m"];
  }

  if (Array.isArray(barsByTf?.["1h"]) && barsByTf["1h"].length) {
    return barsByTf["1h"];
  }

  return [];
}

function parseMarkTimeMs(time) {
  if (time === null || time === undefined || time === "") return null;

  if (typeof time === "number" && Number.isFinite(time)) {
    return time > 1000000000000 ? time : time * 1000;
  }

  const text = String(time).trim();
  if (!text) return null;

  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const parsed = Date.parse(normalized);

  if (Number.isFinite(parsed)) return parsed;

  const withUtc = Date.parse(`${normalized}Z`);
  if (Number.isFinite(withUtc)) return withUtc;

  return null;
}

function getBarTimeMs(bar) {
  const raw = bar?.time ?? bar?.t ?? bar?.tSec ?? bar?.timestamp ?? null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1000000000000 ? raw : raw * 1000;
  }

  return parseMarkTimeMs(raw);
}

function getBarHigh(bar) {
  return toFiniteNumber(bar?.high ?? bar?.h);
}

function getBarLow(bar) {
  return toFiniteNumber(bar?.low ?? bar?.l);
}

function getBarClose(bar) {
  return toFiniteNumber(bar?.close ?? bar?.c);
}

function findExtremeAfterMark({
  bars = [],
  mark = null,
  mode = "HIGH",
} = {}) {
  if (!Array.isArray(bars) || !bars.length || !mark) return null;

  const markPrice = toFiniteNumber(mark.price);
  if (markPrice === null) return null;

  const markTimeMs = parseMarkTimeMs(mark.time);
  let best = null;

  for (const bar of bars) {
    const barTimeMs = getBarTimeMs(bar);

    if (
      markTimeMs !== null &&
      barTimeMs !== null &&
      barTimeMs <= markTimeMs
    ) {
      continue;
    }

    const extreme =
      mode === "LOW"
        ? getBarLow(bar)
        : getBarHigh(bar);

    if (extreme === null) continue;

    if (mode === "LOW") {
      if (extreme >= markPrice) continue;

      if (!best || extreme < best.price) {
        best = {
          price: round2(extreme),
          time: bar?.time ?? bar?.t ?? bar?.tSec ?? bar?.timestamp ?? null,
          source: "BAR_SCAN_AFTER_ORIGINAL_MARK",
          bar,
        };
      }
    } else {
      if (extreme <= markPrice) continue;

      if (!best || extreme > best.price) {
        best = {
          price: round2(extreme),
          time: bar?.time ?? bar?.t ?? bar?.tSec ?? bar?.timestamp ?? null,
          source: "BAR_SCAN_AFTER_ORIGINAL_MARK",
          bar,
        };
      }
    }
  }

  return best;
}

function inferCorrectionType(correction = {}) {
  const raw = normalizeUpper(
    correction.preferredType ||
      correction.type ||
      correction?.triangle?.type ||
      correction?.preferredModel?.type
  );

  if (raw?.includes("ABCDE") || raw?.includes("TRIANGLE")) {
    return "ABCDE_TRIANGLE";
  }

  if (raw?.includes("ABC_UP")) return "ABC_UP";
  if (raw?.includes("ABC_DOWN")) return "ABC_DOWN";
  if (raw?.includes("ABC")) return "ABC_DOWN";

  const hasD = Boolean(correction?.marks?.D || correction?.triangle?.marks?.D);
  const hasE = Boolean(correction?.marks?.E || correction?.triangle?.marks?.E);

  if (hasD || hasE) return "ABCDE_TRIANGLE";

  return "ABC_DOWN";
}

function getCorrectionMarks(correction = {}) {
  const marks =
    correction?.marks ||
    correction?.triangle?.marks ||
    correction?.preferredModel?.marks ||
    correction?.models?.abcdeTriangle?.marks ||
    correction?.models?.abcDown?.marks ||
    correction?.models?.abcDown?.manualMarks ||
    correction?.manualMarks ||
    {};

  return marks && typeof marks === "object" ? marks : {};
}

function legExtremeMode({ correctionType, leg }) {
  const type = normalizeUpper(correctionType);
  const wave = normalizeUpper(leg);

  if (type === "ABC_UP") {
    if (wave === "B") return "LOW";
    if (wave === "A" || wave === "C") return "HIGH";
    return "HIGH";
  }

  if (type === "ABCDE_TRIANGLE") {
    if (wave === "B" || wave === "D") return "HIGH";
    if (wave === "A" || wave === "C" || wave === "E") return "LOW";
    return "HIGH";
  }

  if (wave === "B") return "HIGH";
  if (wave === "A" || wave === "C") return "LOW";

  return "HIGH";
}

function shouldAttemptExtension({ correctionType, leg, mark }) {
  if (!mark) return false;
  if (isFinalStatus(mark.status)) return false;

  const type = normalizeUpper(correctionType);
  const wave = normalizeUpper(leg);

  if (type === "ABC_DOWN") {
    return wave === "B";
  }

  if (type === "ABC_UP") {
    return wave === "B";
  }

  if (type === "ABCDE_TRIANGLE") {
    return wave === "B" || wave === "D" || wave === "E";
  }

  return false;
}

function buildExtendedCandidate({
  symbol,
  degree,
  wave,
  originalMark,
  newExtreme,
  correctionType,
  mode,
} = {}) {
  const oldCandidate = makeSupersededCandidate(
    originalMark,
    `${wave}_EXTENDED_${mode === "LOW" ? "LOWER" : "HIGHER"}_BEFORE_CONFIRMATION`
  );

  const reasonCode =
    `${wave}_EXTENDED_${mode === "LOW" ? "LOWER" : "HIGHER"}_BEFORE_REJECTION_CONFIRMED`;

  return {
    symbol,
    degree,
    wave,
    price: round2(newExtreme.price),
    time: newExtreme.time || null,
    status: "ACTIVE_CANDIDATE",
    maturity: "ACTIVE_CANDIDATE",
    confidence: "MEDIUM",
    score: 50,
    confirmed: false,
    superseded: false,
    basis: [
      `${wave}_EXTENDED_ABOVE_PRIOR_CANDIDATE_BEFORE_REJECTION_CONFIRMED`,
      "WAITING_FOR_REJECTION_OR_NEXT_LEG_CONFIRMATION",
      "STRUCTURAL_WATCH_ONLY",
    ],
    previousCandidates: oldCandidate ? [oldCandidate] : [],
    previousMark: oldCandidate || null,
    source: newExtreme.source || "BAR_SCAN_AFTER_ORIGINAL_MARK",
    correctionType,
    confirmationRequired: true,
    ...SAFETY_FLAGS,
    reasonCodes: [
      reasonCode,
      `${wave}_ACTIVE_CANDIDATE_FROM_RUNTIME_MATURITY_RESOLVER`,
      "CORRECTION_MARK_MATURITY_STRUCTURAL_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
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
  let confidence = normalizeConfidence(
    rawConfidence,
    status === "CONFIRMED" ? "HIGH" : "MEDIUM"
  );
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
  if (
    rawStatus === "CONFIRMED" &&
    rawConfidence === "HIGH" &&
    !hasBWaveFakeoutRisk
  ) {
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
    price: round2(price),
    time,
    status,
    maturity: status,
    confidence,
    score,
    basis,
    supersededPreviousMark: Boolean(previousMark),
    previousMark,
    confirmationRequired: status !== "CONFIRMED",
    noExecution: true,
    noPermissionCreated: true,
    noChase: true,
    watchOnly: true,
    reasonCodes,
  };
}

export function validateCorrectionMarkMaturity({
  symbol = "ES",
  degree = null,
  structure = null,
  currentPrice = null,
  barsByTf = {},
} = {}) {
  const correction = structure?.correction || null;

  if (!correction || typeof correction !== "object") {
    return null;
  }

  const correctionType = inferCorrectionType(correction);
  const marks = getCorrectionMarks(correction);
  const tf = correction?.tf || structure?.tf || DEFAULT_TF_BY_DEGREE[degree] || "10m";
  const bars = getBarsForDegree({ degree, tf, barsByTf });

  const resolvedMarks = {};
  const originalMarks = {};
  const revisions = [];
  const reasonCodes = [
    "CORRECTION_MARK_MATURITY_RESOLVED",
    `CORRECTION_TYPE_${correctionType}`,
    "CORRECTION_MARK_MATURITY_STRUCTURAL_ONLY",
    "NO_EXECUTION",
    "NO_PERMISSION_CREATED",
  ];

  if (!bars.length) {
    reasonCodes.push("CORRECTION_MATURITY_BARS_UNAVAILABLE");
  }

  for (const leg of CORRECTION_LEGS) {
    const rawMark = marks?.[leg] || marks?.[leg.toLowerCase()] || null;

    if (!rawMark) {
      resolvedMarks[leg] = null;
      originalMarks[leg] = null;
      continue;
    }

    const normalized = normalizeCandidateMark({
      symbol,
      degree,
      wave: leg,
      mark: rawMark,
      fallbackStatus: leg === "E" ? "PROJECTED" : "WATCH",
      fallbackConfidence: leg === "E" ? "LOW" : "MEDIUM",
      source: "activeStructures.correction.marks",
    });

    originalMarks[leg] = normalized;
    resolvedMarks[leg] = normalized;

    if (
      !shouldAttemptExtension({
        correctionType,
        leg,
        mark: normalized,
      })
    ) {
      continue;
    }

    const mode = legExtremeMode({ correctionType, leg });
    const newExtreme = findExtremeAfterMark({
      bars,
      mark: normalized,
      mode,
    });

    if (!newExtreme) continue;

    const extended = buildExtendedCandidate({
      symbol,
      degree,
      wave: leg,
      originalMark: normalized,
      newExtreme,
      correctionType,
      mode,
    });

    resolvedMarks[leg] = extended;

    revisions.push({
      degree,
      wave: leg,
      oldPrice: normalized.price,
      oldTime: normalized.time,
      oldStatus: normalized.status,
      newPrice: extended.price,
      newTime: extended.time,
      newStatus: extended.status,
      reason:
        mode === "LOW"
          ? `${leg}_EXTENDED_LOWER_BEFORE_CONFIRMATION`
          : `${leg}_EXTENDED_HIGHER_BEFORE_CONFIRMATION`,
      ...SAFETY_FLAGS,
    });

    reasonCodes.push(`${leg}_MARK_REVISED_TO_ACTIVE_CANDIDATE`);
  }

  const activeRevision = revisions.length ? revisions[revisions.length - 1] : null;

  return {
    active: true,
    symbol,
    degree,
    type: correctionType,
    preferredType: correction?.preferredType || correctionType,
    stage: correction?.stage || null,
    currentRead: correction?.currentRead || null,
    tf,
    currentPrice: round2(currentPrice),
    resolvedMarks,
    originalMarks,
    revisions,
    activeRevision,
    hasRuntimeRevision: revisions.length > 0,
    ...SAFETY_FLAGS,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

/**
 * Validate mark maturity for active degrees.
 *
 * Expected input is flexible so this can wire into the current code safely.
 */
export function validateWaveMarkMaturity({
  symbol = "ES",
  activeStructures = {},
  currentPrice = null,
  barsByTf = {},
} = {}) {
  const byDegree = {};
  const flat = [];
  const correctionFlat = [];

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

    const correction = validateCorrectionMarkMaturity({
      symbol,
      degree,
      structure,
      currentPrice,
      barsByTf,
    });

    if (correction) {
      degreeResult.correction = correction;
      correctionFlat.push(correction);
    }

    byDegree[degree] = degreeResult;
  }

  const current =
    flat.find((item) => item.degree === "intermediate" && item.wave === "W2") ||
    flat[0] ||
    null;

  const currentCorrection =
    correctionFlat.find((item) => item.hasRuntimeRevision === true) ||
    correctionFlat[0] ||
    null;

  return {
    ok: true,
    symbol,
    current,
    currentCorrection,
    byDegree,
    all: flat,
    corrections: correctionFlat,
    ...SAFETY_FLAGS,
    reasonCodes: [
      "ENGINE22_MARK_MATURITY_VALIDATED",
      correctionFlat.length
        ? "CORRECTION_MARK_MATURITY_AVAILABLE"
        : "NO_CORRECTION_MARK_MATURITY_AVAILABLE",
      "READ_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

export default validateWaveMarkMaturity;

