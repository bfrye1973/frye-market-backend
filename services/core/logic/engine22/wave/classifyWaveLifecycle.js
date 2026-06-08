// services/core/logic/engine22/wave/classifyWaveLifecycle.js
// Engine 22L — Central Wave Lifecycle Classifier
//
// Purpose:
// One source of truth for wave lifecycle state.
// This file decides:
// - W2→W3 lifecycle
// - W3 extension lifecycle
// - W4 pullback lifecycle
// - W4→W5 lifecycle
// - W5 complete lifecycle
// - post-W5 ABC lifecycle
// - post-ABC reset / Wave 2 bounce watch lifecycle
// - parent W5 context only
// - whether parent W5 should be blocked as a fresh tradeable long
//
// This file is read-only.
// It does not execute trades.
// It does not create shorts.
// It does not change Engine 6 permission.
// It does not consume Engine 25 market context for wave lifecycle decisions.

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

function isEsLikeSymbol(symbol) {
const s = String(symbol || "").trim().toUpperCase();
return s === "ES" || s.startsWith("ES") || s === "MES" || s.startsWith("MES");
}

function buildPostAbcBounceMap({ symbol, abcUpMarks = null } = {}) {
  const tickSize = tickSizeForSymbol(symbol);

  const originLow = toNum(abcUpMarks?.originLow);
  const aHigh = toNum(abcUpMarks?.aHigh);
  const bLow = toNum(abcUpMarks?.bLow);
  const cHigh = toNum(abcUpMarks?.cHigh);

  const originTime = abcUpMarks?.originTime || null;
  const aTime = abcUpMarks?.aTime || null;
  const bTime = abcUpMarks?.bTime || null;
  const cTime = abcUpMarks?.cTime || null;

  if (originLow === null || originLow <= 0 || aHigh === null || aHigh <= 0) {
    return {
      active: false,
      state: "ABC_UP_MARKS_UNAVAILABLE",

      originLow: originLow !== null ? roundToTick(originLow, tickSize) : null,
      originTime,

      waveAHigh: aHigh !== null ? roundToTick(aHigh, tickSize) : null,
      aTime,

      waveBLow: bLow !== null ? roundToTick(bLow, tickSize) : null,
      bTime,

      waveCHigh: cHigh !== null ? roundToTick(cHigh, tickSize) : null,
      cTime,

      range: null,
      bPullbackLevels: null,
      preferredBZone: null,
      deepBSupport: null,
      bPullbackStatus: "ORIGIN_LOW_AND_A_HIGH_REQUIRED",

      reasonCodes: ["ABC_UP_ORIGIN_LOW_AND_A_HIGH_REQUIRED"],
    };
  }

  const range = Math.abs(aHigh - originLow);

  const pullbackFromAHigh = (fib) =>
    roundToTick(aHigh - range * fib, tickSize);

  const r236 = pullbackFromAHigh(0.236);
  const r382 = pullbackFromAHigh(0.382);
  const r500 = pullbackFromAHigh(0.5);
  const r618 = pullbackFromAHigh(0.618);
  const r786 = pullbackFromAHigh(0.786);

  const bMarked = bLow !== null && bLow > 0;
  const cMarked = cHigh !== null && cHigh > 0;

  const state = !bMarked
    ? "A_UP_MARKED_WAITING_FOR_B_PULLBACK"
    : !cMarked
    ? "B_PULLBACK_MARKED_WAITING_FOR_C_UP"
    : "ABC_UP_COMPLETE";

  const bPullbackStatus = !bMarked
    ? "WAITING_FOR_B_PULLBACK"
    : !cMarked
    ? "B_PULLBACK_MARKED"
    : "ABC_UP_COMPLETE";

  return {
    active: true,
    state,

    originLow: roundToTick(originLow, tickSize),
    originTime,

    waveAHigh: roundToTick(aHigh, tickSize),
    aTime,

    waveBLow: bMarked ? roundToTick(bLow, tickSize) : null,
    bTime: bMarked ? bTime : null,

    waveCHigh: cMarked ? roundToTick(cHigh, tickSize) : null,
    cTime: cMarked ? cTime : null,

    range: roundToTick(range, tickSize),

    bPullbackLevels: {
      r236,
      r382,
      r500,
      r618,
      r786,
    },

    preferredBZone: {
      lo: r618,
      hi: r500,
    },

    deepBSupport: r786,
    bPullbackStatus,

    reasonCodes: [
      "POST_ABC_BOUNCE_MARKS_FOUND",
      "ABC_UP_A_HIGH_MARKED",
      bMarked ? "ABC_UP_B_LOW_MARKED" : "ABC_UP_WAITING_FOR_B_PULLBACK",
      cMarked ? "ABC_UP_C_HIGH_MARKED" : "ABC_UP_C_HIGH_PENDING",
    ],
  };
}

function classifyPostAbcReset({
  symbol,
  currentPrice,
  abcCorrection,
  abcUpMarks = null,
} = {}) {
  const tickSize = tickSizeForSymbol(symbol);
  const abcUp = buildPostAbcBounceMap({ symbol, abcUpMarks });

  const price = toNum(currentPrice);
  const cLow = toNum(abcCorrection?.c?.price);
  const abcState = upper(abcCorrection?.state, "");

  if (abcState !== "ABC_COMPLETE" || cLow === null || cLow <= 0) {
    return {
      active: false,
      abcUp,
      state: "POST_ABC_RESET_UNAVAILABLE",
      supportLevel: null,
      watchZoneLow: null,
      watchZoneHigh: null,
      cLow: cLow !== null ? roundToTick(cLow, tickSize) : null,
      currentPrice: roundToTick(price, tickSize),
      supportStatus: "ABC_COMPLETE_WITH_C_LOW_REQUIRED",
      nextExpectedMove: "UNKNOWN",
      preferredEntry: null,
      paperSignalCandidate: false,
      signalType: null,
      tradeableOpportunityBlocked: true,
      reclaimLevel: null,
      needs: ["ABC_COMPLETE_WITH_C_LOW_REQUIRED"],
      reasonCodes: ["POST_ABC_RESET_UNAVAILABLE"],
    };
  }

  const roundedPrice = roundToTick(price, tickSize);
  const roundedCLow = roundToTick(cLow, tickSize);

  if (!isEsLikeSymbol(symbol)) {
    return {
      active: true,
      abcUp,
      state: "POST_ABC_RESET_WAIT",
      supportLevel: null,
      watchZoneLow: null,
      watchZoneHigh: null,
      cLow: roundedCLow,
      currentPrice: roundedPrice,
      supportStatus: "NON_ES_GENERIC_POST_ABC_RESET",
      nextExpectedMove: "WAIT_FOR_NEW_STRUCTURE",
      preferredEntry: "WAIT_FOR_NEW_W1_OR_W2_STRUCTURE",
      paperSignalCandidate: false,
      signalType: null,
      tradeableOpportunityBlocked: true,
      reclaimLevel: null,
      needs: [
        "WAIT_FOR_NEW_W1_OR_W2_STRUCTURE",
        "RECLAIM_CONFIRMATION_REQUIRED",
      ],
      reasonCodes: [
        "POST_W5_ABC_COMPLETE",
        "ABC_COMPLETE",
        "NON_ES_POST_ABC_RESET_WAIT",
      ],
    };
  }

  const supportLevel = 7400;
  const watchZoneHigh = 7425;

  if (price === null) {
    return {
      active: true,
      abcUp,
      state: "POST_ABC_RESET_WAIT",
      supportLevel,
      watchZoneLow: roundedCLow,
      watchZoneHigh,
      cLow: roundedCLow,
      currentPrice: null,
      supportStatus: "PRICE_UNAVAILABLE",
      nextExpectedMove: "WAVE_2_BOUNCE_UP",
      preferredEntry: "WAIT_FOR_7400_HOLD_AND_RECLAIM",
      paperSignalCandidate: false,
      signalType: null,
      tradeableOpportunityBlocked: true,
      reclaimLevel: null,
      needs: [
        "CURRENT_PRICE_REQUIRED",
        "7400_SUPPORT_HOLD",
        "RECLAIM_CONFIRMATION_REQUIRED",
      ],
      reasonCodes: [
        "POST_W5_ABC_COMPLETE",
        "ABC_COMPLETE",
        "PRICE_UNAVAILABLE",
      ],
    };
  }

  if (price < cLow) {
    return {
      active: true,
      abcUp,
      state: "POST_ABC_LOW_FAILED",
      supportLevel,
      watchZoneLow: roundedCLow,
      watchZoneHigh,
      cLow: roundedCLow,
      currentPrice: roundedPrice,
      supportStatus: "C_LOW_FAILED",
      nextExpectedMove: "C_LEG_OR_WAVE_1_DOWN_EXTENDING",
      preferredEntry: "WAIT_FOR_LOWER_SUPPORT",
      paperSignalCandidate: false,
      signalType: null,
      tradeableOpportunityBlocked: true,
      reclaimLevel: null,
      needs: [
        "WAIT_FOR_LOWER_SUPPORT",
        "WAIT_FOR_NEW_STRUCTURE",
        "NO_WAVE_2_BOUNCE_SIGNAL",
      ],
      reasonCodes: [
        "POST_W5_ABC_COMPLETE",
        "ABC_COMPLETE",
        "C_LOW_FAILED",
        "POST_ABC_LOW_FAILED",
      ],
    };
  }

  const inSupportBand = price >= cLow && price <= watchZoneHigh;

  const supportStatus =
    price < supportLevel
      ? "WARNING_BELOW_7400_ABOVE_C_LOW"
      : inSupportBand
      ? "IN_7400_SUPPORT_HOLD_TEST"
      : "SUPPORT_HELD_WAITING_FOR_RECLAIM_CONFIRMATION";

  return {
    active: true,
    abcUp,
    state: "POST_ABC_W2_BOUNCE_WATCH",
    supportLevel,
    watchZoneLow: roundedCLow,
    watchZoneHigh,
    cLow: roundedCLow,
    currentPrice: roundedPrice,
    supportStatus,
    nextExpectedMove: "WAVE_2_BOUNCE_UP",
    preferredEntry: "WAIT_FOR_7400_HOLD_AND_RECLAIM",
    paperSignalCandidate: true,
    signalType: "POST_ABC_W2_BOUNCE_WATCH",
    tradeableOpportunityBlocked: true,
    reclaimLevel: null,
    needs: [
      "7400_SUPPORT_HOLD",
      "RECLAIM_CONFIRMATION_REQUIRED",
      "ENGINE15_READY",
      "ENGINE6_FINAL_PERMISSION",
    ],
    reasonCodes: [
      "POST_W5_ABC_COMPLETE",
      "ABC_COMPLETE",
      "C_LOW_MARKED",
      supportStatus,
      "INSTITUTIONAL_SUPPORT_TEST",
      "WAIT_FOR_W2_BOUNCE_CONFIRMATION",
    ],
  };
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

function hasCMark(degreeState = null) {
const cLow = toNum(degreeState?.cLow);
return cLow !== null && cLow > 0;
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

function getExtensionHit(degreeState = {}) {
return (
toNum(degreeState?.extensionProgress?.highestExtensionHit) ??
toNum(degreeState?.extensionProgress?.highestExtension) ??
toNum(degreeState?.extensionProgress?.extensionHit) ??
null
);
}

function hasW4Levels(degreeState = {}) {
return degreeState?.w4Levels && typeof degreeState.w4Levels === "object";
}

function hasFibProjection(degreeState = {}) {
return (
degreeState?.fibProjection &&
typeof degreeState.fibProjection === "object" &&
degreeState.fibProjection?.levels &&
typeof degreeState.fibProjection.levels === "object"
);
}

function classifyDegreeLifecycle({
degree,
degreeState = null,
isParentContextOnly = false,
isActiveCorrectionDegree = false,
} = {}) {
if (!degreeState || degreeState?.ok === false) {
return {
ok: false,
degree,
lifecycleState: "UNKNOWN",
phase: "UNKNOWN",
confirmedPhase: "UNKNOWN",
nextExpectedWave: "UNKNOWN",
allowedSetupFamily: "NONE",
tradeableCandidate: false,
tradeableOpportunityBlocked: false,
reasonCodes: ["DEGREE_STATE_UNAVAILABLE"],
};
}

const phase = upper(degreeState?.phase);
const confirmedPhase = upper(degreeState?.confirmedPhase);
const nextExpectedWave = upper(degreeState?.nextExpectedWave);
const state = upper(degreeState?.state, "");

const extensionHit = getExtensionHit(degreeState);
const hasProjection = hasFibProjection(degreeState);
const w4LevelsAvailable = hasW4Levels(degreeState);

const completeW5 = isCompleteW5(degreeState);
const inW5 = isInW5(degreeState);
const abcMarks = hasAbcMarks(degreeState);
const cMarked = hasCMark(degreeState);

if (isParentContextOnly && inW5) {
return {
ok: true,
degree,
lifecycleState: "W5_PARENT_CONTEXT_ACTIVE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "NONE",
tradeableCandidate: false,
tradeableOpportunityBlocked: true,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} W5 PARENT CONTEXT ACTIVE`,
summary:
"This W5 remains higher-degree context only because lower-degree W5 completion / ABC correction is active.",
needs: [
"WAIT_FOR_LOWER_DEGREE_RESET",
"WAIT_FOR_ABC_COMPLETION_OR_NEW_W2_W4_SETUP",
],
reasonCodes: [
"W5_PARENT_CONTEXT_ACTIVE",
"BLOCKED_BY_LOWER_DEGREE_COMPLETION_OR_ABC",
],
};
}

if (completeW5 && abcMarks && !cMarked) {
return {
ok: true,
degree,
lifecycleState: "POST_W5_ABC_C_LEG_ACTIVE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "NONE",
tradeableCandidate: false,
tradeableOpportunityBlocked: true,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} W5 COMPLETE — ABC C LEG ACTIVE`,
summary:
"W5 is complete. A and B are marked. C leg is pending/active.",
needs: [
"WAIT_FOR_ABC_COMPLETION",
"WAIT_FOR_NEW_W2_OR_W4_SETUP",
],
reasonCodes: [
"W5_COMPLETE",
"POST_W5_ABC_MARKS_FOUND",
"C_LEG_PENDING",
],
};
}

if (completeW5 && abcMarks && cMarked) {
return {
ok: true,
degree,
lifecycleState: "POST_W5_ABC_COMPLETE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "WAIT_FOR_NEW_STRUCTURE",
tradeableCandidate: false,
tradeableOpportunityBlocked: true,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} W5 COMPLETE — ABC COMPLETE`,
summary:
"W5 and ABC correction are complete. Wait for a new lower-degree W2/W4 setup before treating this as tradeable again.",
needs: ["WAIT_FOR_NEW_W2_OR_W4_SETUP"],
reasonCodes: [
"W5_COMPLETE",
"POST_W5_ABC_MARKS_FOUND",
"ABC_COMPLETE",
],
};
}

if (completeW5) {
return {
ok: true,
degree,
lifecycleState: "W5_COMPLETE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "NONE",
tradeableCandidate: false,
tradeableOpportunityBlocked: true,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} W5 COMPLETE`,
summary:
"W5 is complete. Do not treat this degree as a fresh continuation setup without a reset.",
needs: ["WAIT_FOR_NEW_W2_OR_W4_SETUP"],
reasonCodes: ["W5_COMPLETE"],
};
}

if (phase === "IN_W2") {
return {
ok: true,
degree,
lifecycleState: "W2_PULLBACK_ACTIVE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "W2_TO_W3",
tradeableCandidate: true,
tradeableOpportunityBlocked: false,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} W2 PULLBACK ACTIVE`,
summary:
"W2 pullback is active. The next valid bullish structure is W2→W3 only after reclaim/confirmation.",
needs: [
"WAIT_FOR_W2_RECLAIM",
"ENGINE15_READY_OR_PAPER_READY",
],
reasonCodes: ["W2_PULLBACK_ACTIVE", "NEXT_ALLOWED_W2_TO_W3"],
};
}

if (phase === "IN_W3") {
return {
ok: true,
degree,
lifecycleState: "W3_EXTENSION_ACTIVE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "W2_TO_W3",
tradeableCandidate: true,
tradeableOpportunityBlocked: false,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} W3 EXTENSION ACTIVE`,
summary:
"W3 expansion is active. Do not chase late extension; wait for controlled setup/confirmation.",
needs: [
"NO_CHASE_LONG",
"WAIT_FOR_CONTROLLED_RECLAIM_OR_PULLBACK",
],
reasonCodes: ["W3_EXTENSION_ACTIVE"],
};
}

if (
phase === "IN_W4" ||
confirmedPhase === "IN_W3" ||
nextExpectedWave === "W5"
) {
return {
ok: true,
degree,
lifecycleState: "W4_PULLBACK_ACTIVE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "W4_TO_W5",
tradeableCandidate: true,
tradeableOpportunityBlocked: false,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} W4 PULLBACK ACTIVE`,
summary:
"W4 pullback/reclaim structure is active. The next valid bullish structure is W4→W5 after confirmation.",
needs: [
"WAIT_FOR_W4_RECLAIM",
"ENGINE15_READY_OR_PAPER_READY",
],
reasonCodes: ["W4_PULLBACK_ACTIVE", "NEXT_ALLOWED_W4_TO_W5"],
};
}

if (inW5) {
const lateExtension =
extensionHit !== null && extensionHit >= 1.272;

return {
  ok: true,
  degree,
  lifecycleState: lateExtension
    ? "W5_EXTENSION_LATE"
    : "W5_EXTENSION_ACTIVE",
  phase,
  confirmedPhase,
  nextExpectedWave,
  allowedSetupFamily: "W4_TO_W5",
  tradeableCandidate: true,
  tradeableOpportunityBlocked: false,
  extensionHit,
  hasFibProjection: hasProjection,
  hasW4Levels: w4LevelsAvailable,
  headline: lateExtension
    ? `${String(degree).toUpperCase()} W5 EXTENSION LATE`
    : `${String(degree).toUpperCase()} W5 EXTENSION ACTIVE`,
  summary: lateExtension
    ? "W5 extension is late/post-extension. Do not chase; wait for controlled pullback/reclaim."
    : "W5 extension is active after W4. Continuation is possible only with confirmation.",
  needs: lateExtension
    ? ["NO_CHASE_LONG", "CONTROLLED_PULLBACK_OR_RECLAIM"]
    : ["WAIT_FOR_CONFIRMATION", "NO_BLIND_CHASE"],
  reasonCodes: lateExtension
    ? ["W5_EXTENSION_LATE", "NO_CHASE_LONG"]
    : ["W5_EXTENSION_ACTIVE"],
};
}

if (state === "IMPULSE_COMPLETE") {
return {
ok: true,
degree,
lifecycleState: "IMPULSE_COMPLETE",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "NONE",
tradeableCandidate: false,
tradeableOpportunityBlocked: true,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} IMPULSE COMPLETE`,
summary:
"Impulse is complete. Wait for reset or correction completion.",
needs: ["WAIT_FOR_NEW_STRUCTURE"],
reasonCodes: ["IMPULSE_COMPLETE"],
};
}

return {
ok: true,
degree,
lifecycleState: "UNKNOWN_OR_MIXED",
phase,
confirmedPhase,
nextExpectedWave,
allowedSetupFamily: "NONE",
tradeableCandidate: false,
tradeableOpportunityBlocked: false,
extensionHit,
hasFibProjection: hasProjection,
hasW4Levels: w4LevelsAvailable,
headline: `${String(degree).toUpperCase()} WAVE STATE MIXED`,
summary:
"This degree does not have a clean W2/W3/W4/W5 lifecycle state yet.",
needs: ["WAIT_FOR_CLEARER_WAVE_MARKS"],
reasonCodes: ["UNKNOWN_OR_MIXED_WAVE_LIFECYCLE"],
};
}

function buildDegreeLifecycle({
degrees = {},
parentContextOnly = false,
parentW5Degrees = [],
activeCorrectionDegree = null,
} = {}) {
const out = {};

for (const degree of DEGREE_ORDER) {
out[degree] = classifyDegreeLifecycle({
degree,
degreeState: degrees?.[degree] || null,
isParentContextOnly:
parentContextOnly && parentW5Degrees.includes(degree),
isActiveCorrectionDegree: activeCorrectionDegree === degree,
});
}

return out;
}

function pickActiveDegreeLifecycle({ degreeLifecycle = {}, masterBlocked = false } = {}) {
if (masterBlocked) return null;

const searchOrder = ["micro", "minute", "minor", "intermediate", "primary"];

return (
searchOrder.find((degree) => {
const d = degreeLifecycle?.[degree];
return (
d?.tradeableCandidate === true &&
d?.tradeableOpportunityBlocked !== true
);
}) || null
);
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

const degreeLifecycle = buildDegreeLifecycle({
degrees,
parentContextOnly,
parentW5Degrees,
activeCorrectionDegree,
});

const activeDegreeLifecycle = pickActiveDegreeLifecycle({
degreeLifecycle,
masterBlocked: tradeableOpportunityBlocked,
});

const activeAllowedSetupFamily =
activeDegreeLifecycle && degreeLifecycle?.[activeDegreeLifecycle]
? degreeLifecycle[activeDegreeLifecycle].allowedSetupFamily
: "NONE";

const lifecycleState = cLegActive
? "ABC_C_LEG_ACTIVE"
: correctionActive && abcCorrection?.state === "ABC_COMPLETE"
? "POST_W5_ABC_COMPLETE"
: parentContextOnly
? "PARENT_W5_CONTEXT_ONLY"
: hasParentW5Context
? "PARENT_W5_ACTIVE"
: activeDegreeLifecycle
? degreeLifecycle?.[activeDegreeLifecycle]?.lifecycleState ||
"NORMAL_WAVE_LIFECYCLE"
: "NORMAL_WAVE_LIFECYCLE";

const postAbcReset =
  lifecycleState === "POST_W5_ABC_COMPLETE"
    ? classifyPostAbcReset({
        symbol,
        currentPrice,
        abcCorrection,
        abcUpMarks: activeCorrectionDegree
          ? degrees?.[activeCorrectionDegree]?.abcUpMarks || null
          : null,
      })
    : {
        active: false,
        state: "NOT_POST_W5_ABC_COMPLETE",
        reasonCodes: ["POST_ABC_RESET_NOT_APPLICABLE"],
      };

const postAbcWatchActive =
postAbcReset?.state === "POST_ABC_W2_BOUNCE_WATCH";

const postAbcLowFailed =
postAbcReset?.state === "POST_ABC_LOW_FAILED";

const nextAllowedSetup = postAbcWatchActive
? "WAIT_FOR_7400_HOLD_AND_RECLAIM"
: postAbcLowFailed
? "WAIT_FOR_LOWER_SUPPORT_OR_NEW_STRUCTURE"
: tradeableOpportunityBlocked
? "WAIT_FOR_ABC_COMPLETION_OR_NEW_W2_W4_SETUP"
: activeDegreeLifecycle
? degreeLifecycle?.[activeDegreeLifecycle]?.allowedSetupFamily ||
"VALID_W2_W4_OR_PRE_EXTENSION_SETUP_REQUIRED"
: "VALID_W2_W4_OR_PRE_EXTENSION_SETUP_REQUIRED";

const headline = postAbcWatchActive
? "POST ABC COMPLETE — WATCH WAVE 2 BOUNCE"
: postAbcLowFailed
? "POST ABC LOW FAILED — WAIT FOR LOWER SUPPORT"
: tradeableOpportunityBlocked
? "LOWER-DEGREE W5 COMPLETE — ABC CORRECTION WATCH"
: activeDegreeLifecycle
? degreeLifecycle?.[activeDegreeLifecycle]?.headline ||
"WAVE LIFECYCLE ACTIVE"
: hasParentW5Context
? "PARENT W5 CONTEXT ACTIVE"
: "WAVE LIFECYCLE NORMAL";

const summary = postAbcWatchActive
? `${symbol} W5 and ABC correction are complete. Price is testing/holding the 7400 institutional support area above the marked C low. If support holds, the next expected move is a Wave 2 bounce. No automatic long. Wait for reclaim confirmation and Engine 6 permission.`
: postAbcLowFailed
? `${symbol} lost the marked C low after ABC completion. The C leg or Wave 1 down may be extending. No Wave 2 bounce signal is active. Wait for lower support or new structure.`
: tradeableOpportunityBlocked
? `${symbol} has parent W5 context, but lower-degree W5 completion / ABC correction marks are active. Do not treat the parent W5 as a fresh long continuation. Wait for ABC completion or a new lower-degree W2/W4 setup.`
: activeDegreeLifecycle
? degreeLifecycle?.[activeDegreeLifecycle]?.summary ||
`${symbol} lifecycle has an active wave setup candidate.`
: `${symbol} lifecycle does not currently block a valid lower-degree W2/W4 setup.`;

const needs =
postAbcReset?.active === true && Array.isArray(postAbcReset?.needs)
? postAbcReset.needs
: tradeableOpportunityBlocked
? [
"WAIT_FOR_ABC_COMPLETION",
"WAIT_FOR_NEW_W2_OR_W4_SETUP",
"NO_NEW_LONG_FROM_PARENT_W5_CONTEXT",
]
: activeDegreeLifecycle
? degreeLifecycle?.[activeDegreeLifecycle]?.needs || [
"VALID_PRE_EXTENSION_W2_OR_W4_SETUP",
]
: ["VALID_PRE_EXTENSION_W2_OR_W4_SETUP"];

const action = postAbcWatchActive
? "WAIT_FOR_7400_HOLD_AND_RECLAIM"
: postAbcLowFailed
? "WAIT_FOR_LOWER_SUPPORT"
: "WAIT";

const bias = postAbcWatchActive
? "RESET_BOUNCE_WATCH"
: postAbcLowFailed
? "RESET_FAILED"
: tradeableOpportunityBlocked
? "CONTEXT_ONLY"
: "WAVE_SETUP_CONTEXT";

const reasonCodes = [
"ENGINE22_WAVE_LIFECYCLE_BUILT",
parentContextOnly ? "PARENT_W5_CONTEXT_ONLY" : null,
hasLowerDegreeW5Complete ? "LOWER_DEGREE_W5_COMPLETE" : null,
correctionActive ? "POST_W5_ABC_MARKS_FOUND" : null,
cLegActive ? "C_LEG_PENDING" : null,
postAbcReset?.state || null,
tradeableOpportunityBlocked
? "NO_PARENT_W5_LONG_CONTINUATION_AFTER_LOWER_DEGREE_COMPLETION"
: null,
activeDegreeLifecycle ? `ACTIVE_LIFECYCLE_DEGREE_${upper(activeDegreeLifecycle)}` : null,
activeAllowedSetupFamily !== "NONE"
? `ACTIVE_ALLOWED_SETUP_${upper(activeAllowedSetupFamily)}`
: null,
].filter(Boolean);

return {
ok: true,
engine: "engine22.waveLifecycle.v2",
symbol,
currentPrice: roundToTick(currentPrice, tickSizeForSymbol(symbol)),

lifecycleState,

parentContextOnly,
tradeableOpportunityBlocked,

correctionActive,
activeCorrectionDegree,

parentW5Degrees,
completedW5Degrees,

degreeLifecycle,
activeDegreeLifecycle,
activeAllowedSetupFamily,

abcCorrection,
postAbcReset,

nextExpectedMove:
  postAbcReset?.nextExpectedMove ||
  (lifecycleState === "POST_W5_ABC_COMPLETE"
    ? "WAIT_FOR_NEW_STRUCTURE"
    : null),

preferredEntry:
  postAbcReset?.preferredEntry ||
  (lifecycleState === "POST_W5_ABC_COMPLETE"
    ? "WAIT_FOR_NEW_W1_AND_RECLAIM"
    : null),

nextAllowedSetup,
headline,
summary,
needs,
reasonCodes,

action,
bias,
direction: "NONE",

context: {
  engine16Ready: upper(engine16?.readiness, "") === "READY",
  engine25ContextProvided: engine25Context != null,
  marketRegimeProvided: marketRegime != null,
},
};
}

export default classifyWaveLifecycle;
