// services/core/logic/engine3/v5/evidence/wickBehavior.js
//
// Engine 3 v5 — Wick / sweep / rejection evidence.
//
// Contract:
// - Pure evidence utility.
// - Consumes normalized bars from normalizePriceBars.js.
// - Describes wick behavior and sweep/rejection facts only.
// - Does not select a trading zone.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not resolve buyer/seller control.
// - Does not create quality.
// - Does not create confirmation.
// - Does not create permission.
// - Does not create execution.
//
// IMPORTANT:
// This module may describe facts such as:
//   UPPER_WICK_REJECTION
//   LOWER_WICK_REJECTION
//   SWEPT_PRIOR_HIGH
//   SWEPT_PRIOR_LOW
//   CLOSED_BACK_INSIDE_PRIOR_RANGE
//
// Those are observations only.
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

const ENGINE = "engine3.v5.evidence.wickBehavior.v1";
const SOURCE = "engine3.v5.evidence.wickBehavior";

function round6(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Number(n.toFixed(6))
    : null;
}

function safeRatio(numerator, denominator) {
  const a = Number(numerator);
  const b = Number(denominator);

  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
    return null;
  }

  return round6(a / b);
}

function isValidBar(bar) {
  return Boolean(
    bar &&
    typeof bar === "object" &&
    bar.valid === true &&
    Number.isFinite(Number(bar.open)) &&
    Number.isFinite(Number(bar.high)) &&
    Number.isFinite(Number(bar.low)) &&
    Number.isFinite(Number(bar.close)) &&
    Number.isFinite(Number(bar.bodySize)) &&
    Number.isFinite(Number(bar.rangeSize)) &&
    Number.isFinite(Number(bar.upperWick)) &&
    Number.isFinite(Number(bar.lowerWick))
  );
}

function classifySingleWick(bar) {
  if (!isValidBar(bar)) {
    return {
      valid: false,
      upperWickSignificant: false,
      lowerWickSignificant: false,
      upperWickDominant: false,
      lowerWickDominant: false,
      bothWicksSignificant: false,
      rejectionState: "UNKNOWN",
    };
  }

  const body = Number(bar.bodySize);
  const range = Number(bar.rangeSize);
  const upper = Number(bar.upperWick);
  const lower = Number(bar.lowerWick);

  const upperWickSignificant =
    range > 0 &&
    upper >= Math.max(
      range * 0.3,
      body * 1.25
    );

  const lowerWickSignificant =
    range > 0 &&
    lower >= Math.max(
      range * 0.3,
      body * 1.25
    );

  const upperWickDominant =
    upperWickSignificant &&
    upper > lower * 1.25;

  const lowerWickDominant =
    lowerWickSignificant &&
    lower > upper * 1.25;

  const bothWicksSignificant =
    upperWickSignificant &&
    lowerWickSignificant;

  let rejectionState = "NO_CLEAR_WICK_REJECTION";

  if (
    upperWickDominant &&
    bar.closeLocationPct != null &&
    Number(bar.closeLocationPct) <= 0.6
  ) {
    rejectionState = "UPPER_WICK_REJECTION";
  } else if (
    lowerWickDominant &&
    bar.closeLocationPct != null &&
    Number(bar.closeLocationPct) >= 0.4
  ) {
    rejectionState = "LOWER_WICK_REJECTION";
  } else if (bothWicksSignificant) {
    rejectionState = "TWO_SIDED_WICK_REJECTION";
  }

  return {
    valid: true,

    upperWickSignificant,
    lowerWickSignificant,

    upperWickDominant,
    lowerWickDominant,

    bothWicksSignificant,

    rejectionState,

    ratios: {
      upperWickToBody:
        safeRatio(
          upper,
          body
        ),

      lowerWickToBody:
        safeRatio(
          lower,
          body
        ),

      upperWickToRange:
        safeRatio(
          upper,
          range
        ),

      lowerWickToRange:
        safeRatio(
          lower,
          range
        ),
    },
  };
}

export function buildSingleWickBehavior(
  bar
) {
  if (!isValidBar(bar)) {
    return {
      valid: false,
      engine: ENGINE,
      source: SOURCE,
      time: bar?.time ?? null,
      rejectionState: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_WICK_BAR_INVALID",
      ],
    };
  }

  const wick = classifySingleWick(bar);

  return {
    valid: true,
    engine: ENGINE,
    source: SOURCE,

    time:
      bar.time,

    upperWick:
      bar.upperWick,

    lowerWick:
      bar.lowerWick,

    bodySize:
      bar.bodySize,

    rangeSize:
      bar.rangeSize,

    closeLocationPct:
      bar.closeLocationPct,

    upperWickSignificant:
      wick.upperWickSignificant,

    lowerWickSignificant:
      wick.lowerWickSignificant,

    upperWickDominant:
      wick.upperWickDominant,

    lowerWickDominant:
      wick.lowerWickDominant,

    bothWicksSignificant:
      wick.bothWicksSignificant,

    rejectionState:
      wick.rejectionState,

    ratios:
      wick.ratios,

    reasonCodes: [
      "ENGINE3_V5_WICK_BEHAVIOR_BUILT",
      `ENGINE3_V5_WICK_STATE_${wick.rejectionState}`,
      "ENGINE3_V5_WICK_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
    ],
  };
}

export function buildPairwiseSweepBehavior(
  previousBar,
  currentBar
) {
  if (
    !isValidBar(previousBar) ||
    !isValidBar(currentBar)
  ) {
    return {
      valid: false,
      engine: ENGINE,
      source: SOURCE,
      previousTime:
        previousBar?.time ?? null,
      currentTime:
        currentBar?.time ?? null,
      reasonCodes: [
        "ENGINE3_V5_SWEEP_PAIR_INVALID",
      ],
    };
  }

  const sweptPriorHigh =
    currentBar.high >
    previousBar.high;

  const sweptPriorLow =
    currentBar.low <
    previousBar.low;

  const closedBackBelowPriorHigh =
    sweptPriorHigh &&
    currentBar.close <=
      previousBar.high;

  const closedBackAbovePriorLow =
    sweptPriorLow &&
    currentBar.close >=
      previousBar.low;

  const closedBackInsidePriorRange =
    currentBar.close <=
      previousBar.high &&
    currentBar.close >=
      previousBar.low;

  const highSweepDepth =
    sweptPriorHigh
      ? round6(
          currentBar.high -
          previousBar.high
        )
      : 0;

  const lowSweepDepth =
    sweptPriorLow
      ? round6(
          previousBar.low -
          currentBar.low
        )
      : 0;

  const highSweepRejected =
    sweptPriorHigh &&
    closedBackBelowPriorHigh;

  const lowSweepRejected =
    sweptPriorLow &&
    closedBackAbovePriorLow;

  const fullOutsideSweep =
    sweptPriorHigh &&
    sweptPriorLow;

  let sweepState =
    "NO_PRIOR_RANGE_SWEEP";

  if (
    fullOutsideSweep &&
    closedBackInsidePriorRange
  ) {
    sweepState =
      "OUTSIDE_SWEEP_CLOSED_BACK_INSIDE";
  } else if (highSweepRejected) {
    sweepState =
      "PRIOR_HIGH_SWEEP_REJECTED";
  } else if (lowSweepRejected) {
    sweepState =
      "PRIOR_LOW_SWEEP_REJECTED";
  } else if (sweptPriorHigh) {
    sweepState =
      "PRIOR_HIGH_SWEPT";
  } else if (sweptPriorLow) {
    sweepState =
      "PRIOR_LOW_SWEPT";
  }

  return {
    valid: true,
    engine: ENGINE,
    source: SOURCE,

    previousTime:
      previousBar.time,

    currentTime:
      currentBar.time,

    sweepState,

    facts: {
      sweptPriorHigh,
      sweptPriorLow,

      closedBackBelowPriorHigh,
      closedBackAbovePriorLow,
      closedBackInsidePriorRange,

      highSweepRejected,
      lowSweepRejected,

      fullOutsideSweep,
    },

    depth: {
      highSweepDepth,
      lowSweepDepth,
    },

    reasonCodes: [
      "ENGINE3_V5_PAIRWISE_SWEEP_BEHAVIOR_BUILT",
      `ENGINE3_V5_SWEEP_STATE_${sweepState}`,
      "ENGINE3_V5_SWEEP_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
    ],
  };
}

export function buildWickBehavior(
  normalizedBars = [],
  {
    lookback = 5,
  } = {}
) {
  const sourceBars =
    Array.isArray(normalizedBars)
      ? normalizedBars.filter(isValidBar)
      : [];

  const safeLookback =
    Number.isFinite(Number(lookback)) &&
    Number(lookback) >= 2
      ? Math.floor(Number(lookback))
      : 5;

  const bars =
    sourceBars.slice(-safeLookback);

  if (!bars.length) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      barsUsed: 0,
      reasonCodes: [
        "ENGINE3_V5_WICK_BEHAVIOR_NO_BARS",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  const candleWicks =
    bars.map(
      (bar) =>
        buildSingleWickBehavior(bar)
    );

  const sweeps = [];

  for (
    let i = 1;
    i < bars.length;
    i += 1
  ) {
    sweeps.push(
      buildPairwiseSweepBehavior(
        bars[i - 1],
        bars[i]
      )
    );
  }

  const upperRejectionCount =
    candleWicks.filter(
      (item) =>
        item?.rejectionState ===
        "UPPER_WICK_REJECTION"
    ).length;

  const lowerRejectionCount =
    candleWicks.filter(
      (item) =>
        item?.rejectionState ===
        "LOWER_WICK_REJECTION"
    ).length;

  const twoSidedRejectionCount =
    candleWicks.filter(
      (item) =>
        item?.rejectionState ===
        "TWO_SIDED_WICK_REJECTION"
    ).length;

  const priorHighSweepCount =
    sweeps.filter(
      (item) =>
        item?.facts?.sweptPriorHigh === true
    ).length;

  const priorLowSweepCount =
    sweeps.filter(
      (item) =>
        item?.facts?.sweptPriorLow === true
    ).length;

  const rejectedHighSweepCount =
    sweeps.filter(
      (item) =>
        item?.facts?.highSweepRejected === true
    ).length;

  const rejectedLowSweepCount =
    sweeps.filter(
      (item) =>
        item?.facts?.lowSweepRejected === true
    ).length;

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    lookbackRequested:
      safeLookback,

    barsUsed:
      bars.length,

    summary: {
      upperRejectionCount,
      lowerRejectionCount,
      twoSidedRejectionCount,

      priorHighSweepCount,
      priorLowSweepCount,

      rejectedHighSweepCount,
      rejectedLowSweepCount,
    },

    latestWick:
      candleWicks.at(-1) ||
      null,

    priorWick:
      candleWicks.at(-2) ||
      null,

    latestSweep:
      sweeps.at(-1) ||
      null,

    candleWicks,
    sweeps,
    bars,

    reasonCodes: [
      "ENGINE3_V5_WICK_BEHAVIOR_STACK_BUILT",
      "ENGINE3_V5_WICK_AND_SWEEP_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default buildWickBehavior;
