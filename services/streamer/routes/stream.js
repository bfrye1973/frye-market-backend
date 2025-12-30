// services/streamer/routes/stream.js
// ============================================================================
// Polygon WebSocket → In-memory cache → SSE stream + Snapshot seeding
//
// Endpoints:
//   GET /stream/agg?symbol=SPY&tf=10m
//     - SSE stream (type:"snapshot" first, then type:"bar")
//     - Heartbeat ":ping <ts>" every 15s
//
//   GET /stream/snapshot?symbol=SPY&tf=10m&limit=1500
//     - JSON snapshot
//     - If in-memory cache is empty (market closed / streamer restarted),
//       FALLS BACK to backend-1 /api/v1/ohlc (historical REST).
//
// Your requested horizons:
//   10m  → ~2 weeks
//   30m  → ~3 months
//   1h   → ~6 months
//   4h   → ~6 months
//   1d   → ~6 months
//
// NEW (Throttle):
// - SSE "bar" emits are throttled to at most 1 update / second per (symbol, tf).
//
// NEW (RTH alignment):
// - Bucketing is aligned to NYSE Regular Trading Hours (RTH) boundaries:
//   - Session open anchor: 09:30 America/New_York
//   - Session close cutoff: 16:00 America/New_York
// - This makes 10m/30m/1h/4h candle structure match TradingView (RTH mode).
// - We still DISPLAY Phoenix time in the frontend; this file only controls bucket timestamps.
// ============================================================================

import express from "express";
import { WebSocket } from "ws";
import { DateTime } from "luxon";

const streamRouter = express.Router();
export default streamRouter;

/* ------------------------------- Config ---------------------------------- */

const POLY_WS_URL = "wss://socket.polygon.io/stocks";

// backend-1 (REST historical) — used ONLY as snapshot fallback
const HIST_BASE =
  process.env.HIST_BASE ||
  process.env.BACKEND1_BASE ||
  "https://frye-market-backend-1.onrender.com";

// Symbols to keep hot (default SPY,QQQ)
const HOT_SYMBOLS = String(process.env.STREAM_SYMBOLS || "SPY,QQQ")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

// WebSocket subscriptions: minute aggregates + trade ticks as fallback
const SUBS = HOT_SYMBOLS.flatMap((s) => [`AM.${s}`, `T.${s}`]).join(",");

// Resolve API key
function resolvePolygonKey() {
  const keys = [process.env.POLYGON_API, process.env.POLYGON_API_KEY, process.env.POLY_API_KEY];
  return keys.find((k) => k && k.trim()) || "";
}

/* --------------------------- Timeframe helpers --------------------------- */

const TRADING_DAYS_PER_MONTH = 21;
const RTH_MIN_PER_DAY = 390; // 6.5h * 60

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

// Your horizons → max bar counts
function maxBarsForTf(tfMin) {
  // 10m → 2 weeks (~10 trading days)
  if (tfMin === 10) return 10 * barsPerDay(10); // ~390
  // 30m → 3 months (~63 trading days)
  if (tfMin === 30) return (3 * TRADING_DAYS_PER_MONTH) * barsPerDay(30); // ~819
  // 1h → 6 months (~126 trading days)
  if (tfMin === 60) return (6 * TRADING_DAYS_PER_MONTH) * 7; // ~882
  // 4h → 6 months (~126 trading days)
  if (tfMin === 240) return (6 * TRADING_DAYS_PER_MONTH) * 2; // ~252
  // 1d → 6 months (~126 trading days)
  if (tfMin >= 1440) return 6 * TRADING_DAYS_PER_MONTH; // ~126

  // default
  return 500;
}

// The TFs we actively maintain in cache (your spec)
const TF_SET = [10, 30, 60, 240, 1440];

/* ------------------------------ RTH bucketing ----------------------------- */
// Default candle mode: RTH (TradingView-like).
// - Only accepts bars that fall within 09:30–16:00 America/New_York.
// - Anchors buckets to 09:30 ET.
// - Daily is bucketed at NY midnight (00:00 ET) for standard daily bar timestamps.

const NY_ZONE = "America/New_York";
const RTH_OPEN_H = 9;
const RTH_OPEN_M = 30;
const RTH_CLOSE_H = 16;
const RTH_CLOSE_M = 0;

function getNyDayAnchorSecs(unixSec) {
  const ny = DateTime.fromSeconds(unixSec, { zone: NY_ZONE });
  const dayStart = ny.startOf("day");
  const open = dayStart.plus({ hours: RTH_OPEN_H, minutes: RTH_OPEN_M });
  const close = dayStart.plus({ hours: RTH_CLOSE_H, minutes: RTH_CLOSE_M });
  return {
    openSec: Math.floor(open.toSeconds()),
    closeSec: Math.floor(close.toSeconds()),
    dayStartSec: Math.floor(dayStart.toSeconds()),
  };
}

function bucketStartSecRth(unixSec, tfMin) {
  const { openSec, closeSec, dayStartSec } = getNyDayAnchorSecs(unixSec);

  // Daily bars: bucket at NY midnight
  if (tfMin >= 1440) return dayStartSec;

  // RTH only: ignore anything outside session
  if (unixSec < openSec || unixSec >= closeSec) return null;

  const size = tfMin * 60;
  const idx = Math.floor((unixSec - openSec) / size);
  const bucket = openSec + idx * size;

  // extra safety: bucket must start before close
  if (bucket >= closeSec) return null;
  return bucket;
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

// lastEmit[symbol] => Map(tfMin -> lastMs)
const lastEmit = new Map();

function canEmit(symbol, tfMin, intervalMs = 1000) {
  let m = lastEmit.get(symbol);
  if (!m) {
    m = new Map();
    lastEmit.set(symbol, m);
  }

  const now = Date.now();
  const last = m.get(tfMin) || 0;

  if (now - last >= intervalMs) {
    m.set(tfMin, now);
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

// cacheBars: symbol -> Map(tfMin -> barsAsc[])
const cacheBars = new Map();

// rolling 1m from trades (if AM is quiet)
const tick1m = new Map();         // symbol -> bar1m
const lastAmMs = new Map();       // symbol -> ms timestamp when AM last seen

function symMap(symbol) {
  if (!cacheBars.has(symbol)) cacheBars.set(symbol, new Map());
  return cacheBars.get(symbol);
}

function pushRing(arr, bar, maxLen) {
  if (!Array.isArray(arr)) arr = [];

  if (arr.length === 0) {
    arr.push(bar);
  } else {
    const last = arr[arr.length - 1];
    if (bar.time > last.time) arr.push(bar);
    else if (bar.time === last.time) arr[arr.length - 1] = bar;
    // older out-of-order bars are ignored
  }

  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
  return arr;
}

function fold1mIntoTf(symbol, b1m, tfMin) {
  const m = symMap(symbol);
  const bars = m.get(tfMin) || [];
  const maxLen = maxBarsForTf(tfMin);

  const bucket = bucketStartSecRth(b1m.time, tfMin);
  if (bucket === null) return null; // outside RTH for intraday

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

const subscribers = new Set(); // { res, symbol, tfMin }

function broadcast(symbol, tfMin, bar) {
  // Throttle OUTPUT to 1 update / second per symbol + timeframe
  if (!canEmit(symbol, tfMin, 1000)) return;

  const tf = labelTf(tfMin);
  for (const sub of subscribers) {
    if (sub.symbol === symbol && sub.tfMin === tfMin) {
      try {
        sseSend(sub.res, { ok: true, type: "bar", symbol, tf, bar });
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

      if (type === "status") {
        // Uncomment for diagnostics:
        // console.log("[stream] status:", msg?.status, msg?.message);
        continue;
      }

      if (type === "AM") {
        const am = parseAM(msg);
        if (!am) continue;

        const { symbol, bar1m } = am;
        lastAmMs.set(symbol, Date.now());
        tick1m.set(symbol, null);

        // Fold into all cached TFs
        for (const tfMin of TF_SET) {
          const out = fold1mIntoTf(symbol, bar1m, tfMin);
          if (out) broadcast(symbol, tfMin, out);
        }
        continue;
      }

      if (type === "T") {
        const symbol = String(msg?.sym || "").toUpperCase();
        if (!symbol) continue;

        // If AM is fresh, ignore trades to avoid double printing
        const amFresh = Date.now() - (lastAmMs.get(symbol) || 0) < 120000;
        if (amFresh) continue;

        const cur = tick1m.get(symbol) || null;
        const next = applyTickTo1m(cur, msg);
        tick1m.set(symbol, next);
        if (!next) continue;

        // Fold into cached TFs (RTH-only bucketing will drop out-of-session)
        for (const tfMin of TF_SET) {
          const out = fold1mIntoTf(symbol, next, tfMin);
          if (out) broadcast(symbol, tfMin, out);
        }
      }
    }
  };

  ws.onerror = () => {
    console.log("[stream] WS error → reconnect");
    cleanupWs();
    scheduleReconnect();
  };

  ws.onclose = () => {
    console.log("[stream] WS closed → reconnect");
    cleanupWs();
    scheduleReconnect();
  };
}

startWs();

/* --------------------------- Snapshot fallback (REST) ---------------------- */

async function fetchHistoryFromBackend1(symbol, tf, limit) {
  const base = String(HIST_BASE || "").replace(/\/+$/, "");
  const url =
    `${base}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(tf)}` +
    `&limit=${encodeURIComponent(limit)}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`backend1 ${r.status}`);
  const j = await r.json();

  // backend-1 returns an array of bars
  const arr = Array.isArray(j) ? j : (Array.isArray(j?.bars) ? j.bars : []);
  return Array.isArray(arr) ? arr : [];
}

/* --------------------------- GET /stream/snapshot -------------------------- */
// Returns cached bars; if empty, falls back to backend-1 historical.
streamRouter.get("/snapshot", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfMin = normalizeTf(req.query.tf || "10m");
    const tf = labelTf(tfMin);
    const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1500)));

    const m = cacheBars.get(symbol);
    const list = m?.get(tfMin) || [];
    const bars = list.length > limit ? list.slice(-limit) : list;

    // If cache empty (market closed / streamer restarted), seed from backend-1 history
    if (!bars || bars.length === 0) {
      const hist = await fetchHistoryFromBackend1(symbol, tf, limit).catch(() => []);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, type: "snapshot", symbol, tf, bars: hist });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, type: "snapshot", symbol, tf, bars });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ ok: false, error: "snapshot_error", detail: String(e?.message || e) });
  }
});

/* ---------------------------- GET /stream/agg (SSE) ------------------------ */
// Emits snapshot immediately, then live "bar" updates (throttled).
streamRouter.get("/agg", (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf || "10m");
  const tf = labelTf(tfMin);

  sseHeaders(res);

  // send snapshot first (cached only; frontend uses /stream/snapshot for REST fallback)
  try {
    const m = cacheBars.get(symbol);
    const list = m?.get(tfMin) || [];
    sseSend(res, { ok: true, type: "snapshot", symbol, tf, bars: list });
  } catch {}

  const sub = { res, symbol, tfMin };
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
