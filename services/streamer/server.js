// services/streamer/server.js
import express from "express";
import streamRouter from "./routes/stream.js";
import scalpRouter from "./routes/scalp.js";
import { startEngine5B } from "./engine5b/runner.js";
import { pushoverTestRouter } from "./routes/pushoverTest.js";


const app = express();

/* -------------------------------------------------
   Core server hardening
-------------------------------------------------- */
app.disable("x-powered-by");
app.set("etag", false);
app.set("trust proxy", true);

/* -------------------------------------------------
   CORS — EVENTSOURCE PERFECT
   (Render + Cloudflare safe)
-------------------------------------------------- */
const ALLOWED_ORIGINS = new Set([
  "https://frye-dashboard.onrender.com",
  "https://frye-dashboard-web.onrender.com", // ⬅️ THIS WAS THE MISSING ONE
  "http://localhost:5173",
  "http://localhost:3000",
]);

app.use((req, res, next) => {   
  const origin = req.headers.origin;
 

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    // MUST match exactly for EventSource
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  // EventSource rules
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Prevent proxy buffering / caching
  res.setHeader("Cache-Control", "no-store");

  // Preflight must not block SSE
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
-------------------------------------------------- */
app.use("/stream", streamRouter);

/* -------------------------------------------------
   Engine 5B routes
-------------------------------------------------- */
app.use("/stream", scalpRouter);
app.use("/api/v1", pushoverTestRouter);

/* -------------------------------------------------
   Background runner
-------------------------------------------------- */
startEngine5B({ log: console.log });

/* -------------------------------------------------
   Listen
-------------------------------------------------- */
const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] streamer listening on :${PORT}`);
});
