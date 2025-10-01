// routes/stream.js — Polygon WS → SSE relay (minute aggregates -> timeframe buckets)
import express from "express";
import { WebSocket } from "ws";

export const streamRouter = express.Router();

function getKey() {
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

// floor a seconds-epoch to the start of its bucket (tf minutes)
function bucketStartSec(sec, tfMin) {
  const size = tfMin * 60;
  return Math.floor(sec / size) * size;
}

// SSE headers
function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

// write SSE event
function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

streamRouter.get("/agg", async (req, res) => {
  const key = getKey();
  if (!key) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tf = String(req.query.tf || "1m");
  const tfMin = tfMinutes(tf);

  // daily is not streamed; politely refuse
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over stream");

  sseHeaders(res);
  let ws;
  let alive = true;
  let reconnectTimer;

  // keep latest bucket state in memory
  let current = null; // { time, open, high, low, close, volume }

  function start() {
    try {
      ws = new WebSocket("wss://socket.polygon.io/stocks");
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      // auth + subscribe minute aggregates
      ws.send(JSON.stringify({ action: "auth", params: key }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
    };

    ws.onmessage = (ev) => {
      if (!alive) return;
      let arr;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        // Polygon AM payload fields:
        // ev:"AM", sym:"SPY", o,h,l,c,v, s:startTime(ms), e:endTime(ms)
        if (msg?.ev !== "AM" || msg?.sym !== symbol) continue;

        const sec = Math.floor(Number(msg.s || 0) / 1000);
        if (!sec) continue;

        const bucketStart = bucketStartSec(sec, tfMin);
        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        const v = Number(msg.v || 0);

        if (!current || current.time < bucketStart) {
          // roll to a new bucket
          current = { time: bucketStart, open: o, high: h, low: l, close: c, volume: v };
        } else {
          // update current bucket
          current.high   = Math.max(current.high, h);
          current.low    = Math.min(current.low,  l);
          current.close  = c;
          current.volume = (current.volume || 0) + v;
        }
        // emit SSE
        sseSend(res, { ok: true, type: "bar", symbol, tf, bar: current });
      }
    };

    ws.onerror = () => {
      cleanup();
      scheduleReconnect();
    };

    ws.onclose = () => {
      cleanup();
      scheduleReconnect();
    };
  }

  function cleanup() {
    try { ws?.close(); } catch {}
    ws = null;
  }

  function scheduleReconnect() {
    if (!alive) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(start, 1500);
  }

  // heartbeat so Render/clients keep the connection open
  const ping = setInterval(() => {
    if (!alive) return;
    res.write(":ping\n\n");
  }, 15000);

  // start
  start();

  // client disconnect
  req.on("close", () => {
    alive = false;
    clearTimeout(reconnectTimer);
    clearInterval(ping);
    cleanup();
    try { res.end(); } catch {}
  });
});
