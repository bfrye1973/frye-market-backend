// server.js — minimal CommonJS (only 'express')
const path = require("path");
const fs = require("fs");
const express = require("express");

const app = express();

// ---- config ----
const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, "data");
const DASHBOARD_PATH = path.join(DATA_DIR, "outlook.json");
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

// ---- built-in CORS (no cors pkg) ----
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- body parsing ----
app.use(express.json({ limit: "1mb" }));

// ---- health ----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "frye-market-backend", ts: new Date().toISOString() });
});

// ---- test echo ----
app.post("/api/v1/echo", (req, res) => {
  res.json({ ok: true, youSent: req.body ?? null });
});

// ---- dashboard feed ----
app.get("/api/dashboard", (req, res) => {
  fs.readFile(DASHBOARD_PATH, "utf8", (err, txt) => {
    if (err) {
      return res.status(200).json({
        gauges: { rpm: 0, speed: 0, fuelPct: 50, waterTemp: 200, oilPsi: 70 },
        odometers: { breadthOdometer: 50, momentumOdometer: 50, squeeze: "none" },
        signals: {
          sigBreakout: { active: false, severity: "info" },
          sigDistribution: { active: false, severity: "warn" },
          sigTurbo: { active: false, severity: "info" },
          sigCompression: { active: false, severity: "info" },
          sigExpansion: { active: false, severity: "info" },
          sigDivergence: { active: false, severity: "info" },
          sigOverheat: { active: false, severity: "danger" },
          sigLowLiquidity: { active: false, severity: "warn" }
        },
        outlook: { dailyOutlook: 50, sectorCards: [] },
        meta: { ts: new Date().toISOString(), note: "fallback (outlook.json not found)" }
      });
    }
    try {
      res.json(JSON.parse(txt));
    } catch {
      res.status(500).json({ error: "invalid JSON in data/outlook.json" });
    }
  });
});

// ---- optional static ----
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

// ---- 404 + error ----
app.use((req, res) => res.status(404).json({ error: "Not Found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ---- boot ----
app.listen(PORT, () => {
  console.log(`[OK] frye-market-backend listening on :${PORT}`);
  console.log(`- GET /api/health`);
  console.log(`- GET /api/dashboard   (reads ${DASHBOARD_PATH})`);
  console.log(`- POST /api/v1/echo`);
});
