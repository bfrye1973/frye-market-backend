// src/api/providers/polygonBars.js
// Polygon OHLC fetcher (Aggregates v2) — SINGLE SOURCE OF TRUTH
//
// HARD FIX (kept):
// - Always request newest bars first (sort=desc) so we never get stale windows.
// - Then reverse to ascending in code.
// This prevents the “15m is months old” problem that broke shelves.
//
// Supports:
// getBarsFromPolygon(sym, tf)
// getBarsFromPolygon(sym, tf, days)
// getBarsFromPolygon(sym, tf, days, { mode })
// getBarsFromPolygon(sym, tf, { mode })            (days default)
// getBarsFromPolygon(sym, tf, { days, mode })
//
// mode:
// - "intraday" (default) -> ends at Date.now()
// - "closedDay" -> ends at end of yesterday UTC

import fetch from "node-fetch";

const POLY_KEY = process.env.POLYGON_API_KEY;
if (!POLY_KEY) throw new Error("POLYGON_API_KEY is missing");

const TF_MAP = {
  "1m": { mult: 1, unit: "minute" },
  "5m": { mult: 5, unit: "minute" },
  "10m": { mult: 10, unit: "minute" },
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },
  "1h": { mult: 1, unit: "hour" },
  "4h": { mult: 4, unit: "hour" },
  "1d": { mult: 1, unit: "day" },
};

// Default lookback (used only if caller does not pass days)
const DEFAULT_DAYS = 180;

function endOfYesterdayUtcMs() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

// Supports:
// getBarsFromPolygon(sym, tf)
// getBarsFromPolygon(sym, tf, days)
// getBarsFromPolygon(sym, tf, days, { mode })
// getBarsFromPolygon(sym, tf, { mode })
// getBarsFromPolygon(sym, tf, { days, mode })
export async function getBarsFromPolygon(symbol, timeframe, daysOverride, opts) {
  let days = DEFAULT_DAYS;
  let options = opts && typeof opts === "object" ? opts : {};

  if (daysOverride && typeof daysOverride === "object" && !Array.isArray(daysOverride)) {
    options = daysOverride;
    const d = Number(options?.days);
    if (Number.isFinite(d) && d > 0) days = Math.floor(d);
  } else if (Number.isFinite(daysOverride) && daysOverride > 0) {
    days = Math.floor(daysOverride);
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

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/${mult}/${encodeURIComponent(unit)}/${startMs}/${endMs}` +
    `?adjusted=true&sort=desc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Polygon ${r.status}: ${txt.slice(0, 220)}`);
  }

  const j = await r.json();
  const rowsDesc = Array.isArray(j?.results) ? j.results : [];

  const rowsAsc = rowsDesc
    .map((x) => ({
      t: x.t,
      o: x.o,
      h: x.h,
      l: x.l,
      c: x.c,
      v: x.v,
    }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  return rowsAsc;
}
