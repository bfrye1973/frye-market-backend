// server.js — ESM Express host with restricted CORS, static JSON mounts, and API routes

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import buildRouter from "./api/routes.js";

const app = express();
const PORT = process.env.PORT || 10000;

/* Resolve __dirname in ESM */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------- CORS (Restricted: dashboard + localhost) ---------- */
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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Cache-Control, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ---------- Helpful middlewares ---------- */
// If you later POST JSON, uncomment:
// app.use(express.json());

/* ---------- /public (optional) ---------- */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* ---------- Static JSON mounts (live + hourly + EOD) ---------- */
const LIVE10_DIR  = path.join(__dirname, "data-live-10min");
const HOURLY_DIR  = path.join(__dirname, "data-live-hourly");
const EOD_DIR     = path.join(__dirname, "data-live-eod");

// Avoid stale caching on these JSONs
function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

app.use("/data-live-10min",  noStore, express.static(LIVE10_DIR));
app.use("/data-live-hourly", noStore, express.static(HOURLY_DIR));
app.use("/data-live-eod",    noStore, express.static(EOD_DIR));

/* ---------- API ---------- */
app.use("/api", buildRouter());

/* ---------- Health probe (optional, simple) ---------- */
app.get("/healthz", (req, res) => res.json({ ok: true }));

/* ---------- 404 + errors ---------- */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- GET  /api/health
- GET  /api/dashboard
- GET  /api/gauges?index=SPY
- GET  /api/v1/ohlc?symbol=SPY&timeframe=1h
- GET  /data-live-10min/outlook_intraday.json
- GET  /data-live-eod/outlook.json`);
});
