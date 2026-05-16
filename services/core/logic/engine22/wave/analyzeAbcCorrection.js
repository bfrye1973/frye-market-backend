// services/core/logic/engine22/wave/analyzeAbcCorrection.js
// Engine 22G — ABC Correction Analyzer
//
// Purpose:
// Read-only ABC correction intelligence.
// Uses manual A_LOW / B_HIGH / C_LOW levels when available.
// Compares A/B/C against fib retracement levels from the prior impulse.
// Does not create trades.
// Does not change readiness/status/entries.

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function upper(x) {
  return String(x || "").trim().toUpperCase();
}

function getMarkPrice(block, key) {
  const p = toNum(block?.waveMarks?.[key]?.p);
  return p !== null && p > 0 ? p : null;
}

function buildRetracementLevels({ impulseStart, impulseEnd }) {
  const start = toNum(impulseStart);
  const end = toNum(impulseEnd);

  if (start === null || end === null || end <= start) {
    return {
      ok: false,
      range: null,
      levels: null,
      reason: "INVALID_IMPULSE_RANGE",
    };
  }

  const range = end - start;

  return {
    ok: true,
    range: round2(range),
    levels: {
      r236: round2(end - range * 0.236),
      r382: round2(end - range * 0.382),
      r500: round2(end - range * 0.5),
      r618: round2(end - range * 0.618),
      r786: round2(end - range * 0.786),
    },
    reason: "IMPULSE_RANGE_VALID",
  };
}

function classifyCZone({ cLow, levels, hardInvalidation, noOverlapLine }) {
  const c = toNum(cLow);

  if (c === null) {
    return {
      state: "ABC_WAITING_FOR_C_LOW",
      cZone: "C_LOW_NOT_MARKED",
      correctionCompleteLikely: false,
      cleanW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      reasonCodes: ["C_LOW_NOT_MARKED"],
    };
  }

  const hard = toNum(hardInvalidation);
  const noOverlap = toNum(noOverlapLine);

  if (hard !== null && c <= hard) {
    return {
      state: "ABC_INVALIDATED_PRIOR_IMPULSE",
      cZone: "BELOW_HARD_INVALIDATION",
      correctionCompleteLikely: true,
      cleanW5PathDamaged: true,
      topLikelyConfirmedForNow: true,
      hardInvalidated: true,
      reasonCodes: [
        "C_LOW_BELOW_HARD_INVALIDATION",
        "PRIOR_IMPULSE_INVALIDATED",
      ],
    };
  }

  if (levels?.r786 !== null && c < levels.r786) {
    return {
      state: "ABC_C_LEG_DEEP_DAMAGED",
      cZone: "BELOW_786_ABOVE_INVALIDATION",
      correctionCompleteLikely: true,
      cleanW5PathDamaged: true,
      topLikelyConfirmedForNow: true,
      hardInvalidated: false,
      reasonCodes: [
        "C_LOW_BELOW_786",
        "C_LOW_ABOVE_HARD_INVALIDATION",
        "ABC_DEEP_DAMAGED",
        "W5_REQUIRES_RECLAIM",
      ],
    };
  }

  if (noOverlap !== null && c < noOverlap) {
    return {
      state: "ABC_C_LEG_DAMAGED",
      cZone: "BELOW_W1_HIGH_NO_OVERLAP_DANGER",
      correctionCompleteLikely: true,
      cleanW5PathDamaged: true,
      topLikelyConfirmedForNow: true,
      hardInvalidated: false,
      reasonCodes: [
        "C_LOW_BELOW_W1_HIGH",
        "NO_OVERLAP_DANGER_LINE_LOST",
        "ABC_DAMAGED",
      ],
    };
  }

  if (levels?.r618 !== null && c < levels.r618) {
    return {
      state: "ABC_C_LEG_DEEP",
      cZone: "BETWEEN_618_AND_W1_HIGH",
      correctionCompleteLikely: true,
      cleanW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      reasonCodes: [
        "C_LOW_NEAR_618",
        "DEEP_BUT_VALID_ABC",
      ],
    };
  }

  if (levels?.r500 !== null && c < levels.r500) {
    return {
      state: "ABC_C_LEG_NORMAL_TO_DEEP",
      cZone: "BETWEEN_500_AND_618",
      correctionCompleteLikely: true,
      cleanW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      reasonCodes: [
        "C_LOW_BETWEEN_500_AND_618",
        "NORMAL_TO_DEEP_ABC",
      ],
    };
  }

  if (levels?.r382 !== null && c < levels.r382) {
    return {
      state: "ABC_C_LEG_NORMAL",
      cZone: "BETWEEN_382_AND_500",
      correctionCompleteLikely: true,
      cleanW5PathDamaged: false,
      topLikelyConfirmedForNow: false,
      hardInvalidated: false,
      reasonCodes: [
        "C_LOW_BETWEEN_382_AND_500",
        "NORMAL_ABC",
      ],
    };
  }

  return {
    state: "ABC_C_LEG_SHALLOW",
    cZone: "ABOVE_382",
    correctionCompleteLikely: true,
    cleanW5PathDamaged: false,
    topLikelyConfirmedForNow: false,
    hardInvalidated: false,
    reasonCodes: [
      "C_LOW_ABOVE_382",
      "SHALLOW_ABC",
    ],
  };
}

function buildReclaimLevels({ levels, noOverlapLine, bHigh }) {
  return [
    levels?.r786,
    levels?.r618,
    noOverlapLine,
    levels?.r500,
    levels?.r382,
    bHigh,
  ]
    .map(round2)
    .filter((x) => Number.isFinite(x));
}

export function analyzeAbcCorrection({
  symbol = "SPY",
  degree = "micro",
  correctionFor = "W4",
  block = null,
  currentPrice = null,
} = {}) {
  if (!block || typeof block !== "object") {
    return {
      ok: false,
      active: false,
      symbol,
      degree,
      correctionFor,
      state: "ABC_UNAVAILABLE",
      reasonCodes: ["MISSING_ENGINE2_BLOCK"],
    };
  }

  const phase = block?.phase || "UNKNOWN";
  const confirmedPhase = block?.confirmedPhase || "UNKNOWN";

  const isW4Correction =
    correctionFor === "W4" &&
    phase === "IN_W4" &&
    confirmedPhase === "IN_W3";

  const isW2Correction =
    correctionFor === "W2" &&
    phase === "IN_W2" &&
    confirmedPhase === "IN_W1";

  const active = isW4Correction || isW2Correction;

  if (!active) {
    return {
      ok: true,
      active: false,
      symbol,
      degree,
      correctionFor,
      phase,
      confirmedPhase,
      state: "NO_ACTIVE_ABC_CORRECTION",
      reasonCodes: ["NOT_ACTIVE_CORRECTION_PHASE"],
    };
  }

  const impulseStart =
    correctionFor === "W4"
      ? getMarkPrice(block, "W2")
      : getMarkPrice(block, "W1");

  const impulseEnd =
    correctionFor === "W4"
      ? getMarkPrice(block, "W3")
      : getMarkPrice(block, "W1");

  const hardInvalidation =
    correctionFor === "W4"
      ? getMarkPrice(block, "W2")
      : null;

  const noOverlapLine =
    correctionFor === "W4"
      ? getMarkPrice(block, "W1")
      : null;

  const retrace = buildRetracementLevels({
    impulseStart,
    impulseEnd,
  });

  const aLow = toNum(block?.aLow);
  const bHigh =
    toNum(block?.bHigh) ??
    toNum(block?.lowerHighLevel) ??
    toNum(block?.continuationLevel);

  const cLow =
    toNum(block?.cLow) ??
    toNum(block?.w4Low);

  const cClass = classifyCZone({
    cLow,
    levels: retrace.levels,
    hardInvalidation,
    noOverlapLine,
  });

  const reclaimLevels = buildReclaimLevels({
    levels: retrace.levels,
    noOverlapLine,
    bHigh,
  });

  const abcStatus =
    aLow !== null && bHigh !== null && cLow !== null
      ? "ABC_COMPLETE"
      : aLow !== null && bHigh !== null
      ? "A_AND_B_MARKED_WAITING_FOR_C"
      : aLow !== null
      ? "A_MARKED_WAITING_FOR_B"
      : "WAITING_FOR_A";

  return {
    ok: retrace.ok,
    active: true,
    symbol,
    degree,
    correctionFor,
    phase,
    confirmedPhase,

    state: cClass.state,
    abcStatus,
    cZone: cClass.cZone,

    currentPrice: round2(currentPrice),

    priorImpulse: {
      start: round2(impulseStart),
      end: round2(impulseEnd),
      range: retrace.range,
    },

    levels: retrace.levels,

    abc: {
      aLow: round2(aLow),
      bHigh: round2(bHigh),
      cLow: round2(cLow),
    },

    noOverlapLine: round2(noOverlapLine),
    hardInvalidation: round2(hardInvalidation),

    correctionCompleteLikely: cClass.correctionCompleteLikely,
    cleanW5PathDamaged: cClass.cleanW5PathDamaged,
    topLikelyConfirmedForNow: cClass.topLikelyConfirmedForNow,
    hardInvalidated: cClass.hardInvalidated,

    microW5NeedsReclaim:
      correctionFor === "W4" &&
      (
        cClass.cleanW5PathDamaged === true ||
        cClass.topLikelyConfirmedForNow === true
      ),

    reclaimLevels,

    needs:
      cClass.cleanW5PathDamaged === true
        ? [
            "RECLAIM_786",
            "RECLAIM_618",
            "RECLAIM_W1_HIGH",
            "RECLAIM_10M_EMA10_20",
            "ENGINE3_BUYER_REACTION",
            "ENGINE4_BULLISH_PARTICIPATION",
          ]
        : [
            "SUPPORT_HOLD",
            "RECLAIM_10M_EMA10_20",
            "ENGINE3_REACTION",
            "ENGINE4_PARTICIPATION",
          ],

    reasonCodes: [
      "ABC_CORRECTION_ACTIVE",
      abcStatus,
      aLow !== null ? "A_LOW_MARKED" : "A_LOW_NOT_MARKED",
      bHigh !== null ? "B_HIGH_MARKED" : "B_HIGH_NOT_MARKED",
      cLow !== null ? "C_LOW_MARKED" : "C_LOW_NOT_MARKED",
      ...(Array.isArray(cClass.reasonCodes) ? cClass.reasonCodes : []),
    ],
  };
}

export default analyzeAbcCorrection;
