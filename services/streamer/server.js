// services/streamer/server.js
import express from "express";
import streamRouter from "./routes/stream.js";
import scalpRouter from "./routes/scalp.js";
import { startEngine5B } from "./engine5b/runner.js";

const app = express();
app.disable("x-powered-by");
app.set("etag", false);

/**
 * CORS (SSE/EventSource-safe)
 */
const ALLOWED_ORIGINS = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
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

// Stream routes
app.use("/stream", streamRouter);

// Engine5B routes (status + events)
app.use("/stream", scalpRouter);

// ✅ Start Engine 5B background runner (monitor by default)
startEngine5B({ log: console.log });

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] streamer listening on :${PORT}`);
});
