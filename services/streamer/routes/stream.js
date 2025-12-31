// services/streamer/routes/stream.js
// Polygon WS -> SSE
// - Seeds snapshot from backend-1 (always non-empty if REST works)
// - Builds 1m bars from AM (if available) OR from T ticks (trade fallback)
// - Emits SSE: {type:"bar", bar:{time,open,high,low,close,volume}}
// - Supports tf query (1m/5m/10m/30m/1h/4h/1d) by aggregating from 1m
// - mode=rth|eth (RTH uses NY 9:30-16:00 anchor; ETH uses continuous buckets)

import express from "express";
import WebSocket from "ws";
import { DateTime } from "luxon";

const router = express.Router();
export default router;

const POLY_WS_URL = "wss://socket.polygon.io/stocks";
const DELAYED_WS_URL = "wss://delayed.polygon.io/stocks"; // optional fallback (not auto here)

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

function normalizeTf(tf) {
  const t = String(tf || "1m").toLowerCase().trim();
  if (t === "1d") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function labelTf(tfMin) {
  return tfMin >= 1440 ? "1d" : tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;
}

function toUnixSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Polygon WS is ms
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

  if (tfMin >= 1440) return dayStartSec; // daily at NY midnight
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

/* -------------------- REST seed (backend-1) -------------------- */

async function fetch1mFromBackend1(symbol, limit1m) {
  const base = String(HIST_BASE || "").replace(/\/+$/, "");
  const url =
    `${base}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=1m&limit=${encodeURIComponent(limit1m)}`;

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

function buildTfFrom1m(tfMin, mode, bars1mAsc, limitOut) {
  if (tfMin === 1) return bars1mAsc.slice(-limitOut);

  const out = [];
  let cur = null;

  for (const b of bars1mAsc) {
    const bucket = bucketStartSecByMode(b.time, tfMin, mode);
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
  return out.slice(-limitOut);
}

/* -------------------- Tick -> 1m bar builder -------------------- */

// current 1m bar being built from T ticks
function applyTickTo1m(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec) || tSec <= 0) return cur;

  const minuteSec = Math.floor(tSec / 60) * 60;

  // start new minute bar
  if (!cur || cur.time < minuteSec) {
    return {
      time: minuteSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number.isFinite(size) ? size : 0,
    };
  }

  // update current minute bar
  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

// parse AM minute aggregate into 1m bar
function parseAM(msg) {
  const sMs = Number(msg?.s);
  const o = Number(msg?.o), h = Number(msg?.h), l = Number(msg?.l), c = Number(msg?.c);
  const v = Number(msg?.v ?? 0);
  const tSec = toUnixSec(sMs);
  if (![o, h, l, c].every(Number.isFinite) || !Number.isFinite(tSec)) return null;
  const minuteSec = Math.floor(tSec / 60) * 60;
  return { time: minuteSec, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 };
}

/* -------------------- in-memory per-connection aggregator -------------------- */

function updateAggFrom1m(lastAgg, bar1m, tfMin, mode) {
  const bucket = bucketStartSecByMode(bar1m.time, tfMin, mode);
  if (bucket === null) return { agg: lastAgg, changed: false };

  // 1m requested: agg is the 1m bar
  if (tfMin === 1) return { agg: bar1m, changed: true };

  // new bucket
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

  // same bucket
  if (lastAgg.time === bucket) {
    const upd = { ...lastAgg };
    upd.high = Math.max(upd.high, bar1m.high);
    upd.low = Math.min(upd.low, bar1m.low);
    upd.close = bar1m.close;
    upd.volume = Number(upd.volume || 0) + Number(bar1m.volume || 0);
    return { agg: upd, changed: true };
  }

  // older bucket (ignore)
  return { agg: lastAgg, changed: false };
}

/* -------------------- /healthz -------------------- */

router.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "streamer" });
});

/* -------------------- /stream/agg -------------------- */

router.get("/agg", async (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf || "1m");
  const tf = labelTf(tfMin);
  const mode = normalizeMode(req.query.mode);

  sseHeaders(res);

  // --- seed snapshot from backend-1 (history) ---
  let snapshotBars = [];
  try {
    const raw1m = await fetch1mFromBackend1(symbol, 5000);
    const oneMin = raw1m.map(normBar).filter(Boolean).sort((a, b) => a.time - b.time);
    snapshotBars = buildTfFrom1m(tfMin, mode, oneMin, 1500);
  } catch {
    snapshotBars = [];
  }

  sseSend(res, { ok: true, type: "snapshot", symbol, tf, mode, bars: snapshotBars });

  let alive = true;
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  // --- diagnostic counters ---
  const diag = {
    startedAt: new Date().toISOString(),
    symbol, tf, tfMin, mode,
    wsOpen: 0,
    wsClose: 0,
    wsError: 0,
    status: [],
    amSeen: 0,
    tSeen: 0,
    lastMsgMs: 0,
    lastAmMs: 0,
    lastTM: 0,
    barsEmitted: 0,
  };

  const diagTimer = setInterval(() => {
    if (!alive) return;
    sseSend(res, { ok: true, type: "diag", diag });
  }, 5000);

  // --- throttle bars to 1/sec ---
  let lastEmitAt = 0;
  function emitBar(bar) {
    const now = Date.now();
    if (now - lastEmitAt < 900) return;
    lastEmitAt = now;
    diag.barsEmitted += 1;
    sseSend(res, { ok: true, type: "bar", symbol, tf, mode, bar });
  }

  // --- WS connect ---
  const ws = new WebSocket(POLY_WS_URL);

  let tick1m = null;      // current 1m being built from trades
  let aggBar = null;      // current aggregated bar for requested tf

  ws.on("open", () => {
    diag.wsOpen += 1;
    ws.send(JSON.stringify({ action: "auth", params: apiKey }));
    ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol},T.${symbol}` }));
    sseSend(res, { ok: true, type: "diag", message: `ws_open subscribed AM.${symbol},T.${symbol}` });
  });

  ws.on("message", (buf) => {
    diag.lastMsgMs = Date.now();

    let arr;
    try {
      arr = JSON.parse(buf.toString("utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(arr)) arr = [arr];

    for (const msg of arr) {
      const ev = msg?.ev;

      if (ev === "status") {
        const line = `${msg?.status || ""} ${msg?.message || ""}`.trim();
        diag.status.push(line);
        if (diag.status.length > 10) diag.status.shift();
        sseSend(res, { ok: true, type: "diag", message: `status ${line}` });
        continue;
      }

      if (ev === "AM" && String(msg?.sym || "").toUpperCase() === symbol) {
        diag.amSeen += 1;
        diag.lastAmMs = Date.now();

        const bar1m = parseAM(msg);
        if (!bar1m) continue;

        // update agg from 1m
        const { agg, changed } = updateAggFrom1m(aggBar, bar1m, tfMin, mode);
        aggBar = agg;
        if (changed && aggBar) emitBar(aggBar);

        // reset tick-built bar to avoid conflicts
        tick1m = null;
        continue;
      }

      if (ev === "T" && String(msg?.sym || "").toUpperCase() === symbol) {
        diag.tSeen += 1;
        diag.lastTM = Date.now();

        // fold trade tick into 1m bar
        const next1m = applyTickTo1m(tick1m, msg);
        if (!next1m) continue;

        // when minute changes, we "finalize" previous minute implicitly by the next bar
        tick1m = next1m;

        // update agg from 1m (using current tick-built 1m)
        const { agg, changed } = updateAggFrom1m(aggBar, tick1m, tfMin, mode);
        aggBar = agg;
        if (changed && aggBar) emitBar(aggBar);
      }
    }
  });

  ws.on("error", (e) => {
    diag.wsError += 1;
    sseSend(res, { ok: true, type: "diag", message: `ws_error ${String(e?.message || e)}` });
  });

  ws.on("close", () => {
    diag.wsClose += 1;
    sseSend(res, { ok: true, type: "diag", message: "ws_closed" });
  });

  req.on("close", () => {
    alive = false;
    clearInterval(ping);
    clearInterval(diagTimer);
    try { ws.close(); } catch {}
    try { res.end(); } catch {}
  });
});
