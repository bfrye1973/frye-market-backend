// /services/core/routes/ohlc.js
// OHLC endpoint with Polygon 1m backfill (+ server TF bucketing)
//
// ✅ FIX: Use millisecond (ms) range for Polygon calls instead of YYYY-MM-DD
// This prevents date-boundary truncation that makes candles appear "stuck".
// GET /api/v1/ohlc?symbol=SPY&timeframe=1m|5m|10m|15m|30m|1h|4h|1d&limit=1500

import express from "express";

export const ohlcRouter = express.Router();

/* ---------------- constants ---------------- */
const MIN = 60;
const TF_SEC = {
  "1m": 60,
  "5m": 5 * MIN,
  "10m": 10 * MIN,
  "15m": 15 * MIN,
  "30m": 30 * MIN,
  "1h": 60 * MIN,
  "4h": 4 * 60 * MIN,
  "1d": 24 * 60 * MIN,
};

const POLY_KEY =
  process.env.POLYGON_API ||
  process.env.POLYGON_API_KEY ||
  process.env.POLY_API_KEY ||
  "";

// Dynamic backfill targets (days)
const DAYS_BY_TF = {
  "1m": 60,
  "5m": 60,
  "10m": 120,
  "15m": 150,
  "30m": 180,
  "1h": 180,
  "4h": 180,
  "1d": 365,
};

// Always fetch 1-minute then bucketize
const MIN_PER_DAY = 390; // RTH minutes/day
const MAX_MIN_BARS = 50000; // Polygon cap (~128 RTH days)

/* -------------- normalize & fetch -------------- */
function norm(b) {
  const unixMs = b?.t; // Polygon ALWAYS provides 't' = milliseconds UTC
  if (!Number.isFinite(unixMs) || unixMs <= 0) return null;

  return {
    time: Math.floor(unixMs / 1000), // seconds for chart
    open: Number(b.o),
    high: Number(b.h),
    low: Number(b.l),
    close: Number(b.c),
    volume: Number(b.v ?? 0),
  };
}

// ✅ MS-range fetcher: /range/1/minute/{startMs}/{endMs}
async function fetchPolygon1mRangeMs(
  symbol,
  startMs,
  endMs,
  maxBars = MAX_MIN_BARS,
  adjusted = true
) {
  if (!POLY_KEY) throw new Error("Missing Polygon API key");

  let url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/1/minute/${startMs}/${endMs}?adjusted=${adjusted ? "true" : "false"}` +
    `&sort=asc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const out = [];
  let hops = 0;

  while (url && out.length < maxBars) {
    if (++hops > 60) break;

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Polygon ${r.status} ${txt}`);
    }

    const data = await r.json();
    const arr = Array.isArray(data?.results) ? data.results : [];

    for (const b of arr) {
      const nb = norm(b);
      if (!nb) continue;
      if ([nb.time, nb.open, nb.high, nb.low, nb.close].every(Number.isFinite)) {
        out.push(nb);
        if (out.length >= maxBars) break;
      }
    }

    url = data?.next_url
      ? `${data.next_url}&apiKey=${encodeURIComponent(POLY_KEY)}`
      : null;
  }

  out.sort((a, b) => a.time - b.time);

  // de-dup by bar time (seconds)
  const dedup = [];
  let last = -1;
  for (const b of out) {
    if (b.time !== last) {
      dedup.push(b);
      last = b.time;
    }
  }
  return dedup;
}

/* -------------- 1m → TF bucketing -------------- */
function bucketize(bars1mAsc, tfSec) {
  if (!Array.isArray(bars1mAsc) || !bars1mAsc.length || tfSec === 60) return bars1mAsc || [];

  const out = [];
  let start = null;
  let cur = null;

  for (const b of bars1mAsc) {
    const t = b.time | 0;
    const s = Math.floor(t / tfSec) * tfSec;

    if (start === null || s > start) {
      if (cur) out.push(cur);
      start = s;
      cur = {
        time: s,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = (cur.volume || 0) + (b.volume || 0);
    }
  }

  if (cur) out.push(cur);
  return out;
}

/* -------------------- route -------------------- */
ohlcRouter.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfStr = String(req.query.timeframe || "10m").toLowerCase();
    const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1500)));
    const tfSec = TF_SEC[tfStr] || TF_SEC["10m"];

    // Dynamic window (cap to Polygon’s 50k 1m limit)
    let targetDays = DAYS_BY_TF[tfStr] ?? 120;
    const capDays = Math.max(7, Math.floor(MAX_MIN_BARS / MIN_PER_DAY) - 1); // ~128
    targetDays = Math.min(targetDays, capDays);

    // ✅ MS window (prevents "stuck on yesterday")
    const endMs = Date.now();
    const startMs = endMs - targetDays * 24 * 60 * 60 * 1000;

    // 1) Get 1m minutes from Polygon (ms range)
    const minutes = await fetchPolygon1mRangeMs(symbol, startMs, endMs, MAX_MIN_BARS, true);

    // 2) Bucket if needed
    const bars = tfSec === 60 ? minutes : bucketize(minutes, tfSec);

    // 3) Trim most-recent 'limit' (keep ascending)
    const trimmed = bars.length > limit ? bars.slice(-limit) : bars;

    res.setHeader("Cache-Control", "no-store");
    return res.json(trimmed);
  } catch (e) {
    console.error("[/api/v1/ohlc] error:", e?.stack || e);
    return res.status(502).json({
      ok: false,
      error: "upstream_error",
      detail: String(e?.message || e),
    });
  }
});

export default ohlcRouter;
