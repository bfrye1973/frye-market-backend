// api/providers/polygonBars.js
// Minimal Polygon OHLC fetcher (Aggregates v2)

import fetch from "node-fetch";

const POLY_KEY = process.env.POLYGON_API_KEY;

const TF_MAP = {
  "1m":  { mult: 1,  unit: "minute" },
  "5m":  { mult: 5,  unit: "minute" },
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },   // add 30m just in case
  "1h":  { mult: 1,  unit: "hour" },
  "4h":  { mult: 4,  unit: "hour" },
  "1d":  { mult: 1,  unit: "day" },
};

const DEFAULT_DAYS = 60; // default backfill window

export async function getBarsFromPolygon(symbol, timeframe, daysOverride) {
  if (!POLY_KEY) throw new Error("POLYGON_API_KEY is missing");

  const tf = TF_MAP[timeframe];
  if (!tf) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const days = Number.isFinite(daysOverride) && daysOverride > 0
    ? daysOverride
    : DEFAULT_DAYS;

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
    symbol
  )}/range/${tf.mult}/${tf.unit}/${fmt(start)}/${fmt(end)}?adjusted=true&sort=asc&limit=50000&apiKey=${POLY_KEY}`;

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Polygon ${r.status}: ${txt.slice(0, 180)}`);
  }
  const j = await r.json();
  const rows = Array.isArray(j?.results) ? j.results : [];

  // Return in a generic raw format; normalizer will map/clean
  return rows.map((x) => ({
    t: x.t, // ms timestamp from Polygon
    o: x.o,
    h: x.h,
    l: x.l,
    c: x.c,
    v: x.v,
  }));
}
