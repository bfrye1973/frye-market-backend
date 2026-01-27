// services/core/server.js
// Backend-1 (Core API) — Express entry (ESM)

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import { ohlcRouter } from "./routes/ohlc.js";
import liveRouter from "./routes/live.js"; // ✅ live router
import sectorcards10mRouter from "./routes/sectorcards-10m.js"; // ✅ sectorcards

import smzLevels from "./routes/smzLevels.js"; // ✅ Smart Money levels API
import smzShelves from "./routes/smzShelves.js"; // ✅ Accum/Dist shelves API
import smzHierarchy from "./routes/smzHierarchy.js";
import { engine5ContextRouter } from "./routes/engine5Context.js";
import { reactionScoreRouter } from "./routes/reactionScore.js";
import { volumeBehaviorRouter } from "./routes/volumeBehavior.js";
import { confluenceScoreRouter } from "./routes/confluenceScore.js";
import tradingRouter from "./routes/trading.js";
import optionsRouter from "./routes/options.js";
import runAllEngines from "./routes/runAllEngines.js";



// ✅ Engine 2 (Fib) — IMPORTANT: this is a NAMED export, not default
import { fibLevelsRouter } from "./routes/fibLevels.js";

// ✅ Engine 6 (Trade Permission)
import { tradePermissionRouter } from "./routes/tradePermission.js";

// --- App setup ---
const app = express();

// WHO AM I TEST ROUTE
app.get("/__whoami", (req, res) => {
  res.json({
    backend: "BACKEND-CORE-R12.8",
    ts: new Date().toISOString(),
  });
});

app.set("trust proxy", true);
app.disable("x-powered-by");
app.set("etag", false);
app.use(express.json({ limit: "1mb" }));

// --- CORS (dashboard + local dev) ---
// ✅ Deterministic: echo Origin if present, else "*"
// This prevents "OPTIONS 204 ok, GET blocked" due to origin mismatches.
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Echo origin for browser fetch; fallback to wildcard for curl/direct loads.
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Idempotency-Key"
  );

  // If you ever use cookies/credentials in fetch, uncomment:
  // (Do NOT combine Allow-Credentials with "*"; echoing origin makes it safe)
  // if (origin) res.setHeader("Access-Control-Allow-Credentials", "true");

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
// Existing routes
app.use("/api/v1/ohlc", ohlcRouter);
app.use("/api/sectorcards-10m", sectorcards10mRouter); // ✅ sectorcards adapter
app.use("/live", liveRouter); // ✅ GitHub JSON proxies
app.use("/api/v1/smz-levels", smzLevels); // ✅ Smart Money levels
app.use("/api/v1/smz-shelves", smzShelves); // ✅ Accumulation / Distribution shelves
app.use("/api/v1/smz-hierarchy", smzHierarchy);
app.use("/api/trading", tradingRouter);
app.use("/api/v1/options", optionsRouter);
app.use("/api/v1", runAllEnginesRouter); 



// Routers mounted under /api/v1
app.use("/api/v1", engine5ContextRouter);
app.use("/api/v1", fibLevelsRouter);
app.use("/api/v1", reactionScoreRouter);
app.use("/api/v1", volumeBehaviorRouter);
app.use("/api/v1", confluenceScoreRouter);

// 🔒 HARD CORS GUARANTEE for Strategy endpoint
app.use("/api/v1/confluence-score", (req, res, next) => {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://frye-dashboard.onrender.com"
  );
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Idempotency-Key"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});


// ✅ Engine 6 route mount
app.use("/api/v1", tradePermissionRouter);

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
  console.log("- /api/sectorcards-10m");
  console.log("- /api/v1/smz-levels");
  console.log("- /api/v1/smz-shelves");
  console.log("- /api/v1/smz-hierarchy");
  console.log("- /api/v1/fib-levels");
  console.log("- /api/v1/confluence-score");
  console.log("- /api/v1/trade-permission   ✅ Engine 6");
  console.log("- /live  (GitHub JSON proxies)");
});

export default app;
