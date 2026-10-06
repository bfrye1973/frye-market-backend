// services/core/logic/engine3/v5/evidence/normalizePriceBars.js
//
// Engine 3 v5 — Raw price-bar normalization.
//
// Contract:
// - Pure evidence utility.
// - Normalizes OHLCV bars only.
// - Preserves source ordering.
// - Does not infer candle completion.
// - Does not infer buyer/seller control.
// - Does not create LONG / SHORT / NEUTRAL.
// - Does not create quality.
// - Does not create confirmation.
// - Does not create permission.
// - Does not create execution.
//
// Runtime source proven:
// /api/v1/futures/ohlc
//
// Canonical raw shape:
// {
//   time,
//   open,
//   high,
//   low,
//   close,
//   volume
// }
//
// Runtime ordering proven:
// oldest -> newest
//
// IMPORTANT:
// Candle completion authority belongs to
// deriveCandleCompletionTruth() and must be applied outside this module.

const ENGINE = "engine3.v5.evidence.normalizePriceBars.v1";
const SOURCE = "engine3.v5.evidence.normalizePriceBars";

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundPrice(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Number(n.toFixed(6))
    : null;
}

function resolveTimeSeconds(bar = {}) {
  const raw =
    bar?.time ??
    bar?.t ??
    bar?.tSec ??
    null;

  const n = Number(raw);

  if (!Number.isFinite(n)) {
    return null;
  }

  // Runtime OHLC currently publishes Unix seconds.
  // Defensively normalize milliseconds if ever supplied.
  if (n > 10_000_000_000) {
    return Math.floor(n / 1000);
  }

  return Math.floor(n);
}

function buildBarGeometry({
  open,
  high,
  low,
  close,
} = {}) {
  const completeOhlc =
    open != null &&
    high != null &&
    low != null &&
    close != null;

  if (!completeOhlc) {
    return {
      bodySize: null,
      rangeSize: null,
      bodyHigh: null,
      bodyLow: null,
      upperWick: null,
      lowerWick: null,
      bullishBody: false,
      bearishBody: false,
      dojiBody: false,
      bodyPctOfRange: null,
      upperWickPctOfRange: null,
      lowerWickPctOfRange: null,
      closeLocationPct: null,
      geometryValid: false,
    };
  }

  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const bodySize = Math.abs(close - open);
  const rangeSize = Math.max(0, high - low);
  const upperWick = Math.max(0, high - bodyHigh);
  const lowerWick = Math.max(0, bodyLow - low);

  const bullishBody = close > open;
  const bearishBody = close < open;
  const dojiBody = close === open;

  const bodyPctOfRange =
    rangeSize > 0
      ? Number((bodySize / rangeSize).toFixed(6))
      : 0;

  const upperWickPctOfRange =
    rangeSize > 0
      ? Number((upperWick / rangeSize).toFixed(6))
      : 0;

  const lowerWickPctOfRange =
    rangeSize > 0
      ? Number((lowerWick / rangeSize).toFixed(6))
      : 0;

  // 0 = close at candle low, 1 = close at candle high.
  const closeLocationPct =
    rangeSize > 0
      ? Number(((close - low) / rangeSize).toFixed(6))
      : 0.5;

  return {
    bodySize: roundPrice(bodySize),
    rangeSize: roundPrice(rangeSize),
    bodyHigh: roundPrice(bodyHigh),
    bodyLow: roundPrice(bodyLow),
    upperWick: roundPrice(upperWick),
    lowerWick: roundPrice(lowerWick),
    bullishBody,
    bearishBody,
    dojiBody,
    bodyPctOfRange,
    upperWickPctOfRange,
    lowerWickPctOfRange,
    closeLocationPct,
    geometryValid: true,
  };
}

export function normalizePriceBar(
  bar,
  {
    sourceIndex = null,
  } = {}
) {
  if (!bar || typeof bar !== "object") {
    return {
      valid: false,
      engine: ENGINE,
      source: SOURCE,
      sourceIndex,
      time: null,
      open: null,
      high: null,
      low: null,
      close: null,
      volume: null,
      bodySize: null,
      rangeSize: null,
      bodyHigh: null,
      bodyLow: null,
      upperWick: null,
      lowerWick: null,
      bullishBody: false,
      bearishBody: false,
      dojiBody: false,
      bodyPctOfRange: null,
      upperWickPctOfRange: null,
      lowerWickPctOfRange: null,
      closeLocationPct: null,
      geometryValid: false,
      reasonCodes: [
        "ENGINE3_V5_BAR_NOT_OBJECT",
      ],
    };
  }

  const time = resolveTimeSeconds(bar);

  const open = toFiniteNumber(
    bar?.open ??
    bar?.o
  );

  const high = toFiniteNumber(
    bar?.high ??
    bar?.h
  );

  const low = toFiniteNumber(
    bar?.low ??
    bar?.l
  );

  const close = toFiniteNumber(
    bar?.close ??
    bar?.c
  );

  const volume = toFiniteNumber(
    bar?.volume ??
    bar?.v
  );

  const hasOhlc =
    open != null &&
    high != null &&
    low != null &&
    close != null;

  const highLowValid =
    high != null &&
    low != null &&
    high >= low;

  const openInsideRange =
    hasOhlc &&
    open >= low &&
    open <= high;

  const closeInsideRange =
    hasOhlc &&
    close >= low &&
    close <= high;

  const valid =
    time != null &&
    hasOhlc &&
    highLowValid &&
    openInsideRange &&
    closeInsideRange;

  const geometry =
    buildBarGeometry({
      open,
      high,
      low,
      close,
    });

  const reasonCodes = [
    "ENGINE3_V5_PRICE_BAR_NORMALIZED",

    time == null
      ? "ENGINE3_V5_BAR_TIME_MISSING"
      : null,

    !hasOhlc
      ? "ENGINE3_V5_BAR_OHLC_INCOMPLETE"
      : null,

    hasOhlc && !highLowValid
      ? "ENGINE3_V5_BAR_HIGH_LOW_INVALID"
      : null,

    hasOhlc && !openInsideRange
      ? "ENGINE3_V5_BAR_OPEN_OUTSIDE_RANGE"
      : null,

    hasOhlc && !closeInsideRange
      ? "ENGINE3_V5_BAR_CLOSE_OUTSIDE_RANGE"
      : null,

    valid
      ? "ENGINE3_V5_PRICE_BAR_VALID"
      : "ENGINE3_V5_PRICE_BAR_INVALID",
  ].filter(Boolean);

  return {
    valid,
    engine: ENGINE,
    source: SOURCE,
    sourceIndex,
    time,
    open: roundPrice(open),
    high: roundPrice(high),
    low: roundPrice(low),
    close: roundPrice(close),
    volume:
      volume != null
        ? Number(volume)
        : null,
    ...geometry,

    // Completion intentionally omitted.
    // deriveCandleCompletionTruth() remains the only completion authority.

    reasonCodes,
  };
}

export function normalizePriceBars(
  bars = []
) {
  const sourceBars =
    Array.isArray(bars)
      ? bars
      : [];

  const normalizedBars =
    sourceBars.map(
      (bar, sourceIndex) =>
        normalizePriceBar(
          bar,
          { sourceIndex }
        )
    );

  const validBars =
    normalizedBars.filter(
      (bar) =>
        bar?.valid === true
    );

  const invalidBars =
    normalizedBars.filter(
      (bar) =>
        bar?.valid !== true
    );

  // Preserve runtime ordering: oldest -> newest.
  // Do not sort here; reordering would hide upstream issues.
  return {
    ok:
      sourceBars.length > 0 &&
      validBars.length > 0,

    engine: ENGINE,
    source: SOURCE,

    sourceOrdering:
      "OLDEST_TO_NEWEST",

    sourceBarCount:
      sourceBars.length,

    validBarCount:
      validBars.length,

    invalidBarCount:
      invalidBars.length,

    bars:
      validBars,

    invalidBars,

    oldestBar:
      validBars[0] ||
      null,

    newestBar:
      validBars.at(-1) ||
      null,

    reasonCodes: [
      "ENGINE3_V5_PRICE_BARS_NORMALIZED",
      "ENGINE3_V5_SOURCE_ORDER_PRESERVED",
      "ENGINE3_V5_NO_CANDLE_COMPLETION_INFERRED",
      "ENGINE3_V5_NO_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default normalizePriceBars;
