import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const STEPS = [
  {
    name: "engine25_historical_full_replay",
    job: "updateEngine25HistoricalReplayFull.js",
  },
  {
    name: "engine25_composite_overlay_6mo",
    job: "buildEngine25CompositeOverlay6mo.js",
  },
  {
    name: "engine25_es_zone_aware_read",
    job: "buildEngine25EsZoneAwareRead.js",
  },
  {
    name: "engine25_sector_card_proxy_breadth",
    job: "snapshotEngine25SectorCardBreadth.js",
  },
  {
    name: "engine25_zone_classification",
    job: "buildEngine25ZoneClassification.js",
  },
];

const REQUIRED_FILES = [
  "engine25-historical-replay-macro-distribution-breadth-6mo.json",
  "engine25-composite-overlay-6mo.json",
  "engine25-es-zone-aware-read.json",
  "engine25-sector-card-breadth-snapshots.json",
  "engine25-zone-classification.json",
];

let IS_RUNNING = false;

function nowIso() {
  return new Date().toISOString();
}

function tail(str, max = 12000) {
  return String(str || "").slice(-max);
}

function checkToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: true };

  const got = req.header("X-ENGINE-CRON-TOKEN") || req.query.token || "";

  if (got !== expected) {
    return { ok: false, status: 401, msg: "Unauthorized" };
  }

  return { ok: true };
}

function runStep(step) {
  return new Promise((resolve) => {
    const jobPath = path.join(CORE_DIR, "jobs", step.job);
    const startedMs = Date.now();

    if (!fs.existsSync(jobPath)) {
      return resolve({
        name: step.name,
        code: 404,
        stdout: "",
        stderr: `Missing job file: ${jobPath}`,
        startedAt: new Date(startedMs).toISOString(),
        endedAt: nowIso(),
        elapsedMs: Date.now() - startedMs,
      });
    }

    console.log(`[engine25-refresh] START ${step.name} @ ${nowIso()}`);

    const child = spawn(process.execPath, [jobPath], {
      cwd: CORE_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;

      resolve({
        name: step.name,
        code: 999,
        stdout,
        stderr: `${stderr}\n${err?.stack || err?.message || String(err)}`,
        startedAt: new Date(startedMs).toISOString(),
        endedAt: nowIso(),
        elapsedMs: Date.now() - startedMs,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;

      const result = {
        name: step.name,
        code: Number.isInteger(code) ? code : 1,
        stdout,
        stderr,
        startedAt: new Date(startedMs).toISOString(),
        endedAt: nowIso(),
        elapsedMs: Date.now() - startedMs,
      };

      console.log(
        `[engine25-refresh] END ${step.name} @ ${result.endedAt} code=${result.code} elapsedMs=${result.elapsedMs}`
      );

      resolve(result);
    });
  });
}

function validateFiles() {
  return REQUIRED_FILES.map((file) => {
    const filePath = path.join(DATA_DIR, file);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing required Engine 25 file: ${filePath}`);
    }

    const stat = fs.statSync(filePath);

    if (!stat.size || stat.size <= 0) {
      throw new Error(`Engine 25 file is empty: ${filePath}`);
    }

    return {
      file,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  });
}

async function handle(req, res) {
  const auth = checkToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      error: auth.msg,
    });
  }

  if (IS_RUNNING) {
    return res.json({
      ok: true,
      skipped: true,
      reason: "ENGINE25_REFRESH_ALREADY_RUNNING",
      startedAt: nowIso(),
    });
  }

  IS_RUNNING = true;

  const startedAt = nowIso();
  const startedMs = Date.now();

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const steps = [];

    for (const step of STEPS) {
      const result = await runStep(step);
      steps.push({
        name: result.name,
        code: result.code,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        elapsedMs: result.elapsedMs,
      });

      if (result.code !== 0) {
        return res.status(500).json({
          ok: false,
          error: `Engine 25 refresh failed at ${step.name}`,
          failedStep: step.name,
          startedAt,
          endedAt: nowIso(),
          elapsedMs: Date.now() - startedMs,
          steps,
          stdout: tail(result.stdout),
          stderr: tail(result.stderr),
        });
      }
    }

    const files = validateFiles();
    const endedAt = nowIso();

    return res.json({
      ok: true,
      engine: "engine25.refreshRoute.v1",
      startedAt,
      endedAt,
      elapsedMs: Date.now() - startedMs,
      steps,
      files,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      startedAt,
      endedAt: nowIso(),
      elapsedMs: Date.now() - startedMs,
    });
  } finally {
    IS_RUNNING = false;
  }
}

router.get("/engine25/refresh", handle);
router.post("/engine25/refresh", handle);

export default router;
