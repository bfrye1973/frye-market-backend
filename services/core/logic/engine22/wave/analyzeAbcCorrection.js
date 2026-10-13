// services/core/logic/engine22/wave/analyzeAbcCorrection.js
// Engine 22G — ABC Correction Analyzer
//
// Purpose:
// Read-only ABC correction intelligence.
// Manual A_LOW / B_HIGH / C_LOW levels remain truth when available.
// If manual A/B/C marks are missing, this file can auto-detect a simple ABC
// from the active degree's market bars.
//
// This does not create trades.
// This does not change readiness/status/entries.
// This does not call brokers.
// This does not overwrite manual Engine 2 marks.

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function validPrice(x) {
  const n = toNum(x);
  return n !== null && n > 0 ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function getMarkPrice(block, key) {
  const p = toNum(block?.waveMarks?.[key]?.p);
  return p !== null && p > 0 ? p : null;
}

function getMarkTimeSec(block, key) {
  const raw =
    block?.waveMarks?.[key]?.tSec ??
    block?.waveMarks?.[key]?.timeSec ??
    null;

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeBarTime(bar) {
  const raw =
    bar?.timeSec ??
    bar?.tSec ??
    bar?.timestampSec ??
    bar?.timestamp ??
    bar?.time ??
    bar?.t ??
    null;

  if (typeof raw === "number") {
    return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
  }

  if (typeof raw === "string") {
    const n = Number(raw);

    if (Number.isFinite(n)) {
      return n > 10_000_000_000 ? Math.floor(n / 1000) : n;
    }

    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return null;
}

function normalizeBar(bar) {
  if (!bar || typeof bar !== "object") return null;

  const timeSec = normalizeBarTime(bar);
  const high = toNum(bar.high ?? bar.h);
  const low = toNum(bar.low ?? bar.l);
  const close = toNum(bar.close ?? bar.c);

  if (timeSec === null) return null;
  if (high === null && low === null && close === null) return null;

  return {
    timeSec,
    high: high ?? close,
    low: low ?? close,
    close,
    raw: bar,
  };
}

function degreeToTf(degree, fallback = null) {
  const d = String(degree || "").toLowerCase();

  if (d === "primary") return "1d";
  if (d === "intermediate") return "1h";
  if (d === "minor") return "1h";
  if (d === "minute") return "10m";
  if (d === "micro") return "10m";

  return fallback || "10m";
}

function getBarsForDegree({ degree, block, barsByTf }) {
  const tf = degreeToTf(degree, block?.tf || "10m");
  const direct = barsByTf?.[tf];

  if (Array.isArray(direct)) {
    return direct.map(normalizeBar).filter(Boolean);
  }

  return [];
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

function detectAutoAbcFromBars({
  symbol = "SPY",
  degree = "minute",
  correctionFor = "W4",
  block = null,
  barsByTf = {},
  minMovePts = null,
} = {}) {
  const tf = degreeToTf(degree, block?.tf || "10m");
  const bars = getBarsForDegree({ degree, block, barsByTf });

  if (!bars.length) {
    return {
      ok: false,
      used: false,
      source: "AUTO_ABC_FROM_BARS",
      tf,
      reason: "NO_BARS_FOR_AUTO_ABC",
      reasonCodes: ["NO_BARS_FOR_AUTO_ABC"],
    };
  }

  const startKey = correctionFor === "W4" ? "W3" : "W1";
  const startSec = getMarkTimeSec(block, startKey);

  const afterStart = startSec
    ? bars.filter((bar) => Number(bar.timeSec) >= Number(startSec))
    : bars;

  if (afterStart.length < 3) {
    return {
      ok: false,
      used: false,
      source: "AUTO_ABC_FROM_BARS",
      tf,
      reason: "NOT_ENOUGH_BARS_AFTER_CORRECTION_START",
      reasonCodes: ["NOT_ENOUGH_BARS_AFTER_CORRECTION_START"],
    };
  }

  const s = upper(symbol);
  const requiredMove =
    Number.isFinite(Number(minMovePts))
      ? Number(minMovePts)
      : s.startsWith("ES") || s.startsWith("MES")
      ? 5
      : s.startsWith("NQ") || s.startsWith("MNQ")
      ? 15
      : 1;

  // Simple v1 ABC read:
  // A = lowest low after correction starts.
  // B = highest bounce after A.
  // C = lowest low after B.
  //
  // This is intentionally read-only and conservative.
  // Manual marks override this if present.
  let aIdx = -1;
  let aLow = null;

  for (let i = 0; i < afterStart.length; i++) {
    const low = validPrice(afterStart[i].low);
    if (low === null) continue;

    if (aLow === null || low < aLow) {
      aLow = low;
      aIdx = i;
    }
  }

  if (aIdx < 0 || aLow === null) {
    return {
      ok: false,
      used: false,
      source: "AUTO_ABC_FROM_BARS",
      tf,
      reason: "AUTO_A_LOW_NOT_FOUND",
      reasonCodes: ["AUTO_A_LOW_NOT_FOUND"],
    };
  }

  let bIdx = -1;
  let bHigh = null;

  for (let i = aIdx + 1; i < afterStart.length; i++) {
    const high = validPrice(afterStart[i].high);
    if (high === null) continue;

    if (bHigh === null || high > bHigh) {
      bHigh = high;
      bIdx = i;
    }
  }

  let cIdx = -1;
  let cLow = null;

  if (bIdx >= 0) {
    for (let i = bIdx + 1; i < afterStart.length; i++) {
      const low = validPrice(afterStart[i].low);
      if (low === null) continue;

      if (cLow === null || low < cLow) {
        cLow = low;
        cIdx = i;
      }
    }
  }

  const aToBMove =
    aLow !== null && bHigh !== null ? Math.abs(bHigh - aLow) : null;

  const bToCMove =
    bHigh !== null && cLow !== null ? Math.abs(bHigh - cLow) : null;

  const hasMeaningfulB =
    aToBMove !== null && aToBMove >= requiredMove;

  const hasMeaningfulC =
    bToCMove !== null && bToCMove >= requiredMove;

  const abcStatus =
    hasMeaningfulB && hasMeaningfulC
      ? "AUTO_ABC_C_LEG_WORKING"
      : hasMeaningfulB
      ? "AUTO_A_AND_B_DETECTED_WAITING_FOR_C"
      : "AUTO_A_DETECTED_WAITING_FOR_B";

  return {
    ok: true,
    used: true,
    source: "AUTO_ABC_FROM_BARS",
    tf,
    abcStatus,

    aLow: round2(aLow),
    bHigh: hasMeaningfulB ? round2(bHigh) : null,
    cLow: hasMeaningfulC ? round2(cLow) : null,

    bars: {
      startKey,
      startSec,
      aTimeSec: aIdx >= 0 ? afterStart[aIdx]?.timeSec : null,
      bTimeSec: bIdx >= 0 ? afterStart[bIdx]?.timeSec : null,
      cTimeSec: cIdx >= 0 ? afterStart[cIdx]?.timeSec : null,
    },

    quality: {
      requiredMovePts: requiredMove,
      aToBMove: round2(aToBMove),
      bToCMove: round2(bToCMove),
      hasMeaningfulB,
      hasMeaningfulC,
    },

    reasonCodes: [
      "AUTO_ABC_FROM_BARS",
      hasMeaningfulB ? "AUTO_B_HIGH_CONFIRMED" : "AUTO_B_HIGH_NOT_CONFIRMED",
      hasMeaningfulC ? "AUTO_C_LOW_CONFIRMED" : "AUTO_C_LOW_NOT_CONFIRMED",
    ],
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

function uniqueSortedPrices(xs = []) {
  const seen = new Set();

  return xs
    .map(round2)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b)
    .filter((x) => {
      const key = String(x);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatPriceGroup(prices = []) {
  return uniqueSortedPrices(prices)
    .map((x) => x.toFixed(2))
    .join("/");
}

function buildReclaimPlan({ levels, noOverlapLine, bHigh }) {
  const r786 = round2(levels?.r786);
  const r618 = round2(levels?.r618);
  const r500 = round2(levels?.r500);
  const r382 = round2(levels?.r382);
  const w1High = round2(noOverlapLine);
  const b = round2(bHigh);

  const reclaimLevelDetails = [
    {
      key: "r786",
      label: "78.6% retracement reclaim",
      price: r786,
      group: "FIRST_RECLAIM",
    },
    {
      key: "r618",
      label: "61.8% retracement reclaim",
      price: r618,
      group: "CLEAN_PATH_RECLAIM",
    },
    {
      key: "w1High",
      label: "W1 high / no-overlap reclaim",
      price: w1High,
      group: "CLEAN_PATH_RECLAIM",
    },
    {
      key: "r500",
      label: "50% retracement reclaim",
      price: r500,
      group: "MID_RECLAIM",
    },
    {
      key: "bHigh",
      label: "B high reclaim",
      price: b,
      group: "STRUCTURE_RECLAIM",
    },
    {
      key: "r382",
      label: "38.2% retracement reclaim",
      price: r382,
      group: "STRUCTURE_RECLAIM",
    },
  ].filter((x) => Number.isFinite(x.price) && x.price > 0);

  const reclaimLevels = uniqueSortedPrices(
    reclaimLevelDetails.map((x) => x.price)
  );

  const reclaimLadder = [
    {
      group: "FIRST_RECLAIM",
      label: "Reclaim 78.6%",
      prices: uniqueSortedPrices([r786]),
    },
    {
      group: "CLEAN_PATH_RECLAIM",
      label: "Reclaim 61.8% / W1 high",
      prices: uniqueSortedPrices([r618, w1High]),
    },
    {
      group: "MID_RECLAIM",
      label: "Reclaim 50%",
      prices: uniqueSortedPrices([r500]),
    },
    {
      group: "STRUCTURE_RECLAIM",
      label: "Reclaim B high / 38.2%",
      prices: uniqueSortedPrices([b, r382]),
    },
  ].filter((x) => x.prices.length > 0);

  const reclaimDisplay = reclaimLadder
    .map((x) => formatPriceGroup(x.prices))
    .filter(Boolean)
    .join(" → ");

  return {
    reclaimLevels,
    reclaimLadder,
    reclaimDisplay,
    reclaimLevelDetails,
  };
}

export function analyzeAbcCorrection({
  symbol = "SPY",
  degree = "micro",
  correctionFor = "W4",
  block = null,
  currentPrice = null,
  barsByTf = {},
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

  const autoAbc = detectAutoAbcFromBars({
    symbol,
    degree,
    correctionFor,
    block,
    barsByTf,
  });

  const manualALow = validPrice(block?.aLow);

  const manualBHigh =
    validPrice(block?.bHigh) ??
    validPrice(block?.lowerHighLevel) ??
    validPrice(block?.continuationLevel);

  const manualCLow =
    validPrice(block?.cLow) ??
    validPrice(block?.w4Low);

  const aLow = manualALow ?? validPrice(autoAbc?.aLow);
  const bHigh = manualBHigh ?? validPrice(autoAbc?.bHigh);
  const cLow = manualCLow ?? validPrice(autoAbc?.cLow);

  const abcSource =
    manualALow !== null || manualBHigh !== null || manualCLow !== null
      ? "MANUAL_ABC_MARKS"
      : autoAbc?.used
      ? "AUTO_ABC_FROM_BARS"
      : "NO_ABC_MARKS";

  const cClass = classifyCZone({
    cLow,
    levels: retrace.levels,
    hardInvalidation,
    noOverlapLine,
  });

  const reclaimPlan = buildReclaimPlan({
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
    abcSource,
    cZone: cClass.cZone,

    currentPrice: round2(currentPrice),

    priorImpulse: {
      start: round2(impulseStart),
      end: round2(impulseEnd),
      range: retrace.range,
    },

    levels: retrace.levels,

    autoAbc,

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

    reclaimLevels: reclaimPlan.reclaimLevels,
    reclaimLadder: reclaimPlan.reclaimLadder,
    reclaimDisplay: reclaimPlan.reclaimDisplay,
    reclaimLevelDetails: reclaimPlan.reclaimLevelDetails,

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
      abcSource,
      abcStatus,
      aLow !== null ? "A_LOW_MARKED" : "A_LOW_NOT_MARKED",
      bHigh !== null ? "B_HIGH_MARKED" : "B_HIGH_NOT_MARKED",
      cLow !== null ? "C_LOW_MARKED" : "C_LOW_NOT_MARKED",
      ...(Array.isArray(autoAbc?.reasonCodes) ? autoAbc.reasonCodes : []),
      ...(Array.isArray(cClass.reasonCodes) ? cClass.reasonCodes : []),
    ],
  };
}

export default analyzeAbcCorrection;
