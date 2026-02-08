// services/streamer/server.js
import express from "express";
import streamRouter from "./routes/stream.js";
import scalpRouter from "./routes/scalp.js";
import { startEngine5B } from "./engine5b/runner.js";

const app = express();

/* -------------------------------------------------
   Core server hardening
-------------------------------------------------- */
app.disable("x-powered-by");
app.set("etag", false);

/* -------------------------------------------------
   CORS (STRICTLY SSE / EventSource SAFE)
   - Required for browser EventSource
   - Render + Cloudflare compatible
-------------------------------------------------- */
const ALLOWED_ORIGINS = new Set([
  "https://frye-dashboard.onrender.com",
  "https://frye-dashboard-web.onrender.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function applyCors(req, res) {
  const origin = req.headers.origin;

  // Explicitly reflect allowed origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  // EventSource MUST NOT use credentials
  res.setHeader("Access-Control-Allow-Credentials", "false");

  // Minimal, safe headers for SSE
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Prevent proxy caching / buffering
  res.setHeader("Cache-Control", "no-store");
}

/**
 * Global middleware
 * IMPORTANT:
 * - Do NOT block SSE with aggressive OPTIONS logic
 * - OPTIONS returns 204 only (no body)
 */
app.use((req, res, next) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* -------------------------------------------------
   Health check
-------------------------------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "streamer" });
});

/* -------------------------------------------------
   Stream routes
   NOTE: streamRouter MUST set:
   - Content-Type: text/event-stream
   - Connection: keep-alive
   - Cache-Control: no-store, no-transform
-------------------------------------------------- */
app.use("/stream", streamRouter);

/* -------------------------------------------------
   Engine 5B routes (status + events)
-------------------------------------------------- */
app.use("/stream", scalpRouter);

/* -------------------------------------------------
   Background runner (Engine 5B)
-------------------------------------------------- */
startEngine5B({ log: console.log });

/* -------------------------------------------------
   Server listen
-------------------------------------------------- */
const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] streamer listening on :${PORT}`);
});
