// /services/core/routes/ohlc.js
// OHLC endpoint with Polygon 1m backfill (+ server TF bucketing)
// GET /api/v1/ohlc?symbol=SPY&timeframe=1m|5m|10m|15m|30m|1h|4h|1d&limit=1500

import express from "express";

export const ohlcRouter = express.Router();

/* ----------------------- constants ----------------------- */
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

// ENV: Polygon key (any of these)
const POLY_KEY =
  process.env.POLYGON_API ||
  process.env.POLYGON_API_KEY ||
  process.env.POLY_API_KEY ||
  "";

// Dynamic backfill targets (days) per TF
// (your request: 1m=30, 10m=120, 1h=180, 4h=180, 1d=365; sensible values for the others)
const DAYS_BY_TF = {
  "1m": 30,
  "5m": 90,
  "10m": 120,
  "15m": 150,
  "30m": 180,
  "1h": 180,
  "4h": 180,
  "1d": 365,
};

// We always pull **1-minute** from Polygon then bucketize.
// Keep 1m under ~50k bars/request (Polygon cap).
const MIN_PER_DAY = 390;        // RTH minutes (approx)
const MAX_MIN_BARS = 50000;     // Polygon cap

/* ----------------------- time helpers ----------------------- */
const isMs = (t) => typeof t === "number" && t > 1e12;
const toSec = (t) => (isMs(t) ? Math.floor(t / 1000) : t);

function yyyyMmDd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgoUTC(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/* ---------------- Polygon normalize & fetch ---------------- */
function norm(b) {
  return {
    time: toSec(b.t ?? b.timestamp ?? b.time ?? 0),
    open: Number(b.o ?? b.open),
    high: Number(b.h ?? b.high),
    low: Number(b.l ?? b.low),
    close: Number(b.c ?? b.close),
    volume: Number(b.v ?? b.volume ?? 0),
  };
}

// Pull ~N minutes via Polygon date-range endpoint with pagination.
async function fetchPolygon1mRange(symbol, fromISO, toISO, maxBars = MAX_MIN_BARS, adjusted = true) {
  if (!POLY_KEY) throw new Error("Missing Polygon API key");

  let url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/1/minute/${fromISO}/${toISO}?adjusted=${adjusted ? "true" : "false"}` +
    `&sort=asc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const out = [];
  let hops = 0;

  while (url && out.length < maxBars) {
    if (++hops > 60) break; // safety guard
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Polygon ${r.status} ${text}`);
    }
    const data = await r.json();
    const arr = Array.isArray(data?.results) ? data.results : [];
    for (const b of arr) {
      const nb = norm(b);
      if (
        Number.isFinite(nb.time) &&
        Number.isFinite(nb.open) &&
        Number.isFinite(nb.high) &&
        Number.isFinite(nb.low) &&
        Number.isFinite(nb.close)
      ) {
        out.push(nb);
        if (out.length >= maxBars) break;
      }
    }
    url = data?.next_url ? `${data.next_url}&apiKey=${encodeURIComponent(POLY_KEY)}` : null;
  }

  // ascending & de-dup by time
  out.sort((a, b) => a.time - b.time);
  const dedup = [];
  let lastT = -1;
  for (const b of out) {
    if (b.time !== lastT) {
      dedup.push(b);
      lastT = b.time;
    }
  }
  return dedup;
}

/* ---------------- server-side TF bucketing from 1m ---------------- */
function bucketize(bars1mAsc, tfSec) {
  if (!Array.isArray(bars1mAsc) || !bars1mAsc.length || tfSec === 60) return bars1mAsc || [];
  const out = [];
  let curStart = null;
  let cur = null;

  for (const b of bars1mAsc) {
    const t = Number(b.time);
    if (!Number.isFinite(t)) continue;
    const start = Math.floor(t / tfSec) * tfSec;

    if (curStart === null || start > curStart) {
      if (cur) out.push(cur);
      curStart = start;
      cur = {
        time: start,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: Number(b.volume || 0),
      };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = Number(cur.volume || 0) + Number(b.volume || 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------------- route ---------------- */
ohlcRouter.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfStr = String(req.query.timeframe || "10m").toLowerCase();
    const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1500)));
    const tfSec = TF_SEC[tfStr] || TF_SEC["10m"];

    // ---- dynamic backfill window by TF ----
    // Target days for the request
    let targetDays = DAYS_BY_TF[tfStr] ?? 120;

    // Cap so our 1m pull stays under Polygon's ~50k limit
    const capDays = Math.max(7, Math.floor(MAX_MIN_BARS / MIN_PER_DAY) - 1); // ≈128 days
    targetDays = Math.min(targetDays, capDays);

    const toISO = yyyyMmDd(new Date());
    const fromISO = yyyyMmDd(daysAgoUTC(targetDays));

    // 1) Pull raw **1-minute** window (paginated)
    const minutes = await fetchPolygon1mRange(symbol, fromISO, toISO, MAX_MIN_BARS, true);

    // 2) Bucket to selected TF (server-side). 1m -> TF; 1m stays 1m
    const bars = tfSec === 60 ? minutes : bucketize(minutes, tfSec);

    // 3) Trim to 'limit' most recent (keep ascending)
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
