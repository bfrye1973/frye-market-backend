// services/core/logic/engine3SpyReactionQualityTimeline.js

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(Number(x) || 0)));
}

function ema(values, length) {
  if (!values.length) return null;
  const k = 2 / (length + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
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

  const upperWick = high != null && close != null && open != null
    ? high - Math.max(open, close)
    : 0;

  const lowerWick = low != null && close != null && open != null
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

function qualityFromScore(score) {
  if (score >= 90) return "A_PLUS";
  if (score >= 75) return "CONFIRMED";
  if (score >= 60) return "GOOD";
  if (score >= 40) return "FAIR";
  return "WEAK";
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
      engine: "engine3.reactionQuality.timeline.v1",
      state: "NO_REACTION",
      quality: "WEAK",
      direction: "NEUTRAL",
      score: 0,
      maxScore: 100,
      confirmed: false,
      reactionState: "NO_REACTION",
      reactionQuality: "INSUFFICIENT_DATA",
      priceLocation: null,
      candleReaction: null,
      structureReaction: null,
      emaReaction: null,
      dipQuality: null,
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

  const insideBar =
    prev &&
    last.high <= prev.high &&
    last.low >= prev.low;

  const engulfing =
    prev &&
    ((last.green && prev.red && last.close > prev.open && last.open < prev.close) ||
      (last.red && prev.green && last.close < prev.open && last.open > prev.close));

  const bodyStrength =
    last.bodyPct >= 0.65 ? "STRONG" :
    last.bodyPct >= 0.45 ? "GOOD" :
    last.bodyPct >= 0.25 ? "FAIR" :
    "WEAK";

  const distanceFromEma10Pct =
    ema10 ? Math.abs(close - ema10) / close : 0;

  const controlledPullback =
    distanceFromEma10Pct <= 0.006 &&
    (ema10Held || ema20Held || reclaimingEma10 || reclaimingEma20);

  const extendedAwayFromEma = distanceFromEma10Pct >= 0.012;
  const chaseRisk = extendedAwayFromEma && aboveEma10 && aboveEma20;

  const reasonCodes = [];
  let score = 0;
  let direction = "NEUTRAL";
  let state = "NO_REACTION";
  let reactionState = "NO_REACTION";
  let reactionQuality = "NO_CLEAN_REACTION";

  if (last.green && last.closeNearHigh) {
    score += 12;
    reasonCodes.push("CLOSE_NEAR_HIGH");
  }

  if (last.bullishWick) {
    score += 10;
    reasonCodes.push("BULLISH_WICK");
  }

  if (ema10Held) {
    score += 12;
    reasonCodes.push("EMA10_HELD");
  }

  if (ema20Held) {
    score += 12;
    reasonCodes.push("EMA20_HOLDING");
  }

  if (reclaimingEma10) {
    score += 14;
    reasonCodes.push("EMA10_RECLAIMED");
  }

  if (reclaimingEma20) {
    score += 10;
    reasonCodes.push("EMA20_RECLAIMED");
  }

  if (higherLowHeld) {
    score += 12;
    reasonCodes.push("HIGHER_LOW_HELD");
  }

  if (failedBreakdown) {
    score += 14;
    reasonCodes.push("FAILED_BREAKDOWN");
  }

  if (controlledPullback) {
    score += 10;
    reasonCodes.push("CONTROLLED_PULLBACK");
  }

  if (engulfing) {
    score += 6;
    reasonCodes.push("ENGULFING_CANDLE");
  }

  const bearishWarning =
    ema10Lost ||
    ema20Lost ||
    failedBreakout ||
    (last.red && last.closeNearLow && resistanceRejected);

  if (bearishWarning) {
    score = Math.max(0, score - 25);
    direction = "SHORT";
    reasonCodes.push("BEARISH_REACTION_WARNING");
  } else if (score >= 40) {
    direction = "LONG";
  }

  if (failedBreakdown && score >= 60) {
    state = "FAILED_BREAKDOWN_REACTION";
    reactionState = "BULLISH_REACTION";
    reactionQuality = "CLEAN_DIP_REACTION";
    reasonCodes.unshift("BUYERS_ABSORBING_DIP");
  } else if ((reclaimingEma10 || reclaimingEma20) && score >= 60) {
    state = "EMA_RECLAIM_REACTION";
    reactionState = "BULLISH_REACTION";
    reactionQuality = "EMA_RECLAIM_DIP_REACTION";
  } else if ((ema10Held || ema20Held) && higherLowHeld && score >= 60) {
    state = "BUYERS_ABSORBING_DIP";
    reactionState = "BULLISH_REACTION";
    reactionQuality = "CLEAN_DIP_REACTION";
    reasonCodes.unshift("BUYERS_ABSORBING_DIP");
  } else if (aboveEma10 && aboveEma20 && score >= 60) {
    state = "BULLISH_CONTINUATION_REACTION";
    reactionState = "BULLISH_REACTION";
    reactionQuality = "CONTINUATION_REACTION";
  } else if (bearishWarning && failedBreakout) {
    state = "FAILED_BREAKOUT_REACTION";
    reactionState = "BEARISH_REACTION";
    reactionQuality = "SELLERS_ABSORBING_BOUNCE";
  } else if (bearishWarning) {
    state = "EMA_REJECTION_REACTION";
    reactionState = "BEARISH_REACTION";
    reactionQuality = "WEAK_LONG_REACTION";
  } else if (score < 40) {
    state = "WEAK_REACTION";
    reactionState = "WEAK_REACTION";
    reactionQuality = "NOT_ENOUGH_CONFIRMATION";
  }

  score = clamp(score);
  const quality = qualityFromScore(score);
  const confirmed = score >= 75;

  const now = new Date().toISOString();

  const message =
    state === "BUYERS_ABSORBING_DIP"
      ? "SPY reacted cleanly from a controlled dip. Buyers held EMA structure and higher low support."
      : state === "EMA_RECLAIM_REACTION"
        ? "SPY is showing an EMA reclaim reaction. Buyers are regaining short-term control."
        : state === "FAILED_BREAKDOWN_REACTION"
          ? "SPY failed a breakdown and reclaimed support. Buyers are absorbing the dip."
          : state === "BULLISH_CONTINUATION_REACTION"
            ? "SPY reaction supports bullish continuation above EMA10 and EMA20."
            : state === "FAILED_BREAKOUT_REACTION"
              ? "SPY failed a breakout attempt. Sellers are absorbing the bounce."
              : state === "EMA_REJECTION_REACTION"
                ? "SPY is showing EMA rejection risk. Long entries need caution."
                : "SPY reaction quality is not strong enough yet.";

  return {
    ok: true,
    symbol,
    tf,
    engine: "engine3.reactionQuality.timeline.v1",

    state,
    quality,
    direction,

    score,
    maxScore: 100,
    confirmed,

    reactionState,
    reactionQuality,

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

    reasonCodes: [...new Set(reasonCodes)],

    message,
    updatedAt: now,
    updatedAtUtc: now,
  };
}
