// src/api/providers/polygonBars.js
// Polygon OHLC fetcher — HARD FIX for incomplete recent bars
// ✅ Forces end date = END of last fully closed day (UTC 23:59:59.999)
// ✅ Avoids “worked yesterday / capped today” truncation issues

import fetch from "node-fetch";

const POLY_KEY = process.env.POLYGON_API_KEY;
if (!POLY_KEY) throw new Error("POLYGON_API_KEY missing");

const TF_MAP = {
  "1m": { mult: 1, unit: "minute" },
  "5m": { mult: 5, unit: "minute" },
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },
  "1h": { mult: 1, unit: "hour" },
  "4h": { mult: 4, unit: "hour" },
  "1d": { mult: 1, unit: "day" },
};

// 🔒 Always end on the last fully completed day (END of day UTC)
// This ensures Polygon returns a complete last session, and prevents “missing month” behavior.
function lastClosedDayEndUTC() {
  const d = new Date();
  // End-of-day yesterday UTC
  d.setUTCHours(23, 59, 59, 999);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function fmtYYYYMMDD(d) {
  return d.toISOString().slice(0, 10);
}

export async function getBarsFromPolygon(symbol, timeframe, daysBack = 60) {
  const tf = TF_MAP[timeframe];
  if (!tf) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const end = lastClosedDayEndUTC();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Number(daysBack || 60));

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/${tf.mult}/${tf.unit}/${fmtYYYYMMDD(start)}/${fmtYYYYMMDD(end)}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Polygon ${r.status}: ${t.slice(0, 200)}`);
  }

  const j = await r.json();
  const rows = Array.isArray(j?.results) ? j.results : [];

  // Return normalized-ish (time stays in ms; engine normalizes to sec)
  return rows.map((b) => ({
    time: Number(b.t), // ms
    open: Number(b.o),
    high: Number(b.h),
    low: Number(b.l),
    close: Number(b.c),
    volume: Number(b.v),
  }));
}
