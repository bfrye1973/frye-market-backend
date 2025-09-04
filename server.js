// server.js — Express backend with no-store caching + CORS + gauges routes + OHLC

const path = require("path");
const fs = require("fs");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

// --------- CORS (allow your dashboard & localhost) ----------
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --------- Health ----------
app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "frye-market-backend", ts: new Date().toISOString() });
});

// --------- /api/dashboard (frontend payload) ----------
app.get("/api/dashboard", (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const p = path.join(__dirname, "data", "outlook.json");
    const txt = fs.readFileSync(p, "utf8");
    res.json(JSON.parse(txt));
  } catch (e) {
    console.error("dashboard error:", e);
    res.status(500).json({ ok: false, error: "cannot read data/outlook.json" });
  }
});

// --------- /api/source (raw counts, optional) ----------
app.get("/api/source", (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const p = path.join(__dirname, "data", "outlook_source.json");
    const txt = fs.readFileSync(p, "utf8");
    res.json(JSON.parse(txt));
  } catch (e) {
    console.error("source error:", e);
    res.status(500).json({ ok: false, error: "cannot read data/outlook_source.json" });
  }
});

// --------- /api/v1/gauges?index=SYMBOL ----------
app.get("/api/v1/gauges", (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const symbol = req.query.index || req.query.symbol || "SPY";
    const p = path.join(__dirname, "data", "outlook.json");
    const txt = fs.readFileSync(p, "utf8");
    const dash = JSON.parse(txt);
    res.json({
      ok: true,
      symbol,
      gauges: dash.gauges || {},
      odometers: dash.odometers || {},
      meta: dash.meta || {}
    });
  } catch (e) {
    console.error("gauges (query) error:", e);
    res.status(500).json({ ok: false, error: "cannot build gauges payload" });
  }
});

// --------- /api/v1/gauges/index?SPY (alias) ----------
app.get("/api/v1/gauges/index", (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const symbol = Object.keys(req.query)[0] || "SPY";
    const p = path.join(__dirname, "data", "outlook.json");
    const txt = fs.readFileSync(p, "utf8");
    const dash = JSON.parse(txt);
    res.json({
      ok: true,
      symbol,
      gauges: dash.gauges || {},
      odometers: dash.odometers || {},
      meta: dash.meta || {}
    });
  } catch (e) {
    console.error("gauges/index error:", e);
    res.status(500).json({ ok: false, error: "cannot build gauges/index payload" });
  }
});

// --------- /api/v1/ohlc?symbol=SPY&timeframe=1h ----------
// Temporary OHLC endpoint: generates dummy candles for testing
app.get("/api/v1/ohlc", (req, res) => {
  res.set("Cache-Control", "no-store");

  const symbol = req.query.symbol || "SPY";
  const timeframe = req.query.timeframe || "1d";

  // Map timeframe to seconds
  const tfSec = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "1d": 86400
  }[timeframe] || 3600;

  const now = Math.floor(Date.now() / 1000);
  const bars = [];
  let px = 640; // start near SPY price

  for (let i = 50; i > 0; i--) {
    const t = now - i * tfSec;
    const o = px;
    const c = px + (Math.random() - 0.5) * 2; // ±1 drift
    const h = Math.max(o, c) + Math.random();
    const l = Math.min(o, c) - Math.random();
    const v = Math.floor(1000000 + Math.random() * 500000);
    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
    px = c;
  }

  res.json({ bars });
});

// --------- static /public if present ----------
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// 404 + error
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- GET /api/health
- GET /api/dashboard
- GET /api/source
- GET /api/v1/gauges?index=SPY
- GET /api/v1/gauges/index?SPY
- GET /api/v1/ohlc?symbol=SPY&timeframe=1h`);
});
