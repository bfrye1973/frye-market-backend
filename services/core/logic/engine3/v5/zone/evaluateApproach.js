// services/core/logic/engine3/v5/zone/evaluateApproach.js
//
// Engine 3 v5 — Approach-to-zone evaluator.
//
// Contract:
// - Consumes normalized bars, sequence momentum evidence, and ONE exact negotiated zone.
// - Describes how price approached the Engine 26 negotiated zone.
// - Classifies approach as IMPULSE / CORRECTION / COMPRESSION / MIXED / NO_CLEAR_APPROACH.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not resolve buyer/seller control.
// - Does not create quality.
// - Does not create confirmation.
// - Does not create permission.
// - Does not create execution.
//
// Frozen ownership:
// Engine 26 owns WHERE.
// Engine 3 v5 evaluates HOW price approaches that exact location.
//
// IMPORTANT:
// Directional labels here are evidence-only approach labels:
//   APPROACHING_FROM_ABOVE
//   APPROACHING_FROM_BELOW
//   IMPULSE_DOWN
//   IMPULSE_UP
//   CORRECTION_DOWN
//   CORRECTION_UP
//
// They are never canonical trade direction.

const ENGINE = "engine3.v5.zone.evaluateApproach.v1";
const SOURCE = "engine3.v5.zone.evaluateApproach";

function round6(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Number(n.toFixed(6))
    : null;
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
    Number.isFinite(Number(bar.rangeSize)) &&
    Number.isFinite(Number(bar.bodySize))
  );
}

function isValidZone(zone) {
  return Boolean(
    zone &&
    typeof zone === "object" &&
    Number.isFinite(Number(zone.low)) &&
    Number.isFinite(Number(zone.high)) &&
    Number.isFinite(Number(zone.midline)) &&
    Number(zone.high) >= Number(zone.low)
  );
}

function distanceToZone(price, zone) {
  const p = Number(price);

  if (!Number.isFinite(p) || !isValidZone(zone)) {
    return null;
  }

  const low = Number(zone.low);
  const high = Number(zone.high);

  if (p >= low && p <= high) {
    return 0;
  }

  if (p < low) {
    return round6(low - p);
  }

  return round6(p - high);
}

function relationToZone(price, zone) {
  const p = Number(price);

  if (!Number.isFinite(p) || !isValidZone(zone)) {
    return "UNKNOWN";
  }

  if (p > Number(zone.high)) {
    return "ABOVE_ZONE";
  }

  if (p < Number(zone.low)) {
    return "BELOW_ZONE";
  }

  return "INSIDE_ZONE";
}

function safeAverage(values = []) {
  const nums = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!nums.length) {
    return null;
  }

  return round6(
    nums.reduce((sum, value) => sum + value, 0) /
    nums.length
  );
}

function buildApproachProgress(bars, zone) {
  const points = bars.map((bar) => ({
    time: bar.time,
    close: bar.close,
    relation: relationToZone(bar.close, zone),
    distanceToZone: distanceToZone(bar.close, zone),
  }));

  const validDistances = points
    .map((point) => point.distanceToZone)
    .filter((value) => Number.isFinite(Number(value)));

  let closingDistance = null;
  let openingDistance = null;
  let distanceChange = null;

  if (validDistances.length) {
    openingDistance = validDistances[0];
    closingDistance = validDistances.at(-1);

    distanceChange =
      Number.isFinite(Number(openingDistance)) &&
      Number.isFinite(Number(closingDistance))
        ? round6(closingDistance - openingDistance)
        : null;
  }

  const movingCloser =
    distanceChange != null &&
    distanceChange < 0;

  const movingAway =
    distanceChange != null &&
    distanceChange > 0;

  return {
    points,
    openingDistance,
    closingDistance,
    distanceChange,
    movingCloser,
    movingAway,
  };
}

function inferApproachSide(bars, zone) {
  if (!bars.length || !isValidZone(zone)) {
    return "UNKNOWN";
  }

  const relations = bars.map(
    (bar) => relationToZone(bar.close, zone)
  );

  const aboveCount = relations.filter(
    (relation) => relation === "ABOVE_ZONE"
  ).length;

  const belowCount = relations.filter(
    (relation) => relation === "BELOW_ZONE"
  ).length;

  const insideCount = relations.filter(
    (relation) => relation === "INSIDE_ZONE"
  ).length;

  if (
    aboveCount > belowCount &&
    aboveCount >= insideCount
  ) {
    return "APPROACHING_FROM_ABOVE";
  }

  if (
    belowCount > aboveCount &&
    belowCount >= insideCount
  ) {
    return "APPROACHING_FROM_BELOW";
  }

  if (insideCount > aboveCount && insideCount > belowCount) {
    return "ALREADY_WORKING_INSIDE_ZONE";
  }

  return "MIXED_APPROACH_SIDE";
}

function classifyApproach({
  bars,
  sequenceMomentum,
  progress,
  approachSide,
} = {}) {
  const phase = String(
    sequenceMomentum?.phase ||
    "NO_CLEAR_SEQUENCE"
  ).toUpperCase();

  const evidenceBias = String(
    sequenceMomentum?.evidenceBias ||
    "NONE"
  ).toUpperCase();

  const averageOverlapRatio =
    Number(
      sequenceMomentum?.overlap?.averageOverlapRatio
    );

  const rangeTrend = String(
    sequenceMomentum?.expansionContraction?.rangeTrend ||
    "UNKNOWN"
  ).toUpperCase();

  const bodyTrend = String(
    sequenceMomentum?.expansionContraction?.bodyTrend ||
    "UNKNOWN"
  ).toUpperCase();

  const bullishBodyCount =
    Number(
      sequenceMomentum?.progression?.bullishBodyCount ??
      0
    );

  const bearishBodyCount =
    Number(
      sequenceMomentum?.progression?.bearishBodyCount ??
      0
    );

  const netCloseChange =
    Number(
      sequenceMomentum?.progression?.netCloseChange
    );

  const highOverlap =
    Number.isFinite(averageOverlapRatio) &&
    averageOverlapRatio >= 0.6;

  const lowOverlap =
    Number.isFinite(averageOverlapRatio) &&
    averageOverlapRatio <= 0.3;

  const expanding =
    rangeTrend === "EXPANDING" ||
    bodyTrend === "EXPANDING";

  const contracting =
    rangeTrend === "CONTRACTING" ||
    bodyTrend === "CONTRACTING";

  const downwardSequence =
    evidenceBias === "DOWN" ||
    phase.includes("DOWN") ||
    (
      Number.isFinite(netCloseChange) &&
      netCloseChange < 0 &&
      bearishBodyCount > bullishBodyCount
    );

  const upwardSequence =
    evidenceBias === "UP" ||
    phase.includes("UP") ||
    (
      Number.isFinite(netCloseChange) &&
      netCloseChange > 0 &&
      bullishBodyCount > bearishBodyCount
    );

  if (
    phase === "COMPRESSION" ||
    (
      highOverlap &&
      contracting
    )
  ) {
    return {
      approachState: "COMPRESSION",
      approachDirection: "NONE",
      approachCharacter: "COMPRESSION",
    };
  }

  if (
    progress?.movingCloser === true &&
    approachSide === "APPROACHING_FROM_ABOVE" &&
    downwardSequence &&
    expanding &&
    lowOverlap
  ) {
    return {
      approachState: "IMPULSE_DOWN",
      approachDirection: "DOWN",
      approachCharacter: "IMPULSE",
    };
  }

  if (
    progress?.movingCloser === true &&
    approachSide === "APPROACHING_FROM_BELOW" &&
    upwardSequence &&
    expanding &&
    lowOverlap
  ) {
    return {
      approachState: "IMPULSE_UP",
      approachDirection: "UP",
      approachCharacter: "IMPULSE",
    };
  }

  if (
    progress?.movingCloser === true &&
    approachSide === "APPROACHING_FROM_ABOVE" &&
    downwardSequence &&
    (
      contracting ||
      highOverlap ||
      phase === "FADING_DOWN"
    )
  ) {
    return {
      approachState: "CORRECTION_DOWN",
      approachDirection: "DOWN",
      approachCharacter: "CORRECTION",
    };
  }

  if (
    progress?.movingCloser === true &&
    approachSide === "APPROACHING_FROM_BELOW" &&
    upwardSequence &&
    (
      contracting ||
      highOverlap ||
      phase === "FADING_UP"
    )
  ) {
    return {
      approachState: "CORRECTION_UP",
      approachDirection: "UP",
      approachCharacter: "CORRECTION",
    };
  }

  if (
    progress?.movingCloser === true &&
    downwardSequence
  ) {
    return {
      approachState: "PROGRESSING_DOWN_TOWARD_ZONE",
      approachDirection: "DOWN",
      approachCharacter: "PROGRESSING",
    };
  }

  if (
    progress?.movingCloser === true &&
    upwardSequence
  ) {
    return {
      approachState: "PROGRESSING_UP_TOWARD_ZONE",
      approachDirection: "UP",
      approachCharacter: "PROGRESSING",
    };
  }

  if (
    approachSide === "ALREADY_WORKING_INSIDE_ZONE"
  ) {
    return {
      approachState: "ALREADY_WORKING_INSIDE_ZONE",
      approachDirection: "NONE",
      approachCharacter: "IN_ZONE",
    };
  }

  if (progress?.movingAway === true) {
    return {
      approachState: "MOVING_AWAY_FROM_ZONE",
      approachDirection: "NONE",
      approachCharacter: "AWAY",
    };
  }

  return {
    approachState: "NO_CLEAR_APPROACH",
    approachDirection: "NONE",
    approachCharacter: "MIXED",
  };
}

export function evaluateApproach({
  normalizedBars = [],
  zone = null,
  sequenceMomentum = null,
  lookback = 5,
} = {}) {
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

  if (!isValidZone(zone)) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      approachState: "ZONE_INVALID",
      approachDirection: "NONE",
      approachCharacter: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_APPROACH_ZONE_INVALID",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  if (bars.length < 2) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      approachState: "INSUFFICIENT_APPROACH_BARS",
      approachDirection: "NONE",
      approachCharacter: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_APPROACH_INSUFFICIENT_BARS",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  const progress =
    buildApproachProgress(
      bars,
      zone
    );

  const approachSide =
    inferApproachSide(
      bars,
      zone
    );

  const classification =
    classifyApproach({
      bars,
      sequenceMomentum,
      progress,
      approachSide,
    });

  const rangeAverage =
    safeAverage(
      bars.map(
        (bar) => bar.rangeSize
      )
    );

  const bodyAverage =
    safeAverage(
      bars.map(
        (bar) => bar.bodySize
      )
    );

  const lastBar =
    bars.at(-1);

  const firstBar =
    bars[0];

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    lookbackRequested:
      safeLookback,

    barsUsed:
      bars.length,

    firstBarTime:
      firstBar?.time ??
      null,

    lastBarTime:
      lastBar?.time ??
      null,

    approachSide,

    approachState:
      classification.approachState,

    approachDirection:
      classification.approachDirection,

    approachCharacter:
      classification.approachCharacter,

    movement: {
      openingClose:
        firstBar?.close ??
        null,

      latestClose:
        lastBar?.close ??
        null,

      netCloseChange:
        Number.isFinite(
          Number(firstBar?.close)
        ) &&
        Number.isFinite(
          Number(lastBar?.close)
        )
          ? round6(
              Number(lastBar.close) -
              Number(firstBar.close)
            )
          : null,

      averageRange:
        rangeAverage,

      averageBody:
        bodyAverage,
    },

    zoneProgress:
      progress,

    sequenceContext: {
      phase:
        sequenceMomentum?.phase ??
        null,

      evidenceBias:
        sequenceMomentum?.evidenceBias ??
        null,

      averageOverlapRatio:
        sequenceMomentum
          ?.overlap
          ?.averageOverlapRatio ??
        null,

      rangeTrend:
        sequenceMomentum
          ?.expansionContraction
          ?.rangeTrend ??
        null,

      bodyTrend:
        sequenceMomentum
          ?.expansionContraction
          ?.bodyTrend ??
        null,
    },

    zone: {
      zoneId:
        zone?.zoneId ??
        zone?.id ??
        null,

      low:
        round6(zone.low),

      high:
        round6(zone.high),

      midline:
        round6(zone.midline),
    },

    bars,

    reasonCodes: [
      "ENGINE3_V5_APPROACH_EVALUATED",
      `ENGINE3_V5_APPROACH_SIDE_${approachSide}`,
      `ENGINE3_V5_APPROACH_STATE_${classification.approachState}`,
      `ENGINE3_V5_APPROACH_CHARACTER_${classification.approachCharacter}`,
      "ENGINE3_V5_APPROACH_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default evaluateApproach;
