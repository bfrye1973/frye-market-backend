// /routes/stream.js — DIAG + robust timestamp handling + safe volume delta
import express from "express";
import { WebSocket } from "ws";

const streamRouter = express.Router();
export default streamRouter;

/* ---------- helpers ---------- */
function polyKey() {
  // Skip empty envs and pick the first non-empty
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

  let currentBucket = null;    // { time, open, high, low, close, volume }
  const minuteVol = new Map(); // minuteStartSec -> last cumulative v
  let sampled = false;         // send one-time snapshot if time fields look odd

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

      // status frames show auth/sub results
      for (const msg of arr) {
        if (msg?.ev === "status") {
          diag(res, "status", { status: msg.status || null, message: msg.message || null });
        }
      }

      // AM frames → build bars
      for (const msg of arr) {
        if (msg?.ev !== "AM") continue;
        if (msg?.sym !== symbol) { diag(res, "am-other-symbol", { got: msg.sym, want: symbol }); continue; }

        // ------- robust timestamp extraction -------
        // Prefer msg.s (bar start ms). If missing, fallback to msg.t.
        // Normalize seconds→ms when value looks like seconds (< 1e12).
        let raw = (msg?.s ?? msg?.t ?? null);
        let startMs = Number(raw);
        if (Number.isFinite(startMs) && startMs > 0 && startMs < 1e12) startMs *= 1000;
        if (!Number.isFinite(startMs) || startMs <= 0) {
          if (!sampled) {
            sampled = true;
            diag(res, "am-snapshot-bad-time", {
              keys: Object.keys(msg || {}),
              s: msg?.s ?? null, t: msg?.t ?? null,
              typeof_s: typeof msg?.s, typeof_t: typeof msg?.t
            });
          }
          continue; // never emit a bar with bad time (prevents time:null)
        }
        const startSec = Math.floor(startMs / 1000);

        // ------- OHLC & volume (delta) -------
        const o = Number(msg.o), h = Number(msg.h), l = Number(msg.l), c = Number(msg.c);
        if (![o,h,l,c].every(Number.isFinite)) {
          if (!sampled) { sampled = true; diag(res, "am-bad-ohlc", { o: msg.o, h: msg.h, l: msg.l, c: msg.c }); }
          continue;
        }
        const vCum = Number(msg.v || 0);
        if (!Number.isFinite(vCum) || vCum < 0) {
          if (!sampled) { sampled = true; diag(res, "am-bad-volume", { v: msg.v }); }
          continue;
        }

        const minuteStart = bucketStartSec(startSec, 1);
        const bucketStart = bucketStartSec(startSec, tfMin);

        // per-minute delta: msg.v is cumulative within that minute
        const prevCum = minuteVol.get(minuteStart) ?? 0;
        const deltaV  = Math.max(0, vCum - prevCum);
        minuteVol.set(minuteStart, vCum);

        if (!currentBucket || currentBucket.time < bucketStart) {
          currentBucket = { time: bucketStart, open: o, high: h, low: l, close: c, volume: deltaV };
        } else {
          currentBucket.high   = Math.max(currentBucket.high, h);
          currentBucket.low    = Math.min(currentBucket.low,  l);
          currentBucket.close  = c;
          currentBucket.volume = (currentBucket.volume || 0) + deltaV;
        }

        send(res, { ok: true, type: "bar", symbol, tf: tfStr, bar: currentBucket });
      }
    };

    ws.onerror = (e) => { diag(res, "ws-error", { error: String(e?.message || e) }); cleanup(); scheduleReconnect(); };
    ws.onclose  = (e) => { diag(res, "ws-close", { code: e?.code, reason: e?.reason }); cleanup(); scheduleReconnect(); };
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
