// server.js — Express backend (no-store, CORS, dashboard + gauges + OHLC)
// Supports optional GitHub Raw fetching with local-file fallback.

const path = require("path");
const fs = require("fs");
const express = require("express");

const hasFetch = typeof fetch === "function";
const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   Config (optional GitHub Raw)
   ========================= */
const RAW_DASHBOARD_URL = process.env.RAW_DASHBOARD_URL || null; // e.g. https://raw.githubusercontent.com/<user>/<repo>/main/data/outlook.json
const RAW_SOURCE_URL    = process.env.RAW_SOURCE_URL    || null; // e.g. https://raw.githubusercontent.com/<user>/<repo>/main/data/outlook_source.json

/* =========================
   CORS
   ========================= */
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000",
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* =========================
   Helpers
   ========================= */
function readJsonSafe(absPath) {
  try { return JSON.parse(fs.readFileSync(absPath, "utf8")); }
  catch { return null; }
}
function loadLocal(relPath) {
  return readJsonSafe(path.join(__dirname, relPath));
}
async function fetchJson(url) {
  if (!hasFetch) throw new Error("fetch() not available");
  const u = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const r = await fetch(u, { headers: { "User-Agent": "ferrari-dashboard/1.0" }, cache: "no-store" });
  if (!r.ok) throw new Error(`raw fetch ${r.status}`);
  return await r.json();
}
function noStore(res) {
  res.set("Cache-Control", "no-store");
  return res;
}

/* =========================
   Health
   ========================= */
app.get("/api/health", (req, res) => {
  noStore(res).json({
    ok: true,
    service: "frye-market-backend",
    ts: new Date().toISOString(),
    mode: RAW_DASHBOARD_URL ? "github-raw" : "local-file",
  });
});

/* =========================
   /api/dashboard
   ========================= */
app.get("/api/dashboard", async (req, res) => {
  try {
    let json = null;
    if (RAW_DASHBOARD_URL && hasFetch) json = await fetchJson(RAW_DASHBOARD_URL);
    if (!json) json = loadLocal("data/outlook.json");
    if (!json) throw new Error("outlook.json not found (raw or local)");
    return noStore(res).json(json);
  } catch (e) {
    console.error("dashboard error:", e.message);
    // Return a safe minimal payload instead of 500 for better UX
    return noStore(res).json({
      ok: false,
      gauges: null,
      odometers: null,
      signals: null,
      outlook: { sectorCards: [] },
      meta: { ts: new Date().toISOString() },
      error: e.message,
    });
  }
});

/* =========================
   /api/source (optional raw counts)
   ========================= */
app.get("/api/source", async (req, res) => {
  try {
    let json = null;
    if (RAW_SOURCE_URL && hasFetch) json = await fetchJson(RAW_SOURCE_URL);
    if (!json) json = loadLocal("data/outlook_source.json");
    if (!json) throw new Error("outlook_source.json not found (raw or local)");
    return noStore(res).json(json);
  } catch (e) {
    console.error("source error:", e.message);
    return noStore(res).json({ ok: false, error: e.message });
  }
});

/* =========================
   Gauges routes
   - /api/gauges?index=SPY   (recommended)
   - /gauges?index=SPY       (legacy alias)
   - /api/v1/gauges?index=SPY (kept for compatibility)
   - /api/v1/gauges/index?SPY (alias)
   Returns an ARRAY for easy table rendering; never 500s.
   ========================= */
function buildGaugeRowsFromDashboard(dash, index) {
  // Tolerant of both r1.2 (pct/psi/degF) and simpler shapes
  const g = dash?.gauges || {};
  const rows = [];

  // Breadth & Momentum (prefer summary indices if present)
  const breadthIdx  = dash?.summary?.breadthIdx ?? dash?.breadthIdx ?? g?.rpm?.pct ?? null;
  const momentumIdx = dash?.summary?.momentumIdx ?? dash?.momentumIdx ?? g?.speed?.pct ?? null;

  if (breadthIdx !== null)  rows.push({ label: "Breadth",   value: Number(breadthIdx),  unit: "%",  index });
  if (momentumIdx !== null) rows.push({ label: "Momentum",  value: Number(momentumIdx), unit: "%",  index });

  // Liquidity (oil PSI) and Squeeze/Fuel
  const oilPsi  = g?.oil?.psi ?? null;
  const fuelPct = g?.fuel?.pct ?? g?.squeeze?.pct ?? null;
  if (oilPsi !== null)  rows.push({ label: "Liquidity (PSI)", value: Number(oilPsi),   unit: "psi", index });
  if (fuelPct !== null) rows.push({ label: "Squeeze (Fuel)",  value: Number(fuelPct), unit: "%",   index });

  return rows;
}

function gaugesHandler(req, res) {
  const index = (req.query.index || req.query.symbol || Object.keys(req.query)[0] || "SPY").toString();
  try {
    // Prefer local file to keep this endpoint instant; you can swap to RAW if you want.
    const dash = loadLocal("data/outlook.json");
    if (!dash) {
      // graceful empty array
      return noStore(res).json([]);
    }
    const rows = buildGaugeRowsFromDashboard(dash, index);
    return noStore(res).json(Array.isArray(rows) ? rows : []);
  } catch (e) {
    console.error("gauges error:", e.message);
    return noStore(res).json([]); // never 500 for table consumers
  }
}

app.get("/api/gauges", gaugesHandler);        // NEW recommended route
app.get("/gauges", gaugesHandler);            // Legacy alias (your old URL)
app.get("/api/v1/gauges", gaugesHandler);     // Back-compat
app.get("/api/v1/gauges/index", gaugesHandler);

/* =========================
   /api/v1/ohlc?symbol=SPY&timeframe=1h
   Dummy OHLC for chart testing
   ========================= */
app.get("/api/v1/ohlc", (req, res) => {
  const symbol = req.query.symbol || "SPY";
  const timeframe = req.query.timeframe || "1d";
  const tfSec = ({ "1m":60, "5m":300, "15m":900, "30m":1800, "1h":3600, "1d":86400 })[timeframe] || 3600;

  const now = Math.floor(Date.now() / 1000);
  const bars = [];
  let px = 640;

  for (let i = 60; i > 0; i--) {
    const t = now - i * tfSec;
    const o = px;
    const c = px + (Math.random() - 0.5) * 2;
    const h = Math.max(o, c) + Math.random();
    const l = Math.min(o, c) - Math.random();
    const v = Math.floor(1_000_000 + Math.random() * 500_000);
    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
    px = c;
  }
  return noStore(res).json({ bars, symbol, timeframe });
});

/* =========================
   Static /public (if present)
   ========================= */
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

/* =========================
   404 + error handlers
   ========================= */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* =========================
   Start
   ========================= */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- GET  /api/health
- GET  /api/dashboard
- GET  /api/source
- GET  /api/gauges?index=SPY
- GET  /gauges?index=SPY      (legacy)
- GET  /api/v1/gauges?index=SPY
- GET  /api/v1/gauges/index?SPY
- GET  /api/v1/ohlc?symbol=SPY&timeframe=1h`);
  console.log(
    `Mode: ${RAW_DASHBOARD_URL ? "github-raw" : "local-file"}${
      RAW_DASHBOARD_URL ? `\nRAW_DASHBOARD_URL=${RAW_DASHBOARD_URL}` : ""
    }${RAW_SOURCE_URL ? `\nRAW_SOURCE_URL=${RAW_SOURCE_URL}` : ""}`
  );
});
