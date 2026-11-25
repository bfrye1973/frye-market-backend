// services/core/logic/engine29/structure/detectSwingStructure.js

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function detectConfirmedSwings(bars = [], { left = 2, right = 2 } = {}) {
  if (!Array.isArray(bars) || bars.length < left + right + 1) {
    return { highs: [], lows: [] };
  }

  const highs = [];
  const lows = [];

  for (let i = left; i < bars.length - right; i += 1) {
    const candidateHigh = Number(bars[i]?.high ?? bars[i]?.close);
    const candidateLow = Number(bars[i]?.low ?? bars[i]?.close);
    if (!Number.isFinite(candidateHigh) || !Number.isFinite(candidateLow)) continue;

    let highConfirmed = true;
    let lowConfirmed = true;

    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      const otherHigh = Number(bars[j]?.high ?? bars[j]?.close);
      const otherLow = Number(bars[j]?.low ?? bars[j]?.close);

      if (isFiniteNumber(otherHigh) && candidateHigh <= otherHigh) highConfirmed = false;
      if (isFiniteNumber(otherLow) && candidateLow >= otherLow) lowConfirmed = false;
    }

    if (highConfirmed) {
      highs.push({
        index: i,
        time: bars[i].time,
        date: bars[i].date,
        price: candidateHigh,
      });
    }

    if (lowConfirmed) {
      lows.push({
        index: i,
        time: bars[i].time,
        date: bars[i].date,
        price: candidateLow,
      });
    }
  }

  return { highs, lows };
}

export function summarizeSwingTrend(swings = {}) {
  const highs = Array.isArray(swings.highs) ? swings.highs : [];
  const lows = Array.isArray(swings.lows) ? swings.lows : [];

  const lastHigh = highs.at(-1) || null;
  const priorHigh = highs.at(-2) || null;
  const lastLow = lows.at(-1) || null;
  const priorLow = lows.at(-2) || null;

  const highStructure =
    lastHigh && priorHigh
      ? lastHigh.price > priorHigh.price
        ? "HIGHER_HIGH"
        : lastHigh.price < priorHigh.price
          ? "LOWER_HIGH"
          : "EQUAL_HIGH"
      : "UNRESOLVED";

  const lowStructure =
    lastLow && priorLow
      ? lastLow.price > priorLow.price
        ? "HIGHER_LOW"
        : lastLow.price < priorLow.price
          ? "LOWER_LOW"
          : "EQUAL_LOW"
      : "UNRESOLVED";

  let trend = "NEUTRAL";
  if (highStructure === "HIGHER_HIGH" && lowStructure === "HIGHER_LOW") trend = "BULLISH";
  if (highStructure === "LOWER_HIGH" && lowStructure === "LOWER_LOW") trend = "BEARISH";
  if (highStructure === "LOWER_HIGH" && lowStructure === "HIGHER_LOW") trend = "COMPRESSION";
  if (highStructure === "HIGHER_HIGH" && lowStructure === "LOWER_LOW") trend = "EXPANSION";

  return {
    trend,
    highStructure,
    lowStructure,
    lastSwingHigh: lastHigh,
    priorSwingHigh: priorHigh,
    lastSwingLow: lastLow,
    priorSwingLow: priorLow,
  };
}
