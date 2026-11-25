// services/core/logic/engine22/wave/lifecycle/possibleW5UpLifecycle.js
// Engine 22 — Possible Minor W5 up lifecycle
//
// Purpose:
// Read the manually marked POSSIBLE_W5_UP structure after a likely Wave 4 low.
// When W5_HIGH is marked, calculate post-W5 pullback levels for entry planning.
// This is read-only.
// It does not create trades.
// It does not allow longs.
// It does not allow shorts.
// It does not execute.

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validPrice(value) {
  const n = toNum(value);
  return n !== null && n > 0 ? n : null;
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
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

  return null;
}

function roundToTick(value, tick = 0.25) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return Number((Math.round(n / tick) * tick).toFixed(2));
}

function roundPrice(value, symbol = "ES") {
  const tick = tickSizeForSymbol(symbol);
  return tick ? roundToTick(value, tick) : round2(value);
}

function emptyLevels() {
  return {
    r236: null,
    r382: null,
    r500: null,
    r618: null,
    r786: null,
  };
}

function buildPullbackLevelsFromW5({ symbol, w4Low, w5High }) {
  const low = validPrice(w4Low);
  const high = validPrice(w5High);

  if (low === null || high === null || high <= low) {
    return emptyLevels();
  }

  const range = high - low;

  return {
    r236: roundPrice(high - range * 0.236, symbol),
    r382: roundPrice(high - range * 0.382, symbol),
    r500: roundPrice(high - range * 0.5, symbol),
    r618: roundPrice(high - range * 0.618, symbol),
    r786: roundPrice(high - range * 0.786, symbol),
  };
}

function buildFullMovePullbackLevels({ symbol, originLow, w5High }) {
  const origin = validPrice(originLow);
  const high = validPrice(w5High);

  if (origin === null || high === null || high <= origin) {
    return emptyLevels();
  }

  const range = high - origin;

  return {
    r236: roundPrice(high - range * 0.236, symbol),
    r382: roundPrice(high - range * 0.382, symbol),
    r500: roundPrice(high - range * 0.5, symbol),
    r618: roundPrice(high - range * 0.618, symbol),
    r786: roundPrice(high - range * 0.786, symbol),
  };
}

function buildUpsideProgress({ currentPrice, w5High }) {
  const price = validPrice(currentPrice);
  const high = validPrice(w5High);

  return {
    currentPrice: round2(price),
    w5High: round2(high),
    belowW5High:
      price !== null && high !== null
        ? price < high
        : null,
    atOrAboveW5High:
      price !== null && high !== null
        ? price >= high
        : null,
    pointsOffHigh:
      price !== null && high !== null
        ? round2(high - price)
        : null,
  };
}

function buildEntryZones(pullbackLevels = {}) {
  const r236 = validPrice(pullbackLevels?.r236);
  const r382 = validPrice(pullbackLevels?.r382);
  const r500 = validPrice(pullbackLevels?.r500);
  const r618 = validPrice(pullbackLevels?.r618);
  const r786 = validPrice(pullbackLevels?.r786);

  return {
    shallowTrendPullback:
      r236 !== null && r382 !== null
        ? {
            label: "SHALLOW_TREND_PULLBACK",
            lo: Math.min(r236, r382),
            hi: Math.max(r236, r382),
          }
        : null,

    standardPullback:
      r382 !== null && r500 !== null
        ? {
            label: "STANDARD_PULLBACK_ENTRY_ZONE",
            lo: Math.min(r382, r500),
            hi: Math.max(r382, r500),
          }
        : null,

    deeperSupport:
      r500 !== null && r618 !== null
        ? {
            label: "DEEPER_SUPPORT_ENTRY_ZONE",
            lo: Math.min(r500, r618),
            hi: Math.max(r500, r618),
          }
        : null,

    failureWarning:
      r786 !== null
        ? {
            label: "FAILURE_WARNING_BELOW_786",
            level: r786,
          }
        : null,
  };
}

function emptyRead({ symbol, currentPrice, reason }) {
  return {
    active: false,
    state: "POSSIBLE_W5_UP_UNAVAILABLE",
    readOnly: true,
    direction: "NONE",
    tradeableOpportunityBlocked: true,
    noExecution: true,

    symbol,
    degree: "minor",
    currentPrice: round2(currentPrice),
    reason,

    originLow: null,
    w1High: null,
    w2Low: null,
    w3High: null,
    w4Low: null,
    w5High: null,

    pullbackLevelsFromW5: emptyLevels(),
    fullMovePullbackLevels: emptyLevels(),
    entryZones: buildEntryZones(emptyLevels()),

    nextExpectedStructure: "WAIT_FOR_POSSIBLE_W5_UP_MARKS",
    read: "Possible W5 up marks are unavailable.",
    reasonCodes: [
      "POSSIBLE_W5_UP_LIFECYCLE_BUILT",
      reason,
      "READ_ONLY",
      "NO_EXECUTION",
      "DIRECTION_NONE",
    ],
  };
}

export function buildPossibleW5UpLifecycle({
  symbol = "ES",
  degree = "minor",
  currentPrice = null,
  possibleW5UpMarks = null,
} = {}) {
  const price = validPrice(currentPrice);

  if (!possibleW5UpMarks || typeof possibleW5UpMarks !== "object") {
    return emptyRead({
      symbol,
      currentPrice: price,
      reason: "POSSIBLE_W5_UP_MARKS_MISSING",
    });
  }

  const originLow = validPrice(possibleW5UpMarks.originLow);
  const originTime = possibleW5UpMarks.originTime || null;

  const w1High = validPrice(possibleW5UpMarks.w1High);
  const w1Time = possibleW5UpMarks.w1Time || null;

  const w2Low = validPrice(possibleW5UpMarks.w2Low);
  const w2Time = possibleW5UpMarks.w2Time || null;

  const w3High = validPrice(possibleW5UpMarks.w3High);
  const w3Time = possibleW5UpMarks.w3Time || null;

  const w4Low = validPrice(possibleW5UpMarks.w4Low);
  const w4Time = possibleW5UpMarks.w4Time || null;

  const w5High = validPrice(possibleW5UpMarks.w5High);
  const w5Time = possibleW5UpMarks.w5Time || null;

  const hasOrigin = originLow !== null;
  const hasW1 = w1High !== null;
  const hasW2 = w2Low !== null;
  const hasW3 = w3High !== null;
  const hasW4 = w4Low !== null;
  const hasW5 = w5High !== null;

  let state = "POSSIBLE_MINOR_W5_UP_MARKS_INCOMPLETE";
  let nextExpectedStructure = "WAIT_FOR_W5_UP_MARKS";
  let read =
    "Possible Minor W5 up marks are incomplete. Read-only watch.";

  if (hasOrigin && hasW1 && !hasW2) {
    state = "POSSIBLE_MINOR_W5_UP_W1_MARKED_WAITING_FOR_W2";
    nextExpectedStructure = "WAIT_FOR_W2_LOW";
    read =
      "Possible Minor W5 up has origin and W1 high marked. Waiting for W2 low.";
  } else if (hasOrigin && hasW1 && hasW2 && !hasW3) {
    state = "POSSIBLE_MINOR_W5_UP_W2_MARKED_WAITING_FOR_W3";
    nextExpectedStructure = "WAIT_FOR_W3_HIGH";
    read =
      "Possible Minor W5 up has W1 and W2 marked. Waiting for W3 high.";
  } else if (hasOrigin && hasW1 && hasW2 && hasW3 && !hasW4) {
    state = "POSSIBLE_MINOR_W5_UP_W3_MARKED_WAITING_FOR_W4";
    nextExpectedStructure = "WAIT_FOR_W4_LOW";
    read =
      "Possible Minor W5 up has W3 high marked. Waiting for W4 pullback low.";
  } else if (hasOrigin && hasW1 && hasW2 && hasW3 && hasW4 && !hasW5) {
    state = "POSSIBLE_MINOR_W5_UP_W4_MARKED_W5_ACTIVE";
    nextExpectedStructure = "WAIT_FOR_W5_HIGH";
    read =
      "Possible Minor W5 up has W4 low marked. W5 up is active. Waiting for W5 high.";
  } else if (hasOrigin && hasW1 && hasW2 && hasW3 && hasW4 && hasW5) {
    state = "POSSIBLE_MINOR_W5_UP_COMPLETE_POST_W5_PULLBACK_WATCH";
    nextExpectedStructure = "WATCH_POST_W5_PULLBACK_ENTRY_ZONES";
    read =
      "Possible Minor W5 up is marked complete. Watch pullback fib levels off the W5 high for reaction / entry zones.";
  }

  const pullbackLevelsFromW5 = buildPullbackLevelsFromW5({
    symbol,
    w4Low,
    w5High,
  });

  const fullMovePullbackLevels = buildFullMovePullbackLevels({
    symbol,
    originLow,
    w5High,
  });

  const entryZones = buildEntryZones(pullbackLevelsFromW5);

  const rangeW4ToW5 =
    w4Low !== null && w5High !== null && w5High > w4Low
      ? roundPrice(w5High - w4Low, symbol)
      : null;

  const rangeOriginToW5 =
    originLow !== null && w5High !== null && w5High > originLow
      ? roundPrice(w5High - originLow, symbol)
      : null;

  const priceProgress = buildUpsideProgress({
    currentPrice: price,
    w5High,
  });

  return {
    active: false,
    state,
    readOnly: true,
    direction: "NONE",
    tradeableOpportunityBlocked: true,
    noExecution: true,

    symbol,
    degree,
    currentPrice: round2(price),

    originLow: roundPrice(originLow, symbol),
    originTime,

    w1High: roundPrice(w1High, symbol),
    w1Time,

    w2Low: roundPrice(w2Low, symbol),
    w2Time,

    w3High: roundPrice(w3High, symbol),
    w3Time,

    w4Low: roundPrice(w4Low, symbol),
    w4Time,

    w5High: roundPrice(w5High, symbol),
    w5Time,

    rangeW4ToW5,
    rangeOriginToW5,

    pullbackLevelsFromW5,
    fullMovePullbackLevels,
    entryZones,
    priceProgress,

    w5Complete: hasW5,
    nextExpectedStructure,
    read,

    needs: [
      hasW5
        ? "WATCH_POST_W5_PULLBACK_ENTRY_ZONES"
        : "WAIT_FOR_W5_HIGH_MARK",
      "NO_CHASE",
      "NO_AUTOMATIC_LONG",
      "NO_AUTOMATIC_SHORT",
      "NO_EXECUTION",
    ],

    reasonCodes: [
      "POSSIBLE_W5_UP_LIFECYCLE_BUILT",
      state,
      hasOrigin ? "POSSIBLE_W5_UP_ORIGIN_MARKED" : "POSSIBLE_W5_UP_ORIGIN_MISSING",
      hasW1 ? "POSSIBLE_W5_UP_W1_MARKED" : null,
      hasW2 ? "POSSIBLE_W5_UP_W2_MARKED" : null,
      hasW3 ? "POSSIBLE_W5_UP_W3_MARKED" : null,
      hasW4 ? "POSSIBLE_W5_UP_W4_MARKED" : null,
      hasW5 ? "POSSIBLE_W5_UP_W5_MARKED_COMPLETE" : null,
      hasW5 ? "POST_W5_PULLBACK_LEVELS_AVAILABLE" : null,
      "READ_ONLY",
      "NO_EXECUTION",
      "DIRECTION_NONE",
    ].filter(Boolean),
  };
}

export default buildPossibleW5UpLifecycle;
