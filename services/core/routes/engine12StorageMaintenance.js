// services/core/routes/engine12StorageMaintenance.js
// Protected Engine 12 storage-maintenance endpoint.
//
// Contract:
// - Separate from the existing Replay/run-all-engines cadence.
// - Intended for the approved once-daily 00:15 America/Phoenix schedule.
// - Requires ENGINE_CRON_TOKEN unconditionally (fail closed if missing).
// - Accepts auth only from the X-ENGINE-CRON-TOKEN request header.
// - Never accepts the token from the URL/query string.
// - Defaults to dry-run.
// - Live deletion additionally requires BOTH an explicit live request and
//   ENGINE12_RETENTION_ENABLED=true inside cleanupEsReplayRetention.js.

import crypto from "crypto";
import express from "express";
import { runReplayRetention } from "../jobs/cleanupEsReplayRetention.js";

const router = express.Router();

let IS_RUNNING = false;

function constantTimeEqual(a, b) {
  const aBuf = Buffer.from(String(a ?? ""), "utf8");
  const bBuf = Buffer.from(String(b ?? ""), "utf8");

  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function checkToken(req) {
  const expected = String(process.env.ENGINE_CRON_TOKEN ?? "").trim();

  // Fail closed when production auth is not configured.
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "ENGINE12_CRON_AUTH_NOT_CONFIGURED",
    };
  }

  const got = String(req.header("X-ENGINE-CRON-TOKEN") ?? "");

  if (!got || !constantTimeEqual(got, expected)) {
    return {
      ok: false,
      status: 401,
      error: "UNAUTHORIZED",
    };
  }

  return { ok: true };
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
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
      error: auth.error,
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
