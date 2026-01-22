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

const NY_ZONE = "America/New_York";

/* -------------------- helpers -------------------- */

function resolvePolygonKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function normalizeMode(m) {
  const s = String(m || "rth").toLowerCase().trim();
  return s === "eth" ? "eth" : "rth";
}

function normalizeTfStr(tf) {
  const t = String(tf || "10m").toLowerCase().trim();
  if (t === "1d") return "1d";
  if (t.endsWith("m")) return t;
  if (t.endsWith("h")) return t;
  return "10m";
}

function normalizeTfMin(tf) {
  const t = normalizeTfStr(tf);
  if (t === "1d") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  return 10;
}

function labelTf(tfMin) {
  return tfMin >= 1440 ? "1d" : tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;
}

function toUnixSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
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

/* -------------------- RTH bucketing -------------------- */

function nyAnchors(unixSec) {
  const ny = DateTime.fromSeconds(unixSec, { zone: NY_ZONE });
  const dayStart = ny.startOf("day");
  const open = dayStart.plus({ hours: 9, minutes: 30 });
  const close = dayStart.plus({ hours: 16, minutes: 0 });
  return {
    dayStartSec: Math.floor(dayStart.toSeconds()),
    openSec: Math.floor(open.toSeconds()),
    closeSec: Math.floor(close.toSeconds()),
  };
}

function bucketStartSecRth(unixSec, tfMin) {
  const { dayStartSec, openSec, closeSec } = nyAnchors(unixSec);
  if (tfMin >= 1440) return dayStartSec;
  if (unixSec < openSec || unixSec >= closeSec) return null;
  const size = tfMin * 60;
  const idx = Math.floor((unixSec - openSec) / size);
  const bucket = openSec + idx * size;
  if (bucket >= closeSec) return null;
  return bucket;
}

function bucketStartSecEth(unixSec, tfMin) {
  if (tfMin >= 1440) {
    const { dayStartSec } = nyAnchors(unixSec);
    return dayStartSec;
  }
  const size = tfMin * 60;
  return Math.floor(unixSec / size) * size;
}

function bucketStartSecByMode(unixSec, tfMin, mode) {
  return mode === "eth" ? bucketStartSecEth(unixSec, tfMin) : bucketStartSecRth(unixSec, tfMin);
}

/* -------------------- backend-1 fetch (native timeframe) -------------------- */

async function fetchTfFromBackend1(symbol, tfStr, limit) {
  const base = String(HIST_BASE || "").replace(/\/+$/, "");
  const url =
    `${base}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(tfStr)}` +
    `&limit=${encodeURIComponent(limit)}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.bars)) return j.bars;
  return [];
}

function normBar(b) {
  const t = toUnixSec(b?.time ?? b?.t ?? b?.ts ?? b?.timestamp);
  const o = Number(b?.open ?? b?.o);
  const h = Number(b?.high ?? b?.h);
  const l = Number(b?.low ?? b?.l);
  const c = Number(b?.close ?? b?.c);
  const v = Number(b?.volume ?? b?.v ?? 0);
  if (![t, o, h, l, c].every(Number.isFinite)) return null;
  return { time: t, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 };
}

/* -------------------- Tick -> 1m builder -------------------- */

function applyTickTo1m(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec) || tSec <= 0) return cur;
  const minuteSec = Math.floor(tSec / 60) * 60;

  if (!cur || cur.time < minuteSec) {
    return { time: minuteSec, open: price, high: price, low: price, close: price, volume: Number.isFinite(size) ? size : 0 };
  }
  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

function parseAM(msg) {
  const sMs = Number(msg?.s);
  const o = Number(msg?.o), h = Number(msg?.h), l = Number(msg?.l), c = Number(msg?.c);
  const v = Number(msg?.v ?? 0);
  const tSec = toUnixSec(sMs);
  if (![o, h, l, c].every(Number.isFinite) || !Number.isFinite(tSec)) return null;
  const minuteSec = Math.floor(tSec / 60) * 60;
  return { time: minuteSec, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 };
}

/* -------------------- live aggregator: 1m -> requested tf -------------------- */

function updateAggFrom1m(lastAgg, bar1m, tfMin, mode) {
  const bucket = bucketStartSecByMode(bar1m.time, tfMin, mode);
  if (bucket === null) return { agg: lastAgg, changed: false };

  if (tfMin === 1) return { agg: bar1m, changed: true };

  if (!lastAgg || lastAgg.time < bucket) {
    return {
      agg: {
        time: bucket,
        open: bar1m.open,
        high: bar1m.high,
        low: bar1m.low,
        close: bar1m.close,
        volume: Number(bar1m.volume || 0),
      },
      changed: true,
    };
  }

  if (lastAgg.time === bucket) {
    const upd = { ...lastAgg };
    upd.high = Math.max(upd.high, bar1m.high);
    upd.low = Math.min(upd.low, bar1m.low);
    upd.close = bar1m.close;
    upd.volume = Number(upd.volume || 0) + Number(bar1m.volume || 0);
    return { agg: upd, changed: true };
  }

  return { agg: lastAgg, changed: false };
}

/* -------------------- health -------------------- */

router.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "streamer" });
});

/* -------------------- /stream/agg -------------------- */

router.get("/agg", async (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfStr = normalizeTfStr(req.query.tf || "10m");
  const tfMin = normalizeTfMin(tfStr);
  const tf = labelTf(tfMin);

  // You want RTH
  const mode = "rth";

  sseHeaders(res);

  // ✅ TradingView-style history: fetch native timeframe directly
  // Limits tuned to your request
  const limitByTf = (() => {
    if (tfStr === "10m") return 2000; // ~1 month+
    if (tfStr === "30m") return 2500; // ~2 months+
    if (tfStr === "1h") return 4000;  // ~6+ months
    if (tfStr === "4h") return 4000;  // ~1+ year
    if (tfStr === "1d") return 5000;  // years
    if (tfStr === "1m") return 5000;  // keep 1m reasonable
    return 2000;
  })();

  let snapshotBars = [];
  try {
    const raw = await fetchTfFromBackend1(symbol, tfStr, limitByTf);
    snapshotBars = raw.map(normBar).filter(Boolean).sort((a, b) => a.time - b.time);
  } catch {
    snapshotBars = [];
  }

  sseSend(res, { ok: true, type: "snapshot", symbol, tf, mode, bars: snapshotBars });

  let alive = true;
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  const diag = {
    startedAt: new Date().toISOString(),
    symbol, tf, tfMin, mode,
    wsOpen: 0,
    wsClose: 0,
    wsError: 0,
    status: [],
    amSeen: 0,
    tSeen: 0,
    barsEmitted: 0,
  };

  const diagTimer = setInterval(() => {
    if (!alive) return;
    sseSend(res, { ok: true, type: "diag", diag });
  }, 5000);

  // throttle a bit
  let lastEmitAt = 0;
  function emitBar(bar) {
    const now = Date.now();
    if (now - lastEmitAt < 250) return;
    lastEmitAt = now;
    diag.barsEmitted += 1;
    sseSend(res, { ok: true, type: "bar", symbol, tf, mode, bar });
  }

  const ws = new WebSocket(POLY_WS_URL);
  let tick1m = null;
  let aggBar = null;

  ws.on("open", () => {
    diag.wsOpen += 1;
    ws.send(JSON.stringify({ action: "auth", params: apiKey }));
    ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol},T.${symbol}` }));
  });

  ws.on("message", (buf) => {
    let arr;
    try { arr = JSON.parse(buf.toString("utf8")); } catch { return; }
    if (!Array.isArray(arr)) arr = [arr];

    for (const msg of arr) {
      const ev = msg?.ev;

      if (ev === "status") {
        const line = `${msg?.status || ""} ${msg?.message || ""}`.trim();
        diag.status.push(line);
        if (diag.status.length > 10) diag.status.shift();
        continue;
      }

      if (ev === "AM" && String(msg?.sym || "").toUpperCase() === symbol) {
        diag.amSeen += 1;
        const bar1m = parseAM(msg);
        if (!bar1m) continue;

        // If user asked 1m, emit directly; else aggregate from 1m into requested tf
        const { agg, changed } = updateAggFrom1m(aggBar, bar1m, tfMin, mode);
        aggBar = agg;
        if (changed && aggBar) emitBar(aggBar);

        tick1m = null;
        continue;
      }

      if (ev === "T" && String(msg?.sym || "").toUpperCase() === symbol) {
        diag.tSeen += 1;

        // Fold trades into 1m
        tick1m = applyTickTo1m(tick1m, msg);
        if (!tick1m) continue;

        const { agg, changed } = updateAggFrom1m(aggBar, tick1m, tfMin, mode);
        aggBar = agg;
        if (changed && aggBar) emitBar(aggBar);
      }
    }
  });

  ws.on("error", () => { diag.wsError += 1; });
  ws.on("close", () => { diag.wsClose += 1; });

  req.on("close", () => {
    alive = false;
    clearInterval(ping);
    clearInterval(diagTimer);
    try { ws.close(); } catch {}
    try { res.end(); } catch {}
  });
});
