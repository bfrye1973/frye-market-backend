// services/core/logic/engine22/opportunity/buildWaveOpportunity.js
// Engine 22I / 22D — Wave Opportunity Contract Builder
//
// Purpose:
// Build a clean read-only Elliott Wave opportunity contract for Engine 15ES.
//
// This file does NOT:
// - execute trades
// - call brokers
// - route orders
// - replace Engine 15ES
// - replace Engine 6
// - invent wave math
//
// It only packages existing Engine 22 wave/fib state into:
// engine22WaveStrategy.waveOpportunity
//
// Current responsibilities:
// - Normalize W2→W3 / W4→W5 opportunity families.
// - Detect late / post-extension / no-chase conditions.
// - Support WATCH -> ARMING only from backend-normalized context.
// - Keep post-extension reclaim watch read-only.
// - Block parent W5 from being treated as a fresh tradeable long when lower-degree W5s are complete.
// - Expose post-W5 ABC correction map from manual A/B/C rows after lower-degree W5 completion.
// - Keep Engine 15ES as final setup referee.
// - Keep Engine 6 as final permission gate.

const DEGREES = ["primary", "intermediate", "minor", "minute", "micro"];

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = toNum(x);
  return n === null ? null : Number(n.toFixed(2));
}

function roundToTick(value, tickSize = 0.25) {
  const n = toNum(value);
  if (n === null) return null;
  return Number((Math.round(n / tickSize) * tickSize).toFixed(2));
}

function cleanString(x, fallback = null) {
  const s = String(x ?? "").trim();
  return s ? s : fallback;
}

function upper(x, fallback = "UNKNOWN") {
  return String(x || fallback).trim().toUpperCase();
}

function normalizeDegree(x) {
  const s = String(x || "").trim().toLowerCase();
  return DEGREES.includes(s) ? s : "unknown";
}

function normalizeSetupType(rawSetup) {
  const raw = upper(rawSetup, "NO_SETUP");

  if (raw.includes("W2_TO_W3")) return "W2_TO_W3";
  if (raw.includes("W4_TO_W5")) return "W4_TO_W5";
  if (raw.includes("W5_EXTENSION")) return "W4_TO_W5";

  return "NONE";
}

function normalizeDirection(setupType, degreeState = {}) {
  if (setupType === "NONE") return "NONE";

  const rawDirection = upper(degreeState?.direction, "");
  if (rawDirection === "BEARISH" || rawDirection === "SHORT") return "SHORT";

  return "LONG";
}

function normalizeChaseRisk(...values) {
  const rank = {
    UNKNOWN: 0,
    LOW: 1,
    LOW_TO_MODERATE: 1,
    MODERATE: 2,
    ELEVATED: 3,
    HIGH: 3,
    VERY_HIGH: 4,
    EXTREME: 4,
  };

  let best = "UNKNOWN";
  let bestRank = 0;

  for (const value of values) {
    const raw = upper(value, "UNKNOWN");
    const score = rank[raw] ?? 0;

    if (score > bestRank) {
      best = raw;
      bestRank = score;
    }
  }

  if (best === "LOW_TO_MODERATE") return "LOW";
  if (best === "ELEVATED") return "HIGH";
  if (best === "VERY_HIGH") return "EXTREME";

  if (["LOW", "MODERATE", "HIGH", "EXTREME"].includes(best)) return best;

  return "UNKNOWN";
}

function buildWaveState(waveFibState) {
  const degrees = waveFibState?.degrees || {};

  return {
    primary: degrees?.primary?.phase || "UNKNOWN",
    intermediate: degrees?.intermediate?.phase || "UNKNOWN",
    minor: degrees?.minor?.phase || "UNKNOWN",
    minute: degrees?.minute?.phase || "UNKNOWN",
    micro: degrees?.micro?.phase || "UNKNOWN",
  };
}

function pickTarget(levels = {}, key) {
  if (!levels || typeof levels !== "object") return null;

  const direct = round2(levels?.[key]);
  if (direct !== null) return direct;

  const fallbackMap = {
    e100: ["1.000", "1", 1],
    e1272: ["1.272", 1.272],
    e1618: ["1.618", 1.618],
    e200: ["2.000", "2", 2],
    e2618: ["2.618", 2.618],
  };

  for (const fallbackKey of fallbackMap[key] || []) {
    const value = round2(levels?.[fallbackKey]);
    if (value !== null) return value;
  }

  return null;
}

function buildTargets({ degreeState, w4Levels } = {}) {
  const levels =
    degreeState?.fibProjection?.levels ||
    w4Levels?.w5Targets ||
    {};

  return {
    e100: pickTarget(levels, "e100"),
    e1272: pickTarget(levels, "e1272"),
    e1618: pickTarget(levels, "e1618"),
    e200: pickTarget(levels, "e200"),
    e2618: pickTarget(levels, "e2618"),
  };
}

function getExtensionHit(extensionProgress = {}) {
  return (
    toNum(extensionProgress?.highestExtensionHit) ??
    toNum(extensionProgress?.highestExtension) ??
    toNum(extensionProgress?.extensionHit) ??
    null
  );
}

function getNearestFibPrice(degreeState = {}) {
  return (
    round2(degreeState?.fibPressure?.nearestFibPrice) ??
    round2(degreeState?.extensionProgress?.highestExtensionPrice) ??
    null
  );
}

function buildTiming({ setupType, rawSetup, degreeState }) {
  if (setupType === "NONE") return "EARLY";

  const raw = upper(rawSetup, "");
  const extensionState = upper(degreeState?.extensionProgress?.state, "");
  const highestHit = getExtensionHit(degreeState?.extensionProgress);

  if (extensionState === "POST_EXTENSION_PULLBACK") return "POST_EXTENSION";

  if (raw.includes("W5_EXTENSION")) return "LATE";

  if (highestHit !== null && highestHit >= 1.272) return "LATE";

  return "EARLY";
}

function buildReadiness({ setupType, timing, degreeState, invalidation }) {
  if (setupType === "NONE") return "NO_SETUP";

  const extensionState = upper(degreeState?.extensionProgress?.state, "");
  if (extensionState === "POST_EXTENSION_PULLBACK") return "POST_EXTENSION";

  if (invalidation?.price !== null && invalidation?.broken === true) {
    return "INVALID";
  }

  if (timing === "POST_EXTENSION") return "POST_EXTENSION";

  return "WATCH";
}

function buildEntryZone({ setupType, w4Levels }) {
  if (setupType === "NONE") {
    return {
      type: "NONE",
      lo: null,
      hi: null,
      trigger: null,
    };
  }

  const supportZone = w4Levels?.supportZone || null;

  if (supportZone && typeof supportZone === "object") {
    return {
      type: "PULLBACK",
      lo: round2(supportZone?.lo ?? supportZone?.low),
      hi: round2(supportZone?.hi ?? supportZone?.high),
      trigger: round2(w4Levels?.fullTrigger ?? w4Levels?.reclaim),
    };
  }

  return {
    type: "PULLBACK",
    lo: null,
    hi: null,
    trigger: null,
  };
}

function buildInvalidation({ setupType, w4Levels }) {
  if (setupType === "NONE") {
    return {
      price: null,
      reason: "No valid W3/W5 opportunity is active.",
    };
  }

  const hardInvalidation = round2(w4Levels?.hardInvalidation);

  if (hardInvalidation !== null) {
    return {
      price: hardInvalidation,
      reason: "Hard invalidation from Engine 22 W4 levels.",
    };
  }

  return {
    price: null,
    reason: "No hard invalidation available from active wave state yet.",
  };
}

function hasAnyTarget(targets = {}) {
  return Object.values(targets).some(
    (value) => value !== null && value !== undefined
  );
}

function isEngine16Ready(engine16 = null) {
  const readiness = upper(engine16?.readiness, "");
  return readiness === "READY";
}

function isEngine25Supportive(engine25Context = null) {
  const freshnessStatus = upper(engine25Context?.freshnessStatus, "");
  const regime = upper(engine25Context?.regime, "");
  const permission = upper(engine25Context?.permission, "");
  const score = toNum(engine25Context?.score);

  if (engine25Context?.ok !== true) return false;
  if (freshnessStatus === "MISSING" || freshnessStatus === "STALE") return false;

  return (
    (score !== null && score >= 70) ||
    regime.includes("RISK_ON") ||
    regime.includes("CONSTRUCTIVE") ||
    permission.includes("SELECTIVE_LONGS")
  );
}

function isMarketRegimeSupportive(marketRegime = null) {
  const directionBias = upper(marketRegime?.directionBias, "");
  const strictness = upper(marketRegime?.strictness, "");

  return (
    ["LONG", "LONG_CAUTION"].includes(directionBias) &&
    ["LOW", "MEDIUM"].includes(strictness)
  );
}

function rawSetupBlocksArming(rawSetup) {
  const raw = upper(rawSetup, "");

  return (
    raw.includes("W5_EXTENSION") ||
    raw.includes("POST_EXTENSION") ||
    raw.includes("NO_CHASE")
  );
}

function isPostExtensionContext({
  rawSetup,
  timing,
  baseReadiness,
  degreeState,
} = {}) {
  const raw = upper(rawSetup, "");
  const highestHit = getExtensionHit(degreeState?.extensionProgress);
  const extensionState = upper(degreeState?.extensionProgress?.state, "");

  return (
    raw.includes("W5_EXTENSION") ||
    raw.includes("POST_EXTENSION") ||
    timing === "POST_EXTENSION" ||
    timing === "LATE" ||
    baseReadiness === "POST_EXTENSION" ||
    extensionState === "POST_EXTENSION_PULLBACK" ||
    (highestHit !== null && highestHit >= 1.272)
  );
}

function pricePulledBackFromExtension({
  currentPrice,
  targets,
  degreeState,
} = {}) {
  const price = toNum(currentPrice);
  if (price === null) return false;

  const e1618 = toNum(targets?.e1618);
  const e200 = toNum(targets?.e200);
  const nearestFibPrice = getNearestFibPrice(degreeState);
  const highestHit = getExtensionHit(degreeState?.extensionProgress);

  if (e1618 !== null && price <= e1618) return true;

  if (highestHit !== null && highestHit >= 2 && e200 !== null && price <= e200) {
    return true;
  }

  if (nearestFibPrice !== null && price <= nearestFibPrice) return true;

  return false;
}

function buildSupportiveContext({
  setupType,
  direction,
  timing,
  chaseRisk,
  rawSetup,
  readiness,
  engine16,
  engine25Context,
  marketRegime,
} = {}) {
  const blocked = [];

  const engine16Ready = isEngine16Ready(engine16);
  const engine25Supportive = isEngine25Supportive(engine25Context);
  const marketRegimeSupportive = isMarketRegimeSupportive(marketRegime);

  const engine25Score = toNum(engine25Context?.score);
  const engine25Regime = cleanString(engine25Context?.regime, null);
  const engine25Permission = cleanString(engine25Context?.permission, null);
  const engine25FreshnessStatus = cleanString(
    engine25Context?.freshnessStatus,
    null
  );

  const marketRegimeDirection = cleanString(marketRegime?.directionBias, null);
  const marketRegimeStrictness = cleanString(marketRegime?.strictness, null);

  if (!["W2_TO_W3", "W4_TO_W5"].includes(setupType)) {
    blocked.push("ARMING_BLOCKED_NOT_W2_W3_OR_W4_W5");
  }

  if (direction !== "LONG") {
    blocked.push("ARMING_BLOCKED_DIRECTION_NOT_LONG");
  }

  if (!["EARLY", "IDEAL"].includes(timing)) {
    blocked.push("ARMING_BLOCKED_TIMING_NOT_EARLY_OR_IDEAL");
  }

  if (!["LOW", "MODERATE"].includes(chaseRisk)) {
    blocked.push("ARMING_BLOCKED_CHASE_RISK_NOT_LOW_OR_MODERATE");
  }

  if (rawSetupBlocksArming(rawSetup)) {
    blocked.push("ARMING_BLOCKED_EXTENSION_OR_NO_CHASE_RAW_SETUP");
  }

  if (readiness !== "WATCH") {
    blocked.push("ARMING_BLOCKED_READINESS_NOT_WATCH");
  }

  if (!engine16Ready) {
    blocked.push("ARMING_BLOCKED_ENGINE16_NOT_READY");
  }

  if (!engine25Supportive) {
    blocked.push("ARMING_BLOCKED_ENGINE25_NOT_SUPPORTIVE");
  }

  if (!marketRegimeSupportive) {
    blocked.push("ARMING_BLOCKED_MARKET_REGIME_NOT_SUPPORTIVE");
  }

  return {
    engine16Ready,
    engine25Supportive,
    marketRegimeSupportive,

    engine25Score,
    engine25Regime,
    engine25Permission,
    engine25FreshnessStatus,

    marketRegimeDirection,
    marketRegimeStrictness,

    armingAllowed: blocked.length === 0,
    armingBlockedReasonCodes: blocked,
  };
}

function buildPostExtensionReclaimContext({
  setupType,
  direction,
  rawSetup,
  baseTiming,
  baseReadiness,
  baseChaseRisk,
  currentPrice,
  degreeState,
  targets,
  engine16,
  engine25Context,
  marketRegime,
} = {}) {
  const blocked = [];

  const engine16Ready = isEngine16Ready(engine16);
  const engine25Supportive = isEngine25Supportive(engine25Context);
  const marketRegimeSupportive = isMarketRegimeSupportive(marketRegime);

  const postExtensionContext = isPostExtensionContext({
    rawSetup,
    timing: baseTiming,
    baseReadiness,
    degreeState,
  });

  const pulledBackFromExtension = pricePulledBackFromExtension({
    currentPrice,
    targets,
    degreeState,
  });

  if (!["W2_TO_W3", "W4_TO_W5"].includes(setupType)) {
    blocked.push("POST_EXTENSION_RECLAIM_BLOCKED_NOT_W2_W3_OR_W4_W5");
  }

  if (direction !== "LONG") {
    blocked.push("POST_EXTENSION_RECLAIM_BLOCKED_DIRECTION_NOT_LONG");
  }

  if (!postExtensionContext) {
    blocked.push("POST_EXTENSION_RECLAIM_BLOCKED_NOT_POST_EXTENSION_CONTEXT");
  }

  if (!pulledBackFromExtension) {
    blocked.push("POST_EXTENSION_RECLAIM_BLOCKED_NO_CONTROLLED_PULLBACK");
  }

  if (!engine16Ready) {
    blocked.push("POST_EXTENSION_RECLAIM_BLOCKED_ENGINE16_NOT_READY");
  }

  if (!engine25Supportive) {
    blocked.push("POST_EXTENSION_RECLAIM_BLOCKED_ENGINE25_NOT_SUPPORTIVE");
  }

  if (!marketRegimeSupportive) {
    blocked.push("POST_EXTENSION_RECLAIM_BLOCKED_MARKET_REGIME_NOT_SUPPORTIVE");
  }

  return {
    engine16Ready,
    engine25Supportive,
    marketRegimeSupportive,
    postExtensionContext,
    pulledBackFromExtension,
    baseTiming,
    baseReadiness,
    baseChaseRisk,
    currentPrice: round2(currentPrice),
    armingAllowed: blocked.length === 0,
    reclaimAllowed: blocked.length === 0,
    reclaimBlockedReasonCodes: blocked,
  };
}

function applyArmingLifecycle({
  baseReadiness,
  baseTiming,
  baseChaseRisk,
  setupType,
  direction,
  rawSetup,
  currentPrice,
  degreeState,
  targets,
  engine16,
  engine25Context,
  marketRegime,
} = {}) {
  const supportiveContext = buildSupportiveContext({
    setupType,
    direction,
    timing: baseTiming,
    chaseRisk: baseChaseRisk,
    rawSetup,
    readiness: baseReadiness,
    engine16,
    engine25Context,
    marketRegime,
  });

  const reclaimContext = buildPostExtensionReclaimContext({
    setupType,
    direction,
    rawSetup,
    baseTiming,
    baseReadiness,
    baseChaseRisk,
    currentPrice,
    degreeState,
    targets,
    engine16,
    engine25Context,
    marketRegime,
  });

  if (reclaimContext.reclaimAllowed) {
    return {
      readiness: "POST_EXTENSION_RECLAIM_WATCH",
      timing: "RECLAIM_AFTER_EXTENSION",
      chaseRisk: "MODERATE",
      supportiveContext,
      reclaimContext,
      armingReasonCodes: [
        "POST_EXTENSION_RECLAIM_WATCH",
        "NO_BLIND_CHASE",
        "CONTROLLED_PULLBACK_AFTER_EXTENSION",
        "ENGINE16_READY",
        "ENGINE25_SUPPORTIVE_CONTEXT",
        "MARKET_REGIME_SUPPORTIVE_CONTEXT",
      ],
      armingNeeds: [
        "CONTROLLED_RECLAIM_CONFIRMATION",
        "WAITING_FOR_ENGINE15_REFEREE",
        "WAITING_FOR_ENGINE5_CONFIRMATION",
        "ENGINE4_VOLUME_RISK_CLEARANCE",
      ],
    };
  }

  if (supportiveContext.armingAllowed) {
    return {
      readiness: "ARMING",
      timing: baseTiming,
      chaseRisk: baseChaseRisk,
      supportiveContext,
      reclaimContext,
      armingReasonCodes: [
        `${setupType}_ARMING`,
        "ENGINE16_READY",
        "ENGINE25_SUPPORTIVE_CONTEXT",
        "MARKET_REGIME_SUPPORTIVE_CONTEXT",
        "PRE_EXTENSION_NOT_CHASE",
      ],
      armingNeeds: [
        "WAITING_FOR_ENGINE15_REFEREE",
        "WAITING_FOR_ENGINE4_PARTICIPATION",
        "WAITING_FOR_ENGINE5_CONFIRMATION",
      ],
    };
  }

  return {
    readiness: baseReadiness,
    timing: baseTiming,
    chaseRisk: baseChaseRisk,
    supportiveContext,
    reclaimContext,
    armingReasonCodes: [],
    armingNeeds: [],
  };
}

function isCompleteW5Degree(degreeState = null) {
  return (
    upper(degreeState?.phase, "") === "COMPLETE_W5" ||
    upper(degreeState?.confirmedPhase, "") === "COMPLETE_W5" ||
    upper(degreeState?.state, "") === "IMPULSE_COMPLETE"
  );
}

function buildLowerDegreeCompletionGuard({
  degree,
  setupType,
  rawSetup,
  direction,
  waveFibState,
} = {}) {
  const idx = DEGREES.indexOf(String(degree || "").toLowerCase());
  if (idx < 0) return { active: false };

  const raw = upper(rawSetup, "");
  const degrees = waveFibState?.degrees || {};
  const activeDegreeState = degrees?.[degree] || null;

  const activeParentW5 =
    upper(activeDegreeState?.phase, "") === "IN_W5" ||
    raw.includes("W5_EXTENSION");

  if (setupType !== "W4_TO_W5") return { active: false };
  if (direction !== "LONG") return { active: false };
  if (!activeParentW5) return { active: false };

  const lowerDegrees = DEGREES.slice(idx + 1);
  const immediateLower = lowerDegrees[0] || null;

  const completedLowerDegrees = lowerDegrees.filter((d) =>
    isCompleteW5Degree(degrees?.[d])
  );

  const immediateLowerComplete =
    immediateLower && isCompleteW5Degree(degrees?.[immediateLower]);

  if (!immediateLowerComplete) return { active: false };

  return {
    active: true,
    completedLowerDegrees,
    immediateLower,
    reasonCodes: [
      "PARENT_W5_CONTEXT_ONLY",
      "LOWER_DEGREE_W5_COMPLETE",
      `${upper(immediateLower)}_W5_COMPLETE`,
      "TRADEABLE_LOWER_DEGREE_RESET_NEEDED",
      "NO_PARENT_W5_LONG_CONTINUATION_AFTER_LOWER_DEGREE_COMPLETION",
    ],
    needs: [
      "LOWER_DEGREE_RESET_NEEDED",
      "WAIT_FOR_ABC_COMPLETION",
      "WAIT_FOR_NEW_W2_OR_W4_SETUP",
      "NO_NEW_LONG_FROM_PARENT_W5_CONTEXT",
    ],
    summary: `${upper(
      degree
    )} W5 remains parent context, but lower-degree W5 structure is complete (${completedLowerDegrees
      .map((d) => upper(d))
      .join(
        ", "
      )}). Engine 22 should not expose this as a fresh long continuation opportunity until a new lower-degree W2/W4 setup forms or the ABC correction completes.`,
  };
}

function buildPostW5AbcCorrectionMap({ symbol, waveFibState } = {}) {
  const degrees = waveFibState?.degrees || {};

  const candidateDegree =
    ["micro", "minute", "minor"].find((degree) => {
      const d = degrees?.[degree];
      return (
        isCompleteW5Degree(d) &&
        toNum(d?.aLow) !== null &&
        toNum(d?.bHigh) !== null &&
        toNum(d?.aLow) > 0 &&
        toNum(d?.bHigh) > 0
      );
    }) || null;

  if (!candidateDegree) {
    return {
      ok: true,
      active: false,
      engine: "engine22.postW5AbcCorrection.v1",
      state: "NO_POST_W5_ABC_MARKS",
      reasonCodes: ["NO_COMPLETE_W5_DEGREE_WITH_A_B_MARKS"],
    };
  }

  const d = degrees[candidateDegree];
  const aLow = toNum(d?.aLow);
  const bHigh = toNum(d?.bHigh);
  const cLow = toNum(d?.cLow);

  const range = Math.abs(bHigh - aLow);
  const downsideFromB = (fib) => roundToTick(bHigh - range * fib);

  return {
    ok: true,
    active: true,
    engine: "engine22.postW5AbcCorrection.v1",
    symbol,
    degree: candidateDegree,
    timeframe: d?.tf || null,
    correctionFor: `${String(candidateDegree).toUpperCase()}_COMPLETE_W5`,
    state: cLow !== null && cLow > 0 ? "ABC_COMPLETE" : "C_LEG_ACTIVE",

    a: {
      label: "A",
      price: roundToTick(aLow),
    },

    b: {
      label: "B",
      price: roundToTick(bHigh),
    },

    c:
      cLow !== null && cLow > 0
        ? {
            label: "C",
            price: roundToTick(cLow),
          }
        : null,

    range: roundToTick(range),

    reclaimLevels: {
      r382: roundToTick(aLow + range * 0.382),
      r500: roundToTick(aLow + range * 0.5),
      r618: roundToTick(aLow + range * 0.618),
      r786: roundToTick(aLow + range * 0.786),
    },

    downsideTargets: {
      c100: downsideFromB(1.0),
      c1272: downsideFromB(1.272),
      c1618: downsideFromB(1.618),
      c200: downsideFromB(2.0),
      c2618: downsideFromB(2.618),
    },

    needs: [
      "C_LEG_CONFIRMATION",
      "WAIT_FOR_ABC_COMPLETION",
      "NO_NEW_LONG_UNTIL_RECLAIM_OR_NEW_W2_W4",
    ],

    reasonCodes: [
      "POST_W5_ABC_MARKS_FOUND",
      `${String(candidateDegree).toUpperCase()}_W5_COMPLETE`,
      "A_B_MARKS_VALID",
      cLow !== null && cLow > 0 ? "C_MARK_COMPLETE" : "C_LEG_PENDING",
      "LOWER_DEGREE_W5_COMPLETE_CORRECTION_ACTIVE",
    ],

    summary:
      cLow !== null && cLow > 0
        ? `${String(candidateDegree).toUpperCase()} W5 is complete and ABC correction marks are complete.`
        : `${String(candidateDegree).toUpperCase()} W5 is complete. A and B are marked; C leg is active/pending. Watch C downside targets and wait for ABC completion or a new lower-degree W2/W4 setup before re-arming longs.`,
  };
}

function buildNeeds({
  setupType,
  rawSetup,
  timing,
  tradeDecision,
  w4Levels,
  targets,
  readiness,
  armingNeeds = [],
} = {}) {
  const needs = [];

  if (setupType === "NONE") {
    needs.push("VALID_W3_OR_W5_OPPORTUNITY");
    return needs;
  }

  if (readiness === "ARMING" || readiness === "POST_EXTENSION_RECLAIM_WATCH") {
    needs.push(...armingNeeds);
  }

  const isReclaimWatch = readiness === "POST_EXTENSION_RECLAIM_WATCH";

  if (
    !isReclaimWatch &&
    (timing === "LATE" ||
      timing === "POST_EXTENSION" ||
      upper(rawSetup, "").includes("W5_EXTENSION"))
  ) {
    needs.push("NO_CHASE_LONG");
    needs.push("CONTROLLED_PULLBACK_OR_RECLAIM");
  }

  if (setupType === "W2_TO_W3") {
    needs.push("W2_LEVELS_NEEDED");
  }

  if (setupType === "W4_TO_W5" && !w4Levels) {
    needs.push(
      isReclaimWatch
        ? "CONTROLLED_RECLAIM_CONFIRMATION"
        : "CONTROLLED_PULLBACK_OR_RECLAIM"
    );
  }

  if (!hasAnyTarget(targets)) {
    needs.push("FIB_TARGETS_NEEDED");
  }

  if (tradeDecision?.engine4Confirmed === false) {
    needs.push("ENGINE4_PARTICIPATION_CONFIRMATION");
  }

  if (tradeDecision?.engine15Ready === false || tradeDecision?.entryAllowed === false) {
    needs.push("ENGINE15_READY_OR_PAPER_READY");
  }

  return [...new Set(needs)];
}

function buildReasonCodes({
  setupType,
  rawSetup,
  degree,
  timing,
  readiness,
  chaseRisk,
  armingReasonCodes = [],
} = {}) {
  const codes = [];

  if (setupType === "NONE") {
    return ["NO_W3_W5_OPPORTUNITY"];
  }

  codes.push("ENGINE22_W3_W5_OPPORTUNITY_FOUND");
  codes.push(`SETUP_FAMILY_${setupType}`);
  codes.push(`RAW_SETUP_${upper(rawSetup, "UNKNOWN")}`);
  codes.push(`ACTIVE_DEGREE_${upper(degree, "UNKNOWN")}`);
  codes.push(`TIMING_${upper(timing, "UNKNOWN")}`);
  codes.push(`READINESS_${upper(readiness, "UNKNOWN")}`);
  codes.push(`CHASE_RISK_${upper(chaseRisk, "UNKNOWN")}`);

  if (readiness === "ARMING") {
    codes.push("ENGINE22_ARMING_LIFECYCLE_ACTIVE");
    codes.push(...armingReasonCodes);
  }

  if (readiness === "POST_EXTENSION_RECLAIM_WATCH") {
    codes.push("ENGINE22_POST_EXTENSION_RECLAIM_WATCH");
    codes.push(...armingReasonCodes);
  }

  if (
    readiness !== "POST_EXTENSION_RECLAIM_WATCH" &&
    (timing === "LATE" || timing === "POST_EXTENSION")
  ) {
    codes.push("NO_CHASE_LONG");
  }

  return [...new Set(codes)];
}

function buildSummary({
  symbol,
  setupType,
  degree,
  rawSetup,
  timing,
  readiness,
  degreeState,
  chaseRisk,
} = {}) {
  if (setupType === "NONE") {
    return `${symbol} has no valid Elliott Wave 3 or Wave 5 opportunity active. Engine 22 is waiting for a valid W2→W3 or W4→W5 structure.`;
  }

  const degreeLabel = String(degree || "unknown").toUpperCase();
  const nearestFibPrice = getNearestFibPrice(degreeState);
  const highestHit = getExtensionHit(degreeState?.extensionProgress);

  if (readiness === "POST_EXTENSION_RECLAIM_WATCH") {
    return `${degreeLabel} post-extension reclaim watch is active. The first extension already happened, so this is not a blind chase entry. Price has pulled back from extension and Engine16 / Engine25 / market regime support a controlled continuation watch. Wait for Engine15 readiness, Engine5 confirmation, and volume-risk clearance.`;
  }

  if (readiness === "ARMING") {
    if (setupType === "W4_TO_W5") {
      return `${degreeLabel} W4→W5 opportunity is ARMING. Wave structure, Engine16, Engine25, and market regime are supportive, but this is not a trade signal. Wait for Engine 15 readiness, clean participation, and confirmation.`;
    }

    if (setupType === "W2_TO_W3") {
      return `${degreeLabel} W2→W3 opportunity is ARMING. Wave structure, Engine16, Engine25, and market regime are supportive, but this is not a trade signal. Wait for Engine 15 readiness, clean participation, and confirmation.`;
    }
  }

  if (setupType === "W4_TO_W5" && upper(rawSetup, "").includes("W5_EXTENSION")) {
    const hitText =
      highestHit !== null && nearestFibPrice !== null
        ? ` Price has already tagged the ${highestHit} extension near ${nearestFibPrice}.`
        : "";

    return `${degreeLabel} W5 extension is active after W4.${hitText} This is a ${timing.toLowerCase()} continuation watch, not a chase entry. Wait for controlled pullback/reclaim, Engine 4 participation, and Engine 15 readiness.`;
  }

  if (setupType === "W4_TO_W5") {
    return `${degreeLabel} W4→W5 opportunity is active. Engine 22 is tracking W5 targets while Engine 15 waits for final readiness. Chase risk is ${chaseRisk}.`;
  }

  if (setupType === "W2_TO_W3") {
    return `${degreeLabel} W2→W3 opportunity is active. Engine 22 is tracking W3 target potential while waiting for clean reclaim/confirmation. Readiness is ${readiness}.`;
  }

  return `${symbol} Engine 22 wave opportunity state is ${setupType}.`;
}

export function buildWaveOpportunity({
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
  currentPrice = null,
  engine22WaveStrategy = {},

  // Engine 22F read-only supportive context.
  // These can only upgrade WATCH -> ARMING / POST_EXTENSION_RECLAIM_WATCH.
  // They must never create READY, GO, ALLOW, executable, or trade permission.
  engine16 = null,
  engine25Context = null,
  marketRegime = null,
  marketMeterContext = null,
  engine5 = null,
} = {}) {
  const waveFibState = engine22WaveStrategy?.waveFibState || null;

  const degree = normalizeDegree(
    engine22WaveStrategy?.activeTradingDegree ||
      waveFibState?.activeTradingDegree
  );

  const rawSetup = cleanString(
    engine22WaveStrategy?.activeSetup ||
      waveFibState?.activeSetup ||
      "NO_SETUP",
    "NO_SETUP"
  );

  const degreeState =
    degree !== "unknown" ? waveFibState?.degrees?.[degree] || {} : {};

  const setupType = normalizeSetupType(rawSetup);
  const direction = normalizeDirection(setupType, degreeState);

  const w4Levels =
    engine22WaveStrategy?.w4Levels ||
    degreeState?.w4Levels ||
    null;

  const targets = buildTargets({ degreeState, w4Levels });
  const entryZone = buildEntryZone({ setupType, w4Levels });
  const invalidation = buildInvalidation({ setupType, w4Levels });

  const baseTiming = buildTiming({
    setupType,
    rawSetup,
    degreeState,
  });

  const baseReadiness = buildReadiness({
    setupType,
    timing: baseTiming,
    degreeState,
    invalidation,
  });

  const baseChaseRisk = normalizeChaseRisk(
    engine22WaveStrategy?.chaseRisk,
    waveFibState?.chaseRisk,
    degreeState?.fibPressure?.chaseRisk
  );

  const lifecycle = applyArmingLifecycle({
    baseReadiness,
    baseTiming,
    baseChaseRisk,
    setupType,
    direction,
    rawSetup,
    currentPrice,
    degreeState,
    targets,
    engine16,
    engine25Context,
    marketRegime,
  });

  const lowerDegreeCompletionGuard = buildLowerDegreeCompletionGuard({
    degree,
    setupType,
    rawSetup,
    direction,
    waveFibState,
  });

  const postW5AbcCorrection = lowerDegreeCompletionGuard.active
    ? buildPostW5AbcCorrectionMap({
        symbol,
        waveFibState,
      })
    : {
        ok: true,
        active: false,
        engine: "engine22.postW5AbcCorrection.v1",
        state: "NOT_PARENT_CONTEXT_ONLY",
        reasonCodes: ["LOWER_DEGREE_COMPLETION_GUARD_NOT_ACTIVE"],
      };

  const finalSetupType = lowerDegreeCompletionGuard.active ? "NONE" : setupType;
  const finalDirection = lowerDegreeCompletionGuard.active ? "NONE" : direction;

  const readiness = lowerDegreeCompletionGuard.active
    ? "NO_SETUP"
    : lifecycle.readiness;

  const timing = lowerDegreeCompletionGuard.active
    ? "POST_EXTENSION"
    : lifecycle.timing;

  const chaseRisk = lowerDegreeCompletionGuard.active
    ? "EXTREME"
    : lifecycle.chaseRisk;

  const tradeDecision = engine22WaveStrategy?.tradeDecision || {};
  const active = finalSetupType !== "NONE";

  const needs = [
    ...buildNeeds({
      setupType: finalSetupType,
      rawSetup,
      timing,
      tradeDecision,
      w4Levels,
      targets,
      readiness,
      armingNeeds: lifecycle.armingNeeds,
    }),
    ...(lowerDegreeCompletionGuard.active
      ? lowerDegreeCompletionGuard.needs
      : []),
    ...(postW5AbcCorrection?.active && Array.isArray(postW5AbcCorrection?.needs)
      ? postW5AbcCorrection.needs
      : []),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  const reasonCodes = [
    ...buildReasonCodes({
      setupType: finalSetupType,
      rawSetup,
      degree,
      timing,
      readiness,
      chaseRisk,
      armingReasonCodes: lifecycle.armingReasonCodes,
    }),
    ...(lowerDegreeCompletionGuard.active
      ? lowerDegreeCompletionGuard.reasonCodes
      : []),
    ...(postW5AbcCorrection?.active && Array.isArray(postW5AbcCorrection?.reasonCodes)
      ? postW5AbcCorrection.reasonCodes
      : []),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  const summary =
    lowerDegreeCompletionGuard.active && postW5AbcCorrection?.active
      ? `${lowerDegreeCompletionGuard.summary} ${postW5AbcCorrection.summary}`
      : lowerDegreeCompletionGuard.active
      ? lowerDegreeCompletionGuard.summary
      : buildSummary({
          symbol,
          setupType: finalSetupType,
          degree,
          rawSetup,
          timing,
          readiness,
          degreeState,
          chaseRisk,
        });

  return {
    ok: true,
    engine: "engine22.waveOpportunity.v1",
    symbol,
    strategyId,
    currentPrice: round2(currentPrice),

    active,
    setupFamily: active ? "ELLIOTT_WAVE" : "PARENT_CONTEXT_ONLY",

    setupType: finalSetupType,
    rawSetup,
    degree,
    direction: finalDirection,

    parentContextOnly: lowerDegreeCompletionGuard.active,
    tradeableOpportunityBlocked: lowerDegreeCompletionGuard.active,

    abcCorrection: postW5AbcCorrection,

    readiness,
    timing,

    waveState: buildWaveState(waveFibState),

    entryZone,

    invalidation: {
      price: invalidation.price,
      reason: invalidation.reason,
    },

    targets,

    chaseRisk,

    needs,

    reasonCodes,

    summary,

    // Diagnostic/read-only only.
    // Engine 6 must not use this as final permission.
    supportiveContext: lifecycle.supportiveContext,

    // Diagnostic/read-only only.
    // Lets replay prove whether post-extension reclaim was allowed or blocked.
    reclaimContext: lifecycle.reclaimContext,

    // Reserved for future replay/outcome learning.
    learningContext: {
      engine: "engine22.waveOpportunityLearningContext.v1",
      setupType: finalSetupType,
      direction: finalDirection,
      timing,
      readiness,
      chaseRisk,
      degree,
      currentPrice: round2(currentPrice),
      engine25Score: lifecycle.supportiveContext?.engine25Score ?? null,
      engine25Regime: lifecycle.supportiveContext?.engine25Regime ?? null,
      engine25Permission: lifecycle.supportiveContext?.engine25Permission ?? null,
      marketRegimeDirection:
        lifecycle.supportiveContext?.marketRegimeDirection ?? null,
      marketRegimeStrictness:
        lifecycle.supportiveContext?.marketRegimeStrictness ?? null,
      engine16Ready: lifecycle.supportiveContext?.engine16Ready ?? false,
      armingAllowed: lifecycle.supportiveContext?.armingAllowed ?? false,
      postExtensionReclaimAllowed:
        lifecycle.reclaimContext?.reclaimAllowed ?? false,
      parentContextOnly: lowerDegreeCompletionGuard.active,
      tradeableOpportunityBlocked: lowerDegreeCompletionGuard.active,
      abcCorrectionActive: postW5AbcCorrection?.active === true,
    },

    // Diagnostics only.
    lowerDegreeCompletionGuard,
    postW5AbcCorrection,

    // Kept available for diagnostics but not used for permission.
    debugContextAvailable: {
      engine16: engine16 ? true : false,
      engine25Context: engine25Context ? true : false,
      marketRegime: marketRegime ? true : false,
      marketMeterContext: marketMeterContext ? true : false,
      engine5: engine5 ? true : false,
    },
  };
}

export default buildWaveOpportunity;

