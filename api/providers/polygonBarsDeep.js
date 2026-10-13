// src/api/providers/polygonBarsDeep.js
// Polygon OHLC fetcher — DEEP HISTORY (SMZ JOBS ONLY)
//
// ✅ FIX (LOCKED):
// Polygon intraday aggregates effectively cap each request to ~90 days of data.
// So for deep history we must request in CHUNKS (e.g., 85 days each) and stitch.
// Chart provider remains untouched.
//
// Behavior:
// - Uses sort=asc
// - Splits [startMs..endMs] into 85-day windows
// - Fetches each window, merges, dedupes, returns ascending

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

// ✅ Safe chunk size under the ~90-day cap
const CHUNK_DAYS = 85;

// Safety stop
const MAX_CHUNKS = 20;

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

function dedupeByT(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r?.t)) continue;
    map.set(r.t, r);
  }
  return Array.from(map.values());
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

  const chunkMs = CHUNK_DAYS * 24 * 60 * 60 * 1000;

  let cursor = startMs;
  let chunk = 0;

  const collected = [];

  while (cursor < endMs && chunk < MAX_CHUNKS) {
    chunk++;

    const chunkStart = cursor;
    const chunkEnd = Math.min(endMs, chunkStart + chunkMs);

    const url = buildUrl(symbol, mult, unit, chunkStart, chunkEnd);

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Polygon ${r.status}: ${txt.slice(0, 220)}`);
    }

    const j = await r.json();
    const rows = Array.isArray(j?.results) ? j.results : [];

    console.log("[POLY-DEEP-CHUNK]", {
      symbol,
      timeframe,
      days,
      mode,
      chunk,
      chunkStart: new Date(chunkStart).toISOString(),
      chunkEnd: new Date(chunkEnd).toISOString(),
      resultsCount: j?.resultsCount ?? null,
      count: j?.count ?? null,
      queryCount: j?.queryCount ?? null,
      returned: rows.length,
    });

    const normalized = rows
      .map((x) => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }))
      .filter((x) => Number.isFinite(x.t));

    collected.push(...normalized);

    // move forward; +1ms prevents overlap
    cursor = chunkEnd + 1;
  }

  const deduped = dedupeByT(collected);
  deduped.sort((a, b) => a.t - b.t);

  return deduped;
}
