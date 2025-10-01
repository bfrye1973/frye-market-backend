// server.js — full Express server with OHLC + LIVE routes

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRouter from "./api/routes.js";
import { ohlcRouter } from "./routes/ohlc.js";
import { liveRouter } from "./routes/live.js";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------------- CORS ---------------- */
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Cache-Control, Authorization, X-Requested-With, X-Idempotency-Key"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

/* ---------- Static Public ---------- */
app.use(express.static(path.join(__dirname, "public")));

/* ---------- OHLC & API ---------- */
app.use("/api/v1/ohlc", ohlcRouter);
app.use("/api/v1/live", liveRouter);
app.use("/api", apiRouter);

/* ---------- Health ---------- */
app.get("/healthz", (req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

/* ---------- 404 & Error ---------- */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}`);
});
