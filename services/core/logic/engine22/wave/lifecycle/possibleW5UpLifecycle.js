// services/core/logic/engine22/wave/lifecycle/possibleW5UpLifecycle.js
// Engine 22 — Possible Minor Wave 5 up lifecycle
//
// Purpose:
// After a post-Minor-5 corrective bounce exceeds normal C-up targets,
// reclassify the move as a possible Minor Wave 5 up watch.
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

function buildEmptyRetraceLevels() {
  return {
    r236: null,
    r382: null,
    r500: null,
    r618: null,
    r786: null,
  };
}

function buildEmptyTargets() {
  return {
    w5EqW1: null,
    w5_1272_W1: null,
    w5_1618_W1: null,
    w5_0618_W1ToW3: null,
    w5_1000_W1ToW3: null,
  };
}

function buildRetraceDownFromHigh({ symbol, low, high }) {
  const origin = validPrice(low);
  const top = validPrice(high);

  if (origin === null || top === null || top <= origin) {
    return buildEmptyRetraceLevels();
  }

  const range = top - origin;

  return {
    r236: roundPrice(top - range * 0.236, symbol),
    r382: roundPrice(top - range * 0.382, symbol),
    r500: roundPrice(top - range * 0.5, symbol),
    r618: roundPrice(top - range * 0.618, symbol),
    r786: roundPrice(top - range * 0.786, symbol),
  };
}

function buildW5UpTargets({
  symbol,
  originLow,
  w1High,
  w2Low,
  w3High,
  w4Low,
}) {
  const origin = validPrice(originLow);
  const oneHigh = validPrice(w1High);
  const twoLow = validPrice(w2Low);
  const threeHigh = validPrice(w3High);
  const fourLow = validPrice(w4Low);

  if (origin === null || oneHigh === null) {
    return buildEmptyTargets();
  }

  const w1Range = oneHigh - origin;

  if (!Number.isFinite(w1Range) || w1Range <= 0) {
    return buildEmptyTargets();
  }

  const base = fourLow ?? twoLow ?? origin;

  const oneToThreeRange =
    origin !== null && threeHigh !== null && threeHigh > origin
      ? threeHigh - origin
      : null;

  return {
    w5EqW1: roundPrice(base + w1Range * 1.0, symbol),
    w5_1272_W1: roundPrice(base + w1Range * 1.272, symbol),
    w5_1618_W1: roundPrice(base + w1Range * 1.618, symbol),
    w5_0618_W1ToW3:
      oneToThreeRange !== null
        ? roundPrice(base + oneToThreeRange * 0.618, symbol)
        : null,
    w5_1000_W1ToW3:
      oneToThreeRange !== null
        ? roundPrice(base + oneToThreeRange * 1.0, symbol)
        : null,
  };
}

function classifyTargetProgress({ currentPrice, w5High, targets }) {
  const price = validPrice(currentPrice);
  const high = validPrice(w5High);
  const activeHigh = high ?? price;

  const targetEntries = [
    ["w5EqW1", targets?.w5EqW1],
    ["w5_1272_W1", targets?.w5_1272_W1],
    ["w5_1618_W1", targets?.w5_1618_W1],
    ["w5_0618_W1ToW3", targets?.w5_0618_W1ToW3],
    ["w5_1000_W1ToW3", targets?.w5_1000_W1ToW3],
  ];

  let highestTargetHit = null;

  if (activeHigh !== null) {
    for (const [key, target] of targetEntries) {
      const t = validPrice(target);
      if (t !== null && activeHigh >= t) highestTargetHit = key;
    }
  }

  return {
    price,
    activeHigh,
    highestTargetHit,
    reachedTarget: highestTargetHit !== null,
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
    read: "Possible Wave 5 up marks are unavailable.",
    w5UpTargets: buildEmptyTargets(),
    postW5DownFibLevels: buildEmptyRetraceLevels(),
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
  postDownImpulseBounce = null,
} = {}) {
  const price = validPrice(currentPrice);

  const reclassificationActive =
    postDownImpulseBounce?.possibleW5UpReclassification === true ||
    String(postDownImpulseBounce?.state || "").toUpperCase() ===
      "POST_MINOR_5_BOUNCE_EXCEEDED_C2618_POSSIBLE_W5_UP";

  if (!reclassificationActive) {
    return emptyRead({
      symbol,
      currentPrice: price,
      reason: "POSSIBLE_W5_UP_RECLASSIFICATION_NOT_ACTIVE",
    });
  }

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

  const provisionalW5High = w5High ?? price;

  const w5UpTargets = buildW5UpTargets({
    symbol,
    originLow,
    w1High,
    w2Low,
    w3High,
    w4Low,
  });

  const targetProgress = classifyTargetProgress({
    currentPrice: price,
    w5High,
    targets: w5UpTargets,
  });

  const postW5DownFibLevels = buildRetraceDownFromHigh({
    symbol,
    low: originLow,
    high: provisionalW5High,
  });

  const w5Marked = w5High !== null;

  let state = "POSSIBLE_MINOR_W5_UP_ACTIVE";
  let nextExpectedStructure = "WAIT_FOR_W5_COMPLETION_OR_PULLBACK_RECLAIM";
  let read =
    "Wave 4 low may be complete. Current move is treated as possible Minor Wave 5 up. Read-only watch only.";

  if (originLow === null) {
    state = "POSSIBLE_W5_UP_ORIGIN_MISSING";
    nextExpectedStructure = "MARK_W4_LOW_ORIGIN";
    read =
      "Possible Wave 5 up reclassification is active, but the Wave 4 low / origin is missing.";
  } else if (w5Marked) {
    state = "POSSIBLE_MINOR_W5_UP_HIGH_MARKED_WATCH_PULLBACK";
    nextExpectedStructure = "WATCH_POST_W5_PULLBACK_LEVELS";
    read =
      "Possible Minor Wave 5 up has a marked high. Watch expected downside retracement levels off the Wave 5 high. Read-only watch only.";
  } else if (w3High !== null && w4Low !== null) {
    state = "POSSIBLE_MINOR_W5_UP_W4_MARKED_W5_ACTIVE";
    nextExpectedStructure = "WATCH_W5_UP_TARGETS";
    read =
      "Possible Minor Wave 5 up has W3 high and W4 low marked. Watching W5 up targets. No chase.";
  }

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

    provisionalW5High: roundPrice(provisionalW5High, symbol),

    rangeFromOriginToW5:
      originLow !== null && provisionalW5High !== null
        ? roundPrice(provisionalW5High - originLow, symbol)
        : null,

    w5Marked,
    w5UpTargets,
    targetProgress,
    postW5DownFibLevels,

    nextExpectedStructure,
    read,

    needs: [
      "WAIT_FOR_W5_COMPLETION_OR_PULLBACK_RECLAIM",
      "NO_CHASE_LONG",
      "NO_AUTOMATIC_LONG",
      "NO_AUTOMATIC_SHORT",
      "NO_EXECUTION",
    ],

    reasonCodes: [
      "POSSIBLE_W5_UP_LIFECYCLE_BUILT",
      "POSSIBLE_W5_UP_RECLASSIFICATION_ACTIVE",
      state,
      w5Marked ? "W5_HIGH_MARKED" : "W5_HIGH_NOT_MARKED",
      targetProgress.highestTargetHit
        ? `W5_UP_TARGET_HIT_${String(targetProgress.highestTargetHit).toUpperCase()}`
        : null,
      "READ_ONLY",
      "NO_EXECUTION",
      "DIRECTION_NONE",
    ].filter(Boolean),
  };
}

export default buildPossibleW5UpLifecycle;
