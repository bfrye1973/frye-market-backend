// services/core/logic/esVolumeBehaviorEngine.js

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
  const r = candleRange(bar);
  if (!r) return 0;
  return candleBody(bar) / r;
}

function upperWickPct(bar) {
  const high = num(bar.high);
  const open = num(bar.open);
  const close = num(bar.close);
  const r = candleRange(bar);
  if (!r) return 0;
  return (high - Math.max(open, close)) / r;
}

function lowerWickPct(bar) {
  const low = num(bar.low);
  const open = num(bar.open);
  const close = num(bar.close);
  const r = candleRange(bar);
  if (!r) return 0;
  return (Math.min(open, close) - low) / r;
}

function inferDirection(impulseWindow, volumeExpansion) {
  if (!impulseWindow.length || !volumeExpansion) return "NEUTRAL";

  const green = impulseWindow.filter((b) => num(b.close) > num(b.open)).length;
  const red = impulseWindow.filter((b) => num(b.close) < num(b.open)).length;

  const firstClose = num(impulseWindow[0]?.close);
  const lastClose = num(impulseWindow[impulseWindow.length - 1]?.close);

  const higherCloses = lastClose > firstClose;
  const lowerCloses = lastClose < firstClose;

  if (green >= 3 && higherCloses) return "LONG";
  if (red >= 3 && lowerCloses) return "SHORT";
  if (green >= 2 && higherCloses) return "LONG";
  if (red >= 2 && lowerCloses) return "SHORT";

  return "MIXED";
}

function computeVolumeTrend(impulseWindow) {
  if (impulseWindow.length < 3) return "UNKNOWN";

  const vols = impulseWindow.map((b) => num(b.volume));
  const firstHalf = avg(vols.slice(0, 2));
  const secondHalf = avg(vols.slice(-2));

  if (secondHalf >= firstHalf * 1.15) return "EXPANDING";
  if (secondHalf <= firstHalf * 0.85) return "FADING";
  return "STABLE";
}

function detectAbsorptionRisk(lastBar, avgVol20) {
  const volume = num(lastBar?.volume);
  const bp = bodyPct(lastBar);
  const wickMax = Math.max(upperWickPct(lastBar), lowerWickPct(lastBar));

  return (
    avgVol20 > 0 &&
    volume >= avgVol20 * 1.75 &&
    bp <= 0.35 &&
    wickMax >= 0.45
  );
}

function scoreEsVolume({
  relativeVolume,
  highVolumeCandles,
  volumeTrend,
  absorptionRisk,
  climacticVolume,
  direction,
}) {
  let score = 0;

  if (relativeVolume >= 1.1) score += 2;
  if (relativeVolume >= 1.35) score += 3;
  if (relativeVolume >= 1.6) score += 2;

  if (highVolumeCandles >= 1) score += 2;
  if (highVolumeCandles >= 2) score += 3;

  if (volumeTrend === "EXPANDING") score += 2;
  if (direction === "LONG" || direction === "SHORT") score += 1;

  if (climacticVolume) score += 1;
  if (absorptionRisk) score -= 3;

  return Math.max(0, Math.min(15, score));
}

function participationQualityFromScore(score, volumeConfirmed, absorptionRisk) {
  if (absorptionRisk) return "ABSORPTION_RISK";
  if (volumeConfirmed && score >= 12) return "CONFIRMED";
  if (score >= 9) return "EXPANDING";
  if (score >= 5) return "NORMAL";
  return "WEAK";
}

function participationStateFromInputs({
  volumeConfirmed,
  volumeScore,
  absorptionRisk,
  climacticVolume,
  volumeExpansion,
}) {
  if (absorptionRisk) return "ABSORPTION";
  if (climacticVolume) return "CLIMACTIC";
  if (volumeConfirmed || volumeScore >= 9 || volumeExpansion) return "EXPANDING";
  if (volumeScore <= 4) return "WEAK_PARTICIPATION";
  return "NEGOTIATING";
}

export function computeEsVolumeBehavior({ symbol = "ES", tf = "10m", bars = [] } = {}) {
  const cleanBars = Array.isArray(bars)
    ? bars
        .filter((b) => b && Number.isFinite(Number(b.close)) && Number.isFinite(Number(b.volume)))
        .map((b) => ({
          time: b.time,
          open: num(b.open),
          high: num(b.high),
          low: num(b.low),
          close: num(b.close),
          volume: num(b.volume),
        }))
    : [];

  if (cleanBars.length < 25) {
    return {
      symbol,
      tf,
      avgVol20: 0,
      burstVolAvg: 0,
      relativeVolume: 0,
      volumeExpansion: false,
      highVolumeCandles: 0,
      absorptionRisk: false,
      climacticVolume: false,
      volumeTrend: "UNKNOWN",
      direction: "NEUTRAL",
      participationState: "WEAK_PARTICIPATION",
      participationQuality: "INSUFFICIENT_DATA",
      volumeScore: 0,
      volumeConfirmed: false,
      reason: "Need at least 25 ES futures candles for avgVol20 and burst-window validation.",
      debug: {
        barsReceived: cleanBars.length,
        requiredBars: 25,
      },
    };
  }

  const lastBar = cleanBars[cleanBars.length - 1];
  const prior20 = cleanBars.slice(-24, -4);
  const impulseWindow = cleanBars.slice(-4);

  const avgVol20 = avg(prior20.map((b) => b.volume));
  const burstVolAvg = avg(impulseWindow.map((b) => b.volume));
  const relativeVolume = avgVol20 > 0 ? burstVolAvg / avgVol20 : 0;

  const highVolumeCandles = impulseWindow.filter((b) => b.volume >= avgVol20 * 1.5).length;

  const volumeTrend = computeVolumeTrend(impulseWindow);
  const volumeExpansion = burstVolAvg >= avgVol20 * 1.35;
  const direction = inferDirection(impulseWindow, volumeExpansion);

  const avgRange20 = avg(prior20.map(candleRange));
  const burstRangeAvg = avg(impulseWindow.map(candleRange));
  const priceDisplacement = avgRange20 > 0 ? burstRangeAvg >= avgRange20 * 1.05 : false;

  const climacticVolume = avgVol20 > 0 && lastBar.volume >= avgVol20 * 2.25;
  const absorptionRisk = detectAbsorptionRisk(lastBar, avgVol20);

  const volumeConfirmed =
    volumeExpansion &&
    highVolumeCandles >= 2 &&
    volumeTrend === "EXPANDING" &&
    priceDisplacement &&
    !absorptionRisk;

  const volumeScore = scoreEsVolume({
    relativeVolume,
    highVolumeCandles,
    volumeTrend,
    absorptionRisk,
    climacticVolume,
    direction,
  });

  const participationQuality = participationQualityFromScore(
    volumeScore,
    volumeConfirmed,
    absorptionRisk
  );

  const participationState = participationStateFromInputs({
    volumeConfirmed,
    volumeScore,
    absorptionRisk,
    climacticVolume,
    volumeExpansion,
  });

  const reasonCodes = [];

  if (volumeExpansion) reasonCodes.push("BURST_VOLUME_ABOVE_1_35_AVG");
  else reasonCodes.push("BURST_VOLUME_BELOW_CONFIRMATION");

  if (highVolumeCandles >= 2) reasonCodes.push("TWO_OR_MORE_HIGH_VOLUME_CANDLES");
  else reasonCodes.push("NOT_ENOUGH_HIGH_VOLUME_CANDLES");

  if (volumeTrend === "EXPANDING") reasonCodes.push("VOLUME_EXPANDING_IN_BURST_WINDOW");
  if (volumeTrend === "FADING") reasonCodes.push("VOLUME_FADING_IN_BURST_WINDOW");

  if (priceDisplacement) reasonCodes.push("PRICE_DISPLACEMENT_PRESENT");
  else reasonCodes.push("PRICE_DISPLACEMENT_WEAK");

  if (absorptionRisk) reasonCodes.push("ABSORPTION_RISK_HIGH_VOLUME_POOR_PROGRESS");
  if (climacticVolume) reasonCodes.push("CLIMACTIC_VOLUME_LAST_BAR");

  return {
    symbol,
    tf,

    avgVol20: round2(avgVol20),
    burstVolAvg: round2(burstVolAvg),
    relativeVolume: round2(relativeVolume),

    volumeExpansion,
    highVolumeCandles,

    absorptionRisk,
    climacticVolume,

    volumeTrend,
    direction,
    participationState,
    participationQuality,

    volumeScore,
    volumeConfirmed,

    reasonCodes,

    debug: {
      barsReceived: cleanBars.length,
      barsUsedForAvgVol20: prior20.length,
      impulseWindowBars: impulseWindow.length,
      avgRange20: round2(avgRange20),
      burstRangeAvg: round2(burstRangeAvg),
      priceDisplacement,
      lastBar: {
        time: lastBar.time,
        open: lastBar.open,
        high: lastBar.high,
        low: lastBar.low,
        close: lastBar.close,
        volume: lastBar.volume,
        bodyPct: round2(bodyPct(lastBar)),
        upperWickPct: round2(upperWickPct(lastBar)),
        lowerWickPct: round2(lowerWickPct(lastBar)),
      },
    },
  };
}
