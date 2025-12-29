// services/streamer/routes/stream.js
// ============================================================================
// Polygon WS → In-memory cache → SSE stream + snapshot seeding
//
// Endpoints:
//   GET /stream/agg?symbol=SPY&tf=10m
//     - SSE stream of live bars + heartbeat
//     - Immediately emits: type:"snapshot" with cached bars
//
//   GET /stream/snapshot?symbol=SPY&tf=10m&limit=1500
//     - JSON snapshot of cached bars (no SSE)
//
// Why:
// - Polygon REST may block SAME-DAY intraday AGGs.
// - WebSocket provides SAME-DAY data.
// - Cache makes refresh-after-close still show today's session.
//
// Cache Horizons (your spec):
//   10m  → 2 weeks
//   30m  → 3 months
//   1h   → 6 months
//   4h   → 6 months
//   1d   → 6 months (note: day bars over WS are not "official", but we can bucket from AM/T)
//
// ============================================================================

import express from "express";
import WebSocket from "ws";


const streamRouter = express.Router();
export default streamRouter;

/* ------------------------------- Settings -------------------------------- */

const POLY_WS_URL = "wss://socket.polygon.io/stocks";

function resolvePolygonKey() {
  const keys = [
    process.env.POLYGON_API,
    process.env.POLYGON_API_KEY,
    process.env.POLY_API_KEY,
  ];
  return keys.find((k) => k && k.trim()) || "";
}

// What symbols do we keep hot? (default: SPY, QQQ)
const HOT_SYMBOLS = String(process.env.STREAM_SYMBOLS || "SPY,QQQ")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/* ----------------------------- Timeframe utils ---------------------------- */

function normalizeTf(tf = "10m") {
  const t = String(tf || "").toLowerCase().trim();
  if (t === "1d" || t === "d" || t === "day" || t === "daily") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function tfLabel(tfMin) {
  return tfMin >= 1440 ? "1d" : tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;
}

function bucketStartSec(unixSec, tfMin) {
  const size = tfMin * 60;
  return Math.floor(unixSec / size) * size;
}

// Convert "months horizon" to max bars using your spec.
// We store bar buckets per TF, so this is bar-count, not minutes.
const TRADING_DAYS_PER_MONTH = 21;
function maxBarsForTf(tfMin) {
  // 10m → 2 weeks
  if (tfMin === 10) {
    const days = 10;                 // ~2 weeks trading days
    const barsPerDay = 39;           // 390 / 10
    return days * barsPerDay;
  }
  // 30m → 3 months
  if (tfMin === 30) {
    const days = 3 * TRADING_DAYS_PER_MONTH; // ~63
    const barsPerDay = 13;                   // 390 / 30
    return days * barsPerDay;                // ~819
  }
  // 1h → 6 months
  if (tfMin === 60) {
    const days = 6 * TRADING_DAYS_PER_MONTH; // ~126
    const barsPerDay = 7;                    // ~RTH hours
    return days * barsPerDay;                // ~882
  }
  // 4h → 6 months
  if (tfMin === 240) {
    const days = 6 * TRADING_DAYS_PER_MONTH; // ~126
    const barsPerDay = 2;                    // roughly
    return days * barsPerDay;                // ~252
  }
  // 1d → 6 months
  if (tfMin >= 1440) {
    const days = 6 * TRADING_DAYS_PER_MONTH; // ~126
    return days;
  }

  // Default: keep ~2 weeks worth, scaled conservatively
  return 500;
}

/* -------------------------------- SSE utils ------------------------------- */

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

const sseSend = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/* ------------------------- Normalize AM (official 1m) --------------------- */
// AM payload: { ev:"AM", sym:"SPY", s:<startMs>, o,h,l,c, v }
function normalizeAM(msg) {
  const symbol = String(msg?.sym || "").toUpperCase();
  const sMs = Number(msg?.s);
  const o = Number(msg?.o), h = Number(msg?.h), l = Number(msg?.l), c = Number(msg?.c);
  const v = Number(msg?.v || 0);
  if (!symbol) return null;
  if (![o, h, l, c].every(Number.isFinite)) return null;
  if (!Number.isFinite(sMs) || sMs <= 0) return null;

  const startSec = Math.floor(sMs / 1000);
  const minuteSec = Math.floor(startSec / 60) * 60;

  return {
    symbol,
    bar1m: { time: minuteSec, open: o, high: h, low: l, close: c, volume: v },
  };
}

/* ------------------------------ T tick → 1m ------------------------------- */
// T payload: { ev:"T", sym, p, s, t (ms) }
function applyTickTo1m(current1m, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s || 0);
  const tMs = Number(tick?.t || 0);
  const symbol = String(tick?.sym || "").toUpperCase();
  if (!symbol) return current1m;
  if (!Number.isFinite(price) || !Number.isFinite(tMs) || tMs <= 0) return current1m;

  const tSec = Math.floor(tMs / 1000);
  const bucketSec = Math.floor(tSec / 60) * 60;

  if (!current1m || current1m.time < bucketSec) {
    return {
      time: bucketSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number(size || 0),
    };
  }

  const b = { ...current1m };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* ------------------------------ In-memory cache ---------------------------- */

// cacheBars[symbol][tfMin] = array of tf bars (ascending)
const cacheBars = new Map(); // symbol -> Map(tfMin -> bars[])
const tickBuilt1m = new Map(); // symbol -> rolling 1m from ticks (when AM quiet)
const lastAmAtMs = new Map();  // symbol -> last AM time seen

function ensureSymbol(symbol) {
  if (!cacheBars.has(symbol)) cacheBars.set(symbol, new Map());
  return cacheBars.get(symbol);
}

function pushRing(arr, bar, maxLen) {
  if (!arr) arr = [];
  const n = arr.length;

  if (n === 0) {
    arr.push(bar);
    return arr;
  }

  const last = arr[n - 1];
  if (bar.time > last.time) {
    arr.push(bar);
  } else if (bar.time === last.time) {
    arr[n - 1] = bar;
  } else {
    // out-of-order; ignore
    return arr;
  }

  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
  return arr;
}

function fold1mIntoTf(symbol, b1m, tfMin) {
  const symMap = ensureSymbol(symbol);
  const bars = symMap.get(tfMin) || [];

  const bucket = bucketStartSec(b1m.time, tfMin);
  const maxLen = maxBarsForTf(tfMin);

  let next;
  if (bars.length === 0) {
    next = pushRing(bars, {
      time: bucket,
      open: b1m.open,
      high: b1m.high,
      low:  b1m.low,
      close:b1m.close,
      volume: Number(b1m.volume || 0),
    }, maxLen);
  } else {
    const last = bars[bars.length - 1];
    if (last.time < bucket) {
      next = pushRing(bars, {
        time: bucket,
        open: b1m.open,
        high: b1m.high,
        low:  b1m.low,
        close:b1m.close,
        volume: Number(b1m.volume || 0),
      }, maxLen);
    } else if (last.time === bucket) {
      const updated = { ...last };
      updated.high = Math.max(updated.high, b1m.high);
      updated.low  = Math.min(updated.low,  b1m.low);
      updated.close = b1m.close;
      updated.volume = Number(updated.volume || 0) + Number(b1m.volume || 0);
      bars[bars.length - 1] = updated;
      next = pushRing(bars, updated, maxLen);
    } else {
      next = bars;
    }
  }

  symMap.set(tfMin, next);
  return next[next.length - 1] || null;
}

/* --------------------------- Live fanout to clients ------------------------ */

// subscribers: {res, symbol, tfMin}
const subscribers = new Set();

function broadcast(symbol, tfMin, bar) {
  const label = tfLabel(tfMin);
  for (const sub of subscribers) {
    if (sub.symbol === symbol && sub.tfMin === tfMin) {
      try {
        sseSend(sub.res, { ok: true, type: "bar", symbol, tf: label, bar });
      } catch {}
    }
  }
}

/* -------------------------- Polygon WS (global) ---------------------------- */

let ws = null;
let wsStarted = false;
let wsBackoff = 1000;
let wsReconnectTimer = null;

function wsCleanup() {
  try { ws?.close?.(); } catch {}
  ws = null;
}

function scheduleWsReconnect() {
  clearTimeout(wsReconnectTimer);
  wsBackoff = Math.min(Math.floor(wsBackoff * 1.5), 15000);
  const jitter = Math.floor(Math.random() * 250);
  wsReconnectTimer = setTimeout(startWs, wsBackoff + jitter);
}

function startWs() {
  const key = resolvePolygonKey();
  if (!key) {
    console.log("[stream] Missing Polygon key — WS not started");
    return;
  }
  if (wsStarted) return;
  wsStarted = true;

  console.log("[stream] Starting Polygon WS…");
  ws = new WebSocket(POLY_WS_URL);

  ws.onopen = () => {
    wsBackoff = 1000;
    console.log("[stream] WS open → auth + subscribe");

    ws.send(JSON.stringify({ action: "auth", params: key }));

    const subs = [];
    for (const sym of HOT_SYMBOLS) {
      subs.push(`AM.${sym}`); // minute aggregates
      subs.push(`T.${sym}`);  // trades as fallback
    }
    ws.send(JSON.stringify({ action: "subscribe", params: subs.join(",") }));
    console.log("[stream] subscribed:", subs.join(","));
  };

  ws.onmessage = (ev) => {
    let arr;
    try { arr = JSON.parse(ev.data); } catch { return; }
    if (!Array.isArray(arr)) arr = [arr];

    for (const msg of arr) {
      const t = msg?.ev;

      if (t === "status") {
        // Useful for debugging:
        // console.log("[stream] status:", msg?.status, msg?.message);
        continue;
      }

      if (t === "AM") {
        const am = normalizeAM(msg);
        if (!am) continue;
        const symbol = am.symbol;

        lastAmAtMs.set(symbol, Date.now());
        tickBuilt1m.set(symbol, null);

        // Update caches for the timeframes we care about
        const b1m = am.bar1m;

        // 10m, 30m, 1h, 4h, 1d
        const last10 = fold1mIntoTf(symbol, b1m, 10);
        if (last10) broadcast(symbol, 10, last10);

        const last30 = fold1mIntoTf(symbol, b1m, 30);
        if (last30) broadcast(symbol, 30, last30);

        const last60 = fold1mIntoTf(symbol, b1m, 60);
        if (last60) broadcast(symbol, 60, last60);

        const last240 = fold1mIntoTf(symbol, b1m, 240);
        if (last240) broadcast(symbol, 240, last240);

        const last1d = fold1mIntoTf(symbol, b1m, 1440);
        if (last1d) broadcast(symbol, 1440, last1d);

        continue;
      }

      if (t === "T") {
        const symbol = String(msg?.sym || "").toUpperCase();
        if (!symbol) continue;

        // If AM is fresh, ignore ticks to avoid double printing
        const amFresh = Date.now() - (lastAmAtMs.get(symbol) || 0) < 120000;
        if (amFresh) continue;

        const cur = tickBuilt1m.get(symbol) || null;
        const next = applyTickTo1m(cur, msg);
        tickBuilt1m.set(symbol, next);
        if (!next) continue;

        // Fold tick-built 1m into caches too
        const last10 = fold1mIntoTf(symbol, next, 10);
        if (last10) broadcast(symbol, 10, last10);

        const last30 = fold1mIntoTf(symbol, next, 30);
        if (last30) broadcast(symbol, 30, last30);

        const last60 = fold1mIntoTf(symbol, next, 60);
        if (last60) broadcast(symbol, 60, last60);

        const last240 = fold1mIntoTf(symbol, next, 240);
        if (last240) broadcast(symbol, 240, last240);

        const last1d = fold1mIntoTf(symbol, next, 1440);
        if (last1d) broadcast(symbol, 1440, last1d);

        continue;
      }
    }
  };

  ws.onerror = () => {
    console.log("[stream] WS error → reconnect");
    wsCleanup();
    wsStarted = false;
    scheduleWsReconnect();
  };

  ws.onclose = () => {
    console.log("[stream] WS closed → reconnect");
    wsCleanup();
    wsStarted = false;
    scheduleWsReconnect();
  };
}

// Start WS immediately when this module loads
startWs();

/* --------------------------- GET /stream/snapshot -------------------------- */
// JSON snapshot (for chart seeding after close)
streamRouter.get("/snapshot", (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf || "10m");
  const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1500)));

  const symMap = cacheBars.get(symbol);
  const list = symMap?.get(tfMin) || [];
  const bars = list.length > limit ? list.slice(-limit) : list;

  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, type: "snapshot", symbol, tf: tfLabel(tfMin), bars });
});

/* ---------------------------- GET /stream/agg ----------------------------- */
// SSE: emits snapshot first, then live bars
streamRouter.get("/agg", (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf || "10m");
  const label = tfLabel(tfMin);

  sseHeaders(res);

  let alive = true;

  // Immediately send snapshot if we have it
  try {
    const symMap = cacheBars.get(symbol);
    const list = symMap?.get(tfMin) || [];
    sseSend(res, { ok: true, type: "snapshot", symbol, tf: label, bars: list });
  } catch {}

  const sub = { res, symbol, tfMin };
  subscribers.add(sub);

  // Keepalive ping
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  req.on("close", () => {
    alive = false;
    clearInterval(ping);
    subscribers.delete(sub);
    try { res.end(); } catch {}
  });
});
