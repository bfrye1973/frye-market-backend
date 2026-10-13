// services/core/logic/engine22/wave/analyzeExtensionProgress.js
// Engine 22G — Generic Extension Progress Analyzer
//
// Purpose:
// Detect whether an active W3/W5 extension has already tagged projected fib levels,
// then determine whether price is now pulling back into the next retracement zone.
//
// This is generic across degrees:
// primary / intermediate / minor / minute / micro
//
// It does NOT create trades.
// It only adds read-only wave/fib intelligence.

const EXTENSION_ORDER = [
  { key: "e100", label: "1.000", value: 1.0 },
  { key: "e1168", label: "1.168", value: 1.168 },
  { key: "e1272", label: "1.272", value: 1.272 },
  { key: "e1618", label: "1.618", value: 1.618 },
  { key: "e200", label: "2.000", value: 2.0 },
  { key: "e2618", label: "2.618", value: 2.618 },
];

const RETRACE_ORDER = [
  { key: "r236", label: "23.6%", value: 0.236 },
  { key: "r382", label: "38.2%", value: 0.382 },
  { key: "r500", label: "50.0%", value: 0.5 },
  { key: "r618", label: "61.8%", value: 0.618 },
  { key: "r786", label: "78.6%", value: 0.786 },
];

const BAR_KEY_PREFERENCE = {
  micro: ["1m", "5m", "10m", "intraday", "scalp"],
  minute: ["10m", "15m", "30m", "intraday", "scalp"],
  minor: ["1h", "60m", "hourly"],
  intermediate: ["4h", "240m", "fourHour"],
  primary: ["1d", "daily", "eod"],
};

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function upper(x) {
  return String(x || "").trim().toUpperCase();
}

function normalizeDirection(direction) {
  return upper(direction) === "BEARISH" ? "BEARISH" : "BULLISH";
}

function getMark(block, key) {
  const mark = block?.waveMarks?.[key] || null;
  const p = toNum(mark?.p);
  const tSec = toNum(mark?.tSec);

  return {
    price: p !== null && p > 0 ? p : null,
    timeSec: tSec !== null && tSec > 0 ? tSec : null,
    raw: mark,
  };
}

function normalizeBarTime(bar) {
  const raw =
    bar?.timeSec ??
    bar?.tSec ??
    bar?.timestampSec ??
    bar?.timestamp ??
    bar?.time ??
    bar?.t ??
    null;

  if (typeof raw === "number") {
    // If milliseconds, convert to seconds.
    return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
  }

  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return n > 10_000_000_000 ? Math.floor(n / 1000) : n;
    }

    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return null;
}

function normalizeBar(bar) {
  if (!bar || typeof bar !== "object") return null;

  const timeSec = normalizeBarTime(bar);
  const high = toNum(bar.high ?? bar.h);
  const low = toNum(bar.low ?? bar.l);
  const close = toNum(bar.close ?? bar.c);

  if (timeSec === null) return null;
  if (high === null && low === null && close === null) return null;

  return {
    timeSec,
    high: high ?? close,
    low: low ?? close,
    close,
    raw: bar,
  };
}

function collectArrays(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;

  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === "object") out.push(obj);
    return out;
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === "object") out.push(value);
    } else if (value && typeof value === "object") {
      collectArrays(value, out);
    }
  }

  return out;
}

function selectBarsForDegree({ degree, barsByTf }) {
  if (!barsByTf || typeof barsByTf !== "object") return [];

  const d = String(degree || "").toLowerCase();
  const preferred = BAR_KEY_PREFERENCE[d] || [];

  for (const key of preferred) {
    const direct = barsByTf?.[key];
    if (Array.isArray(direct) && direct.length) {
      return direct.map(normalizeBar).filter(Boolean);
    }

    if (direct && typeof direct === "object") {
      const nestedArrays = collectArrays(direct);
      if (nestedArrays.length) {
        return nestedArrays[0].map(normalizeBar).filter(Boolean);
      }
    }
  }

  const allArrays = collectArrays(barsByTf);
  if (!allArrays.length) return [];

  return allArrays[0].map(normalizeBar).filter(Boolean);
}

function hitTolerancePts(symbol) {
  const s = String(symbol || "").toUpperCase();

  if (s === "ES" || s.startsWith("ES") || s === "MES" || s.startsWith("MES")) {
    return 1.0;
  }

  if (s === "NQ" || s.startsWith("NQ") || s === "MNQ" || s.startsWith("MNQ")) {
    return 4.0;
  }

  return 0;
}

function reachedLevel({ extreme, level, direction, symbol }) {
  const e = toNum(extreme);
  const l = toNum(level);

  if (e === null || l === null) return false;

  const tolerance = hitTolerancePts(symbol);

  return direction === "BULLISH"
    ? e >= l - tolerance
    : e <= l + tolerance;
}

function findHitExtensions({ extremePrice, levels, direction, symbol }) {
  const hit = [];
  const notHitYet = [];

  for (const fib of EXTENSION_ORDER) {
    const price = toNum(levels?.[fib.key]);
    if (price === null) continue;

    const row = {
      key: fib.key,
      label: fib.label,
      value: fib.value,
      price: round2(price),
    };

    if (reachedLevel({ extreme: extremePrice, level: price, direction, symbol })) {
      hit.push(row);
    } else {
      notHitYet.push(row);
    }
  }

  return {
    hit,
    notHitYet,
    highestHit: hit.length ? hit[hit.length - 1] : null,
  };
}

function buildRetraceLevels({ anchorPrice, extremePrice, direction }) {
  const anchor = toNum(anchorPrice);
  const extreme = toNum(extremePrice);

  if (anchor === null || extreme === null || anchor === extreme) return null;

  const range = Math.abs(extreme - anchor);
  if (!Number.isFinite(range) || range <= 0) return null;

  const levels = {};

  for (const r of RETRACE_ORDER) {
    const price =
      direction === "BULLISH"
        ? extreme - range * r.value
        : extreme + range * r.value;

    levels[r.key] = round2(price);
  }

  return {
    anchorPrice: round2(anchor),
    extremePrice: round2(extreme),
    range: round2(range),
    levels,
  };
}

function nearestRetraceZone({ currentPrice, retraceLevels }) {
  const price = toNum(currentPrice);
  const levels = retraceLevels?.levels || null;

  if (price === null || !levels) return null;

  let best = null;

  for (const r of RETRACE_ORDER) {
    const levelPrice = toNum(levels[r.key]);
    if (levelPrice === null) continue;

    const distancePts = price - levelPrice;
    const absDistancePts = Math.abs(distancePts);

    if (!best || absDistancePts < best.absDistancePts) {
      best = {
        key: r.key,
        label: r.label,
        price: round2(levelPrice),
        distancePts: round2(distancePts),
        absDistancePts: round2(absDistancePts),
      };
    }
  }

  return best;
}

function buildRead({
  degree,
  activeWave,
  highestHit,
  extremePrice,
  retraceZone,
  state,
}) {
  const degreeName = String(degree || "degree").toUpperCase();
  const waveName = activeWave || "EXTENSION";

  if (state === "POST_EXTENSION_PULLBACK" && highestHit) {
    return `${degreeName} ${waveName} already tagged the ${highestHit.label} extension near ${round2(
      highestHit.price
    )} and is now pulling back${
      retraceZone?.label ? ` near the ${retraceZone.label} retrace zone` : ""
    }.`;
  }

  if (state === "EXTENSION_TAGGED_ACTIVE" && highestHit) {
    return `${degreeName} ${waveName} has tagged the ${highestHit.label} extension near ${round2(
      highestHit.price
    )}; monitor reaction versus continuation.`;
  }

  if (state === "EXTENSION_NOT_HIT") {
    return `${degreeName} ${waveName} has not tagged a tracked extension level yet.`;
  }

  return `${degreeName} extension progress is unavailable.`;
}

export function analyzeExtensionProgress({
  symbol = "SPY",
  degree = null,
  phase = "UNKNOWN",
  direction = "BULLISH",
  currentPrice = null,
  block = null,
  fibProjection = null,
  barsByTf = {},
} = {}) {
  const dir = normalizeDirection(direction);
  const phaseKey = upper(phase);
  const price = toNum(currentPrice);
  const levels = fibProjection?.levels || null;

  if (!levels || typeof levels !== "object") {
    return {
      ok: false,
      symbol,
      degree,
      activeWave: null,
      state: "NO_EXTENSION_LEVELS",
      reasonCodes: ["MISSING_EXTENSION_LEVELS"],
    };
  }

  const isW3 = phaseKey === "IN_W3";
  const isW5 = phaseKey === "IN_W5";

  if (!isW3 && !isW5) {
    return {
      ok: true,
      active: false,
      symbol,
      degree,
      activeWave: null,
      state: "NOT_ACTIVE_EXTENSION_PHASE",
      reasonCodes: ["PHASE_NOT_W3_OR_W5"],
    };
  }

  const activeWave = isW3 ? "W3" : "W5";
  const anchorWave = isW3 ? "W2" : "W4";
  const anchorMark = getMark(block, anchorWave);

  const anchorPrice =
    anchorMark.price ??
    (isW3 ? toNum(fibProjection?.anchors?.w2) : toNum(fibProjection?.anchors?.w4));

  const anchorTimeSec = anchorMark.timeSec;

  if (anchorPrice === null) {
    return {
      ok: false,
      symbol,
      degree,
      activeWave,
      anchorWave,
      state: "MISSING_ANCHOR_PRICE",
      reasonCodes: ["MISSING_ANCHOR_PRICE"],
    };
  }

  const bars = selectBarsForDegree({ degree, barsByTf });

  const barsAfterAnchor =
    anchorTimeSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(anchorTimeSec))
      : bars;

  let extremePrice = null;
  let extremeTimeSec = null;

  for (const bar of barsAfterAnchor) {
    const candidate = dir === "BULLISH" ? toNum(bar.high) : toNum(bar.low);
    if (candidate === null) continue;

    if (
      extremePrice === null ||
      (dir === "BULLISH" ? candidate > extremePrice : candidate < extremePrice)
    ) {
      extremePrice = candidate;
      extremeTimeSec = bar.timeSec;
    }
  }

  // Fallback: if bars are unavailable, use current price.
  if (extremePrice === null) {
    extremePrice = price;
    extremeTimeSec = null;
  }

  if (extremePrice === null || price === null) {
    return {
      ok: false,
      symbol,
      degree,
      activeWave,
      anchorWave,
      anchorPrice: round2(anchorPrice),
      state: "MISSING_PRICE_OR_BARS",
      reasonCodes: ["MISSING_PRICE_OR_BARS"],
    };
  }

  const { hit, notHitYet, highestHit } = findHitExtensions({
    extremePrice,
    levels,
    direction: dir,
    symbol,
  });

  const pullbackFromExtremePts =
    dir === "BULLISH" ? price - extremePrice : extremePrice - price;

  const pullbackFromExtremePct =
    extremePrice !== 0 ? (pullbackFromExtremePts / extremePrice) * 100 : null;

  const rangeFromAnchor = Math.abs(extremePrice - anchorPrice);
  const meaningfulPullback =
    highestHit &&
    rangeFromAnchor > 0 &&
    Math.abs(pullbackFromExtremePts) >= Math.max(1, rangeFromAnchor * 0.10);

  const state =
    highestHit && meaningfulPullback
      ? "POST_EXTENSION_PULLBACK"
      : highestHit
      ? "EXTENSION_TAGGED_ACTIVE"
      : "EXTENSION_NOT_HIT";

  const retrace = buildRetraceLevels({
    anchorPrice,
    extremePrice,
    direction: dir,
  });

  const retraceZone = nearestRetraceZone({
    currentPrice: price,
    retraceLevels: retrace,
  });

  const read = buildRead({
    degree,
    activeWave,
    highestHit,
    extremePrice,
    retraceZone,
    state,
  });

  return {
    ok: true,
    active: true,
    symbol,
    degree,
    direction: dir,

    activeWave,
    anchorWave,
    anchorPrice: round2(anchorPrice),
    anchorTimeSec,

    currentPrice: round2(price),

    highestExtremePrice: round2(extremePrice),
    highestExtremeTimeSec: extremeTimeSec,

    highestExtensionHit: highestHit?.label || null,
    highestExtensionKey: highestHit?.key || null,
    highestExtensionPrice: highestHit?.price ?? null,

    hitLevels: hit.map((x) => x.label),
    hitLevelDetails: hit,
    notHitYet: notHitYet.map((x) => x.label),

    pullbackFromExtremePts: round2(pullbackFromExtremePts),
    pullbackFromExtremePct: round2(pullbackFromExtremePct),

    nextLikelyWave: isW3 ? "W4" : "A_OR_NEW_CORRECTION",

    retraceLevels: retrace,
    currentRetraceZone: retraceZone,

    state,
    read,

    reasonCodes: [
      "EXTENSION_PROGRESS_ANALYZED",
      highestHit ? `HIT_${highestHit.key.toUpperCase()}` : "NO_EXTENSION_HIT",
      state,
    ],
  };
}

export default analyzeExtensionProgress;
