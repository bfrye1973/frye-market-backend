// /routes/stream.js — Polygon WS -> SSE (minute aggregates bucketized to selected TF)
// Plan B: if AM message has no usable start time, fallback to NOW (epoch seconds)

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

      let list;
      try { list = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(list)) list = [list];

      for (const msg of list) {
        if (msg?.ev !== "AM" || msg?.sym !== symbol) continue;

        // Try all known fields; fallback to NOW (Plan B)
        let tRaw =
          (msg && (msg.s ?? msg.t ?? msg.start ?? msg.Start ?? msg.S ?? msg.T)) ??
          Math.floor(Date.now() / 1000) * 1000; // ms version of NOW just in case

        let sec = Number(tRaw);
        if (!Number.isFinite(sec)) sec = Math.floor(Date.now() / 1000); // NOW (s)
        else sec = sec > 1e12 ? Math.floor(sec / 1000) : Math.floor(sec); // ms->s or keep s

        if (!(sec > 1e9)) sec = Math.floor(Date.now() / 1000); // final guard: NOW (s)

        const bStart = bucketStartSec(sec, tfMin);

        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        const v = Number(msg.v || 0);

        if (!current || current.time < bStart) {
          current = { time: bStart, open: o, high: h, low: l, close: c, volume: v };
        } else {
          current.high   = Math.max(current.high, h);
          current.low    = Math.min(current.low,  l);
          current.close  = c;
          current.volume = (current.volume || 0) + v;
        }

        // Emit SSE with a VALID epoch-seconds time
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

  // keep-alive
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
