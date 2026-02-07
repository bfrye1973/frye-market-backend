// src/services/core/logic/volumeBehaviorEngine.js
//
// Engine 4 — Volume Behavior (Intent Confirmation)
// LOCKED ROLE:
// - Never authorizes trades (Engine 1 does WHERE gate)
// - Never resurrects fib invalidation (Engine 2 74% kill)
// - Never duplicates reaction quality (Engine 3 behavior)
// - Only confirms/suppresses participation behind a zone reaction
//
// Input bars must be an array of objects:
// { t, o, h, l, c, v }   (t optional; newest last)
//
// Output contract (stable):
// {
//   flags: { pullbackContraction, reversalExpansion, absorptionDetected, distributionDetected,
//            liquidityTrap, initiativeMoveConfirmed, volumeDivergence },
//   ratios: { pullbackVolRatio, reversalVolRatio },
//   timing: { touchIndex, touchBarsAgo },
//   volumeScore: 0..15,
//   volumeConfirmed: bool,
//   diagnostics: {...}
// }

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function sma(values) {
  if (!values.length) return null;
  const s = values.reduce((a, b) => a + b, 0);
  return s / values.length;
}

// simple slope of y vs index 0..n-1 using least squares
function linSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function atrFromBars(bars, len = 14) {
  if (!bars || bars.length < len + 1) return null;
  const trs = [];
  for (let i = bars.length - len; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c)
    );
    trs.push(tr);
  }
  return sma(trs);
}

function wickDominance(bar) {
  const body = Math.abs(bar.c - bar.o);
  const upperWick = bar.h - Math.max(bar.o, bar.c);
  const lowerWick = Math.min(bar.o, bar.c) - bar.l;
  return {
    upperWick,
    lowerWick,
    body,
    upperDominant: upperWick > lowerWick * 1.25,
    lowerDominant: lowerWick > upperWick * 1.25,
  };
}

function barTouchesZone(bar, zone) {
  return bar.l <= zone.hi && bar.h >= zone.lo;
}

function barClosesOutsideZone(bar, zone) {
  return bar.c > zone.hi || bar.c < zone.lo;
}

function zonePosition01(price, zone) {
  const w = zone.hi - zone.lo;
  if (w <= 0) return 0.5;
  return clamp((price - zone.lo) / w, 0, 1);
}

// ----------------------
// 🔒 Engine 4 Presets (LOCKED)
// ----------------------
function resolveModePreset(modeRaw) {
  const mode = String(modeRaw || "").toLowerCase();

  // SCALP = fast intent
  if (mode === "scalp") {
    return {
      modeUsed: "scalp",
      avgVolLen: 20,

      // windows
      pullbackBars: 3,
      reversalBars: 2, // 1–2 expected; we evaluate up to 2
      lookbackBars: 60,

      // ratios
      pullbackContractionMax: 0.80, // contraction valid
      reversalExpansionMin: 1.30,   // participation must show up
      // scoring strong points remain via thresholds inside score mapping

      // traps (aggressive)
      trapBreakVolMaxRatio: 1.00,
      trapVolSpikeRatio: 1.30,

      // absorption (scalp treats as bad/standdown)
      absorptionVolMinRatio: 1.25,
      absorptionMaxDisplacementAtr: 0.15,

      // divergence (very sensitive)
      divergenceBars: 3,
      divergencePriceMinAtr: 0.15,
      divergenceVolMaxRatio: 0.85,
    };
  }

  // LONG = swing logic, scaled out
  if (mode === "long") {
    return {
      modeUsed: "long",
      avgVolLen: 20,

      // windows
      pullbackBars: 9,     // 8–10
      reversalBars: 7,     // 5–8
      lookbackBars: 120,   // longer relevance window

      // ratios
      pullbackContractionMax: 0.90,
      reversalExpansionMin: 1.20,

      // traps (moderate)
      trapBreakVolMaxRatio: 0.90,
      trapVolSpikeRatio: 1.25,

      // absorption (long = neutral/positive, wider tolerance)
      absorptionVolMinRatio: 1.30,
      absorptionMaxDisplacementAtr: 0.40,

      // divergence (structural)
      divergenceBars: 10,
      divergencePriceMinAtr: 0.60,
      divergenceVolMaxRatio: 0.90,
    };
  }

  // SWING = default structural
  return {
    modeUsed: "swing",
    avgVolLen: 20,

    // windows
    pullbackBars: 5,
    reversalBars: 4,   // 3–5
    lookbackBars: 60,

    // ratios
    pullbackContractionMax: 0.90,
    reversalExpansionMin: 1.20,

    // traps (moderate)
    trapBreakVolMaxRatio: 0.90,
    trapVolSpikeRatio: 1.25,

    // absorption (neutral/positive)
    absorptionVolMinRatio: 1.30,
    absorptionMaxDisplacementAtr: 0.25,

    // divergence (structural)
    divergenceBars: 6,
    divergencePriceMinAtr: 0.35,
    divergenceVolMaxRatio: 0.90,
  };
}

export function computeVolumeBehavior({
  bars,
  zone,
  touchIndex = null,
  opts = {},
  reactionScore = null,
}) {
  const preset = resolveModePreset(opts?.mode);

  // allow explicit overrides (but presets are default)
  const avgVolLen = Number.isFinite(opts.avgVolLen) ? opts.avgVolLen : preset.avgVolLen;
  const pullbackBars = Number.isFinite(opts.pullbackBars) ? opts.pullbackBars : preset.pullbackBars;
  const reversalBars = Number.isFinite(opts.reversalBars) ? opts.reversalBars : preset.reversalBars;
  const lookbackBars = Number.isFinite(opts.lookbackBars) ? opts.lookbackBars : preset.lookbackBars;

  const pullbackContractionMax = Number.isFinite(opts.pullbackContractionMax)
    ? opts.pullbackContractionMax
    : preset.pullbackContractionMax;

  const reversalExpansionMin = Number.isFinite(opts.reversalExpansionMin)
    ? opts.reversalExpansionMin
    : preset.reversalExpansionMin;

  const trapVolSpikeRatio = Number.isFinite(opts.trapVolSpikeRatio)
    ? opts.trapVolSpikeRatio
    : preset.trapVolSpikeRatio;

  const trapBreakVolMaxRatio = Number.isFinite(opts.trapBreakVolMaxRatio)
    ? opts.trapBreakVolMaxRatio
    : preset.trapBreakVolMaxRatio;

  const absorptionVolMinRatio = Number.isFinite(opts.absorptionVolMinRatio)
    ? opts.absorptionVolMinRatio
    : preset.absorptionVolMinRatio;

  const absorptionMaxDisplacementAtr = Number.isFinite(opts.absorptionMaxDisplacementAtr)
    ? opts.absorptionMaxDisplacementAtr
    : preset.absorptionMaxDisplacementAtr;

  const divergenceBars = Number.isFinite(opts.divergenceBars) ? opts.divergenceBars : preset.divergenceBars;
  const divergencePriceMinAtr = Number.isFinite(opts.divergencePriceMinAtr)
    ? opts.divergencePriceMinAtr
    : preset.divergencePriceMinAtr;

  const divergenceVolMaxRatio = Number.isFinite(opts.divergenceVolMaxRatio)
    ? opts.divergenceVolMaxRatio
    : preset.divergenceVolMaxRatio;

  if (!Array.isArray(bars) || bars.length < Math.max(avgVolLen + 5, 30)) {
    return {
      flags: {
        pullbackContraction: false,
        reversalExpansion: false,
        absorptionDetected: false,
        distributionDetected: false,
        liquidityTrap: false,
        initiativeMoveConfirmed: false,
        volumeDivergence: false,
      },
      ratios: { pullbackVolRatio: null, reversalVolRatio: null },
      timing: { touchIndex: null, touchBarsAgo: null },
      volumeScore: 0,
      volumeConfirmed: false,
      diagnostics: {
        modeUsed: preset.modeUsed,
        error: "INSUFFICIENT_BARS",
        bars: bars?.length ?? 0,
        requiredMin: Math.max(avgVolLen + 5, 30),
      },
    };
  }

  if (!zone || typeof zone.lo !== "number" || typeof zone.hi !== "number") {
    return {
      flags: {
        pullbackContraction: false,
        reversalExpansion: false,
        absorptionDetected: false,
        distributionDetected: false,
        liquidityTrap: false,
        initiativeMoveConfirmed: false,
        volumeDivergence: false,
      },
      ratios: { pullbackVolRatio: null, reversalVolRatio: null },
      timing: { touchIndex: null, touchBarsAgo: null },
      volumeScore: 0,
      volumeConfirmed: false,
      diagnostics: { modeUsed: preset.modeUsed, error: "MISSING_ZONE" },
    };
  }

  const n = bars.length;
  const atr = atrFromBars(bars, 14) ?? null;

  const volSeries = bars.map((b) => Number(b.v || 0));
  const avgVol = sma(volSeries.slice(-avgVolLen)) ?? null;

  // Find touch index
  let ti = touchIndex;
  if (ti == null) {
    const start = Math.max(0, n - lookbackBars);
    for (let i = n - 1; i >= start; i--) {
      if (barTouchesZone(bars[i], zone)) {
        ti = i;
        break;
      }
    }
  }

  if (ti == null) {
    return {
      flags: {
        pullbackContraction: false,
        reversalExpansion: false,
        absorptionDetected: false,
        distributionDetected: false,
        liquidityTrap: false,
        initiativeMoveConfirmed: false,
        volumeDivergence: false,
      },
      ratios: { pullbackVolRatio: null, reversalVolRatio: null },
      timing: { touchIndex: null, touchBarsAgo: null },
      volumeScore: 0,
      volumeConfirmed: false,
      diagnostics: {
        modeUsed: preset.modeUsed,
        avgVolLen,
        avgVol,
        atr,
        lookbackBars,
        note: "NO_TOUCH_FOUND_IN_LOOKBACK",
      },
    };
  }

  const touchBarsAgo = (n - 1) - ti;

  // Pullback segment
  const pbStart = Math.max(0, ti - pullbackBars);
  const pbEnd = Math.max(0, ti); // exclusive
  const pullbackVols = volSeries.slice(pbStart, pbEnd);
  const pullbackAvgVol = pullbackVols.length ? sma(pullbackVols) : null;

  const pullbackVolRatio =
    avgVol && pullbackAvgVol != null && avgVol > 0 ? pullbackAvgVol / avgVol : null;

  const pullbackContraction =
    pullbackVolRatio != null ? pullbackVolRatio <= pullbackContractionMax : false;

  // Reversal segment
  const rvStart = ti;
  const rvEnd = Math.min(n, ti + reversalBars);
  const reversalVols = volSeries.slice(rvStart, rvEnd);
  const reversalMaxVol = reversalVols.length ? Math.max(...reversalVols) : null;

  const reversalVolRatio =
    avgVol && reversalMaxVol != null && avgVol > 0 ? reversalMaxVol / avgVol : null;

  const reversalExpansion =
    reversalVolRatio != null ? reversalVolRatio >= reversalExpansionMin : false;

  // Volume Divergence (event-based, post-touch)
  let volumeDivergence = false;
  let divergenceType = null;

  if (avgVol && atr) {
    const dStart = ti;
    const dEnd = Math.min(n, ti + divergenceBars);
    const seg = bars.slice(dStart, dEnd);

    if (seg.length >= 4) {
      const closes = seg.map((b) => b.c);
      const vols = seg.map((b) => (b.v || 0));

      const priceMove = closes[closes.length - 1] - closes[0];
      const priceMoveAbsAtr = Math.abs(priceMove) / atr;

      const volAvg = sma(vols) ?? null;
      const volAvgRatio = volAvg != null && avgVol > 0 ? volAvg / avgVol : null;

      const priceSlope = linSlope(closes);
      const volSlope = linSlope(vols);

      const meaningful = priceMoveAbsAtr >= divergencePriceMinAtr;
      const lowParticipation = volAvgRatio != null ? volAvgRatio <= divergenceVolMaxRatio : false;

      if (meaningful && lowParticipation) {
        if (priceSlope > 0 && volSlope <= 0) {
          volumeDivergence = true;
          divergenceType = "weak_up";
        } else if (priceSlope < 0 && volSlope <= 0) {
          volumeDivergence = true;
          divergenceType = "weak_down";
        }
      }
    }
  }

  // Timing bonus
  // SCALP wants very recent touch; SWING/LONG allow more.
  let timingBonus = 0;
  if (preset.modeUsed === "scalp") {
    if (touchBarsAgo <= 8) timingBonus = 3;
    else if (touchBarsAgo <= 15) timingBonus = 2;
    else if (touchBarsAgo <= 25) timingBonus = 1;
  } else if (preset.modeUsed === "long") {
    if (touchBarsAgo <= 30) timingBonus = 3;
    else if (touchBarsAgo <= 60) timingBonus = 2;
    else if (touchBarsAgo <= 120) timingBonus = 1;
  } else {
    if (touchBarsAgo <= 20) timingBonus = 3;
    else if (touchBarsAgo <= 40) timingBonus = 2;
    else if (touchBarsAgo <= 60) timingBonus = 1;
  }

  // Liquidity trap detection
  let liquidityTrap = false;
  if (avgVol && ti + 1 < n) {
    const b0 = bars[ti];
    const b1 = bars[ti + 1];

    const breakBar = barClosesOutsideZone(b0, zone);
    const breakVolRatio = avgVol > 0 ? (b0.v || 0) / avgVol : null;

    const backInside = barTouchesZone(b1, zone) && !barClosesOutsideZone(b1, zone);
    const spikeAfter = avgVol > 0 ? (b1.v || 0) / avgVol >= trapVolSpikeRatio : false;

    const breakWasNotConviction =
      breakVolRatio != null ? breakVolRatio <= trapBreakVolMaxRatio : false;

    if (breakBar && backInside && spikeAfter && breakWasNotConviction) {
      liquidityTrap = true;
    }
  }

  // Absorption detection
  let absorptionDetected = false;
  if (avgVol && atr && ti - 2 >= 0) {
    const a0 = Math.max(0, ti - 2);
    const a1 = Math.min(n, ti + 3);
    const windowBars = bars.slice(a0, a1);

    const windowVolAvg = sma(windowBars.map((b) => b.v || 0)) ?? null;
    const windowVolRatio =
      windowVolAvg != null && avgVol > 0 ? windowVolAvg / avgVol : null;

    const displacement = Math.abs(windowBars[windowBars.length - 1].c - windowBars[0].c);
    const maxDisp = atr * absorptionMaxDisplacementAtr;

    const insideMostly =
      windowBars.filter((b) => barTouchesZone(b, zone)).length >=
      Math.floor(windowBars.length * 0.6);

    if (
      insideMostly &&
      windowVolRatio != null &&
      windowVolRatio >= absorptionVolMinRatio &&
      displacement <= maxDisp
    ) {
      absorptionDetected = true;
    }
  }

  // Distribution hint (light-touch)
  let distributionDetected = false;
  let accumulationHint = false;

  const tb = bars[ti];
  const pos = zonePosition01(tb.c, zone);
  const w = wickDominance(tb);

  if (pos >= 0.70 && w.upperDominant && (tb.v || 0) >= (avgVol || 0) * 1.10) {
    distributionDetected = true;
  }
  if (pos <= 0.30 && w.lowerDominant && (tb.v || 0) >= (avgVol || 0) * 1.10) {
    accumulationHint = true;
  }

  // Scoring (0–15)
  // Contraction scoring bands shift slightly by mode to match your locked numbers.
  let contractionScore = 0;
  if (pullbackVolRatio != null) {
    if (preset.modeUsed === "scalp") {
      if (pullbackVolRatio <= 0.65) contractionScore = 6;
      else if (pullbackVolRatio <= 0.80) contractionScore = 4;
      else if (pullbackVolRatio <= 1.00) contractionScore = 2;
    } else {
      // swing/long
      if (pullbackVolRatio <= 0.75) contractionScore = 6;
      else if (pullbackVolRatio <= pullbackContractionMax) contractionScore = 4; // 0.90
      else if (pullbackVolRatio <= 1.00) contractionScore = 2;
    }
  }

  let expansionScore = 0;
  if (reversalVolRatio != null) {
    if (preset.modeUsed === "scalp") {
      if (reversalVolRatio >= 1.60) expansionScore = 6;
      else if (reversalVolRatio >= 1.30) expansionScore = 4;
      else if (reversalVolRatio >= 1.10) expansionScore = 2;
    } else {
      // swing/long
      if (reversalVolRatio >= 1.50) expansionScore = 6;
      else if (reversalVolRatio >= reversalExpansionMin) expansionScore = 4; // 1.20
      else if (reversalVolRatio >= 1.10) expansionScore = 2;
    }
  }

  let volumeScore = contractionScore + expansionScore + timingBonus;

  // Penalties / caps
  if (liquidityTrap) {
    volumeScore = Math.min(volumeScore, preset.modeUsed === "scalp" ? 3 : 5);
  }

  if (distributionDetected) {
    volumeScore = Math.max(0, volumeScore - 4);
  }

  // Absorption handling differs by mode:
  // - scalp: absorption is "bad" (stand down) -> stronger penalty
  // - swing/long: absorption is neutral; only small suppress if no expansion
  if (absorptionDetected && !reversalExpansion) {
    volumeScore = Math.max(0, volumeScore - (preset.modeUsed === "scalp" ? 4 : 2));
  }

  if (volumeDivergence) {
    volumeScore = Math.max(0, volumeScore - 3);
  }

  volumeScore = clamp(volumeScore, 0, 15);

  const volumeConfirmed = pullbackContraction && reversalExpansion && !liquidityTrap;

  const initiativeMoveConfirmed =
    reactionScore != null
      ? reactionScore >= 6 && reversalExpansion && !liquidityTrap
      : reversalExpansion && !liquidityTrap;

  return {
    flags: {
      pullbackContraction,
      reversalExpansion,
      absorptionDetected,
      distributionDetected,
      liquidityTrap,
      initiativeMoveConfirmed,
      volumeDivergence,
    },
    ratios: {
      pullbackVolRatio,
      reversalVolRatio,
    },
    timing: {
      touchIndex: ti,
      touchBarsAgo,
    },
    volumeScore,
    volumeConfirmed,
    diagnostics: {
      modeUsed: preset.modeUsed,
      avgVolLen,
      avgVol,
      atr,
      pullbackBars,
      reversalBars,
      lookbackBars,
      divergenceBars,
      thresholds: {
        pullbackContractionMax,
        reversalExpansionMin,
        trapBreakVolMaxRatio,
        trapVolSpikeRatio,
        absorptionVolMinRatio,
        absorptionMaxDisplacementAtr,
        divergencePriceMinAtr,
        divergenceVolMaxRatio,
      },
      divergence: { volumeDivergence, divergenceType },
      pullbackRange: [pbStart, pbEnd - 1],
      reversalRange: [rvStart, rvEnd - 1],
      zone: { lo: zone.lo, hi: zone.hi },
      touchBar: { o: tb.o, h: tb.h, l: tb.l, c: tb.c, v: tb.v },
      zonePos01: pos,
      wick: w,
      accumulationHint,
    },
  };
}
