// services/streamer/server.js

import express from "express";
import streamRouter from "./routes/stream.js";

const app = express();
app.disable("x-powered-by");
app.set("etag", false);

/**
 * CORS (SSE/EventSource-safe)
 * - EventSource requires Access-Control-Allow-Origin (no wildcards if credentials are used; we don't use creds)
 * - We allow Render frontend + localhost for dev
 * - We also handle OPTIONS preflight (some proxies / setups trigger it)
 */
const ALLOWED_ORIGINS = new Set([
  "https://frye-dashboard.onrender.com",
  // add your custom domain here if/when you use it:
  // "https://tradingpoweredbyai.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function applyCors(req, res) {
  const origin = req.headers.origin;

  // If request has an Origin and it's allowed, echo it back (best practice)
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  // Minimal headers for SSE + normal GETs
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "streamer" })
);

/**
 * IMPORTANT: For SSE, avoid any middleware that buffers responses.
 * (We aren't using compression here, but leaving this comment for future.)
 *
 * If you later add compression globally, do NOT apply it to /stream/*
 */

// Stream routes
app.use("/stream", streamRouter);

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] streamer listening on :${PORT}`);
});
