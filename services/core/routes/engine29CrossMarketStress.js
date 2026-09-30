// services/core/routes/engine29CrossMarketStress.js
// Engine 29 — persisted canonical output + manual refresh route

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { isEsGlobexSessionOpen } from "../logic/engine29/isEsGlobexSessionOpen.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "engine29-cross-market-stress.json");
const UPDATE_JOB = path.join(CORE_DIR, "jobs", "updateEngine29CrossMarketStress.js");

let ENGINE29_UPDATE_RUNNING = false;
let ENGINE29_LAST_DASHBOARD_REFRESH_MS = 0;
const ENGINE29_DASHBOARD_REFRESH_COOLDOWN_MS = 60_000;

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      missing: true,
      error: `Missing Engine 29 data file: ${filePath}`,
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const stat = fs.statSync(filePath);
    return {
      ok: true,
      data,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      missing: false,
      error: `Invalid Engine 29 JSON: ${error.message}`,
    };
  }
}

function checkToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: true };

  const got = req.header("X-ENGINE-CRON-TOKEN") || req.query.token || "";
  if (got !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

function runUpdateJob() {
  return new Promise((resolve, reject) => {
    if (ENGINE29_UPDATE_RUNNING) {
      return reject(new Error("Engine 29 update already running"));
    }

    if (!fs.existsSync(UPDATE_JOB)) {
      return reject(new Error(`Missing Engine 29 update job: ${UPDATE_JOB}`));
    }

    ENGINE29_UPDATE_RUNNING = true;

    const child = spawn(process.execPath, [UPDATE_JOB], {
      cwd: CORE_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      ENGINE29_UPDATE_RUNNING = false;
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      ENGINE29_UPDATE_RUNNING = false;

      if (code !== 0) {
        return reject(
          new Error(
            `Engine 29 update failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
          )
        );
      }

      resolve({ stdout, stderr });
    });
  });
}

function summaryFrom(data) {
  return {
    version: data?.version ?? null,
    timestamp: data?.timestamp ?? null,
    dataDegraded: Boolean(data?.dataDegraded),

    overallState: data?.overallState ?? null,
    structuralState: data?.structuralState ?? null,
    tacticalState: data?.tacticalState ?? null,
    fastTacticalState: data?.fastTacticalState ?? null,
    esNqBackdrop: data?.esNqBackdrop ?? null,

    esResolvedSymbol: data?.dataQuality?.esResolvedSymbol ?? null,
    moveCharacter: data?.moveCharacter?.moveCharacter ?? null,
    moveDirection: data?.moveCharacter?.direction ?? null,
    moveConfidence: data?.moveCharacter?.confidence ?? null,
    underlyingPressure:
      data?.moveCharacter?.underlyingPressure?.state ??
      data?.display?.underTheHood?.pressure?.state ??
      null,

    confirmations: data?.confirmations || [],
    warnings: data?.warnings || [],
    recoveries: data?.recoveries || [],
    missingConfirmations: data?.missingConfirmations || [],
    reasonCodes: data?.reasonCodes || [],

    display: data?.display || null,
  };
}

// Full canonical Engine 29 output.
router.get("/engine29/cross-market-stress", (_req, res) => {
  const result = readJsonSafe(DATA_FILE);

  if (!result.ok) {
    return res.status(503).json({
      ok: false,
      engine: "engine29.crossMarketStress.route.v1",
      error: "engine29_cross_market_stress_unavailable",
      detail: result.error,
      dataFile: DATA_FILE,
    });
  }

  return res.json({
    ok: true,
    engine: "engine29.crossMarketStress.route.v1",
    servedAt: new Date().toISOString(),
    fileModifiedAt: result.modifiedAt,
    sizeBytes: result.sizeBytes,
    data: result.data,
  });
});

// Compact payload intended for the main Frye dashboard card.
router.get("/engine29/cross-market-stress/summary", (_req, res) => {
  const result = readJsonSafe(DATA_FILE);

  if (!result.ok) {
    return res.status(503).json({
      ok: false,
      engine: "engine29.crossMarketStress.summaryRoute.v1",
      error: "engine29_cross_market_stress_unavailable",
      detail: result.error,
      dataFile: DATA_FILE,
    });
  }

  return res.json({
    ok: true,
    engine: "engine29.crossMarketStress.summaryRoute.v1",
    servedAt: new Date().toISOString(),
    fileModifiedAt: result.modifiedAt,
    sizeBytes: result.sizeBytes,
    data: summaryFrom(result.data),
  });
});

// Browser-safe dashboard refresh.
// No secret is exposed to the frontend. The route is globally coalesced and
// throttled so an open dashboard cannot create overlapping provider rebuilds.
router.post("/engine29/dashboard-refresh", async (_req, res) => {
  const nowMs = Date.now();

  if (ENGINE29_UPDATE_RUNNING) {
    return res.status(202).json({
      ok: true,
      engine: "engine29.dashboardRefresh.route.v1",
      status: "ALREADY_RUNNING",
      updateRunning: true,
    });
  }

  const ageMs =
    nowMs - ENGINE29_LAST_DASHBOARD_REFRESH_MS;

  if (
    ENGINE29_LAST_DASHBOARD_REFRESH_MS > 0 &&
    ageMs < ENGINE29_DASHBOARD_REFRESH_COOLDOWN_MS
  ) {
    return res.json({
      ok: true,
      engine: "engine29.dashboardRefresh.route.v1",
      status: "COOLDOWN",
      updateRunning: false,
      retryAfterMs:
        ENGINE29_DASHBOARD_REFRESH_COOLDOWN_MS - ageMs,
    });
  }

  ENGINE29_LAST_DASHBOARD_REFRESH_MS = nowMs;
  const startedAt = new Date(nowMs).toISOString();

  try {
    const logs = await runUpdateJob();
    const result = readJsonSafe(DATA_FILE);

    if (!result.ok) {
      throw new Error(
        result.error ||
        "Engine 29 dashboard refresh completed but output file is unavailable"
      );
    }

    return res.json({
      ok: true,
      engine: "engine29.dashboardRefresh.route.v1",
      status: "UPDATED",
      startedAt,
      finishedAt: new Date().toISOString(),
      updateRunning: ENGINE29_UPDATE_RUNNING,
      session,
      fileModifiedAt: result.modifiedAt,
      data: summaryFrom(result.data),
      logs: {
        stdoutTail: logs.stdout.slice(-2000),
        stderrTail: logs.stderr.slice(-1000),
      },
    });
  } catch (error) {
    ENGINE29_LAST_DASHBOARD_REFRESH_MS = 0;

    return res.status(500).json({
      ok: false,
      engine: "engine29.dashboardRefresh.route.v1",
      error: "engine29_dashboard_refresh_failed",
      detail: error?.message || String(error),
    });
  }
});

// Manual/cron-safe refresh. This is intentionally separate from GET routes so
// reading Engine 29 never triggers expensive provider work.
router.post("/engine29/update", async (req, res) => {
  const auth = checkToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      engine: "engine29.update.route.v1",
      error: auth.error,
    });
  }

  const force =
    String(req.query.force || "").toLowerCase() === "1" ||
    String(req.query.force || "").toLowerCase() === "true";

  const session = isEsGlobexSessionOpen(Date.now());

  if (!force && !session.open) {
    return res.json({
      ok: true,
      engine: "engine29.update.route.v1",
      status: "SKIPPED_OUTSIDE_ES_GLOBEX_SESSION",
      updateRunning: ENGINE29_UPDATE_RUNNING,
      session,
    });
  }

  if (ENGINE29_UPDATE_RUNNING) {
    return res.status(202).json({
      ok: true,
      engine: "engine29.update.route.v1",
      status: "ALREADY_RUNNING",
      updateRunning: true,
      session,
    });
  }

  const startedAt = new Date().toISOString();

  try {
    const logs = await runUpdateJob();
    const result = readJsonSafe(DATA_FILE);

    if (!result.ok) {
      throw new Error(result.error || "Engine 29 update completed but output file is unavailable");
    }

    return res.json({
      ok: true,
      engine: "engine29.update.route.v1",
      startedAt,
      finishedAt: new Date().toISOString(),
      updateRunning: ENGINE29_UPDATE_RUNNING,
      fileModifiedAt: result.modifiedAt,
      data: summaryFrom(result.data),
      logs: {
        stdoutTail: logs.stdout.slice(-4000),
        stderrTail: logs.stderr.slice(-2000),
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      engine: "engine29.update.route.v1",
      error: "engine29_update_failed",
      detail: error?.message || String(error),
    });
  }
});

export default router;
