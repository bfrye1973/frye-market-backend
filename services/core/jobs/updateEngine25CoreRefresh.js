// services/core/jobs/updateEngine25CoreRefresh.js
//
// Engine 25 Core Refresh Wrapper
// Runs the known-good Engine 25 Core/EOD refresh chain:
// 1. updateEngine25HistoricalReplayFull.js
// 2. buildEngine25CompositeOverlay6mo.js
// 3. buildEngine25EsZoneAwareRead.js
//
// Then validates required files and the full-dashboard route.
//
// This job is designed for cron:
// cd /opt/render/project/src/services/core && node jobs/updateEngine25CoreRefresh.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const BACKEND_BASE =
  process.env.ENGINE25_BACKEND_BASE ||
  process.env.CORE_BASE ||
  process.env.BACKEND_BASE ||
  "https://frye-market-backend-1.onrender.com";

const FULL_DASHBOARD_URL = `${BACKEND_BASE.replace(
  /\/+$/,
  ""
)}/api/v1/engine25/full-dashboard`;

const STEPS = [
  {
    label: "Historical full replay",
    job: "updateEngine25HistoricalReplayFull.js",
  },
  {
    label: "Composite overlay 6mo",
    job: "buildEngine25CompositeOverlay6mo.js",
  },
  {
    label: "ES zone-aware read",
    job: "buildEngine25EsZoneAwareRead.js",
  },
  {
    label: "ES strategy snapshot with Engine 25 context",
    job: "buildStrategySnapshot.js",
    env: {
      SYMBOL: "ES",
    },
  },
];

const REQUIRED_FILES = [
  "engine25-historical-replay-macro-distribution-breadth-6mo.json",
  "engine25-composite-overlay-6mo.json",
  "engine25-es-zone-aware-read.json",
  "strategy-snapshot-es.json",
];

function nowIso() {
  return new Date().toISOString();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function assertFileExists(relativeFile) {
  const filePath = path.join(DATA_DIR, relativeFile);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required Engine 25 file: ${filePath}`);
  }

  const stat = fs.statSync(filePath);

  if (!stat.size || stat.size <= 0) {
    throw new Error(`Engine 25 file is empty: ${filePath}`);
  }

  console.log(
    `[Engine25 Core Refresh] Verified ${relativeFile} (${formatBytes(
      stat.size
    )})`
  );

  return {
    file: relativeFile,
    path: filePath,
    sizeBytes: stat.size,
  };
}

function runStep(step, index) {
  const jobPath = path.join(__dirname, step.job);

  if (!fs.existsSync(jobPath)) {
    throw new Error(`Missing job file: ${jobPath}`);
  }

  console.log("");
  console.log("--------------------------------------------------");
  console.log(
    `[Engine25 Core Refresh] Step ${index + 1}/${STEPS.length}: ${step.label}`
  );
  console.log(`[Engine25 Core Refresh] Running: node jobs/${step.job}`);
  console.log("--------------------------------------------------");

  const started = Date.now();

   const result = spawnSync(process.execPath, [jobPath], {
     cwd: CORE_DIR,
     stdio: "inherit",
     env: {
       ...process.env,
       ...(step.env || {}),
     },
   });

  const durationSec = ((Date.now() - started) / 1000).toFixed(1);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `[Engine25 Core Refresh] Step failed: ${step.label} (${step.job}) exit=${result.status}`
    );
  }

  console.log(
    `[Engine25 Core Refresh] Step complete: ${step.label} (${durationSec}s)`
  );
}

async function validateFullDashboardRoute() {
  console.log("");
  console.log("--------------------------------------------------");
  console.log("[Engine25 Core Refresh] Validating full-dashboard route");
  console.log(`[Engine25 Core Refresh] URL: ${FULL_DASHBOARD_URL}`);
  console.log("--------------------------------------------------");

  const res = await fetch(FULL_DASHBOARD_URL, { cache: "no-store" });
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Full-dashboard route returned invalid JSON HTTP ${res.status}: ${text.slice(
        0,
        500
      )}`
    );
  }

  if (!res.ok || json?.ok !== true) {
    throw new Error(
      `Full-dashboard route failed HTTP ${res.status}: ${JSON.stringify(
        {
          ok: json?.ok,
          error: json?.error,
          headline: json?.headline,
        },
        null,
        2
      )}`
    );
  }

  const overlayRows = Array.isArray(json?.overlay?.rows)
    ? json.overlay.rows.length
    : 0;

  const score = json?.headline?.score;

  if (!overlayRows || overlayRows <= 0) {
    throw new Error(
      `Full-dashboard route has no overlay rows: overlayRows=${overlayRows}`
    );
  }

  if (!Number.isFinite(Number(score))) {
    throw new Error(
      `Full-dashboard route missing headline.score: ${JSON.stringify(
        json?.headline || null,
        null,
        2
      )}`
    );
  }

  const lastOverlay = json.overlay.rows[overlayRows - 1] || null;

  console.log("[Engine25 Core Refresh] Route validation OK:");
  console.log(
    JSON.stringify(
      {
        ok: json.ok,
        headline: json.headline,
        overlayRows,
        lastOverlay: lastOverlay
          ? {
              date: lastOverlay.date,
              esClose: lastOverlay.esClose,
              score: lastOverlay.engine25CompositeScore,
              state: lastOverlay.overlayState,
              permission: lastOverlay.permissions?.finalPermission || null,
            }
          : null,
      },
      null,
      2
    )
  );

  return {
    ok: true,
    headline: json.headline,
    overlayRows,
    lastOverlay,
  };
}

async function main() {
  const startedAt = nowIso();
  const startedMs = Date.now();

  console.log("========================================");
  console.log("[Engine25 Core Refresh] Starting");
  console.log("========================================");
  console.log("[Engine25 Core Refresh] Started:", startedAt);
  console.log("[Engine25 Core Refresh] Node:", process.version);
  console.log("[Engine25 Core Refresh] Core dir:", CORE_DIR);
  console.log("[Engine25 Core Refresh] Data dir:", DATA_DIR);
  console.log("[Engine25 Core Refresh] Backend base:", BACKEND_BASE);

  ensureDataDir();

  try {
    for (let i = 0; i < STEPS.length; i += 1) {
      runStep(STEPS[i], i);
    }

    console.log("");
    console.log("--------------------------------------------------");
    console.log("[Engine25 Core Refresh] Validating required files");
    console.log("--------------------------------------------------");

    const fileValidation = REQUIRED_FILES.map(assertFileExists);

    let routeValidation = {
      ok: false,
      headline: null,
      overlayRows: null,
      lastOverlay: null,
      warningOnly: true,
     warning: null,
   };

   try {
     routeValidation = await validateFullDashboardRoute();
   } catch (err) {
     routeValidation.warning = String(err?.message || err || "UNKNOWN_ROUTE_VALIDATION_WARNING");
     console.warn(
       "[Engine25 Core Refresh] Public full-dashboard route validation warning only:",
       routeValidation.warning
     );
   }
    const finishedAt = nowIso();
    const durationSec = ((Date.now() - startedMs) / 1000).toFixed(1);

    console.log("");
    console.log("========================================");
    console.log("[Engine25 Core Refresh] COMPLETE");
    console.log("========================================");
    console.log(
      JSON.stringify(
        {
          ok: true,
          engine: "engine25.coreRefresh.v0.1",
          startedAt,
          finishedAt,
          durationSec: Number(durationSec),
          files: fileValidation.map((item) => ({
            file: item.file,
            sizeBytes: item.sizeBytes,
          })),
          route: {
            ok: routeValidation.ok,
            headline: routeValidation.headline,
            overlayRows: routeValidation.overlayRows,
            lastOverlay: routeValidation.lastOverlay
              ? {
                  date: routeValidation.lastOverlay.date,
                  esClose: routeValidation.lastOverlay.esClose,
                  score:
                    routeValidation.lastOverlay.engine25CompositeScore ?? null,
                  state: routeValidation.lastOverlay.overlayState ?? null,
                  permission:
                    routeValidation.lastOverlay.permissions?.finalPermission ??
                    null,
                }
              : null,
          },
        },
        null,
        2
      )
    );

    process.exit(0);
  } catch (err) {
    const finishedAt = nowIso();
    const durationSec = ((Date.now() - startedMs) / 1000).toFixed(1);

    console.error("");
    console.error("========================================");
    console.error("[Engine25 Core Refresh] FAILED");
    console.error("========================================");
    console.error(
      JSON.stringify(
        {
          ok: false,
          engine: "engine25.coreRefresh.v0.1",
          startedAt,
          finishedAt,
          durationSec: Number(durationSec),
          error: err?.message || String(err),
          stack: err?.stack || null,
        },
        null,
        2
      )
    );

    process.exit(1);
  }
}

main();
