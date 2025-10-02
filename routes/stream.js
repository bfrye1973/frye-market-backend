// /routes/stream.js — Polygon WS -> SSE (minute aggregates bucketized to selected TF)
// Canonical time: AM.s (ms) -> seconds -> bucket-aligned. Per-minute volume handled as delta.

import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ---------- helpers ---------- */
function polyKey() {
  const keys = [
    process.env.POLYGON_API,
    process.env.POLYGON_API_KEY,
    process.env.POLY_API_KEY,
  ];
  return keys.find(k => k && k.trim().length > 0) || "";
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

/* ---------- GET /stream/agg?symbol=SPY&tf=10m ---------- */
streamRouter.get("/agg", (req, res) => {
  const key = polyKey();
  if (!key) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr = String(req.query.tf || "1m");
  const tfMin = tfMinutes(tfStr);
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over stream");

  sseHeaders(res);

  let ws;
  let alive = true;
  let reconnectTimer;

  let currentBucket = null;
  const minuteVol = new Map();

  function connect() {
    try {
      ws = new WebSocket("wss://socket.polygon.io/stocks");
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
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

        const startMs = Number(msg.s);
        if (!Number.isFinite(startMs) || startMs <= 0) continue;
        const startSec = Math.floor(startMs / 1000);

        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        if (![o, h, l, c].every(Number.isFinite)) continue;

        const vCum = Number(msg.v || 0);
        if (!Number.isFinite(vCum) || vCum < 0) continue;

        const minuteStart = bucketStartSec(startSec, 1);
        const bucketStart = bucketStartSec(startSec, tfMin);

        const prevCum = minuteVol.get(minuteStart) ?? 0;
        const deltaV = Math.max(0, vCum - prevCum);
        minuteVol.set(minuteStart, vCum);

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
          currentBucket.high = Math.max(currentBucket.high, h);
          currentBucket.low = Math.min(currentBucket.low, l);
          currentBucket.close = c;
          currentBucket.volume = (currentBucket.volume || 0) + deltaV;
        }

        sseSend(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: currentBucket });
      }
    };

    ws.onerror = () => { cleanup(); scheduleReconnect(); };
    ws.onclose = () => { cleanup(); scheduleReconnect(); };
  }

  function cleanup() { try { ws?.close(); } catch {} ws = null; }
  function scheduleReconnect() {
    if (!alive) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  }

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
