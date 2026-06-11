// services/core/logic/engine22/wave/lifecycle/abcUpCProgress.js

import {
  toNum,
  roundToTick,
  formatTimeSec,
} from "./lifecycleUtils.js";

export function buildFastUpsideMove({
  bars = [],
  maxBars = 6,
  minPts = 35,
  tickSize = 0.25,
} = {}) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return {
      active: false,
      state: "FAST_UPSIDE_MOVE_UNAVAILABLE",
      movePts: null,
      bars: null,
      read: "Not enough bars to measure fast C-up movement.",
    };
  }

  let best = null;

  for (let i = 0; i < bars.length - 1; i++) {
    const startBar = bars[i];
    const startLow =
      toNum(startBar?.low) ??
      toNum(startBar?.close);

    if (startLow === null) continue;

    const endIdx = Math.min(bars.length - 1, i + maxBars);
    const window = bars.slice(i, endIdx + 1);

    let high = null;
    let highBar = null;

    for (const bar of window) {
      const h = toNum(bar?.high);
      if (h === null) continue;

      if (high === null || h > high) {
        high = h;
        highBar = bar;
      }
    }

    if (high === null) continue;

    const movePts = high - startLow;

    if (!best || movePts > best.movePts) {
      best = {
        movePts,
        bars: window.length,
        startPrice: startLow,
        startTimeSec: startBar.timeSec,
        startTime: formatTimeSec(startBar.timeSec),
        highPrice: high,
        highTimeSec: highBar?.timeSec ?? null,
        highTime: formatTimeSec(highBar?.timeSec),
      };
    }
  }

  if (!best) {
    return {
      active: false,
      state: "FAST_UPSIDE_MOVE_UNAVAILABLE",
      movePts: null,
      bars: null,
      read: "Fast upside move could not be measured.",
    };
  }

  const active = best.movePts >= minPts;

  return {
    active,
    state: active
      ? "FAST_C_UP_SPIKE_DETECTED"
      : "NO_FAST_C_UP_SPIKE",
    movePts: roundToTick(best.movePts, tickSize),
    bars: best.bars,
    startPrice: roundToTick(best.startPrice, tickSize),
    startTimeSec: best.startTimeSec,
    startTime: best.startTime,
    highPrice: roundToTick(best.highPrice, tickSize),
    highTimeSec: best.highTimeSec,
    highTime: best.highTime,
    read: active
      ? `Fast C-up spike detected: ${roundToTick(best.movePts, tickSize)} points in ${best.bars} bars.`
      : `No fast C-up spike detected. Best move was ${roundToTick(best.movePts, tickSize)} points in ${best.bars} bars.`,
  };
}

export function buildCUpProgress({
  bars = [],
  afterSec = null,
  bLow = null,
  originLow = null,
  range = null,
  cUpTargets = null,
  currentPrice = null,
  tickSize = 0.25,
} = {}) {
  const base = toNum(bLow);
  const origin = toNum(originLow);
  const waveRange = toNum(range);
  const price = toNum(currentPrice);

  if (base === null || waveRange === null || waveRange <= 0) {
    return {
      active: false,
      state: "C_UP_PROGRESS_UNAVAILABLE",
      reasonCodes: ["C_UP_BASE_OR_RANGE_MISSING"],
    };
  }

  const c50 = roundToTick(base + waveRange * 0.5, tickSize);
  const c618 = roundToTick(base + waveRange * 0.618, tickSize);

  const scopedBars =
    Array.isArray(bars) && afterSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) > Number(afterSec))
      : Array.isArray(bars)
      ? bars
      : [];

  let highest = null;

  for (const bar of scopedBars) {
    const high = toNum(bar?.high);
    if (high === null) continue;

    if (!highest || high > highest.price) {
      highest = {
        price: high,
        timeSec: bar.timeSec,
        time: formatTimeSec(bar.timeSec),
        close: toNum(bar?.close),
      };
    }
  }

  const highestHigh = toNum(highest?.price) ?? price;

  const targets = [
    ["c2618", cUpTargets?.c2618],
    ["c200", cUpTargets?.c200],
    ["c1618", cUpTargets?.c1618],
    ["c1272", cUpTargets?.c1272],
    ["c100", cUpTargets?.c100],
    ["c618", c618],
    ["c50", c50],
  ];

  const highestTargetHit =
    targets.find(([, level]) => {
      const target = toNum(level);
      return target !== null && highestHigh !== null && highestHigh >= target;
    })?.[0] || null;

  const nextTarget =
    [...targets]
      .reverse()
      .find(([, level]) => {
        const target = toNum(level);
        return target !== null && highestHigh !== null && highestHigh < target;
      })?.[0] || null;

  const reached50 = highestHigh !== null && c50 !== null && highestHigh >= c50;
  const reached618 =
    highestHigh !== null && c618 !== null && highestHigh >= c618;
  const reached100 =
    highestHigh !== null &&
    toNum(cUpTargets?.c100) !== null &&
    highestHigh >= toNum(cUpTargets.c100);

  const fastUpsideMove = buildFastUpsideMove({
    bars: scopedBars,
    maxBars: 6,
    minPts: 35,
    tickSize,
  });

  const belowOrigin = price !== null && origin !== null && price < origin;
  const belowStructuralB = price !== null && base !== null && price < base;

  let state = "C_UP_NOT_CONFIRMED";
  let read = "C-up progress is not confirmed yet.";

  if (belowStructuralB && reached50) {
    state = "W2_BOUNCE_FAILED_POSSIBLE_W3_DOWN_STARTED";
    read =
      "C-up progressed after B, but price later broke below the structural B low. This is no longer a new B pullback; it is possible Wave 3 down behavior.";
  } else if (belowOrigin && reached50) {
    state = "C_UP_REJECTED_ORIGIN_LOST";
    read =
      "C-up progressed after B, but price later lost the origin. Watch for W2 bounce failure / W3 down risk.";
  } else if (reached100) {
    state = "C_UP_TARGET_ZONE_ACTIVE";
    read =
      "C-up reached the 1.000 target or higher. Start watching for Wave C maturity / completion behavior.";
  } else if (reached618) {
    state = "C_UP_LEG_ACTIVE_WATCH_C_COMPLETION";
    read =
      "C-up reached the 0.618 progress level. Start watching for Wave C completion into upper targets.";
  } else if (reached50) {
    state = "C_UP_LEG_ACTIVE";
    read =
      "C-up reached the 0.500 progress level. Wave C is active; watch the 0.618 and 1.000 target zones.";
  }

  return {
    active: reached50 || reached618 || reached100,
    state,

    bLow: roundToTick(base, tickSize),
    bTimeSec: afterSec,

    cProgressLevels: {
      c50,
      c618,
    },

    highestHighAfterB:
      highestHigh !== null ? roundToTick(highestHigh, tickSize) : null,
    highestHighAfterBTime: highest?.time || null,
    highestHighAfterBSec: highest?.timeSec ?? null,

    highestTargetHit,
    nextTarget,

    reached50,
    reached618,
    reached100,
    fastUpsideMove,

    currentPrice: price !== null ? roundToTick(price, tickSize) : null,
    belowOrigin,
    belowStructuralB,

    read,

    reasonCodes: [
      "ABC_UP_C_PROGRESS_BUILT",
      reached50 ? "ABC_UP_C_REACHED_050" : null,
      reached618 ? "ABC_UP_C_REACHED_0618" : null,
      reached100 ? "ABC_UP_C_REACHED_1000" : null,
      highestTargetHit
        ? `ABC_UP_HIGHEST_TARGET_${String(highestTargetHit).toUpperCase()}`
        : null,
      fastUpsideMove?.active ? "ABC_UP_FAST_C_UP_SPIKE_DETECTED" : null,
      belowOrigin ? "ABC_UP_CURRENT_PRICE_BELOW_ORIGIN" : null,
      belowStructuralB ? "ABC_UP_CURRENT_PRICE_BELOW_STRUCTURAL_B" : null,
      state,
    ].filter(Boolean),
  };
}
