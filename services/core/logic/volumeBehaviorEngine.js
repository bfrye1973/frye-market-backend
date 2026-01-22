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
//            liquidityTrap, initiativeMoveConfirmed },
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

function atrFromBars(bars, len = 14) {
  // Simple ATR using True Range
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
  // Returns { upperWick, lowerWick, body, upperDominant, lowerDominant }
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
  // Any overlap with band
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

export function computeVolumeBehavior({
  bars,
  zone,
  touchIndex = null, // optional explicit touch index
  opts = {},
  reactionScore = null, // optional Engine 3 score (0-10). Used ONLY to label initiativeMoveConfirmed.
}) {
  const {
    avgVolLen = 20,
    pullbackBars = 5,
    reversalBars = 3,
    lookbackBars = 60,
    trapVolSpikeRatio = 1.30,
    trapBreakVolMaxRatio = 1.00,
    reversalExpansionMin = 1.25,
    pullbackContractionMax = 0.85,
    absorptionVolMinRatio = 1.30,
    absorptionMaxDisplacementAtr = 0.25,
  } = opts;

  if (!Array.isArray(bars) || bars.length < Math.max(avgVolLen + 5, 30)) {
    return {
      flags: {
        pullbackContraction: false,
        reversalExpansion: false,
        absorptionDetected: false,
        distributionDetected: false,
        liquidityTrap: false,
        initiativeMoveConfirmed: false,
      },
      ratios: { pullbackVolRatio: null, reversalVolRatio: null },
      timing: { touchIndex: null, touchBarsAgo: null },
      volumeScore: 0,
      volumeConfirmed: false,
      diagnostics: {
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
      },
      ratios: { pullbackVolRatio: null, reversalVolRatio: null },
      timing: { touchIndex: null, touchBarsAgo: null },
      volumeScore: 0,
      volumeConfirmed: false,
      diagnostics: { error: "MISSING_ZONE" },
    };
  }

  const n = bars.length;
  const atr = atrFromBars(bars, 14) ?? null;

  // Compute baseline avg vol (SMA)
  const volSeries = bars.map((b) => Number(b.v || 0));
  const avgVol = sma(volSeries.slice(-avgVolLen)) ?? null;

  // Determine touchIndex (most recent touch within lookback)
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
    // Not touching zone -> Engine 1 gate should prevent calling us; still return stable payload.
    return {
      flags: {
        pullbackContraction: false,
        reversalExpansion: false,
        absorptionDetected: false,
        distributionDetected: false,
        liquidityTrap: false,
        initiativeMoveConfirmed: false,
      },
      ratios: { pullbackVolRatio: null, reversalVolRatio: null },
      timing: { touchIndex: null, touchBarsAgo: null },
      volumeScore: 0,
      volumeConfirmed: false,
      diagnostics: {
        avgVolLen,
        avgVol,
        atr,
        lookbackBars,
        note: "NO_TOUCH_FOUND_IN_LOOKBACK",
      },
    };
  }

  const touchBarsAgo = (n - 1) - ti;

  // Pullback segment: ti - pullbackBars ... ti-1
  const pbStart = Math.max(0, ti - pullbackBars);
  const pbEnd = Math.max(0, ti); // exclusive
  const pullbackVols = volSeries.slice(pbStart, pbEnd);
  const pullbackAvgVol = pullbackVols.length ? sma(pullbackVols) : null;

  const pullbackVolRatio =
    avgVol && pullbackAvgVol != null && avgVol > 0 ? pullbackAvgVol / avgVol : null;

  const pullbackContraction =
    pullbackVolRatio != null ? pullbackVolRatio <= pullbackContractionMax : false;

  // Reversal segment: ti ... ti + reversalBars - 1
  const rvStart = ti;
  const rvEnd = Math.min(n, ti + reversalBars);
  const reversalVols = volSeries.slice(rvStart, rvEnd);
  const reversalMaxVol = reversalVols.length ? Math.max(...reversalVols) : null;

  const reversalVolRatio =
    avgVol && reversalMaxVol != null && avgVol > 0 ? reversalMaxVol / avgVol : null;

  const reversalExpansion =
    reversalVolRatio != null ? reversalVolRatio >= reversalExpansionMin : false;

  // Timing bonus: first touch recency
  let timingBonus = 0;
  if (touchBarsAgo <= 20) timingBonus = 3;
  else if (touchBarsAgo <= 40) timingBonus = 2;
  else if (touchBarsAgo <= 60) timingBonus = 1;

  // Trap detection (simple + robust):
  // - A "break" bar closes outside zone on <= avg vol
  // - Next bar closes back inside zone
  // - Volume spikes after failure
  let liquidityTrap = false;
  if (avgVol && ti + 1 < n) {
    const b0 = bars[ti];
    const b1 = bars[ti + 1];

    const breakBar = barClosesOutsideZone(b0, zone);
    const breakVolRatio = avgVol > 0 ? (b0.v || 0) / avgVol : null;

    const backInside =
      barTouchesZone(b1, zone) && !barClosesOutsideZone(b1, zone);

    const spikeAfter =
      avgVol > 0 ? (b1.v || 0) / avgVol >= trapVolSpikeRatio : false;

    const breakWasNotConviction =
      breakVolRatio != null ? breakVolRatio <= trapBreakVolMaxRatio : false;

    if (breakBar && backInside && spikeAfter && breakWasNotConviction) {
      liquidityTrap = true;
    }
  }

  // Absorption detection:
  // High volume inside zone + low displacement (effort without result)
  let absorptionDetected = false;
  if (avgVol && atr && ti - 2 >= 0) {
    // Use a small local window around touch: (ti-2 ... ti+2)
    const a0 = Math.max(0, ti - 2);
    const a1 = Math.min(n, ti + 3);
    const windowBars = bars.slice(a0, a1);
    const windowVolAvg = sma(windowBars.map((b) => b.v || 0)) ?? null;
    const windowVolRatio = windowVolAvg != null && avgVol > 0 ? windowVolAvg / avgVol : null;

    const displacement = Math.abs(windowBars[windowBars.length - 1].c - windowBars[0].c);
    const maxDisp = atr * absorptionMaxDisplacementAtr;

    const insideMostly = windowBars.filter((b) => barTouchesZone(b, zone)).length >= Math.floor(windowBars.length * 0.6);

    if (
      insideMostly &&
      windowVolRatio != null &&
      windowVolRatio >= absorptionVolMinRatio &&
      displacement <= maxDisp
    ) {
      absorptionDetected = true;
    }
  }

  // Distribution/Accumulation hint (VERY light-touch; informational only):
  // We don’t decide direction, but we flag “supply-like” vs “demand-like” wick + location.
  let distributionDetected = false;
  let accumulationHint = false;

  const tb = bars[ti];
  const pos = zonePosition01(tb.c, zone); // 0 bottom, 1 top
  const w = wickDominance(tb);

  // If near top of zone and upper wicks dominate (rejection), it’s supply-ish.
  if (pos >= 0.70 && w.upperDominant && (tb.v || 0) >= (avgVol || 0) * 1.10) {
    distributionDetected = true;
  }
  // If near bottom of zone and lower wicks dominate (rejection), it’s demand-ish (accumulation context).
  if (pos <= 0.30 && w.lowerDominant && (tb.v || 0) >= (avgVol || 0) * 1.10) {
    accumulationHint = true;
  }

  // Score components (0–15)
  // A) Pullback contraction (0–6)
  let contractionScore = 0;
  if (pullbackVolRatio != null) {
    if (pullbackVolRatio <= 0.70) contractionScore = 6;
    else if (pullbackVolRatio <= 0.85) contractionScore = 4;
    else if (pullbackVolRatio <= 1.00) contractionScore = 2;
  }

  // B) Reversal expansion (0–6)
  let expansionScore = 0;
  if (reversalVolRatio != null) {
    if (reversalVolRatio >= 1.60) expansionScore = 6;
    else if (reversalVolRatio >= 1.25) expansionScore = 4;
    else if (reversalVolRatio >= 1.10) expansionScore = 2;
  }

  // C) Timing bonus (0–3)
  let volumeScore = contractionScore + expansionScore + timingBonus;

  // Penalties / caps (behavioral safety rails)
  // Trap: cap score hard
  if (liquidityTrap) {
    volumeScore = Math.min(volumeScore, 3);
  }

  // Distribution signal: suppress slightly (informational; not invalidation)
  if (distributionDetected) {
    volumeScore = Math.max(0, volumeScore - 4);
  }

  // Absorption itself is not negative; only suppress if there is no expansion
  if (absorptionDetected && !reversalExpansion) {
    volumeScore = Math.max(0, volumeScore - 2);
  }

  volumeScore = clamp(volumeScore, 0, 15);

  const volumeConfirmed = pullbackContraction && reversalExpansion && !liquidityTrap;

  // Initiative label (optional): only set if we’re given reactionScore
  const initiativeMoveConfirmed =
    reactionScore != null
      ? (reactionScore >= 6 && reversalExpansion && !liquidityTrap)
      : (reversalExpansion && !liquidityTrap);

  return {
    flags: {
      pullbackContraction,
      reversalExpansion,
      absorptionDetected,
      distributionDetected,
      liquidityTrap,
      initiativeMoveConfirmed,
      // Note: We do not output an explicit "accumulationDetected" boolean here
      // because Engine 1 already labels zone type. This hint is internal.
      // If you want it surfaced later, we can add a separate field safely.
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
      avgVolLen,
      avgVol,
      atr,
      pullbackBars,
      reversalBars,
      lookbackBars,
      pullbackRange: [pbStart, pbEnd - 1],
      reversalRange: [rvStart, rvEnd - 1],
      zone: { lo: zone.lo, hi: zone.hi },
      touchBar: { o: tb.o, h: tb.h, l: tb.l, c: tb.c, v: tb.v },
      zonePos01: pos,
      wick: w,
      accumulationHint, // internal hint only (Engine 1 owns the official label)
    },
  };
}
