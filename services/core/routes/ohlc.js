// /services/core/routes/ohlc.js
// OHLC endpoint using Polygon AGGs v2 with MS-range (no YYYY-MM-DD)
// GET /api/v1/ohlc?symbol=SPY&timeframe=1m|5m|10m|15m|30m|1h|4h|1d&limit=1500
//
// Key change vs old version:
// - Fetches the requested timeframe DIRECTLY from Polygon
// - No "always fetch 1m then bucketize" (which can cap you when 1m is delayed/flaky)

import express from "express";

export const ohlcRouter = express.Router();

/* ---------------- constants ---------------- */
const POLY_KEY =
  process.env.POLYGON_API ||
  process.env.POLYGON_API_KEY ||
  process.env.POLY_API_KEY ||
  "";

// Map dashboard TF -> Polygon multiplier/unit
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

// Default lookback days per TF (keep under control; can be tuned)
const DAYS_BY_TF = {
  "1m": 10,
  "5m": 20,
  "10m": 45,
  "15m": 60,
  "30m": 90,
  "1h": 180,
  "4h": 365,
  "1d": 365 * 5,
};

function clampInt(n, lo, hi, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

// Polygon returns `t` in ms
function normAgg(b) {
  const unixMs = b?.t;
  if (!Number.isFinite(unixMs) || unixMs <= 0) return null;

  const o = Number(b.o);
  const h = Number(b.h);
  const l = Number(b.l);
  const c = Number(b.c);
  const v = Number(b.v ?? 0);

  if (![o, h, l, c].every(Number.isFinite)) return null;

  return {
    time: Math.floor(unixMs / 1000), // seconds for chart
    open: o,
    high: h,
    low: l,
    close: c,
    volume: Number.isFinite(v) ? v : 0,
  };
}

/**
 * Fetch Polygon aggregates using MS start/end.
 * Uses pagination via next_url when returned.
 */
async function fetchPolygonAggsMs({ symbol, mult, unit, startMs, endMs, adjusted = true }) {
  if (!POLY_KEY) throw new Error("Missing Polygon API key");

  let url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/${mult}/${unit}/${startMs}/${endMs}` +
    `?adjusted=${adjusted ? "true" : "false"}` +
    `&sort=asc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const out = [];
  let hops = 0;

  while (url) {
    if (++hops > 60) break;

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Polygon ${r.status} ${txt}`);
    }

    const data = await r.json();
    const arr = Array.isArray(data?.results) ? data.results : [];

    for (const b of arr) {
      const nb = normAgg(b);
      if (nb) out.push(nb);
    }

    url = data?.next_url
      ? `${data.next_url}&apiKey=${encodeURIComponent(POLY_KEY)}`
      : null;
  }

  // Already sorted asc by request, but keep safe:
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

/* -------------------- route -------------------- */
ohlcRouter.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfStrRaw = String(req.query.timeframe || "10m").toLowerCase();
    const tf = TF_MAP[tfStrRaw] ? tfStrRaw : "10m";

    const limit = clampInt(req.query.limit, 1, 50000, 1500);

    // Window
    const targetDays = DAYS_BY_TF[tf] ?? 45;
    const endMs = Date.now();
    const startMs = endMs - targetDays * 24 * 60 * 60 * 1000;

    const { mult, unit } = TF_MAP[tf];

    const bars = await fetchPolygonAggsMs({
      symbol,
      mult,
      unit,
      startMs,
      endMs,
      adjusted: true,
    });

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
