// /routes/stream.js — robust time normalization (AM variants)
// Polygon WS -> SSE (minute aggregates bucketized to selected TF)
import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

function polyKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}
const tfMinutes = (tf="1m") => {
  const t = String(tf).toLowerCase();
  if (t === "1d" || t === "d" || t === "day") return 1440;
  if (t.endsWith("h")) return Number(t) * 60;
  if (t.endsWith("m")) return Number(t);
  return 1;
};
const bucketStart = (sec, tfMin) => Math.floor(sec / (tfMin*60)) * (tfMin*60);

// convert any supported field to epoch seconds
function toSecFromAM(msg){
  // prefer start time in ms (s), otherwise t (ms), otherwise start (sec or ms)
  let raw =
    (msg && msg.s) ??
    (msg && msg.t) ??
    (msg && (msg.start || msg.Start || msg.S || msg.T)) ??
    null;

  if (raw == null) return NaN;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  // if looks like milliseconds, convert; if already seconds, leave as is
  return n > 1e12 ? Math.floor(n / 1000) : (n > 1e9 ? Math.floor(n) : NaN);
}

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
const send = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

streamRouter.get("/agg", (req, res) => {
  const key = polyKey();
  if (!key) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr  = String(req.query.tf || "1m");
  const tfMin  = tfMinutes(tfStr);
  if (tfMin >= 1440) return res.status(400).end("Daily not supported");

  sseHeaders(res);

  let ws, alive = true, reconnectTimer;
  let current = null;

  const connect = () => {
    try { ws = new WebSocket("wss://socket.polygon.io/stocks"); }
    catch { schedule(); return; }

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "auth", params: key }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
    };

    ws.onmessage = (ev) => {
      if (!alive) return;
      let arr; try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const m of arr) {
        if (m?.ev !== "AM" || m?.sym !== symbol) continue;

        const startSec = toSecFromAM(m);
        if (!Number.isFinite(startSec) || startSec <= 0) continue;

        const o = Number(m.o), h = Number(m.h), l = Number(m.l), c = Number(m.c);
        const v = Number(m.v || 0);
        const bStart = bucketStart(startSec, tfMin);

        if (!current || current.time < bStart) {
          current = { time: bStart, open: o, high: h, low: l, close: c, volume: v };
        } else {
          current.high   = Math.max(current.high, h);
          current.low    = Math.min(current.low,  l);
          current.close  = c;
          current.volume = (current.volume || 0) + v;
        }

        send(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: current });
      }
    };

    ws.onerror = () => { cleanup(); schedule(); };
    ws.onclose  = () => { cleanup(); schedule(); };
  };

  const cleanup = () => { try { ws?.close(); } catch{} ws=null; };
  const schedule = () => { if (!alive) return; clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1500); };

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
