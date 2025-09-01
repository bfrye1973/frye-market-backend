// server.js  — CommonJS build, Render-friendly
// --------------------------------------------------
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const DATA_DIR = path.join(__dirname, "data");
const DASHBOARD_PATH = path.join(DATA_DIR, "outlook.json"); // <- our payload lives here

// ---------- Middleware ----------
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));
app.use(compression());

// ---------- Health / meta ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "frye-market-backend", ts: new Date().toISOString() });
});

app.get("/api/version", (req, res) => {
  // optionally read from package.json if you want; hardcode simple response for now
  res.json({ version: "v1", node: process.version });
});

// ---------- Simple echo for POST tests ----------
app.post("/api/v1/echo", (req, res) => {
  res.json({ ok: true, youSent: req.body ?? null });
});

// ---------- Dashboard feed ----------
app.get("/api/dashboard", (req, res) => {
  fs.readFile(DASHBOARD_PATH, "utf8", (err, txt) => {
    if (err) {
      // Fallback: return a tiny, valid payload so frontend never hard-crashes
      return res.status(200).json({
        gauges: { rpm: 0, speed: 0, fuelPct: 50, waterTemp: 200, oilPsi: 70 },
        odometers: { breadthOdometer: 50, momentumOdometer: 50, squeeze: "none" },
        signals: {
          sigBreakout: { active: false, severity: "info" },
          sigDistribution: { active: false, severity: "info" },
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
      const payload = JSON.parse(txt);
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: "invalid JSON in data/outlook.json" });
    }
  });
});

// ---------- Static (optional): serve /public if present ----------
const PUBLIC_DIR = path.join(__dirname, "public");
try {
  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
  }
} catch (_) { /* ignore */ }

// ---------- 404 + error handler ----------
app.use((req, res) => res.status(404).json({ error: "Not Found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ---------- Boot ----------
app.listen(PORT, () => {
  console.log(`[OK] frye-market-backend listening on :${PORT}`);
  console.log(`- GET /api/health`);
  console.log(`- GET /api/dashboard   (reads ${DASHBOARD_PATH})`);
  console.log(`- POST /api/v1/echo`);
});
