// services/core/routes/runShelvesJob.js
// Quick background trigger for Engine 1 + shelves on backend-1 local filesystem.
// Purpose:
// - Cron hits this fast route
// - Route immediately returns
// - Backend-1 spawns local shelves job in background
// - Files are written on backend-1 disk, not cron disk

import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");

let SHELVES_JOB_RUNNING = false;

function authOk(req) {
  const expected = process.env.ENGINE_CRON_TOKEN || "";
  if (!expected) return true; // allow if no token configured yet
  const got = String(req.headers["x-engine-cron-token"] || "");
  return got === expected;
}

router.post("/run-shelves-job", (req, res) => {
  try {
    if (!authOk(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    if (SHELVES_JOB_RUNNING) {
      return res.json({
        ok: true,
        started: false,
        skipped: true,
        reason: "already_running",
      });
    }

    SHELVES_JOB_RUNNING = true;

    const child = spawn("node", ["./jobs/runEngine1AndShelves.js"], {
      cwd: CORE_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
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
        console.log(`[run-shelves-job] SUCCESS @ ${new Date().toISOString()}`);
        if (stdout.trim()) console.log(stdout.trim());
      } else {
        console.error(
          `[run-shelves-job] FAIL @ ${new Date().toISOString()} | code=${code}`
        );
        if (stdout.trim()) console.log(stdout.trim());
        if (stderr.trim()) console.error(stderr.trim());
      }
      SHELVES_JOB_RUNNING = false;
    });

    child.on("error", (err) => {
      console.error(
        `[run-shelves-job] SPAWN ERROR @ ${new Date().toISOString()} |`,
        err?.stack || err?.message || String(err)
      );
      SHELVES_JOB_RUNNING = false;
    });

    return res.json({
      ok: true,
      started: true,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    SHELVES_JOB_RUNNING = false;
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
});

export default router;
