
// services/core/logic/engine22/wave/lifecycle/postDownImpulseBounceLifecycle.js
// Engine 22 — Post-down-impulse corrective bounce lifecycle
//
// Purpose:
// After Minor W5 down is complete, read the corrective ABC bounce from the completed W5 low.
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

function buildEmptyLevels() {
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
    c100: null,
    c1272: null,
    c1618: null,
    c200: null,
    c2618: null,
  };
}

function buildBRetraceLevels({ symbol, originLow, aHigh }) {
  const origin = validPrice(originLow);
  const high = validPrice(aHigh);

  if (origin === null || high === null || high <= origin) {
    return buildEmptyLevels();
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

function buildCUpTargets({ symbol, originLow, aHigh, bLow }) {
  const origin = validPrice(originLow);
  const high = validPrice(aHigh);
  const b = validPrice(bLow);

  if (origin === null || high === null || b === null || high <= origin) {
    return buildEmptyTargets();
  }

  const range = high - origin;

  return {
    c100: roundPrice(b + range * 1.0, symbol),
    c1272: roundPrice(b + range * 1.272, symbol),
    c1618: roundPrice(b + range * 1.618, symbol),
    c200: roundPrice(b + range * 2.0, symbol),
    c2618: roundPrice(b + range * 2.618, symbol),
  };
}

function classifyB({
  originLow,
  aHigh,
  bLow,
}) {
  const origin = validPrice(originLow);
  const high = validPrice(aHigh);
  const b = validPrice(bLow);

  if (origin === null || high === null) {
    return {
      status: "B_UNAVAILABLE",
      retraceRatio: null,
      retracePct: null,
      correctionFamily: "UNKNOWN",
      correctionType: "UNKNOWN",
      correctionQuality: "UNKNOWN",
    };
  }

  if (b === null) {
    return {
      status: "WAITING_FOR_B_LOW",
      retraceRatio: null,
      retracePct: null,
      correctionFamily: "UNKNOWN",
      correctionType: "UNKNOWN",
      correctionQuality: "WAITING_FOR_B",
    };
  }

  const range = high - origin;

  if (!Number.isFinite(range) || range <= 0) {
    return {
      status: "INVALID_A_RANGE",
      retraceRatio: null,
      retracePct: null,
      correctionFamily: "UNKNOWN",
      correctionType: "INVALID_A_RANGE",
      correctionQuality: "INVALID",
    };
  }

  const retraceRatio = (high - b) / range;
  const retracePct = Number((retraceRatio * 100).toFixed(1));

  if (b < origin) {
    return {
      status: "B_UNDERCUT_ORIGIN",
      retraceRatio: round2(retraceRatio),
      retracePct,
      correctionFamily: "EXPANDED_FLAT",
      correctionType: "EXPANDED_FLAT_CANDIDATE",
      correctionQuality: "AGGRESSIVE_B_UNDERCUT",
    };
  }

  if (retraceRatio >= 0.786) {
    return {
      status: "DEEP_B_RETRACE",
      retraceRatio: round2(retraceRatio),
      retracePct,
      correctionFamily: "FLAT_OR_DEEP_ZIGZAG",
      correctionType: "DEEP_B_CANDIDATE",
      correctionQuality: "DEEP_B",
    };
  }

  if (retraceRatio >= 0.5 && retraceRatio < 0.786) {
    return {
      status: "NORMAL_B_RETRACE",
      retraceRatio: round2(retraceRatio),
      retracePct,
      correctionFamily: "ZIGZAG_OR_FLAT",
      correctionType: "NORMAL_B_CANDIDATE",
      correctionQuality: "NORMAL_B",
    };
  }

  if (retraceRatio > 0 && retraceRatio < 0.5) {
    return {
      status: "SHALLOW_B_RETRACE",
      retraceRatio: round2(retraceRatio),
      retracePct,
      correctionFamily: "SHALLOW_ZIGZAG",
      correctionType: "SHALLOW_B_CANDIDATE",
      correctionQuality: "SHALLOW_B",
    };
  }

  return {
    status: "INVALID_B_RETRACE",
    retraceRatio: round2(retraceRatio),
    retracePct,
    correctionFamily: "UNKNOWN",
    correctionType: "INVALID_B",
    correctionQuality: "INVALID",
  };
}

function classifyCProgress({
  currentPrice,
  originLow,
  aHigh,
  bLow,
  cHigh,
  cUpTargets,
}) {
  const price = validPrice(currentPrice);
  const origin = validPrice(originLow);
  const a = validPrice(aHigh);
  const b = validPrice(bLow);
  const c = validPrice(cHigh);

  const activeHigh = c ?? price;

  const targetEntries = [
    ["c100", cUpTargets?.c100],
    ["c1272", cUpTargets?.c1272],
    ["c1618", cUpTargets?.c1618],
    ["c200", cUpTargets?.c200],
    ["c2618", cUpTargets?.c2618],
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
    aboveOrigin: price !== null && origin !== null ? price > origin : null,
    aboveAHigh: price !== null && a !== null ? price > a : null,
    aboveBLow: price !== null && b !== null ? price > b : null,
    belowOrigin: price !== null && origin !== null ? price < origin : null,
    cMarked: c !== null,
    cHigh: c,
    highestTargetHit,
    reached100: highestTargetHit !== null,
  };
}

function emptyRead({
  symbol,
  currentPrice,
  reason,
}) {
  return {
    active: false,
    state: "POST_DOWN_IMPULSE_BOUNCE_UNAVAILABLE",
    readOnly: true,
    direction: "NONE",
    tradeableOpportunityBlocked: true,
    noExecution: true,
    symbol,
    currentPrice: round2(currentPrice),
    degree: "minor",
    reason,
    originLow: null,
    waveAHigh: null,
    waveBLow: null,
    waveCHigh: null,
    bRetraceLevels: buildEmptyLevels(),
    cUpTargets: buildEmptyTargets(),
    read: "Post-down-impulse bounce marks are unavailable.",
    reasonCodes: [
      "POST_DOWN_IMPULSE_BOUNCE_LIFECYCLE_BUILT",
      reason,
      "READ_ONLY",
      "NO_EXECUTION",
      "DIRECTION_NONE",
    ],
  };
}

export function buildPostDownImpulseBounceLifecycle({
  symbol = "ES",
  degree = "minor",
  currentPrice = null,
  downImpulse = null,
  postW5BounceMarks = null,
} = {}) {
  const price = validPrice(currentPrice);

  const downImpulseState = String(downImpulse?.state || "").toUpperCase();
  const downImpulseComplete =
    downImpulse?.impulseComplete === true ||
    downImpulseState === "POST_MINOR_5_CORRECTIVE_BOUNCE_WATCH" ||
    downImpulseState === "MINOR_DOWN_IMPULSE_COMPLETE_AT_LOW";

  if (!downImpulseComplete) {
    return emptyRead({
      symbol,
      currentPrice: price,
      reason: "DOWN_IMPULSE_NOT_COMPLETE",
    });
  }

  if (!postW5BounceMarks || typeof postW5BounceMarks !== "object") {
    return emptyRead({
      symbol,
      currentPrice: price,
      reason: "POST_W5_BOUNCE_MARKS_MISSING",
    });
  }

  const originLow =
    validPrice(postW5BounceMarks.originLow) ??
    validPrice(downImpulse?.completedLow);

  const originTime =
    postW5BounceMarks.originTime ||
    downImpulse?.completedTime ||
    null;

  const waveAHigh = validPrice(postW5BounceMarks.aHigh);
  const aTime = postW5BounceMarks.aTime || null;

  const waveBLow = validPrice(postW5BounceMarks.bLow);
  const bTime = postW5BounceMarks.bTime || null;

  const waveCHigh = validPrice(postW5BounceMarks.cHigh);
  const cTime = postW5BounceMarks.cTime || null;

  const bRetraceLevels = buildBRetraceLevels({
    symbol,
    originLow,
    aHigh: waveAHigh,
  });

  const cUpTargets = buildCUpTargets({
    symbol,
    originLow,
    aHigh: waveAHigh,
    bLow: waveBLow,
  });

  const bClassification = classifyB({
    originLow,
    aHigh: waveAHigh,
    bLow: waveBLow,
  });

  const cProgress = classifyCProgress({
    currentPrice: price,
    originLow,
    aHigh: waveAHigh,
    bLow: waveBLow,
    cHigh: waveCHigh,
    cUpTargets,
  });
  
  const c200 = validPrice(cUpTargets?.c200);
  const c2618 = validPrice(cUpTargets?.c2618);

  const c200Exceeded =
    price !== null &&
    c200 !== null &&
    price >= c200;

  const c2618Exceeded =
    price !== null &&
    c2618 !== null &&
    price >= c2618;

  const possibleW5UpReclassification =
    waveCHigh === null &&
    c2618Exceeded === true &&
    cProgress?.aboveAHigh === true;
  

  let state = "POST_MINOR_5_BOUNCE_WAITING_FOR_A";
  let nextExpectedStructure = "WAIT_FOR_A_HIGH";
  let read =
    "Minor downside impulse is complete. Waiting for A-up high to define the corrective bounce.";

  if (originLow === null) {
    state = "POST_MINOR_5_BOUNCE_ORIGIN_MISSING";
    nextExpectedStructure = "MARK_ORIGIN_LOW";
    read =
      "Minor downside impulse is complete, but the post-W5 bounce origin is missing.";
  } else if (waveAHigh !== null && waveBLow === null) {
    state = "POST_MINOR_5_BOUNCE_A_MARKED_WAITING_FOR_B";
    nextExpectedStructure = "WAIT_FOR_B_PULLBACK";
    read =
      "Post-Minor-5 bounce A high is marked. Waiting for B pullback before projecting C-up targets.";
  } else if (waveAHigh !== null && waveBLow !== null && waveCHigh === null) {
    if (price !== null && waveAHigh !== null && price > waveAHigh) {
      state = "POST_MINOR_5_BOUNCE_C_LEG_ACTIVE";
      nextExpectedStructure = "WATCH_C_UP_TARGETS_AND_HTF_DECISION";
      read =
        "Post-Minor-5 bounce has A and B marked. Price is above A high, so C-up leg is active. Read-only watch.";
    } else {
      state = "POST_MINOR_5_BOUNCE_B_MARKED_C_UP_WATCH";
      nextExpectedStructure = "WAIT_FOR_C_UP_RECLAIM_OR_FAILURE";
      read =
        "Post-Minor-5 bounce has A and B marked. Watching for C-up reclaim attempt or bounce failure.";
    }
  } else if (waveAHigh !== null && waveBLow !== null && waveCHigh !== null) {
    state = "POST_MINOR_5_BOUNCE_C_COMPLETE_HTF_DECISION_WATCH";
    nextExpectedStructure = "WATCH_HTF_DECISION_OR_BOUNCE_FAILURE";
    read =
      "Post-Minor-5 ABC bounce has C high marked. Treat as C-leg maturity / higher-timeframe decision watch.";
  }

  const failedBounce =
    price !== null &&
    originLow !== null &&
    price < originLow;

  if (possibleW5UpReclassification) {
  state = "POST_MINOR_5_BOUNCE_EXCEEDED_C2618_POSSIBLE_W5_UP";
  nextExpectedStructure = "WAIT_FOR_PULLBACK_RECLAIM_TO_CONFIRM_W5_UP";
  read =
    "Post-Minor-5 corrective bounce exceeded the C 2.618 target without a marked C high. Treat as possible Wave 5 up reclassification / bullish continuation watch. No chase. Wait for controlled pullback or reclaim confirmation.";
} else if (c200Exceeded && waveCHigh === null) {
  state = "POST_MINOR_5_BOUNCE_EXCEEDED_C200_C_LEG_EXTENDED";
  nextExpectedStructure = "WATCH_C_UP_MATURITY_OR_W5_UP_RECLASSIFICATION";
  read =
    "Post-Minor-5 corrective bounce exceeded the C 2.000 target. C-up is extended and mature. Watch for either C-leg exhaustion or possible Wave 5 up reclassification.";
}  

  if (failedBounce) {
    state = "POST_MINOR_5_BOUNCE_FAILED_BELOW_ORIGIN";
    nextExpectedStructure = "WATCH_DOWNSIDE_CONTINUATION_RISK";
    read =
      "Post-Minor-5 corrective bounce failed below the completed W5 low / bounce origin. Downside continuation risk returns.";
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

    waveAHigh: roundPrice(waveAHigh, symbol),
    aTime,

    waveBLow: roundPrice(waveBLow, symbol),
    bTime,

    waveCHigh: roundPrice(waveCHigh, symbol),
    cTime,

    rangeA:
      originLow !== null && waveAHigh !== null
        ? roundPrice(waveAHigh - originLow, symbol)
        : null,

    bRetraceLevels,
    cUpTargets,

    bStatus: bClassification.status,
    bRetraceRatio: bClassification.retraceRatio,
    bRetracePct: bClassification.retracePct,
    correctionFamily: bClassification.correctionFamily,
    correctionType: bClassification.correctionType,
    correctionQuality: bClassification.correctionQuality,

    cProgress,

    c200Exceeded,
    c2618Exceeded,
    possibleW5UpReclassification,

    failedBounce,
    nextExpectedStructure,
    read,

    needs: [
      "WATCH_CORRECTIVE_BOUNCE_STRUCTURE",
      "WAIT_FOR_HTF_DECISION",
      "NO_AUTOMATIC_LONG",
      "NO_AUTOMATIC_SHORT",
      "NO_EXECUTION",
    ],

    reasonCodes: [
      "POST_DOWN_IMPULSE_BOUNCE_LIFECYCLE_BUILT",
      "DOWN_IMPULSE_COMPLETE",
      "POST_W5_BOUNCE_MARKS_FOUND",
      state,
      bClassification.status,
      bClassification.correctionType,
      cProgress.highestTargetHit
       ? `C_UP_TARGET_HIT_${String(cProgress.highestTargetHit).toUpperCase()}`
       : null,
      c200Exceeded ? "C_UP_EXCEEDED_C200" : null,
      c2618Exceeded ? "C_UP_EXCEEDED_C2618" : null,
      possibleW5UpReclassification
        ? "POSSIBLE_W5_UP_RECLASSIFICATION"
        : null,
      failedBounce ? "POST_W5_BOUNCE_FAILED" : null,
      "READ_ONLY",
      "NO_EXECUTION",
      "DIRECTION_NONE",
    ].filter(Boolean),
  };
}

export default buildPostDownImpulseBounceLifecycle;
