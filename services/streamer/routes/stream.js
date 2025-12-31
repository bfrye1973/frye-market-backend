// services/streamer/routes/stream.js
// Polygon WS → SSE with REQUIRED snapshot seeding + RTH/ETH bucketing

import express from "express";
import WebSocket from "ws";
import { DateTime } from "luxon";

const router = express.Router();
export default router;

const POLY_WS_URL = "wss://socket.polygon.io/stocks";
const HIST_BASE =
  process.env.HIST_BASE ||
  process.env.BACKEND1_BASE ||
  "https://frye-market-backend-1.onrender.com";

/* ---------------- helpers ---------------- */

function resolvePolygonKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function normalizeTf(tf) {
  const t = String(tf || "10m").toLowerCase();
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t === "1d") return 1440;
  return 10;
}

function labelTf(tfMin) {
  return tfMin >= 1440 ? "1d" : tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;
}

function normalizeMode(m) {
  return m === "eth" ? "eth" : "rth";
}

function toUnixSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return Math.floor(n / 1000);
  if (n > 1e10) return Math.floor(n / 1000);
  return Math.floor(n);
}

/* ---------------- RTH ---------------- */

const NY = "America/New_York";

function nyAnchors(sec) {
  const d = DateTime.fromSeconds(sec, { zone: NY }).startOf("day");
  const open = d.plus({ hours: 9, minutes: 30 });
  const close = d.plus({ hours: 16 });
  return {
    open: Math.floor(open.toSeconds()),
    close: Math.floor(close.toSeconds()),
    day: Math.floor(d.toSeconds()),
  };
}

function bucketStart(sec, tfMin, mode) {
  if (tfMin >= 1440) return nyAnchors(sec).day;
  const size = tfMin * 60;

  if (mode === "eth") {
    return Math.floor(sec / size) * size;
  }

  const { open, close } = nyAnchors(sec);
  if (sec < open || sec >= close) return null;
  return open + Math.floor((sec - open) / size) * size;
}

/* ---------------- cache ---------------- */

const cache = new Map(); // key = symbol|mode|tfMin

function ckey(sym, mode, tf) {
  return `${sym}|${mode}|${tf}`;
}

function pushBar(arr, bar, max = 2000) {
  if (!arr.length || bar.time > arr[arr.length - 1].time) {
    arr.push(bar);
  } else if (bar.time === arr[arr.length - 1].time) {
    arr[arr.length - 1] = bar;
  }
  if (arr.length > max) arr.splice(0, arr.length - max);
}

/* ---------------- backend-1 seed ---------------- */

async function fetch1m(symbol, limit) {
  const url =
    `${HIST_BASE}/api/v1/ohlc?symbol=${symbol}` +
    `&timeframe=1m&limit=${limit}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return [];

  const j = await r.json();

  // backend-1 may return array OR { bars: [...] }
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.bars)) return j.bars;

  return [];
}


function buildFrom1m(tfMin, mode, bars1m, limit) {
  const out = [];
  let cur = null;

  for (const b of bars1m) {
    const sec = toUnixSec(b.time);
    if (!sec) continue;

    const bucket = bucketStart(sec, tfMin, mode);
    if (bucket === null) continue;

    if (!cur || cur.time < bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }

  if (cur) out.push(cur);
  return out.slice(-limit);
}

/* ---------------- snapshot ---------------- */

router.get("/snapshot", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf);
  const tf = labelTf(tfMin);
  const mode = normalizeMode(req.query.mode);
  const limit = Number(req.query.limit || 1500);

  const key = ckey(symbol, mode, tfMin);
  if (cache.has(key)) {
    return res.json({ ok: true, type: "snapshot", symbol, tf, mode, bars: cache.get(key) });
  }

  const raw = await fetch1m(symbol, 5000);
  const bars = buildFrom1m(tfMin, mode, raw, limit);
  cache.set(key, bars);

  res.json({ ok: true, type: "snapshot", symbol, tf, mode, bars });
});

/* ---------------- SSE /stream/agg ---------------- */

router.get("/agg", async (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("No Polygon key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf);
  const tf = labelTf(tfMin);
  const mode = normalizeMode(req.query.mode);
  const key = ckey(symbol, mode, tfMin);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");

  // SEED SNAPSHOT ALWAYS
  if (!cache.has(key)) {
    const raw = await fetch1m(symbol, 5000);
    cache.set(key, buildFrom1m(tfMin, mode, raw, 1500));
  }

  res.write(`data: ${JSON.stringify({
    ok: true,
    type: "snapshot",
    symbol,
    tf,
    mode,
    bars: cache.get(key),
  })}\n\n`);

  let lastEmit = 0;

  function emit(bar) {
    const now = Date.now();
    if (now - lastEmit < 1000) return;
    lastEmit = now;
    res.write(`data: ${JSON.stringify({ ok: true, type: "bar", symbol, tf, mode, bar })}\n\n`);
  }

  const ws = new WebSocket(POLY_WS_URL);

  ws.on("open", () => {
    ws.send(JSON.stringify({ action: "auth", params: apiKey }));
    ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol}` }));
  });

  ws.on("message", (buf) => {
    const msgs = JSON.parse(buf.toString());
    for (const m of msgs) {
      if (m.ev !== "AM") continue;
      if (m.sym !== symbol) continue;

      const sec = toUnixSec(m.s);
      if (!sec) continue;

      const minute = Math.floor(sec / 60) * 60;
      const bucket = bucketStart(minute, tfMin, mode);
      if (bucket === null) continue;

      const arr = cache.get(key);
      const bar = {
        time: bucket,
        open: m.o,
        high: m.h,
        low: m.l,
        close: m.c,
        volume: m.v || 0,
      };
      pushBar(arr, bar);
      emit(bar);
    }
  });

  const ping = setInterval(() => res.write(`:ping ${Date.now()}\n\n`), 15000);

  req.on("close", () => {
    clearInterval(ping);
    try { ws.close(); } catch {}
  });
});
