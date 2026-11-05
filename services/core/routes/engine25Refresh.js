import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { resolveSystemOperatingSession } from "../logic/engine25/buildParticipationArtifact.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const STEPS = [
  {
    name: "engine25_full_market_health",
    job: "updateEngine25Full.js",
  },
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
  {
    name: "engine25_context",
    job: "buildEngine25Context.js",
  },
];

// The Core cron must write on backend-1, never in its own container.
const CORE_STEPS = [
  { name: "engine25_historical_full_replay", job: "updateEngine25HistoricalReplayFull.js" },
  { name: "engine25_composite_overlay_6mo", job: "buildEngine25CompositeOverlay6mo.js" },
  { name: "engine25_es_zone_aware_read", job: "buildEngine25EsZoneAwareRead.js" },
];
const CORE_REQUIRED_FILES = [
  "engine25-historical-replay-macro-distribution-breadth-6mo.json",
  "engine25-composite-overlay-6mo.json",
  "engine25-es-zone-aware-read.json",
];

const REQUIRED_FILES = [
  "engine25-market-health.json",
  "engine25-participation.json",
  "engine25-historical-replay-macro-distribution-breadth-6mo.json",
  "engine25-composite-overlay-6mo.json",
  "engine25-es-zone-aware-read.json",
  "engine25-sector-card-breadth-snapshots.json",
  "engine25-zone-classification.json",
  "engine25-context.json",
];

const LIVE_STEPS = [
  {
    name: "engine25_news_events",
    job: "updateEngine25NewsEvents.js",
    required: false,
  },
  {
    name: "engine25_intraday_macro",
    job: "updateEngine25IntradayMacro.js",
    required: true,
  },
  {
    name: "engine25_participation",
    job: "updateEngine25Participation.js",
    required: true,
  },
  {
    name: "engine25_sector_card_proxy_breadth",
    job: "snapshotEngine25SectorCardBreadth.js",
    required: true,
  },
  {
    name: "engine25_es_zone_aware_read",
    job: "buildEngine25EsZoneAwareRead.js",
    required: true,
  },
  {
    name: "engine25_zone_classification",
    job: "buildEngine25ZoneClassification.js",
    required: true,
  },
  {
    name: "engine25_context",
    job: "buildEngine25Context.js",
    required: true,
  },
];

const LIVE_REQUIRED_FILES = [
  "engine25-news-events.json",
  "engine25-intraday-macro.json",
  "engine25-participation.json",
  "engine25-sector-card-breadth-snapshots.json",
  "engine25-es-zone-aware-read.json",
  "engine25-zone-classification.json",
  "engine25-context.json",
];

const LIVE_BOOTSTRAP_REQUIRED_FILES = [
  "engine25-data-test.json",
  "engine25-market-feeds-test.json",
  "engine25-es-technical-context.json",
  ...REQUIRED_FILES,
];

let IS_RUNNING = false;

const FULL_REFRESH_WAIT_MS = 120000;
const FULL_REFRESH_WAIT_POLL_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function validateFiles(filesToValidate = REQUIRED_FILES) {
  return filesToValidate.map((file) => {
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

function compositeSnapshot() {
  const filename = path.join(DATA_DIR, "engine25-composite-overlay-6mo.json");
  if (!fs.existsSync(filename)) return null;
  const bytes = fs.readFileSync(filename);
  const data = JSON.parse(bytes.toString("utf8"));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const last = rows.at(-1);
  return {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    modifiedAt: fs.statSync(filename).mtime.toISOString(),
    rows: rows.length,
    date: last?.date ?? null,
    score: last?.engine25CompositeScore ?? null,
    state: last?.overlayState ?? null,
  };
}

async function handle(req, res) {
  const auth = checkToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      error: auth.msg,
    });
  }

  const mode = String(req.query.mode || "full").trim().toLowerCase();
  // Core mode is POST-only and fails closed when the shared cron secret is absent.
  if (mode === "core" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "CORE_REFRESH_REQUIRES_POST" });
  }
  if (mode === "core" && (!process.env.ENGINE_CRON_TOKEN ||
      req.header("X-ENGINE-CRON-TOKEN") !== process.env.ENGINE_CRON_TOKEN)) {
    return res.status(401).json({ ok: false, error: "CORE_REFRESH_UNAUTHORIZED" });
  }
  if (!["full", "live", "core"].includes(mode)) {
    return res.status(400).json({ ok: false, error: "UNKNOWN_ENGINE25_REFRESH_MODE" });
  }
  const requestStartedAt = nowIso();
  const requestStartedMs = Date.now();
  const systemOperatingSession =
    mode === "live" ? resolveSystemOperatingSession(requestStartedMs) : null;

  if (mode === "live" && systemOperatingSession?.operating !== true) {
    return res.json({
      ok: true,
      skipped: true,
      reason:
        systemOperatingSession?.session === "MAINTENANCE"
          ? "ES_GLOBEX_MAINTENANCE"
          : "ES_GLOBEX_CLOSED",
      mode,
      systemOperatingSession,
      startedAt: requestStartedAt,
      endedAt: nowIso(),
      elapsedMs: Date.now() - requestStartedMs,
    });
  }

  if (IS_RUNNING && mode === "core") {
    return res.status(409).json({ ok: false, mode, error: "ENGINE25_REFRESH_ALREADY_RUNNING" });
  }

  if (IS_RUNNING && mode === "full") {
    while (
      IS_RUNNING &&
      Date.now() - requestStartedMs < FULL_REFRESH_WAIT_MS
    ) {
      await sleep(FULL_REFRESH_WAIT_POLL_MS);
    }

    if (IS_RUNNING) {
      return res.status(503).json({
        ok: false,
        skipped: false,
        reason: "ENGINE25_REFRESH_WAIT_TIMEOUT",
        mode,
        startedAt: requestStartedAt,
        waitedMs: Date.now() - requestStartedMs,
      });
    }
  } else if (IS_RUNNING) {
    return res.json({
      ok: true,
      skipped: true,
      reason: "ENGINE25_REFRESH_ALREADY_RUNNING",
      mode,
      startedAt: requestStartedAt,
    });
  }

  IS_RUNNING = true;

  const startedAt = nowIso();
  const startedMs = Date.now();

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const compositeBefore = mode === "core" ? compositeSnapshot() : null;
    const missingLiveBootstrapFiles =
      mode === "live"
        ? LIVE_BOOTSTRAP_REQUIRED_FILES.filter(
            (file) => !fs.existsSync(path.join(DATA_DIR, file))
          )
        : [];

    const selectedSteps =
      mode === "live" && missingLiveBootstrapFiles.length
        ? [...STEPS, ...LIVE_STEPS]
        : mode === "live"
        ? LIVE_STEPS
        : mode === "core"
        ? CORE_STEPS
        : STEPS;

    const requiredFiles =
      mode === "live" ? LIVE_REQUIRED_FILES :
      mode === "core" ? CORE_REQUIRED_FILES : REQUIRED_FILES;
    const steps = [];
    const warnings = [];

    if (missingLiveBootstrapFiles.length) {
      warnings.push(
        `ENGINE25_LIVE_BOOTSTRAP_MISSING_FILES:${missingLiveBootstrapFiles.join(",")}`
      );
    }

    for (const step of selectedSteps) {
      const result = await runStep(step);
      const required = step.required !== false;

      steps.push({
        name: result.name,
        code: result.code,
        required,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        elapsedMs: result.elapsedMs,
      });

      if (result.code !== 0 && !required) {
        warnings.push(`NON_FATAL_STEP_FAILED:${step.name}`);
        continue;
      }

      if (result.code !== 0) {
        return res.status(500).json({
          ok: false,
          error: `Engine 25 refresh failed at ${step.name}`,
          failedStep: step.name,
          mode,
          startedAt,
          endedAt: nowIso(),
          elapsedMs: Date.now() - startedMs,
          steps,
          warnings,
          stdout: tail(result.stdout),
          stderr: tail(result.stderr),
        });
      }
    }

    const files = validateFiles(requiredFiles);
    const compositeAfter = mode === "core" ? compositeSnapshot() : null;
    if (mode === "core" && (!compositeAfter?.rows ||
        (compositeAfter.score === null || !Number.isFinite(Number(compositeAfter.score))) ||
        !files.find((item) => item.file === "engine25-composite-overlay-6mo.json" ||
          new Date(item.modifiedAt).getTime() >= startedMs))) {
      return res.status(500).json({
        ok: false, mode, error: "CORE_REFRESH_PRODUCTION_OUTPUT_NOT_VERIFIED",
        compositeBefore, compositeAfter, steps, files,
      });
    }
    const endedAt = nowIso();

    return res.json({
      ok: true,
      engine: "engine25.refreshRoute.v1",
      mode,
      startedAt,
      endedAt,
      elapsedMs: Date.now() - startedMs,
      steps,
      warnings,
      files,
      systemOperatingSession,
      ...(mode === "core" ? {
        compositeBefore,
        compositeAfter,
        changed: compositeBefore?.sha256 !== compositeAfter?.sha256,
        productionOutputVerified: true,
      } : {}),
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
