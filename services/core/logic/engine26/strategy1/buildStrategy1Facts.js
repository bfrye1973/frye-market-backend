function toFinite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDirection(value) {
  const text = String(value || "").trim().toUpperCase();
  return text === "SHORT" ? "SHORT" : "LONG";
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return null;

  if (
    typeof value === "number" ||
    /^\d+(?:\.\d+)?$/.test(String(value))
  ) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function atOrAfterLifecycleStart(bar, lifecycleStartTime) {
  if (!lifecycleStartTime) return true;

  const barMs = Date.parse(bar?.time || "");
  const startMs = Date.parse(lifecycleStartTime);

  if (
    !Number.isFinite(barMs) ||
    !Number.isFinite(startMs)
  ) {
    return true;
  }

  return barMs >= startMs;
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

      if (
        !time ||
        [open, high, low, close].some((x) => x === null)
      ) {
        warnings.push(
          `ENGINE26_STRATEGY1_BAR_${index}_INVALID`
        );
        return null;
      }

      const explicitCompleted = bar?.completed === true;
      const explicitForming = bar?.completed === false;
      const completed =
        explicitCompleted ||
        (!explicitForming && index < rows.length - 1);

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

function emptyFacts({ bars, warnings, direction }) {
  return {
    direction,
    barsNormalized: bars,
    interactionFacts: {
      interactionCount: 0,
      interactionTimes: [],
    },
    sweepFacts: {},
    lowerWickFacts: {},
    reclaimFacts: {},
    rejectionFacts: {},
    upperWickFacts: {},
    failedAcceptanceFacts: {},
    failedReclaimFacts: {},
    postReclaimFacts: {},
    postRejectionFacts: {},
    invalidationFacts: {},
    lifecycleFacts: {},
    warnings: [
      ...warnings,
      "ENGINE26_STRATEGY1_FACT_BOUNDARY_MISSING",
    ],
  };
}

function buildLongFacts({
  bars,
  low,
  high,
  midline,
  invalidationBoundary,
  lifecycleStartTime,
}) {
  const interactions = bars.filter(
    (bar) => bar.high >= low && bar.low <= high
  );

  const sweeps = bars.filter((bar) => bar.low < low);
  const completedSweeps = sweeps.filter((bar) => bar.completed);
  const invalidationBreaches = bars.filter(
    (bar) => bar.low < invalidationBoundary
  );

  const wickRows = bars.map((bar) => {
    const bodySize = Math.abs(bar.close - bar.open);
    const lowerWickPoints = Math.max(
      0,
      Math.min(bar.open, bar.close) - bar.low
    );

    return {
      candleTime: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      completed: bar.completed,
      bodySize,
      lowerWickPoints,
      lowerWickToBodyRatio:
        lowerWickPoints / Math.max(bodySize, 0.25),
      penetrationBelowEntryZone: Math.max(0, low - bar.low),
      penetrationBelowInvalidationBoundary: Math.max(
        0,
        invalidationBoundary - bar.low
      ),
      closedInsideZone:
        bar.close >= low && bar.close <= high,
      closedAboveZone: bar.close > high,
      lowerWickObserved: lowerWickPoints > 0,
      lowerWickBelowZoneObserved:
        lowerWickPoints > 0 && bar.low < low,
    };
  });

  const strongestWick =
    wickRows
      .filter((row) => row.lowerWickObserved)
      .sort((a, b) => {
        if (
          b.lowerWickToBodyRatio !==
          a.lowerWickToBodyRatio
        ) {
          return (
            b.lowerWickToBodyRatio -
            a.lowerWickToBodyRatio
          );
        }
        return b.lowerWickPoints - a.lowerWickPoints;
      })[0] || null;

  let firstReclaimAt = null;
  let latestReclaimAt = null;
  let sweepSeen = false;
  const reclaimRows = [];

  for (const bar of bars) {
    if (bar.low < low) sweepSeen = true;

    if (
      sweepSeen &&
      bar.completed &&
      bar.close >= low
    ) {
      const reclaim = {
        reclaimTime: bar.time,
        reclaimClose: bar.close,
        closedBackInsideZone:
          bar.close >= low && bar.close <= high,
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

  const afterLatestReclaim =
    latestReclaimIndex >= 0
      ? bars.slice(latestReclaimIndex + 1)
      : [];

  const completedInvalidations =
    latestReclaimIndex >= 0
      ? afterLatestReclaim.filter(
          (bar) =>
            atOrAfterLifecycleStart(
              bar,
              lifecycleStartTime
            ) &&
            bar.completed &&
            bar.close < invalidationBoundary
        )
      : [];

  const completedHoldBars = afterLatestReclaim.filter(
    (bar) =>
      bar.completed &&
      bar.close >= invalidationBoundary
  );

  const latestSweep = sweeps[sweeps.length - 1] || null;
  const completedInvalidation =
    completedInvalidations[0] || null;

  return {
    interactionFacts: {
      interactionCount: interactions.length,
      interactionTimes: [
        ...new Set(interactions.map((bar) => bar.time)),
      ],
      firstInteractionAt: interactions[0]?.time ?? null,
      lastInteractionAt:
        interactions[interactions.length - 1]?.time ?? null,
    },

    sweepFacts: {
      intrabarSweepObserved: sweeps.length > 0,
      completedCandleSweepObserved:
        completedSweeps.length > 0,
      latestSweepTime: latestSweep?.time ?? null,
      latestSweepLow: latestSweep?.low ?? null,
      maximumSweepDepthPoints: sweeps.length
        ? Math.max(...sweeps.map((bar) => low - bar.low))
        : 0,
      latestSweepClosedBackInsideZone:
        latestSweep
          ? latestSweep.close >= low &&
            latestSweep.close <= high
          : false,
      latestSweepClosedAboveZone:
        latestSweep ? latestSweep.close > high : false,
      distanceFromInvalidationBoundary:
        latestSweep
          ? latestSweep.close - invalidationBoundary
          : null,
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
      completedReclaimObserved: reclaimRows.length > 0,
      firstReclaimAt,
      latestReclaimAt,
      currentReclaimSequence: reclaimRows.length,
      latestReclaim:
        reclaimRows[reclaimRows.length - 1] || null,
    },

    postReclaimFacts: {
      observationsSinceLatestReclaim:
        afterLatestReclaim.length,
      completedClosesSinceLatestReclaim:
        afterLatestReclaim.filter((bar) => bar.completed)
          .length,
      completedHoldObserved: completedHoldBars.length > 0,
      completedHoldCount: completedHoldBars.length,
      latestHoldTime:
        completedHoldBars[completedHoldBars.length - 1]
          ?.time ?? null,
      latestHoldClose:
        completedHoldBars[completedHoldBars.length - 1]
          ?.close ?? null,
      heldAboveReclaimBoundary:
        completedHoldBars.some((bar) => bar.close >= low),
      heldAboveTriggerLevel:
        completedHoldBars.some((bar) => bar.close >= high),
      lowestPriceSinceLatestReclaim:
        afterLatestReclaim.length
          ? Math.min(
              ...afterLatestReclaim.map((bar) => bar.low)
            )
          : null,
      invalidationBreachedSinceLatestReclaim:
        afterLatestReclaim.some(
          (bar) => bar.low < invalidationBoundary
        ),
    },

    rejectionFacts: {},
    upperWickFacts: {},
    failedAcceptanceFacts: {},
    failedReclaimFacts: {},
    postRejectionFacts: {},

    invalidationFacts: {
      boundary: invalidationBoundary,
      direction: "LONG",
      intrabarInvalidationBreachObserved:
        invalidationBreaches.length > 0,
      completedCloseInvalidationConfirmed:
        completedInvalidations.length > 0,
      invalidationTime:
        completedInvalidation?.time ?? null,
      invalidationClose:
        completedInvalidation?.close ?? null,
      lifecycleStartTime:
        lifecycleStartTime || null,
      historicalBarsIgnoredForInvalidation:
        bars.filter(
          (bar) =>
            !atOrAfterLifecycleStart(
              bar,
              lifecycleStartTime
            )
        ).length,
    },

    lifecycleFacts: {
      locationSequence:
        "LOWER_ZONE_SWEEP_RECLAIM_HOLD",
      setupDeveloping:
        sweeps.length > 0 && reclaimRows.length > 0,
      reactionEvaluationFactsReady:
        sweeps.length > 0 &&
        reclaimRows.length > 0 &&
        completedHoldBars.length > 0 &&
        completedInvalidations.length === 0,
    },
  };
}

function buildShortFacts({
  bars,
  low,
  high,
  midline,
  invalidationBoundary,
  lifecycleStartTime,
}) {
  const interactions = bars.filter(
    (bar) => bar.high >= low && bar.low <= high
  );

  const tradesAtOrAboveTrigger = bars.filter(
    (bar) => bar.high >= low
  );

  const tradesAboveZone = bars.filter(
    (bar) => bar.high > high
  );

  const invalidationBreaches = bars.filter(
    (bar) => bar.high > invalidationBoundary
  );

  const wickRows = bars.map((bar) => {
    const bodySize = Math.abs(bar.close - bar.open);
    const upperWickPoints = Math.max(
      0,
      bar.high - Math.max(bar.open, bar.close)
    );

    return {
      candleTime: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      completed: bar.completed,
      bodySize,
      upperWickPoints,
      upperWickToBodyRatio:
        upperWickPoints / Math.max(bodySize, 0.25),
      penetrationAboveEntryZone: Math.max(
        0,
        bar.high - high
      ),
      penetrationAboveInvalidationBoundary: Math.max(
        0,
        bar.high - invalidationBoundary
      ),
      closedInsideZone:
        bar.close >= low && bar.close <= high,
      closedBelowZone: bar.close < low,
      closedBelowTrigger: bar.close < low,
      upperWickObserved: upperWickPoints > 0,
      upperWickAboveZoneObserved:
        upperWickPoints > 0 && bar.high > high,
    };
  });

  const strongestWick =
    wickRows
      .filter((row) => row.upperWickObserved)
      .sort((a, b) => {
        if (
          b.upperWickToBodyRatio !==
          a.upperWickToBodyRatio
        ) {
          return (
            b.upperWickToBodyRatio -
            a.upperWickToBodyRatio
          );
        }
        return b.upperWickPoints - a.upperWickPoints;
      })[0] || null;

  const failedAcceptanceRows = bars.filter(
    (bar) =>
      bar.completed &&
      bar.high >= low &&
      bar.close < low
  );

  const rejectionRows = bars.filter(
    (bar) =>
      bar.completed &&
      (
        (bar.high > high && bar.close <= high) ||
        (bar.high >= low && bar.close < low)
      )
  );

  let closeBelowSeen = false;
  let firstFailedReclaimAt = null;
  let latestFailedReclaimAt = null;
  const failedReclaimRows = [];

  for (const bar of bars) {
    if (bar.completed && bar.close < low) {
      closeBelowSeen = true;
      continue;
    }

    if (
      closeBelowSeen &&
      bar.high >= low &&
      bar.completed &&
      bar.close < low
    ) {
      const failedReclaim = {
        failedReclaimTime: bar.time,
        failedReclaimClose: bar.close,
        testedZoneLow: bar.high >= low,
        testedZoneInterior: bar.high > low,
        closedBackBelowZoneLow: bar.close < low,
      };

      failedReclaimRows.push(failedReclaim);
      firstFailedReclaimAt ||= bar.time;
      latestFailedReclaimAt = bar.time;
      closeBelowSeen = true;
    }
  }

  /*
   * Post-rejection hold must be measured after the first completed
   * bearish location event, not after the latest repeated event.
   *
   * Using the latest rejection/failed-acceptance candle would consume
   * every later hold candle as fresh evidence and leave no subsequent
   * candle available to prove the required hold.
   */
  const firstEvidenceTime =
    rejectionRows[0]?.time ||
    failedAcceptanceRows[0]?.time ||
    failedReclaimRows[0]?.failedReclaimTime ||
    null;

  const firstEvidenceIndex = firstEvidenceTime
    ? bars.findIndex((bar) => bar.time === firstEvidenceTime)
    : -1;

  const afterLatestEvidence =
    firstEvidenceIndex >= 0
      ? bars.slice(firstEvidenceIndex + 1)
      : [];

  const completedInvalidations =
    firstEvidenceIndex >= 0
      ? afterLatestEvidence.filter(
          (bar) =>
            atOrAfterLifecycleStart(
              bar,
              lifecycleStartTime
            ) &&
            bar.completed &&
            bar.close > invalidationBoundary
        )
      : [];

  const completedHoldBars = afterLatestEvidence.filter(
    (bar) =>
      bar.completed &&
      bar.close <= invalidationBoundary
  );

  const completedInvalidation =
    completedInvalidations[0] || null;

  return {
    interactionFacts: {
      interactionCount: interactions.length,
      interactionTimes: [
        ...new Set(interactions.map((bar) => bar.time)),
      ],
      firstInteractionAt: interactions[0]?.time ?? null,
      lastInteractionAt:
        interactions[interactions.length - 1]?.time ?? null,
    },

    sweepFacts: {},
    lowerWickFacts: {},
    reclaimFacts: {},
    postReclaimFacts: {},

    rejectionFacts: {
      rejectionObserved:
        rejectionRows.length > 0 ||
        tradesAboveZone.length > 0,
      completedRejectionObserved:
        rejectionRows.length > 0,
      firstRejectionAt:
        rejectionRows[0]?.time ?? null,
      latestRejectionAt:
        rejectionRows[rejectionRows.length - 1]?.time ??
        null,
      latestRejectionClose:
        rejectionRows[rejectionRows.length - 1]?.close ??
        null,
      tradedAboveZone:
        tradesAboveZone.length > 0,
      maximumRejectionDepthPoints:
        tradesAboveZone.length
          ? Math.max(
              ...tradesAboveZone.map(
                (bar) => bar.high - high
              )
            )
          : 0,
    },

    upperWickFacts: {
      strongestObserved: strongestWick,
      upperWickMeasurementThresholdMet:
        Boolean(strongestWick) &&
        strongestWick.upperWickToBodyRatio >= 2 &&
        strongestWick.penetrationAboveEntryZone > 0,
    },

    failedAcceptanceFacts: {
      triggerLevel: low,
      tradedAtOrAboveTrigger:
        tradesAtOrAboveTrigger.length > 0,
      completedFailedAcceptanceObserved:
        failedAcceptanceRows.length > 0,
      firstFailedAcceptanceAt:
        failedAcceptanceRows[0]?.time ?? null,
      latestFailedAcceptanceAt:
        failedAcceptanceRows[
          failedAcceptanceRows.length - 1
        ]?.time ?? null,
      latestFailedAcceptanceClose:
        failedAcceptanceRows[
          failedAcceptanceRows.length - 1
        ]?.close ?? null,
    },

    failedReclaimFacts: {
      failedReclaimObserved:
        failedReclaimRows.length > 0,
      firstFailedReclaimAt,
      latestFailedReclaimAt,
      currentFailedReclaimSequence:
        failedReclaimRows.length,
      latestFailedReclaim:
        failedReclaimRows[
          failedReclaimRows.length - 1
        ] || null,
    },

    postRejectionFacts: {
      observationsSinceLatestEvidence:
        afterLatestEvidence.length,
      completedClosesSinceLatestEvidence:
        afterLatestEvidence.filter((bar) => bar.completed)
          .length,
      completedHoldObserved: completedHoldBars.length > 0,
      completedHoldCount: completedHoldBars.length,
      latestHoldTime:
        completedHoldBars[completedHoldBars.length - 1]
          ?.time ?? null,
      latestHoldClose:
        completedHoldBars[completedHoldBars.length - 1]
          ?.close ?? null,
      heldBelowTriggerLevel:
        completedHoldBars.some((bar) => bar.close < low),
      heldBelowMidline:
        completedHoldBars.some(
          (bar) => bar.close < midline
        ),
      highestPriceSinceLatestEvidence:
        afterLatestEvidence.length
          ? Math.max(
              ...afterLatestEvidence.map((bar) => bar.high)
            )
          : null,
      invalidationBreachedSinceLatestEvidence:
        afterLatestEvidence.some(
          (bar) => bar.high > invalidationBoundary
        ),
    },

    invalidationFacts: {
      boundary: invalidationBoundary,
      direction: "SHORT",
      intrabarInvalidationBreachObserved:
        invalidationBreaches.length > 0,
      completedCloseInvalidationConfirmed:
        completedInvalidations.length > 0,
      invalidationTime:
        completedInvalidation?.time ?? null,
      invalidationClose:
        completedInvalidation?.close ?? null,
      lifecycleStartTime:
        lifecycleStartTime || null,
      historicalBarsIgnoredForInvalidation:
        bars.filter(
          (bar) =>
            !atOrAfterLifecycleStart(
              bar,
              lifecycleStartTime
            )
        ).length,
    },

    lifecycleFacts: {
      locationSequence:
        "UPPER_ZONE_REJECTION_FAILED_ACCEPTANCE",
      setupDeveloping:
        rejectionRows.length > 0 ||
        failedAcceptanceRows.length > 0 ||
        failedReclaimRows.length > 0,
      reactionEvaluationFactsReady:
        (
          rejectionRows.length > 0 ||
          failedAcceptanceRows.length > 0 ||
          failedReclaimRows.length > 0
        ) &&
        completedHoldBars.length > 0 &&
        completedInvalidations.length === 0,
    },
  };
}

export function buildStrategy1Facts({
  bars10m = [],
  entryZone,
  locationInvalidationBoundary,
  direction = "LONG",
  lifecycleStartTime = null,
} = {}) {
  const normalizedDirection =
    normalizeDirection(direction);

  const { bars, warnings } =
    normalizeStrategy1Bars(bars10m);

  const low = toFinite(entryZone?.low);
  const high = toFinite(entryZone?.high);
  const midline = toFinite(entryZone?.midline);
  const invalidationBoundary =
    toFinite(locationInvalidationBoundary);

  const normalizedLifecycleStartTime =
    normalizeTime(lifecycleStartTime);

  if (
    [low, high, midline, invalidationBoundary].some(
      (x) => x === null
    )
  ) {
    return emptyFacts({
      bars,
      warnings,
      direction: normalizedDirection,
    });
  }

  const directionalFacts =
    normalizedDirection === "SHORT"
      ? buildShortFacts({
          bars,
          low,
          high,
          midline,
          invalidationBoundary,
          lifecycleStartTime:
            normalizedLifecycleStartTime,
        })
      : buildLongFacts({
          bars,
          low,
          high,
          midline,
          invalidationBoundary,
          lifecycleStartTime:
            normalizedLifecycleStartTime,
        });

  return {
    direction: normalizedDirection,
    lifecycleStartTime:
      normalizedLifecycleStartTime,
    barsNormalized: bars,
    ...directionalFacts,
    warnings,
  };
}

export default buildStrategy1Facts;
