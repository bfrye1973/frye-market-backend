function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBar(bar) {
  const open = toNum(bar?.open ?? bar?.o);
  const high = toNum(bar?.high ?? bar?.h);
  const low = toNum(bar?.low ?? bar?.l);
  const close = toNum(bar?.close ?? bar?.c);
  const time = bar?.time ?? bar?.t ?? bar?.tSec ?? null;

  if ([open, high, low, close].some((value) => value == null)) return null;
  if (high < low) return null;

  const range = high - low;
  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const upperWick = Math.max(0, high - bodyHigh);
  const lowerWick = Math.max(0, bodyLow - low);

  return {
    time,
    open,
    high,
    low,
    close,
    range,
    upperWick,
    lowerWick,
    upperWickPct: range > 0 ? upperWick / range : 0,
    lowerWickPct: range > 0 ? lowerWick / range : 0,
    closeLocationPct: range > 0 ? (close - low) / range : 0.5,
  };
}

export function buildHigherTimeframeWickContext({
  bars = [],
  timeframe = "1h",
  completedBarsOnly = true,
  sampleSize = 3,
} = {}) {
  const rawBars = Array.isArray(bars) ? bars.filter(Boolean) : [];

  const completed =
    completedBarsOnly && rawBars.length >= 2
      ? rawBars.slice(0, -1)
      : rawBars;

  const normalized = completed
    .slice(-Math.max(1, sampleSize))
    .map(normalizeBar)
    .filter(Boolean);

  if (!normalized.length) {
    return {
      active: false,
      engine: "engine27.higherTimeframeWickContext.v1",
      timeframe,
      bias: "INSUFFICIENT_DATA",
      supportsLong: false,
      supportsShort: false,
      conflictsWithLong: false,
      conflictsWithShort: false,
      barsUsed: 0,
      reasonCodes: ["ENGINE27_HTF_WICK_DATA_UNAVAILABLE"],
    };
  }

  const strongUpperWicks = normalized.filter(
    (bar) =>
      bar.upperWickPct >= 0.35 &&
      bar.upperWick > bar.lowerWick
  ).length;

  const strongLowerWicks = normalized.filter(
    (bar) =>
      bar.lowerWickPct >= 0.35 &&
      bar.lowerWick > bar.upperWick
  ).length;

  const closesNearHigh = normalized.filter(
    (bar) => bar.closeLocationPct >= 0.65
  ).length;

  const closesNearLow = normalized.filter(
    (bar) => bar.closeLocationPct <= 0.35
  ).length;

  let bias = "BALANCED";

  if (
    strongLowerWicks >= 2 &&
    strongLowerWicks > strongUpperWicks
  ) {
    bias = "LOWER_WICK_BUYER_DEFENSE";
  } else if (
    strongUpperWicks >= 2 &&
    strongUpperWicks > strongLowerWicks
  ) {
    bias = "UPPER_WICK_SELLER_REJECTION";
  } else if (
    strongLowerWicks > 0 &&
    strongUpperWicks > 0
  ) {
    bias = "TWO_SIDED_REJECTION";
  } else if (closesNearHigh >= 2) {
    bias = "CLOSE_STRENGTH_BULLISH";
  } else if (closesNearLow >= 2) {
    bias = "CLOSE_WEAKNESS_BEARISH";
  }

  const supportsLong = [
    "LOWER_WICK_BUYER_DEFENSE",
    "CLOSE_STRENGTH_BULLISH",
  ].includes(bias);

  const supportsShort = [
    "UPPER_WICK_SELLER_REJECTION",
    "CLOSE_WEAKNESS_BEARISH",
  ].includes(bias);

  return {
    active: true,
    engine: "engine27.higherTimeframeWickContext.v1",
    timeframe,
    role: "DIRECTIONAL_CONTEXT_ONLY",
    bias,
    supportsLong,
    supportsShort,
    conflictsWithLong: supportsShort,
    conflictsWithShort: supportsLong,
    barsUsed: normalized.length,
    strongUpperWicks,
    strongLowerWicks,
    closesNearHigh,
    closesNearLow,
    latestCompletedBar: normalized[normalized.length - 1] || null,
    noPermissionCreated: true,
    noExecution: true,
    reasonCodes: [
      "ENGINE27_HTF_WICK_CONTEXT_BUILT",
      bias,
      "CONTEXT_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildHigherTimeframeWickContext;
