// services/core/logic/engine3/engine22LifecycleReaction.js

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
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

function getReferenceLevel(reference = {}) {
  return (
    toNum(reference.reclaimLevel) ??
    toNum(reference.triggerLevel) ??
    toNum(reference.level) ??
    toNum(reference.localRangeHigh) ??
    toNum(reference.priorHigh) ??
    toNum(reference.ema10) ??
    toNum(reference.ema20) ??
    toNum(pickPriceProgressReference(reference)?.price)
  );
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

function buildInactiveResult({ currentLifecycleState, reasonCodes = [] } = {}) {
  return {
    active: false,
    engine: "engine3.engine22LifecycleReaction.v1",
    source: "engine22WaveStrategy.currentLifecycleState.confirmationContext",
    lifecycleKey: currentLifecycleState?.key || null,
    mode: "NONE",
    direction: "NEUTRAL",
    reactionFocus: "NONE",
    reactionState: "NO_SIGNAL",
    reactionQuality: "WEAK",
    confirmed: false,
    currentPrice: null,
    reference: {},
    noPermissionCreated: true,
    noExecution: true,
    reasonCodes: [
      "ENGINE22_CONFIRMATION_CONTEXT_MISSING",
      "NO_EXECUTION",
      ...reasonCodes,
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
    return buildInactiveResult({
      currentLifecycleState,
      reasonCodes: ["CONFIRMATION_CONTEXT_NOT_PRESENT"],
    });
  }

  const reference = confirmation?.reference || {};
  const reactionRequired = confirmation?.reactionRequired === true;

  const last = normalizeBar(bars[bars.length - 1] || {});
  const prev = normalizeBar(bars[bars.length - 2] || {});

  const price =
    toNum(reference.currentPrice) ??
    toNum(currentPrice) ??
    last.close ??
    toNum(currentLifecycleState?.currentPrice) ??
    null;

  const mode = safeUpper(confirmation.mode);
  const direction = safeUpper(confirmation.direction || currentLifecycleState?.direction, "NEUTRAL");
  const reactionFocus = safeUpper(confirmation.reactionFocus);

  const reasonCodes = [
    "ENGINE3_READ_ENGINE22_CONFIRMATION_CONTEXT",
    reactionRequired ? "REACTION_REQUIRED" : "REACTION_NOT_REQUIRED",
    "NO_PERMISSION_CREATED",
    "NO_EXECUTION",
  ];

  const referenceLevel = getReferenceLevel(reference);
  const referenceZone = getReferenceZone(reference);
  const priceProgressReference = pickPriceProgressReference(reference);

  const touchedZone =
    referenceZone &&
    last.low != null &&
    last.high != null &&
    last.low <= referenceZone.hi &&
    last.high >= referenceZone.lo;

  const priceInsideZone =
    referenceZone &&
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
    referenceZone &&
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
    (ema10 != null && last.low != null && last.close != null && last.low <= ema10 && last.close >= ema10) ||
    (ema20 != null && last.low != null && last.close != null && last.low <= ema20 && last.close >= ema20);

  const emaReclaimed =
    (ema10 != null && prev.close != null && last.close != null && prev.close <= ema10 && last.close > ema10) ||
    (ema20 != null && prev.close != null && last.close != null && prev.close <= ema20 && last.close > ema20);

  let reactionState = "NO_SIGNAL";
  let reactionQuality = "WEAK";
  let confirmed = false;

  if (!reactionRequired) {
    reactionState = "NO_SIGNAL";
    reactionQuality = "WEAK";
    reasonCodes.push("REACTION_NOT_REQUIRED_BY_ENGINE22");
  } else if (
    reactionFocus === "ZONE_DEFENSE" ||
    reactionFocus === "SUPPORT_DEFENSE"
  ) {
    if (!referenceZone && referenceLevel == null) {
      reasonCodes.push("ENGINE3_REFERENCE_FIELD_MISSING");
    } else if (wickBelowAndReclaim) {
      reactionState = "CONFIRMED";
      reactionQuality = "STRONG";
      confirmed = true;
      reasonCodes.push("WICK_BELOW_AND_RECLAIM");
    } else if (zoneDefended || closeAboveReference) {
      reactionState = priorCandleHighReclaimed ? "CONFIRMED" : "GOOD";
      reactionQuality = priorCandleHighReclaimed ? "STRONG" : "GOOD";
      confirmed = priorCandleHighReclaimed;
      reasonCodes.push("ZONE_OR_LEVEL_DEFENDED");
    } else if (touchedZone || touchedLevel || priceInsideZone || nearLevel) {
      reactionState = "MIXED";
      reactionQuality = "MIXED";
      reasonCodes.push("ZONE_TOUCHED_WAITING_FOR_DEFENSE");
    } else if (closeBelowReference || priorCandleLowLost) {
      reactionState = "FAILED";
      reactionQuality = "WEAK";
      reasonCodes.push("SUPPORT_OR_LEVEL_LOST");
    }
  } else if (reactionFocus === "RECLAIM") {
    if (referenceLevel == null) {
      reasonCodes.push("ENGINE3_REFERENCE_FIELD_MISSING");
    } else if (closeAboveReference && priorCandleHighReclaimed) {
      reactionState = "CONFIRMED";
      reactionQuality = "STRONG";
      confirmed = true;
      reasonCodes.push("RECLAIM_CONFIRMED");
    } else if (closeAboveReference) {
      reactionState = "GOOD";
      reactionQuality = "GOOD";
      reasonCodes.push("RECLAIM_STARTED");
    } else if (failedReclaim) {
      reactionState = "FAILED";
      reactionQuality = "WEAK";
      reasonCodes.push("FAILED_RECLAIM");
    } else if (nearLevel || touchedLevel) {
      reactionState = "MIXED";
      reactionQuality = "MIXED";
      reasonCodes.push("NEAR_RECLAIM_LEVEL_WAITING");
    }
  } else if (reactionFocus === "CONTROLLED_PULLBACK_OR_RECLAIM") {
    const pullbackReferenceUsable =
      referenceZone || referenceLevel != null || priceProgressReference;

    if (!pullbackReferenceUsable) {
      reasonCodes.push("ENGINE3_REFERENCE_FIELD_MISSING");
    } else if (
      (closeAboveReference && priorCandleHighReclaimed) ||
      (emaReclaimed && priorCandleHighReclaimed)
    ) {
      reactionState = "CONFIRMED";
      reactionQuality = "STRONG";
      confirmed = true;
      reasonCodes.push("RECLAIM_CONFIRMED");
    } else if (wickBelowAndReclaim) {
      reactionState = "GOOD";
      reactionQuality = "GOOD";
      confirmed = priorCandleHighReclaimed;
      reasonCodes.push("PULLBACK_WICK_RECLAIM");
    } else if (
      zoneDefended ||
      emaHeld ||
      (priceProgressReference && nearLevel)
    ) {
      reactionState = priorCandleHighReclaimed ? "CONFIRMED" : "GOOD";
      reactionQuality = priorCandleHighReclaimed ? "STRONG" : "GOOD";
      confirmed = priorCandleHighReclaimed;
      reasonCodes.push("CONTROLLED_PULLBACK_HOLDING");
    } else if (failedReclaim) {
      reactionState = "FAILED";
      reactionQuality = "WEAK";
      reasonCodes.push("FAILED_RECLAIM");
    } else if (nearLevel || touchedLevel || touchedZone || priceInsideZone) {
      reactionState = "MIXED";
      reactionQuality = "MIXED";
      reasonCodes.push("PULLBACK_AREA_TOUCHED_WAITING");
    }
  } else if (reactionFocus === "HIGHER_LOW_HOLD") {
    if (prev.low == null || last.low == null) {
      reasonCodes.push("ENGINE3_REFERENCE_FIELD_MISSING");
    } else if (last.low > prev.low && last.close != null && prev.close != null && last.close >= prev.close) {
      reactionState = priorCandleHighReclaimed ? "CONFIRMED" : "GOOD";
      reactionQuality = priorCandleHighReclaimed ? "STRONG" : "GOOD";
      confirmed = priorCandleHighReclaimed;
      reasonCodes.push("HIGHER_LOW_HELD");
    } else if (priorCandleLowLost) {
      reactionState = "FAILED";
      reactionQuality = "WEAK";
      reasonCodes.push("PRIOR_CANDLE_LOW_LOST");
    } else {
      reactionState = "MIXED";
      reactionQuality = "MIXED";
      reasonCodes.push("HIGHER_LOW_NOT_CONFIRMED_YET");
    }
  } else if (reactionFocus === "EMA10_EMA20_RECLAIM") {
    if (ema10 == null && ema20 == null) {
      reasonCodes.push("ENGINE3_REFERENCE_FIELD_MISSING");
    } else if (emaReclaimed && priorCandleHighReclaimed) {
      reactionState = "CONFIRMED";
      reactionQuality = "STRONG";
      confirmed = true;
      reasonCodes.push("EMA_RECLAIM_CONFIRMED");
    } else if (emaHeld || emaReclaimed) {
      reactionState = "GOOD";
      reactionQuality = "GOOD";
      reasonCodes.push("EMA_CONTEXT_HOLDING");
    } else {
      reactionState = "MIXED";
      reactionQuality = "MIXED";
      reasonCodes.push("EMA_RECLAIM_WAITING");
    }
  } else if (reactionFocus === "LOCAL_RANGE_BREAK") {
    const localRangeHigh = toNum(reference.localRangeHigh);
    const localRangeLow = toNum(reference.localRangeLow);

    if (direction === "LONG") {
      if (localRangeHigh == null) {
        reasonCodes.push("ENGINE3_REFERENCE_FIELD_MISSING");
      } else if (last.close != null && last.close > localRangeHigh && priorCandleHighReclaimed) {
        reactionState = "CONFIRMED";
        reactionQuality = "STRONG";
        confirmed = true;
        reasonCodes.push("LOCAL_RANGE_HIGH_BROKEN");
      } else if (last.close != null && last.close > localRangeHigh) {
        reactionState = "GOOD";
        reactionQuality = "GOOD";
        reasonCodes.push("LOCAL_RANGE_BREAK_STARTED");
      } else {
        reactionState = "MIXED";
        reactionQuality = "MIXED";
        reasonCodes.push("LOCAL_RANGE_BREAK_WAITING");
      }
    } else {
      if (localRangeLow == null) {
        reasonCodes.push("ENGINE3_REFERENCE_FIELD_MISSING");
      } else if (last.close != null && last.close < localRangeLow && priorCandleLowLost) {
        reactionState = "CONFIRMED";
        reactionQuality = "STRONG";
        confirmed = true;
        reasonCodes.push("LOCAL_RANGE_LOW_BROKEN");
      } else if (last.close != null && last.close < localRangeLow) {
        reactionState = "GOOD";
        reactionQuality = "GOOD";
        reasonCodes.push("LOCAL_RANGE_BREAKDOWN_STARTED");
      } else {
        reactionState = "MIXED";
        reactionQuality = "MIXED";
        reasonCodes.push("LOCAL_RANGE_BREAK_WAITING");
      }
    }
  } else {
    reasonCodes.push("REACTION_FOCUS_NONE_OR_UNSUPPORTED");
  }

  return {
    active: reactionRequired,
    engine: "engine3.engine22LifecycleReaction.v1",
    source: "engine22WaveStrategy.currentLifecycleState.confirmationContext",

    lifecycleKey: currentLifecycleState?.key || null,
    mode,
    direction,

    reactionFocus,
    reactionState,
    reactionQuality,
    confirmed,

    currentPrice: price,
    reference,

    noPermissionCreated: true,
    noExecution: true,

    debug: {
      referenceLevel,
      referenceZone,
      priceProgressReference,
      priorCandleHighReclaimed,
      priorCandleLowLost,
      closeAboveReference,
      closeBelowReference,
      touchedZone,
      touchedLevel,
      priceInsideZone,
      nearLevel,
      zoneDefended,
      wickBelowAndReclaim,
      failedReclaim,
      emaHeld,
      emaReclaimed,
      lastCandle: last,
      priorCandle: prev,
      extra: debug,
      reactionContext,
    },

    reasonCodes: [...new Set(reasonCodes)],
  };
}
