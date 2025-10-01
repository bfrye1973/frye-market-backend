// /src/routes/stream.js
// Polygon WS -> SSE relay (minute aggregates bucketized to selected TF)
import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ---------------- helpers ---------------- */
function getPolyKey() {
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
  const size = tfMin * 60;             // seconds per bucket
  return Math.floor(sec / size) * size; // floor to bucket start
}

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/* --------------- GET /stream/agg?symbol=SPY&tf=10m ---------------- */
streamRouter.get("/agg", (req, res) => {
  const key = getPolyKey();
  if (!key) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr = String(req.query.tf || "1m");
  const tfMin = tfMinutes(tfStr);

  // don't stream daily
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over stream");

  sseHeaders(res);

  let ws;
  let alive = true;
  let reconnectTimer;
  let current = null; // current bucket { time, open, high, low, close, volume }

  function connect() {
    try {
      ws = new WebSocket("wss://socket.polygon.io/stocks");
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "auth", params: key }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` })); // 1-min aggregates
    };

    ws.onmessage = (ev) => {
      if (!alive) return;
      let arr;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        // AM payload: { ev:"AM", sym:"SPY", o,h,l,c,v, s(start ms), e(end ms) }
        if (msg?.ev !== "AM" || msg?.sym !== symbol) continue;

        const startSec = Math.floor(Number(msg.s || 0) / 1000); // ms -> s
        if (!startSec) continue;

        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        const v = Number(msg.v || 0);
        const bStart = bucketStartSec(startSec, tfMin);

        if (!current || current.time < bStart) {
          current = { time: bStart, open: o, high: h, low: l, close: c, volume: v };
        } else {
          current.high   = Math.max(current.high, h);
          current.low    = Math.min(current.low,  l);
          current.close  = c;
          current.volume = (current.volume || 0) + v;
        }

        // emit bar with valid seconds timestamp
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

  // keep-alive pings so proxies don’t close us
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
