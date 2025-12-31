import express from "express";
import WebSocket from "ws";

const router = express.Router();
export default router;

const POLY_WS_URL = "wss://socket.polygon.io/stocks";
const HIST_BASE =
  process.env.HIST_BASE ||
  process.env.BACKEND1_BASE ||
  "https://frye-market-backend-1.onrender.com";

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
  return 1;
}

function labelTf(tfMin) {
  return tfMin >= 1440 ? "1d" : tfMin % 60 === 0 ? `${tfMin / 60}h` : `${tfMin}m`;
}

function isMs(n) {
  return Number.isFinite(n) && n > 1e12;
}
function toSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  return isMs(n) ? Math.floor(n / 1000) : Math.floor(n);
}

/* ---------------- SSE helpers ---------------- */
function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/* ---------------- backend-1 seed ---------------- */
async function fetch1m(symbol, limit) {
  const url =
    `${String(HIST_BASE).replace(/\/+$/, "")}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=1m&limit=${encodeURIComponent(limit)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.bars)) return j.bars;
  return [];
}

function buildTfFrom1m(tfMin, bars1mAsc, limitOut) {
  if (tfMin === 1) return bars1mAsc.slice(-limitOut);

  const size = tfMin * 60;
  const out = [];
  let cur = null;

  for (const b of bars1mAsc) {
    const t = toSec(b.time ?? b.t ?? b.ts ?? b.timestamp);
    if (!Number.isFinite(t)) continue;

    const bucket = Math.floor(t / size) * size;
    const o = Number(b.open ?? b.o);
    const h = Number(b.high ?? b.h);
    const l = Number(b.low ?? b.l);
    const c = Number(b.close ?? b.c);
    const v = Number(b.volume ?? b.v ?? 0);
    if (![o, h, l, c].every(Number.isFinite)) continue;

    if (!cur || cur.time < bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: o, high: h, low: l, close: c, volume: v };
    } else {
      cur.high = Math.max(cur.high, h);
      cur.low = Math.min(cur.low, l);
      cur.close = c;
      cur.volume += v;
    }
  }
  if (cur) out.push(cur);
  return out.slice(-limitOut);
}

/* ---------------- /stream/agg (diagnostic) ---------------- */
router.get("/agg", async (req, res) => {
  const apiKey = resolvePolygonKey();
  if (!apiKey) return res.status(500).end("Missing Polygon API key");

  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tfMin = normalizeTf(req.query.tf || "1m");
  const tf = labelTf(tfMin);
  const mode = normalizeMode(req.query.mode);

  sseHeaders(res);

  // Snapshot seed (always)
  let snapshotBars = [];
  try {
    const raw1m = await fetch1m(symbol, 5000);
    const norm1m = raw1m
      .map((b) => ({
        time: toSec(b.time ?? b.t ?? b.ts ?? b.timestamp),
        open: Number(b.open ?? b.o),
        high: Number(b.high ?? b.h),
        low: Number(b.low ?? b.l),
        close: Number(b.close ?? b.c),
        volume: Number(b.volume ?? b.v ?? 0),
      }))
      .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.open))
      .sort((a, b) => a.time - b.time);

    snapshotBars = buildTfFrom1m(tfMin, norm1m, 1500);
  } catch {}

  sseSend(res, { ok: true, type: "snapshot", symbol, tf, mode, bars: snapshotBars });

  let alive = true;
  const ping = setInterval(() => alive && res.write(`:ping ${Date.now()}\n\n`), 15000);

  // Diagnostics counters
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
  };

  const diagTimer = setInterval(() => {
    if (!alive) return;
    sseSend(res, { ok: true, type: "diag", diag });
  }, 5000);

  // Connect Polygon WS (per-connection)
  const ws = new WebSocket(POLY_WS_URL);

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
      if (msg?.ev === "status") {
        const line = `${msg?.status || ""} ${msg?.message || ""}`.trim();
        diag.status.push(line);
        if (diag.status.length > 10) diag.status.shift();
        sseSend(res, { ok: true, type: "diag", message: `status ${line}` });
        continue;
      }
      if (msg?.ev === "AM" && String(msg?.sym || "").toUpperCase() === symbol) {
        diag.amSeen += 1;
        diag.lastAmMs = Date.now();
        continue;
      }
      if (msg?.ev === "T" && String(msg?.sym || "").toUpperCase() === symbol) {
        diag.tSeen += 1;
        diag.lastTM = Date.now();
        continue;
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
