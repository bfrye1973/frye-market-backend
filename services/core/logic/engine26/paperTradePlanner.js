// services/core/logic/engine26/paperTradePlanner.js

import { deriveEngine22StructuralPlaybook } from "./deriveEngine22StructuralPlaybook.js";

const ENGINE = "engine26.paperTradePlanner.v1";
const MODE = "PAPER_ONLY";
const STRATEGY_ID = "intraday_scalp@10m";
const SYMBOL = "ES";
const TICK_SIZE_ES = 0.25;

function nowIso() {
  return new Date().toISOString();
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTick(value, tick = TICK_SIZE_ES) {
  const n = toNum(value);
  if (n == null) return null;
  return Number((Math.round(n / tick) * tick).toFixed(2));
}

function roundPts(value) {
  const n = toNum(value);
  if (n == null) return null;
  return Number(n.toFixed(2));
}

function safeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function safeString(value) {
  return String(value || "").trim();
}

function barOpen(bar) {
  return toNum(bar?.open ?? bar?.o);
}

function barHigh(bar) {
  return toNum(bar?.high ?? bar?.h);
}

function barLow(bar) {
  return toNum(bar?.low ?? bar?.l);
}

function barClose(bar) {
  return toNum(bar?.close ?? bar?.c);
}

function barTime(bar) {
  return bar?.time ?? bar?.t ?? bar?.tSec ?? null;
}

function closeLocationPct({ high, low, close }) {
  const h = toNum(high);
  const l = toNum(low);
  const c = toNum(close);

  if (h == null || l == null || c == null || h === l) return null;

  return Number((((c - l) / (h - l)) * 100).toFixed(2));
}

function candleColor(bar) {
  const o = barOpen(bar);
  const c = barClose(bar);

  if (o == null || c == null) return "UNKNOWN";
  if (c > o) return "GREEN";
  if (c < o) return "RED";
  return "DOJI";
}

function bodyLo(bar) {
  const o = barOpen(bar);
  const c = barClose(bar);

  if (o == null || c == null) return null;
  return Math.min(o, c);
}

function bodyHi(bar) {
  const o = barOpen(bar);
  const c = barClose(bar);

  if (o == null || c == null) return null;
  return Math.max(o, c);
}

function buildEngine26DailyCandleContext({
  symbol,
  strategyId,
  dailyBars = [],
  engine26StructuralContext = null,
} = {}) {
  const bars = Array.isArray(dailyBars) ? dailyBars.filter(Boolean) : [];

  // Important:
  // During the live session, bars[bars.length - 1] is usually the forming daily candle.
  // For next-day bias we must use completed candles only:
  // priorCompleted = bars[bars.length - 3]
  // lastCompleted  = bars[bars.length - 2]
  // formingDaily   = bars[bars.length - 1]
  if (bars.length < 3) {
    return {
      active: false,
      engine: "engine26.dailyCandleContext.v1",
      source: "marketMeter.layers.emaPosture.daily.bars",
      symbol: safeUpper(symbol || "ES"),
      strategyId: strategyId || STRATEGY_ID,
      timeframe: "1D",
      pattern: "DAILY_CONTEXT_UNAVAILABLE",
      completedPattern: "DAILY_CONTEXT_UNAVAILABLE",
      biasForNextSession: "UNKNOWN",
      supportsEngine26Direction: false,
      message:
        "Daily candle context unavailable because fewer than three daily bars were provided. Need prior completed, last completed, and forming daily candle.",
      noExecution: true,
      noPermissionCreated: true,
      reasonCodes: [
        "ENGINE26_DAILY_CANDLE_CONTEXT_UNAVAILABLE",
        "MISSING_THREE_DAILY_BARS",
        "NO_EXECUTION",
        "NO_PERMISSION_CREATED",
      ],
    };
  }

  const prior = bars[bars.length - 3];
  const last = bars[bars.length - 2];
  const forming = bars[bars.length - 1];

  const priorOpen = barOpen(prior);
  const priorHigh = barHigh(prior);
  const priorLow = barLow(prior);
  const priorClose = barClose(prior);

  const lastOpen = barOpen(last);
  const lastHigh = barHigh(last);
  const lastLow = barLow(last);
  const lastClose = barClose(last);

  const formingOpen = barOpen(forming);
  const formingHigh = barHigh(forming);
  const formingLow = barLow(forming);
  const formingClose = barClose(forming);

  const priorColor = candleColor(prior);
  const lastColor = candleColor(last);
  const formingColor = candleColor(forming);

  const priorBodyLo = bodyLo(prior);
  const priorBodyHi = bodyHi(prior);
  const lastBodyLo = bodyLo(last);
  const lastBodyHi = bodyHi(last);

  const lastCloseLocationPct = closeLocationPct({
    high: lastHigh,
    low: lastLow,
    close: lastClose,
  });

  const formingCloseLocationPct = closeLocationPct({
    high: formingHigh,
    low: formingLow,
    close: formingClose,
  });

  const bearishEngulfing =
    priorColor === "GREEN" &&
    lastColor === "RED" &&
    lastBodyHi != null &&
    lastBodyLo != null &&
    priorBodyHi != null &&
    priorBodyLo != null &&
    lastBodyHi >= priorBodyHi &&
    lastBodyLo <= priorBodyLo;

  const bullishEngulfing =
    priorColor === "RED" &&
    lastColor === "GREEN" &&
    lastBodyHi != null &&
    lastBodyLo != null &&
    priorBodyHi != null &&
    priorBodyLo != null &&
    lastBodyHi >= priorBodyHi &&
    lastBodyLo <= priorBodyLo;

  const outsideDay =
    lastHigh != null &&
    lastLow != null &&
    priorHigh != null &&
    priorLow != null &&
    lastHigh > priorHigh &&
    lastLow < priorLow;

  const insideDay =
    lastHigh != null &&
    lastLow != null &&
    priorHigh != null &&
    priorLow != null &&
    lastHigh <= priorHigh &&
    lastLow >= priorLow;

  const weakCloseNearLow =
    lastColor === "RED" &&
    lastCloseLocationPct != null &&
    lastCloseLocationPct <= 35;

  const strongCloseNearHigh =
    lastColor === "GREEN" &&
    lastCloseLocationPct != null &&
    lastCloseLocationPct >= 65;

  const formingStrongBounce =
    formingColor === "GREEN" &&
    formingCloseLocationPct != null &&
    formingCloseLocationPct >= 65;

  const formingWeakReject =
    formingColor === "RED" &&
    formingCloseLocationPct != null &&
    formingCloseLocationPct <= 35;

  const structuralDirection = safeUpper(
    engine26StructuralContext?.preferredDirection ||
      engine26StructuralContext?.direction ||
      ""
  );

  const structuralStatus = safeUpper(engine26StructuralContext?.status || "");
  const structuralBias = safeUpper(engine26StructuralContext?.structuralBias || "");

  const engine26ShortWatch =
    structuralDirection.includes("SHORT") ||
    structuralStatus.includes("C_DOWN") ||
    structuralBias.includes("C_DOWN") ||
    engine26StructuralContext?.shortResearchOnly === true;

  const engine26LongWatch =
    structuralDirection.includes("LONG") ||
    structuralBias.includes("LONG");

  let pattern = "DAILY_NEUTRAL";
  let biasForNextSession = "NEUTRAL_WAIT";
  let confidence = "LOW";
  let message =
    "Completed daily candle is neutral. Use intraday Engine 3 / Engine 4 confirmation.";

  const reasonCodes = [
    "ENGINE26_DAILY_CANDLE_CONTEXT_BUILT",
    "COMPLETED_DAILY_CANDLES_USED_FOR_NEXT_SESSION_BIAS",
    "FORMING_DAILY_CANDLE_CONTEXT_ONLY",
    "DAILY_CONTEXT_ONLY",
    "NO_EXECUTION",
    "NO_PERMISSION_CREATED",
  ];

  if (bearishEngulfing) {
    pattern = "BEARISH_ENGULFING_REJECTION";
    biasForNextSession = "SHORT_WATCH";
    confidence = outsideDay ? "HIGH" : "MODERATE";
    message =
      "Last completed daily candle was a bearish engulfing rejection. Next session favors short-watch on failed acceptance or level loss.";
    reasonCodes.push("DAILY_BEARISH_ENGULFING_REJECTION");
  } else if (bullishEngulfing) {
    pattern = "BULLISH_ENGULFING_RECLAIM";
    biasForNextSession = "LONG_WATCH";
    confidence = outsideDay ? "HIGH" : "MODERATE";
    message =
      "Last completed daily candle was a bullish engulfing reclaim. Next session favors long-watch on reclaim / hold.";
    reasonCodes.push("DAILY_BULLISH_ENGULFING_RECLAIM");
  } else if (weakCloseNearLow) {
    pattern = "DAILY_WEAK_CLOSE_NEAR_LOW";
    biasForNextSession = "SHORT_WATCH";
    confidence = "MODERATE";
    message =
      "Last completed daily candle closed weak near the low. Next session should respect downside risk.";
    reasonCodes.push("DAILY_WEAK_CLOSE_NEAR_LOW");
  } else if (strongCloseNearHigh) {
    pattern = "DAILY_STRONG_CLOSE_NEAR_HIGH";
    biasForNextSession = "LONG_WATCH";
    confidence = "MODERATE";
    message =
      "Last completed daily candle closed strong near the high. Next session should respect upside continuation risk.";
    reasonCodes.push("DAILY_STRONG_CLOSE_NEAR_HIGH");
  } else if (insideDay) {
    pattern = "DAILY_INSIDE_DAY";
    biasForNextSession = "BREAKOUT_OR_FAILED_BREAKOUT_WATCH";
    confidence = "LOW";
    message =
      "Last completed daily candle was an inside day. Next session should watch range break or failed breakout.";
    reasonCodes.push("DAILY_INSIDE_DAY");
  } else if (outsideDay) {
    pattern = "DAILY_OUTSIDE_DAY";
    biasForNextSession = "REVERSAL_OR_CONTINUATION_WATCH";
    confidence = "MODERATE";
    message =
      "Last completed daily candle was an outside day. Next session needs confirmation before direction is trusted.";
    reasonCodes.push("DAILY_OUTSIDE_DAY");
  }

  const supportsEngine26Direction =
    (biasForNextSession === "SHORT_WATCH" && engine26ShortWatch) ||
    (biasForNextSession === "LONG_WATCH" && engine26LongWatch);

  if (supportsEngine26Direction) {
    reasonCodes.push("DAILY_CONTEXT_SUPPORTS_ENGINE26_DIRECTION");

    if (biasForNextSession === "SHORT_WATCH") {
      reasonCodes.push("DAILY_CONTEXT_SUPPORTS_SHORT_WATCH");
    }

    if (biasForNextSession === "LONG_WATCH") {
      reasonCodes.push("DAILY_CONTEXT_SUPPORTS_LONG_WATCH");
    }
  }

  if (formingStrongBounce) {
    reasonCodes.push("FORMING_DAILY_GREEN_BOUNCE_CONTEXT_ONLY");
  }

  if (formingWeakReject) {
    reasonCodes.push("FORMING_DAILY_WEAK_REJECTION_CONTEXT_ONLY");
  }

  return {
    active: true,
    engine: "engine26.dailyCandleContext.v1",
    source: "marketMeter.layers.emaPosture.daily.bars",

    symbol: safeUpper(symbol || "ES"),
    strategyId: strategyId || STRATEGY_ID,
    timeframe: "1D",

    // Backward-compatible main fields now represent completed daily candles only.
    pattern,
    completedPattern: pattern,
    biasForNextSession,
    confidence,
    supportsEngine26Direction,

    priorCompletedCandle: {
      time: barTime(prior),
      open: priorOpen,
      high: priorHigh,
      low: priorLow,
      close: priorClose,
      color: priorColor,
    },

    lastCompletedCandle: {
      time: barTime(last),
      open: lastOpen,
      high: lastHigh,
      low: lastLow,
      close: lastClose,
      color: lastColor,
      closeLocationPct: lastCloseLocationPct,
    },

    // Keep these old field names for compatibility.
    priorCandle: {
      time: barTime(prior),
      open: priorOpen,
      high: priorHigh,
      low: priorLow,
      close: priorClose,
      color: priorColor,
    },

    lastCandle: {
      time: barTime(last),
      open: lastOpen,
      high: lastHigh,
      low: lastLow,
      close: lastClose,
      color: lastColor,
      closeLocationPct: lastCloseLocationPct,
      completed: true,
    },

    formingDailyCandle: {
      time: barTime(forming),
      open: formingOpen,
      high: formingHigh,
      low: formingLow,
      close: formingClose,
      color: formingColor,
      closeLocationPct: formingCloseLocationPct,
      completed: false,
      contextOnly: true,
    },

    formingDailyContext: {
      color: formingColor,
      strongBounce: formingStrongBounce,
      weakReject: formingWeakReject,
      closeLocationPct: formingCloseLocationPct,
      note:
        "Forming daily candle is context only and does not override completed daily next-session bias.",
    },

    engulfing: {
      bearish: bearishEngulfing,
      bullish: bullishEngulfing,
    },

    insideDay,
    outsideDay,
    weakCloseNearLow,
    strongCloseNearHigh,

    engine26Alignment: {
      structuralDirection,
      structuralStatus,
      structuralBias,
      engine26ShortWatch,
      engine26LongWatch,
    },

    message,

    noExecution: true,
    noPermissionCreated: true,
    reasonCodes,
  };
}

function getReactionCandlesForLocation(confluence) {
  const reactionContext = confluence?.context?.reaction || null;

  const fastReaction = reactionContext?.engine3FastImbalanceReaction || null;
  const paperReaction = reactionContext?.paperScalpReaction || null;
  const currentLevelAction = reactionContext?.currentLevelAction || null;

  const source =
    fastReaction?.active === true
      ? fastReaction
      : paperReaction?.active === true
      ? paperReaction
      : currentLevelAction?.active === true
      ? currentLevelAction
      : null;

  return {
    sourceName:
      fastReaction?.active === true
        ? "engine3FastImbalanceReaction"
        : paperReaction?.active === true
        ? "paperScalpReaction"
        : currentLevelAction?.active === true
        ? "currentLevelAction"
        : "NONE",

    lastCandle:
      source?.lastCandle ||
      source?.currentLevelAction?.lastCandle ||
      currentLevelAction?.lastCandle ||
      null,

    priorCandle:
      source?.priorCandle ||
      source?.currentLevelAction?.priorCandle ||
      currentLevelAction?.priorCandle ||
      null,

    reactionState:
      source?.state ||
      currentLevelAction?.state ||
      null,

    reactionQuality:
      source?.quality ||
      currentLevelAction?.quality ||
      null,

    reactionDirection:
      source?.direction ||
      currentLevelAction?.direction ||
      null,
  };
}

function classifyPriceVsZone({ currentPrice, zoneLo, zoneHi, nearBufferPts = 2 }) {
  const price = toNum(currentPrice);
  const lo = toNum(zoneLo);
  const hi = toNum(zoneHi);

  if (price == null || lo == null || hi == null) {
    return {
      priceLocation: "UNKNOWN",
      distanceToZonePts: null,
      insideZone: false,
      aboveZone: false,
      belowZone: false,
      nearZone: false,
    };
  }

  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);

  if (price >= low && price <= high) {
    return {
      priceLocation: "INSIDE_ZONE",
      distanceToZonePts: 0,
      insideZone: true,
      aboveZone: false,
      belowZone: false,
      nearZone: true,
    };
  }

  if (price > high) {
    const distanceToZonePts = roundPts(price - high);

    return {
      priceLocation:
        distanceToZonePts <= nearBufferPts ? "NEAR_ABOVE_ZONE" : "ABOVE_ZONE",
      distanceToZonePts,
      insideZone: false,
      aboveZone: true,
      belowZone: false,
      nearZone: distanceToZonePts <= nearBufferPts,
    };
  }

  const distanceToZonePts = roundPts(low - price);

  return {
    priceLocation:
      distanceToZonePts <= nearBufferPts ? "NEAR_BELOW_ZONE" : "BELOW_ZONE",
    distanceToZonePts,
    insideZone: false,
    aboveZone: false,
    belowZone: true,
    nearZone: distanceToZonePts <= nearBufferPts,
  };
}

function buildEngine26LocationContext({
  symbol,
  strategyId,
  tf,
  engine26ImbalanceWatch,
  engine26StructuralContext,
  confluence,
}) {
  const activeImbalance = engine26ImbalanceWatch?.activeImbalance || null;

  const currentPrice =
    roundToTick(
      engine26ImbalanceWatch?.currentPrice ??
        confluence?.price ??
        confluence?.currentPrice
    ) ?? null;

  const zoneLo = roundToTick(activeImbalance?.lo);
  const zoneHi = roundToTick(activeImbalance?.hi);
  const zoneMid =
    roundToTick(activeImbalance?.mid) ??
    (zoneLo != null && zoneHi != null
      ? roundToTick((zoneLo + zoneHi) / 2)
      : null);

  const zoneRole =
    engine26StructuralContext?.activeImbalanceRole ||
    engine26ImbalanceWatch?.activeImbalanceRole ||
    null;

  const setupBias =
    engine26StructuralContext?.preferredDirection ||
    engine26ImbalanceWatch?.preferredDirection ||
    "NONE";

  const preferredAction =
    engine26StructuralContext?.preferredAction ||
    engine26ImbalanceWatch?.preferredAction ||
    null;

  const structuralStatus =
    engine26StructuralContext?.status ||
    engine26ImbalanceWatch?.status ||
    null;

  const structuralBias =
    engine26StructuralContext?.structuralBias ||
    engine26ImbalanceWatch?.structuralBias ||
    null;

  const isShortWatch =
    safeUpper(setupBias).includes("SHORT") ||
    safeUpper(structuralStatus).includes("C_DOWN") ||
    safeUpper(structuralBias).includes("C_DOWN") ||
    engine26StructuralContext?.shortResearchOnly === true;

  const isLongWatch =
    safeUpper(setupBias).includes("LONG") ||
    safeUpper(structuralBias).includes("LONG");

  const zoneClassification = classifyPriceVsZone({
    currentPrice,
    zoneLo,
    zoneHi,
    nearBufferPts: 2,
  });

  const { lastCandle, priorCandle, sourceName, reactionState, reactionQuality, reactionDirection } =
    getReactionCandlesForLocation(confluence);

  const lastClose = roundToTick(barClose(lastCandle));
  const priorClose = roundToTick(barClose(priorCandle));

  const priorZone = classifyPriceVsZone({
    currentPrice: priorClose,
    zoneLo,
    zoneHi,
    nearBufferPts: 2,
  });

  const lastZone = classifyPriceVsZone({
    currentPrice: lastClose,
    zoneLo,
    zoneHi,
    nearBufferPts: 2,
  });

  const pulledBackIntoZoneFromBelow =
    priorZone.belowZone === true && lastZone.insideZone === true;

  const pulledBackIntoZoneFromAbove =
    priorZone.aboveZone === true && lastZone.insideZone === true;

  const failedBelowZone =
    priorZone.insideZone === true && lastZone.belowZone === true;

  const reclaimedAboveZone =
    priorZone.insideZone === true && lastZone.aboveZone === true;

  let locationRead = "NO_ACTIVE_ENGINE26_ZONE";
  let tacticalMeaning = "No active Engine 26 location context.";
  let desiredTrigger = preferredAction || "WAIT_FOR_CONFIRMATION";
  let shortTriggerLevel = zoneLo;
  let longReclaimLevel = zoneHi;
  let invalidationLevel = null;

  const reasonCodes = [
    "ENGINE26_LOCATION_CONTEXT_BUILT",
    "LOCATION_CONTEXT_ONLY",
    "NO_EXECUTION",
    "NO_PERMISSION_CREATED",
  ];

  if (activeImbalance && currentPrice != null) {
    if (isShortWatch && zoneClassification.insideZone) {
      locationRead = pulledBackIntoZoneFromBelow
        ? "PULLBACK_BACK_INTO_SHORT_WATCH_ZONE"
        : pulledBackIntoZoneFromAbove
        ? "REJECTED_DOWN_BACK_INTO_SHORT_WATCH_ZONE"
        : "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST";

      tacticalMeaning =
        "Price is inside the Engine 26 short-watch zone. This is an acceptance test, not long permission.";

      desiredTrigger = "FAILED_ACCEPTANCE_OR_LEVEL_LOSS";
      shortTriggerLevel = zoneLo;
      invalidationLevel = zoneHi;

      reasonCodes.push("PRICE_INSIDE_ENGINE26_SHORT_WATCH_ZONE");
      reasonCodes.push("ACCEPTANCE_TEST_NOT_LONG_PERMISSION");

      if (pulledBackIntoZoneFromBelow) {
        reasonCodes.push("PULLBACK_BACK_INTO_SHORT_WATCH_ZONE");
      }
    } else if (isShortWatch && zoneClassification.belowZone) {
      locationRead = failedBelowZone
        ? "FAILED_ACCEPTANCE_BELOW_SHORT_WATCH_ZONE"
        : "BELOW_SHORT_WATCH_ZONE_CONTINUATION_AREA";

      tacticalMeaning =
        "Price is below the Engine 26 short-watch zone. Watch whether sellers maintain control or price reclaims.";

      desiredTrigger = "SELLERS_HOLD_BELOW_ZONE_OR_FAILED_RECLAIM";
      shortTriggerLevel = zoneLo;
      invalidationLevel = zoneHi;

      reasonCodes.push("PRICE_BELOW_ENGINE26_SHORT_WATCH_ZONE");

      if (failedBelowZone) {
        reasonCodes.push("FAILED_ACCEPTANCE_BELOW_ZONE");
      }
    } else if (isShortWatch && zoneClassification.aboveZone) {
      locationRead = reclaimedAboveZone
        ? "SHORT_WATCH_RECLAIM_INVALIDATION_RISK"
        : "ABOVE_SHORT_WATCH_ZONE";

      tacticalMeaning =
        "Price is above the Engine 26 short-watch zone. Short watch weakens unless price fails back into the zone.";

      desiredTrigger = "WAIT_FOR_REJECTION_BACK_INTO_ZONE";
      shortTriggerLevel = zoneLo;
      invalidationLevel = zoneHi;

      reasonCodes.push("PRICE_ABOVE_ENGINE26_SHORT_WATCH_ZONE");
      reasonCodes.push("SHORT_WATCH_INVALIDATION_RISK");
    } else if (isLongWatch && zoneClassification.insideZone) {
      locationRead = "INSIDE_LONG_WATCH_ZONE_ACCEPTANCE_TEST";
      tacticalMeaning =
        "Price is inside the Engine 26 long-watch zone. Watch for reclaim / hold with participation.";

      desiredTrigger = "RECLAIM_OR_HOLD_ABOVE_ZONE";
      longReclaimLevel = zoneHi;
      invalidationLevel = zoneLo;

      reasonCodes.push("PRICE_INSIDE_ENGINE26_LONG_WATCH_ZONE");
    } else {
      locationRead = `${zoneClassification.priceLocation}_ENGINE26_ZONE`;
      tacticalMeaning =
        "Price is near an Engine 26 zone. Use Engine 3 / Engine 4 confirmation before any paper review.";

      reasonCodes.push(zoneClassification.priceLocation);
    }
  }

  return {
    active: activeImbalance != null && currentPrice != null,
    engine: "engine26.locationContext.v1",
    source: "engine26.activeImbalance.currentPrice",

    symbol: safeUpper(symbol || "ES"),
    strategyId: strategyId || STRATEGY_ID,
    tf: tf || "10m",

    currentPrice,

    zone: {
      id: activeImbalance?.id || null,
      source: activeImbalance?.source || null,
      zoneType: activeImbalance?.zoneType || null,
      side: activeImbalance?.side || null,
      lo: zoneLo,
      hi: zoneHi,
      mid: zoneMid,
      inside: zoneClassification.insideZone,
      near: zoneClassification.nearZone,
      above: zoneClassification.aboveZone,
      below: zoneClassification.belowZone,
      distancePts: zoneClassification.distanceToZonePts,
    },

    priceLocation: zoneClassification.priceLocation,
    locationRead,
    tacticalMeaning,

    zoneRole,
    setupBias,
    structuralStatus,
    structuralBias,
    preferredAction,

    isShortWatch,
    isLongWatch,

    desiredTrigger,
    shortTriggerLevel,
    longReclaimLevel,
    invalidationLevel,

    recentBehavior: {
      source: sourceName,
      reactionState,
      reactionQuality,
      reactionDirection,

      priorClose,
      lastClose,

      priorPriceLocation: priorZone.priceLocation,
      lastPriceLocation: lastZone.priceLocation,

      pulledBackIntoZoneFromBelow,
      pulledBackIntoZoneFromAbove,
      failedBelowZone,
      reclaimedAboveZone,
    },

    handoff: {
      engine3ShouldTreatInsideShortZoneAs:
        isShortWatch && zoneClassification.insideZone
          ? "ACCEPTANCE_TEST_NOT_LONG_PERMISSION"
          : null,

      engine4ShouldTreatInsideShortZoneAs:
        isShortWatch && zoneClassification.insideZone
          ? "WAIT_FOR_DIRECTIONAL_PARTICIPATION"
          : null,

      engine6FinalPermissionRequired: true,
    },

    noExecution: true,
    noPermissionCreated: true,

    reasonCodes,
  };
}

function classifyControlLevelState({
  currentPrice,
  bearControlLevel,
  bullRecoveryLevel,
  nearBufferPts = 2,
}) {
  const price = toNum(currentPrice);
  const bear = toNum(bearControlLevel);
  const bull = toNum(bullRecoveryLevel);

  if (price == null || bear == null || bull == null) {
    return {
      currentControlState: "CONTROL_LEVEL_STATE_UNKNOWN",
      betweenLevels: false,
      belowBearControl: false,
      aboveBullRecovery: false,
      nearBearControl: false,
      nearBullRecovery: false,
      distanceToBearControl: null,
      distanceToBullRecovery: null,
    };
  }

  const distanceToBearControl = roundPts(price - bear);
  const distanceToBullRecovery = roundPts(price - bull);

  const nearBearControl = Math.abs(price - bear) <= nearBufferPts;
  const nearBullRecovery = Math.abs(price - bull) <= nearBufferPts;

  const belowBearControl = price < bear;
  const aboveBullRecovery = price > bull;
  const betweenLevels = price >= bear && price <= bull;

  let currentControlState = "BETWEEN_CONTROL_LEVELS_DECISION_ZONE";

  if (belowBearControl) {
    currentControlState = nearBearControl
      ? "TESTING_BEAR_CONTROL_LEVEL_FROM_BELOW"
      : "BELOW_BEAR_CONTROL_LEVEL";
  } else if (aboveBullRecovery) {
    currentControlState = nearBullRecovery
      ? "TESTING_BULL_RECOVERY_LEVEL_FROM_ABOVE"
      : "ABOVE_BULL_RECOVERY_LEVEL";
  } else if (nearBearControl) {
    currentControlState = "TESTING_BEAR_CONTROL_LEVEL_FROM_ABOVE";
  } else if (nearBullRecovery) {
    currentControlState = "TESTING_BULL_RECOVERY_LEVEL_FROM_BELOW";
  }

  return {
    currentControlState,
    betweenLevels,
    belowBearControl,
    aboveBullRecovery,
    nearBearControl,
    nearBullRecovery,
    distanceToBearControl,
    distanceToBullRecovery,
  };
}

function buildEngine26ControlLevelContext({
  symbol,
  strategyId,
  tf,
  engine26StructuralContext,
  locationContext,
  confluence,
}) {
  const currentPrice =
    roundToTick(
      locationContext?.currentPrice ??
        confluence?.context?.reaction?.engine3FastImbalanceReaction?.currentPrice ??
        confluence?.context?.reaction?.paperScalpReaction?.currentPrice ??
        confluence?.context?.reaction?.currentLevelAction?.currentPrice ??
        confluence?.price ??
        confluence?.currentPrice
    ) ?? null;

  // V1 tactical controls. Long-term these can be fed from manual levels,
  // Engine 22, Engine 25, or env/config.
  const bearControlLevel =
    roundToTick(process.env.ENGINE26_ES_BEAR_CONTROL_LEVEL) ?? 7500;

  const bullRecoveryLevel =
    roundToTick(process.env.ENGINE26_ES_BULL_RECOVERY_LEVEL) ?? 7560;

  const nextDownTargets = [
    7476,
    7459.5,
    7432,
  ];

  const nextUpTargets = [
    7575,
    7591.5,
    7605,
  ];

  const control = classifyControlLevelState({
    currentPrice,
    bearControlLevel,
    bullRecoveryLevel,
    nearBufferPts: 2,
  });

  const locationRead = safeUpper(locationContext?.locationRead || "");
  const recentReactionState = safeUpper(
    locationContext?.recentBehavior?.reactionState ||
      confluence?.context?.reaction?.engine3FastImbalanceReaction?.state ||
      confluence?.context?.reaction?.paperScalpReaction?.state ||
      confluence?.context?.reaction?.currentLevelAction?.state ||
      ""
  );

  const recentReactionDirection = safeUpper(
    locationContext?.recentBehavior?.reactionDirection ||
      confluence?.context?.reaction?.engine3FastImbalanceReaction?.direction ||
      confluence?.context?.reaction?.paperScalpReaction?.direction ||
      confluence?.context?.reaction?.currentLevelAction?.direction ||
      ""
  );

  const bearishReaction =
    recentReactionDirection === "SHORT" &&
    (
      recentReactionState.includes("BREAKOUT_FAILING") ||
      recentReactionState.includes("FAILED_RECLAIM") ||
      recentReactionState.includes("LOST") ||
      recentReactionState.includes("REJECTING")
    );

  const bullishReaction =
    recentReactionDirection === "LONG" &&
    (
      recentReactionState.includes("HELD") ||
      recentReactionState.includes("RECLAIM") ||
      recentReactionState.includes("ACCEPTING")
    );

  const bearControlRejecting =
    (control.belowBearControl || control.nearBearControl) &&
    bearishReaction === true;

  const bullRecoveryHolding =
    (control.aboveBullRecovery || control.nearBullRecovery) &&
    bullishReaction === true;

  let currentInstruction =
    "WAIT_FOR_7500_REJECTION_OR_7560_RECLAIM_HOLD";

  if (bearControlRejecting) {
    currentInstruction =
      "7500_REJECTING_BEAR_CONTROL_ACTIVE_WATCH_LOWER_TARGETS";
  } else if (bullRecoveryHolding) {
    currentInstruction =
      "7560_RECLAIM_HOLD_SHORT_WATCH_WEAKENING";
  } else if (control.betweenLevels) {
    currentInstruction =
      "BETWEEN_7500_AND_7560_DECISION_ZONE_NO_CLEAN_PERMISSION";
  } else if (control.belowBearControl) {
    currentInstruction =
      "BELOW_7500_WATCH_FAILED_RECLAIM_OR_SELLER_CONTROL";
  } else if (control.aboveBullRecovery) {
    currentInstruction =
      "ABOVE_7560_WATCH_HOLD_OR_FAILED_RECLAIM";
  }

  const reasonCodes = [
    "ENGINE26_CONTROL_LEVEL_CONTEXT_BUILT",
    "CONTROL_LEVEL_MAP_ONLY",
    "BEAR_CONTROL_LEVEL_7500",
    "BULL_RECOVERY_LEVEL_7560",
    control.currentControlState,
    currentInstruction,
    bearControlRejecting ? "BEAR_CONTROL_REJECTING" : null,
    bullRecoveryHolding ? "BULL_RECOVERY_HOLDING" : null,
    locationRead ? `LOCATION_${locationRead}` : null,
    "NO_EXECUTION",
    "NO_PERMISSION_CREATED",
  ].filter(Boolean);

  return {
    active: currentPrice != null,
    engine: "engine26.controlLevelContext.v1",
    mode: "CONTROL_LEVEL_MAP",

    symbol: safeUpper(symbol || "ES"),
    strategyId: strategyId || STRATEGY_ID,
    tf: tf || "10m",

    currentPrice,

    bearControlLevel,
    bullRecoveryLevel,

    ...control,

    bearControlRejecting,
    bullRecoveryHolding,

    bearishPath: {
      active: true,
      condition: "PRICE_BELOW_7500_AND_FAILED_RECLAIM",
      meaning: "7500 acting as resistance favors lower price action.",
      trigger: "FAILED_RECLAIM_7500_OR_LOST_7500",
      invalidation: "RECLAIM_AND_HOLD_ABOVE_7560",
      nextTargets: nextDownTargets,
      engine3Needs: "FAILED_RECLAIM_OR_LOST_LEVEL_SHORT",
      engine4Needs: "SELLER_PARTICIPATION_OR_SHORT_REJECTION_VOLUME",
    },

    bullishPath: {
      active: true,
      condition: "PRICE_ABOVE_7560_AND_HOLD",
      meaning: "7560 holding as support weakens short watch and favors recovery.",
      trigger: "RECLAIM_AND_HOLD_7560",
      invalidation: "FAILED_RECLAIM_OR_LOSS_BACK_UNDER_7500",
      nextTargets: nextUpTargets,
      engine3Needs: "RECLAIM_AND_HOLD_LONG",
      engine4Needs: "BUYER_PARTICIPATION_EXPANDING",
    },

    currentInstruction,

    engineInstructions: {
      engine3:
        "Do not call price between 7500 and 7560 clean permission. Watch failed reclaim at 7500 or reclaim/hold at 7560.",
      engine4:
        "Confirm participation only after price chooses a side: seller participation below/rejecting 7500, buyer participation above/holding 7560.",
      engine15:
        "Check risk/target path after one side confirms.",
      engine6:
        "Remain final permission referee. No paper allow without Engine 3, Engine 4, and Engine 15 alignment.",
    },

    noExecution: true,
    noPermissionCreated: true,

    reasonCodes,
  };
}

function sanitizeKeyPart(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9@_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getEngine8Allowlist() {
  return String(process.env.ENGINE8_ALLOWLIST || "SPY,QQQ")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function buildEngine26ImbalanceWatch({
  symbol,
  strategyId,
  tf,
  permission,
  engine22WaveStrategy,
  confluence,
  engine15Decision,
}) {
  const fastReaction =
    confluence?.context?.reaction?.engine3FastImbalanceReaction || null;

  const paperReaction =
    confluence?.context?.reaction?.paperScalpReaction || null;

  const fastParticipation =
    confluence?.context?.volume?.engine4FastImbalanceParticipation || null;

  const paperReadiness =
    engine15Decision?.paperScalpReadiness || null;

  const paperPermission = permission?.paper || null;

  const paperDecision = safeUpper(paperPermission?.decision);

  const engine6PaperReady =
    paperPermission?.allowed === true &&
    ["PAPER_ALLOW", "FAST_INTRADAY_PAPER_ALLOW"].includes(paperDecision);

  const lifecycleContext =
    engine22WaveStrategy?.lifecycleContext || null;

  const longTermLifecycle =
    lifecycleContext?.longTermLifecycle || null;

  const intradayScalpLifecycle =
    lifecycleContext?.intradayScalpLifecycle || null;

  const engine26Use =
    intradayScalpLifecycle?.engine26Use || null;

  const currentPrice =
    toNum(fastReaction?.currentPrice) ||
    toNum(paperReaction?.currentPrice) ||
    toNum(paperReadiness?.currentPrice) ||
    toNum(engine15Decision?.debug?.currentPrice) ||
    toNum(confluence?.price) ||
    null;

  const imbalance = fastReaction?.imbalance || null;

  const active =
    fastReaction?.active === true &&
    imbalance &&
    (imbalance.inside === true || imbalance.near === true);

  const normalizedActiveImbalance = imbalance
    ? {
        id: imbalance.id || null,
        source: imbalance.source || "es-smz-manual-zones.txt",
        side: imbalance.side || "GREEN",
        zoneType: imbalance.zoneType || "MANUAL_IMBALANCE",
        lo: toNum(imbalance.lo),
        hi: toNum(imbalance.hi),
        mid: toNum(imbalance.mid),
        distancePts: toNum(imbalance.distancePts),
        inside: imbalance.inside === true,
        near: imbalance.near === true,
        raw: imbalance.raw || null,
      }
    : null;

  const structuralPlaybook = deriveEngine22StructuralPlaybook({
    symbol: safeUpper(symbol),
    strategyId,
    tf,
    currentPrice,
    activeImbalance: normalizedActiveImbalance,
    engine22WaveStrategy,
  });

  const isTopImbalance =
    active &&
    intradayScalpLifecycle?.key === "MINUTE_W4_PULLBACK_WAIT_FOR_RECLAIM" &&
    toNum(imbalance?.hi) != null &&
    currentPrice != null &&
    currentPrice >= Number(imbalance.mid ?? imbalance.lo ?? 0);

  const isLowerImbalance =
    active &&
    !isTopImbalance;

  const labels = [];

  if (isTopImbalance && Array.isArray(engine26Use?.topImbalanceContext)) {
    labels.push(...engine26Use.topImbalanceContext);
  } else if (isLowerImbalance && Array.isArray(engine26Use?.lowerImbalanceContext)) {
    labels.push(...engine26Use.lowerImbalanceContext);
  } else if (active) {
    labels.push("MANUAL_IMBALANCE_ACTIVE");
    labels.push("DIRECTION_NOT_ASSUMED");
  } else {
    labels.push("NO_ACTIVE_MANUAL_IMBALANCE");
  }

  const engine3State = paperReaction?.state || fastReaction?.state || null;
  const engine3Direction = paperReaction?.direction || fastReaction?.direction || null;
  const engine3Quality = paperReaction?.quality || fastReaction?.quality || null;

  const engine4State =
    fastParticipation?.participationState ||
    confluence?.context?.volume?.engine22LifecycleParticipation
      ?.paperScalpParticipation?.participationState ||
    null;

  const engine4Allowed =
    fastParticipation?.allowed === true ||
    confluence?.context?.volume?.engine22LifecycleParticipation
      ?.paperScalpParticipation?.allowed === true;

  let status = "NO_ACTIVE_IMBALANCE_WATCH";

  if (active) {
    status =
      structuralPlaybook?.status ||
      structuralPlaybook?.template ||
      "WATCH_ONLY_WAIT_FOR_CONFIRMATION";

   if (engine6PaperReady) {
     status = "READY_FOR_ENGINE26_TICKET";
    } else if (!structuralPlaybook?.status && isTopImbalance) {
      status = "TOP_IMBALANCE_ACTIVE_WAIT_FOR_ACCEPTANCE_OR_REJECTION";
    } else if (!structuralPlaybook?.status && isLowerImbalance) {
      status = "LOWER_IMBALANCE_ACTIVE_WAIT_FOR_SWEEP_RECLAIM_OR_SUPPORT_FAILURE";
    }
  }

  return {
    active,
    engine: "engine26.imbalanceWatch.v1",
    mode: active ? "FAST_IMBALANCE_WATCH" : "NORMAL_SCAN",
    paperOnly: true,
    researchOnly: true,

    symbol: safeUpper(symbol),
    strategyId,
    tf,

    currentPrice,

    activeImbalance: normalizedActiveImbalance,

    alarmAllEngines: active,
    directionAssumption:
      engine26Use?.directionAssumption || "NONE_UNTIL_ENGINE3_ENGINE4_CONFIRM",

    engine22ReadFirst: true,

    structuralPlaybook,
    activeImbalanceRole:
      structuralPlaybook?.activeImbalanceRole || "NEUTRAL_MANUAL_IMBALANCE",
    structuralTemplate:
      structuralPlaybook?.template || "NEUTRAL_MANUAL_IMBALANCE_WATCH",
    structuralBias:
      structuralPlaybook?.structuralBias || "NEUTRAL",
    preferredAction:
      structuralPlaybook?.preferredAction || null,
    preferredDirection:
      structuralPlaybook?.preferredDirection || "NONE",
    doNotChaseLong:
      structuralPlaybook?.doNotChaseLong === true,
    shortResearchOnly:
      structuralPlaybook?.shortResearchOnly === true,

    waveContext: lifecycleContext
      ? {
          source: lifecycleContext.source || "engine22.lifecycleContext.v1",
          purpose: lifecycleContext.purpose || null,

          longTermLifecycle: longTermLifecycle
            ? {
                key: longTermLifecycle.key || longTermLifecycle.lifecycle || null,
                activeWave: longTermLifecycle.activeWave || null,
                activeDegree: longTermLifecycle.activeDegree || null,
                direction: longTermLifecycle.direction || null,
                purpose: longTermLifecycle.purpose || "HIGHER_TIMEFRAME_CONTEXT_ONLY",
                nextTarget: longTermLifecycle.nextTarget ?? null,
                higherTargets: longTermLifecycle.higherTargets || [],
                noExecution: longTermLifecycle.noExecution === true,
                noPermissionCreated:
                  longTermLifecycle.noPermissionCreated === true,
              }
            : null,

          intradayScalpLifecycle: intradayScalpLifecycle
            ? {
                key: intradayScalpLifecycle.key || intradayScalpLifecycle.lifecycle || null,
                activeWave: intradayScalpLifecycle.activeWave || null,
                activeDegree: intradayScalpLifecycle.activeDegree || null,
                parentWave: intradayScalpLifecycle.parentWave || null,
                parentDegree: intradayScalpLifecycle.parentDegree || null,
                direction: intradayScalpLifecycle.direction || null,
                action: intradayScalpLifecycle.action || null,
                currentPrice: intradayScalpLifecycle.currentPrice ?? null,
                w3High: intradayScalpLifecycle.w3High ?? null,
                preferredW4Zone:
                  intradayScalpLifecycle.preferredW4Zone || null,
                pullbackLevels:
                  intradayScalpLifecycle.pullbackLevels || null,
                invalidation:
                  intradayScalpLifecycle.invalidation ?? null,
                noChase: intradayScalpLifecycle.noChase === true,
                noExecution: intradayScalpLifecycle.noExecution === true,
                noPermissionCreated:
                  intradayScalpLifecycle.noPermissionCreated === true,
              }
            : null,

          relationship: lifecycleContext.relationship || null,
        }
      : null,

    labels: [...new Set(labels.filter(Boolean))],

    playbookWatch: {
      structuralTemplate:
        structuralPlaybook?.template || "NEUTRAL_MANUAL_IMBALANCE_WATCH",
      activeImbalanceRole:
        structuralPlaybook?.activeImbalanceRole || "NEUTRAL_MANUAL_IMBALANCE",
      primaryScenario:
        structuralPlaybook?.primaryScenario || null,
      preferredAction:
        structuralPlaybook?.preferredAction || null,
      confirmationNeeds:
        structuralPlaybook?.confirmationNeeds || [],

      topImbalance: isTopImbalance
        ? "WATCH_ACCEPTANCE_OR_REJECTION"
        : null,
      lowerImbalance: isLowerImbalance
        ? "WATCH_SWEEP_RECLAIM_OR_SUPPORT_FAILURE"
        : null,
      selectedSetup:
        engine6PaperReady
          ? paperPermission?.setupType || null
          : null,
    },

    fastReads: {
      engine3: {
        active: fastReaction?.active === true,
        state: engine3State,
        quality: engine3Quality,
        direction: engine3Direction,
        paperAllowed: paperReaction?.allowed === true,
        blockers: Array.isArray(paperReaction?.blockers)
          ? paperReaction.blockers
          : [],
      },
      engine4: {
        active: fastParticipation?.active === true,
        state: engine4State,
        quality: fastParticipation?.participationQuality || null,
        allowed: engine4Allowed,
        risk: fastParticipation?.risk || null,
        currentBarVolume: fastParticipation?.currentBarVolume ?? null,
        priorBarVolume: fastParticipation?.priorBarVolume ?? null,
        volumeRatio: fastParticipation?.currentVsPriorVolumeRatio ?? null,
        blockers: Array.isArray(fastParticipation?.blockers)
          ? fastParticipation.blockers
          : [],
      },
    },

    permission: {
      engine15Allowed: paperReadiness?.allowed === true,
      engine6Decision: paperPermission?.decision || null,
      engine6Allowed: paperPermission?.allowed === true,
      ticketReady: engine6PaperReady,
    },

    status,

    noExecution: true,
    noPermissionCreated: true,

    reasonCodes: [
      "ENGINE26_MANUAL_IMBALANCE_WATCH",
      active ? "MANUAL_IMBALANCE_ALARM_ACTIVE" : "NO_ACTIVE_MANUAL_IMBALANCE",
      lifecycleContext ? "ENGINE22_LIFECYCLE_CONTEXT_ATTACHED" : "ENGINE22_LIFECYCLE_CONTEXT_MISSING",
      structuralPlaybook?.template
        ? `STRUCTURAL_PLAYBOOK_${structuralPlaybook.template}`
        : "STRUCTURAL_PLAYBOOK_MISSING",
      structuralPlaybook?.activeImbalanceRole
        ? `IMBALANCE_ROLE_${structuralPlaybook.activeImbalanceRole}`
        : "IMBALANCE_ROLE_UNKNOWN",
      "ENGINE22_READ_FIRST",
      isTopImbalance ? "TOP_IMBALANCE_ACTIVE" : null,
      isLowerImbalance ? "LOWER_IMBALANCE_ACTIVE" : null,
      "DIRECTION_NOT_ASSUMED",
      "NO_ENGINE26_TICKET_UNTIL_ENGINE6_PAPER_ALLOW",
    ].filter(Boolean),
  };
}

export function buildEngine26StructuralContext(engine26ImbalanceWatch = null) {
  const structuralPlaybook =
    engine26ImbalanceWatch?.structuralPlaybook || null;

  if (!structuralPlaybook || typeof structuralPlaybook !== "object") {
    return null;
  }

  const watchLevels = structuralPlaybook.watchLevels || {};
  const triggerMap = structuralPlaybook.triggerMap || {};

  const bHigh =
    watchLevels?.manualB?.price ??
    watchLevels?.bLeg?.price ??
    watchLevels?.cProjection?.bHigh ??
    triggerMap?.bHigh ??
    null;

  const bR618 =
    triggerMap?.firstWarning ??
    watchLevels?.bBounceFibBand?.r618 ??
    watchLevels?.bBounceBand?.hi ??
    null;

  const bMid =
    triggerMap?.bBounceMid ??
    watchLevels?.bBounceFibBand?.r500 ??
    null;

  const bLow =
    triggerMap?.bBounceLower ??
    watchLevels?.bBounceFibBand?.r382 ??
    watchLevels?.bBounceBand?.lo ??
    null;

  const parentR382 =
    triggerMap?.parentR382 ??
    watchLevels?.parentFibConfluence?.r382 ??
    null;

  const parentR500 =
    triggerMap?.parentR500 ??
    watchLevels?.parentFibConfluence?.r500 ??
    null;

  const parentR618 =
    triggerMap?.parentR618 ??
    watchLevels?.parentFibConfluence?.r618 ??
    null;

  const c100 =
    triggerMap?.c100 ??
    watchLevels?.cProjection?.c100 ??
    null;

  const c1272 =
    triggerMap?.c1272 ??
    watchLevels?.cProjection?.c1272 ??
    null;

  const c1618 =
    triggerMap?.c1618 ??
    watchLevels?.cProjection?.c1618 ??
    null;

  const targetPathPreview = [
    bR618,
    bMid,
    bLow,
    parentR382,
    parentR500,
    parentR618,
    c100,
    c1272,
    c1618,
  ].filter((x) => x != null);

  return {
    active: structuralPlaybook.active === true,
    engine: "engine26.structuralContext.v1",
    source: "engine26.structuralContext.fromEngine22Playbook.v1",
    mode: "WATCH_ONLY",

    symbol:
      structuralPlaybook.symbol ||
      engine26ImbalanceWatch?.symbol ||
      "ES",

    strategyId:
      structuralPlaybook.strategyId ||
      engine26ImbalanceWatch?.strategyId ||
      "intraday_scalp@10m",

    tf:
      structuralPlaybook.tf ||
      engine26ImbalanceWatch?.tf ||
      "10m",

    engine22ReadFirst: true,

    status: structuralPlaybook.status || engine26ImbalanceWatch?.status || null,
    template:
      structuralPlaybook.template ||
      engine26ImbalanceWatch?.structuralTemplate ||
      null,
    activeImbalanceRole:
      structuralPlaybook.activeImbalanceRole ||
      engine26ImbalanceWatch?.activeImbalanceRole ||
      null,

    structuralBias:
      structuralPlaybook.structuralBias ||
      engine26ImbalanceWatch?.structuralBias ||
      null,

    preferredDirection:
      structuralPlaybook.preferredDirection ||
      engine26ImbalanceWatch?.preferredDirection ||
      null,

    preferredAction:
      structuralPlaybook.preferredAction ||
      engine26ImbalanceWatch?.preferredAction ||
      null,

    doNotChaseLong:
      structuralPlaybook.doNotChaseLong === true ||
      engine26ImbalanceWatch?.doNotChaseLong === true,

    shortResearchOnly:
      structuralPlaybook.shortResearchOnly === true ||
      engine26ImbalanceWatch?.shortResearchOnly === true,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    levels: {
      bHigh,
      bR618,
      bMid,
      bLow,

      parentR382,
      parentR500,
      parentR618,

      c100,
      c1272,
      c1618,
    },

    targetPathPreview,

    confirmationNeeds: Array.isArray(structuralPlaybook.confirmationNeeds)
      ? structuralPlaybook.confirmationNeeds
      : [],

    invalidation: structuralPlaybook.invalidation || null,

    sourceRefs: {
      engine22DegreeStates: true,
      engine22NestedCorrectionContext: true,
      engine22CorrectionModel: true,
      engine26ImbalanceClassifier: true,
      manualImbalance: true,
    },

    reasonCodes: [
      "ENGINE26_STRUCTURAL_CONTEXT_BUILT",
      "ENGINE22_READ_FIRST",
      structuralPlaybook.template
        ? `TEMPLATE_${structuralPlaybook.template}`
        : null,
      structuralPlaybook.activeImbalanceRole || null,
      structuralPlaybook.structuralBias || null,
      structuralPlaybook.doNotChaseLong === true
        ? "DO_NOT_CHASE_LONG"
        : null,
      structuralPlaybook.shortResearchOnly === true
        ? "SHORT_RESEARCH_ONLY"
        : null,
      "WATCH_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ].filter(Boolean),
  };
}

function makeNoTrade({
  symbol,
  strategyId,
  tf,
  status = "NO_PAPER_TRADE",
  blockers = [],
  warnings = [],
  reasonCodes = [],
  context = {},
}) {
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
  const uniqueReasonCodes = [...new Set(reasonCodes.filter(Boolean))];

  return {
    active: false,
    engine: ENGINE,
    mode: MODE,
    researchOnly: true,

    symbol: safeUpper(symbol),
    strategyId,
    tf,

    allowed: false,
    status,

    setupFamily: "IMBALANCE_TO_IMBALANCE_SCALP",
    setupType: context?.setupType || null,
    direction: context?.direction || "NONE",

    engine26PaperTradeTicket: null,
    paperTradeTicket: null,

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    requiresEngine8Paper: true,
    requiresEngine10Journal: true,

    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    reasonCodes: uniqueReasonCodes.length
      ? uniqueReasonCodes
      : uniqueBlockers.length
      ? uniqueBlockers
      : ["NO_PAPER_TRADE"],

    engineContext: context?.engineContext || null,
    createdAt: nowIso(),
  };
}

function getCurrentLevelAction(confluence) {
  return confluence?.context?.reaction?.currentLevelAction || null;
}

function getPaperScalpReaction(confluence) {
  return confluence?.context?.reaction?.paperScalpReaction || null;
}

function getPaperScalpParticipation(confluence) {
  return (
    confluence?.context?.volume?.engine22LifecycleParticipation
      ?.paperScalpParticipation || null
  );
}

function getLifecycleParticipation(confluence) {
  return confluence?.context?.volume?.engine22LifecycleParticipation || null;
}

function getCurrentPrice({
  permission,
  engine15Decision,
  engine22WaveStrategy,
  confluence,
}) {
  return roundToTick(
    permission?.paper?.currentPrice ??
      engine15Decision?.paperScalpReadiness?.currentPrice ??
      engine15Decision?.currentPrice ??
      engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.reference
        ?.currentPrice ??
      engine22WaveStrategy?.currentLifecycleState?.currentPrice ??
      getCurrentLevelAction(confluence)?.currentPrice ??
      confluence?.price
  );
}

function getDirection({ permission, engine15Decision, engine22WaveStrategy }) {
  return safeUpper(
    permission?.paper?.direction ||
      engine15Decision?.paperScalpReadiness?.direction ||
      engine15Decision?.direction ||
      engine22WaveStrategy?.currentLifecycleState?.direction ||
      "NONE"
  );
}

function getSetupType({ permission, engine15Decision, engine22WaveStrategy }) {
  return (
    safeString(permission?.paper?.setupType) ||
    safeString(engine15Decision?.paperScalpReadiness?.setupType) ||
    safeString(engine22WaveStrategy?.currentLifecycleState?.key) ||
    safeString(engine22WaveStrategy?.waveOpportunity?.setupType) ||
    "UNKNOWN_SETUP"
  );
}

function getReferenceLevel(confluence) {
  const currentLevelAction = getCurrentLevelAction(confluence);
  const paperScalpReaction = getPaperScalpReaction(confluence);

  return roundToTick(
    paperScalpReaction?.referenceLevel ??
      currentLevelAction?.referenceLevel ??
      currentLevelAction?.level ??
      currentLevelAction?.zone?.mid ??
      currentLevelAction?.reference?.level
  );
}

function getReferenceType(confluence) {
  const currentLevelAction = getCurrentLevelAction(confluence);
  const paperScalpReaction = getPaperScalpReaction(confluence);

  return (
    safeString(paperScalpReaction?.referenceType) ||
    safeString(currentLevelAction?.referenceType) ||
    safeString(currentLevelAction?.zoneType) ||
    "REFERENCE"
  );
}

function getZoneId({ engine25Context, confluence, engine22WaveStrategy }) {
  const nearestZone =
    engine25Context?.esPermission?.nearestZone ||
    engine25Context?.zoneAwareRead?.nearestZone ||
    engine25Context?.nearestZone ||
    null;

  const activeZone = confluence?.context?.activeZone || null;
  const referenceLevel = getReferenceLevel(confluence);
  const referenceType = getReferenceType(confluence);

  return (
    safeString(nearestZone?.id) ||
    safeString(activeZone?.id) ||
    (referenceLevel != null
      ? `REFERENCE_${sanitizeKeyPart(referenceType)}_${sanitizeKeyPart(
          referenceLevel
        )}`
      : null) ||
    safeString(engine22WaveStrategy?.currentLifecycleState?.key) ||
    "UNKNOWN_ZONE"
  );
}

function getBarTime({ confluence }) {
  const currentLevelAction = getCurrentLevelAction(confluence);

  const raw =
    currentLevelAction?.lastCandle?.time ??
    currentLevelAction?.lastCandle?.t ??
    currentLevelAction?.lastCandle?.tSec ??
    currentLevelAction?.priorCandle?.time ??
    currentLevelAction?.priorCandle?.t ??
    currentLevelAction?.priorCandle?.tSec ??
    Math.floor(Date.now() / 1000);

  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : Math.floor(Date.now() / 1000);
}

function getStopPrice({ direction, engine15Decision, confluence, engine25Context }) {
  const riskModel = engine15Decision?.paperScalpReadiness?.riskModel || {};
  const directStop =
    toNum(riskModel?.stopLevel) ?? toNum(riskModel?.invalidationLevel);

  if (directStop != null) return roundToTick(directStop);

  const referenceLevel = getReferenceLevel(confluence);
  if (referenceLevel != null) {
    if (direction === "LONG") return roundToTick(referenceLevel - 2);
    if (direction === "SHORT") return roundToTick(referenceLevel + 2);
  }

  const nearestZone =
    engine25Context?.esPermission?.nearestZone ||
    engine25Context?.zoneAwareRead?.nearestZone ||
    engine25Context?.nearestZone ||
    null;

  const lo = toNum(nearestZone?.lo);
  const hi = toNum(nearestZone?.hi);

  if (direction === "LONG" && lo != null) return roundToTick(lo - 1);
  if (direction === "SHORT" && hi != null) return roundToTick(hi + 1);

  return null;
}

function getTargetPrice({
  direction,
  entryPrice,
  engine15Decision,
  permission,
  engine22WaveStrategy,
  engine25Context,
}) {
  const targetModel = engine15Decision?.paperScalpReadiness?.targetModel || {};

  const directTarget =
    toNum(targetModel?.targetLevel) ??
    toNum(permission?.paper?.targetLevel) ??
    toNum(engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.targetLevel);

  if (directTarget != null) return roundToTick(directTarget);

  const targetPoints =
    toNum(permission?.paper?.targetPoints) ??
    toNum(targetModel?.desiredPoints) ??
    10;

  const nearestOpposingZone =
    engine25Context?.nearestOpposingZone ||
    engine25Context?.zoneAwareRead?.nearestOpposingZone ||
    null;

  const opposingLo = toNum(nearestOpposingZone?.lo);
  const opposingHi = toNum(nearestOpposingZone?.hi);

  if (direction === "LONG" && opposingLo != null) return roundToTick(opposingLo);
  if (direction === "SHORT" && opposingHi != null) return roundToTick(opposingHi);

  if (entryPrice == null) return null;

  if (direction === "LONG") return roundToTick(entryPrice + targetPoints);
  if (direction === "SHORT") return roundToTick(entryPrice - targetPoints);

  return null;
}

function hasCleanTargetPath({ direction, entryPrice, targetPrice, engine15Decision }) {
  const targetModel = engine15Decision?.paperScalpReadiness?.targetModel || {};
  const blockers = Array.isArray(engine15Decision?.paperScalpReadiness?.blockers)
    ? engine15Decision.paperScalpReadiness.blockers
    : [];

  if (blockers.includes("NO_CLEAN_PATH_TO_TARGET")) return false;

  if (targetModel?.targetPathRequired === true && targetModel?.targetLevel == null) {
    return false;
  }

  if (entryPrice == null || targetPrice == null) return false;

  if (direction === "LONG") return targetPrice > entryPrice;
  if (direction === "SHORT") return targetPrice < entryPrice;

  return false;
}

function getStructuralLevel(structuralContext, key) {
  const value = structuralContext?.levels?.[key];
  const n = toNum(value);
  return n == null ? null : roundToTick(n);
}

function buildEngine26PaperTrialCandidate({
  symbol,
  strategyId,
  tf,
  currentPrice,
  zoneLo,
  zoneHi,
  confluence,
  engine26StructuralContext,
  locationContext,
  controlLevelContext,
}) {
  const price = roundToTick(currentPrice);
  const lo = roundToTick(zoneLo);
  const hi = roundToTick(zoneHi);

  const fastReaction =
    confluence?.context?.reaction?.engine3FastImbalanceReaction || null;

  const fastParticipation =
    confluence?.context?.volume?.engine4FastImbalanceParticipation || null;

  const engine3State = safeUpper(fastReaction?.state);
  const engine3Direction = safeUpper(fastReaction?.direction);
  const engine3Quality = safeUpper(fastReaction?.quality);

  const engine4State = safeUpper(fastParticipation?.participationState);
  const engine4Direction = safeUpper(
    fastParticipation?.intendedDirection ||
      fastParticipation?.direction ||
      fastParticipation?.tradeDirection
  );

  const engine4Allowed = fastParticipation?.allowed === true;
  const engine4HardBlocked = fastParticipation?.hardBlocked === true;

  const structuralStatus = safeUpper(engine26StructuralContext?.status);
  const structuralTemplate = safeUpper(engine26StructuralContext?.template);

  const bullRecoveryLevel =
    roundToTick(controlLevelContext?.bullRecoveryLevel) ?? 7560;

  const bearControlLevel =
    roundToTick(controlLevelContext?.bearControlLevel) ?? 7500;

  const shortTriggerLevel =
    roundToTick(locationContext?.shortTriggerLevel) ??
    lo ??
    7540.75;

  const isPostEReaction =
    structuralStatus.includes("POST_E_REACTION") ||
    structuralTemplate.includes("TRIANGLE_RESOLUTION_DECISION");

  const engine3ShortConfirmed =
    engine3Direction === "SHORT" &&
    (
      engine3State.includes("LOST") ||
      engine3State.includes("REJECTING") ||
      engine3State.includes("BREAKOUT_FAILING") ||
      engine3State.includes("FAILED_RECLAIM")
    );

  const engine4ShortConfirmed =
    engine4Allowed === true &&
    engine4HardBlocked === false &&
    (
      engine4State.includes("SHORT_REJECTION_VOLUME_CONFIRMED") ||
      engine4State.includes("SELLER") ||
      engine4State.includes("REJECTION")
    );

  const priceLostShortTrigger =
    price != null &&
    shortTriggerLevel != null &&
    price <= shortTriggerLevel;

  const active =
    isPostEReaction &&
    engine3ShortConfirmed &&
    engine4ShortConfirmed &&
    priceLostShortTrigger;

  if (!active) {
    return {
      active: false,
      engine: "engine26.paperTrialCandidate.v1",
      mode: "PAPER_LIMIT_PREVIEW_ONLY",
      reasonCodes: [
        "ENGINE26_PAPER_TRIAL_NOT_ACTIVE",
        isPostEReaction ? "POST_E_REACTION_CONTEXT_PRESENT" : "POST_E_REACTION_CONTEXT_MISSING",
        engine3ShortConfirmed ? "ENGINE3_SHORT_CONFIRMED" : "ENGINE3_SHORT_NOT_CONFIRMED",
        engine4ShortConfirmed ? "ENGINE4_SHORT_CONFIRMED" : "ENGINE4_SHORT_NOT_CONFIRMED",
        priceLostShortTrigger ? "PRICE_LOST_SHORT_TRIGGER" : "PRICE_NOT_BELOW_SHORT_TRIGGER",
        "NO_EXECUTION",
        "NO_PERMISSION_CREATED",
      ],
    };
  }

  const limitPrice =
    lo != null
      ? roundToTick(lo + 5)
      : roundToTick(price + 8.75);

  const stopPrice =
    bullRecoveryLevel != null
      ? roundToTick(bullRecoveryLevel + 4.25)
      : hi != null
      ? roundToTick(hi + 1)
      : roundToTick(limitPrice + 18);

  const target1 = shortTriggerLevel;
  const target2 = 7520;
  const target3 = 7515;
  const target4 = bearControlLevel;

  const riskPoints =
    stopPrice != null && limitPrice != null
      ? roundPts(stopPrice - limitPrice)
      : null;

  const rewardPoints =
    limitPrice != null && target2 != null
      ? roundPts(limitPrice - target2)
      : null;

  const riskReward =
    riskPoints != null && riskPoints > 0 && rewardPoints != null
      ? Number((rewardPoints / riskPoints).toFixed(2))
      : null;

  return {
    active: true,
    engine: "engine26.paperTrialCandidate.v1",
    mode: "PAPER_LIMIT_PREVIEW_ONLY",
    paperOnly: true,
    researchOnly: true,

    symbol: safeUpper(symbol || "ES"),
    strategyId: strategyId || STRATEGY_ID,
    tf: tf || "10m",

    status: "TAKE_PAPER_TRADE_LIMIT_PULLBACK_ONLY",
    setupType: "FAILED_7560_RECLAIM_SHORT_PAPER_TRIAL",
    direction: "SHORT",

    instruction:
      "Paper trial candidate only. Use limit pullback entry; do not chase the flush low.",

    limitOrderPreview: {
      side: "SELL",
      orderType: "LIMIT",
      limitPrice,
      currentPrice: price,
      reason:
        "Failed 7560 reclaim confirmed by Engine 3 lost level and Engine 4 short rejection volume. Enter only on pullback toward breakdown area.",
    },

    entryIdea: {
      label: "TAKE PAPER TRADE — limit pullback only",
      preferredArea:
        limitPrice != null
          ? `SELL LIMIT near ${limitPrice} after failed 7560 reclaim`
          : "SELL LIMIT on pullback after failed reclaim",
      referencePrice: limitPrice,
      description:
        "Paper-only short trial. Do not chase the low; wait for pullback toward the breakdown area.",
    },

    stopIdea: {
      label: "Above failed 7560 reclaim / trap high",
      price: stopPrice,
      description:
        "Preview stop above failed reclaim area. Research only; no broker order.",
    },

    confirmationGate: {
      label: "Failed 7560 reclaim short confirmed",
      level: shortTriggerLevel,
      rule:
        "Engine 3 lost level SHORT and Engine 4 short rejection volume confirmed after price lost the short trigger.",
      required: false,
    },

    targetMap: {
      firstReaction: target1,
      aLowBreak: null,
      preferredCPressure: target2,
      stretchC: target3,
      bearControl: target4,
      labels: {
        firstReaction: "Short trigger retest / first reaction",
        preferredCPressure: "7520 pressure target",
        stretchC: "7515 stretch target",
        bearControl: "7500 bear control",
      },
    },

    geometryPreview: {
      mode: "PAPER_LIMIT_PREVIEW_ONLY",
      direction: "SHORT",
      entryReference: limitPrice,
      stopReference: stopPrice,
      targetReference: target2,
      riskPoints,
      rewardPoints,
      riskReward,
    },

    evidence: {
      engine3State,
      engine3Direction,
      engine3Quality,
      engine4State,
      engine4Direction,
      engine4Allowed,
      engine4HardBlocked,
      currentPrice: price,
      shortTriggerLevel,
      bullRecoveryLevel,
      bearControlLevel,
    },

    noExecution: true,
    noPermissionCreated: true,
    noBrokerOrder: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    reasonCodes: [
      "ENGINE26_PAPER_TRIAL_CANDIDATE",
      "TAKE_PAPER_TRADE_LIMIT_PULLBACK_ONLY",
      "FAILED_7560_RECLAIM_SHORT",
      "ENGINE3_SHORT_CONFIRMED",
      "ENGINE4_SHORT_REJECTION_VOLUME_CONFIRMED",
      "PRICE_LOST_SHORT_TRIGGER",
      "LIMIT_PULLBACK_ENTRY_NOT_CHASE",
      "PAPER_ONLY_RESEARCH",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
      "NO_BROKER_ORDER",
    ],
  };
}

function buildEngine7SizingPreviewV1({ permission, confluence, engine15Decision }) {
  const engine6Paper = permission?.paper || null;

  const totalScore =
    toNum(confluence?.scores?.total) ??
    toNum(confluence?.total) ??
    toNum(engine15Decision?.qualityScore) ??
    null;

  return {
    active: true,
    engine: "engine7.positionSizing.v1.preview",
    mode: "R_ONLY_PREVIEW",
    source: "ENGINE7_V1_CONTRACT",

    engine6Permission: engine6Paper?.decision || permission?.permission || null,
    engine6Allowed: engine6Paper?.allowed === true,
    engine6SizeMultiplier:
      toNum(engine6Paper?.sizeMultiplier) ??
      toNum(permission?.sizeMultiplier) ??
      null,

    totalScore,
    baseLabel: null,
    baseR: null,
    finalR: null,
    band: null,
    allowed: false,

    note:
      "Engine 7 v1 currently sizes in R from Engine 6 permission, Engine 5 score, and market regime. It does not yet size from entry/stop/target geometry.",

    futureUpgrade:
      "Engine 7 v2 can later convert entry/stop/target geometry into contracts, dollar risk, and dollar reward.",

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE7_V1_R_ONLY_PREVIEW",
      "NO_ENTRY_STOP_TARGET_SIZING_IN_ENGINE7_V1",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function buildEngine26TradePlanPreview({
  symbol,
  strategyId,
  tf,
  permission,
  engine22WaveStrategy,
  engine25Context,
  confluence,
  engine15Decision,
  engine26ImbalanceWatch,
  engine26StructuralContext,
  dailyCandleContext = null,
  locationContext = null,
  controlLevelContext = null,
}) {
  const paper = permission?.paper || null;

  const currentPrice = getCurrentPrice({
    permission,
    engine15Decision,
    engine22WaveStrategy,
    confluence,
  });

  const direction = getDirection({
    permission,
    engine15Decision,
    engine22WaveStrategy,
  });

  const setupType = getSetupType({
    permission,
    engine15Decision,
    engine22WaveStrategy,
  });

  const activeImbalance = engine26ImbalanceWatch?.activeImbalance || null;

  const zoneLo = roundToTick(activeImbalance?.lo);
  const zoneHi = roundToTick(activeImbalance?.hi);
  const zoneMid = roundToTick(activeImbalance?.mid);

  const bHigh = getStructuralLevel(engine26StructuralContext, "bHigh");
  const c100 = getStructuralLevel(engine26StructuralContext, "c100");
  const c1272 = getStructuralLevel(engine26StructuralContext, "c1272");
  const c1618 = getStructuralLevel(engine26StructuralContext, "c1618");

  const aLow =
    roundToTick(
      engine22WaveStrategy?.degreeStates?.minute?.correctionModel?.manualMarks?.A?.price
    ) ??
    roundToTick(
      engine22WaveStrategy?.waveFibState?.markMaturity?.byDegree?.minute
        ?.correction?.resolvedMarks?.A?.price
    ) ??
    null;

  const oldB =
    engine22WaveStrategy?.waveFibState?.markMaturity?.byDegree?.minute
      ?.correction?.resolvedMarks?.B?.previousCandidates?.[0] || null;

  const confirmationGate =
    direction === "SHORT"
      ? {
          label: "C-down confirmation watch",
          level: 7555,
          rule:
            "Below / failed reclaim near 7555 starts stronger C-down confirmation watch.",
          required: true,
        }
      : direction === "LONG"
      ? {
          label: "Long reclaim confirmation watch",
          level: zoneMid,
          rule:
            "Long requires reclaim / hold above the active zone with Engine 3 and Engine 4 confirmation.",
          required: true,
        }
      : {
          label: "Direction confirmation watch",
          level: null,
          rule: "Direction not assumed until Engine 3 / Engine 4 confirm.",
          required: true,
        };

  const entryIdea =
    direction === "SHORT"
      ? {
          label: "Failed acceptance below negotiated zone",
          preferredArea:
            zoneLo != null
              ? `Below ${zoneLo} / failed reclaim under B-zone`
              : "Below failed acceptance of active zone",
          referencePrice: zoneLo,
          description:
            "Short research only if price fails acceptance and starts moving down out of the negotiated zone.",
        }
      : direction === "LONG"
      ? {
          label: "Reclaim / hold above negotiated zone",
          preferredArea:
            zoneHi != null
              ? `Above ${zoneHi} reclaim / hold`
              : "Above active zone reclaim / hold",
          referencePrice: zoneHi,
          description:
            "Long research only if price reclaims and holds with participation.",
        }
      : {
          label: "No entry idea yet",
          preferredArea: null,
          referencePrice: null,
          description: "Direction not assumed.",
        };

  const stopIdea =
    direction === "SHORT"
      ? {
          label: "Above negotiated zone / B-zone invalidation",
          price: zoneHi != null ? roundToTick(zoneHi + TICK_SIZE_ES) : bHigh,
          description:
            "Stop idea sits just outside / above the negotiated zone or B-zone.",
        }
      : direction === "LONG"
      ? {
          label: "Below negotiated zone invalidation",
          price: zoneLo != null ? roundToTick(zoneLo - TICK_SIZE_ES) : null,
          description:
            "Stop idea sits just outside / below the negotiated zone.",
        }
      : {
          label: "No stop idea yet",
          price: null,
          description: "Stop requires direction and active trade map.",
        };

  const scalpGoal = {
    minPoints: 15,
    maxPoints: 30,
    description:
      "Brian's current paper scalp goal is 15–30 ES points, not a home-run trade.",
  };

  const targetMap =
    direction === "SHORT"
      ? {
          firstReaction: c100,
          aLowBreak: aLow,
          preferredCPressure: c1272,
          stretchC: c1618,
          labels: {
            firstReaction: "C100 / first reaction",
            aLowBreak: "A-low break / proof C is working",
            preferredCPressure: "C1272 / preferred C pressure",
            stretchC: "C1618 / stretch C",
          },
        }
      : {
          firstReaction: null,
          aLowBreak: null,
          preferredCPressure: null,
          stretchC: null,
          labels: {},
        };

  const geometryPreview = {
    mode: "PREVIEW_ONLY",
    direction,
    entryReference: entryIdea.referencePrice,
    stopReference: stopIdea.price,
    targetReference: targetMap.firstReaction,
    riskPoints:
      direction === "SHORT" && entryIdea.referencePrice != null && stopIdea.price != null
        ? roundPts(stopIdea.price - entryIdea.referencePrice)
        : direction === "LONG" && entryIdea.referencePrice != null && stopIdea.price != null
        ? roundPts(entryIdea.referencePrice - stopIdea.price)
        : null,
    rewardPoints:
      direction === "SHORT" && entryIdea.referencePrice != null && targetMap.firstReaction != null
        ? roundPts(entryIdea.referencePrice - targetMap.firstReaction)
        : direction === "LONG" && entryIdea.referencePrice != null && targetMap.firstReaction != null
        ? roundPts(targetMap.firstReaction - entryIdea.referencePrice)
        : null,
  };

  geometryPreview.riskReward =
    geometryPreview.riskPoints != null &&
    geometryPreview.riskPoints > 0 &&
    geometryPreview.rewardPoints != null
      ? Number((geometryPreview.rewardPoints / geometryPreview.riskPoints).toFixed(2))
      : null;

  const paperTrialCandidate = buildEngine26PaperTrialCandidate({
    symbol,
    strategyId,
    tf,
    currentPrice,
    zoneLo,
    zoneHi,
    confluence,
    engine26StructuralContext,
    locationContext,
    controlLevelContext,
  });

  const displayEntryIdea =
    paperTrialCandidate?.active === true ? paperTrialCandidate.entryIdea : entryIdea;

  const displayStopIdea =
    paperTrialCandidate?.active === true ? paperTrialCandidate.stopIdea : stopIdea;

  const displayConfirmationGate =
    paperTrialCandidate?.active === true
      ? paperTrialCandidate.confirmationGate
      : confirmationGate;

  const displayTargetMap =
    paperTrialCandidate?.active === true ? paperTrialCandidate.targetMap : targetMap;

  const displayGeometryPreview =
    paperTrialCandidate?.active === true
      ? paperTrialCandidate.geometryPreview
      : geometryPreview;

  const displayDirection =
    paperTrialCandidate?.active === true ? "SHORT" : direction;

  const engine7Sizing = buildEngine7SizingPreviewV1({
    permission,
    confluence,
    engine15Decision,
  });

  const paperDecision = safeUpper(paper?.decision);

  const paperAllowed =
    paper?.allowed === true &&
    ["PAPER_ALLOW", "FAST_INTRADAY_PAPER_ALLOW"].includes(paperDecision);

  return {
    active: engine26ImbalanceWatch?.active === true,
    engine: "engine26.tradePlanPreview.v1",
    mode: "PREVIEW_ONLY",
    paperOnly: true,
    researchOnly: true,

    symbol: safeUpper(symbol),
    strategyId,
    tf,

    alarm: {
      active: engine26ImbalanceWatch?.alarmAllEngines === true,
      zoneLo,
      zoneHi,
      zoneMid,
      currentPrice,
      inside: activeImbalance?.inside === true,
      near: activeImbalance?.near === true,
      label:
        engine26ImbalanceWatch?.alarmAllEngines === true
          ? "ALARM_ZONE_ACTIVE"
          : "NO_ACTIVE_ALARM_ZONE",
    },

    dailyCandleContext,
    locationContext,

    structure: {
      setupType,
      scenario:
        engine26StructuralContext?.template ||
        engine26ImbalanceWatch?.structuralTemplate ||
        null,
      direction: displayDirection,
      shortResearchOnly: engine26ImbalanceWatch?.shortResearchOnly === true,
      doNotChaseLong: engine26ImbalanceWatch?.doNotChaseLong === true,
      oldB: oldB
        ? {
            price: oldB.price ?? null,
            status: oldB.status || "SUPERSEDED",
            reason: oldB.reason || null,
          }
        : null,
      activeB: {
        price: bHigh,
        status:
          engine22WaveStrategy?.waveFibState?.markMaturity?.byDegree?.minute
            ?.correction?.resolvedMarks?.B?.status || null,
      },
    },

    paperTrialCandidate,

    entryIdea: displayEntryIdea,
    stopIdea: displayStopIdea,
    confirmationGate: displayConfirmationGate,
    scalpGoal,
    targetMap: displayTargetMap,
    geometryPreview: displayGeometryPreview,
    engine7Sizing,

    permissionState: {
      engine15Readiness: engine15Decision?.readinessLabel || null,
      engine15Action: engine15Decision?.action || null,
      engine6Decision: paper?.decision || null,
      engine6Allowed: paper?.allowed === true,
      paperAllowed,
      ticketAllowed: paperAllowed,
      status:
        paperTrialCandidate?.active === true
          ? "PAPER_TRIAL_CANDIDATE_LIMIT_PULLBACK"
          : paperAllowed
          ? "PAPER_PERMISSION_READY"
          : "WATCH_ONLY_NO_PERMISSION",
    },

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE26_TRADE_PLAN_PREVIEW_BUILT",
      "PREVIEW_ONLY",
      displayDirection === "SHORT" ? "SHORT_RESEARCH_TRADE_MAP" : null,
      paperTrialCandidate?.active === true
        ? "ENGINE26_PAPER_TRIAL_CANDIDATE"
        : null,
      paperTrialCandidate?.active === true
        ? "TAKE_PAPER_TRADE_LIMIT_PULLBACK_ONLY"
        : null,
      "ENGINE7_V1_R_ONLY_SIZE_READ_ATTACHED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ].filter(Boolean),

    createdAt: nowIso(),
  };
}

function buildPaperExitPlan({ direction, entryPrice }) {
  const sign = direction === "SHORT" ? -1 : 1;

  const block1Target = roundToTick(entryPrice + sign * 3.5);
  const block2Target = roundToTick(entryPrice + sign * 6.5);
  const block3Target = roundToTick(entryPrice + sign * 10);

  return {
    source: "paperExitPlanV0",
    exitPlanSource: "paperExitPlanV0",
    engine9Compatible: true,
    futureOwner: "Engine 9",
    exitModel: "THREE_BLOCKS",
    targetPoints: 10,

    block1: {
      targetPrice: block1Target,
      targetPts: 3.5,
      sizePct: 33,
    },
    block2: {
      targetPrice: block2Target,
      targetPts: 6.5,
      sizePct: 33,
    },
    block3: {
      targetPrice: block3Target,
      targetPts: 10,
      sizePct: 34,
    },
  };
}

function buildSizing() {
  return {
    source: "paperSizingV0",
    engine7Compatible: true,
    qty: 1,
    notes:
      "Paper-only fixed-size v1 until Engine 7 paper sizing and Engine 8/10 partial exits are defined.",
  };
}

function buildIdempotencyKey({
  symbol,
  strategyId,
  direction,
  setupType,
  zoneId,
  barTime,
}) {
  return [
    sanitizeKeyPart(symbol),
    sanitizeKeyPart(strategyId),
    MODE,
    sanitizeKeyPart(direction),
    sanitizeKeyPart(setupType),
    sanitizeKeyPart(zoneId),
    sanitizeKeyPart(barTime),
  ].join(":");
}

function isDuplicateOpenTrade({
  openPaperTrades,
  symbol,
  strategyId,
  direction,
  setupType,
  zoneId,
}) {
  const trades = Array.isArray(openPaperTrades) ? openPaperTrades : [];

  const expectedSymbol = safeUpper(symbol);
  const expectedStrategyId = safeString(strategyId);
  const expectedDirection = safeUpper(direction);
  const expectedSetupType = safeString(setupType);
  const expectedZoneId = safeString(zoneId);

  return trades.some((trade) => {
    const tradeSymbol = safeUpper(trade?.symbol);
    const tradeStrategyId = safeString(trade?.strategyId);
    const tradeDirection = safeUpper(trade?.direction);
    const tradeStatus = safeUpper(trade?.status);
    const tradeAccountMode = safeUpper(trade?.accountMode);

    const setup =
      trade?.setup?.engine26 ||
      trade?.setup?.paperTradePlan ||
      trade?.setup ||
      {};

    const tradeSetupType =
      safeString(setup?.setupType) ||
      safeString(trade?.signalEvent?.setupType) ||
      safeString(trade?.entry?.setupType);

    const tradeZoneId =
      safeString(setup?.zoneId) ||
      safeString(setup?.activeZone?.id) ||
      safeString(trade?.signalEvent?.zoneId);

    const sameBase =
      tradeSymbol === expectedSymbol &&
      tradeStrategyId === expectedStrategyId &&
      tradeDirection === expectedDirection &&
      tradeStatus === "OPEN" &&
      tradeAccountMode === "PAPER";

    if (!sameBase) return false;

    if (tradeSetupType && tradeZoneId) {
      return tradeSetupType === expectedSetupType && tradeZoneId === expectedZoneId;
    }

    return true;
  });
}

function buildEngineContext({
  engine22WaveStrategy,
  confluence,
  engine15Decision,
  permission,
  engine25Context,
}) {
  return {
    engine22: {
      currentLifecycleState: engine22WaveStrategy?.currentLifecycleState || null,
      waveOpportunity: engine22WaveStrategy?.waveOpportunity || null,
      tradeDecision: engine22WaveStrategy?.tradeDecision || null,
    },
    engine3: {
      currentLevelAction: getCurrentLevelAction(confluence),
      paperScalpReaction: getPaperScalpReaction(confluence),
    },
    engine4: {
      engine22LifecycleParticipation: getLifecycleParticipation(confluence),
      paperScalpParticipation: getPaperScalpParticipation(confluence),
    },
    engine15: {
      paperScalpReadiness: engine15Decision?.paperScalpReadiness || null,
      decision: engine15Decision || null,
    },
    engine6: {
      permission: permission || null,
      paper: permission?.paper || null,
    },
    engine25: engine25Context || null,
  };
}

export function buildEngine26PaperTradePlan({
  symbol,
  strategyId,
  tf,
  permission,
  engine22WaveStrategy,
  engine25Context,
  confluence,
  engine15Decision,
  openPaperTrades = [],
  dailyBars = [],
}) {
  const normalizedSymbol = safeUpper(symbol);
  const normalizedStrategyId = safeString(strategyId);
  const normalizedTf = safeString(tf || "10m");

  const paper = permission?.paper || null;

  const plannerPaperDecision = safeUpper(paper?.decision);

  const isFastIntradayPaperAllow =
    normalizedSymbol === SYMBOL &&
    normalizedStrategyId === STRATEGY_ID &&
    plannerPaperDecision === "FAST_INTRADAY_PAPER_ALLOW" &&
    paper?.allowed === true;

  const isPaperTradeAllowedDecision =
    paper?.allowed === true &&
    ["PAPER_ALLOW", "FAST_INTRADAY_PAPER_ALLOW"].includes(plannerPaperDecision);

  const engineContext = buildEngineContext({
    engine22WaveStrategy,
    confluence,
    engine15Decision,
    permission,
    engine25Context,
  });

  const engine26ImbalanceWatch = buildEngine26ImbalanceWatch({
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    tf: normalizedTf,
    permission,
    engine22WaveStrategy,
    confluence,
    engine15Decision,
  });

  let engine26StructuralContext =
    buildEngine26StructuralContext(engine26ImbalanceWatch);

  const dailyCandleContext = buildEngine26DailyCandleContext({
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    dailyBars,
    engine26StructuralContext,
  });

  const locationContext = buildEngine26LocationContext({
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    tf: normalizedTf,
    engine26ImbalanceWatch,
    engine26StructuralContext,
    confluence,
  });

  const controlLevelContext = buildEngine26ControlLevelContext({
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    tf: normalizedTf,
    engine26StructuralContext,
    locationContext,
    confluence,
  });

  if (engine26StructuralContext && typeof engine26StructuralContext === "object") {
    engine26StructuralContext = {
      ...engine26StructuralContext,
      dailyCandleContext,
      locationContext,
      controlLevelContext,
      reasonCodes: [
        ...(Array.isArray(engine26StructuralContext.reasonCodes)
          ? engine26StructuralContext.reasonCodes
          : []),
        ...(Array.isArray(dailyCandleContext?.reasonCodes)
          ? dailyCandleContext.reasonCodes
          : []),
        ...(Array.isArray(locationContext?.reasonCodes)
          ? locationContext.reasonCodes
          : []),
         ...(Array.isArray(controlLevelContext?.reasonCodes)
          ? controlLevelContext.reasonCodes
          : []),
      ].filter(Boolean),
    };
  }        

  const engine26TradePlanPreview = buildEngine26TradePlanPreview({
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    tf: normalizedTf,
    permission,
    engine22WaveStrategy,
    engine25Context,
    confluence,
    engine15Decision,
    engine26ImbalanceWatch,
    engine26StructuralContext,
    dailyCandleContext,
    locationContext,
    controlLevelContext,
  });

  const engine26PaperTrialCandidate =
    engine26TradePlanPreview?.paperTrialCandidate || null;

  const blockers = [];
  const warnings = [];
  const reasonCodes = [
    "PAPER_ONLY_RESEARCH_LANE",
    "ENGINE26_PLANNER_ONLY_V1",
    "NO_ENGINE8_CALL_IN_SNAPSHOT_BUILD",
    "NO_REAL_EXECUTION",
  ];

  if (isFastIntradayPaperAllow) {
  reasonCodes.push("ENGINE26_CONSUMED_FAST_INTRADAY_PAPER_ALLOW");
  reasonCodes.push("ENGINE15_NOT_REQUIRED_FOR_FAST_INTRADAY_PAPER");
  reasonCodes.push("ENGINE8_NOT_CALLED_PLANNER_ONLY");
  reasonCodes.push("PAPER_TICKET_ONLY_NO_REAL_EXECUTION");
}

  if (normalizedSymbol !== SYMBOL) blockers.push("SYMBOL_NOT_ES");
  if (normalizedStrategyId !== STRATEGY_ID) {
    blockers.push("STRATEGY_NOT_INTRADAY_SCALP_10M");
  }

if (!paper || typeof paper !== "object") {
  blockers.push("MISSING_PERMISSION_PAPER");
} else {
  if (paper.allowed !== true) blockers.push("PAPER_PERMISSION_NOT_ALLOWED");
  if (paper.mode !== MODE) blockers.push("PAPER_PERMISSION_NOT_PAPER_ONLY");

  if (!isPaperTradeAllowedDecision) {
    if (paper.decision === "PAPER_REDUCE") {
      warnings.push("PAPER_REDUCE_NO_TICKET_IN_V1");
    }
    blockers.push("PAPER_PERMISSION_NOT_ALLOWED");
  }

  if (paper.realExecutionAllowed !== false) {
    blockers.push("PAPER_PERMISSION_REAL_EXECUTION_TRUE");
  }
  if (paper.requiresEngine8Paper !== true) {
    blockers.push("PAPER_PERMISSION_MISSING_ENGINE8_REQUIREMENT");
  }
  if (paper.requiresEngine10Journal !== true) {
    blockers.push("PAPER_PERMISSION_MISSING_ENGINE10_REQUIREMENT");
  }
}

  if (!engine22WaveStrategy?.currentLifecycleState) {
    blockers.push("MISSING_ENGINE22_CONTEXT");
  }

if (!engine15Decision?.paperScalpReadiness && !isFastIntradayPaperAllow) {
  blockers.push("MISSING_ENGINE15_PAPER_READINESS");
}

if (!engine15Decision?.paperScalpReadiness && isFastIntradayPaperAllow) {
  warnings.push("ENGINE15_BYPASSED_FOR_FAST_INTRADAY_PAPER");
}

  const direction = getDirection({
    permission,
    engine15Decision,
    engine22WaveStrategy,
  });

  const setupType = getSetupType({
    permission,
    engine15Decision,
    engine22WaveStrategy,
  });

  if (!direction || direction === "NONE") blockers.push("DIRECTION_NONE");

  const paperShortResearchEnabled =
    paper?.paperShortResearchEnabled === true || paper?.paperShortAllowed === true;

  if (direction === "SHORT" && !paperShortResearchEnabled) {
    blockers.push("PAPER_SHORTS_DISABLED");
  }

  const currentPrice = getCurrentPrice({
    permission,
    engine15Decision,
    engine22WaveStrategy,
    confluence,
  });

  const entryPrice = roundToTick(currentPrice);

  if (entryPrice == null) blockers.push("MISSING_CURRENT_PRICE");

  const stopPrice = getStopPrice({
    direction,
    engine15Decision,
    confluence,
    engine25Context,
  });

  if (stopPrice == null) blockers.push("NO_DEFINED_STOP_OR_INVALIDATION");

  const targetPrice = getTargetPrice({
    direction,
    entryPrice,
    engine15Decision,
    permission,
    engine22WaveStrategy,
    engine25Context,
  });

  const cleanTargetPath = hasCleanTargetPath({
    direction,
    entryPrice,
    targetPrice,
    engine15Decision,
  });

  if (!cleanTargetPath) blockers.push("NO_CLEAN_PATH_TO_TARGET");

  const zoneId = getZoneId({
    engine25Context,
    confluence,
    engine22WaveStrategy,
  });

  const duplicateOpen = isDuplicateOpenTrade({
    openPaperTrades,
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    direction,
    setupType,
    zoneId,
  });

  if (duplicateOpen) blockers.push("DUPLICATE_PAPER_TRADE_OPEN");

  const allowlist = getEngine8Allowlist();

  if (!allowlist.includes(normalizedSymbol) && !isFastIntradayPaperAllow) {
    blockers.push("ENGINE8_ES_NOT_ALLOWLISTED");
  }

  if (!allowlist.includes(normalizedSymbol) && isFastIntradayPaperAllow) {
    warnings.push("ENGINE8_ALLOWLIST_BYPASSED_FOR_PLANNER_ONLY_FAST_INTRADAY_PAPER");
  }

  const hasContractMismatch =
    paper?.decision === "PAPER_ALLOW" &&
    blockers.some((code) =>
      [
        "PAPER_PERMISSION_REAL_EXECUTION_TRUE",
        "PAPER_PERMISSION_MISSING_ENGINE8_REQUIREMENT",
        "PAPER_PERMISSION_MISSING_ENGINE10_REQUIREMENT",
        "MISSING_ENGINE22_CONTEXT",
        "MISSING_ENGINE15_PAPER_READINESS",
        "NO_DEFINED_STOP_OR_INVALIDATION",
        "NO_CLEAN_PATH_TO_TARGET",
        "MISSING_CURRENT_PRICE",
      ].includes(code)
    );

  if (hasContractMismatch) {
    blockers.push("CONTRACT_MISMATCH");
  }

  const baseContext = {
    setupType,
    direction,
    engineContext,
  };

  if (blockers.length) {
    const status = blockers.includes("ENGINE8_ES_NOT_ALLOWLISTED")
      ? "BLOCKED_ENGINE8_ES_NOT_ALLOWLISTED"
      : "NO_PAPER_TRADE";

    return {
      engine26ImbalanceWatch,
      engine26StructuralContext,
      engine26TradePlanPreview,
      engine26PaperTrialCandidate,
      engine26PaperTradePlan: makeNoTrade({
        symbol: normalizedSymbol,
        strategyId: normalizedStrategyId,
        tf: normalizedTf,
        status,
        blockers,
        warnings,
        reasonCodes: [...reasonCodes, ...blockers],
        context: baseContext,
      }),
      engine26PaperTradeTicket: null,
      engine26PaperTradeExecution: null,
    };
  }

  const sizing = buildSizing();
  const paperExitPlan = buildPaperExitPlan({
    direction,
    entryPrice,
  });

  const barTime = getBarTime({ confluence });

  const idempotencyKey = buildIdempotencyKey({
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    direction,
    setupType,
    zoneId,
    barTime,
  });

  const targetPoints =
    direction === "SHORT"
      ? roundPts(entryPrice - targetPrice)
      : roundPts(targetPrice - entryPrice);

  const stopDistancePts =
    direction === "SHORT"
      ? roundPts(stopPrice - entryPrice)
      : roundPts(entryPrice - stopPrice);

  const ticket = {
    idempotencyKey,
    paper: true,
    mode: MODE,

    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    timeframe: normalizedTf,

    assetType: "FUTURE",
    intent: "ENTRY",
    action: "NEW_ENTRY",
    side: direction === "LONG" ? "BUY" : "SELL_SHORT",
    direction,
    qty: sizing.qty,

    entry: {
      price: entryPrice,
      intendedMidpoint: entryPrice,
    },

    stop: {
      price: stopPrice,
      reason: "Engine 26 paper scalp invalidation / stop level.",
    },

    takeProfit: {
      price: targetPrice,
      reason: "10-point imbalance-to-imbalance target model.",
    },

    paperExitPlan,

    engine6: permission,
    engine7: sizing,

    signalEvent: {
      setupFamily: "IMBALANCE_TO_IMBALANCE_SCALP",
      setupType,
      zoneId,
      signalPrice: entryPrice,
      direction,
      source: ENGINE,
    },

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
  };

  const plan = {
    active: true,
    engine: ENGINE,
    mode: MODE,
    researchOnly: true,

    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    tf: normalizedTf,

    allowed: true,
    status: "READY_TO_PAPER_EXECUTE",

    setupFamily: "IMBALANCE_TO_IMBALANCE_SCALP",
    setupType,
    direction,

    currentPrice: entryPrice,
    entryPrice,
    entryTrigger: "ENGINE6_PAPER_PERMISSION_APPROVED",

    stopPrice,
    invalidationLevel: stopPrice,
    stopReason: "Engine 26 paper scalp invalidation / stop level.",
    stopDistancePts,

    targetPrice,
    targetPoints,
    exitModel: "THREE_BLOCKS",

    targets: {
      block1: paperExitPlan.block1,
      block2: paperExitPlan.block2,
      block3: paperExitPlan.block3,
    },

    paperExitPlan,
    sizing,

    zoneId,
    barTime,
    idempotencyKey,

    noRealExecution: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    requiresEngine8Paper: true,
    requiresEngine10Journal: true,

    engineContext,

    blockers: [],
    warnings,
    reasonCodes: [
      ...reasonCodes,
      "ENGINE6_PAPER_PERMISSION_APPROVED",
      "IMBALANCE_TO_IMBALANCE_SCALP",
      "THREE_BLOCK_EXIT_MODEL",
      "ENGINE7_PAPER_SIZING_V0",
      "ENGINE9_COMPATIBLE_EXIT_PLAN_V0",
    ],

    createdAt: nowIso(),
  };

  return {
   engine26ImbalanceWatch,
   engine26StructuralContext,
   engine26TradePlanPreview,
   engine26PaperTrialCandidate,
   engine26PaperTradePlan: plan,
   engine26PaperTradeTicket: ticket,
   engine26PaperTradeExecution: null,
  };
}
