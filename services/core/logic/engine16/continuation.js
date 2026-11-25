// services/core/logic/engine16/continuation.js

const CONTINUATION_WEAK_LOOKBACK = 3;
const CONTINUATION_DISPLACEMENT_LOOKBACK = 5;

function avg(values) {
  if (!Array.isArray(values) || !values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function toNum(x, fb = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function bodySize(bar) {
  if (!bar) return 0;
  return Math.abs(toNum(bar.c, 0) - toNum(bar.o, 0));
}

function rangeSize(bar) {
  if (!bar) return 0;
  return Math.max(0, toNum(bar.h, 0) - toNum(bar.l, 0));
}

function isBull(bar) {
  return !!bar && toNum(bar.c, 0) > toNum(bar.o, 0);
}

function isBear(bar) {
  return !!bar && toNum(bar.c, 0) < toNum(bar.o, 0);
}

function closeNearHigh(bar, pct = 0.35) {
  const r = rangeSize(bar);
  if (!(r > 0)) return false;
  return (toNum(bar.h, 0) - toNum(bar.c, 0)) <= r * pct;
}

function closeNearLow(bar, pct = 0.35) {
  const r = rangeSize(bar);
  if (!(r > 0)) return false;
  return (toNum(bar.c, 0) - toNum(bar.l, 0)) <= r * pct;
}

function avgBodyFromBars(bars) {
  const vals = (bars || []).map((b) => bodySize(b)).filter((v) => Number.isFinite(v));
  return vals.length ? avg(vals) : 0;
}

function barTouchesNumericZone(bar, zone) {
  if (!bar || !zone) return false;
  return bar.l <= zone.hi && bar.h >= zone.lo;
}

function bullishWickRejection(bar) {
  if (!bar) return false;
  const range = bar.h - bar.l;
  if (!(range > 0)) return false;
  const lowerWick = Math.min(bar.o, bar.c) - bar.l;
  const closeUpperHalf = bar.c >= bar.l + range / 2;
  return lowerWick / range >= 0.4 && closeUpperHalf;
}

function bearishWickRejection(bar) {
  if (!bar) return false;
  const range = bar.h - bar.l;
  if (!(range > 0)) return false;
  const upperWick = bar.h - Math.max(bar.o, bar.c);
  const closeLowerHalf = bar.c <= bar.l + range / 2;
  return upperWick / range >= 0.4 && closeLowerHalf;
}

export function emptyContinuationDebug() {
  return {
    validLongPullback: false,
    validShortPullback: false,
    weakDip: false,
    weakBounce: false,
    higherLowDetected: false,
    lowerHighDetected: false,
    failedBreakdownPattern: false,
    failedReclaimPattern: false,
    bullishRejectionWick: false,
    bearishRejectionWick: false,
    smallerRedBodies: false,
    smallerGreenBodies: false,
    bullishDisplacement: false,
    bearishDisplacement: false,
    breaksLongStructure: false,
    breaksShortStructure: false,
    lastBarTime: null,
    priorBarTime: null,
    avgRecentBody: null,
    lastBody: null,
  };
}

export function detectContinuation({
  bars,
  latestIndex,
  context,
  invalidated,
  hasPulledBack,
  insidePrimaryZone,
  insideSecondaryZone,
  state,
  pullbackZoneRaw,
  secondaryZoneRaw,
  exhaustionTrigger,
  reversalDetected,
  formatDisplayTimeFromMs,
}) {
  const base = {
    trendContinuation: false,

    continuationWatch: false,
    continuationWatchShort: false,
    continuationWatchLong: false,

    continuationTrigger: false,
    continuationTriggerShort: false,
    continuationTriggerLong: false,

    continuationWatchTime: null,
    continuationTriggerTime: null,

    debugContinuation: emptyContinuationDebug(),
  };

  if (!Array.isArray(bars) || latestIndex < 2) return base;
  if (invalidated) return base;
  if (!hasPulledBack) return base;
  if (exhaustionTrigger) return base;
  if (reversalDetected) return base;
  if (!(context === "LONG_CONTEXT" || context === "SHORT_CONTEXT")) return base;
  if (typeof formatDisplayTimeFromMs !== "function") return base;

  const bar = bars[latestIndex];
  const prev = bars[latestIndex - 1];
  const prev2 = bars[latestIndex - 2];

  if (!bar || !prev || !prev2) return base;

  const recentForAvg = bars.slice(
    Math.max(0, latestIndex - CONTINUATION_DISPLACEMENT_LOOKBACK),
    latestIndex
  );
  const avgRecentBody = avgBodyFromBars(recentForAvg);
  const lastBody = bodySize(bar);

  const zoneTouchedRecently = bars
    .slice(Math.max(0, latestIndex - CONTINUATION_WEAK_LOOKBACK), latestIndex + 1)
    .some(
      (b) =>
        barTouchesNumericZone(b, pullbackZoneRaw) ||
        barTouchesNumericZone(b, secondaryZoneRaw)
    );

  const validLongPullback =
    context === "LONG_CONTEXT" &&
    hasPulledBack &&
    !invalidated &&
    (insidePrimaryZone ||
      insideSecondaryZone ||
      state === "IN_PULLBACK" ||
      state === "DEEP_PULLBACK" ||
      zoneTouchedRecently);

  const validShortPullback =
    context === "SHORT_CONTEXT" &&
    hasPulledBack &&
    !invalidated &&
    (insidePrimaryZone ||
      insideSecondaryZone ||
      state === "IN_PULLBACK" ||
      state === "DEEP_PULLBACK" ||
      zoneTouchedRecently);

  const higherLowDetected =
    Number.isFinite(prev.l) &&
    Number.isFinite(prev2.l) &&
    prev.l >= prev2.l;

  const lowerHighDetected =
    Number.isFinite(prev.h) &&
    Number.isFinite(prev2.h) &&
    prev.h <= prev2.h;

  const failedBreakdownPattern =
    Number.isFinite(prev2.l) &&
    Number.isFinite(prev.l) &&
    Number.isFinite(prev.c) &&
    prev.l <= prev2.l &&
    prev.c > prev2.l;

  const failedReclaimPattern =
    Number.isFinite(prev2.h) &&
    Number.isFinite(prev.h) &&
    Number.isFinite(prev.c) &&
    prev.h >= prev2.h &&
    prev.c < prev2.h;

  const bullishRejectionWick = bullishWickRejection(prev) || bullishWickRejection(bar);
  const bearishRejectionWick = bearishWickRejection(prev) || bearishWickRejection(bar);

  const recentRedBodies = bars
    .slice(Math.max(0, latestIndex - CONTINUATION_WEAK_LOOKBACK), latestIndex)
    .filter(isBear)
    .map(bodySize);

  const recentGreenBodies = bars
    .slice(Math.max(0, latestIndex - CONTINUATION_WEAK_LOOKBACK), latestIndex)
    .filter(isBull)
    .map(bodySize);

  const smallerRedBodies =
    recentRedBodies.length >= 2
      ? recentRedBodies[recentRedBodies.length - 1] <= recentRedBodies[0]
      : false;

  const smallerGreenBodies =
    recentGreenBodies.length >= 2
      ? recentGreenBodies[recentGreenBodies.length - 1] <= recentGreenBodies[0]
      : false;

  const weakDip =
    validLongPullback &&
    (higherLowDetected ||
      failedBreakdownPattern ||
      bullishRejectionWick ||
      smallerRedBodies);

  const weakBounce =
    validShortPullback &&
    (lowerHighDetected ||
      failedReclaimPattern ||
      bearishRejectionWick ||
      smallerGreenBodies);

  const bullishDisplacement =
    validLongPullback &&
    isBull(bar) &&
    lastBody > 0 &&
    lastBody >= Math.max(avgRecentBody * 1.15, 0.12) &&
    closeNearHigh(bar, 0.35);

  const bearishDisplacement =
    validShortPullback &&
    isBear(bar) &&
    lastBody > 0 &&
    lastBody >= Math.max(avgRecentBody * 1.15, 0.12) &&
    closeNearLow(bar, 0.35);

  const breaksLongStructure =
    Number.isFinite(prev.h) &&
    Number.isFinite(bar.c) &&
    bar.c > prev.h;

  const breaksShortStructure =
    Number.isFinite(prev.l) &&
    Number.isFinite(bar.c) &&
    bar.c < prev.l;

  const continuationTriggerLong =
    validLongPullback &&
    weakDip &&
    bullishDisplacement &&
    breaksLongStructure;

  const continuationTriggerShort =
    validShortPullback &&
    weakBounce &&
    bearishDisplacement &&
    breaksShortStructure;

  const continuationWatchLong =
    validLongPullback &&
    weakDip &&
    !continuationTriggerLong;

  const continuationWatchShort =
    validShortPullback &&
    weakBounce &&
    !continuationTriggerShort;

  const continuationTrigger = continuationTriggerLong || continuationTriggerShort;
  const continuationWatch = continuationWatchLong || continuationWatchShort;
  const trendContinuation = continuationWatch || continuationTrigger;

  return {
    trendContinuation,

    continuationWatch,
    continuationWatchShort,
    continuationWatchLong,

    continuationTrigger,
    continuationTriggerShort,
    continuationTriggerLong,

    continuationWatchTime: continuationWatch ? formatDisplayTimeFromMs(bar.t) : null,
    continuationTriggerTime: continuationTrigger ? formatDisplayTimeFromMs(bar.t) : null,

    debugContinuation: {
      validLongPullback,
      validShortPullback,
      weakDip,
      weakBounce,
      higherLowDetected,
      lowerHighDetected,
      failedBreakdownPattern,
      failedReclaimPattern,
      bullishRejectionWick,
      bearishRejectionWick,
      smallerRedBodies,
      smallerGreenBodies,
      bullishDisplacement,
      bearishDisplacement,
      breaksLongStructure,
      breaksShortStructure,
      lastBarTime: formatDisplayTimeFromMs(bar.t),
      priorBarTime: formatDisplayTimeFromMs(prev.t),
      avgRecentBody: round2(avgRecentBody),
      lastBody: round2(lastBody),
    },
  };
}
