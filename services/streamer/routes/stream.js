// services/streamer/routes/stream.js
// ============================================================================
// Polygon WS → SSE stream + Snapshot seeding (RTH default, ETH toggle-ready)
//
// Endpoints:
//   GET /stream/agg?symbol=SPY&tf=10m&mode=rth|eth
//     - SSE stream
//     - Immediately emits: type:"snapshot" (SEEDED from backend-1 if cache empty)
//     - Then emits: type:"bar" updates (throttled 1/sec per connection) as live data arrives
//     - Emits: type:"diag" messages (counters + status) so failures are visible
//
//   GET /stream/snapshot?symbol=SPY&tf=10m&limit=1500&mode=rth|eth
//     - JSON snapshot
//     - If cache empty, pulls 1m from backend-1 and REBUCKETS here (RTH/ETH)
//       so candle structure matches TradingView RTH.
//
// Default: mode=rth (TradingView-aligned)
//   - RTH session: 09:30–16:00 America/New_York
//   - Buckets anchored to 09:30 ET
//
// Notes:
// - Phoenix display is a FRONTEND concern. This file only provides correct timestamps.
// - Node must have luxon installed in streamer service (see note below).
// ============================================================================

import express from "express";
import WebSocket from "ws";
import { DateTime } from "luxon";

const streamRouter = express.Router();
export default streamRouter;

/* ------------------------------- Config ---------------------------------- */

const POLY_WS_URL = "wss://socket.polygon.io/stocks";

// backend-1 historical base (REST) used for snapshot backfill
const HIST_BASE =
  process.env.HIST_BASE ||
  process.env.BACKEND1_BASE ||
  "https://frye-market-backend-1.onrender.com";

/* --------------------------- Helpers / Parsing ---------------------------- */

function resolvePolygonKey() {
  const keys = [
    process.env.POLYGON_API,
    process.env.POLYGON_API_KEY,
    process.env.POLY_API_KEY,
  ];
  return keys.find((k) => k && String(k).trim()) || "";
}

function normalizeTf(tf = "10m") {
  const t = String(tf || "").toLowerCase().trim();
  if (t === "1d" || t === "d" || t === "day" || t === "daily") return 1440;
  if (t.endsWith("h")) return Number(t.slice(0, -1)) * 60;
  if (t.endsWith("m")) return Number(t.slice(0, -1));
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function labelTf(tfMin) {
  return tfMin >= 1440 ? "1d" : tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;
}

function normalizeMode(mode) {
  const m = String(mode || "rth").toLowerCase().trim();
  return m === "eth" ? "eth" : "rth";
}

/**
 * Normalize an unknown timestamp to UNIX SECONDS.
 * Polygon WS timestamps are typically milliseconds (13 digits).
 */
function toUnixSec(ts) {
  const x = Number(ts);
  if (!Number.isFinite(x) || x <= 0) return null;
  if (x > 1e12) return Math.floor(x / 1000); // ms → sec
  if (x > 1e10) return Math.floor(x / 1000); // guard
  return Math.floor(x); // already sec
}

/* ------------------------------ RTH rules -------------------------------- */

const NY_ZONE = "America/New_York";

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

  // RTH only filter (close is exclusive)
  if (unixSec < openSec || unixSec >= closeSec) return null;

  const size = tfMin * 60;
  const idx = Math.floor((unixSec - openSec) / size);
  const bucket = openSec + idx * size;

  if (bucket >= closeSec) return null;
  return bucket;
}

function bucketStartSecEth(unixSec, tfMin) {
  // ETH: continuous time buckets. Daily still at NY midnight.
  if (tfMin >= 1440) {
    const { dayStartSec } = nyAnchors(unixSec);
    return dayStartSec;
  }
  const size = tfMin * 60;
  return Math.floor(unixSec / size) * size;
}

function bucketStartSecByMode(unixSec, tfMin, mode) {
  return mode === "eth"
    ? bucketStartSecEth(unixSec, tfMin)
    : bucketStartSecRth(unixSec, tfMin);
}

/* ------------------------------ SSE utils -------------------------------- */

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

const sseSend = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/* ---------------------------- In-memory cache ----------------------------- */
// cache key: `${symbol}|${mode}` -> Map(tfMin -> barsAsc[])
const cacheBars = new Map();

function ckey(symbol, mode) {
  return `${symbol}|${mode}`;
}

function cmap(symbol, mode) {
  const k = ckey(symbol, mode);
  if (!cacheBars.has(k)) cacheBars.set(k, new Map());
  return cacheBars.get(k);
}

function pushRing(arr, bar, maxLen) {
  if (!Array.isArray(arr)) arr = [];
  if (arr.length === 0) {
    arr.push(bar);
  } else {
    const last = arr[arr.length - 1];
    if (bar.time > last.time) arr.push(bar);
    else if (bar.time === last.time) arr[arr.length - 1] = bar;
    // ignore out-of-order
  }
  if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
  return arr;
}

/**
 * Ring length by TF:
 * - 1m needs more (for smooth chart)
 * - higher TF needs fewer
 */
function maxBarsForTf(tfMin) {
  if (tfMin <= 1) return 6000;     // ~ 4-5 days of 1m+ in cache
  if (tfMin <= 5) return 4000;
  if (tfMin <= 10) return 3000;
  if (tfMin <= 30) return 2500;
  if (tfMin <= 60) return 2000;
  if (tfMin <= 240) return 1500;
  return 1500; // daily
}

/* --------------------------- Horizon / backfill --------------------------- */

const TRADING_DAYS_PER_MONTH = 21;
const RTH_MIN_PER_DAY = 390;

function need1mCountForTf(tfMin) {
  // cap under Polygon 50k 1m bars
  const CAP = 50000;

  // 10m → ~2 weeks
  if (tfMin === 10) return Math.min(CAP, 10 * RTH_MIN_PER_DAY);

  // 30m → ~3 months
  if (tfMin === 30) return Math.min(CAP, (3 * TRADING_DAYS_PER_MONTH) * RTH_MIN_PER_DAY);

  // 1h/4h/1d → ~6 months
  if (tfMin === 60 || tfMin === 240 || tfMin >= 1440) {
    return Math.min(CAP, (6 * TRADING_DAYS_PER_MONTH) * RTH_MIN_PER_DAY);
  }

  // default
  return Math.min(CAP, 5000);
}

/* -------------------------- Normalize Polygon events ---------------------- */

// AM: { ev:"AM", sym:"SPY", s:<startMs>, o,h,l,c, v }
function parseAM(msg) {
  const symbol = String(msg?.sym || "").toUpperCase();
  const sMs = Number(msg?.s);
  const o = Number(msg?.o), h = Number(msg?.h), l = Number(msg?.l), c = Number(msg?.c);
  const v = Number(msg?.v ?? 0);
  if (!symbol) return null;
  if (![o, h, l, c].every(Number.isFinite)) return null;

  const tSec = toUnixSec(sMs);
  if (!Number.isFinite(tSec) || tSec <= 0) return null;

  // snap to minute boundary
  const minuteSec = Math.floor(tSec / 60) * 60;
  return {
    symbol,
    bar1m: { time: minuteSec, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 }
  };
}

// T: { ev:"T", sym, p, s, t(ms) }
function applyTickTo1m(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec) || tSec <= 0) return cur;

  const minuteSec = Math.floor(tSec / 60) * 60;

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

  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* ---------------------------- Rebucket from 1m ---------------------------- */

function fold1mIntoTf(symbol, bar1m, tfMin, mode, maxLen) {
  const map = cmap(symbol, mode);
  const bars = map.get(tfMin) || [];

  const bucket = bucketStartSecByMode(bar1m.time, tfMin, mode);
  if (bucket === null) return null; // RTH filter excludes

  if (bars.length === 0) {
    const first = {
      time: bucket,
      open: bar1m.open,
      high: bar1m.high,
      low: bar1m.low,
      close: bar1m.close,
      volume: Number(bar1m.volume || 0),
    };
    const next = pushRing(bars, first, maxLen);
    map.set(tfMin, next);
    return next[next.length - 1] || null;
  }

  const last = bars[bars.length - 1];

  if (last.time < bucket) {
    const nb = {
      time: bucket,
      open: bar1m.open,
      high: bar1m.high,
      low: bar1m.low,
      close: bar1m.close,
      volume: Number(bar1m.volume || 0),
    };
    const next = pushRing(bars, nb, maxLen);
    map.set(tfMin, next);
    return next[next.length - 1] || null;
  }

  if (last.time === bucket) {
    const upd = { ...last };
    upd.high = Math.max(upd.high, bar1m.high);
    upd.low = Math.min(upd.low, bar1m.low);
    upd.close = bar1m.close;
    upd.volume = Number(upd.volume || 0) + Number(bar1m.volume || 0);
    bars[bars.length - 1] = upd;
    const next = pushRing(bars, upd, maxLen);
    map.set(tfMin, next);
    return next[next.length - 1] || null;
  }

  return last;
}

// Build full TF series from 1m bars (ascending)
function buildTfFrom1m(tfMin, mode, bars1mAsc, limitOut) {
  const out = [];
  let cur = null;

  for (const b of bars1mAsc) {
    const bucket = bucketStartSecByMode(b.time, tfMin, mode);
    if (bucket === null) continue;

    if (!cur || cur.time < bucket) {
      if (cur) out.push(cur);
      cur = {
        time: bucket,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: Number(b.volume || 0),
      };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = Number(cur.volume || 0) + Number(b.volume || 0);
    }
  }

  if (cur) out.push(cur);
  return out.length > limitOut ? out.slice(-limitOut) : out;
}

/* -------------------- Snapshot fallback: backend-1 1m --------------------- */

async function fetch1mFromBackend1(symbol, limit1m) {
  const base = String(HIST_BASE || "").replace(/\/+$/, "");
  const url =
    `${base}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=1m&limit=${encodeURIComponent(limit1m)}`;

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`backend1 ${r.status}`);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : (Array.isArray(j?.bars) ? j.bars : []);
  return Array.isArray(arr) ? arr : [];
}

function norm1m(b) {
  const tRaw = Number(b?.time ?? b?.t ?? b?.ts ?? b?.timestamp);
  const tSec = toUnixSec(tRaw);
  const o = Number(b?.open ?? b?.o);
  const h = Number(b?.high ?? b?.h);
  const l = Number(b?.low ?? b?.l);
  const c = Number(b?.close ?? b?.c);
  const v = Number(b?.volume ?? b?.v ?? 0);
  if (![tSec, o, h, l, c].every(Number.isFinite)) return null;
  return { time: tSec, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 };
}

/**
 * Seed cache for a given (symbol, tfMin) using backend-1 1m history.
 * Builds BOTH modes (rth + eth) so toggle is instant.
 */
async function seedCacheFromBackend1(symbol, tfMin, limitOut, diagPush) {
  const need1m = need1mCountForTf(tfMin);
  diagPush?.(`seeding: fetching 1m from backend-1 (limit=${need1m})`);

  const raw = await fetch1mFromBackend1(symbol, need1m);
  const oneMin = raw.map(norm1m).filter(Boolean).sort((a, b) => a.time - b.time);

  if (oneMin.length === 0) {
    diagPush?.(`seeding: backend-1 returned 0 bars (cannot seed)`);
    return { rth: [], eth: [] };
  }

  const builtRth = buildTfFrom1m(tfMin, "rth", oneMin, limitOut);
  const builtEth = buildTfFrom1m(tfMin, "eth", oneMin, limitOut);

  // store into cache
  cmap(symbol, "rth").set(tfMin, builtRth);
  cmap(symbol, "eth").set(tfMin, builtEth);

  diagPush?.(`seeding: done (1m=${oneMin.length}, rth=${builtRth.length}, eth=${builtEth.length})`);
  return { rth: builtRth, eth: builtEth };
}

/* --------------------------- GET /stream/snapshot -------------------------- */

streamRouter.get("/snapshot", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfMin = normalizeTf(req.query.tf || "10m");
    const tf = labelTf(tfMin);
    const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 1500)));
    const mode = normalizeMode(req.query.mode);

    // 1) Use cache if present
    const m = cacheBars.get(ckey(symbol, mode));
    const cached = m?.get(tfMin) || [];
    if (cached.length > 0) {
      const bars = cached.length > limit ? cached.slice(-limit) : cached;
      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, type: "snapshot", symbol, tf, mode, bars });
    }

    // 2) Cache empty → backfill from backend-1 1m, then rebucket HERE (RTH aligned)
    const built = await seedCacheFromBackend1(symbol, tfMin, limit, null);
    const bars = mode === "eth" ? built.eth : built.rth;

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, type: "snapshot", symbol, tf, mode, bars });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      ok: false,
      error: "snapshot_error",
      detail: String(e?.message || e),
    });
  }
});

/* ---------------------------- GET /stream/agg (SSE) ------------------------ */

streamRouter.get("/agg", (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf || "10m");
  const tf = labelTf(tfMin);
  const mode = normalizeMode(req.query.mode);

  sseHeaders(res);

  let alive = true;

  // pings keep connection alive through proxies
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  // per-connection throttle
  let lastEmitAt = 0;
  function canEmitConn(intervalMs = 1000) {
    const now = Date.now();
    if (now - lastEmitAt >= intervalMs) {
      lastEmitAt = now;
      return true;
    }
    return false;
  }

  // per-connection diagnostics
  const diag = {
    startedAt: new Date().toISOString(),
    symbol, tf, tfMin, mode,
    wsOpen: 0,
    wsClose: 0,
    wsError: 0,
    statusMsgs: 0,
    amSeen: 0,
    tSeen: 0,
    amParsed: 0,
    tApplied: 0,
    rthDropped: 0,
    ethDropped: 0,
    barsFolded: 0,
    barsEmitted: 0,
    lastMsgAtMs: 0,
    lastAmAtMs: 0,
    lastTickAtMs: 0,
    lastEmitAtMs: 0,
    lastBarTimeSec: null,
    seedAttempted: false,
    seedOk: false,
    seedRthBars: 0,
    seedEthBars: 0,
    backend1SeedErr: null,
  };

  function diagPush(message) {
    sseSend(res, { ok: true, type: "diag", symbol, tf, mode, message, diag: { ...diag } });
  }

  // emit bar
  function emitBar(bar) {
    if (!bar) return;
    if (!canEmitConn(1000)) return;
    diag.barsEmitted += 1;
    diag.lastEmitAtMs = Date.now();
    diag.lastBarTimeSec = bar.time;
    sseSend(res, { ok: true, type: "bar", symbol, tf, mode, bar });
  }

  // Always seed snapshot if cache empty (THIS IS THE KEY FIX)
  (async () => {
    try {
      const m = cacheBars.get(ckey(symbol, mode));
      const list = m?.get(tfMin) || [];

      if (list.length === 0) {
        diag.seedAttempted = true;

        const built = await seedCacheFromBackend1(symbol, tfMin, 1500, (msg) => diagPush(msg));
        diag.seedOk = true;
        diag.seedRthBars = built.rth.length;
        diag.seedEthBars = built.eth.length;

        const seededBars = mode === "eth" ? built.eth : built.rth;
        sseSend(res, { ok: true, type: "snapshot", symbol, tf, mode, bars: seededBars });

      } else {
        // cache already has data
        sseSend(res, { ok: true, type: "snapshot", symbol, tf, mode, bars: list });
      }
    } catch (e) {
      diag.seedAttempted = true;
      diag.seedOk = false;
      diag.backend1SeedErr = String(e?.message || e);
      // snapshot may be empty, but we MUST show why
      diagPush(`seeding FAILED: ${diag.backend1SeedErr}`);
      sseSend(res, { ok: true, type: "snapshot", symbol, tf, mode, bars: [] });
    }
  })();

  // emit diag heartbeat every 5 seconds
  const diagTimer = setInterval(() => {
    if (!alive) return;
    sseSend(res, { ok: true, type: "diag", symbol, tf, mode, diag: { ...diag } });
  }, 5000);

  // Per-connection WS
  let ws = null;
  let reconnectTimer = null;
  let backoffMs = 1000;

  let lastAmAt = 0;
  let tickBar1m = null;

  function closeWs() {
    try { ws?.close?.(); } catch {}
    ws = null;
  }

  function scheduleReconnect() {
    if (!alive) return;
    clearTimeout(reconnectTimer);
    backoffMs = Math.min(Math.floor(backoffMs * 1.5), 15000);
    const jitter = Math.floor(Math.random() * 250);
    reconnectTimer = setTimeout(connectWs, backoffMs + jitter);
  }

  function connectWs() {
    if (!alive) return;

    closeWs();
    ws = new WebSocket(POLY_WS_URL);

    ws.on("open", () => {
      diag.wsOpen += 1;
      backoffMs = 1000;

      ws.send(JSON.stringify({ action: "auth", params: apiKey }));
      ws.send(JSON.stringify({ action: "subscribe", params: `AM.${symbol},T.${symbol}` }));

      diagPush(`ws_open subscribed AM.${symbol},T.${symbol}`);
    });

    ws.on("message", (buf) => {
      if (!alive) return;

      diag.lastMsgAtMs = Date.now();

      let arr;
      try { arr = JSON.parse(buf.toString("utf8")); } catch { return; }
      if (!Array.isArray(arr)) arr = [arr];

      for (const msg of arr) {
        const ev = msg?.ev;

        if (ev === "status") {
          diag.statusMsgs += 1;
          const st = `${msg?.status || ""} ${msg?.message || ""}`.trim();
          sseSend(res, { ok: true, type: "diag", symbol, tf, mode, message: `status ${st}` });
          continue;
        }

        if (ev === "AM" && String(msg?.sym || "").toUpperCase() === symbol) {
          diag.amSeen += 1;

          const am = parseAM(msg);
          if (!am) continue;

          diag.amParsed += 1;
          lastAmAt = Date.now();
          diag.lastAmAtMs = lastAmAt;
          tickBar1m = null;

          // update caches for both modes
          for (const m of ["rth", "eth"]) {
            const out = fold1mIntoTf(symbol, am.bar1m, tfMin, m, maxBarsForTf(tfMin));
            if (!out) {
              if (m === "rth") diag.rthDropped += 1;
              if (m === "eth") diag.ethDropped += 1;
              continue;
            }
            diag.barsFolded += 1;
            if (m === mode) emitBar(out);
          }
          continue;
        }

        if (ev === "T" && String(msg?.sym || "").toUpperCase() === symbol) {
          diag.tSeen += 1;

          // if AM is fresh, ignore trades (AM drives aggregates)
          if (Date.now() - lastAmAt < 120000) continue;

          tickBar1m = applyTickTo1m(tickBar1m, msg);
          if (!tickBar1m) continue;

          diag.tApplied += 1;
          diag.lastTickAtMs = Date.now();

          for (const m of ["rth", "eth"]) {
            const out = fold1mIntoTf(symbol, tickBar1m, tfMin, m, maxBarsForTf(tfMin));
            if (!out) {
              if (m === "rth") diag.rthDropped += 1;
              if (m === "eth") diag.ethDropped += 1;
              continue;
            }
            diag.barsFolded += 1;
            if (m === mode) emitBar(out);
          }
        }
      }
    });

    ws.on("error", () => {
      diag.wsError += 1;
      diagPush("ws_error reconnecting");
      closeWs();
      scheduleReconnect();
    });

    ws.on("close", () => {
      diag.wsClose += 1;
      diagPush("ws_closed reconnecting");
      closeWs();
      scheduleReconnect();
    });
  }

  connectWs();

  req.on("close", () => {
    alive = false;
    clearInterval(ping);
    clearInterval(diagTimer);
    clearTimeout(reconnectTimer);
    closeWs();
    try { res.end(); } catch {}
  });
});

/* =============================================================================
IMPORTANT INSTALL NOTE (DO THIS ONCE):
Your streamer package.json currently does NOT include luxon.
This file imports:  import { DateTime } from "luxon";
So you MUST add luxon to services/streamer/package.json dependencies:

"dependencies": {
  "express": "...",
  "ws": "...",
  "luxon": "^3.5.0"
}

Then redeploy backend-2.
============================================================================= */
