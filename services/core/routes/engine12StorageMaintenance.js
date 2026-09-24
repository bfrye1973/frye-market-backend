// services/core/routes/engine12StorageMaintenance.js
// Protected Engine 12 storage-maintenance endpoint.
//
// Contract:
// - Separate from the existing Replay/run-all-engines cadence.
// - Intended for the approved once-daily 00:15 America/Phoenix schedule.
// - Uses the same ENGINE_CRON_TOKEN auth pattern as scheduled engine routes.
// - Defaults to dry-run.
// - Live deletion additionally requires BOTH an explicit live request and
//   ENGINE12_RETENTION_ENABLED=true inside cleanupEsReplayRetention.js.

import express from "express";
import { runReplayRetention } from "../jobs/cleanupEsReplayRetention.js";

const router = express.Router();

let IS_RUNNING = false;

function checkToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: true };

  const got =
    req.header("X-ENGINE-CRON-TOKEN") ||
    req.query.token ||
    "";

  if (got !== expected) {
    return {
      ok: false,
      status: 401,
      msg: "Unauthorized",
    };
  }

  return { ok: true };
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(
    String(value ?? "").trim()
  );
}

function liveRequested(req) {
  const mode = String(
    req.body?.mode ??
    req.query?.mode ??
    ""
  ).trim().toLowerCase();

  return (
    mode === "live" ||
    parseBoolean(req.body?.live) ||
    parseBoolean(req.query?.live)
  );
}

function handle(req, res) {
  const auth = checkToken(req);

  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      error: auth.msg,
    });
  }

  if (IS_RUNNING) {
    return res.status(409).json({
      ok: false,
      skipped: true,
      reason: "ENGINE12_MAINTENANCE_ALREADY_RUNNING",
      atUtc: new Date().toISOString(),
    });
  }

  IS_RUNNING = true;

  try {
    const runLive = liveRequested(req);

    const result = runReplayRetention({
      dryRun: !runLive,
    });

    return res.status(result.ok ? 200 : 500).json({
      ...result,
      requestedMode: runLive ? "LIVE" : "DRY_RUN",
    });
  } catch (error) {
    console.error(
      "[engine12-storage-maintenance] unhandled:",
      error?.stack || error?.message || String(error)
    );

    return res.status(500).json({
      ok: false,
      error: "ENGINE12_STORAGE_MAINTENANCE_FAILED",
      detail: String(error?.message || error),
      atUtc: new Date().toISOString(),
    });
  } finally {
    IS_RUNNING = false;
  }
}

router.get("/engine12/storage-maintenance", handle);
router.post("/engine12/storage-maintenance", handle);

export default router;
