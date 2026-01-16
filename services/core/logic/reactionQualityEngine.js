// src/services/core/logic/reactionQualityEngine.js
// Engine 3 — Reaction Quality Engine (RQE)
//
// Purpose:
//   Measure how price reacts at a selected zone/shelf.
//   Replace candle-pattern obsession with objective behavior metrics.
//
// Outputs:
//   rejectionSpeed (0..1)
//   displacementAtrRaw (>=0)
//   displacementScore (0..4)
//   structureState: HOLD | FAKEOUT_RECLAIM | FAILURE
//   reactionScore (0..10) (FAILURE caps to 2.0)
//
// Notes:
//   - No dependency on Engine 1/2; Engine 3 is purely evaluative.
//   - Designed for OHLCV arrays where bars are chronological (oldest -> newest).
//   - Touch selection: by default, uses the MOST RECENT touch in the series.

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function inferSide(zone) {
  // Accept side: "demand" | "supply" | "bullish" | "bearish"
  const s = (zone?.side || "").toLowerCase();
  if (s.includes("dem") || s.includes("bull") || s === "long") return "demand";
  if (s.includes("sup") || s.includes("bear") || s === "short") return "supply";
  return null;
}

function barTouchesZone(bar, zone) {
  // Touch if ranges overlap
  return bar.low <= zone.hi && bar.high >= zone.lo;
}

function closeInsideZone(close, zone) {
  return close >= zone.lo && close <= zone.hi;
}

function confirmedExitIndex(bars, zone, side, startIdx, windowBars) {
  // "Exit and stays out": exit on close beyond boundary,
  // and next bar does not close back inside zone.
  const end = Math.min(bars.length - 1, startIdx + windowBars);
  for (let i = startIdx; i <= end; i++) {
    const c = bars[i].close;
    if (side === "demand") {
      if (c > zone.hi) {
        const next = bars[i + 1];
        if (!next) return i;
        if (!closeInsideZone(next.close, zone)) return i;
      }
    } else if (side === "supply") {
      if (c < zone.lo) {
        const next = bars[i + 1];
        if (!next) return i;
        if (!closeInsideZone(next.close, zone)) return i;
      }
    }
  }
  return null;
}

function computeRejectionSpeedPoints(exitBars) {
  // exitBars = number of bars from touch to confirmed exit (1-based)
  // Thresholds (LOCKED):
  // 1 => 4.0
  // 2 => 3.0
  // 3 => 2.0
  // 4-5 => 1.0
  // >=6 => 0.0
  if (exitBars <= 1) return 4.0;
  if (exitBars === 2) return 3.0;
  if (exitBars === 3) return 2.0;
  if (exitBars === 4 || exitBars === 5) return 1.0;
  return 0.0;
}

function computeDisplacementPoints(dispAtrRaw) {
  // Thresholds (LOCKED):
  // >=1.25 => 4.0
  // 0.75..1.24 => 3.0
  // 0.40..0.74 => 2.0
  // 0.20..0.39 => 1.0
  // <0.20 => 0.0
  if (dispAtrRaw >= 1.25) return 4.0;
  if (dispAtrRaw >= 0.75) return 3.0;
  if (dispAtrRaw >= 0.40) return 2.0;
  if (dispAtrRaw >= 0.20) return 1.0;
  return 0.0;
}

function computeStructureState({
  bars,
  zone,
  side,
  touchIndex,
  windowBars,
  atrAtTouch,
  breakDepthAtr = 0.25,
  reclaimWindowBars = 3,
}) {
  // Structure outcome definitions:
  // HOLD: no meaningful break close beyond zone boundary +/- breakDepth
  // FAKEOUT_RECLAIM: break close then reclaim within reclaimWindow
  // FAILURE: break close then no reclaim within reclaimWindow (acceptance)

  const breakDepthPts = breakDepthAtr * atrAtTouch;
  const end = Math.min(bars.length - 1, touchIndex + windowBars);

  const breaks = []; // indices where a break close occurs
  for (let i = touchIndex; i <= end; i++) {
    const c = bars[i].close;
    if (side === "demand") {
      if (c < (zone.lo - breakDepthPts)) breaks.push(i);
    } else if (side === "supply") {
      if (c > (zone.hi + breakDepthPts)) breaks.push(i);
    }
  }

  if (breaks.length === 0) {
    return { state: "HOLD", structurePoints: 2.0, firstBreakIndex: null, breakDepthPts };
  }

  const firstBreakIndex = breaks[0];
  const reclaimEnd = Math.min(bars.length - 1, firstBreakIndex + reclaimWindowBars);

  let reclaimed = false;
  for (let j = firstBreakIndex + 1; j <= reclaimEnd; j++) {
    const c = bars[j].close;
    if (side === "demand") {
      if (c > zone.hi) {
        reclaimed = true;
        break;
      }
    } else if (side === "supply") {
      if (c < zone.lo) {
        reclaimed = true;
        break;
      }
    }
  }

  if (reclaimed) {
    return { state: "FAKEOUT_RECLAIM", structurePoints: 1.0, firstBreakIndex, breakDepthPts };
  }

  return { state: "FAILURE", structurePoints: 0.0, firstBreakIndex, breakDepthPts };
}

function computeVolumeContextFlags({ bars, touchIndex, windowBars, volLookback = 20, volSpikeMult = 1.8 }) {
  // Volume is CONTEXT only (per your chapters). We don't gate on it; we add flags.
  // - "ABSORPTION_RISK": elevated volume + weak displacement (handled in main by combining with disp)
  // Here we only compute "volumeSpikeNearTouch" as a raw input to flags.

  const start = Math.max(0, touchIndex - volLookback);
  const prior = bars.slice(start, touchIndex).map(b => b.volume).filter(isFiniteNumber);
  const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;

  const end = Math.min(bars.length - 1, touchIndex + windowBars);
  let maxVol = null;
  for (let i = touchIndex; i <= end; i++) {
    const v = bars[i].volume;
    if (isFiniteNumber(v)) maxVol = maxVol == null ? v : Math.max(maxVol, v);
  }

  const volumeSpikeNearTouch = (avg && maxVol != null) ? (maxVol >= avg * volSpikeMult) : false;

  return { volumeAvgPrior: avg, volumeMaxInWindow: maxVol, volumeSpikeNearTouch };
}

/**
 * Compute reaction quality at zone based on recent bars.
 *
 * @param {Object} params
 * @param {Array}  params.bars - OHLCV bars in chronological order (oldest -> newest).
 * @param {Object} params.zone - { lo:number, hi:number, side?:string, id?:string, type?:string }
 * @param {number|Array} params.atr - Either a single ATR value (applied at touch) OR array aligned to bars length.
 * @param {Object} [params.opts]
 * @returns {Object} reaction payload
 */
export function computeReactionQuality(params) {
  const { bars, zone, atr, opts = {} } = params || {};
  if (!Array.isArray(bars) || bars.length < 10) throw new Error("RQE: bars must be an array with sufficient length.");
  if (!zone || !isFiniteNumber(zone.lo) || !isFiniteNumber(zone.hi) || zone.lo >= zone.hi) {
    throw new Error("RQE: zone must include valid {lo, hi} bounds.");
  }

  const side = inferSide(zone) || opts.side || "demand"; // default demand if unknown
  const windowBars = isFiniteNumber(opts.windowBars) ? Math.max(2, Math.floor(opts.windowBars)) : 6;

  // Find MOST RECENT touch by default
  let touchIndex = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (barTouchesZone(bars[i], zone)) {
      touchIndex = i;
      break;
    }
  }

  if (touchIndex == null) {
    return {
      zoneId: zone.id || null,
      tf: opts.tf || null,
      touchIndex: null,
      windowBars,
      side,
      reactionScore: 0,
      reason: "NO_TOUCH",
      flags: { NO_TOUCH: true },
    };
  }

  const atrAtTouch = Array.isArray(atr)
    ? (isFiniteNumber(atr[touchIndex]) ? atr[touchIndex] : null)
    : (isFiniteNumber(atr) ? atr : null);

  if (!atrAtTouch || atrAtTouch <= 0) {
    throw new Error("RQE: ATR at touch must be provided (number or array aligned to bars).");
  }

  // 1) Rejection speed
  const exitIdx = confirmedExitIndex(bars, zone, side, touchIndex, windowBars);
  const exitBars = exitIdx == null ? (windowBars + 1) : (exitIdx - touchIndex + 1);
  const speedPoints = computeRejectionSpeedPoints(exitBars);

  // "re-enter immediately" penalty: if we got an exit, but close returns inside zone in next 2 bars
  let reenteredSoon = false;
  if (exitIdx != null) {
    const endRe = Math.min(bars.length - 1, exitIdx + 2);
    for (let i = exitIdx + 1; i <= endRe; i++) {
      if (closeInsideZone(bars[i].close, zone)) {
        reenteredSoon = true;
        break;
      }
    }
  }
  const speedPointsAdj = clamp(speedPoints - (reenteredSoon ? 1.0 : 0.0), 0.0, 4.0);

  // 2) Displacement (ATR)
  const end = Math.min(bars.length - 1, touchIndex + windowBars);
  let bestPts = 0;

  if (side === "demand") {
    let maxHigh = -Infinity;
    for (let i = touchIndex; i <= end; i++) maxHigh = Math.max(maxHigh, bars[i].high);
    bestPts = Math.max(0, maxHigh - zone.hi);
  } else {
    let minLow = Infinity;
    for (let i = touchIndex; i <= end; i++) minLow = Math.min(minLow, bars[i].low);
    bestPts = Math.max(0, zone.lo - minLow);
  }

  const displacementAtrRaw = bestPts / atrAtTouch;
  const displacementPoints = computeDisplacementPoints(displacementAtrRaw);

  // 3) Structure state
  const { state: structureState, structurePoints, firstBreakIndex, breakDepthPts } = computeStructureState({
    bars,
    zone,
    side,
    touchIndex,
    windowBars,
    atrAtTouch,
    breakDepthAtr: isFiniteNumber(opts.breakDepthAtr) ? opts.breakDepthAtr : 0.25,
    reclaimWindowBars: isFiniteNumber(opts.reclaimWindowBars) ? Math.max(1, Math.floor(opts.reclaimWindowBars)) : 3,
  });

  // Volume context flags (optional)
  const volCtx = computeVolumeContextFlags({
    bars,
    touchIndex,
    windowBars,
    volLookback: isFiniteNumber(opts.volLookback) ? Math.max(5, Math.floor(opts.volLookback)) : 20,
    volSpikeMult: isFiniteNumber(opts.volSpikeMult) ? opts.volSpikeMult : 1.8,
  });

  // Absorption risk heuristic: volume spike + weak displacement
  const absorptionRisk = !!(volCtx.volumeSpikeNearTouch && displacementAtrRaw < 0.30);

  // Final score (0–10)
  let reactionScore = speedPointsAdj + displacementPoints + structurePoints;

  // FAILURE hard-cap (LOCKED)
  if (structureState === "FAILURE") reactionScore = Math.min(reactionScore, 2.0);

  // Flags (explain, do not decide)
  const flags = {
    NO_TOUCH: false,
    FAST_REJECTION: exitBars <= 2,
    STRONG_DISPLACEMENT: displacementAtrRaw >= 0.75,
    STRUCTURE_HELD: structureState === "HOLD",
    FAKEOUT_RECLAIM: structureState === "FAKEOUT_RECLAIM",
    ZONE_FAILURE: structureState === "FAILURE",
    REENTERED_SOON: reenteredSoon,
    VOLUME_SPIKE_NEAR_TOUCH: !!volCtx.volumeSpikeNearTouch,
    ABSORPTION_RISK: absorptionRisk,
  };

  return {
    zoneId: zone.id || null,
    tf: opts.tf || null,
    side,
    touchIndex,
    windowBars,

    // speed
    exitBars,
    rejectionSpeedPoints: speedPointsAdj,

    // displacement
    bestExcursionPts: bestPts,
    atr: atrAtTouch,
    displacementAtrRaw,
    displacementPoints,

    // structure
    structureState,
    structurePoints,
    firstBreakIndex,
    breakDepthPts,

    // volume context
    volumeAvgPrior: volCtx.volumeAvgPrior,
    volumeMaxInWindow: volCtx.volumeMaxInWindow,

    reactionScore: Math.round(reactionScore * 10) / 10,
    flags,
  };
}
