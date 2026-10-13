// /routes/stream.js — Polygon AM stream → SSE (s-only, final 1m bars, TF aggregation)
import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ----------------------- helpers ----------------------- */
function polyKey() {
  // pick first non-empty key
  const keys = [process.env.POLYGON_API, process.env.POLYGON_API_KEY, process.env.POLY_API_KEY];
  return keys.find(k => k && k.trim().length > 0) || "";
}

function tfMinutes(tf = "1m") {
  const t = String(tf || "").toLowerCase();
  if (t === "1d" || t === "d" || t === "day") return 1440;        // daily not streamed
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

/* ----------------------- GET /stream/agg ----------------------- */
/**
 * Query:
 *   symbol: SPY (default)
 *   tf:     1m | 5m | 10m | 15m | 30m | 60m ...
 *
 * Protocol (per Polygon support):
 * - Use AM.<SYMBOL>
 * - Field `s` = bar-start timestamp in **milliseconds**, always present
 * - 1-minute AM bars are final (no partial intra-minute updates)
 * - For TF > 1m, aggregate consecutive 1m closes into the TF bucket
 */
streamRouter.get("/agg", (req, res) => {
  const apiKey = polyKey();
  if (!apiKey) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr  = String(req.query.tf || "1m");
  const tfMin  = tfMinutes(tfStr);
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over stream");

  sseHeaders(res);

  let ws;
  let alive = true;
  let reconnectTimer;

  // Current TF bucket we’re building from 1m closed bars
  // { time, open, high, low, close, volume }
  let current = null;

  function connect() {
    try {
      ws = new WebSocket("wss://socket.polygon.io/stocks");
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      // auth + subscribe AM.<SYMBOL>
      ws.send(JSON.stringify({ action: "auth", params: apiKey }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
    };

    ws.onmessage = (ev) => {
      if (!alive) return;

      let arr;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        // We only care about final 1m aggregates (AM) for our symbol
        if (msg?.ev !== "AM" || msg?.sym !== symbol) continue;

        // --- TIME (required): `s` in milliseconds → seconds
        const startMs = Number(msg.s);
        if (!Number.isFinite(startMs) || startMs <= 0) continue; // never emit without s
        const startSec = Math.floor(startMs / 1000);

        // --- OHLC + V (final 1m bar)
        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        if (![o, h, l, c].every(Number.isFinite)) continue;
        const v = Number(msg.v || 0);
        if (!Number.isFinite(v) || v < 0) continue;

        // --- Bucket alignment
        // 1m close aligns to minute boundary. We aggregate into selected TF bucket.
        const bucket = bucketStartSec(startSec, tfMin);

        if (!current || current.time < bucket) {
          // start a new TF bucket with this closed 1m bar
          current = { time: bucket, open: o, high: h, low: l, close: c, volume: v };
        } else {
          // same TF bucket: extend with the new 1m close
          current.high   = Math.max(current.high, h);
          current.low    = Math.min(current.low,  l);
          current.close  = c;
          current.volume = (current.volume || 0) + v;
        }

        sseSend(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: current });
      }
    };

    ws.onerror = () => { cleanup(); scheduleReconnect(); };
    ws.onclose  = () => { cleanup(); scheduleReconnect(); };
  }

  function cleanup() {
    try { ws?.close(); } catch {}
    ws = null;
  }

  function scheduleReconnect() {
    if (!alive) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  }

  // keep-alive for proxies
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

