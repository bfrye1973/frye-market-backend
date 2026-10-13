// services/core/logic/marketLayers/buildTenMinuteLayer.js

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function calculateEMA(values, length) {
  if (!Array.isArray(values) || values.length < length) return null;

  const k = 2 / (length + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return round2(ema);
}

function normalizeBars(payload) {
  const list =
    Array.isArray(payload) ? payload :
    Array.isArray(payload?.bars) ? payload.bars :
    Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.results) ? payload.results :
    [];

  return list
    .map((b) => {
      const rawTime = toNum(b?.time ?? b?.t);

      return {
        time: rawTime,
        open: toNum(b?.open ?? b?.o),
        high: toNum(b?.high ?? b?.h),
        low: toNum(b?.low ?? b?.l),
        close: toNum(b?.close ?? b?.c),
        volume: toNum(b?.volume ?? b?.v ?? 0),
      };
    })
    .filter(
      (b) =>
        Number.isFinite(b.time) &&
        [b.open, b.high, b.low, b.close].every(Number.isFinite)
    )
    .sort((a, b) => a.time - b.time);
}

function distance(close, ema) {
  const c = toNum(close);
  const e = toNum(ema);

  if (c === null || e === null) return null;

  return round2(c - e);
}

function distancePct(close, ema) {
  const c = toNum(close);
  const e = toNum(ema);

  if (c === null || e === null || e === 0) return null;

  return round2(((c - e) / e) * 100);
}

function classifyTenMinuteState({ close, ema10, ema20 }) {
  const c = toNum(close);
  const e10 = toNum(ema10);
  const e20 = toNum(ema20);

  if (c === null || e10 === null || e20 === null) return "UNKNOWN";

  if (c > e10 && c > e20) return "ABOVE_EMA10_20";
  if (c <= e10 && c > e20) return "PULLBACK_TEST_EMA10";
  if (c < e20) return "BELOW_EMA20";

  return "UNKNOWN";
}

export async function buildTenMinuteLayer({
  symbol = "SPY",
  coreBase = "http://127.0.0.1:10000",
  limit = 120,
  fetchJson,
} = {}) {
  if (typeof fetchJson !== "function") {
    throw new Error("buildTenMinuteLayer requires fetchJson");
  }

  const url =
    `${coreBase}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=10m&limit=${encodeURIComponent(String(limit))}`;

  const resp = await fetchJson(url, 15000);
  const payload = resp?.json ?? null;

  const bars = normalizeBars(payload);
  const closes = bars.map((b) => b.close).filter(Number.isFinite);

  const latestBar = bars[bars.length - 1] || null;
  const close = latestBar?.close ?? null;

  const ema10 = calculateEMA(closes, 10);
  const ema20 = calculateEMA(closes, 20);

  return {
    label: "10m Trigger Layer",
    close: round2(close),
    ema10: round2(ema10),
    ema20: round2(ema20),
    distanceToEma10: distance(close, ema10),
    distanceToEma10Pct: distancePct(close, ema10),
    distanceToEma20: distance(close, ema20),
    distanceToEma20Pct: distancePct(close, ema20),
    state: classifyTenMinuteState({ close, ema10, ema20 }),
    lastBarTime: latestBar?.time ?? null,
    barCount: bars.length,
    source: "/api/v1/ohlc",
  };
}

export default buildTenMinuteLayer;
