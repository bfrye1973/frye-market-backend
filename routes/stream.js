// /routes/stream.js — Polygon WS -> SSE (minute aggregates bucketized to selected TF)
// Canonical time: AM.s (ms) -> seconds -> bucket-aligned. Per-minute volume handled as delta.

import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ---------- helpers ---------- */
function polyKey() {
  // FIX: skip empty values so we don’t pick up POLYGON_API = '' 
  const keys = [
    process.env.POLYGON_API,
    process.env.POLYGON_API_KEY,
    process.env.POLY_API_KEY,
  ];
  return keys.find(k => k && k.trim().length > 0) || "";
}

function tfMinutes(tf = "1m") {
  const t = String(tf || "").toLowerCase();
  if (t === "1d" || t === "d" || t === "day") return 1440; // daily not streamed
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

/**
 * Aggregation model
 * - We receive AM.<SYMBOL> minute aggregates (many updates per minute).
 * - msg.v is CUMULATIVE volume for that minute. We must add only the DELTA since the last update for that same minute.
 * - For TF > 1m, we combine multiple minutes into a bucket:
 *   open  = first minute’s open of the bucket
 *   high  = max of minute highs seen
 *   low   = min of minute lows seen
 *   close = last minute’s close seen
 *   volume= sum of minute volumes (via per-minute delta)
 */
streamRouter.get("/agg", (req, res) => {
  const key = polyKey();
  if (!key) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr  = String(req.query.tf || "1m");
  const tfMin  = tfMinutes(tfStr);
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over stream");

  sseHeaders(res);

  let ws;
  let alive = true;
  let reconnectTimer;

  // Current TF bucket we're building: { time, open, high, low, close, volume }
  let currentBucket = null;

  // Track last seen cumulative volume for each minute so we can compute deltas safely
  const minuteVol = new Map();

  function connect() {
    try {
      ws = new WebSocket("wss://socket.polygon.io/stocks");
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      // Auth then subscribe to minute aggregates for the symbol
      ws.send(JSON.stringify({ action: "auth", params: key }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
    };

    ws.onmessage = (ev) => {
      if (!alive) return;

      let arr;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        if (msg?.ev !== "AM" || msg?.sym !== symbol) continue;

        // Canonical start time (ms -> s)
        const startMs = Number(msg.s);
        if (!Number.isFinite(startMs) || startMs <= 0) continue;
        const startSec = Math.floor(startMs / 1000);

        // Polygon OHLC for THIS MINUTE
        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        if (![o, h, l, c].every(Number.isFinite)) continue;

        // Minute cumulative volume so far
        const vCum = Number(msg.v || 0);
        if (!Number.isFinite(vCum) || vCum < 0) continue;

        // Compute minute's bucket start (always 1m) and TF bucket start
        const minuteStart = bucketStartSec(startSec, 1);
        const bucketStart = bucketStartSec(startSec, tfMin);

        // Compute delta volume for this minute since we last saw it
        const prevCum = minuteVol.get(minuteStart) ?? 0;
        const deltaV = Math.max(0, vCum - prevCum);
        minuteVol.set(minuteStart, vCum);

        // If the TF bucket rolled over, start a new bucket
        if (!currentBucket || currentBucket.time < bucketStart) {
          currentBucket = {
            time: bucketStart,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: deltaV
          };
        } else {
          // Same bucket → update OHLC
          currentBucket.high  = Math.max(currentBucket.high, h);
          currentBucket.low   = Math.min(currentBucket.low,  l);
          currentBucket.close = c;
          currentBucket.volume = (currentBucket.volume || 0) + deltaV;
        }

        // Emit valid SSE payload
        sseSend(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: currentBucket });
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

  // keep-alive pings for proxies
  const ping = setInterval(() => alive && res.write(":ping\n\n"), 15000);

  connect();

  req.on("close", () => {
    alive = false;
    clearTimeout(reconnectTimer);
    clearInterval(ping);
    cleanup();
    try { res.end(); } catch {}
  });
});
