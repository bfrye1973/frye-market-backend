// services/streamer/routes/stream.js
// ============================================================================
// Polygon WebSocket → In-memory cache → SSE stream + Snapshot seeding (RTH default)
//
// ✅ Default mode: RTH (TradingView-aligned)
//   - Session: 09:30–16:00 America/New_York
//   - Buckets are anchored to 09:30 ET (NOT UTC math)
//   - Display timezone (Phoenix) is handled by frontend; this file controls timestamps only.
//
// ✅ Supports future toggle: mode=rth|eth
//   - mode=rth (default): session-aligned, RTH-only
//   - mode=eth: includes extended hours (continuous buckets; no session filter)
//
// Endpoints:
//   GET /stream/snapshot?symbol=SPY&tf=10m&limit=1500&mode=rth|eth
//     - JSON snapshot of bars
//     - Uses cache if present
//     - If cache empty: pulls 1m history from backend-1, then REBUCKETS here (RTH/ETH)
//       so candles match TradingView even after close / restart.
//
//   GET /stream/agg?symbol=SPY&tf=10m&mode=rth|eth
//     - SSE stream (type:"snapshot" first, then type:"bar")
//     - Heartbeat ":ping <ts>" every 15s
//     - Output throttled to 1 bar/sec per (symbol, tf, mode)
//
// Horizons (your spec):
//   10m  → ~2 weeks
//   30m  → ~3 months
//   1h   → ~6 months
//   4h   → ~6 months
//   1d   → ~6 months
// ============================================================================

import express from "express";
import { WebSocket } from "ws";
import { DateTime } from "luxon";

const streamRouter = express.Router();
export default streamRouter;

/* ------------------------------- Config ---------------------------------- */

const POLY_WS_URL = "wss://socket.polygon.io/stocks";

// backend-1 (REST historical) base — used for snapshot fallback/backfill
const HIST_BASE =
  process.env.HIST_BASE ||
  process.env.BACKEND1_BASE ||
  "https://frye-market-backend-1.onrender.com";

// Symbols to keep hot (default SPY,QQQ)
const HOT_SYMBOLS = String(process.env.STREAM_SYMBOLS || "SPY,QQQ")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

// WS subscriptions: minute aggregates + trade ticks fallback
const SUBS = HOT_SYMBOLS.flatMap((s) => [`AM.${s}`, `T.${s}`]).join(",");

// Resolve Polygon API key
function resolvePolygonKey() {
  const keys = [
    process.env.POLYGON_API,
    process.env.POLYGON_API_KEY,
    process.env.POLY_API_KEY,
  ];
  return keys.find((k) => k && k.trim()) || "";
}

/* --------------------------- Timeframe helpers --------------------------- */

const TRADING_DAYS_PER_MONTH = 21;
const RTH_MIN_PER_DAY = 390;

function normalizeTf(tf = "10m") {
  const t = String(tf || "").toLowerCase().trim();
  if (t === "1d" || t === "d" || t === "day" || t === "daily") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function labelTf(tfMin) {
  return tfMin >= 1440 ? "1d" : tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;
}

function barsPerDay(tfMin) {
  if (tfMin >= 1440) return 1;
  return Math.max(1, Math.floor(RTH_MIN_PER_DAY / tfMin));
}

function maxBarsForTf(tfMin) {
  if (tfMin === 10) return 10 * barsPerDay(10); // ~2 weeks (10 trading days)
  if (tfMin === 30) return (3 * TRADING_DAYS_PER_MONTH) * barsPerDay(30); // ~3 months
  if (tfMin === 60) return (6 * TRADING_DAYS_PER_MONTH) * 7; // ~6 months
  if (tfMin === 240) return (6 * TRADING_DAYS_PER_MONTH) * 2; // ~6 months
  if (tfMin >= 1440) return 6 * TRADING_DAYS_PER_MONTH; // ~6 months
  return 500;
}

// We maintain these TFs in cache (your spec)
const TF_SET = [10, 30, 60, 240, 1440];

/* ----------------------------- Mode helpers ------------------------------ */

function normalizeMode(mode) {
  const m = String(mode || "rth").toLowerCase().trim();
  return m === "eth" ? "eth" : "rth";
}

/* ------------------------------ RTH bucketing ----------------------------- */

const NY_ZONE = "America/New_York";

function getNyDayAnchors(unixSec) {
  const ny = DateTime.fromSeconds(unixSec, { zone: NY_ZONE });
  const dayStart = ny.startOf("day");
  const open = dayStart.plus({ hours: 9, minutes: 30 });
  const close = dayStart.plus({ hours: 16, minutes: 0 });

  return {
    dayStartSec: Math.floor(dayStart.toSeconds()),
    openSec: Math.floor(open.toSeconds()),
    closeSec: Math.floor(close.toSeconds()),
  };
}

// RTH bucket: anchored to 09:30 ET, filtered to session only.
function bucketStartSecRth(unixSec, tfMin) {
  const { dayStartSec, openSec, closeSec } = getNyDayAnchors(unixSec);

  // Daily: bucket at NY midnight
  if (tfMin >= 1440) return dayStartSec;

  // Reject bars outside session
  if (unixSec < openSec || unixSec >= closeSec) return null;

  const size = tfMin * 60;
  const idx = Math.floor((unixSec - openSec) / size);
  const bucket = openSec + idx * size;

  if (bucket >= closeSec) return null;
  return bucket;
}

// ETH bucket: continuous UTC bucket (includes all sessions). (Simple, toggle later)
function bucketStartSecEth(unixSec, tfMin) {
  if (tfMin >= 1440) {
    // daily in NY time even for ETH; keeps day boundaries consistent
    const { dayStartSec } = getNyDayAnchors(unixSec);
    return dayStartSec;
  }
  const size = tfMin * 60;
  return Math.floor(unixSec / size) * size;
}

function bucketStartSecByMode(unixSec, tfMin, mode) {
  return mode === "eth"
    ? bucketStartSecEth(unixSec, tfMin)
    : bucketStartSecRth(unixSec, tfMin);
}

/* ------------------------------ SSE helpers ------------------------------ */

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

const sseSend = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/* --------------------------- Throttle (1 Hz) --------------------------- */

// lastEmit key: `${symbol}|${tfMin}|${mode}`
const lastEmit = new Map();

function canEmit(key, intervalMs = 1000) {
  const now = Date.now();
  const last = lastEmit.get(key) || 0;
  if (now - last >= intervalMs) {
    lastEmit.set(key, now);
    return true;
  }
  return false;
}

/* -------------------------- Polygon event parsers ------------------------- */

// AM payload: { ev:"AM", sym:"SPY", s:<startMs>, o,h,l,c, v }
function parseAM(msg) {
  const symbol = String(msg?.sym || "").toUpperCase();
  const sMs = Number(msg?.s);
  const o = Number(msg?.o), h = Number(msg?.h), l = Number(msg?.l), c = Number(msg?.c);
  const v = Number(msg?.v || 0);

  if (!symbol) return null;
  if (![o, h, l, c].every(Number.isFinite)) return null;
  if (!Number.isFinite(sMs) || sMs <= 0) return null;

  const tSec = Math.floor(sMs / 1000);
  const minuteSec = Math.floor(tSec / 60) * 60;

  return {
    symbol,
    bar1m: { time: minuteSec, open: o, high: h, low: l, close: c, volume: v },
  };
}

// T payload: { ev:"T", sym, p, s, t(ms) }
function applyTickTo1m(cur1m, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s || 0);
  const tMs = Number(tick?.t || 0);

  if (!Number.isFinite(price) || !Number.isFinite(tMs) || tMs <= 0) return cur1m;

  const tSec = Math.floor(tMs / 1000);
  const bucketSec = Math.floor(tSec / 60) * 60;

  if (!cur1m || cur1m.time < bucketSec) {
    return {
      time: bucketSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number(size || 0),
    };
  }

  const b = { ...cur1m };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* ---------------------------- In-memory caches ---------------------------- */

// cacheBars: key `${symbol}|${mode}` -> Map(tfMin -> barsAsc[])
const cacheBars = new Map();

// rolling 1m from trades (if AM is quiet)
const tick1m = new Map();   // symbol -> bar1m
const lastAmMs = new Map(); // symbol -> ms timestamp when AM last seen

function cacheKey(symbol, mode) {
  return `${symbol}|${mode}`;
}

function getCacheMap(symbol, mode) {
  const key = cacheKey(symbol, mode);
  if (!cacheBars.has(key)) cacheBars.set(key, new Map());
  return cacheBars.get(key);
}

function pushRing(arr, bar, maxLen) {
  if (!Array.isArray(arr)) arr = [];

  if (arr.length === 0) {
    arr.push(bar);
  } else {
    const last = arr[arr.length - 1];
    if (bar.time > last.time) arr.push(bar);
    else if (bar.time === last.time) arr[arr.length - 1] = bar;
  }

  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
  return arr;
}

function fold1mIntoTf(symbol, b1m, tfMin, mode) {
  const m = getCacheMap(symbol, mode);
  const bars = m.get(tfMin) || [];
  const maxLen = maxBarsForTf(tfMin);

  const bucket = bucketStartSecByMode(b1m.time, tfMin, mode);
  if (bucket === null) return null; // RTH out-of-session

  if (bars.length === 0) {
    const first = {
      time: bucket,
      open: b1m.open,
      high: b1m.high,
      low: b1m.low,
      close: b1m.close,
      volume: Number(b1m.volume || 0),
    };
    const next = pushRing(bars, first, maxLen);
    m.set(tfMin, next);
    return next[next.length - 1] || null;
  }

  const last = bars[bars.length - 1];

  if (last.time < bucket) {
    const nb = {
      time: bucket,
      open: b1m.open,
      high: b1m.high,
      low: b1m.low,
      close: b1m.close,
      volume: Number(b1m.volume || 0),
    };
    const next = pushRing(bars, nb, maxLen);
    m.set(tfMin, next);
    return next[next.length - 1] || null;
  }

  if (last.time === bucket) {
    const upd = { ...last };
    upd.high = Math.max(upd.high, b1m.high);
    upd.low = Math.min(upd.low, b1m.low);
    upd.close = b1m.close;
    upd.volume = Number(upd.volume || 0) + Number(b1m.volume || 0);
    bars[bars.length - 1] = upd;
    const next = pushRing(bars, upd, maxLen);
    m.set(tfMin, next);
    return next[next.length - 1] || null;
  }

  return last;
}

/* ------------------------- SSE subscriber registry ------------------------ */

const subscribers = new Set(); // { res, symbol, tfMin, mode }

function broadcast(symbol, tfMin, mode, bar) {
  const key = `${symbol}|${tfMin}|${mode}`;
  if (!canEmit(key, 1000)) return;

  const tf = labelTf(tfMin);
  for (const sub of subscribers) {
    if (sub.symbol === symbol && sub.tfMin === tfMin && sub.mode === mode) {
      try {
        sseSend(sub.res, { ok: true, type: "bar", symbol, tf, mode, bar });
      } catch {}
    }
  }
}

/* --------------------------- Polygon WS (global) --------------------------- */

let ws = null;
let backoffMs = 1000;
let reconnectTimer = null;

function cleanupWs() {
  try { ws?.close?.(); } catch {}
  ws = null;
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  backoffMs = Math.min(Math.floor(backoffMs * 1.5), 15000);
  const jitter = Math.floor(Math.random() * 250);
  reconnectTimer = setTimeout(startWs, backoffMs + jitter);
}

function startWs() {
  const key = resolvePolygonKey();
  if (!key) {
    console.log("[stream] Missing Polygon API key — WS not started");
    return;
  }

  console.log("[stream] Starting Polygon WS…");
  ws = new WebSocket(POLY_WS_URL);

  ws.onopen = () => {
    backoffMs = 1000;
    console.log("[stream] WS open → auth + subscribe");
    ws.send(JSON.stringify({ action: "auth", params: key }));
    ws.send(JSON.stringify({ action: "subscribe", params: SUBS }));
    console.log("[stream] subscribed:", SUBS);
  };

  ws.onmessage = (ev) => {
    let arr;
    try { arr = JSON.parse(ev.data); } catch { return; }
    if (!Array.isArray(arr)) arr = [arr];

    for (const msg of arr) {
      const type = msg?.ev;

      if (type === "status") continue;

      if (type === "AM") {
        const am = parseAM(msg);
        if (!am) continue;

        const { symbol, bar1m } = am;
        lastAmMs.set(symbol, Date.now());
        tick1m.set(symbol, null);

        // Fold into BOTH modes so toggle works later without refetching:
        for (const mode of ["rth", "eth"]) {
          for (const tfMin of TF_SET) {
            const out = fold1mIntoTf(symbol, bar1m, tfMin, mode);
            if (out) broadcast(symbol, tfMin, mode, out);
          }
        }
        continue;
      }

      if (type === "T") {
        const symbol = String(msg?.sym || "").toUpperCase();
        if (!symbol) continue;

        const amFresh = Date.now() - (lastAmMs.get(symbol) || 0) < 120000;
        if (amFresh) continue;

        const cur = tick1m.get(symbol) || null;
        const next = applyTickTo1m(cur, msg);
        tick1m.set(symbol, next);
        if (!next) continue;

        for (const mode of ["rth", "eth"]) {
          for (const tfMin of TF_SET) {
            const out = fold1mIntoTf(symbol, next, tfMin, mode);
            if (out) broadcast(symbol, tfMin, mode, out);
          }
        }
      }
    }
  };

  ws.onerror = () => { cleanupWs(); scheduleReconnect(); };
  ws.onclose = () => { cleanupWs(); scheduleReconnect(); };
}

startWs();

/* --------------------------- Snapshot fallback (REST) ---------------------- */

// Fetch 1m history from backend-1 then re-bucket HERE so RTH candles match TV.
async function fetch1mFromBackend1(symbol, limit1m) {
  const base = String(HIST_BASE || "").replace(/\/+$/, "");
  const url =
    `${base}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=1m&limit=${encodeURIComponent(limit1m)}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`backend1 ${r.status}`);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : (Array.isArray(j?.bars) ? j.bars : []);
  return Array.isArray(arr) ? arr : [];
}

function normalizeBar1m(b) {
  const t = Number(b?.time ?? b?.t ?? b?.ts ?? b?.timestamp);
  const o = Number(b?.open ?? b?.o);
  const h = Number(b?.high ?? b?.h);
  const l = Number(b?.low ?? b?.l);
  const c = Number(b?.close ?? b?.c);
  const v = Number(b?.volume ?? b?.v ?? 0);
  if (![t, o, h, l, c].every(Number.isFinite)) return null;
  return { time: t, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 };
}

// Build bars for requested tfMin from 1m list, using mode bucketing.
function buildTfFrom1m(symbol, tfMin, mode, bars1mAsc, limitOut) {
  const out = [];
  let cur = null;

  for (const b of bars1mAsc) {
    const bucket = bucketStartSecByMode(b.time, tfMin, mode);
    if (bucket === null) continue;

    if (!cur || cur.time < bucket) {
      if (cur) out.push(cur);
      cur = {
        time: bucket,
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
  if (out.length > limitOut) return out.slice(-limitOut);
  return out;
}

// Compute how many 1m bars we need to backfill for each tf horizon.
function need1mCountForTf(tfMin) {
  // cap to Polygon ~50k 1m bars
  const CAP = 50000;
  if (tfMin === 10) return Math.min(CAP, 390 * 10);                // ~2 weeks
  if (tfMin === 30) return Math.min(CAP, 390 * (3 * TRADING_DAYS_PER_MONTH)); // ~3 months
  if (tfMin === 60) return Math.min(CAP, 390 * (6 * TRADING_DAYS_PER_MONTH)); // ~6 months (~49140)
  if (tfMin === 240) return Math.min(CAP, 390 * (6 * TRADING_DAYS_PER_MONTH)); // same 1m input
  if (tfMin >= 1440) return Math.min(CAP, 390 * (6 * TRADING_DAYS_PER_MONTH)); // still fine
  return Math.min(CAP, 5000);
}

/* --------------------------- GET /stream/snapshot -------------------------- */
// mode=rth|eth (default rth)
streamRouter.get("/snapshot", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfMin = normalizeTf(req.query.tf || "10m");
    const tf = labelTf(tfMin);
    const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1500)));
    const mode = normalizeMode(req.query.mode);

    // 1) Use cache if available
    const m = cacheBars.get(cacheKey(symbol, mode));
    const cached = m?.get(tfMin) || [];
    if (cached.length > 0) {
      const bars = cached.length > limit ? cached.slice(-limit) : cached;
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, type: "snapshot", symbol, tf, mode, bars });
    }

    // 2) Cache empty → backfill 1m from backend-1 then re-bucket HERE (RTH-aligned)
    const need1m = need1mCountForTf(tfMin);
    const raw1m = await fetch1mFromBackend1(symbol, need1m).catch(() => []);
    const oneMin = raw1m
      .map(normalizeBar1m)
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);

    const built = buildTfFrom1m(symbol, tfMin, mode, oneMin, limit);

    // Store it into cache for this mode so next call is instant
    const mm = getCacheMap(symbol, mode);
    mm.set(tfMin, built);

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, type: "snapshot", symbol, tf, mode, bars: built });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      ok: false,
      error: "snapshot_error",
      detail: String(e?.message || e),
    });
  }
});

/* ---------------------------- GET /stream/agg (SSE) ------------------------ */
// mode=rth|eth (default rth)
streamRouter.get("/agg", (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf || "10m");
  const tf = labelTf(tfMin);
  const mode = normalizeMode(req.query.mode);

  sseHeaders(res);

  // Send cached snapshot first (no REST backfill here; snapshot endpoint does that)
  try {
    const m = cacheBars.get(cacheKey(symbol, mode));
    const list = m?.get(tfMin) || [];
    sseSend(res, { ok: true, type: "snapshot", symbol, tf, mode, bars: list });
  } catch {}

  const sub = { res, symbol, tfMin, mode };
  subscribers.add(sub);

  let alive = true;
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  req.on("close", () => {
    alive = false;
    clearInterval(ping);
    subscribers.delete(sub);
    try { res.end(); } catch {}
  });
});
