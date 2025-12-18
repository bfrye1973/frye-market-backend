// src/api/providers/polygonBars.js
// Polygon OHLC fetcher (Aggregates v2)
// Fixes:
// 1) Defensive trim on TF unit (prevents "minute " -> minute%20 -> empty bars)
// 2) Adds opts.mode: "intraday" | "closedDay" (default intraday)
// 3) Uses ms timestamps for from/to to avoid date-boundary truncation

import fetch from "node-fetch";

const POLY_KEY = process.env.POLYGON_API_KEY;

const TF_MAP = {
  "1m":  { mult: 1,  unit: "minute" },
  "5m":  { mult: 5,  unit: "minute" },
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },
  "1h":  { mult: 1,  unit: "hour" },
  "4h":  { mult: 4,  unit: "hour" },
  "1d":  { mult: 1,  unit: "day" },
};

const DEFAULT_DAYS = 60;

// End of yesterday UTC (last fully closed day)
function endOfYesterdayUtcMs() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

// Backwards compatible signature:
// getBarsFromPolygon(symbol, timeframe, daysOverride)
// getBarsFromPolygon(symbol, timeframe, daysOverride, { mode })
// ALSO supports: getBarsFromPolygon(symbol, timeframe, { mode })  (days default)
export async function getBarsFromPolygon(symbol, timeframe, daysOverride, opts) {
  if (!POLY_KEY) throw new Error("POLYGON_API_KEY is missing");

  // Allow 3rd arg to be opts object
  let days = DEFAULT_DAYS;
  let options = opts && typeof opts === "object" ? opts : {};

  if (daysOverride && typeof daysOverride === "object" && !Array.isArray(daysOverride)) {
    options = daysOverride;
  } else if (Number.isFinite(daysOverride) && daysOverride > 0) {
    days = daysOverride;
  }

  const mode = (options?.mode || "intraday").toLowerCase();
  if (mode !== "intraday" && mode !== "closedday") {
    throw new Error(`Invalid mode: ${options?.mode}. Use "intraday" or "closedDay".`);
  }

  const tfRaw = TF_MAP[timeframe];
  if (!tfRaw) throw new Error(`Unsupported timeframe: ${timeframe}`);

  // Defensive fix: prevent accidental "minute " / "hour " etc.
  const tf = {
    mult: tfRaw.mult,
    unit: String(tfRaw.unit || "").trim(),
  };

  if (!tf.unit) throw new Error(`Invalid TF unit for ${timeframe}`);

  const endMs = mode === "closedday" ? endOfYesterdayUtcMs() : Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/${tf.mult}/${encodeURIComponent(tf.unit)}/${startMs}/${endMs}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Polygon ${r.status}: ${txt.slice(0, 180)}`);
  }

  const j = await r.json();
  const rows = Array.isArray(j?.results) ? j.results : [];

  // Return raw-ish format (normalizer elsewhere can map)
  return rows.map((x) => ({
    t: x.t, // ms timestamp
    o: x.o,
    h: x.h,
    l: x.l,
    c: x.c,
    v: x.v,
  }));
}
