// services/streamer/routes/stream.js
// Option C — Dual feed (AM + T) → SSE
// - AM.<SYM> (official 1m bars, RTH) preferred
// - T.<SYM> (trade ticks, all sessions) aggregated into 1m when AM is quiet
// - Then aggregate 1m → requested tf (minutes) server-side
//
// Emits:
//   data: {"ok":true,"type":"bar","symbol":"SPY","tf":"10m","bar":{time,open,high,low,close,volume}}
//
// Notes:
// - time is UNIX seconds (not ms)
// - no daily streaming (tf >= 1440 rejected, like your current code)

import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ---------- helpers ---------- */
function polyKey() {
  const keys = [process.env.POLYGON_API, process.env.POLYGON_API_KEY, process.env.POLY_API_KEY];
  return keys.find((k) => k && k.trim().length > 0) || "";
}
function tfMinutes(tf = "1m") {
  const t = String(tf || "").toLowerCase();
  if (t === "1d" || t === "d" || t === "day") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function bucketStartSec(sec, tfMin) {
  const size = tfMin * 60;
  return Math.floor(sec / size) * size;
}
function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
const sseSend = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/* ---------- normalization ---------- */
// AM → normalized 1m bar (seconds)
function normalizeAM(msg) {
  // AM payload shape: { ev:"AM", sym:"SPY", s:<startMs>, o,h,l,c, v }
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

// T tick → accumulate into 1m rolling bar (seconds)
function applyTickTo1m(current1m, tick) {
  // Common fields: { ev:"T", sym, p, s, t (ms) }
  const price = Number(tick?.p);
  const size = Number(tick?.s || 0);
  const tMs = Number(tick?.t || 0);
  if (!Number.isFinite(price) || !Number.isFinite(tMs) || tMs <= 0) return current1m;

  const tSec = Math.floor(tMs / 1000);
  const bucketSec = Math.floor(tSec / 60) * 60;

  if (!current1m || current1m.time < bucketSec) {
    // Start a new 1m bar
    return {
      time: bucketSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number(size || 0),
    };
  }

  // Update existing 1m bar
  const b = { ...current1m };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* ---------- GET /stream/agg ---------- */
/* Query:
   - symbol=SPY
   - tf=1m|5m|10m|15m|30m|1h|4h|...  (in minutes; daily blocked)
*/
streamRouter.get("/agg", (req, res) => {
  const apiKey = polyKey();
  if (!apiKey) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr = String(req.query.tf || "1m");
  const tfMin = tfMinutes(tfStr);
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over stream");

  sseHeaders(res);

  let ws;
  let alive = true;
  let reconnectTimer;

  // Rolling state (per request, per symbol)
  // 1m construction from T ticks (used when AM is quiet)
  let lastAmAtMs = 0;       // last time we saw an AM bar (ms)
  let bar1m = null;         // current rolling 1m bar (from T)
  // TF aggregation (from 1m → tf)
  let currentTf = null;     // current tf bucket bar

  // emit a bar (tf bucket) safely
  const emitTfBar = () => {
    if (!currentTf || !Number.isFinite(currentTf.time)) return;
    sseSend(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: currentTf });
  };

  // incorporate a final 1m bar into tf aggregation
  const fold1mIntoTf = (b1m) => {
    const bucket = bucketStartSec(b1m.time, tfMin);

    if (!currentTf || currentTf.time < bucket) {
      // start new tf bucket
      currentTf = {
        time: bucket,
        open: b1m.open,
        high: b1m.high,
        low: b1m.low,
        close: b1m.close,
        volume: Number(b1m.volume || 0),
      };
    } else {
      // extend current bucket
      currentTf.high = Math.max(currentTf.high, b1m.high);
      currentTf.low = Math.min(currentTf.low, b1m.low);
      currentTf.close = b1m.close;
      currentTf.volume = Number(currentTf.volume || 0) + Number(b1m.volume || 0);
    }

    // emit the in-progress tf bar so the UI moves live
    emitTfBar();
  };

  function connect() {
    try {
      ws = new WebSocket("wss://socket.polygon.io/stocks");
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      // auth + dual subscribe
      ws.send(JSON.stringify({ action: "auth", params: apiKey }));
      // Official 1m bars (RTH)
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
      // Raw trades (all sessions) → we aggregate when AM is quiet
      ws.send(JSON.stringify({ action: "subscribe", params: `T.${symbol}` }));
    };

    ws.onmessage = (ev) => {
      if (!alive) return;

      let arr;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        const evType = msg?.ev;

        // Status messages (ignore or send diag if you want)
        if (evType === "status") {
          // sseSend(res, { ok:true, type:"diag", status: msg?.message || "status" });
          continue;
        }

        // ---------- AM (official 1m bar; only during RTH) ----------
        if (evType === "AM" && msg?.sym === symbol) {
          const am = normalizeAM(msg);
          if (!am) continue;

          lastAmAtMs = Date.now();
          bar1m = null; // reset tick-built bar, AM is the source of truth now

          // Fold the official 1m into tf aggregation
          fold1mIntoTf(am.bar1m);
          continue;
        }

        // ---------- T (trade tick; all sessions) ----------
        if (evType === "T" && msg?.sym === symbol) {
          // If AM is "fresh" (seen in last ~2 minutes), skip tick aggregation
          // This avoids double-printing during RTH.
          const amFresh = Date.now() - lastAmAtMs < 120000; // 2 minutes
          if (amFresh) continue;

          // Build/extend a 1m bar from ticks
          bar1m = applyTickTo1m(bar1m, msg);
          if (!bar1m) continue;

          // Fold rolling 1m into tf aggregation (emits live)
          fold1mIntoTf(bar1m);
          continue;
        }

        // ignore other events
      }
    };

    ws.onerror = () => { cleanup(); scheduleReconnect(); };
    ws.onclose  = () => { cleanup(); scheduleReconnect(); };
  }

  function cleanup() { try { ws?.close(); } catch {} ws = null; }
  function scheduleReconnect() {
    if (!alive) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  }
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  // Start WS
  connect();

  req.on("close", () => {
    alive = false;
    clearTimeout(reconnectTimer);
    clearInterval(ping);
    cleanup();
    try { res.end(); } catch {}
  });
});
