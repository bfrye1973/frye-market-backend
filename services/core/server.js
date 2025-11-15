// services/core/server.js
// Backend-1 (Core API) — Express entry (ESM)

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ohlcRouter } from "./routes/ohlc.js";
import liveRouter from "./routes/live.js";   // ✅ live router
import sectorcards10mRouter from "./routes/sectorcards-10m.js"; // ✅ NEW

// --- App setup ---
const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.set("etag", false);
app.use(express.json({ limit: "1mb" }));

// --- CORS (dashboard + local dev) ---
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000",
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Static (optional) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// --- Health endpoints ---
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "core", ts: new Date().toISOString() })
);

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "core", ts: new Date().toISOString() })
);

// --- Root splash ---
app.get("/", (_req, res) => {
  res.type("text/plain").send("Frye Core API — see /api/v1/ohlc and /live");
});

// --- API routes ---
app.use("/api/v1/ohlc", ohlcRouter);
app.use("/api/sectorcards-10m", sectorcards10mRouter); // ✅ NEW
app.use("/live", liveRouter);  // ✅ still active

// --- 404 / errors ---
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.path })
);
app.use((err, _req, res, _next) => {
  console.error("[server] unhandled:", err?.stack || err);
  res.status(500).json({
    ok: false,
    error: "internal_error",
    detail: String(err?.message || err),
  });
});

// --- Start ---
const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`[OK] core listening on :${PORT}`);
  console.log("- /api/health  (Render healthcheck)");
  console.log("- /healthz");
  console.log("- /api/v1/ohlc");
  console.log("- /api/sectorcards-10m"); // ✅ NEW
  console.log("- /live  (GitHub JSON proxies)");
});

export default app;
