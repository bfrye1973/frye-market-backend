// services/core/logic/engine3/engine22LifecycleReaction.js
//
// Engine 3 generic lifecycle reaction confirmer.
//
// Contract:
// - Engine 22 owns lifecycle meaning.
// - Engine 22 exposes currentLifecycleState.confirmationContext.
// - Engine 3 reads confirmationContext only.
// - Engine 3 returns reaction confirmation only.
// - Engine 3 does not create permission, execution, readiness, broker actions,
//   automatic longs, or automatic shorts.
//
// Do not add lifecycle-key-specific branches here.
// currentLifecycleState.key is diagnostics only.

const ENGINE = "engine3.engine22LifecycleReaction.v1";
const SOURCE =
  "engine22WaveStrategy.currentLifecycleState.confirmationContext";

const SUPPORTED_REACTION_FOCUS = new Set([
  "ZONE_DEFENSE",
  "SUPPORT_DEFENSE",
  "RECLAIM",
  "CONTROLLED_PULLBACK_OR_RECLAIM",
  "HIGHER_LOW_HOLD",
  "EMA10_EMA20_RECLAIM",
  "LOCAL_RANGE_BREAK",
  "NONE",
]);

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function uniqueReasonCodes(reasonCodes = []) {
  return [...new Set(reasonCodes.filter(Boolean))];
}

function normalizeBar(bar) {
  return {
    open: toNum(bar?.open ?? bar?.o),
    high: toNum(bar?.high ?? bar?.h),
    low: toNum(bar?.low ?? bar?.l),
    close: toNum(bar?.close ?? bar?.c),
    time: bar?.time ?? bar?.t ?? bar?.tSec ?? null,
  };
}

function normalizeZone(zone) {
  if (!zone || typeof zone !== "object") return null;

  const lo = toNum(zone.lo ?? zone.low ?? zone.from);
  const hi = toNum(zone.hi ?? zone.high ?? zone.to);

  if (lo == null || hi == null) return null;

  return {
    ...zone,
    lo: Math.min(lo, hi),
    hi: Math.max(lo, hi),
  };
}

function pickPriceProgressReference(reference = {}) {
  const progress = reference?.priceProgress || {};

  const candidates = [
    progress?.minute?.currentRetraceZone,
    progress?.minor?.currentRetraceZone,
    progress?.intermediate?.currentRetraceZone,
  ].filter(Boolean);

  const scored = candidates
    .map((item) => ({
      ...item,
      price: toNum(item.price),
      absDistancePts: toNum(item.absDistancePts),
    }))
    .filter((item) => item.price != null)
    .sort((a, b) => {
      const da = a.absDistancePts ?? 999999;
      const db = b.absDistancePts ?? 999999;
      return da - db;
    });

  return scored[0] || null;
}

function getReferenceZone(reference = {}) {
  return (
    normalizeZone(reference.pullbackZone) ||
    normalizeZone(reference.zone) ||
    normalizeZone(reference.zones?.pullbackZone) ||
    normalizeZone(reference.zones?.zone) ||
    null
  );
}

function getReferenceLevel(reference = {}) {
  return (
    toNum(reference.reclaimLevel) ??
    toNum(reference.triggerLevel) ??
    toNum(reference.level) ??
    toNum(reference.localRangeHigh) ??
    toNum(reference.priorHigh) ??
    toNum(reference.priorCandleHigh) ??
    toNum(reference.ema10) ??
    toNum(reference.ema20) ??
    toNum(pickPriceProgressReference(reference)?.price)
  );
}

function buildBaseResult({
  currentLifecycleState,
  confirmation = null,
  reference = {},
  currentPrice = null,
  active = false,
  mode = "NONE",
  direction = "NEUTRAL",
  reactionFocus = "NONE",
  reactionState = "NO_SIGNAL",
  reactionQuality = "WEAK",
  confirmed = false,
  reasonCodes = [],
  debug = null,
} = {}) {
  return {
    active,
    engine: ENGINE,
    source: SOURCE,

    lifecycleKey: currentLifecycleState?.key || null,
    mode,
    direction,

    reactionFocus,
    reactionState,
    reactionQuality,
    confirmed,

    currentPrice,
    reference,

    noPermissionCreated: true,
    noExecution: true,

    ...(debug ? { debug } : {}),

    reasonCodes: uniqueReasonCodes([
      ...reasonCodes,
      confirmation?.noPermissionCreated === true
        ? "NO_PERMISSION_CREATED"
        : "NO_PERMISSION_CREATED",
      confirmation?.noExecution === true ? "NO_EXECUTION" : "NO_EXECUTION",
    ]),
  };
}

function buildMissingContextResult({ currentLifecycleState } = {}) {
  return buildBaseResult({
    currentLifecycleState,
    active: false,
    mode: "NONE",
    direction: "NEUTRAL",
    reactionFocus: "NONE",
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    currentPrice: null,
    reference: {},
    reasonCodes: [
      "ENGINE22_CONFIRMATION_CONTEXT_MISSING",
      "CONFIRMATION_CONTEXT_NOT_PRESENT",
    ],
  });
}

function buildInactiveContextResult({
  currentLifecycleState,
  confirmation,
  reference,
  currentPrice,
  mode,
  direction,
  reactionFocus,
  reasonCodes = [],
} = {}) {
  return buildBaseResult({
    currentLifecycleState,
    confirmation,
    reference,
    currentPrice,
    active: false,
    mode,
    direction,
    reactionFocus,
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    reasonCodes: [
      "ENGINE22_CONFIRMATION_CONTEXT_INACTIVE",
      "REACTION_NOT_REQUIRED_BY_ENGINE22",
      ...reasonCodes,
    ],
  });
}

function buildUnsupportedFocusResult({
  currentLifecycleState,
  confirmation,
  reference,
  currentPrice,
  mode,
  direction,
  reactionFocus,
  reasonCodes = [],
} = {}) {
  return buildBaseResult({
    currentLifecycleState,
    confirmation,
    reference,
    currentPrice,
    active: false,
    mode,
    direction,
    reactionFocus,
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    reasonCodes: [
      "REACTION_FOCUS_NONE_OR_UNSUPPORTED",
      ...reasonCodes,
    ],
  });
}

function directionUnsupportedResult({
  currentLifecycleState,
  confirmation,
  reference,
  currentPrice,
  mode,
  direction,
  reactionFocus,
  reasonCodes = [],
  debug = null,
} = {}) {
  return buildBaseResult({
    currentLifecycleState,
    confirmation,
    reference,
    currentPrice,
    active: false,
    mode,
    direction,
    reactionFocus,
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    reasonCodes: [
      "ENGINE3_SHORT_DIRECTION_NOT_SUPPORTED_YET",
      "REACTION_NOT_CONFIRMED",
      ...reasonCodes,
    ],
    debug,
  });
}

function buildBarFacts({
  reference = {},
  bars = [],
  currentPrice = null,
  currentLifecycleState = null,
} = {}) {
  const last = normalizeBar(bars[bars.length - 1] || {});
  const prev = normalizeBar(bars[bars.length - 2] || {});

  const price =
    toNum(reference.currentPrice) ??
    toNum(currentPrice) ??
    last.close ??
    toNum(currentLifecycleState?.currentPrice) ??
    null;

  const referenceLevel = getReferenceLevel(reference);
  const referenceZone = getReferenceZone(reference);
  const priceProgressReference = pickPriceProgressReference(reference);

  const touchedZone =
    Boolean(referenceZone) &&
    last.low != null &&
    last.high != null &&
    last.low <= referenceZone.hi &&
    last.high >= referenceZone.lo;

  const priceInsideZone =
    Boolean(referenceZone) &&
    price != null &&
    price >= referenceZone.lo &&
    price <= referenceZone.hi;

  const nearLevel =
    referenceLevel != null &&
    price != null &&
    Math.abs(price - referenceLevel) <= 1.0;

  const touchedLevel =
    referenceLevel != null &&
    last.low != null &&
    last.high != null &&
    last.low <= referenceLevel &&
    last.high >= referenceLevel;

  const priorCandleHighReclaimed =
    prev.high != null &&
    last.close != null &&
    last.close > prev.high;

  const priorCandleLowLost =
    prev.low != null &&
    last.close != null &&
    last.close < prev.low;

  const closeAboveReference =
    referenceLevel != null &&
    last.close != null &&
    last.close > referenceLevel;

  const closeBelowReference =
    referenceLevel != null &&
    last.close != null &&
    last.close < referenceLevel;

  const zoneDefended =
    Boolean(referenceZone) &&
    last.close != null &&
    last.low != null &&
    last.low <= referenceZone.hi &&
    last.close >= referenceZone.lo;

  const wickBelowAndReclaim =
    referenceZone
      ? last.low != null &&
        last.close != null &&
        last.low < referenceZone.lo &&
        last.close >= referenceZone.lo
      : referenceLevel != null &&
        last.low != null &&
        last.close != null &&
        last.low < referenceLevel &&
        last.close >= referenceLevel;

  const failedReclaim =
    prev.high != null &&
    last.high != null &&
    last.close != null &&
    last.high <= prev.high &&
    last.close < prev.high &&
    !priorCandleHighReclaimed;

  const ema10 = toNum(reference.ema10 ?? reference.emaContext?.ema10);
  const ema20 = toNum(reference.ema20 ?? reference.emaContext?.ema20);

  const emaHeld =
    (
      ema10 != null &&
      last.low != null &&
      last.close != null &&
      last.low <= ema10 &&
      last.close >= ema10
    ) ||
    (
      ema20 != null &&
      last.low != null &&
      last.close != null &&
      last.low <= ema20 &&
      last.close >= ema20
    );

  const emaReclaimed =
    (
      ema10 != null &&
      prev.close != null &&
      last.close != null &&
      prev.close <= ema10 &&
      last.close > ema10
    ) ||
    (
      ema20 != null &&
      prev.close != null &&
      last.close != null &&
      prev.close <= ema20 &&
      last.close > ema20
    );

  return {
    last,
    prev,
    price,

    referenceLevel,
    referenceZone,
    priceProgressReference,

    touchedZone,
    priceInsideZone,
    nearLevel,
    touchedLevel,

    priorCandleHighReclaimed,
    priorCandleLowLost,

    closeAboveReference,
    closeBelowReference,

    zoneDefended,
    wickBelowAndReclaim,
    failedReclaim,

    ema10,
    ema20,
    emaHeld,
    emaReclaimed,
  };
}

function debugPayload({ facts, extraDebug = null, reactionContext = null } = {}) {
  return {
    referenceLevel: facts.referenceLevel,
    referenceZone: facts.referenceZone,
    priceProgressReference: facts.priceProgressReference,

    priorCandleHighReclaimed: facts.priorCandleHighReclaimed,
    priorCandleLowLost: facts.priorCandleLowLost,

    closeAboveReference: facts.closeAboveReference,
    closeBelowReference: facts.closeBelowReference,

    touchedZone: facts.touchedZone,
    touchedLevel: facts.touchedLevel,
    priceInsideZone: facts.priceInsideZone,
    nearLevel: facts.nearLevel,

    zoneDefended: facts.zoneDefended,
    wickBelowAndReclaim: facts.wickBelowAndReclaim,
    failedReclaim: facts.failedReclaim,

    emaHeld: facts.emaHeld,
    emaReclaimed: facts.emaReclaimed,

    lastCandle: facts.last,
    priorCandle: facts.prev,

    extra: extraDebug,
    reactionContext,
  };
}

function evaluateZoneDefenseLong({ facts, reasonCodes }) {
  if (!facts.referenceZone && facts.referenceLevel == null) {
    return {
      reactionState: "NO_SIGNAL",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "ENGINE3_REFERENCE_FIELD_MISSING",
        "ZONE_OR_LEVEL_REFERENCE_MISSING",
      ],
    };
  }

  if (facts.wickBelowAndReclaim) {
    return {
      reactionState: "CONFIRMED",
      reactionQuality: "STRONG",
      confirmed: true,
      reasonCodes: [
        ...reasonCodes,
        "WICK_BELOW_AND_RECLAIM",
        "ENGINE3_REACTION_CONFIRMED",
      ],
    };
  }

  if (facts.zoneDefended || facts.closeAboveReference) {
    const confirmed = facts.priorCandleHighReclaimed === true;

    return {
      reactionState: confirmed ? "CONFIRMED" : "GOOD",
      reactionQuality: confirmed ? "STRONG" : "GOOD",
      confirmed,
      reasonCodes: [
        ...reasonCodes,
        "ZONE_OR_LEVEL_DEFENDED",
        confirmed
          ? "PRIOR_CANDLE_HIGH_RECLAIMED"
          : "WAITING_FOR_PRIOR_CANDLE_HIGH_RECLAIM",
      ],
    };
  }

  if (
    facts.touchedZone ||
    facts.touchedLevel ||
    facts.priceInsideZone ||
    facts.nearLevel
  ) {
    return {
      reactionState: "MIXED",
      reactionQuality: "MIXED",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "ZONE_TOUCHED_WAITING_FOR_DEFENSE",
      ],
    };
  }

  if (facts.closeBelowReference || facts.priorCandleLowLost) {
    return {
      reactionState: "FAILED",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "SUPPORT_OR_LEVEL_LOST",
      ],
    };
  }

  return {
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    reasonCodes: [
      ...reasonCodes,
      "WAITING_FOR_ZONE_DEFENSE",
    ],
  };
}

function evaluateReclaimLong({ facts, reasonCodes }) {
  if (facts.referenceLevel == null) {
    return {
      reactionState: "NO_SIGNAL",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "ENGINE3_REFERENCE_FIELD_MISSING",
        "RECLAIM_LEVEL_MISSING",
      ],
    };
  }

  if (facts.closeAboveReference && facts.priorCandleHighReclaimed) {
    return {
      reactionState: "CONFIRMED",
      reactionQuality: "STRONG",
      confirmed: true,
      reasonCodes: [
        ...reasonCodes,
        "RECLAIM_CONFIRMED",
        "ENGINE3_REACTION_CONFIRMED",
      ],
    };
  }

  if (facts.closeAboveReference) {
    return {
      reactionState: "GOOD",
      reactionQuality: "GOOD",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "RECLAIM_STARTED",
        "WAITING_FOR_PRIOR_CANDLE_HIGH_RECLAIM",
      ],
    };
  }

  if (facts.failedReclaim) {
    return {
      reactionState: "FAILED",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "FAILED_RECLAIM",
      ],
    };
  }

  if (facts.nearLevel || facts.touchedLevel) {
    return {
      reactionState: "MIXED",
      reactionQuality: "MIXED",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "NEAR_RECLAIM_LEVEL_WAITING",
      ],
    };
  }

  return {
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    reasonCodes: [
      ...reasonCodes,
      "WAITING_FOR_RECLAIM",
    ],
  };
}

function evaluateControlledPullbackOrReclaimLong({ facts, reasonCodes }) {
  const pullbackReferenceUsable =
    facts.referenceZone ||
    facts.referenceLevel != null ||
    facts.priceProgressReference;

  if (!pullbackReferenceUsable) {
    return {
      reactionState: "NO_SIGNAL",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "ENGINE3_REFERENCE_FIELD_MISSING",
        "CONTROLLED_PULLBACK_REFERENCE_MISSING",
      ],
    };
  }

  if (
    (facts.closeAboveReference && facts.priorCandleHighReclaimed) ||
    (facts.emaReclaimed && facts.priorCandleHighReclaimed)
  ) {
    return {
      reactionState: "CONFIRMED",
      reactionQuality: "STRONG",
      confirmed: true,
      reasonCodes: [
        ...reasonCodes,
        "RECLAIM_CONFIRMED",
        "ENGINE3_REACTION_CONFIRMED",
      ],
    };
  }

  if (facts.wickBelowAndReclaim) {
    return {
      reactionState: "GOOD",
      reactionQuality: "GOOD",
      confirmed: facts.priorCandleHighReclaimed === true,
      reasonCodes: [
        ...reasonCodes,
        "PULLBACK_WICK_RECLAIM",
        facts.priorCandleHighReclaimed
          ? "PRIOR_CANDLE_HIGH_RECLAIMED"
          : "WAITING_FOR_PRIOR_CANDLE_HIGH_RECLAIM",
      ],
    };
  }

  if (
    facts.zoneDefended ||
    facts.emaHeld ||
    (facts.priceProgressReference && facts.nearLevel)
  ) {
    const confirmed = facts.priorCandleHighReclaimed === true;

    return {
      reactionState: confirmed ? "CONFIRMED" : "GOOD",
      reactionQuality: confirmed ? "STRONG" : "GOOD",
      confirmed,
      reasonCodes: [
        ...reasonCodes,
        "CONTROLLED_PULLBACK_HOLDING",
        confirmed
          ? "PRIOR_CANDLE_HIGH_RECLAIMED"
          : "WAITING_FOR_PRIOR_CANDLE_HIGH_RECLAIM",
      ],
    };
  }

  if (facts.failedReclaim) {
    return {
      reactionState: "FAILED",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "FAILED_RECLAIM",
      ],
    };
  }

  if (
    facts.nearLevel ||
    facts.touchedLevel ||
    facts.touchedZone ||
    facts.priceInsideZone
  ) {
    return {
      reactionState: "MIXED",
      reactionQuality: "MIXED",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "PULLBACK_AREA_TOUCHED_WAITING",
      ],
    };
  }

  return {
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    reasonCodes: [
      ...reasonCodes,
      "WAITING_FOR_CONTROLLED_PULLBACK_OR_RECLAIM",
    ],
  };
}

function evaluateHigherLowHoldLong({ facts, reasonCodes }) {
  if (facts.prev.low == null || facts.last.low == null) {
    return {
      reactionState: "NO_SIGNAL",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "ENGINE3_REFERENCE_FIELD_MISSING",
        "HIGHER_LOW_REFERENCE_MISSING",
      ],
    };
  }

  const higherLowHeld =
    facts.last.low > facts.prev.low &&
    facts.last.close != null &&
    facts.prev.close != null &&
    facts.last.close >= facts.prev.close;

  if (higherLowHeld) {
    const confirmed = facts.priorCandleHighReclaimed === true;

    return {
      reactionState: confirmed ? "CONFIRMED" : "GOOD",
      reactionQuality: confirmed ? "STRONG" : "GOOD",
      confirmed,
      reasonCodes: [
        ...reasonCodes,
        "HIGHER_LOW_HELD",
        confirmed
          ? "PRIOR_CANDLE_HIGH_RECLAIMED"
          : "WAITING_FOR_PRIOR_CANDLE_HIGH_RECLAIM",
      ],
    };
  }

  if (facts.priorCandleLowLost) {
    return {
      reactionState: "FAILED",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "PRIOR_CANDLE_LOW_LOST",
      ],
    };
  }

  return {
    reactionState: "MIXED",
    reactionQuality: "MIXED",
    confirmed: false,
    reasonCodes: [
      ...reasonCodes,
      "HIGHER_LOW_NOT_CONFIRMED_YET",
    ],
  };
}

function evaluateEmaReclaimLong({ facts, reasonCodes }) {
  if (facts.ema10 == null && facts.ema20 == null) {
    return {
      reactionState: "NO_SIGNAL",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "ENGINE3_REFERENCE_FIELD_MISSING",
        "EMA10_EMA20_REFERENCE_MISSING",
      ],
    };
  }

  if (facts.emaReclaimed && facts.priorCandleHighReclaimed) {
    return {
      reactionState: "CONFIRMED",
      reactionQuality: "STRONG",
      confirmed: true,
      reasonCodes: [
        ...reasonCodes,
        "EMA_RECLAIM_CONFIRMED",
        "ENGINE3_REACTION_CONFIRMED",
      ],
    };
  }

  if (facts.emaHeld || facts.emaReclaimed) {
    return {
      reactionState: "GOOD",
      reactionQuality: "GOOD",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "EMA_CONTEXT_HOLDING",
        "WAITING_FOR_PRIOR_CANDLE_HIGH_RECLAIM",
      ],
    };
  }

  return {
    reactionState: "MIXED",
    reactionQuality: "MIXED",
    confirmed: false,
    reasonCodes: [
      ...reasonCodes,
      "EMA_RECLAIM_WAITING",
    ],
  };
}

function evaluateLocalRangeBreakLong({ facts, reference, reasonCodes }) {
  const localRangeHigh = toNum(reference.localRangeHigh);

  if (localRangeHigh == null) {
    return {
      reactionState: "NO_SIGNAL",
      reactionQuality: "WEAK",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "ENGINE3_REFERENCE_FIELD_MISSING",
        "LOCAL_RANGE_HIGH_MISSING",
      ],
    };
  }

  if (
    facts.last.close != null &&
    facts.last.close > localRangeHigh &&
    facts.priorCandleHighReclaimed
  ) {
    return {
      reactionState: "CONFIRMED",
      reactionQuality: "STRONG",
      confirmed: true,
      reasonCodes: [
        ...reasonCodes,
        "LOCAL_RANGE_HIGH_BROKEN",
        "ENGINE3_REACTION_CONFIRMED",
      ],
    };
  }

  if (facts.last.close != null && facts.last.close > localRangeHigh) {
    return {
      reactionState: "GOOD",
      reactionQuality: "GOOD",
      confirmed: false,
      reasonCodes: [
        ...reasonCodes,
        "LOCAL_RANGE_BREAK_STARTED",
        "WAITING_FOR_PRIOR_CANDLE_HIGH_RECLAIM",
      ],
    };
  }

  return {
    reactionState: "MIXED",
    reactionQuality: "MIXED",
    confirmed: false,
    reasonCodes: [
      ...reasonCodes,
      "LOCAL_RANGE_BREAK_WAITING",
    ],
  };
}

function evaluateLongReaction({
  reactionFocus,
  facts,
  reference,
  reasonCodes,
}) {
  if (
    reactionFocus === "ZONE_DEFENSE" ||
    reactionFocus === "SUPPORT_DEFENSE"
  ) {
    return evaluateZoneDefenseLong({ facts, reasonCodes });
  }

  if (reactionFocus === "RECLAIM") {
    return evaluateReclaimLong({ facts, reasonCodes });
  }

  if (reactionFocus === "CONTROLLED_PULLBACK_OR_RECLAIM") {
    return evaluateControlledPullbackOrReclaimLong({ facts, reasonCodes });
  }

  if (reactionFocus === "HIGHER_LOW_HOLD") {
    return evaluateHigherLowHoldLong({ facts, reasonCodes });
  }

  if (reactionFocus === "EMA10_EMA20_RECLAIM") {
    return evaluateEmaReclaimLong({ facts, reasonCodes });
  }

  if (reactionFocus === "LOCAL_RANGE_BREAK") {
    return evaluateLocalRangeBreakLong({
      facts,
      reference,
      reasonCodes,
    });
  }

  return {
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    reasonCodes: [
      ...reasonCodes,
      "REACTION_FOCUS_NONE_OR_UNSUPPORTED",
    ],
  };
}

export function buildEngine22LifecycleReaction({
  currentLifecycleState,
  bars = [],
  currentPrice = null,
  reactionContext = null,
  debug = null,
} = {}) {
  const confirmation = currentLifecycleState?.confirmationContext || null;

  if (!confirmation) {
    return buildMissingContextResult({
      currentLifecycleState,
    });
  }

  const reference = confirmation?.reference || {};
  const reactionRequired = confirmation?.reactionRequired === true;

  const mode = safeUpper(confirmation.mode);
  const direction = safeUpper(
    confirmation.direction || currentLifecycleState?.direction,
    "NEUTRAL"
  );
  const reactionFocus = safeUpper(confirmation.reactionFocus);

  const facts = buildBarFacts({
    reference,
    bars,
    currentPrice,
    currentLifecycleState,
  });

  const baseReasonCodes = [
    "ENGINE3_READ_ENGINE22_CONFIRMATION_CONTEXT",
    reactionRequired ? "REACTION_REQUIRED" : "REACTION_NOT_REQUIRED",
    mode ? `MODE_${mode}` : null,
    direction ? `DIRECTION_${direction}` : null,
    reactionFocus ? `REACTION_FOCUS_${reactionFocus}` : null,
  ];

  if (!reactionRequired || confirmation.active === false) {
    return buildInactiveContextResult({
      currentLifecycleState,
      confirmation,
      reference,
      currentPrice: facts.price,
      mode,
      direction,
      reactionFocus,
      reasonCodes: baseReasonCodes,
    });
  }

  const unsupportedFocus =
    reactionFocus === "NONE" ||
    !SUPPORTED_REACTION_FOCUS.has(reactionFocus);

  if (unsupportedFocus) {
    return buildUnsupportedFocusResult({
      currentLifecycleState,
      confirmation,
      reference,
      currentPrice: facts.price,
      mode,
      direction,
      reactionFocus,
      reasonCodes: baseReasonCodes,
    });
  }

  // Current Engine 3 implementation is intentionally LONG-safe.
  // Do not allow a future SHORT lifecycle to get confirmed by bullish reclaim logic.
  // Engine 22 can later extend confirmationContext and Engine 3 can add a mirrored
  // short evaluator safely.
  if (direction === "SHORT") {
    return directionUnsupportedResult({
      currentLifecycleState,
      confirmation,
      reference,
      currentPrice: facts.price,
      mode,
      direction,
      reactionFocus,
      reasonCodes: baseReasonCodes,
      debug: debugPayload({
        facts,
        extraDebug: debug,
        reactionContext,
      }),
    });
  }

  if (direction !== "LONG") {
    return buildUnsupportedFocusResult({
      currentLifecycleState,
      confirmation,
      reference,
      currentPrice: facts.price,
      mode,
      direction,
      reactionFocus,
      reasonCodes: [
        ...baseReasonCodes,
        "ENGINE3_DIRECTION_NONE_OR_UNSUPPORTED",
      ],
    });
  }

  const evaluated = evaluateLongReaction({
    reactionFocus,
    facts,
    reference,
    reasonCodes: baseReasonCodes,
  });

  return buildBaseResult({
    currentLifecycleState,
    confirmation,
    reference,
    currentPrice: facts.price,
    active: true,
    mode,
    direction,
    reactionFocus,
    reactionState: evaluated.reactionState,
    reactionQuality: evaluated.reactionQuality,
    confirmed: evaluated.confirmed === true,
    reasonCodes: evaluated.reasonCodes,
    debug: debugPayload({
      facts,
      extraDebug: debug,
      reactionContext,
    }),
  });
}

export default buildEngine22LifecycleReaction;
