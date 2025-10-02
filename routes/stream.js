// /routes/stream.js — DIAG BUILD (temporary)
// Emits {type:"diag"} lines so we can see Polygon auth/subscription and AM packets.
// After diagnosis, we’ll switch back to the clean build.

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

const send = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
const diag = (res, msg, extra = {}) => send(res, { ok: true, type: "diag", msg, ...extra });

/* ---------- GET /stream/agg?symbol=SPY&tf=10m ---------- */
streamRouter.get("/agg", (req, res) => {
  const key = polyKey();
  if (!key) return res.status(500).end("Missing POLYGON_API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr  = String(req.query.tf || "1m");
  const tfMin  = tfMinutes(tfStr);
  if (tfMin >= 1440) return res.status(400).end("Daily not supported over stream");

  sseHeaders(res);
  diag(res, "route-mounted", { symbol, tf: tfStr });

  let ws;
  let alive = true;
  let reconnectTimer;

  // Current TF bucket we're building
  let currentBucket = null;

  // Track last seen cumulative volume per minute for delta calc
  const minuteVol = new Map(); // minuteStartSec -> last cumulative v

  function connect() {
    try {
      ws = new WebSocket("wss://socket.polygon.io/stocks");
      diag(res, "ws-connecting");
    } catch (e) {
      diag(res, "ws-connect-throw", { error: String(e) });
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      diag(res, "ws-open");
      ws.send(JSON.stringify({ action: "auth", params: key }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
      diag(res, "ws-sent-auth-sub", { subscribe: `AM.${symbol}` });
    };

    ws.onmessage = (ev) => {
      if (!alive) return;

      let arr;
      try { arr = JSON.parse(ev.data); } catch (e) {
        diag(res, "ws-json-parse-fail", { error: String(e) });
        return;
      }
      if (!Array.isArray(arr)) arr = [arr];

      // Surface Polygon status frames (auth, subscribe results)
      for (const msg of arr) {
        if (msg?.ev === "status") {
          diag(res, "status", { status: msg.status || null, message: msg.message || null });
        }
      }

      // Process AM aggregates
      for (const msg of arr) {
        if (msg?.ev !== "AM") continue;

        if (msg?.sym !== symbol) {
          diag(res, "am-other-symbol", { got: msg.sym, want: symbol });
          continue;
        }

        const startMs = Number(msg.s);
        if (!Number.isFinite(startMs) || startMs <= 0) {
          diag(res, "am-missing-s", { s: msg.s });
          continue;
        }

        const startSec = Math.floor(startMs / 1000);
        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        if (![o, h, l, c].every(Number.isFinite)) {
          diag(res, "am-bad-ohlc", { o: msg.o, h: msg.h, l: msg.l, c: msg.c });
          continue;
        }

        const vCum = Number(msg.v || 0);
        if (!Number.isFinite(vCum) || vCum < 0) {
          diag(res, "am-bad-volume", { v: msg.v });
          continue;
        }

        const minuteStart = bucketStartSec(startSec, 1);
        const bucketStart = bucketStartSec(startSec, tfMin);

        const prevCum = minuteVol.get(minuteStart) ?? 0;
        const deltaV = Math.max(0, vCum - prevCum);
        minuteVol.set(minuteStart, vCum);

        if (!currentBucket || currentBucket.time < bucketStart) {
          currentBucket = { time: bucketStart, open: o, high: h, low: l, close: c, volume: deltaV };
        } else {
          currentBucket.high  = Math.max(currentBucket.high, h);
          currentBucket.low   = Math.min(currentBucket.low,  l);
          currentBucket.close = c;
          currentBucket.volume = (currentBucket.volume || 0
