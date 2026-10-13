// services/core/logic/engine3EsReactionQuality.js

function normRange(range) {
  const a = Number(range?.[0]);
  const b = Number(range?.[1]);
  return {
    hi: Math.max(a, b),
    lo: Math.min(a, b),
    mid: (a + b) / 2,
  };
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function distance(price, level) {
  return Math.abs(Number(price) - Number(level));
}

function clamp(num, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(Number(num) || 0)));
}

function zonePosition(price, zone) {
  const width = zone.hi - zone.lo || 1;
  const upperBand = zone.hi - width * 0.25;
  const lowerBand = zone.lo + width * 0.25;

  if (price > zone.hi) return "ABOVE_ZONE";
  if (price < zone.lo) return "BELOW_ZONE";
  if (price >= upperBand) return "UPPER_ZONE";
  if (price <= lowerBand) return "LOWER_ZONE";
  return "MIDDLE_ZONE";
}

function avg(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function candleParts(bar) {
  const open = n(bar?.open ?? bar?.o);
  const high = n(bar?.high ?? bar?.h);
  const low = n(bar?.low ?? bar?.l);
  const close = n(bar?.close ?? bar?.c);
  const volume = n(bar?.volume ?? bar?.v);

  const range = high != null && low != null ? Math.max(0, high - low) : 0;
  const body = open != null && close != null ? Math.abs(close - open) : 0;

  const green = open != null && close != null && close > open;
  const red = open != null && close != null && close < open;

  const closeNearHigh =
    high != null && low != null && close != null && range > 0
      ? (high - close) / range <= 0.25
      : false;

  const closeNearLow =
    high != null && low != null && close != null && range > 0
      ? (close - low) / range <= 0.25
      : false;

  const bodyPct = range > 0 ? body / range : 0;

  return {
    open,
    high,
    low,
    close,
    volume,
    range,
    body,
    bodyPct,
    green,
    red,
    closeNearHigh,
    closeNearLow,
  };
}

function computeImpulseIgnition({ candles = [], price } = {}) {
  const bars = candles.slice(-40);
  const recent = bars.slice(-4).map(candleParts);
  const last = candleParts(bars[bars.length - 1] || {});
  const close = n(last.close ?? price);

  if (bars.length < 24 || recent.length < 4 || close == null) {
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

  const prior = bars.slice(0, -4).map(candleParts);
  const priorRanges = prior.map((b) => b.range).filter(Number.isFinite);
  const priorVolumes = prior.map((b) => b.volume).filter(Number.isFinite);

  const avgRange20 = avg(priorRanges.slice(-20)) || 0;
  const avgVol20 = avg(priorVolumes.slice(-20));

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

  const burstVolAvg = avg(recent.map((b) => b.volume).filter(Number.isFinite));
  const volumeExpansion =
    avgVol20 != null && burstVolAvg != null ? burstVolAvg >= avgVol20 * 1.35 : false;

  const highVolumeCandles =
    avgVol20 != null
      ? recent.filter((b) => Number.isFinite(b.volume) && b.volume >= avgVol20 * 1.5).length
      : 0;

  const priorLows = prior.slice(-20).map((b) => b.low).filter(Number.isFinite);
  const priorHighs = prior.slice(-20).map((b) => b.high).filter(Number.isFinite);

  const recentLow = Math.min(...recent.map((b) => b.low).filter(Number.isFinite));
  const recentHigh = Math.max(...recent.map((b) => b.high).filter(Number.isFinite));

  const priorLow = priorLows.length ? Math.min(...priorLows) : null;
  const priorHigh = priorHighs.length ? Math.max(...priorHighs) : null;

  const offRecentLow =
    priorLow != null && recentLow <= priorLow + Math.max(avgRange20 * 1.5, 2.0);

  const offRecentHigh =
    priorHigh != null && recentHigh >= priorHigh - Math.max(avgRange20 * 1.5, 2.0);

  const higherCloses =
    recent[3].close > recent[2].close &&
    recent[2].close > recent[1].close;

  const lowerCloses =
    recent[3].close < recent[2].close &&
    recent[2].close < recent[1].close;

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

  if (score < 80) {
    return {
      active: false,
      direction,
      state: "NO_IMPULSE_IGNITION",
      score,
      candlesInSequence: direction === "LONG" ? greenCount : redCount,
      reason: "Impulse conditions are not strong enough yet.",
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

  if (direction === "LONG") {
    return {
      active: true,
      direction: "LONG",
      state: "BULLISH_IMPULSE_IGNITION",
      score,
      candlesInSequence: greenCount,
      reason: "Strong green displacement candles formed with volume expansion off a reaction low.",
      evidence: longEvidence,
      debug: {
        avgRange20,
        avgVol20,
        burstVolAvg,
        volumeExpansion,
        highVolumeCandles,
        greenCount,
        strongGreenCount,
      },
    };
  }

  return {
    active: true,
    direction: "SHORT",
    state: "BEARISH_IMPULSE_IGNITION",
    score,
    candlesInSequence: redCount,
    reason: "Strong red displacement candles formed with volume expansion off a reaction high.",
    evidence: shortEvidence,
    debug: {
      avgRange20,
      avgVol20,
      burstVolAvg,
      volumeExpansion,
      highVolumeCandles,
      redCount,
      strongRedCount,
    },
  };
}

export function computeEngine3EsReactionQuality({
  price,
  candles = [],
  manualStructures = [],
  shelves = [],
} = {}) {
  const p = Number(price);
  const last = candles[candles.length - 1] || {};
  const close = Number(last.close ?? p);

  const impulseIgnition = computeImpulseIgnition({
    candles,
    price: close,
  });

  const manualZones = manualStructures
    .filter((z) => z?.symbol === "ES" && Array.isArray(z.priceRange))
    .map((z) => {
      const r = normRange(z.priceRange);
      return {
        source: z.isNegotiated ? "ES_MANUAL_NEGOTIATED" : "ES_MANUAL_INSTITUTIONAL",
        type: z.isNegotiated ? "negotiated" : "institutional",
        lo: r.lo,
        hi: r.hi,
        mid: r.mid,
        strength: z.isNegotiated ? 100 : 85,
        notes: z.notes || "",
        structureKey: z.structureKey,
      };
    });

  const shelfZones = shelves.map((z) => ({
    source: "ENGINE_1B_ES_SMZ_SHELVES",
    type: z.type,
    lo: Number(z.lo),
    hi: Number(z.hi),
    mid: Number(z.mid),
    strength: Number(z.strength ?? 70),
    confidence: Number(z.confidence ?? 0),
    reason: z?.diagnostic?.reason || "",
  }));

  const allZones = [...manualZones, ...shelfZones].filter(
    (z) => Number.isFinite(z.lo) && Number.isFinite(z.hi)
  );

  if (!allZones.length || !Number.isFinite(close)) {
    return {
      symbol: "ES",
      zoneSource: "NONE",
      zoneType: "none",
      zone: null,
      reaction: {
        position: "NO_ACTIVE_ZONE",
        state: "NO_ACTIVE_ZONE",
        quality: "NONE",
        qualityScore: 0,
        bias: "NEUTRAL",
        reason: "No ES zone context available.",
      },
      impulseIgnition,
      evidence: ["NO_ES_ZONES_AVAILABLE"],
    };
  }

  const selected = allZones
    .map((z) => {
      const inside = close >= z.lo && close <= z.hi;
      const near = Math.min(distance(close, z.lo), distance(close, z.hi), distance(close, z.mid));
      const priority =
        z.source === "ES_MANUAL_NEGOTIATED" ? 300 :
        z.source === "ES_MANUAL_INSTITUTIONAL" ? 200 :
        100;

      return {
        ...z,
        inside,
        near,
        rank: (inside ? 10000 : 0) + priority + Number(z.strength ?? 0) - near,
      };
    })
    .sort((a, b) => b.rank - a.rank)[0];

  const pos = zonePosition(close, selected);
  const evidence = [
    `ZONE_SOURCE_${selected.source}`,
    `ZONE_TYPE_${String(selected.type).toUpperCase()}`,
    `POSITION_${pos}`,
  ];

  let state = "NEUTRAL_CHOP";
  let bias = "NEUTRAL";
  let reason = "ES is chopping near the selected zone.";
  let score = 50;

  if (selected.type === "distribution") {
    if (pos === "ABOVE_ZONE") {
      state = "BREAKING_ABOVE_DISTRIBUTION";
      bias = "BULLISH_ACCEPTANCE";
      reason = "ES is trading above the distribution shelf, showing bullish acceptance above supply.";
      score = 76;
      evidence.push("CLOSE_ABOVE_DISTRIBUTION");
    } else if (pos === "UPPER_ZONE") {
      state = "REJECTING_UPPER_ZONE";
      bias = "BEARISH_REACTION";
      reason = "ES is reacting near the upper part of a distribution shelf.";
      score = 72;
      evidence.push("UPPER_DISTRIBUTION_REACTION");
    } else if (pos === "MIDDLE_ZONE") {
      state = "ACCEPTING_INSIDE_ZONE";
      bias = "NEUTRAL";
      reason = "ES is accepting value inside the distribution shelf.";
      score = 55;
    } else if (pos === "BELOW_ZONE") {
      state = "REJECTED_FROM_DISTRIBUTION";
      bias = "BEARISH_REACTION";
      reason = "ES is below the distribution shelf after rejecting supply.";
      score = 78;
      evidence.push("BELOW_DISTRIBUTION_AFTER_REJECTION");
    }
  } else if (selected.type === "accumulation") {
    if (pos === "BELOW_ZONE") {
      state = "BREAKING_BELOW_ACCUMULATION";
      bias = "BEARISH_ACCEPTANCE";
      reason = "ES is trading below the accumulation shelf, showing bearish acceptance below demand.";
      score = 76;
      evidence.push("CLOSE_BELOW_ACCUMULATION");
    } else if (pos === "LOWER_ZONE") {
      state = "DEFENDING_LOWER_ZONE";
      bias = "BULLISH_REACTION";
      reason = "ES is reacting near the lower part of an accumulation shelf.";
      score = 72;
      evidence.push("LOWER_ACCUMULATION_REACTION");
    } else if (pos === "ABOVE_ZONE") {
      state = "HELD_ACCUMULATION";
      bias = "BULLISH_REACTION";
      reason = "ES is holding above the accumulation shelf.";
      score = 74;
      evidence.push("ABOVE_ACCUMULATION");
    } else {
      state = "ACCEPTING_INSIDE_ZONE";
      bias = "NEUTRAL_TO_BULLISH";
      reason = "ES is accepting value inside the accumulation shelf.";
      score = 60;
    }
  } else if (selected.type === "negotiated") {
    if (pos === "ABOVE_ZONE") {
      state = "BREAKING_ABOVE_NEGOTIATED_VALUE";
      bias = "BULLISH_ACCEPTANCE";
      reason = "ES is trading above manually defined negotiated value.";
      score = 78;
      evidence.push("ABOVE_MANUAL_NEGOTIATED");
    } else if (pos === "BELOW_ZONE") {
      state = "BREAKING_BELOW_NEGOTIATED_VALUE";
      bias = "BEARISH_ACCEPTANCE";
      reason = "ES is trading below manually defined negotiated value.";
      score = 78;
      evidence.push("BELOW_MANUAL_NEGOTIATED");
    } else {
      state = "ACCEPTING_VALUE";
      bias = "NEUTRAL_TO_BULLISH";
      reason = "ES is holding inside manually defined negotiated value.";
      score = 72;
      evidence.push("INSIDE_MANUAL_NEGOTIATED");
    }
  } else if (selected.type === "institutional") {
    if (pos === "ABOVE_ZONE") {
      state = "ABOVE_INSTITUTIONAL_ZONE";
      bias = "BULLISH_ACCEPTANCE";
      reason = "ES is trading above the manual institutional zone.";
      score = 70;
    } else if (pos === "BELOW_ZONE") {
      state = "BELOW_INSTITUTIONAL_ZONE";
      bias = "BEARISH_ACCEPTANCE";
      reason = "ES is trading below the manual institutional zone.";
      score = 70;
    } else {
      state = "INSIDE_INSTITUTIONAL_ZONE";
      bias = "NEUTRAL";
      reason = "ES is inside a broad manual institutional zone.";
      score = 62;
    }
  }

  const quality =
    score >= 75 ? "GOOD" :
    score >= 60 ? "FAIR" :
    score >= 40 ? "CAUTION" :
    "WEAK";

  return {
    symbol: "ES",
    zoneSource: selected.source,
    zoneType: selected.type,
    zone: {
      lo: selected.lo,
      hi: selected.hi,
      mid: selected.mid,
      strength: selected.strength ?? null,
      confidence: selected.confidence ?? null,
      reason: selected.reason ?? null,
      notes: selected.notes ?? null,
      structureKey: selected.structureKey ?? null,
    },
    reaction: {
      position: pos,
      state,
      quality,
      qualityScore: clamp(score),
      bias,
      reason,
    },
    impulseIgnition,
    price: close,
    evidence,
  };
}
