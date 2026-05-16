// services/core/logic/engine22/wave/projectFibExtensions.js
// Engine 22G — Generic Wave/Fib State Engine
// File 1: projectFibExtensions.js
//
// Purpose:
// Given W2, W3, and W4, calculate W5 extension targets.
// This is read-only intelligence. It does not create trades.
//
// Bullish formula:
// target = W4 + abs(W3 - W2) * fib
//
// Bearish formula:
// target = W4 - abs(W3 - W2) * fib

const DEFAULT_FIBS = [
  { key: "e100", label: "1.000", value: 1.0 },
  { key: "e1168", label: "1.168", value: 1.168 },
  { key: "e1272", label: "1.272", value: 1.272 },
  { key: "e1618", label: "1.618", value: 1.618 },
  { key: "e200", label: "2.000", value: 2.0 },
  { key: "e2618", label: "2.618", value: 2.618 },
];

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function tickSizeForSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();

  if (["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K"].includes(s)) {
    return 0.25;
  }

  return null;
}

function roundToTick(price, tickSize) {
  const p = Number(price);
  const t = Number(tickSize);

  if (!Number.isFinite(p)) return null;
  if (!Number.isFinite(t) || t <= 0) return round2(p);

  return Number((Math.round(p / t) * t).toFixed(2));
}

function normalizeDirection({ direction, w2, w3 }) {
  const explicit = String(direction || "").trim().toUpperCase();

  if (explicit === "BULLISH") return "BULLISH";
  if (explicit === "BEARISH") return "BEARISH";

  const a = toNum(w2);
  const b = toNum(w3);

  if (a !== null && b !== null && b < a) return "BEARISH";

  return "BULLISH";
}

function buildInvalidReturn({
  symbol = null,
  direction = null,
  w2 = null,
  w3 = null,
  w4 = null,
  reason = "INVALID_EXTENSION_INPUTS",
} = {}) {
  return {
    ok: false,
    source: "W4_TO_W5",
    symbol,
    direction,
    anchors: {
      w2: toNum(w2),
      w3: toNum(w3),
      w4: toNum(w4),
    },
    range: null,
    rawLevels: null,
    levels: null,
    tickSize: null,
    reason,
    reasonCodes: [reason],
  };
}

export function projectFibExtensions({
  symbol = null,
  direction = null,
  w2 = null,
  w3 = null,
  w4 = null,
  tickSize = null,
  fibs = DEFAULT_FIBS,
} = {}) {
  const anchorW2 = toNum(w2);
  const anchorW3 = toNum(w3);
  const anchorW4 = toNum(w4);

  if (anchorW2 === null || anchorW3 === null || anchorW4 === null) {
    return buildInvalidReturn({
      symbol,
      direction,
      w2,
      w3,
      w4,
      reason: "MISSING_W2_W3_W4_ANCHORS",
    });
  }

  const range = Math.abs(anchorW3 - anchorW2);

  if (!Number.isFinite(range) || range <= 0) {
    return buildInvalidReturn({
      symbol,
      direction,
      w2,
      w3,
      w4,
      reason: "INVALID_W2_W3_RANGE",
    });
  }

  const dir = normalizeDirection({
    direction,
    w2: anchorW2,
    w3: anchorW3,
  });

  const sign = dir === "BEARISH" ? -1 : 1;

  const effectiveTickSize =
    toNum(tickSize) ??
    tickSizeForSymbol(symbol);

  const rawLevels = {};
  const levels = {};
  const fibMeta = {};

  for (const fib of fibs) {
    const key = fib?.key;
    const label = fib?.label;
    const value = Number(fib?.value);

    if (!key || !Number.isFinite(value)) continue;

    const raw = anchorW4 + sign * range * value;

    rawLevels[key] = raw;
    levels[key] =
      effectiveTickSize !== null
        ? roundToTick(raw, effectiveTickSize)
        : round2(raw);

    fibMeta[key] = {
      label,
      value,
    };
  }

  return {
    ok: true,
    source: "W4_TO_W5",
    symbol,
    direction: dir,
    anchors: {
      w2: round2(anchorW2),
      w3: round2(anchorW3),
      w4: round2(anchorW4),
    },
    range: round2(range),
    rawLevels,
    levels,
    fibMeta,
    tickSize: effectiveTickSize,
    reason: "W2_W3_W4_ANCHORS_VALID",
    reasonCodes: ["W2_W3_W4_ANCHORS_VALID"],
  };
}

export default projectFibExtensions;
