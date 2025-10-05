// services/core/server.js
// Backend-1 (Core API) — Express entry
// ESM module (Node 18+)

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ohlcRouter } from "./routes/ohlc.js";

// ------------------------- Setup -------------------------
const app = express();

// Trust Render/Proxy IPs (needed for correct req.ip, etc.)
app.set("trust proxy", true);

// Hide framework header
app.disable("x-powered-by");

// Keep responses fresh (no stale caching at the proxy)
app.set("etag", false);

// Parse JSON bodies if you add POST routes later (safe default)
app.use(express.json({ limit: "1mb" }));

// ------------------------- CORS --------------------------
/**
 * Allow your dashboard and local dev.
 * Add more origins if you expose to other hosts.
 */
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------------- Static (optional) ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If you serve docs or a tiny status page, drop files in ./public
app.use(express.static(path.join(__dirname, "public")));

// ------------------------ Routes -------------------------
/**
 * Health/metadata
 * - /healthz      -> { ok:true }
 * - /             -> tiny index so Render shows something at root
 */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "core", ts: new Date().toISOString() });
});
app.get("/", (_req, res) => {
  res.type("text/plain").send("Frye Core API — see /api/v1/ohlc");
});

/**
 * OHLC API (mounted)
 * Implements 1m backfill (~30d) + server TF bucketing.
 * File: services/core/routes/ohlc.js
 */
app.use("/api/v1/ohlc", ohlcRouter);

// ------------------------ 404/Errors ---------------------
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// Basic error boundary (keeps JSON shape consistent)
app.use((err, _req, res, _next) => {
  console.error("[server] unhandled:", err?.stack || err);
  res
    .status(500)
    .json({ ok: false, error: "internal_error", detail: String(err?.message || err) });
});

// ------------------------- Start -------------------------
const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`[OK] core listening on :${PORT}`);
  console.log("- /healthz");
  console.log("- /api/v1/ohlc");
});

export default app;
