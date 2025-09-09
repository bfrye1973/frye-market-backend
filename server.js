// server.js — Express backend (ESM) with CORS, static, and API router

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 10000;

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* =========================
   CORS: allow your frontend
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
   Static /public (if present)
   ========================= */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* =========================
   API router
   ========================= */
import buildRouter from "./api/routes.js";
app.use("/api", buildRouter());

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
- GET  /api/gauges?index=SPY
- GET  /api/v1/ohlc?symbol=SPY&timeframe=1h`);
});
