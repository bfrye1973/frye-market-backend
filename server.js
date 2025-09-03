// server.js — Express backend with no-store caching + CORS + /api/v1/gauges/index

const path = require("path");
const fs = require("fs");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

// --------- CORS (allow your dashboard & localhost) ----------
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000"
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

// --------- NEW: /api/v1/gauges/index?SYMBOL  ----------
// Your frontend is calling this route. We'll serve dashboard gauges here too.
app.get("/api/v1/gauges/index", (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    // Parse symbol from query string shaped like ?SPY
    const symbol = Object.keys(req.query)[0] || "SPY";

    const p = path.join(__dirname, "data", "outlook.json");
    const txt = fs.readFileSync(p, "utf8");
    const dash = JSON.parse(txt);

    // Return a compact object that the frontend can consume
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
- GET /api/v1/gauges/index?SPY`);
});
