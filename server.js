// server.js — Frye Market Backend
const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");
const { fetch } = require("undici");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- Config ----------
const PORT = process.env.PORT || 5055;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "";
const TIMEFRAME_SEC = Number(process.env.TIMEFRAME_SEC || 60);
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);
const DEFAULT_TICKER = process.env.DEFAULT_TICKER || "AAPL";
const CORS_ORIGINS = (process.env.CORS_ORIGINS ||
  "https://frye-dashboard.onrender.com,http://localhost:3001,http://localhost:5173")
  .split(",")
  .map(s => s.trim());

// ---------- Middleware ----------
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      return cb(null, CORS_ORIGINS.includes(origin));
    },
  })
);

// ---------- Helpers ----------
const sec = () => Math.floor(Date.now() / 1000);
function toISODate(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return new Date();
  return dt;
}
function sanitizeTf(tf) {
  if (tf === "hour" || tf === "day") return tf;
  return "minute";
}
function synthCandles(fromISO, toISO, tf = "minute", base = 100) {
  const start = toISODate(fromISO);
  const end = toISODate(toISO);
  const step = tf === "day" ? 86400 : tf === "hour" ? 3600 : 60;
  let t = Math.floor(start.getTime() / 1000);
  const tEnd = Math.floor(end.getTime() / 1000);
  const out = [];
  let px = base;
  while (t <= tEnd) {
    const drift = (Math.sin(t / 1800) + Math.cos(t / 900)) * 0.25;
    const noise = (Math.random() - 0.5) * 0.6;
    const o = px;
    px = Math.max(1, o + drift + noise);
    const c = px;
    const h = Math.max(o, c) + Math.random() * 0.6;
    const l = Math.min(o, c) - Math.random() * 0.6;
    const v = Math.floor(100000 + Math.random() * 200000);
    out.push({ time: t, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: v });
    t += step;
  }
  return out;
}
async function polygonAggHistory(ticker, tf, from, to) {
  if (!POLYGON_API_KEY) return null;
  const timespan = sanitizeTf(tf);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
    ticker
  )}/range/1/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${POLYGON_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || !j.results || !Array.isArray(j.results)) return null;
  return j.results.map(b => ({
    time: Math.round((b.t || 0) / 1000),
    open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
  }));
}
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) { try { client.send(msg); } catch {} }
  }
}

// ---------- REST (health first, for Render) ----------
app.get("/health", (req, res) => {              // <- Render checks this
  res.json({ ok: true, ts: sec(), path: "/health" });
});
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: sec(), path: "/api/health" });
});
app.get("/api/healthz", (req, res) => {
  res.json({ ok: true, ts: sec(), path: "/api/healthz" });
});
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, message: "pong", ts: sec(), path: "/api/ping" });
});

// Metrics (mock)
app.get("/api/market-metrics", async (req, res) => {
  res.json({
    timestamp: sec(),
    sectors: [
      { sector: "Tech",        newHighs: 12, newLows: 3, adrAvg: 1.82 },
      { sector: "Energy",      newHighs: 4,  newLows: 6, adrAvg: 1.24 },
      { sector: "Financials",  newHighs: 7,  newLows: 2, adrAvg: 1.05 },
      { sector: "Healthcare",  newHighs: 5,  newLows: 5, adrAvg: 0.98 },
    ],
  });
});

// History (Polygon with fallback)
app.get("/api/history", async (req, res) => {
  try {
    const ticker = (req.query.ticker || DEFAULT_TICKER).toUpperCase();
    const tf     = sanitizeTf(String(req.query.tf || "minute"));
    const from   = String(req.query.from || new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString().slice(0,10));
    const to     = String(req.query.to   || new Date().toISOString().slice(0,10));

    let candles = null;
    try { candles = await polygonAggHistory(ticker, tf, from, to); } catch (e) { console.error("polygonAggHistory error:", e); }
    if (!candles || candles.length === 0) {
      candles = synthCandles(from, to, tf, 100 + Math.random() * 50);
    }
    res.json(candles);
  } catch (e) {
    console.error("GET /api/history error", e);
    res.status(500).json({ ok: false, error: "Internal error", path: "/api/history" });
  }
});

// ---------- WebSocket ----------
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({
    type: "metrics",
    payload: {
      timestamp: sec(),
      sectors: [
        { sector: "Tech", newHighs: 12, newLows: 3, adrAvg: 1.82 },
        { sector: "Energy", newHighs: 4, newLows: 6, adrAvg: 1.24 },
        { sector: "Financials", newHighs: 7, newLows: 2, adrAvg: 1.05 },
        { sector: "Healthcare", newHighs: 5, newLows: 5, adrAvg: 0.98 },
      ],
    },
  }));

  let lastTime = sec() - TIMEFRAME_SEC;
  let price = 100 + Math.random() * 50;
  const id = setInterval(() => {
    lastTime += TIMEFRAME_SEC;
    const o = price;
    price = Math.max(1, o + (Math.random() - 0.5) * 0.8);
    const c = price;
    const h = Math.max(o, c) + Math.random() * 0.4;
    const l = Math.min(o, c) - Math.random() * 0.4;
    const v = Math.floor(80_000 + Math.random() * 120_000);
    const bar = { type: "bar", payload: { ticker: DEFAULT_TICKER, time: lastTime, open:+o.toFixed(2), high:+h.toFixed(2), low:+l.toFixed(2), close:+c.toFixed(2), volume:v } };
    try { ws.send(JSON.stringify(bar)); } catch {}
  }, TIMEFRAME_SEC * 1000);

  ws.on("close", () => { try { clearInterval(id); } catch {} });
});

// ---------- Start ----------
server.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
  console.log("CORS allow-list:", CORS_ORIGINS);
});
