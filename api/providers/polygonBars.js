// src/api/providers/polygonBars.js
// Polygon OHLC fetcher — HARD FIX for incomplete current-day bars
// Forces end date = last fully closed trading day (prevents missing 4H data)

import fetch from "node-fetch";

const POLY_KEY = process.env.POLYGON_API_KEY;

if (!POLY_KEY) {
  throw new Error("POLYGON_API_KEY missing");
}

const TF_MAP = {
  "1m":  { mult: 1, unit: "minute" },
  "5m":  { mult: 5, unit: "minute" },
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },
  "1h":  { mult: 1, unit: "hour" },
  "4h":  { mult: 4, unit: "hour" },
  "1d":  { mult: 1, unit: "day" },
};

// 🔒 Always end on last fully completed day
function lastClosedDayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1); // yesterday
  return d;
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

export async function getBarsFromPolygon(symbol, timeframe, daysBack = 60) {
  const tf = TF_MAP[timeframe];
  if (!tf) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const end = lastClosedDayUTC();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - daysBack);

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/${tf.mult}/${tf.unit}/${fmt(start)}/${fmt(end)}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${POLY_KEY}`;

  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Polygon ${r.status}: ${t.slice(0, 200)}`);
  }

  const j = await r.json();
  const rows = Array.isArray(j?.results) ? j.results : [];

  return rows.map(b => ({
    time: b.t,   // ms (engine normalizes)
    open: b.o,
    high: b.h,
    low:  b.l,
    close: b.c,
    volume: b.v,
  }));
}
