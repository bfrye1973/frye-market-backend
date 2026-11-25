// services/core/logic/engine22/wave/buildW4Levels.js
// Engine 22G — Official W4 Level Builder
//
// Purpose:
// Build deterministic W4 support / reclaim / invalidation / W5 target levels
// for W4_TO_W5 setups.
//
// This file is READ-ONLY intelligence.
// It does not create trades.
// It does not change readiness.
// It does not call brokers.
// It does not route orders.
//
// Locked user rule:
// - W4 support zone = 38.2% to 61.8% retracement
// - Default W4 support = 50% retracement
// - Deep support = 61.8% retracement
// - Danger line = 78.6% retracement
// - Hard invalidation = Engine 2 hard invalidation / prior impulse start
// - Reclaim = B-high if available, otherwise 38.2% retracement
// - Full trigger = prior W3 high

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundTo(value, tickSize = null) {
  const n = toNum(value);
  if (n === null) return null;

  const tick = toNum(tickSize);

  if (tick && tick > 0) {
    return Number((Math.round(n / tick) * tick).toFixed(8));
  }

  return Number(n.toFixed(2));
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function getMarkPrice(waveMarks, key) {
  return toNum(waveMarks?.[key]?.p ?? waveMarks?.[key]?.price ?? null);
}

function getMaybeLevel(...values) {
  for (const value of values) {
    const n = toNum(value);
    if (n !== null) return n;
  }
  return null;
}

function normalizeLevels(levels = {}, tickSize = null) {
  return {
    r236: roundTo(levels.r236, tickSize),
    r382: roundTo(levels.r382, tickSize),
    r500: roundTo(levels.r500, tickSize),
    r618: roundTo(levels.r618, tickSize),
    r786: roundTo(levels.r786, tickSize),
  };
}

function calculateBullishRetracements({ w2, w3, tickSize = null }) {
  const start = toNum(w2);
  const high = toNum(w3);

  if (start === null || high === null || high <= start) {
    return null;
  }

  const range = high - start;

  return normalizeLevels(
    {
      r236: high - range * 0.236,
      r382: high - range * 0.382,
      r500: high - range * 0.5,
      r618: high - range * 0.618,
      r786: high - range * 0.786,
    },
    tickSize
  );
}

function calculateBearishRetracements({ w2, w3, tickSize = null }) {
  const start = toNum(w2);
  const low = toNum(w3);

  if (start === null || low === null || low >= start) {
    return null;
  }

  const range = start - low;

  return normalizeLevels(
    {
      r236: low + range * 0.236,
      r382: low + range * 0.382,
      r500: low + range * 0.5,
      r618: low + range * 0.618,
      r786: low + range * 0.786,
    },
    tickSize
  );
}

function buildW5TargetsFromMarks({ direction, w2, w3, w4, tickSize = null }) {
  const a = toNum(w2);
  const b = toNum(w3);
  const c = toNum(w4);

  if (a === null || b === null || c === null) return null;

  const range = Math.abs(b - a);
  if (!Number.isFinite(range) || range <= 0) return null;

  const bullish = upper(direction) !== "BEARISH";

  const project = (fib) =>
    bullish ? c + range * fib : c - range * fib;

  return {
    e100: roundTo(project(1.0), tickSize),
    e1168: roundTo(project(1.168), tickSize),
    e1272: roundTo(project(1.272), tickSize),
    e1618: roundTo(project(1.618), tickSize),
    e200: roundTo(project(2.0), tickSize),
    e2618: roundTo(project(2.618), tickSize),
  };
}

function extractExistingRetracements({ degreeState, engine2Block, tickSize = null }) {
  const candidates = [
    degreeState?.w4Retracement,
    degreeState?.w4Retrace,
    degreeState?.wave4Retrace,
    degreeState?.wave4Retracement,
    degreeState?.wave3Retrace,
    degreeState?.wave3Retrace?.levels,
    degreeState?.wave3Retrace?.retracementLevels,
    degreeState?.retracementLevels,
    degreeState?.pullbackLevels,
    degreeState?.activeTargets,
    engine2Block?.w4Retracement,
    engine2Block?.w4Retrace,
    engine2Block?.wave4Retrace,
    engine2Block?.wave4Retracement,
    engine2Block?.wave3Retrace,
    engine2Block?.wave3Retrace?.levels,
    engine2Block?.wave3Retrace?.retracementLevels,
    engine2Block?.retracementLevels,
    engine2Block?.pullbackLevels,
    engine2Block?.activeTargets,
  ];

  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;

    const r382 = getMaybeLevel(c.r382, c.r_382, c.retrace382, c.retracement382);
    const r500 = getMaybeLevel(c.r500, c.r_500, c.retrace500, c.retracement500);
    const r618 = getMaybeLevel(c.r618, c.r_618, c.retrace618, c.retracement618);

    if (r382 !== null && r500 !== null && r618 !== null) {
      return normalizeLevels(
        {
          r236: getMaybeLevel(c.r236, c.r_236, c.retrace236, c.retracement236),
          r382,
          r500,
          r618,
          r786: getMaybeLevel(c.r786, c.r_786, c.retrace786, c.reference786, c.retracement786),
        },
        tickSize
      );
    }
  }

  return null;
}

function extractExistingW5Targets({ degreeState, engine2Block, tickSize = null }) {
  const candidates = [
    degreeState?.w5Targets,
    degreeState?.fibProjection?.levels,
    degreeState?.waveExtension?.levels,
    degreeState?.waveExtensions?.levels,
    degreeState?.activeExtension?.levels,
    engine2Block?.w5Targets,
    engine2Block?.fibProjection?.levels,
    engine2Block?.waveExtension?.levels,
    engine2Block?.waveExtensions?.levels,
    engine2Block?.activeExtension?.levels,
  ];

  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;

    const e100 = getMaybeLevel(c.e100, c.e1, c["1.000"], c.target100);
    const e1618 = getMaybeLevel(c.e1618, c.e_1618, c["1.618"], c.target1618);

    if (e100 !== null || e1618 !== null) {
      return {
        e100: roundTo(e100, tickSize),
        e1168: roundTo(getMaybeLevel(c.e1168, c.e_1168, c["1.168"], c.target1168), tickSize),
        e1272: roundTo(getMaybeLevel(c.e1272, c.e_1272, c["1.272"], c.target1272), tickSize),
        e1618: roundTo(e1618, tickSize),
        e200: roundTo(getMaybeLevel(c.e200, c.e2, c["2.000"], c.target200), tickSize),
        e2618: roundTo(getMaybeLevel(c.e2618, c.e_2618, c["2.618"], c.target2618), tickSize),
      };
    }
  }

  return null;
}

function detectDirection({ waveMarks, degreeState, engine2Block }) {
  const w2 = getMarkPrice(waveMarks, "W2");
  const w3 = getMarkPrice(waveMarks, "W3");

  const explicit =
    degreeState?.direction ||
    degreeState?.trendDirection ||
    engine2Block?.direction ||
    engine2Block?.trendDirection ||
    null;

  const e = upper(explicit);
  if (e === "BEARISH" || e === "DOWN" || e === "SHORT") return "BEARISH";
  if (e === "BULLISH" || e === "UP" || e === "LONG") return "BULLISH";

  if (w2 !== null && w3 !== null) {
    return w3 >= w2 ? "BULLISH" : "BEARISH";
  }

  return "BULLISH";
}

export function buildW4Levels({
  symbol = "SPY",
  degree = null,
  degreeState = null,
  engine2Block = null,
  currentPrice = null,
  tickSize = null,
} = {}) {
  const cleanDegree = String(degree || degreeState?.degree || engine2Block?.degree || "").toLowerCase();

  if (!cleanDegree) {
    return {
      ok: false,
      symbol,
      degree: null,
      pullbackFor: "W4",
      source: "ENGINE22_W4_LEVELS",
      reason: "MISSING_ACTIVE_DEGREE",
      reasonCodes: ["W4_LEVELS_MISSING_ACTIVE_DEGREE"],
    };
  }

  const waveMarks =
    degreeState?.waveMarks ||
    engine2Block?.waveMarks ||
    {};

  const direction = detectDirection({
    waveMarks,
    degreeState,
    engine2Block,
  });

  const w1 = getMarkPrice(waveMarks, "W1");
  const w2 = getMarkPrice(waveMarks, "W2");
  const w3 = getMarkPrice(waveMarks, "W3");
  const w4 = getMarkPrice(waveMarks, "W4");

  const existingRetracements = extractExistingRetracements({
    degreeState,
    engine2Block,
    tickSize,
  });

  const calculatedRetracements =
    direction === "BEARISH"
      ? calculateBearishRetracements({ w2, w3, tickSize })
      : calculateBullishRetracements({ w2, w3, tickSize });

  const retracements = existingRetracements || calculatedRetracements;

  if (!retracements?.r382 || !retracements?.r500 || !retracements?.r618) {
    return {
      ok: false,
      symbol,
      degree: cleanDegree,
      pullbackFor: "W4",
      source: "ENGINE22_W4_LEVELS",
      reason: "MISSING_W4_RETRACEMENT_LEVELS",
      anchors: {
        w1: roundTo(w1, tickSize),
        w2: roundTo(w2, tickSize),
        w3: roundTo(w3, tickSize),
        w4: roundTo(w4, tickSize),
      },
      reasonCodes: [
        "W4_LEVELS_MISSING_RETRACEMENTS",
        existingRetracements ? "EXISTING_RETRACEMENTS_INCOMPLETE" : "NO_EXISTING_RETRACEMENTS_FOUND",
      ],
    };
  }

  const bHigh =
    getMaybeLevel(
      degreeState?.bHigh,
      degreeState?.abc?.bHigh,
      degreeState?.abcCorrection?.abc?.bHigh,
      engine2Block?.bHigh,
      engine2Block?.abc?.bHigh,
      engine2Block?.abcCorrection?.abc?.bHigh
    );

  const hardInvalidation =
    getMaybeLevel(
      degreeState?.hardInvalidation,
      degreeState?.invalidation,
      degreeState?.wave3Retrace?.invalidation,
      degreeState?.activeTargets?.invalidation,
      engine2Block?.hardInvalidation,
      engine2Block?.invalidation,
      engine2Block?.wave3Retrace?.invalidation,
      engine2Block?.activeTargets?.invalidation,
      w2,
      w1
    );

  const existingTargets = extractExistingW5Targets({
    degreeState,
    engine2Block,
    tickSize,
  });

  const calculatedTargets =
    w4 !== null
      ? buildW5TargetsFromMarks({
          direction,
          w2,
          w3,
          w4,
          tickSize,
        })
      : null;

  const w5Targets = existingTargets || calculatedTargets || null;

  const supportZone = {
    hi: retracements.r382,
    mid: retracements.r500,
    lo: retracements.r618,
  };

  const reclaim = roundTo(bHigh ?? retracements.r382, tickSize);
  const fullTrigger = roundTo(w3, tickSize);
  const invalidation = roundTo(hardInvalidation, tickSize);

  return {
    ok: true,
    symbol,
    degree: cleanDegree,
    pullbackFor: "W4",
    direction,

    supportZone,
    support: retracements.r500,
    deepSupport: retracements.r618,
    dangerLine: retracements.r786,

    reclaim,
    fullTrigger,

    invalidation,
    hardInvalidation: invalidation,

    anchors: {
      w1: roundTo(w1, tickSize),
      w2: roundTo(w2, tickSize),
      w3: roundTo(w3, tickSize),
      w4: roundTo(w4, tickSize),
    },

    bHigh: roundTo(bHigh, tickSize),
    currentPrice: roundTo(currentPrice, tickSize),

    w5Targets,

    source: "ENGINE22_W4_LEVELS",
    reasonCodes: [
      "ENGINE22_W4_LEVELS_BUILT",
      "W4_SUPPORT_DEFAULT_R500",
      "W4_SUPPORT_ZONE_R382_TO_R618",
      "W4_RECLAIM_B_HIGH_OR_R382",
      "W4_HARD_INVALIDATION_FROM_ENGINE2_OR_PRIOR_IMPULSE",
    ],
  };
}

export default buildW4Levels;

