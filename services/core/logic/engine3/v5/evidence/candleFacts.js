// services/core/logic/engine3/v5/evidence/candleFacts.js
//
// Engine 3 v5 — Per-candle and pairwise candle facts.
//
// Contract:
// - Pure evidence utility.
// - Consumes normalized bars from normalizePriceBars.js.
// - Describes candle geometry and bar-to-bar relationships.
// - Does not infer canonical direction.
// - Does not resolve buyer/seller control.
// - Does not create quality.
// - Does not create confirmation.
// - Does not create permission.
// - Does not create execution.
//
// IMPORTANT:
// This module may describe directional facts such as
// "higher close" or "lower low", but those are observations only.
// They are never canonical LONG / SHORT authority.

const ENGINE = "engine3.v5.evidence.candleFacts.v1";
const SOURCE = "engine3.v5.evidence.candleFacts";

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
    Number.isFinite(Number(bar.close))
  );
}

function classifyCloseLocation(bar) {
  if (!isValidBar(bar)) {
    return "UNKNOWN";
  }

  const pct = Number(bar.closeLocationPct);

  if (!Number.isFinite(pct)) {
    return "UNKNOWN";
  }

  if (pct >= 0.8) {
    return "NEAR_HIGH";
  }

  if (pct <= 0.2) {
    return "NEAR_LOW";
  }

  return "MIDDLE";
}

function classifyBodyPresence(bar) {
  if (!isValidBar(bar)) {
    return "UNKNOWN";
  }

  const bodyPct = Number(bar.bodyPctOfRange);

  if (!Number.isFinite(bodyPct)) {
    return "UNKNOWN";
  }

  if (bodyPct >= 0.65) {
    return "LARGE_BODY";
  }

  if (bodyPct <= 0.2) {
    return "SMALL_BODY";
  }

  return "MEDIUM_BODY";
}

function classifyWickProfile(bar) {
  if (!isValidBar(bar)) {
    return "UNKNOWN";
  }

  const upper = Number(bar.upperWick);
  const lower = Number(bar.lowerWick);
  const body = Number(bar.bodySize);
  const range = Number(bar.rangeSize);

  if (
    !Number.isFinite(upper) ||
    !Number.isFinite(lower) ||
    !Number.isFinite(body) ||
    !Number.isFinite(range)
  ) {
    return "UNKNOWN";
  }

  if (range === 0) {
    return "NO_RANGE";
  }

  const meaningfulUpper =
    upper >= Math.max(body * 1.5, range * 0.35);

  const meaningfulLower =
    lower >= Math.max(body * 1.5, range * 0.35);

  if (meaningfulUpper && meaningfulLower) {
    return "BOTH_WICKS_DOMINANT";
  }

  if (meaningfulUpper) {
    return "UPPER_WICK_DOMINANT";
  }

  if (meaningfulLower) {
    return "LOWER_WICK_DOMINANT";
  }

  return "BALANCED";
}

function classifyBodyType(bar) {
  if (!isValidBar(bar)) {
    return "UNKNOWN";
  }

  if (bar.dojiBody === true) {
    return "DOJI";
  }

  if (bar.bullishBody === true) {
    return "BULLISH_BODY";
  }

  if (bar.bearishBody === true) {
    return "BEARISH_BODY";
  }

  return "NEUTRAL_BODY";
}

export function buildSingleCandleFacts(
  bar
) {
  if (!isValidBar(bar)) {
    return {
      valid: false,
      engine: ENGINE,
      source: SOURCE,
      time: bar?.time ?? null,
      bodyType: "UNKNOWN",
      bodyPresence: "UNKNOWN",
      wickProfile: "UNKNOWN",
      closeLocation: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_SINGLE_CANDLE_INVALID",
      ],
    };
  }

  const bodyToRangeRatio =
    safeRatio(
      bar.bodySize,
      bar.rangeSize
    );

  const upperWickToBodyRatio =
    safeRatio(
      bar.upperWick,
      bar.bodySize
    );

  const lowerWickToBodyRatio =
    safeRatio(
      bar.lowerWick,
      bar.bodySize
    );

  const upperWickToRangeRatio =
    safeRatio(
      bar.upperWick,
      bar.rangeSize
    );

  const lowerWickToRangeRatio =
    safeRatio(
      bar.lowerWick,
      bar.rangeSize
    );

  return {
    valid: true,
    engine: ENGINE,
    source: SOURCE,

    time:
      bar.time,

    open:
      bar.open,

    high:
      bar.high,

    low:
      bar.low,

    close:
      bar.close,

    volume:
      bar.volume ?? null,

    bodyType:
      classifyBodyType(bar),

    bodyPresence:
      classifyBodyPresence(bar),

    wickProfile:
      classifyWickProfile(bar),

    closeLocation:
      classifyCloseLocation(bar),

    geometry: {
      bodySize:
        bar.bodySize,

      rangeSize:
        bar.rangeSize,

      bodyHigh:
        bar.bodyHigh,

      bodyLow:
        bar.bodyLow,

      upperWick:
        bar.upperWick,

      lowerWick:
        bar.lowerWick,

      bodyToRangeRatio,

      upperWickToBodyRatio,

      lowerWickToBodyRatio,

      upperWickToRangeRatio,

      lowerWickToRangeRatio,

      closeLocationPct:
        bar.closeLocationPct,
    },

    facts: {
      bullishBody:
        bar.bullishBody === true,

      bearishBody:
        bar.bearishBody === true,

      dojiBody:
        bar.dojiBody === true,

      closesNearHigh:
        classifyCloseLocation(bar) ===
        "NEAR_HIGH",

      closesNearLow:
        classifyCloseLocation(bar) ===
        "NEAR_LOW",

      closesMidRange:
        classifyCloseLocation(bar) ===
        "MIDDLE",

      upperWickDominant:
        classifyWickProfile(bar) ===
        "UPPER_WICK_DOMINANT",

      lowerWickDominant:
        classifyWickProfile(bar) ===
        "LOWER_WICK_DOMINANT",

      bothWicksDominant:
        classifyWickProfile(bar) ===
        "BOTH_WICKS_DOMINANT",

      largeBody:
        classifyBodyPresence(bar) ===
        "LARGE_BODY",

      smallBody:
        classifyBodyPresence(bar) ===
        "SMALL_BODY",
    },

    reasonCodes: [
      "ENGINE3_V5_SINGLE_CANDLE_FACTS_BUILT",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
    ],
  };
}

export function buildPairwiseCandleFacts(
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
        "ENGINE3_V5_PAIRWISE_CANDLE_INPUT_INVALID",
      ],
    };
  }

  const higherHigh =
    currentBar.high >
    previousBar.high;

  const lowerHigh =
    currentBar.high <
    previousBar.high;

  const equalHigh =
    currentBar.high ===
    previousBar.high;

  const higherLow =
    currentBar.low >
    previousBar.low;

  const lowerLow =
    currentBar.low <
    previousBar.low;

  const equalLow =
    currentBar.low ===
    previousBar.low;

  const higherClose =
    currentBar.close >
    previousBar.close;

  const lowerClose =
    currentBar.close <
    previousBar.close;

  const equalClose =
    currentBar.close ===
    previousBar.close;

  const higherOpen =
    currentBar.open >
    previousBar.open;

  const lowerOpen =
    currentBar.open <
    previousBar.open;

  const insideBar =
    currentBar.high <=
      previousBar.high &&
    currentBar.low >=
      previousBar.low;

  const outsideBar =
    currentBar.high >
      previousBar.high &&
    currentBar.low <
      previousBar.low;

  const rangeExpansion =
    currentBar.rangeSize >
    previousBar.rangeSize;

  const rangeContraction =
    currentBar.rangeSize <
    previousBar.rangeSize;

  const equalRange =
    currentBar.rangeSize ===
    previousBar.rangeSize;

  const bodyExpansion =
    currentBar.bodySize >
    previousBar.bodySize;

  const bodyContraction =
    currentBar.bodySize <
    previousBar.bodySize;

  const previousRange =
    Number(previousBar.rangeSize);

  const currentRange =
    Number(currentBar.rangeSize);

  const rangeRatio =
    Number.isFinite(previousRange) &&
    previousRange > 0
      ? round6(
          currentRange /
          previousRange
        )
      : null;

  const previousBody =
    Number(previousBar.bodySize);

  const currentBody =
    Number(currentBar.bodySize);

  const bodyRatio =
    Number.isFinite(previousBody) &&
    previousBody > 0
      ? round6(
          currentBody /
          previousBody
        )
      : null;

  const overlapHigh =
    Math.min(
      previousBar.high,
      currentBar.high
    );

  const overlapLow =
    Math.max(
      previousBar.low,
      currentBar.low
    );

  const overlapPoints =
    Math.max(
      0,
      overlapHigh -
      overlapLow
    );

  const smallerRange =
    Math.min(
      previousBar.rangeSize,
      currentBar.rangeSize
    );

  const overlapRatioOfSmallerRange =
    Number.isFinite(
      Number(smallerRange)
    ) &&
    Number(smallerRange) > 0
      ? round6(
          overlapPoints /
          smallerRange
        )
      : null;

  const strongOverlap =
    overlapRatioOfSmallerRange != null &&
    overlapRatioOfSmallerRange >= 0.6;

  const lowOverlap =
    overlapRatioOfSmallerRange != null &&
    overlapRatioOfSmallerRange <= 0.25;

  const closeProgressUp =
    higherClose &&
    (
      higherHigh ||
      higherLow
    );

  const closeProgressDown =
    lowerClose &&
    (
      lowerLow ||
      lowerHigh
    );

  const fullStructureUp =
    higherHigh &&
    higherLow &&
    higherClose;

  const fullStructureDown =
    lowerHigh &&
    lowerLow &&
    lowerClose;

  return {
    valid: true,
    engine: ENGINE,
    source: SOURCE,

    previousTime:
      previousBar.time,

    currentTime:
      currentBar.time,

    priceRelationships: {
      higherHigh,
      lowerHigh,
      equalHigh,

      higherLow,
      lowerLow,
      equalLow,

      higherClose,
      lowerClose,
      equalClose,

      higherOpen,
      lowerOpen,
    },

    structureRelationships: {
      insideBar,
      outsideBar,

      fullStructureUp,
      fullStructureDown,

      closeProgressUp,
      closeProgressDown,
    },

    expansionContraction: {
      rangeExpansion,
      rangeContraction,
      equalRange,

      bodyExpansion,
      bodyContraction,

      rangeRatio,
      bodyRatio,
    },

    overlap: {
      overlapPoints:
        round6(overlapPoints),

      overlapRatioOfSmallerRange,

      strongOverlap,

      lowOverlap,
    },

    reasonCodes: [
      "ENGINE3_V5_PAIRWISE_CANDLE_FACTS_BUILT",
      "ENGINE3_V5_DIRECTIONAL_RELATIONSHIPS_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
    ],
  };
}

export function buildCandleFacts(
  normalizedBars = []
) {
  const bars =
    Array.isArray(normalizedBars)
      ? normalizedBars.filter(
          (bar) =>
            isValidBar(bar)
        )
      : [];

  const candles =
    bars.map(
      (bar) =>
        buildSingleCandleFacts(bar)
    );

  const pairs = [];

  for (
    let i = 1;
    i < bars.length;
    i += 1
  ) {
    pairs.push(
      buildPairwiseCandleFacts(
        bars[i - 1],
        bars[i]
      )
    );
  }

  return {
    ok:
      bars.length > 0,

    engine: ENGINE,
    source: SOURCE,

    barCount:
      bars.length,

    pairCount:
      pairs.length,

    candles,

    pairs,

    latestCandle:
      candles.at(-1) ||
      null,

    priorCandle:
      candles.at(-2) ||
      null,

    latestPair:
      pairs.at(-1) ||
      null,

    reasonCodes: [
      "ENGINE3_V5_CANDLE_FACT_STACK_BUILT",
      "ENGINE3_V5_FACTS_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default buildCandleFacts;
