// services/core/logic/engine3/v5/evidence/sequenceMomentum.js
//
// Engine 3 v5 — Multi-candle sequence momentum evidence.
//
// Contract:
// - Pure evidence utility.
// - Consumes normalized bars from normalizePriceBars.js.
// - Reads sequences across several candles.
// - Describes momentum, progression, overlap, and compression/expansion.
// - Does NOT publish canonical LONG / SHORT / NEUTRAL.
// - Does NOT resolve buyer/seller control.
// - Does NOT create quality.
// - Does NOT create confirmation.
// - Does NOT create permission.
// - Does NOT create execution.
//
// IMPORTANT:
// This module may publish evidence labels such as:
//   BUILDING_UP
//   BUILDING_DOWN
//   FADING_UP
//   FADING_DOWN
//   COMPRESSION
//   MIXED
//
// These are evidence classifications only.
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

const ENGINE = "engine3.v5.evidence.sequenceMomentum.v1";
const SOURCE = "engine3.v5.evidence.sequenceMomentum";

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

function safeAverage(values = []) {
  const nums = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!nums.length) return null;

  return round6(
    nums.reduce((sum, value) => sum + value, 0) /
    nums.length
  );
}

function safeMedian(values = []) {
  const nums = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!nums.length) return null;

  const middle = Math.floor(nums.length / 2);

  if (nums.length % 2 === 1) {
    return round6(nums[middle]);
  }

  return round6(
    (nums[middle - 1] + nums[middle]) / 2
  );
}

function buildPairFacts(previousBar, currentBar) {
  const higherHigh =
    currentBar.high > previousBar.high;

  const lowerHigh =
    currentBar.high < previousBar.high;

  const higherLow =
    currentBar.low > previousBar.low;

  const lowerLow =
    currentBar.low < previousBar.low;

  const higherClose =
    currentBar.close > previousBar.close;

  const lowerClose =
    currentBar.close < previousBar.close;

  const rangeExpansion =
    currentBar.rangeSize > previousBar.rangeSize;

  const rangeContraction =
    currentBar.rangeSize < previousBar.rangeSize;

  const bodyExpansion =
    currentBar.bodySize > previousBar.bodySize;

  const bodyContraction =
    currentBar.bodySize < previousBar.bodySize;

  const overlapHigh =
    Math.min(previousBar.high, currentBar.high);

  const overlapLow =
    Math.max(previousBar.low, currentBar.low);

  const overlapPoints =
    Math.max(0, overlapHigh - overlapLow);

  const smallerRange =
    Math.min(previousBar.rangeSize, currentBar.rangeSize);

  const overlapRatio =
    smallerRange > 0
      ? round6(overlapPoints / smallerRange)
      : null;

  return {
    higherHigh,
    lowerHigh,
    higherLow,
    lowerLow,
    higherClose,
    lowerClose,
    rangeExpansion,
    rangeContraction,
    bodyExpansion,
    bodyContraction,
    overlapPoints: round6(overlapPoints),
    overlapRatio,
  };
}

function countTrue(items, key) {
  return items.reduce(
    (count, item) =>
      item?.[key] === true
        ? count + 1
        : count,
    0
  );
}

function classifySequencePhase({
  bars,
  pairs,
  averageOverlapRatio,
  averageRange,
  recentAverageRange,
  priorAverageRange,
} = {}) {
  if (!Array.isArray(bars) || bars.length < 2) {
    return {
      phase: "INSUFFICIENT_SEQUENCE",
      evidenceBias: "NONE",
    };
  }

  const higherCloseCount =
    countTrue(pairs, "higherClose");

  const lowerCloseCount =
    countTrue(pairs, "lowerClose");

  const higherHighCount =
    countTrue(pairs, "higherHigh");

  const lowerHighCount =
    countTrue(pairs, "lowerHigh");

  const higherLowCount =
    countTrue(pairs, "higherLow");

  const lowerLowCount =
    countTrue(pairs, "lowerLow");

  const bullishBodies =
    bars.filter(
      (bar) => bar.bullishBody === true
    ).length;

  const bearishBodies =
    bars.filter(
      (bar) => bar.bearishBody === true
    ).length;

  const pairCount =
    pairs.length;

  const strongUpProgress =
    pairCount > 0 &&
    higherCloseCount >= Math.ceil(pairCount * 0.67) &&
    (
      higherHighCount >= Math.ceil(pairCount * 0.5) ||
      higherLowCount >= Math.ceil(pairCount * 0.5)
    );

  const strongDownProgress =
    pairCount > 0 &&
    lowerCloseCount >= Math.ceil(pairCount * 0.67) &&
    (
      lowerLowCount >= Math.ceil(pairCount * 0.5) ||
      lowerHighCount >= Math.ceil(pairCount * 0.5)
    );

  const highOverlap =
    averageOverlapRatio != null &&
    averageOverlapRatio >= 0.6;

  const lowOverlap =
    averageOverlapRatio != null &&
    averageOverlapRatio <= 0.3;

  const recentExpansion =
    recentAverageRange != null &&
    priorAverageRange != null &&
    priorAverageRange > 0 &&
    recentAverageRange >= priorAverageRange * 1.15;

  const recentContraction =
    recentAverageRange != null &&
    priorAverageRange != null &&
    priorAverageRange > 0 &&
    recentAverageRange <= priorAverageRange * 0.85;

  if (
    highOverlap &&
    recentContraction
  ) {
    return {
      phase: "COMPRESSION",
      evidenceBias: "MIXED",
    };
  }

  if (
    strongUpProgress &&
    lowOverlap &&
    (
      recentExpansion ||
      bullishBodies > bearishBodies
    )
  ) {
    return {
      phase: "BUILDING_UP",
      evidenceBias: "UP",
    };
  }

  if (
    strongDownProgress &&
    lowOverlap &&
    (
      recentExpansion ||
      bearishBodies > bullishBodies
    )
  ) {
    return {
      phase: "BUILDING_DOWN",
      evidenceBias: "DOWN",
    };
  }

  if (
    strongUpProgress &&
    recentContraction
  ) {
    return {
      phase: "FADING_UP",
      evidenceBias: "UP",
    };
  }

  if (
    strongDownProgress &&
    recentContraction
  ) {
    return {
      phase: "FADING_DOWN",
      evidenceBias: "DOWN",
    };
  }

  if (strongUpProgress) {
    return {
      phase: "PROGRESSING_UP",
      evidenceBias: "UP",
    };
  }

  if (strongDownProgress) {
    return {
      phase: "PROGRESSING_DOWN",
      evidenceBias: "DOWN",
    };
  }

  if (
    bullishBodies === bearishBodies ||
    (
      higherCloseCount > 0 &&
      lowerCloseCount > 0
    )
  ) {
    return {
      phase: "MIXED",
      evidenceBias: "MIXED",
    };
  }

  return {
    phase: "NO_CLEAR_SEQUENCE",
    evidenceBias: "NONE",
  };
}

export function buildSequenceMomentum(
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

  if (bars.length < 2) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      lookbackRequested: safeLookback,
      barsUsed: bars.length,
      phase: "INSUFFICIENT_SEQUENCE",
      evidenceBias: "NONE",
      reasonCodes: [
        "ENGINE3_V5_SEQUENCE_INSUFFICIENT_BARS",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  const pairs = [];

  for (let i = 1; i < bars.length; i += 1) {
    pairs.push(
      buildPairFacts(
        bars[i - 1],
        bars[i]
      )
    );
  }

  const higherCloseCount =
    countTrue(pairs, "higherClose");

  const lowerCloseCount =
    countTrue(pairs, "lowerClose");

  const higherHighCount =
    countTrue(pairs, "higherHigh");

  const lowerHighCount =
    countTrue(pairs, "lowerHigh");

  const higherLowCount =
    countTrue(pairs, "higherLow");

  const lowerLowCount =
    countTrue(pairs, "lowerLow");

  const rangeExpansionCount =
    countTrue(pairs, "rangeExpansion");

  const rangeContractionCount =
    countTrue(pairs, "rangeContraction");

  const bodyExpansionCount =
    countTrue(pairs, "bodyExpansion");

  const bodyContractionCount =
    countTrue(pairs, "bodyContraction");

  const bullishBodyCount =
    bars.filter(
      (bar) => bar.bullishBody === true
    ).length;

  const bearishBodyCount =
    bars.filter(
      (bar) => bar.bearishBody === true
    ).length;

  const dojiBodyCount =
    bars.filter(
      (bar) => bar.dojiBody === true
    ).length;

  const averageRange =
    safeAverage(
      bars.map(
        (bar) => bar.rangeSize
      )
    );

  const medianRange =
    safeMedian(
      bars.map(
        (bar) => bar.rangeSize
      )
    );

  const averageBody =
    safeAverage(
      bars.map(
        (bar) => bar.bodySize
      )
    );

  const medianBody =
    safeMedian(
      bars.map(
        (bar) => bar.bodySize
      )
    );

  const averageOverlapRatio =
    safeAverage(
      pairs
        .map(
          (pair) => pair.overlapRatio
        )
        .filter(
          (value) => value != null
        )
    );

  const splitIndex =
    Math.max(
      1,
      Math.floor(bars.length / 2)
    );

  const priorHalf =
    bars.slice(0, splitIndex);

  const recentHalf =
    bars.slice(splitIndex);

  const priorAverageRange =
    safeAverage(
      priorHalf.map(
        (bar) => bar.rangeSize
      )
    );

  const recentAverageRange =
    safeAverage(
      recentHalf.map(
        (bar) => bar.rangeSize
      )
    );

  const priorAverageBody =
    safeAverage(
      priorHalf.map(
        (bar) => bar.bodySize
      )
    );

  const recentAverageBody =
    safeAverage(
      recentHalf.map(
        (bar) => bar.bodySize
      )
    );

  const rangeTrend =
    priorAverageRange != null &&
    recentAverageRange != null
      ? recentAverageRange >
        priorAverageRange * 1.1
        ? "EXPANDING"
        : recentAverageRange <
          priorAverageRange * 0.9
        ? "CONTRACTING"
        : "STABLE"
      : "UNKNOWN";

  const bodyTrend =
    priorAverageBody != null &&
    recentAverageBody != null
      ? recentAverageBody >
        priorAverageBody * 1.1
        ? "EXPANDING"
        : recentAverageBody <
          priorAverageBody * 0.9
        ? "CONTRACTING"
        : "STABLE"
      : "UNKNOWN";

  const sequenceClassification =
    classifySequencePhase({
      bars,
      pairs,
      averageOverlapRatio,
      averageRange,
      recentAverageRange,
      priorAverageRange,
    });

  const firstClose =
    bars[0]?.close ??
    null;

  const lastClose =
    bars.at(-1)?.close ??
    null;

  const netCloseChange =
    Number.isFinite(Number(firstClose)) &&
    Number.isFinite(Number(lastClose))
      ? round6(
          Number(lastClose) -
          Number(firstClose)
        )
      : null;

  const highestHigh =
    Math.max(
      ...bars.map(
        (bar) => Number(bar.high)
      )
    );

  const lowestLow =
    Math.min(
      ...bars.map(
        (bar) => Number(bar.low)
      )
    );

  const totalSequenceRange =
    round6(
      highestHigh -
      lowestLow
    );

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    lookbackRequested:
      safeLookback,

    barsUsed:
      bars.length,

    firstBarTime:
      bars[0]?.time ??
      null,

    lastBarTime:
      bars.at(-1)?.time ??
      null,

    phase:
      sequenceClassification.phase,

    evidenceBias:
      sequenceClassification.evidenceBias,

    progression: {
      higherCloseCount,
      lowerCloseCount,

      higherHighCount,
      lowerHighCount,

      higherLowCount,
      lowerLowCount,

      bullishBodyCount,
      bearishBodyCount,
      dojiBodyCount,

      netCloseChange,

      highestHigh:
        round6(highestHigh),

      lowestLow:
        round6(lowestLow),

      totalSequenceRange,
    },

    expansionContraction: {
      rangeExpansionCount,
      rangeContractionCount,

      bodyExpansionCount,
      bodyContractionCount,

      averageRange,
      medianRange,

      averageBody,
      medianBody,

      priorAverageRange,
      recentAverageRange,

      priorAverageBody,
      recentAverageBody,

      rangeTrend,
      bodyTrend,
    },

    overlap: {
      averageOverlapRatio,

      highOverlap:
        averageOverlapRatio != null &&
        averageOverlapRatio >= 0.6,

      lowOverlap:
        averageOverlapRatio != null &&
        averageOverlapRatio <= 0.3,
    },

    pairs,

    bars,

    reasonCodes: [
      "ENGINE3_V5_SEQUENCE_MOMENTUM_BUILT",
      "ENGINE3_V5_MULTI_CANDLE_SEQUENCE_USED",
      `ENGINE3_V5_SEQUENCE_PHASE_${sequenceClassification.phase}`,
      `ENGINE3_V5_SEQUENCE_EVIDENCE_BIAS_${sequenceClassification.evidenceBias}`,
      "ENGINE3_V5_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default buildSequenceMomentum;
