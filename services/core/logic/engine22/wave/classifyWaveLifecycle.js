// services/core/logic/engine22/wave/classifyWaveLifecycle.js
// Engine 22L — Central Wave Lifecycle Classifier
//
// Purpose:
// One source of truth for post-W5 lifecycle state.
// This file decides:
// - parent W5 context only
// - lower-degree W5 completion
// - post-W5 ABC correction active
// - C-leg pending vs ABC complete
// - whether parent W5 should be blocked as a fresh tradeable long
//
// This file is read-only.
// It does not execute trades.
// It does not create shorts.
// It does not change Engine 6 permission.

const DEGREE_ORDER = ["primary", "intermediate", "minor", "minute", "micro"];

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function upper(x, fallback = "UNKNOWN") {
  return String(x || fallback).trim().toUpperCase();
}

function tickSizeForSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();

  if (
    s === "ES" ||
    s.startsWith("ES") ||
    s === "MES" ||
    s.startsWith("MES") ||
    s === "NQ" ||
    s.startsWith("NQ") ||
    s === "MNQ" ||
    s.startsWith("MNQ")
  ) {
    return 0.25;
  }

  return 0.01;
}

function roundToTick(value, tickSize = 0.01) {
  const n = toNum(value);
  if (n === null) return null;

  return Number((Math.round(n / tickSize) * tickSize).toFixed(2));
}

function isInW5(degreeState = null) {
  return (
    upper(degreeState?.phase, "") === "IN_W5" ||
    upper(degreeState?.confirmedPhase, "") === "IN_W5"
  );
}

function isCompleteW5(degreeState = null) {
  return (
    upper(degreeState?.phase, "") === "COMPLETE_W5" ||
    upper(degreeState?.confirmedPhase, "") === "COMPLETE_W5" ||
    upper(degreeState?.state, "") === "IMPULSE_COMPLETE"
  );
}

function hasAbcMarks(degreeState = null) {
  const aLow = toNum(degreeState?.aLow);
  const bHigh = toNum(degreeState?.bHigh);

  return aLow !== null && bHigh !== null && aLow > 0 && bHigh > 0;
}

function findParentW5Degrees(degrees = {}) {
  return DEGREE_ORDER.filter((degree) => isInW5(degrees?.[degree]));
}

function findCompletedW5Degrees(degrees = {}) {
  return DEGREE_ORDER.filter((degree) => isCompleteW5(degrees?.[degree]));
}

function findActiveAbcDegree(degrees = {}) {
  // Prefer higher execution correction before micro noise.
  // This prevents micro from stealing the active lifecycle when minute ABC is marked.
  const searchOrder = ["intermediate", "minor", "minute", "micro"];

  return (
    searchOrder.find((degree) => {
      const d = degrees?.[degree];
      return isCompleteW5(d) && hasAbcMarks(d);
    }) || null
  );
}

function buildAbcCorrection({ symbol, degree, degreeState } = {}) {
  if (!degree || !degreeState) {
    return {
      ok: true,
      active: false,
      engine: "engine22.waveLifecycle.abc.v1",
      state: "NO_POST_W5_ABC_MARKS",
      reasonCodes: ["NO_COMPLETE_W5_DEGREE_WITH_A_B_MARKS"],
    };
  }

  const tickSize = tickSizeForSymbol(symbol);

  const aLow = toNum(degreeState?.aLow);
  const bHigh = toNum(degreeState?.bHigh);
  const cLow = toNum(degreeState?.cLow);

  if (aLow === null || bHigh === null || aLow <= 0 || bHigh <= 0) {
    return {
      ok: true,
      active: false,
      engine: "engine22.waveLifecycle.abc.v1",
      state: "NO_POST_W5_ABC_MARKS",
      reasonCodes: ["NO_VALID_A_B_MARKS"],
    };
  }

  const range = Math.abs(bHigh - aLow);

  // Reclaim levels are measured from A back toward B.
  const reclaimFromA = (fib) => roundToTick(aLow + range * fib, tickSize);

  // Downside targets are measured from B down by A-B range extensions.
  const downsideFromB = (fib) => roundToTick(bHigh - range * fib, tickSize);

  const cMarked = cLow !== null && cLow > 0;

  return {
    ok: true,
    active: true,
    engine: "engine22.waveLifecycle.abc.v1",
    symbol,
    degree,
    timeframe: degreeState?.tf || null,
    correctionFor: `${String(degree).toUpperCase()}_COMPLETE_W5`,
    state: cMarked ? "ABC_COMPLETE" : "C_LEG_ACTIVE",

    a: {
      label: "A",
      price: roundToTick(aLow, tickSize),
    },

    b: {
      label: "B",
      price: roundToTick(bHigh, tickSize),
    },

    c: cMarked
      ? {
          label: "C",
          price: roundToTick(cLow, tickSize),
        }
      : null,

    range: roundToTick(range, tickSize),

    reclaimLevels: {
      r382: reclaimFromA(0.382),
      r500: reclaimFromA(0.5),
      r618: reclaimFromA(0.618),
      r786: reclaimFromA(0.786),
    },

    downsideTargets: {
      c100: downsideFromB(1),
      c1272: downsideFromB(1.272),
      c1618: downsideFromB(1.618),
      c200: downsideFromB(2),
      c2618: downsideFromB(2.618),
    },

    reasonCodes: [
      "POST_W5_ABC_MARKS_FOUND",
      cMarked ? "ABC_COMPLETE" : "C_LEG_PENDING",
    ],
  };
}

export function classifyWaveLifecycle({
  symbol = "SPY",
  waveFibState = null,
  currentPrice = null,
  engine16 = null,
  engine25Context = null,
  marketRegime = null,
} = {}) {
  const degrees = waveFibState?.degrees || {};

  const parentW5Degrees = findParentW5Degrees(degrees);
  const completedW5Degrees = findCompletedW5Degrees(degrees);
  const activeCorrectionDegree = findActiveAbcDegree(degrees);

  const abcCorrection = buildAbcCorrection({
    symbol,
    degree: activeCorrectionDegree,
    degreeState: activeCorrectionDegree ? degrees?.[activeCorrectionDegree] : null,
  });

  const hasParentW5Context = parentW5Degrees.length > 0;
  const hasLowerDegreeW5Complete = completedW5Degrees.length > 0;
  const correctionActive = abcCorrection?.active === true;
  const cLegActive = correctionActive && abcCorrection?.state === "C_LEG_ACTIVE";

  const parentContextOnly =
    hasParentW5Context && (hasLowerDegreeW5Complete || correctionActive);

  const tradeableOpportunityBlocked =
    parentContextOnly || cLegActive || correctionActive;

  const lifecycleState = cLegActive
    ? "ABC_C_LEG_ACTIVE"
    : correctionActive && abcCorrection?.state === "ABC_COMPLETE"
    ? "POST_W5_ABC_COMPLETE"
    : parentContextOnly
    ? "PARENT_W5_CONTEXT_ONLY"
    : hasParentW5Context
    ? "PARENT_W5_ACTIVE"
    : "NORMAL_WAVE_LIFECYCLE";

  const nextAllowedSetup = tradeableOpportunityBlocked
    ? "WAIT_FOR_ABC_COMPLETION_OR_NEW_W2_W4_SETUP"
    : "VALID_W2_W4_OR_PRE_EXTENSION_SETUP_REQUIRED";

  const headline = tradeableOpportunityBlocked
    ? "LOWER-DEGREE W5 COMPLETE — ABC CORRECTION WATCH"
    : hasParentW5Context
    ? "PARENT W5 CONTEXT ACTIVE"
    : "WAVE LIFECYCLE NORMAL";

  const summary = tradeableOpportunityBlocked
    ? `${symbol} has parent W5 context, but lower-degree W5 completion / ABC correction marks are active. Do not treat the parent W5 as a fresh long continuation. Wait for ABC completion or a new lower-degree W2/W4 setup.`
    : `${symbol} lifecycle does not currently block a valid lower-degree W2/W4 setup.`;

  const needs = tradeableOpportunityBlocked
    ? [
        "WAIT_FOR_ABC_COMPLETION",
        "WAIT_FOR_NEW_W2_OR_W4_SETUP",
        "NO_NEW_LONG_FROM_PARENT_W5_CONTEXT",
      ]
    : ["VALID_PRE_EXTENSION_W2_OR_W4_SETUP"];

  const reasonCodes = [
    "ENGINE22_WAVE_LIFECYCLE_BUILT",
    parentContextOnly ? "PARENT_W5_CONTEXT_ONLY" : null,
    hasLowerDegreeW5Complete ? "LOWER_DEGREE_W5_COMPLETE" : null,
    correctionActive ? "POST_W5_ABC_MARKS_FOUND" : null,
    cLegActive ? "C_LEG_PENDING" : null,
    tradeableOpportunityBlocked
      ? "NO_PARENT_W5_LONG_CONTINUATION_AFTER_LOWER_DEGREE_COMPLETION"
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    engine: "engine22.waveLifecycle.v1",
    symbol,
    currentPrice: roundToTick(currentPrice, tickSizeForSymbol(symbol)),

    lifecycleState,

    parentContextOnly,
    tradeableOpportunityBlocked,

    correctionActive,
    activeCorrectionDegree,

    parentW5Degrees,
    completedW5Degrees,

    abcCorrection,

    nextAllowedSetup,
    headline,
    summary,
    needs,
    reasonCodes,

    context: {
      engine16Ready: upper(engine16?.readiness, "") === "READY",
      engine25ContextProvided: engine25Context != null,
      marketRegimeProvided: marketRegime != null,
    },
  };
}

export default classifyWaveLifecycle;
