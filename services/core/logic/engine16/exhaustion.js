// services/core/logic/engine16/exhaustion.js

export function emptyExhaustionDebug(lookbackBars = 5) {
  return {
    checkedBars: lookbackBars,
    detectedBarTime: null,
    detectedBarPrice: null,
    nearHigh: false,
    nearLow: false,
    upperWickStrong: false,
    lowerWickStrong: false,
    shortSequenceConfirmed: false,
    longSequenceConfirmed: false,
    rejectionCountNearHighs: 0,
    failedExtensionCountNearHighs: 0,
    rejectionCountNearLows: 0,
    failedExtensionCountNearLows: 0,
    lastBarCheckedTime: null,
  };
}

function avg(values) {
  if (!Array.isArray(values) || !values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function getBodies(bars) {
  return bars
    .map((b) => Math.abs((b?.c ?? 0) - (b?.o ?? 0)))
    .filter(Number.isFinite);
}

export function confirmExhaustionPhases({
  bars,
  sessionHigh,
  sessionLow,
  latestIndex,
  lookbackBars,
  formatDisplayTimeFromMs,
  round2,
}) {
  const start = Math.max(1, latestIndex - lookbackBars + 1);

  let rejectionCountNearHighs = 0;
  let failedExtensionCountNearHighs = 0;
  let rejectionCountNearLows = 0;
  let failedExtensionCountNearLows = 0;

  let shortEarlyIdx = null;
  let longEarlyIdx = null;
  let shortTriggerIdx = null;
  let longTriggerIdx = null;

  let lastDebug = emptyExhaustionDebug(lookbackBars);

  for (let i = start; i <= latestIndex; i++) {
    const bar = bars[i];
    const prev = bars[i - 1];
    if (!bar || !prev) continue;

    const range = Number(bar.h) - Number(bar.l);
    if (!(range > 0)) continue;

    const upperWick = bar.h - Math.max(bar.o, bar.c);
    const lowerWick = Math.min(bar.o, bar.c) - bar.l;

    const upperWickStrong = upperWick / range >= 0.25;
    const lowerWickStrong = lowerWick / range >= 0.25;

    const bearishClose =
      Number.isFinite(bar.c) &&
      Number.isFinite(bar.o) &&
      bar.c < bar.o;

    const bullishClose =
      Number.isFinite(bar.c) &&
      Number.isFinite(bar.o) &&
      bar.c > bar.o;

    const nearHigh =
      Number.isFinite(bar.h) &&
      Number.isFinite(sessionHigh) &&
      bar.h >= sessionHigh - range * 2;

    const nearLow =
      Number.isFinite(bar.l) &&
      Number.isFinite(sessionLow) &&
      bar.l <= sessionLow + range * 2;

    const failedHigherPush =
      Number.isFinite(prev.h) &&
      Number.isFinite(bar.h) &&
      bar.h <= prev.h + Math.max(0.05, range * 0.1);

    const failedLowerPush =
      Number.isFinite(prev.l) &&
      Number.isFinite(bar.l) &&
      bar.l >= prev.l - Math.max(0.05, range * 0.1);

    if (nearHigh && (upperWickStrong || bearishClose || bar.c < prev.c)) {
      rejectionCountNearHighs += 1;
    }
    if (nearHigh && failedHigherPush) {
      failedExtensionCountNearHighs += 1;
    }

    if (nearLow && (lowerWickStrong || bullishClose || bar.c > prev.c)) {
      rejectionCountNearLows += 1;
    }
    if (nearLow && failedLowerPush) {
      failedExtensionCountNearLows += 1;
    }

    const shortSequenceConfirmed =
      rejectionCountNearHighs >= 2 &&
      failedExtensionCountNearHighs >= 2;

    const longSequenceConfirmed =
      rejectionCountNearLows >= 2 &&
      failedExtensionCountNearLows >= 2;

    if (shortSequenceConfirmed && shortEarlyIdx == null) {
      shortEarlyIdx = i;
    }

    if (longSequenceConfirmed && longEarlyIdx == null) {
      longEarlyIdx = i;
    }

    const recentBodies = getBodies(bars.slice(Math.max(0, i - 5), i));
    const avgBody = avg(recentBodies) || 0;
    const body = Math.abs(bar.c - bar.o);

    const strongBearishCandle =
      body >= avgBody * 1.3 &&
      bar.c < bar.o &&
      (bar.c - bar.l) <= range * 0.35;

    const strongBullishCandle =
      body >= avgBody * 1.3 &&
      bar.c > bar.o &&
      (bar.h - bar.c) <= range * 0.35;

    const breaksShortStructure =
      Number.isFinite(prev.l) &&
      Number.isFinite(bar.c) &&
      bar.c < prev.l;

    const breaksLongStructure =
      Number.isFinite(prev.h) &&
      Number.isFinite(bar.c) &&
      bar.c > prev.h;

    if (shortEarlyIdx != null && shortTriggerIdx == null) {
      if (strongBearishCandle && breaksShortStructure) {
        shortTriggerIdx = i;
      }
    }

    if (longEarlyIdx != null && longTriggerIdx == null) {
      if (strongBullishCandle && breaksLongStructure) {
        longTriggerIdx = i;
      }
    }

    lastDebug = {
      checkedBars: lookbackBars,
      detectedBarTime:
        shortTriggerIdx != null
          ? formatDisplayTimeFromMs(bars[shortTriggerIdx]?.t)
          : longTriggerIdx != null
            ? formatDisplayTimeFromMs(bars[longTriggerIdx]?.t)
            : null,
      detectedBarPrice:
        shortTriggerIdx != null
          ? round2(bars[shortTriggerIdx]?.h)
          : longTriggerIdx != null
            ? round2(bars[longTriggerIdx]?.l)
            : null,
      nearHigh,
      nearLow,
      upperWickStrong,
      lowerWickStrong,
      shortSequenceConfirmed,
      longSequenceConfirmed,
      rejectionCountNearHighs,
      failedExtensionCountNearHighs,
      rejectionCountNearLows,
      failedExtensionCountNearLows,
      lastBarCheckedTime: formatDisplayTimeFromMs(bar.t),
    };
  }

  // ==========================================
  // Directional resolution / mutual exclusion
  // ==========================================
  let resolvedShortEarlyIdx = shortEarlyIdx;
  let resolvedLongEarlyIdx = longEarlyIdx;
  let resolvedShortTriggerIdx = shortTriggerIdx;
  let resolvedLongTriggerIdx = longTriggerIdx;

  // If both early states exist, prefer the side that actually triggered.
  // If neither triggered, prefer the most recent early state.
  if (resolvedShortEarlyIdx != null && resolvedLongEarlyIdx != null) {
    if (resolvedShortTriggerIdx != null && resolvedLongTriggerIdx == null) {
      resolvedLongEarlyIdx = null;
      resolvedLongTriggerIdx = null;
    } else if (resolvedLongTriggerIdx != null && resolvedShortTriggerIdx == null) {
      resolvedShortEarlyIdx = null;
      resolvedShortTriggerIdx = null;
    } else {
      if (resolvedShortEarlyIdx > resolvedLongEarlyIdx) {
        resolvedLongEarlyIdx = null;
        resolvedLongTriggerIdx = null;
      } else if (resolvedLongEarlyIdx > resolvedShortEarlyIdx) {
        resolvedShortEarlyIdx = null;
        resolvedShortTriggerIdx = null;
      } else {
        // Same-bar ambiguity: clear both and force neutral/watch behavior upstream
        resolvedShortEarlyIdx = null;
        resolvedLongEarlyIdx = null;
        resolvedShortTriggerIdx = null;
        resolvedLongTriggerIdx = null;
      }
    }
  }

  // If both triggers somehow exist, prefer the most recent one.
  // If they occur on the same bar, clear both and let upstream remain WATCH.
  if (resolvedShortTriggerIdx != null && resolvedLongTriggerIdx != null) {
    if (resolvedShortTriggerIdx > resolvedLongTriggerIdx) {
      resolvedLongTriggerIdx = null;
      resolvedLongEarlyIdx = null;
    } else if (resolvedLongTriggerIdx > resolvedShortTriggerIdx) {
      resolvedShortTriggerIdx = null;
      resolvedShortEarlyIdx = null;
    } else {
      resolvedShortTriggerIdx = null;
      resolvedLongTriggerIdx = null;
      resolvedShortEarlyIdx = null;
      resolvedLongEarlyIdx = null;
    }
  }

  return {
    shortEarlyIdx: resolvedShortEarlyIdx,
    longEarlyIdx: resolvedLongEarlyIdx,
    shortTriggerIdx: resolvedShortTriggerIdx,
    longTriggerIdx: resolvedLongTriggerIdx,
    debug: lastDebug,
  };
}
