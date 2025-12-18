// src/api/providers/polygonBars.js
// Polygon OHLC fetcher (Aggregates v2)
//
// Fixes / Guarantees:
// 1) Defensive trim on TF unit (prevents "minute " -> minute%20 -> empty bars)
// 2) Supports opts.mode: "intraday" | "closedDay" (default: intraday)
//    - intraday  => end = now (includes today's session)
//    - closedDay => end = end of yesterday UTC (SMZ stability)
// 3) Uses millisecond timestamps for from/to to avoid date-boundary truncation
// 4) Includes 10m timeframe (required by dashboard systems)
// 5) Warns loudly if Polygon returns empty bars

const POLY_KEY = process.env.POLYGON_API_KEY;

// Timeframe map used by Polygon "range/{mult}/{timespan}/..."
const TF_MAP = {
  "1m":  { mult: 1,  unit: "minute" },
  "5m":  { mult: 5,  unit: "minute" },
  "10m": { mult: 10, unit: "minute" },  // IMPORTANT
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },
  "1h":  { mult: 1,  unit: "hour" },
  "4h":  { mult: 4,  unit: "hour" },
  "1d":  { mult: 1,  unit: "day" },
};

const DEFAULT_DAYS = 60;

// End of yesterday (UTC) in milliseconds
function endOfYesterdayUtcMs() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

// Backward compatible signature supports:
//   getBarsFromPolygon(symbol, timeframe, daysOverride)
//   getBarsFromPolygon(symbol, timeframe, daysOverride, { mode })
//   getBarsFromPolygon(symbol, timeframe, { mode })  // days default
export async function getBarsFromPolygon(symbol, timeframe, daysOverride, opts) {
  if (!POLY_KEY) throw new Error("POLYGON_API_KEY is missing");

  // Node 18+ has fetch built-in. If missing, fail loudly.
  if (typeof fetch !== "function") {
    throw new Error("Global fetch() is missing. Run on Node 18+ or install a fetch polyfill.");
  }

  // Normalize args
  let days = DEFAULT_DAYS;
  let options = (opts && typeof opts === "object") ? opts : {};

  // Allow 3rd arg to be options object
  if (daysOverride && typeof daysOverride === "object" && !Array.isArray(daysOverride)) {
    options = daysOverride;
  } else if (Number.isFinite(daysOverride) && daysOverride > 0) {
    days = daysOverride;
  }

  const modeRaw = String(options?.mode || "intraday").toLowerCase();
  if (modeRaw !== "intraday" && modeRaw !== "closedday") {
    throw new Error(`Invalid mode: ${options?.mode}. Use "intraday" or "closedDay".`);
  }

  const tfRaw = TF_MAP[timeframe];
  if (!tfRaw) throw new Error(`Unsupported timeframe: ${timeframe}`);

  // Defensive trim (protects against accidental "minute " etc.)
  const tf = {
    mult: tfRaw.mult,
    unit: String(tfRaw.unit || "").trim(),
  };
  if (!tf.unit) throw new Error(`Invalid TF unit for ${timeframe}`);

  // Compute time window
  const endMs = (modeRaw === "closedday") ? endOfYesterdayUtcMs() : Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/${tf.mult}/${encodeURIComponent(tf.unit)}/${startMs}/${endMs}` +
    `?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const r = await fetch(url, { cache: "no-store" });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Polygon ${r.status}: ${txt.slice(0, 180)}`);
  }

  const j = await r.json();
  const rows = Array.isArray(j?.results) ? j.results : [];

  // Guardrail: warn if empty bars (prevents silent poison debugging)
  if (!rows.length) {
    console.warn("[PolygonBars] EMPTY results", {
      symbol,
      timeframe,
      mode: modeRaw,
      startMs,
      endMs,
    });
  }

  // Return raw-ish normalized objects (ms timestamps)
  return rows.map((x) => ({
    t: x.t, // ms
    o: x.o,
    h: x.h,
    l: x.l,
    c: x.c,
    v: x.v,
  }));
}
