function toFinite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeStrategy1Bars(bars10m = []) {
  const rows = Array.isArray(bars10m) ? bars10m : [];
  const warnings = [];

  const bars = rows
    .map((bar, index) => {
      const time = normalizeTime(bar?.time ?? bar?.t ?? bar?.tSec);
      const open = toFinite(bar?.open ?? bar?.o);
      const high = toFinite(bar?.high ?? bar?.h);
      const low = toFinite(bar?.low ?? bar?.l);
      const close = toFinite(bar?.close ?? bar?.c);
      const volume = toFinite(bar?.volume ?? bar?.v);

      if (!time || [open, high, low, close].some((x) => x === null)) {
        warnings.push(`ENGINE26_STRATEGY1_BAR_${index}_INVALID`);
        return null;
      }

      const explicitCompleted = bar?.completed === true;
      const completed = explicitCompleted || index < rows.length - 1;

      return {
        time,
        open,
        high,
        low,
        close,
        volume,
        completed,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

  return { bars, warnings };
}

export function buildStrategy1Facts({
  bars10m = [],
  entryZone,
  locationInvalidationBoundary,
} = {}) {
  const { bars, warnings } = normalizeStrategy1Bars(bars10m);
  const low = toFinite(entryZone?.low);
  const high = toFinite(entryZone?.high);
  const midline = toFinite(entryZone?.midline);
  const invalidationBoundary = toFinite(locationInvalidationBoundary);

  if ([low, high, midline, invalidationBoundary].some((x) => x === null)) {
    return {
      barsNormalized: bars,
      interactionFacts: { interactionCount: 0, interactionTimes: [] },
      sweepFacts: {},
      lowerWickFacts: {},
      reclaimFacts: {},
      postReclaimFacts: {},
      invalidationFacts: {},
      warnings: [...warnings, "ENGINE26_STRATEGY1_FACT_BOUNDARY_MISSING"],
    };
  }

  const interactions = bars.filter((bar) => bar.high >= low && bar.low <= high);
  const sweeps = bars.filter((bar) => bar.low < low);
  const completedSweeps = sweeps.filter((bar) => bar.completed);
  const invalidationBreaches = bars.filter((bar) => bar.low < invalidationBoundary);
  const completedInvalidations = bars.filter(
    (bar) => bar.completed && bar.close < invalidationBoundary
  );

  const wickRows = bars.map((bar) => {
    const bodySize = Math.abs(bar.close - bar.open);
    const lowerWickPoints = Math.max(0, Math.min(bar.open, bar.close) - bar.low);
    return {
      candleTime: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      completed: bar.completed,
      bodySize,
      lowerWickPoints,
      lowerWickToBodyRatio: lowerWickPoints / Math.max(bodySize, 0.25),
      penetrationBelowEntryZone: Math.max(0, low - bar.low),
      penetrationBelowInvalidationBoundary: Math.max(0, invalidationBoundary - bar.low),
      closedInsideZone: bar.close >= low && bar.close <= high,
      closedAboveZone: bar.close > high,
      lowerWickObserved: lowerWickPoints > 0,
      lowerWickBelowZoneObserved: lowerWickPoints > 0 && bar.low < low,
    };
  });

  const strongestWick = wickRows
    .filter((row) => row.lowerWickObserved)
    .sort((a, b) => {
      if (b.lowerWickToBodyRatio !== a.lowerWickToBodyRatio) {
        return b.lowerWickToBodyRatio - a.lowerWickToBodyRatio;
      }
      return b.lowerWickPoints - a.lowerWickPoints;
    })[0] || null;

  let firstReclaimAt = null;
  let latestReclaimAt = null;
  let currentReclaimSequence = 0;
  let sweepSeen = false;
  const reclaimRows = [];

  for (const bar of bars) {
    if (bar.low < low) sweepSeen = true;
    if (sweepSeen && bar.completed && bar.close >= low) {
      currentReclaimSequence += 1;
      const reclaim = {
        reclaimTime: bar.time,
        reclaimClose: bar.close,
        closedBackInsideZone: bar.close >= low && bar.close <= high,
        closedAboveZoneLow: bar.close >= low,
        closedAboveMidline: bar.close >= midline,
        closedAboveZoneHigh: bar.close > high,
      };
      reclaimRows.push(reclaim);
      firstReclaimAt ||= bar.time;
      latestReclaimAt = bar.time;
      sweepSeen = false;
    }
  }

  const latestReclaimIndex = latestReclaimAt
    ? bars.findIndex((bar) => bar.time === latestReclaimAt)
    : -1;
  const afterLatestReclaim = latestReclaimIndex >= 0
    ? bars.slice(latestReclaimIndex + 1)
    : [];

  const latestSweep = sweeps[sweeps.length - 1] || null;
  const completedInvalidation = completedInvalidations[0] || null;

  return {
    barsNormalized: bars,
    interactionFacts: {
      interactionCount: interactions.length,
      interactionTimes: [...new Set(interactions.map((bar) => bar.time))],
      firstInteractionAt: interactions[0]?.time ?? null,
      lastInteractionAt: interactions[interactions.length - 1]?.time ?? null,
    },
    sweepFacts: {
      intrabarSweepObserved: sweeps.length > 0,
      completedCandleSweepObserved: completedSweeps.length > 0,
      latestSweepTime: latestSweep?.time ?? null,
      latestSweepLow: latestSweep?.low ?? null,
      maximumSweepDepthPoints: sweeps.length
        ? Math.max(...sweeps.map((bar) => low - bar.low))
        : 0,
      latestSweepClosedBackInsideZone:
        latestSweep ? latestSweep.close >= low && latestSweep.close <= high : false,
      latestSweepClosedAboveZone:
        latestSweep ? latestSweep.close > high : false,
      distanceFromInvalidationBoundary:
        latestSweep ? latestSweep.close - invalidationBoundary : null,
    },
    lowerWickFacts: {
      strongestObserved: strongestWick,
      lowerWickMeasurementThresholdMet:
        Boolean(strongestWick) &&
        strongestWick.lowerWickToBodyRatio >= 2 &&
        strongestWick.penetrationBelowEntryZone > 0,
    },
    reclaimFacts: {
      reclaimObserved: reclaimRows.length > 0,
      firstReclaimAt,
      latestReclaimAt,
      currentReclaimSequence,
      latestReclaim: reclaimRows[reclaimRows.length - 1] || null,
    },
    postReclaimFacts: {
      observationsSinceLatestReclaim: afterLatestReclaim.length,
      completedClosesSinceLatestReclaim:
        afterLatestReclaim.filter((bar) => bar.completed).length,
      lowestPriceSinceLatestReclaim:
        afterLatestReclaim.length
          ? Math.min(...afterLatestReclaim.map((bar) => bar.low))
          : null,
      invalidationBreachedSinceLatestReclaim:
        afterLatestReclaim.some((bar) => bar.low < invalidationBoundary),
    },
    invalidationFacts: {
      boundary: invalidationBoundary,
      intrabarInvalidationBreachObserved: invalidationBreaches.length > 0,
      completedCloseInvalidationConfirmed: completedInvalidations.length > 0,
      invalidationTime: completedInvalidation?.time ?? null,
      invalidationClose: completedInvalidation?.close ?? null,
    },
    warnings,
  };
}

export default buildStrategy1Facts;
