// services/core/logic/engine3SpyReactionQualityTimeline.js

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(Number(x) || 0)));
}

function avg(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function ema(values, length) {
  if (!values.length) return null;
  const k = 2 / (length + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

function qualityFromScore(score) {
  if (score >= 90) return "A_PLUS";
  if (score >= 75) return "CONFIRMED";
  if (score >= 60) return "GOOD";
  if (score >= 40) return "FAIR";
  return "WEAK";
}

function candleParts(bar) {
  const open = n(bar?.open ?? bar?.o);
  const high = n(bar?.high ?? bar?.h);
  const low = n(bar?.low ?? bar?.l);
  const close = n(bar?.close ?? bar?.c);
  const volume = n(bar?.volume ?? bar?.v);

  const range = high != null && low != null ? Math.max(0, high - low) : 0;
  const body = open != null && close != null ? Math.abs(close - open) : 0;
  const bodyPct = range > 0 ? body / range : 0;

  const upperWick =
    high != null && close != null && open != null
      ? high - Math.max(open, close)
      : 0;

  const lowerWick =
    low != null && close != null && open != null
      ? Math.min(open, close) - low
      : 0;

  return {
    open,
    high,
    low,
    close,
    volume,
    range,
    body,
    bodyPct,
    green: close > open,
    red: close < open,
    closeNearHigh: range > 0 ? (high - close) / range <= 0.25 : false,
    closeNearLow: range > 0 ? (close - low) / range <= 0.25 : false,
    bullishWick: range > 0 ? lowerWick / range >= 0.35 : false,
    bearishWick: range > 0 ? upperWick / range >= 0.35 : false,
  };
}

function computeImpulseIgnition({ bars = [] } = {}) {
  const recentBars = bars.slice(-40);
  const recent = recentBars.slice(-4);
  const prior = recentBars.slice(0, -4);

  if (recentBars.length < 24 || recent.length < 4) {
    return {
      active: false,
      direction: null,
      state: "NO_IMPULSE_IGNITION",
      score: 0,
      candlesInSequence: 0,
      reason: "Not enough candle history for impulse ignition detection.",
      evidence: ["INSUFFICIENT_CANDLES"],
    };
  }

  const avgRange20 = avg(prior.slice(-20).map((b) => b.range)) || 0;
  const avgVol20 = avg(prior.slice(-20).map((b) => b.volume));
  const burstVolAvg = avg(recent.map((b) => b.volume));
  const volumeExpansion =
    avgVol20 != null && burstVolAvg != null ? burstVolAvg >= avgVol20 * 1.35 : false;

  const highVolumeCandles =
    avgVol20 != null
      ? recent.filter((b) => Number.isFinite(b.volume) && b.volume >= avgVol20 * 1.5).length
      : 0;

  const greenCount = recent.filter((b) => b.green).length;
  const redCount = recent.filter((b) => b.red).length;

  const strongGreenCount = recent.filter(
    (b) =>
      b.green &&
      b.bodyPct >= 0.55 &&
      b.closeNearHigh &&
      (avgRange20 <= 0 || b.range >= avgRange20 * 1.1)
  ).length;

  const strongRedCount = recent.filter(
    (b) =>
      b.red &&
      b.bodyPct >= 0.55 &&
      b.closeNearLow &&
      (avgRange20 <= 0 || b.range >= avgRange20 * 1.1)
  ).length;

  const priorLow = Math.min(...prior.slice(-20).map((b) => b.low).filter(Number.isFinite));
  const priorHigh = Math.max(...prior.slice(-20).map((b) => b.high).filter(Number.isFinite));
  const recentLow = Math.min(...recent.map((b) => b.low).filter(Number.isFinite));
  const recentHigh = Math.max(...recent.map((b) => b.high).filter(Number.isFinite));

  const offRecentLow =
    Number.isFinite(priorLow) && recentLow <= priorLow + Math.max(avgRange20 * 1.5, 0.5);

  const offRecentHigh =
    Number.isFinite(priorHigh) && recentHigh >= priorHigh - Math.max(avgRange20 * 1.5, 0.5);

  const higherCloses =
    recent[3].close > recent[2].close && recent[2].close > recent[1].close;

  const lowerCloses =
    recent[3].close < recent[2].close && recent[2].close < recent[1].close;

  let longScore = 0;
  const longEvidence = [];

  if (greenCount >= 3) {
    longScore += 15;
    longEvidence.push("THREE_OF_LAST_FOUR_GREEN");
  }
  if (strongGreenCount >= 2) {
    longScore += 15;
    longEvidence.push("STRONG_GREEN_BODY_SEQUENCE");
  }
  if (recent.filter((b) => b.closeNearHigh).length >= 3) {
    longScore += 10;
    longEvidence.push("CLOSES_NEAR_HIGHS");
  }
  if (offRecentLow) {
    longScore += 15;
    longEvidence.push("OFF_RECENT_LOW");
  }
  if (volumeExpansion) {
    longScore += 15;
    longEvidence.push("VOLUME_EXPANSION_1_35X");
  }
  if (highVolumeCandles >= 2) {
    longScore += 10;
    longEvidence.push("TWO_HIGH_VOLUME_CANDLES_1_5X");
  }
  if (higherCloses) {
    longScore += 10;
    longEvidence.push("HIGHER_CLOSE_SEQUENCE");
  }

  let shortScore = 0;
  const shortEvidence = [];

  if (redCount >= 3) {
    shortScore += 15;
    shortEvidence.push("THREE_OF_LAST_FOUR_RED");
  }
  if (strongRedCount >= 2) {
    shortScore += 15;
    shortEvidence.push("STRONG_RED_BODY_SEQUENCE");
  }
  if (recent.filter((b) => b.closeNearLow).length >= 3) {
    shortScore += 10;
    shortEvidence.push("CLOSES_NEAR_LOWS");
  }
  if (offRecentHigh) {
    shortScore += 15;
    shortEvidence.push("OFF_RECENT_HIGH");
  }
  if (volumeExpansion) {
    shortScore += 15;
    shortEvidence.push("VOLUME_EXPANSION_1_35X");
  }
  if (highVolumeCandles >= 2) {
    shortScore += 10;
    shortEvidence.push("TWO_HIGH_VOLUME_CANDLES_1_5X");
  }
  if (lowerCloses) {
    shortScore += 10;
    shortEvidence.push("LOWER_CLOSE_SEQUENCE");
  }

  const direction = longScore >= shortScore ? "LONG" : "SHORT";
  const score = clamp(Math.max(longScore, shortScore));
  const active = score >= 80;

  return {
    active,
    direction,
    state: active
      ? direction === "LONG"
        ? "BULLISH_IMPULSE_IGNITION"
        : "BEARISH_IMPULSE_IGNITION"
      : "NO_IMPULSE_IGNITION",
    score,
    candlesInSequence: direction === "LONG" ? greenCount : redCount,
    reason: active
      ? direction === "LONG"
        ? "Strong green displacement candles formed with volume expansion off a reaction low."
        : "Strong red displacement candles formed with volume expansion off a reaction high."
      : "Impulse conditions are not strong enough yet.",
    evidence: direction === "LONG" ? longEvidence : shortEvidence,
    debug: {
      avgRange20,
      avgVol20,
      burstVolAvg,
      volumeExpansion,
      highVolumeCandles,
      greenCount,
      redCount,
      strongGreenCount,
      strongRedCount,
    },
  };
}

function computeReversalSetup({
  last,
  ema10,
  ema20,
  failedBreakdown,
  failedBreakout,
  higherLowHeld,
  lowerHighRejected,
  reclaimingEma10,
  reclaimingEma20,
  ema10Lost,
  ema20Lost,
  impulseIgnition,
}) {
  let bullScore = 0;
  const bullEvidence = [];

  if (failedBreakdown) {
    bullScore += 20;
    bullEvidence.push("FAILED_BREAKDOWN");
  }
  if (last.bullishWick) {
    bullScore += 12;
    bullEvidence.push("BULLISH_WICK");
  }
  if (last.closeNearHigh) {
    bullScore += 10;
    bullEvidence.push("CLOSE_NEAR_HIGH");
  }
  if (higherLowHeld) {
    bullScore += 12;
    bullEvidence.push("HIGHER_LOW_HELD");
  }
  if (reclaimingEma10) {
    bullScore += 14;
    bullEvidence.push("EMA10_RECLAIM");
  }
  if (reclaimingEma20) {
    bullScore += 12;
    bullEvidence.push("EMA20_RECLAIM");
  }
  if (last.close > ema10) {
    bullScore += 8;
    bullEvidence.push("ABOVE_EMA10");
  }
  if (last.close > ema20) {
    bullScore += 8;
    bullEvidence.push("ABOVE_EMA20");
  }
  if (impulseIgnition?.active && impulseIgnition.direction === "LONG") {
    bullScore += 20;
    bullEvidence.push("BULLISH_IMPULSE_IGNITION");
  }

  let bearScore = 0;
  const bearEvidence = [];

  if (failedBreakout) {
    bearScore += 20;
    bearEvidence.push("FAILED_BREAKOUT");
  }
  if (last.bearishWick) {
    bearScore += 12;
    bearEvidence.push("BEARISH_WICK");
  }
  if (last.closeNearLow) {
    bearScore += 10;
    bearEvidence.push("CLOSE_NEAR_LOW");
  }
  if (lowerHighRejected) {
    bearScore += 12;
    bearEvidence.push("LOWER_HIGH_REJECTED");
  }
  if (ema10Lost) {
    bearScore += 14;
    bearEvidence.push("EMA10_LOST");
  }
  if (ema20Lost) {
    bearScore += 12;
    bearEvidence.push("EMA20_LOST");
  }
  if (last.close < ema10) {
    bearScore += 8;
    bearEvidence.push("BELOW_EMA10");
  }
  if (last.close < ema20) {
    bearScore += 8;
    bearEvidence.push("BELOW_EMA20");
  }
  if (impulseIgnition?.active && impulseIgnition.direction === "SHORT") {
    bearScore += 20;
    bearEvidence.push("BEARISH_IMPULSE_IGNITION");
  }

  bullScore = clamp(bullScore);
  bearScore = clamp(bearScore);

  return {
    bullish: {
      active: bullScore >= 60,
      score: bullScore,
      state: bullScore >= 75 ? "BULLISH_REVERSAL_CONFIRMED" : bullScore >= 60 ? "BULLISH_REVERSAL_BUILDING" : "NO_BULLISH_REVERSAL",
      evidence: bullEvidence,
    },
    bearish: {
      active: bearScore >= 60,
      score: bearScore,
      state: bearScore >= 75 ? "BEARISH_REVERSAL_CONFIRMED" : bearScore >= 60 ? "BEARISH_REVERSAL_BUILDING" : "NO_BEARISH_REVERSAL",
      evidence: bearEvidence,
    },
    dominant:
      bullScore >= 60 && bullScore > bearScore
        ? "BULLISH"
        : bearScore >= 60 && bearScore > bullScore
          ? "BEARISH"
          : "NONE",
  };
}

export function computeEngine3SpyReactionQualityTimeline({
  symbol = "SPY",
  tf = "10m",
  candles = [],
} = {}) {
  const bars = candles.map(candleParts).filter((b) => b.close != null);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const closes = bars.map((b) => b.close);

  if (!last || bars.length < 30) {
    const now = new Date().toISOString();
    return {
      ok: true,
      symbol,
      tf,
      engine: "engine3.reactionQuality.timeline.v2",
      state: "NO_REACTION",
      quality: "WEAK",
      direction: "NEUTRAL",
      score: 0,
      maxScore: 100,
      confirmed: false,
      reactionState: "NO_REACTION",
      reactionQuality: "INSUFFICIENT_DATA",
      localReaction: null,
      contextAdjustedReaction: null,
      reversalSetup: null,
      impulseIgnition: null,
      reasonCodes: ["INSUFFICIENT_CANDLES"],
      message: "Not enough SPY candle history to score reaction quality.",
      updatedAt: now,
      updatedAtUtc: now,
    };
  }

  const ema10 = ema(closes.slice(-40), 10);
  const ema20 = ema(closes.slice(-50), 20);
  const close = last.close;

  const priorLows = bars.slice(-12, -1).map((b) => b.low).filter(Number.isFinite);
  const priorHighs = bars.slice(-12, -1).map((b) => b.high).filter(Number.isFinite);
  const recentLow = Math.min(...priorLows);
  const recentHigh = Math.max(...priorHighs);

  const aboveEma10 = close > ema10;
  const aboveEma20 = close > ema20;
  const belowEma10 = close < ema10;
  const belowEma20 = close < ema20;

  const reclaimingEma10 = prev?.close < ema10 && close > ema10;
  const reclaimingEma20 = prev?.close < ema20 && close > ema20;
  const ema10Held = last.low <= ema10 && close >= ema10;
  const ema20Held = last.low <= ema20 && close >= ema20;
  const ema10Lost = prev?.close > ema10 && close < ema10;
  const ema20Lost = prev?.close > ema20 && close < ema20;

  const higherLowHeld = Number.isFinite(recentLow) && last.low > recentLow;
  const lowerHighRejected = Number.isFinite(recentHigh) && last.high < recentHigh && last.red;

  const failedBreakdown = Number.isFinite(recentLow) && last.low < recentLow && close > recentLow;
  const failedBreakout = Number.isFinite(recentHigh) && last.high > recentHigh && close < recentHigh;

  const supportHeld = higherLowHeld || failedBreakdown || ema10Held || ema20Held;
  const resistanceRejected = lowerHighRejected || failedBreakout;

  const reversalCandle =
    (last.bullishWick && last.closeNearHigh && last.green) ||
    (last.bearishWick && last.closeNearLow && last.red);

  const insideBar = prev && last.high <= prev.high && last.low >= prev.low;

  const engulfing =
    prev &&
    ((last.green && prev.red && last.close > prev.open && last.open < prev.close) ||
      (last.red && prev.green && last.close < prev.open && last.open > prev.close));

  const bodyStrength =
    last.bodyPct >= 0.65 ? "STRONG" :
    last.bodyPct >= 0.45 ? "GOOD" :
    last.bodyPct >= 0.25 ? "FAIR" :
    "WEAK";

  const distanceFromEma10Pct = ema10 ? Math.abs(close - ema10) / close : 0;
  const controlledPullback =
    distanceFromEma10Pct <= 0.006 &&
    (ema10Held || ema20Held || reclaimingEma10 || reclaimingEma20);

  const extendedAwayFromEma = distanceFromEma10Pct >= 0.012;
  const chaseRisk = extendedAwayFromEma && aboveEma10 && aboveEma20;

  const impulseIgnition = computeImpulseIgnition({ bars });

  const reversalSetup = computeReversalSetup({
    last,
    ema10,
    ema20,
    failedBreakdown,
    failedBreakout,
    higherLowHeld,
    lowerHighRejected,
    reclaimingEma10,
    reclaimingEma20,
    ema10Lost,
    ema20Lost,
    impulseIgnition,
  });

  const reasonCodes = [];
  let rawScore = 0;
  let localState = "NO_REACTION";
  let localDirection = "NEUTRAL";
  let localReactionState = "NO_REACTION";
  let localReactionQuality = "NO_CLEAN_REACTION";

  if (last.green && last.closeNearHigh) {
    rawScore += 12;
    reasonCodes.push("CLOSE_NEAR_HIGH");
  }
  if (last.bullishWick) {
    rawScore += 10;
    reasonCodes.push("BULLISH_WICK");
  }
  if (ema10Held) {
    rawScore += 12;
    reasonCodes.push("EMA10_HELD");
  }
  if (ema20Held) {
    rawScore += 12;
    reasonCodes.push("EMA20_HOLDING");
  }
  if (reclaimingEma10) {
    rawScore += 14;
    reasonCodes.push("EMA10_RECLAIMED");
  }
  if (reclaimingEma20) {
    rawScore += 10;
    reasonCodes.push("EMA20_RECLAIMED");
  }
  if (higherLowHeld) {
    rawScore += 12;
    reasonCodes.push("HIGHER_LOW_HELD");
  }
  if (failedBreakdown) {
    rawScore += 14;
    reasonCodes.push("FAILED_BREAKDOWN");
  }
  if (controlledPullback) {
    rawScore += 10;
    reasonCodes.push("CONTROLLED_PULLBACK");
  }
  if (engulfing) {
    rawScore += 6;
    reasonCodes.push("ENGULFING_CANDLE");
  }

  const bearishWarning =
    ema10Lost ||
    ema20Lost ||
    failedBreakout ||
    (last.red && last.closeNearLow && resistanceRejected);

  if (bearishWarning) {
    rawScore = Math.max(0, rawScore - 15);
    reasonCodes.push("BEARISH_REACTION_WARNING");
    localDirection = "SHORT";
  } else if (rawScore >= 40) {
    localDirection = "LONG";
  }

  rawScore = clamp(rawScore);

  if (failedBreakdown && rawScore >= 60) {
    localState = "FAILED_BREAKDOWN_REACTION";
    localReactionState = "BULLISH_REACTION";
    localReactionQuality = "CLEAN_DIP_REACTION";
    reasonCodes.unshift("BUYERS_ABSORBING_DIP");
  } else if ((reclaimingEma10 || reclaimingEma20) && rawScore >= 60) {
    localState = "EMA_RECLAIM_REACTION";
    localReactionState = "BULLISH_REACTION";
    localReactionQuality = "EMA_RECLAIM_DIP_REACTION";
  } else if ((ema10Held || ema20Held) && higherLowHeld && rawScore >= 60) {
    localState = "BUYERS_ABSORBING_DIP";
    localReactionState = "BULLISH_REACTION";
    localReactionQuality = "CLEAN_DIP_REACTION";
    reasonCodes.unshift("BUYERS_ABSORBING_DIP");
  } else if (aboveEma10 && aboveEma20 && rawScore >= 60) {
    localState = "BULLISH_CONTINUATION_REACTION";
    localReactionState = "BULLISH_REACTION";
    localReactionQuality = "CONTINUATION_REACTION";
  } else if (bearishWarning && failedBreakout) {
    localState = "FAILED_BREAKOUT_REACTION";
    localReactionState = "BEARISH_REACTION";
    localReactionQuality = "SELLERS_ABSORBING_BOUNCE";
  } else if (bearishWarning && (ema10Lost || ema20Lost)) {
    localState = "EMA_REJECTION_REACTION";
    localReactionState = "BEARISH_REACTION";
    localReactionQuality = "WEAK_LONG_REACTION";
  } else if (rawScore < 40) {
    localState = "WEAK_REACTION";
    localReactionState = "WEAK_REACTION";
    localReactionQuality = "NOT_ENOUGH_CONFIRMATION";
  } else {
    localState = "WEAK_REACTION";
    localReactionState = "MIXED_REACTION";
    localReactionQuality = "MIXED_BUT_HOLDING_EMAS";
  }

  const localReaction = {
    state: localState,
    quality: qualityFromScore(rawScore),
    direction: localDirection,
    score: rawScore,
    reactionState: localReactionState,
    reactionQuality: localReactionQuality,
  };

  const bullishStructureIntact = aboveEma10 && aboveEma20 && higherLowHeld;
  const priceNearRecentHigh =
    Number.isFinite(recentHigh) && close >= recentHigh - Math.max((recentHigh - recentLow) * 0.25, 0.25);

  let finalState = localState;
  let finalDirection = localDirection;
  let finalScore = rawScore;
  let finalReactionState = localReactionState;
  let finalReactionQuality = localReactionQuality;
  const adjustedReasons = [...reasonCodes];

  if (localDirection === "SHORT" && bullishStructureIntact && priceNearRecentHigh) {
    finalState = "BULLISH_CONTINUATION_PAUSE";
    finalDirection = "NEUTRAL_TO_LONG";
    finalScore = Math.max(rawScore, 60);
    finalReactionState = "LOCAL_REJECTION_WITH_BULLISH_STRUCTURE_INTACT";
    finalReactionQuality = "CAUTION_NOT_REVERSAL";
    adjustedReasons.push(
      "ABOVE_EMA10",
      "ABOVE_EMA20",
      "HIGHER_LOW_HELD",
      "NEAR_RECENT_HIGH",
      "BEARISH_REACTION_MODERATED_BY_CONTEXT"
    );
  }

  if (impulseIgnition.active && impulseIgnition.direction === "LONG") {
    finalState = "BULLISH_IMPULSE_IGNITION";
    finalDirection = "LONG";
    finalScore = Math.max(finalScore, impulseIgnition.score);
    finalReactionState = "BULLISH_REACTION";
    finalReactionQuality = "ACTIVE_IMPULSE_IGNITION";
    adjustedReasons.push("BULLISH_IMPULSE_IGNITION");
  }

  if (impulseIgnition.active && impulseIgnition.direction === "SHORT") {
    finalState = "BEARISH_IMPULSE_IGNITION";
    finalDirection = "SHORT";
    finalScore = Math.max(finalScore, impulseIgnition.score);
    finalReactionState = "BEARISH_REACTION";
    finalReactionQuality = "ACTIVE_IMPULSE_IGNITION";
    adjustedReasons.push("BEARISH_IMPULSE_IGNITION");
  }

  finalScore = clamp(finalScore);
  const finalQuality = qualityFromScore(finalScore);
  const confirmed = finalScore >= 75;

  const contextAdjustedReaction = {
    state: finalState,
    quality: finalQuality,
    direction: finalDirection,
    score: finalScore,
    reactionState: finalReactionState,
    reactionQuality: finalReactionQuality,
    reason:
      finalState === "BULLISH_CONTINUATION_PAUSE"
        ? "Local bearish reaction detected, but SPY remains above EMA10/EMA20 with higher-low structure intact."
        : "Context-adjusted reaction matches the local reaction.",
  };

  const now = new Date().toISOString();

  const message =
    finalState === "BULLISH_CONTINUATION_PAUSE"
      ? "SPY showed local hesitation near highs, but bullish EMA and higher-low structure remain intact. Treat as a continuation pause, not a confirmed bearish reversal."
      : finalState === "BULLISH_IMPULSE_IGNITION"
        ? "SPY is showing bullish impulse ignition. A new impulse leg may be starting; watch for Wave 2 pullback or Wave 4 hold."
        : finalState === "BEARISH_IMPULSE_IGNITION"
          ? "SPY is showing bearish impulse ignition. A downside impulse leg may be starting; watch for bounce failure."
          : finalState === "BUYERS_ABSORBING_DIP"
            ? "SPY reacted cleanly from a controlled dip. Buyers held EMA structure and higher low support."
            : finalState === "EMA_RECLAIM_REACTION"
              ? "SPY is showing an EMA reclaim reaction. Buyers are regaining short-term control."
              : finalState === "FAILED_BREAKDOWN_REACTION"
                ? "SPY failed a breakdown and reclaimed support. Buyers are absorbing the dip."
                : finalState === "BULLISH_CONTINUATION_REACTION"
                  ? "SPY reaction supports bullish continuation above EMA10 and EMA20."
                  : finalState === "FAILED_BREAKOUT_REACTION"
                    ? "SPY failed a breakout attempt. Sellers are absorbing the bounce."
                    : finalState === "EMA_REJECTION_REACTION"
                      ? "SPY is showing EMA rejection risk. Long entries need caution."
                      : "SPY reaction quality is not strong enough yet.";

  return {
    ok: true,
    symbol,
    tf,
    engine: "engine3.reactionQuality.timeline.v2",

    state: finalState,
    quality: finalQuality,
    direction: finalDirection,

    score: finalScore,
    maxScore: 100,
    confirmed,

    reactionState: finalReactionState,
    reactionQuality: finalReactionQuality,

    localReaction,
    contextAdjustedReaction,
    reversalSetup,
    impulseIgnition,

    priceLocation: {
      close,
      ema10,
      ema20,
      aboveEma10,
      aboveEma20,
      reclaimingEma10,
      reclaimingEma20,
      belowEma10,
      belowEma20,
      priceNearRecentHigh,
    },

    candleReaction: {
      bullishWick: last.bullishWick,
      bearishWick: last.bearishWick,
      closeNearHigh: last.closeNearHigh,
      closeNearLow: last.closeNearLow,
      bodyStrength,
      reversalCandle,
      insideBar,
      engulfing,
    },

    structureReaction: {
      higherLowHeld,
      lowerHighRejected,
      failedBreakdown,
      failedBreakout,
      supportHeld,
      resistanceRejected,
    },

    emaReaction: {
      ema10Held,
      ema20Held,
      ema10Reclaimed: reclaimingEma10,
      ema20Reclaimed: reclaimingEma20,
      ema10Lost,
      ema20Lost,
    },

    dipQuality: {
      active: controlledPullback,
      type: controlledPullback ? "CONTROLLED_PULLBACK" : "NO_CLEAN_DIP",
      depth: extendedAwayFromEma ? "EXTENDED" : "NORMAL",
      extendedAwayFromEma,
      chaseRisk,
    },

    reasonCodes: [...new Set(adjustedReasons)],
    message,
    updatedAt: now,
    updatedAtUtc: now,
  };
}
