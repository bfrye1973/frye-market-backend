// server.js — ESM Express host with wide-open CORS (for testing), static, and API routes

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import buildRouter from "./api/routes.js";

const app = express();
const PORT = process.env.PORT || 10000;

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* CORS (TEMP: wide-open + preflight headers allowed) */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);   // echo origin
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Vary", "Origin");

  // Methods your app uses
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  // IMPORTANT: allow headers that triggered the block (Cache-Control) + common ones
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Cache-Control, Authorization, X-Requested-With"
  );

  // If you ever send cookies, uncomment:
  // res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.sendStatus(204); // preflight OK
  next();
});

/* Static /public (optional) */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* API */
app.use("/api", buildRouter());

/* 404 + errors */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* Start */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- GET  /api/health
- GET  /api/dashboard
- GET  /api/gauges?index=SPY
- GET  /api/v1/ohlc?symbol=SPY&timeframe=1h`);
});
