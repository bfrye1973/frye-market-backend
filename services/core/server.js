// services/core/server.js
// Backend-1 (Core API) — Express entry (ESM)

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

import { ohlcRouter } from "./routes/ohlc.js";
import liveRouter from "./routes/live.js";
import sectorcards10mRouter from "./routes/sectorcards-10m.js";

import smzLevels from "./routes/smzLevels.js";
import smzShelves from "./routes/smzShelves.js";
import smzHierarchy from "./routes/smzHierarchy.js";

import { engine5ContextRouter } from "./routes/engine5Context.js";
import { reactionScoreRouter } from "./routes/reactionScore.js";
import { volumeBehaviorRouter } from "./routes/volumeBehavior.js";
import { confluenceScoreRouter } from "./routes/confluenceScore.js";
import dashboardSnapshotRouter from "./routes/dashboardSnapshot.js";
import replayRouter from "./routes/replay.js";
import { scalpStatusRouter } from "./routes/scalpStatus.js";
import { alertsRouter } from "./routes/alerts.js";
import marketNarratorRouter from "./routes/marketNarrator.js";
import marketNarratorAIRouter from "./routes/marketNarratorAI.js";
import drawingsRouter from "./routes/drawings.js";
import optionsScalpRouter from "./routes/optionsScalp.js";
import tradingRouter from "./routes/trading.js";
import { momentumContextRouter } from "./routes/momentumContext.js";
import scalpLabRouter from "./routes/scalpLab.js";

import runAllEnginesRouter from "./routes/runAllEngines.js";
import { fibLevelsRouter } from "./routes/fibLevels.js";
import { tradePermissionRouter } from "./routes/tradePermission.js";
import { morningFibRouter } from "./routes/morningFib.js";
import chartOverlayRouter from "./routes/chartOverlay.js";
import tradeJournalRouter from "./routes/tradeJournal.js";
import { engine15AlertsRouter } from "./routes/engine15Alerts.js";
import runShelvesJobRouter from "./routes/runShelvesJob.js";

// --- App setup ---
const app = express();

// --- Paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const engine21AlignmentRoute = require("./routes/engine21Alignment");

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

// --- CORS ---
app.use((req, res, next) => {
  const origin = req.headers.origin;

  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST,PUT,DELETE");

  const reqHdrs = req.headers["access-control-request-headers"];
  res.setHeader(
    "Access-Control-Allow-Headers",
    reqHdrs ||
      [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Idempotency-Key",
        "X-ENGINE-CRON-TOKEN",
      ].join(", ")
  );

  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Static (optional) ---
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
app.use("/api/sectorcards-10m", sectorcards10mRouter);
app.use("/live", liveRouter);

app.use("/api/v1/smz-levels", smzLevels);
app.use("/api/v1/smz-shelves", smzShelves);
app.use("/api/v1/smz-hierarchy", smzHierarchy);

app.use("/api/trading", tradingRouter);

app.use("/api/v1", engine5ContextRouter);
app.use("/api/v1", fibLevelsRouter);
app.use("/api/v1", reactionScoreRouter);
app.use("/api/v1", volumeBehaviorRouter);
app.use("/api/v1", confluenceScoreRouter);
app.use("/api/v1", momentumContextRouter);
app.use("/api/v1", dashboardSnapshotRouter);
app.use("/api/v1", replayRouter);
app.use("/api/v1", scalpStatusRouter);
app.use("/api/v1/alerts", alertsRouter);
app.use("/api/v1", marketNarratorRouter);
app.use("/api/v1", marketNarratorAIRouter);
app.use("/api/v1", drawingsRouter);
app.use("/api/v1/options", optionsScalpRouter);
app.use("/api/v1", scalpLabRouter);
app.use("/api/v1", morningFibRouter);
app.use("/api/v1", chartOverlayRouter);
app.use("/api/v1", tradeJournalRouter);
app.use("/api/v1", runShelvesJobRouter);
app.use("/api/v1", runAllEnginesRouter);
app.use("/api/v1", tradePermissionRouter);
app.use("/api/v1", engine15AlertsRouter);
app.use("/api/v1", engine21AlignmentRoute);


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

// --- Startup snapshot helper ---
let STARTUP_SNAPSHOT_RUNNING = false;

function runStartupSnapshotBuild() {
  if (STARTUP_SNAPSHOT_RUNNING) {
    console.log("[startup-snapshot] skipped: already running");
    return;
  }

  STARTUP_SNAPSHOT_RUNNING = true;
  const startedAt = new Date().toISOString();
  console.log(`[startup-snapshot] START @ ${startedAt}`);

  const child = spawn("node", ["./jobs/buildStrategySnapshot.js"], {
    cwd: __dirname,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (d) => {
    stdout += d.toString();
  });

  child.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  child.on("close", (code) => {
    if (code === 0) {
      console.log(`[startup-snapshot] SUCCESS @ ${new Date().toISOString()}`);
      if (stdout.trim()) console.log(stdout.trim());
    } else {
      console.error(
        `[startup-snapshot] FAIL @ ${new Date().toISOString()} | code=${code}`
      );
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.error(stderr.trim());
    }
    STARTUP_SNAPSHOT_RUNNING = false;
  });

  child.on("error", (err) => {
    console.error(
      `[startup-snapshot] SPAWN ERROR @ ${new Date().toISOString()} |`,
      err?.stack || err?.message || String(err)
    );
    STARTUP_SNAPSHOT_RUNNING = false;
  });
}

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
  console.log("- /api/v1/dashboard-snapshot");
  console.log("- /api/v1/run-all-engines   ✅ cron trigger");
  console.log("- /api/v1/trade-permission  ✅ Engine 6");
  console.log("- /live  (GitHub JSON proxies)");

  // Build snapshot after server is already listening
  setTimeout(() => {
    runStartupSnapshotBuild();
  }, 1500);
});

export default app;
