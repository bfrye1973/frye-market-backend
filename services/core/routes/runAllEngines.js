// services/core/routes/runAllEngines.js
import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// We run everything from services/core
const CORE_DIR = path.resolve(__dirname, "..");

// Canonical jobs
const ENGINE1_RUNNER = path.resolve(CORE_DIR, "jobs/runEngine1AndShelves.js");
const JOB_SCRIPT_ALL = path.resolve(CORE_DIR, "jobs/runAllEngines.sh");
const REPLAY_SNAPSHOT_JOB = path.resolve(CORE_DIR, "jobs/writeReplaySnapshot.js");

// Overlap guard
let IS_RUNNING = false;
let LAST_RUN = {
  startedAt: null,
  endedAt: null,
  ok: null,
  step: null,
  error: null,
};

// Optional token gate
function checkToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: true };
  const got = req.header("X-ENGINE-CRON-TOKEN") || req.query.token || "";
  if (got !== expected) return { ok: false, status: 401, msg: "Unauthorized" };
  return { ok: true };
}

function runStep({ cmd, args, cwd, label }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(`[run-all-engines][${label}][stdout] ${s}`);
    });

    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(`[run-all-engines][${label}][stderr] ${s}`);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({
        code: 999,
        stdout,
        stderr: `${stderr}\nSpawn error: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

async function runAllEnginesChain() {
  const startedAt = new Date().toISOString();
  LAST_RUN = {
    startedAt,
    endedAt: null,
    ok: null,
    step: "starting",
    error: null,
  };

  console.log(`[run-all-engines] START ${startedAt}`);

  try {
    LAST_RUN.step = "engine1_and_shelves";

    const step1 = await runStep({
      cmd: "node",
      args: [ENGINE1_RUNNER],
      cwd: CORE_DIR,
      label: "step1-engine1-and-shelves",
    });

    if (step1.code !== 0) {
      const endedAt = new Date().toISOString();
      LAST_RUN = {
        startedAt,
        endedAt,
        ok: false,
        step: "engine1_and_shelves",
        error: step1.stderr.slice(-4000) || `Step 1 failed with code ${step1.code}`,
      };
      console.error(`[run-all-engines] FAIL step1 code=${step1.code}`);
      return;
    }

    LAST_RUN.step = "run_all_engines";

    const step2 = await runStep({
      cmd: "bash",
      args: [JOB_SCRIPT_ALL],
      cwd: CORE_DIR,
      label: "step2-run-all-engines",
    });

    if (step2.code !== 0) {
      const endedAt = new Date().toISOString();
      LAST_RUN = {
        startedAt,
        endedAt,
        ok: false,
        step: "run_all_engines",
        error: step2.stderr.slice(-4000) || `Step 2 failed with code ${step2.code}`,
      };
      console.error(`[run-all-engines] FAIL step2 code=${step2.code}`);
      return;
    }

    LAST_RUN.step = "write_replay_snapshot";

    const step3 = await runStep({
      cmd: "node",
      args: [REPLAY_SNAPSHOT_JOB],
      cwd: CORE_DIR,
      label: "step3-write-replay-snapshot",
    });

    if (step3.code !== 0) {
      const endedAt = new Date().toISOString();
      LAST_RUN = {
        startedAt,
        endedAt,
        ok: false,
        step: "write_replay_snapshot",
        error: step3.stderr.slice(-4000) || `Step 3 failed with code ${step3.code}`,
      };
      console.error(`[run-all-engines] FAIL step3 code=${step3.code}`);
      return;
    }

    const endedAt = new Date().toISOString();
    LAST_RUN = {
      startedAt,
      endedAt,
      ok: true,
      step: "done",
      error: null,
    };

    console.log(`[run-all-engines] SUCCESS started=${startedAt} ended=${endedAt}`);
  } catch (err) {
    const endedAt = new Date().toISOString();
    LAST_RUN = {
      startedAt,
      endedAt,
      ok: false,
      step: "exception",
      error: err?.stack || err?.message || String(err),
    };
    console.error("[run-all-engines] EXCEPTION", err);
  } finally {
    IS_RUNNING = false;
  }
}

async function handle(req, res) {
  const auth = checkToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.msg });
  }

  if (IS_RUNNING) {
    return res.json({
      ok: true,
      skipped: true,
      reason: "ALREADY_RUNNING",
      startedAt: new Date().toISOString(),
      lastRun: LAST_RUN,
    });
  }

  IS_RUNNING = true;

  const acceptedAt = new Date().toISOString();

  runAllEnginesChain().catch((err) => {
    console.error("[run-all-engines] background chain crashed", err);
    IS_RUNNING = false;
  });

  return res.json({
    ok: true,
    accepted: true,
    startedAt: acceptedAt,
    message: "Engine run started in background",
  });
}

// Browser-friendly GET
router.get("/run-all-engines", (req, res) => {
  handle(req, res);
});

// Cron-friendly POST
router.post("/run-all-engines", (req, res) => {
  handle(req, res);
});

// Optional status route for debugging
router.get("/run-all-engines/status", (req, res) => {
  const auth = checkToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.msg });
  }

  return res.json({
    ok: true,
    isRunning: IS_RUNNING,
    lastRun: LAST_RUN,
    checkedAt: new Date().toISOString(),
  });
});

export default router;
