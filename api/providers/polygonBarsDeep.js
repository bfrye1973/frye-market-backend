// src/api/providers/polygonBarsDeep.js
// Polygon OHLC fetcher (Aggregates v2) — DEEP HISTORY (SMZ JOBS ONLY)
//
// ✅ FIX (LOCKED):
// - Use sort=asc for deep history so Polygon returns the full requested window.
//   (Your browser test proved asc returns the full year; desc was collapsing to ~86 days.)
// - No pagination needed for our target windows.
// - Chart provider (polygonBars.js) stays untouched and fast (sort=desc).
//
// Supports:
// getBarsFromPolygonDeep(sym, tf)
// getBarsFromPolygonDeep(sym, tf, days)
// getBarsFromPolygonDeep(sym, tf, days, { mode })
// getBarsFromPolygonDeep(sym, tf, { mode }) (days default)
//
// mode:
// - "intraday" (default) -> ends at Date.now()
// - "closedDay" -> ends at end of yesterday UTC

import fetch from "node-fetch";

const POLY_KEY = process.env.POLYGON_API_KEY;
if (!POLY_KEY) throw new Error("POLYGON_API_KEY is missing");

const TF_MAP = {
  "1m":  { mult: 1,  unit: "minute" },
  "5m":  { mult: 5,  unit: "minute" },
  "10m": { mult: 10, unit: "minute" },
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },
  "1h":  { mult: 1,  unit: "hour" },
  "4h":  { mult: 4,  unit: "hour" },
  "1d":  { mult: 1,  unit: "day" },
};

const DEFAULT_DAYS = 180;
const LIMIT = 50000;

function endOfYesterdayUtcMs() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

function buildUrl(symbol, mult, unit, startMs, endMs) {
  return (
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/${mult}/${encodeURIComponent(unit)}/${startMs}/${endMs}` +
    `?adjusted=true&sort=asc&limit=${LIMIT}&apiKey=${encodeURIComponent(POLY_KEY)}`
  );
}

// Supports:
// getBarsFromPolygonDeep(sym, tf)
// getBarsFromPolygonDeep(sym, tf, days)
// getBarsFromPolygonDeep(sym, tf, days, { mode })
// getBarsFromPolygonDeep(sym, tf, { mode })
export async function getBarsFromPolygonDeep(symbol, timeframe, daysOverride, opts) {
  let days = DEFAULT_DAYS;
  let options = opts && typeof opts === "object" ? opts : {};

  if (daysOverride && typeof daysOverride === "object" && !Array.isArray(daysOverride)) {
    options = daysOverride;
  } else if (Number.isFinite(daysOverride) && daysOverride > 0) {
    days = daysOverride;
  }

  const mode = String(options?.mode || "intraday").toLowerCase();
  if (mode !== "intraday" && mode !== "closedday") {
    throw new Error(`Invalid mode: ${options?.mode}. Use "intraday" or "closedDay".`);
  }

  const tfRaw = TF_MAP[timeframe];
  if (!tfRaw) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const mult = tfRaw.mult;
  const unit = String(tfRaw.unit || "").trim();
  if (!unit) throw new Error(`Invalid TF unit for ${timeframe}`);

  const endMs = mode === "closedday" ? endOfYesterdayUtcMs() : Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  const url = buildUrl(symbol, mult, unit, startMs, endMs);

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Polygon ${r.status}: ${txt.slice(0, 220)}`);
  }

  const j = await r.json();

  // ✅ One-line diagnostic (deep provider only)
  console.log("[POLY-DEEP-ASC]", {
    symbol,
    timeframe,
    days,
    mode,
    resultsCount: j?.resultsCount ?? null,
    count: j?.count ?? null,
    queryCount: j?.queryCount ?? null,
    returned: Array.isArray(j?.results) ? j.results.length : 0,
  });

  const rowsAsc = (Array.isArray(j?.results) ? j.results : [])
    .map((x) => ({
      t: x.t, // ms
      o: x.o,
      h: x.h,
      l: x.l,
      c: x.c,
      v: x.v,
    }))
    .filter((x) => Number.isFinite(x.t))
    // already asc from Polygon, but sort for safety
    .sort((a, b) => a.t - b.t);

  return rowsAsc;
}
