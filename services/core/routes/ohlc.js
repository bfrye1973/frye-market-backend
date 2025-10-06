// /routes/ohlc.js — OHLC endpoint with Polygon 1m backfill (+ server TF bucketing)
// GET /api/v1/ohlc?symbol=SPY&timeframe=1m|5m|10m|15m|30m|1h|4h|1d&limit=1500

import express from "express";

export const ohlcRouter = express.Router();

/* ----------------------- helpers ----------------------- */
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

// epoch ms? -> seconds
const isMs = (t) => typeof t === "number" && t > 1e12;
const toSec = (t) => (isMs(t) ? Math.floor(t / 1000) : t);

// YYYY-MM-DD (UTC)
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

// normalize Polygon aggregate -> bar in seconds
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

/* ---------------- Polygon pulls (date-range + pagination) ---------------- */
async function fetchPolygon1mRange(symbol, fromISO, toISO, maxBars = 50000, adjusted = true) {
  if (!POLY_KEY) throw new Error("Missing Polygon API key");

  let url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
    `/range/1/minute/${fromISO}/${toISO}?adjusted=${adjusted ? "true" : "false"}` +
    `&sort=asc&limit=50000&apiKey=${encodeURIComponent(POLY_KEY)}`;

  const out = [];
  let hops = 0;

  while (url && out.length < maxBars) {
    if (++hops > 60) break; // safety
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

  // ensure ascending & de-dup
  out.sort((a, b) => a.time - b.time);
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
    const tfStr = String(req.query.timeframe || "1h").toLowerCase();
    const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1500)));
    const tfSec = TF_SEC[tfStr] || TF_SEC["10m"];

    // time window: default last 30 days for 1m; enough coverage for higher TF too
    const toISO = yyyyMmDd(new Date());
    const fromISO = yyyyMmDd(daysAgoUTC(30));

    // 1) pull raw 1m minutes for the window (paginated)
    const minutes = await fetchPolygon1mRange(symbol, fromISO, toISO, 50000, true);

    // 2) bucket if needed
    const bars = tfSec === 60 ? minutes : bucketize(minutes, tfSec);

    // 3) trim to 'limit' most recent (but keep ascending order)
    const trimmed = bars.length > limit ? bars.slice(-limit) : bars;

    res.setHeader("Cache-Control", "no-store");
    return res.json(trimmed);
  } catch (e) {
    console.error("[/api/v1/ohlc] error:", e?.stack || e);
    return res.status(502).json({ ok: false, error: "upstream_error", detail: String(e?.message || e) });
  }
});
