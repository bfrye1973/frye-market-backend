// services/streamer/routes/stream.js
// ============================================================================
// Polygon Dual-Feed → SSE Aggregator
// - Prefers AM.<SYM> (official 1m bars, RTH)
// - Falls back to T.<SYM> (trade ticks, all sessions) and builds rolling 1m
// - Aggregates 1m → requested tf (minutes) and streams to the client
//
// Emits (SSE):
//   data: {"ok":true,"type":"bar","symbol":"SPY","tf":"10m","bar":{time,open,high,low,close,volume}}
//
// Contracts:
// - bar.time is UNIX seconds (not ms)
// - tf supports "1m, 5m, 10m, 15m, 30m, 60m (or 1h), 240m (or 4h), ...".
// - Daily (>= 1440m) is intentionally blocked over SSE.
// - Heartbeat: ":ping <ts>" every 15s to keep connections alive.
//
// Optional paper-trading hook:
// - If you later want to update unrealized PnL live, you can provide an async
//   function that posts marks to your paper module:
//     const onMark = async (symbol, lastClose) => { ... }
//   For now it's a no-op, so this file is self-contained.
// ============================================================================

import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ------------------------------- Settings -------------------------------- */

// Polygon socket endpoint
const POLY_WS_URL = "wss://socket.polygon.io/stocks";

// Resolve API key from several env names (be liberal)
function resolvePolygonKey() {
  const keys = [
    process.env.POLYGON_API,
    process.env.POLYGON_API_KEY,
    process.env.POLY_API_KEY,
  ];
  return keys.find((k) => k && k.trim()) || "";
}

// Optional hook (no-op by default). Wire later if you want to POST /paper/mark.
async function onMark(_symbol, _last) {
  // Example (later):
  // await fetch(`${process.env.PAPER_BASE}/paper/mark`, { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ symbol, last }) });
}

/* ----------------------------- Timeframe utils ---------------------------- */

function normalizeTf(tf = "1m") {
  const t = String(tf || "").toLowerCase().trim();
  if (t === "1d" || t === "d" || t === "day" || t === "daily") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function bucketStartSec(unixSec, tfMin) {
  const size = tfMin * 60;
  return Math.floor(unixSec / size) * size;
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
  const symbol = msg?.sym;
  const sMs = Number(msg?.s);
  const o = Number(msg?.o), h = Number(msg?.h), l = Number(msg?.l), c = Number(msg?.c);
  const v = Number(msg?.v || 0);
  if (!symbol) return null;
  if (![o, h, l, c].every(Number.isFinite)) return null;
  if (!Number.isFinite(v) || v < 0) return null;
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
  if (!Number.isFinite(price) || !Number.isFinite(tMs) || tMs <= 0) return current1m;

  const tSec = Math.floor(tMs / 1000);
  const bucketSec = Math.floor(tSec / 60) * 60;

  if (!current1m || current1m.time < bucketSec) {
    // Start new 1m bar
    return {
      time: bucketSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number(size || 0),
    };
  }

  // Extend current 1m bar
  const b = { ...current1m };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* ---------------------------- GET /stream/agg ----------------------------- */
/**
 * Query params:
 *   symbol=SPY
 *   tf=1m|5m|10m|15m|30m|1h|4h|...  (daily blocked)
 *
 * Lifecycle:
 * 1) Open WS to Polygon, auth, subscribe AM.<sym> and T.<sym>
 * 2) During RTH: prefer AM 1m bars → fold into tf → emit
 * 3) Off RTH: aggregate T ticks → rolling 1m → fold into tf → emit
 * 4) Heartbeat :ping every 15s; auto-reconnect WS with jitter on errors
 */
streamRouter.get("/agg", (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStrRaw = String(req.query.tf || "1m");
  const tfMin = normalizeTf(tfStrRaw);
  // No daily streaming over SSE to keep payloads small/stable
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over SSE");
  // Normalize back to canonical label for client visibility
  const tfLabel = tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;

  sseHeaders(res);

  // Per-connection state
  let ws = null;
  let alive = true;
  let reconnectTimer = null;
  let lastAmAtMs = 0;   // last AM message time seen (ms)
  let bar1m = null;     // rolling 1m constructed from T ticks (when AM is quiet)
  let currentTf = null; // aggregated tf bar (from 1m)
  let backoffMs = 1000; // reconnect backoff

  const emitTfBar = (b) => {
    sseSend(res, { ok: true, type: "bar", symbol, tf: tfLabel, bar: b });
    // OPTIONAL: forward mark to paper (uncomment when you wire /paper/mark)
    // onMark(symbol, b.close).catch(() => {});
  };

  const fold1mIntoTf = (b1m) => {
    const bucket = bucketStartSec(b1m.time, tfMin);

    if (!currentTf || currentTf.time < bucket) {
      // Start new tf bucket
      currentTf = {
        time: bucket,
        open: b1m.open,
        high: b1m.high,
        low:  b1m.low,
        close:b1m.close,
        volume: Number(b1m.volume || 0),
      };
    } else {
      // Extend current tf bucket
      currentTf.high   = Math.max(currentTf.high, b1m.high);
      currentTf.low    = Math.min(currentTf.low,  b1m.low);
      currentTf.close  = b1m.close;
      currentTf.volume = Number(currentTf.volume || 0) + Number(b1m.volume || 0);
    }
    emitTfBar(currentTf);
  };

  function cleanup() {
    try { ws?.close(); } catch {}
    ws = null;
  }

  function scheduleReconnect() {
    if (!alive) return;
    clearTimeout(reconnectTimer);
    // Exponential backoff with cap and jitter
    backoffMs = Math.min(backoffMs * 1.5, 15000);
    const jitter = Math.floor(Math.random() * 300);
    reconnectTimer = setTimeout(connect, backoffMs + jitter);
  }

  function connect() {
    try {
      ws = new WebSocket(POLY_WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      backoffMs = 1000; // reset backoff on success
      // Auth
      ws.send(JSON.stringify({ action: "auth", params: resolvePolygonKey() }));
      // Official 1m bars (RTH) — source of truth
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
      // Trades (all sessions) — we build 1m from ticks when AM is quiet
      ws.send(JSON.stringify({ action: "subscribe", params: `T.${symbol}` }));
    };

    ws.onmessage = (ev) => {
      if (!alive) return;

      let arr;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        const evType = msg?.ev;

        // Status frames — ignore or surface diagnostics if needed
        if (evType === "status") {
          // sseSend(res, { ok:true, type:"diag", status: msg?.message || "status" });
          continue;
        }

        // ---------- AM (official 1m, RTH) ----------
        if (evType === "AM" && msg?.sym === symbol) {
          const am = normalizeAM(msg);
          if (!am) continue;

          lastAmAtMs = Date.now();
          bar1m = null; // reset tick-built bar; AM is now the source of truth

          fold1mIntoTf(am.bar1m);
          continue;
        }

        // ---------- T (trades; all sessions) ----------
        if (evType === "T" && msg?.sym === symbol) {
          // If we've seen an AM within ~2 minutes, skip tick aggregation to avoid double printing
          const amFresh = Date.now() - lastAmAtMs < 120000; // 2 min
          if (amFresh) continue;

          bar1m = applyTickTo1m(bar1m, msg);
          if (!bar1m) continue;

          fold1mIntoTf(bar1m);
          continue;
        }

        // ignore other events
      }
    };

    ws.onerror = () => { cleanup(); scheduleReconnect(); };
    ws.onclose  = () => { cleanup(); scheduleReconnect(); };
  }

  // Keep SSE alive
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  // Kick off WS
  connect();

  // Clean up on client disconnect
  req.on("close", () => {
    alive = false;
    clearTimeout(reconnectTimer);
    clearInterval(ping);
    cleanup();
    try { res.end(); } catch {}
  });
});
