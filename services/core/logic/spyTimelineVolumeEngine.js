// services/core/logic/spyTimelineVolumeEngine.js

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function avg(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function candleBody(bar) {
  return Math.abs(num(bar.close) - num(bar.open));
}

function candleRange(bar) {
  return Math.max(0, num(bar.high) - num(bar.low));
}

function bodyPct(bar) {
  const range = candleRange(bar);
  if (!range) return 0;
  return candleBody(bar) / range;
}

function ema(values, length) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < length) return null;

  const k = 2 / (length + 1);
  let current = avg(clean.slice(0, length));

  for (let i = length; i < clean.length; i++) {
    current = clean[i] * k + current * (1 - k);
  }

  return current;
}

function computeVolumeTrend(impulseWindow) {
  if (!impulseWindow.length || impulseWindow.length < 3) return "UNKNOWN";

  const vols = impulseWindow.map((b) => num(b.volume));
  const firstHalf = avg(vols.slice(0, 2));
  const secondHalf = avg(vols.slice(-2));

  if (secondHalf >= firstHalf * 1.15) return "EXPANDING";
  if (secondHalf <= firstHalf * 0.85) return "FADING";
  return "STABLE";
}

function latestCandleDirection(bar) {
  if (!bar) return "UNKNOWN";
  if (num(bar.close) > num(bar.open)) return "GREEN";
  if (num(bar.close) < num(bar.open)) return "RED";
  return "FLAT";
}

function inferDirection({
  participationState,
  volumeTrend,
  greenCandles,
  redCandles,
  aboveEma10,
  aboveEma20,
  belowEma10,
  belowEma20,
  priceNearRecentHigh,
  priceNearRecentLow,
  priceDisplacementStrong,
}) {
  if (
    participationState === "HIGH_LEVEL_GRIND" ||
    participationState === "AUCTIONING_NEAR_HIGH"
  ) {
    return "NEUTRAL";
  }

  if (
    priceNearRecentHigh &&
    volumeTrend === "FADING" &&
    aboveEma10 &&
    aboveEma20
  ) {
    return "NEUTRAL";
  }

  if (
    greenCandles >= 3 &&
    aboveEma10 &&
    aboveEma20 &&
    priceDisplacementStrong
  ) {
    return "LONG";
  }

  if (
    redCandles >= 3 &&
    belowEma10 &&
    belowEma20 &&
    priceDisplacementStrong
  ) {
    return "SHORT";
  }

  if (
    redCandles >= 2 &&
    belowEma10 &&
    volumeTrend === "EXPANDING" &&
    priceDisplacementStrong
  ) {
    return "SHORT";
  }

  if (
    greenCandles >= 2 &&
    aboveEma10 &&
    volumeTrend === "EXPANDING" &&
    priceDisplacementStrong
  ) {
    return "LONG";
  }

  if (priceNearRecentLow && volumeTrend === "FADING") {
    return "NEUTRAL";
  }

  return "NEUTRAL";
}

function scoreVolume({
  relativeVolume,
  highVolumeCandles,
  volumeTrend,
  priceDisplacementStrong,
  aboveEma10,
  aboveEma20,
  belowEma10,
  belowEma20,
  priceNearRecentHigh,
  priceNearRecentLow,
}) {
  let score = 0;

  if (relativeVolume >= 1.05) score += 2;
  if (relativeVolume >= 1.25) score += 3;
  if (relativeVolume >= 1.5) score += 2;

  if (highVolumeCandles >= 1) score += 2;
  if (highVolumeCandles >= 2) score += 3;

  if (volumeTrend === "EXPANDING") score += 2;
  if (priceDisplacementStrong) score += 1;

  if ((aboveEma10 && aboveEma20) || (belowEma10 && belowEma20)) score += 1;

  if (priceNearRecentHigh || priceNearRecentLow) score += 1;

  return Math.max(0, Math.min(15, score));
}

function psychLevelContext(close) {
  if (!Number.isFinite(close)) {
    return {
      nearPsychLevel: false,
      psychLevel: null,
      distanceToPsychLevelPct: null,
    };
  }

  // SPY uses $5 levels as useful psychological/option magnet areas.
  const psychLevel = Math.round(close / 5) * 5;
  const distanceToPsychLevelPct = Math.abs(close - psychLevel) / close * 100;

  return {
    nearPsychLevel: distanceToPsychLevelPct <= 0.15,
    psychLevel,
    distanceToPsychLevelPct: round2(distanceToPsychLevelPct),
  };
}

function buildMessage({
  participationState,
  state,
  score,
  relativeVolume,
  volumeTrend,
  confirmed,
  priceNearRecentHigh,
  priceNearRecentLow,
  aboveEma10,
  aboveEma20,
  belowEma10,
  belowEma20,
}) {
  if (participationState === "RANGE_COMPRESSION") {
  if (belowEma10 && belowEma20) {
    return "Heavy volume is active inside a tight range, but price is below EMA10/EMA20. Watch for reclaim or downside expansion.";
  }

  if (aboveEma10 && aboveEma20) {
    return "Heavy volume is active inside a tight range while price holds above EMA10/EMA20. Watch for breakout expansion.";
  }

  return "Heavy volume is active inside a tight range. This is a decision zone; wait for range break or EMA reclaim/failure.";
}
  
  if (participationState === "HIGH_LEVEL_GRIND") {
    return "Participation is expanding, but price is grinding near highs. Wait for breakout re-expansion or EMA failure.";
  }

  if (participationState === "AUCTIONING_NEAR_HIGH") {
    return "SPY is auctioning near recent highs with active participation. Do not short from fading volume alone; wait for breakout or rejection.";
  }

  if (participationState === "BREAKOUT_EXPANSION") {
    return "Participation is expanding with upside displacement. Breakout pressure is active.";
  }

  if (participationState === "BREAKDOWN_EXPANSION") {
    return "Participation is expanding with downside displacement. Breakdown pressure is active.";
  }

  if (participationState === "DISTRIBUTION_WARNING") {
    return "Volume is active near highs but price is not making clean upside progress. Watch for failed breakout or EMA loss.";
  }

  if (participationState === "ACCUMULATION_WARNING") {
    return "Volume is active near lows but sellers are not making clean downside progress. Watch for reclaim.";
  }

  if (state === "EXPANDING" && !confirmed) {
    return `Participation is expanding with ${relativeVolume}x relative volume, but impulse confirmation is incomplete. Watch for continuation or failure.`;
  }

  if (state === "QUIET") {
    return "Participation is quiet. Engine 22 should avoid reading too much into the move until volume expands.";
  }

  if (aboveEma10 && aboveEma20) {
    return "Participation is normal while price remains above EMA10/EMA20.";
  }

  if (belowEma10 && belowEma20) {
    return "Participation is normal while price is below EMA10/EMA20.";
  }

  return "Participation is normal. Wait for volume expansion or price confirmation.";
}

export function computeSpyTimelineVolume({
  symbol = "SPY",
  tf = "10m",
  bars = [],
} = {}) {
  const cleanBars = Array.isArray(bars)
    ? bars
        .filter(
          (b) =>
            b &&
            Number.isFinite(Number(b.close)) &&
            Number.isFinite(Number(b.volume))
        )
        .map((b) => ({
          time: b.time,
          open: num(b.open),
          high: num(b.high),
          low: num(b.low),
          close: num(b.close),
          volume: num(b.volume),
        }))
    : [];

  const updatedAt = new Date().toISOString();

  if (cleanBars.length < 60) {
    return {
      ok: false,
      symbol,
      tf,
      state: "QUIET",
      quality: "INSUFFICIENT_DATA",
      direction: "NEUTRAL",
      score: 0,
      maxScore: 15,
      confirmed: false,
      relativeVolume: 0,
      volumeTrend: "UNKNOWN",
      participationState: "QUIET",
      participationQuality: "INSUFFICIENT_DATA",
      priceNearRecentHigh: false,
      priceNearRecentLow: false,
      reasonCodes: ["INSUFFICIENT_BARS"],
      message: "Need at least 60 SPY candles for Engine 4 timeline volume context.",
      updatedAt,
      debug: {
        barsReceived: cleanBars.length,
        requiredBars: 60,
      },
    };
  }

  const closes = cleanBars.map((b) => b.close);
  const latest = cleanBars[cleanBars.length - 1];

  const prior20 = cleanBars.slice(-24, -4);
  const impulseWindow = cleanBars.slice(-4);
  const recent50 = cleanBars.slice(-50);

  const avgVol20 = avg(prior20.map((b) => b.volume));
  const burstVolAvg = avg(impulseWindow.map((b) => b.volume));
  const relativeVolume = avgVol20 > 0 ? burstVolAvg / avgVol20 : 0;

  const highVolumeCandles = impulseWindow.filter(
    (b) => b.volume >= avgVol20 * 1.5
  ).length;

  const burstCandles = impulseWindow.length;
  const greenCandles = impulseWindow.filter((b) => b.close > b.open).length;
  const redCandles = impulseWindow.filter((b) => b.close < b.open).length;

  const volumeTrend = computeVolumeTrend(impulseWindow);

  const avgRange20 = avg(prior20.map(candleRange));
  const burstRangeAvg = avg(impulseWindow.map(candleRange));
  const priceDisplacementValue =
    avgRange20 > 0 ? burstRangeAvg / avgRange20 : 0;

  const priceDisplacementStrong = priceDisplacementValue >= 1.05;

  const ema10 = ema(closes, 10);
  const ema20 = ema(closes, 20);

  const close = latest.close;
  const aboveEma10 = ema10 !== null ? close >= ema10 : false;
  const aboveEma20 = ema20 !== null ? close >= ema20 : false;
  const belowEma10 = ema10 !== null ? close < ema10 : false;
  const belowEma20 = ema20 !== null ? close < ema20 : false;

  const recentHigh50 = Math.max(...recent50.map((b) => b.high));
  const recentLow50 = Math.min(...recent50.map((b) => b.low));

  const distanceToRecentHighPct =
    close > 0 ? Math.abs(recentHigh50 - close) / close * 100 : 999;

  const distanceToRecentLowPct =
    close > 0 ? Math.abs(close - recentLow50) / close * 100 : 999;

  const rawPriceNearRecentHigh = distanceToRecentHighPct <= 0.25;
  const rawPriceNearRecentLow = distanceToRecentLowPct <= 0.25;

  // If SPY is close to both the 50-bar high and low, the range is compressed.
  // Engine 22 should not see both high and low as active directional context.
  const rangeCompression =
    rawPriceNearRecentHigh &&
    rawPriceNearRecentLow &&
    recentHigh50 > recentLow50 &&
    ((recentHigh50 - recentLow50) / close) * 100 <= 0.45;

  const priceNearRecentHigh =
    rawPriceNearRecentHigh &&
    (!rawPriceNearRecentLow || distanceToRecentHighPct < distanceToRecentLowPct) &&
    !rangeCompression;

  const priceNearRecentLow =
    rawPriceNearRecentLow &&
    (!rawPriceNearRecentHigh || distanceToRecentLowPct < distanceToRecentHighPct) &&
    !rangeCompression;

  const psych = psychLevelContext(close);

  const volumeExpansion = burstVolAvg >= avgVol20 * 1.35;

  let state = "NORMAL";
  if (relativeVolume < 0.85) state = "QUIET";
  if (volumeExpansion || relativeVolume >= 1.25) state = "EXPANDING";

  let participationState = state;
  let participationQuality = state === "EXPANDING" ? "EXPANDING" : "NORMAL";

  const confirmed =
    volumeExpansion &&
    highVolumeCandles >= 2 &&
    volumeTrend === "EXPANDING" &&
    priceDisplacementStrong;
  
  if (
  rangeCompression &&
  state === "EXPANDING" &&
  relativeVolume >= 1.25
) {
  participationState = "RANGE_COMPRESSION";
  participationQuality = belowEma10 && belowEma20 ? "EMA_FAILURE_WATCH" : "DECISION_ZONE";
} else if (
  priceNearRecentHigh &&
  state === "EXPANDING" &&
  relativeVolume >= 1.25 &&
  volumeTrend === "FADING" &&
  aboveEma10 &&
  aboveEma20
) {
    participationState = "HIGH_LEVEL_GRIND";
    participationQuality = "CONTROLLED_EXPANSION";
  } else if (
    priceNearRecentHigh &&
    state === "EXPANDING" &&
    aboveEma10 &&
    aboveEma20
  ) {
    participationState = "AUCTIONING_NEAR_HIGH";
    participationQuality = "CONTROLLED_EXPANSION";
  } else if (
    confirmed &&
    greenCandles >= 2 &&
    aboveEma10 &&
    aboveEma20
  ) {
    participationState = "BREAKOUT_EXPANSION";
    participationQuality = "CONFIRMED_EXPANSION";
  } else if (
    confirmed &&
    redCandles >= 2 &&
    belowEma10 &&
    belowEma20
  ) {
    participationState = "BREAKDOWN_EXPANSION";
    participationQuality = "CONFIRMED_EXPANSION";
  } else if (
    priceNearRecentHigh &&
    redCandles >= 2 &&
    volumeTrend === "EXPANDING" &&
    !priceDisplacementStrong
  ) {
    participationState = "DISTRIBUTION_WARNING";
    participationQuality = "WARNING";
  } else if (
    priceNearRecentLow &&
    greenCandles >= 2 &&
    volumeTrend === "EXPANDING" &&
    !priceDisplacementStrong
  ) {
    participationState = "ACCUMULATION_WARNING";
    participationQuality = "WARNING";
  }

  const score = scoreVolume({
    relativeVolume,
    highVolumeCandles,
    volumeTrend,
    priceDisplacementStrong,
    aboveEma10,
    aboveEma20,
    belowEma10,
    belowEma20,
    priceNearRecentHigh,
    priceNearRecentLow,
  });

  const direction = inferDirection({
    participationState,
    volumeTrend,
    greenCandles,
    redCandles,
    aboveEma10,
    aboveEma20,
    belowEma10,
    belowEma20,
    priceNearRecentHigh,
    priceNearRecentLow,
    priceDisplacementStrong,
  });

  const quality =
    confirmed || score >= 12
      ? "CONFIRMED"
      : score >= 9
        ? "EXPANDING"
        : score >= 5
          ? "NORMAL"
          : "QUIET";

  const reasonCodes = [];

  if (volumeExpansion) reasonCodes.push("BURST_VOLUME_ABOVE_1_35_AVG");
  if (highVolumeCandles >= 2) reasonCodes.push("TWO_OR_MORE_HIGH_VOLUME_CANDLES");
  if (volumeTrend === "EXPANDING") reasonCodes.push("VOLUME_EXPANDING_IN_BURST_WINDOW");
  if (volumeTrend === "FADING") reasonCodes.push("VOLUME_FADING_IN_BURST_WINDOW");

  if (priceDisplacementStrong) reasonCodes.push("PRICE_DISPLACEMENT_STRONG");
  else reasonCodes.push("PRICE_DISPLACEMENT_WEAK");

  if (priceNearRecentHigh) reasonCodes.push("PRICE_NEAR_RECENT_HIGH");
  if (priceNearRecentLow) reasonCodes.push("PRICE_NEAR_RECENT_LOW");
  if (rangeCompression) reasonCodes.push("RANGE_COMPRESSION");
  
  if (aboveEma10) reasonCodes.push("ABOVE_EMA10");
  if (aboveEma20) reasonCodes.push("ABOVE_EMA20");
  if (belowEma10) reasonCodes.push("BELOW_EMA10");
  if (belowEma20) reasonCodes.push("BELOW_EMA20");

  if (participationState === "RANGE_COMPRESSION") reasonCodes.push("RANGE_COMPRESSION_VOLUME_EXPANSION");
  if (participationState === "HIGH_LEVEL_GRIND") reasonCodes.push("HIGH_LEVEL_GRIND");
  if (participationState === "AUCTIONING_NEAR_HIGH") reasonCodes.push("AUCTIONING_NEAR_HIGH");
  if (participationState === "BREAKOUT_EXPANSION") reasonCodes.push("BREAKOUT_EXPANSION");
  if (participationState === "BREAKDOWN_EXPANSION") reasonCodes.push("BREAKDOWN_EXPANSION");
  if (participationState === "DISTRIBUTION_WARNING") reasonCodes.push("DISTRIBUTION_WARNING");
  if (participationState === "ACCUMULATION_WARNING") reasonCodes.push("ACCUMULATION_WARNING");

  const message = buildMessage({
    participationState,
    state,
    score,
    relativeVolume: round2(relativeVolume),
    volumeTrend,
    confirmed,
    priceNearRecentHigh,
    priceNearRecentLow,
    aboveEma10,
    aboveEma20,
    belowEma10,
    belowEma20,
  });

  return {
    ok: true,
    symbol,
    tf,

    state,
    quality,
    direction,

    score,
    maxScore: 15,
    confirmed,

    relativeVolume: round2(relativeVolume),
    volumeTrend,

    participationState,
    participationQuality,

    priceNearRecentHigh,
    priceNearRecentLow,

    priceDisplacement: {
      state: priceDisplacementStrong ? "STRONG" : "WEAK",
      value: round2(priceDisplacementValue),
      threshold: 1.05,
    },

    candleContext: {
      highVolumeCandles,
      burstCandles,
      greenCandles,
      redCandles,
      latestCandleDirection: latestCandleDirection(latest),
    },

    emaContext: {
      close: round2(close),
      ema10: round2(ema10),
      ema20: round2(ema20),
      aboveEma10,
      aboveEma20,
      belowEma10,
      belowEma20,
    },

   keyLevelContext: {
     rangeCompression,
     nearMajorHigh: priceNearRecentHigh,
     recentHigh50: round2(recentHigh50),
     distanceToRecentHighPct: round2(distanceToRecentHighPct),
     rawPriceNearRecentHigh,
     nearRecentLow: priceNearRecentLow,
     recentLow50: round2(recentLow50),
     distanceToRecentLowPct: round2(distanceToRecentLowPct),
     rawPriceNearRecentLow,
     ...psych,
   },

    reasonCodes,
    message,
    updatedAt,

    debug: {
      barsReceived: cleanBars.length,
      avgVol20: round2(avgVol20),
      burstVolAvg: round2(burstVolAvg),
      volumeExpansion,
      avgRange20: round2(avgRange20),
      burstRangeAvg: round2(burstRangeAvg),
      latestBar: latest,
    },
  };
}
