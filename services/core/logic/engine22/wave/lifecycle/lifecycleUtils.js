// services/core/logic/engine22/wave/lifecycle/lifecycleUtils.js

export function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function upper(x, fallback = "UNKNOWN") {
  return String(x || fallback).trim().toUpperCase();
}

export function tickSizeForSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();

  if (
    s === "ES" ||
    s.startsWith("ES") ||
    s === "MES" ||
    s.startsWith("MES") ||
    s === "NQ" ||
    s.startsWith("NQ") ||
    s === "MNQ" ||
    s.startsWith("MNQ")
  ) {
    return 0.25;
  }

  return 0.01;
}

export function roundToTick(value, tickSize = 0.01) {
  const n = toNum(value);
  if (n === null) return null;

  return Number((Math.round(n / tickSize) * tickSize).toFixed(2));
}

export function isEsLikeSymbol(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  return s === "ES" || s.startsWith("ES") || s === "MES" || s.startsWith("MES");
}

/* =========================
   Candle helpers
========================= */

export function parseManualTimeSec(value) {
  if (!value) return null;

  const raw = String(value).trim();
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(normalized);

  if (Number.isFinite(parsed)) {
    return Math.floor(parsed / 1000);
  }

  return null;
}

export function normalizeBarTime(bar) {
  const raw =
    bar?.timeSec ??
    bar?.tSec ??
    bar?.timestampSec ??
    bar?.timestamp ??
    bar?.time ??
    bar?.t ??
    null;

  if (typeof raw === "number") {
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

export function normalizeBar(bar) {
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

export function degreeToTf(degree, fallback = null) {
  const d = String(degree || "").toLowerCase();

  if (d === "primary") return "1d";
  if (d === "intermediate") return "1h";
  if (d === "minor") return "1h";
  if (d === "minute") return "10m";
  if (d === "micro") return "10m";

  return fallback || "10m";
}

export function getBarsForDegree({ degree, barsByTf, fallbackTf = "10m" } = {}) {
  const tf = degreeToTf(degree, fallbackTf);
  const direct = barsByTf?.[tf];

  if (Array.isArray(direct)) {
    return direct.map(normalizeBar).filter(Boolean);
  }

  return [];
}

export function formatTimeSec(timeSec) {
  const n = Number(timeSec);
  if (!Number.isFinite(n) || n <= 0) return null;

  return new Date(n * 1000).toISOString();
}

export function findLatestAnchorTouch({
  bars = [],
  anchorPrice = null,
  afterSec = null,
  direction = "HIGH",
  tolerance = 0.5,
} = {}) {
  const anchor = toNum(anchorPrice);
  if (anchor === null || !Array.isArray(bars) || !bars.length) return null;

  const dir = upper(direction, "HIGH");

  const scopedBars =
    afterSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(afterSec))
      : bars;

  let latest = null;

  for (const bar of scopedBars) {
    const high = toNum(bar.high);
    const low = toNum(bar.low);

    const touched =
      dir === "LOW"
        ? low !== null && low <= anchor + tolerance
        : high !== null && high >= anchor - tolerance;

    if (touched) {
      latest = {
        price: anchor,
        timeSec: bar.timeSec,
        time: formatTimeSec(bar.timeSec),
        source: dir === "LOW" ? "AUTO_ANCHOR_LOW_TOUCH" : "AUTO_ANCHOR_HIGH_TOUCH",
      };
    }
  }

  return latest;
}

export function findLatestSwingLowAfterTime({ bars = [], afterSec = null } = {}) {
  if (!Array.isArray(bars) || bars.length < 3) return null;

  const scopedBars =
    afterSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(afterSec))
      : bars;

  if (scopedBars.length < 3) return null;

  let latest = null;

  for (let i = 1; i < scopedBars.length - 1; i++) {
    const prevLow = toNum(scopedBars[i - 1]?.low);
    const low = toNum(scopedBars[i]?.low);
    const nextLow = toNum(scopedBars[i + 1]?.low);

    if (prevLow === null || low === null || nextLow === null) continue;

    if (low <= prevLow && low <= nextLow) {
      latest = {
        price: low,
        timeSec: scopedBars[i].timeSec,
        time: formatTimeSec(scopedBars[i].timeSec),
        close: scopedBars[i].close,
        source: "AUTO_CANDLE_SWING_LOW",
      };
    }
  }

  return latest;
}

export function findSwingLowsAfterTime({ bars = [], afterSec = null } = {}) {
  if (!Array.isArray(bars) || bars.length < 3) return [];

  const scopedBars =
    afterSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(afterSec))
      : bars;

  if (scopedBars.length < 3) return [];

  const lows = [];

  for (let i = 1; i < scopedBars.length - 1; i++) {
    const prevLow = toNum(scopedBars[i - 1]?.low);
    const low = toNum(scopedBars[i]?.low);
    const nextLow = toNum(scopedBars[i + 1]?.low);

    if (prevLow === null || low === null || nextLow === null) continue;

    if (low <= prevLow && low <= nextLow) {
      lows.push({
        price: low,
        timeSec: scopedBars[i].timeSec,
        time: formatTimeSec(scopedBars[i].timeSec),
        close: scopedBars[i].close,
        source: "AUTO_CANDLE_SWING_LOW",
      });
    }
  }

  return lows;
}

export function findLowestLowAfterTime({ bars = [], afterSec = null } = {}) {
  if (!Array.isArray(bars) || !bars.length) return null;

  const scopedBars =
    afterSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(afterSec))
      : bars;

  let lowest = null;

  for (const bar of scopedBars) {
    const low = toNum(bar?.low);
    if (low === null) continue;

    if (!lowest || low < lowest.price) {
      lowest = {
        price: low,
        timeSec: bar.timeSec,
        time: formatTimeSec(bar.timeSec),
        close: bar.close,
        source: "AUTO_LOWEST_LOW_AFTER_A_FALLBACK",
      };
    }
  }

  return lowest;
}

export function pickLowestCandidate(candidates = [], source = "AUTO_STRUCTURAL_B_LOW") {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  return candidates.reduce((best, item) => {
    if (!best || toNum(item?.price) < toNum(best?.price)) {
      return {
        ...item,
        source,
      };
    }

    return best;
  }, null);
}
