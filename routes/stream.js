// /routes/stream.js — Polygon WS -> SSE (minute aggregates bucketized to selected TF)
// Uses AM.s (start time) as the canonical bar start; ms → seconds.

import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ---------- helpers ---------- */
function polyKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}
function tfMinutes(tf = "1m") {
  const t = String(tf || "").toLowerCase();
  if (t === "1d" || t === "d" || t === "day") return 1440;
  if (t.endsWith("h")) return Number(t) * 60;
  if (t.endsWith("m")) return Number(t);
  return 1;
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
  const tfStr  = String(req.query.tf || "1m");
  const tfMin  = tfMinutes(tfStr);
  if (tfMin >= 1440) return res.status(400).end("Daily not supported");

  sseHeaders(res);

  let ws;
  let alive = true;
  let reconnectTimer;
  let current = null; // { time, open, high, low, close, volume }

  function connect() {
    try { ws = new WebSocket("wss://socket.polygon.io/stocks"); }
    catch { scheduleReconnect(); return; }

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
        // Expect AM aggregate payload with 's' = start time (ms)
        if (msg?.ev !== "AM" || msg?.sym !== symbol) continue;

        // s is ALWAYS present per Polygon; if not numeric, skip packet.
        const startMs = Number(msg.s);
        if (!Number.isFinite(startMs) || startMs <= 0) continue;

        const startSec = Math.floor(startMs / 1000); // ms → s
        const open  = Number(msg.o);
        const high  = Number(msg.h);
        const low   = Number(msg.l);
        const close = Number(msg.c);
        const vol   = Number(msg.v || 0);

        // Basic validation
        if (![open, high, low, close].every(Number.isFinite)) continue;

        const bStart = bucketStartSec(startSec, tfMin);

        if (!current || current.time < bStart) {
          current = { time: bStart, open, high, low, close, volume: vol };
        } else {
          current.high   = Math.max(current.high, high);
          current.low    = Math.min(current.low,  low);
          current.close  = close;
          current.volume = (current.volume || 0) + vol;
        }

        // Emit SSE with a VALID epoch-seconds time
        sseSend(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: current });
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

  // keep-alive pings
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
