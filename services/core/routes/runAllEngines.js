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

// Step 1
const ENGINE1_RUNNER = path.resolve(CORE_DIR, "jobs/runEngine1AndShelves.js");

// Step 2
const JOB_SCRIPT_ALL = path.resolve(CORE_DIR, "jobs/runAllEngines.sh");

// Step 3
const REPLAY_SNAPSHOT_JOB = path.resolve(CORE_DIR, "jobs/writeReplaySnapshot.js");

// Prevent overlapping cron/manual runs
let IS_RUNNING = false;

// ------------------------------
// auth
// ------------------------------
function checkToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: true }; // dev / no token configured

  const got =
    req.header("X-ENGINE-CRON-TOKEN") ||
    req.query.token ||
    "";

  if (got !== expected) {
    return { ok: false, status: 401, msg: "Unauthorized" };
  }

  return { ok: true };
}

// ------------------------------
// helpers
// ------------------------------
function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startMs) {
  return Date.now() - startMs;
}

function tail(str, max = 12000) {
  return String(str || "").slice(-max);
}

function logStepStart(name) {
  console.log(`[run-all-engines] START ${name} @ ${nowIso()}`);
}

function logStepEnd(name, result, startedMs) {
  console.log(
    `[run-all-engines] END ${name} @ ${nowIso()} | code=${result.code} | elapsedMs=${elapsedMs(startedMs)}`
  );
}

function runStep({ name, cmd, args, cwd }) {
  return new Promise((resolve) => {
    const startedMs = Date.now();
    logStepStart(name);

    const child = spawn(cmd, args, {
      cwd,
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

      const result = {
        code: 999,
        stdout,
        stderr: `${stderr}\n${err?.stack || err?.message || String(err)}`,
        startedAt: new Date(startedMs).toISOString(),
        endedAt: nowIso(),
        elapsedMs: elapsedMs(startedMs),
      };

      logStepEnd(name, result, startedMs);
      resolve(result);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;

      const result = {
        code: Number.isInteger(code) ? code : 1,
        stdout,
        stderr,
        startedAt: new Date(startedMs).toISOString(),
        endedAt: nowIso(),
        elapsedMs: elapsedMs(startedMs),
      };

      logStepEnd(name, result, startedMs);
      resolve(result);
    });
  });
}

// ------------------------------
// main handler
// ------------------------------
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
      reason: "ALREADY_RUNNING",
      startedAt: nowIso(),
    });
  }

  IS_RUNNING = true;
  const routeStartedMs = Date.now();
  const startedAt = nowIso();

  console.log(`[run-all-engines] REQUEST START @ ${startedAt}`);

  try {
    // ---------------------------------
    // STEP 1: Engine 1 + Shelves
    // ---------------------------------
    const step1 = await runStep({
      name: "engine1_and_shelves",
      cmd: "node",
      args: [ENGINE1_RUNNER],
      cwd: CORE_DIR,
    });

    if (step1.code !== 0) {
      const endedAt = nowIso();
      const totalElapsedMs = elapsedMs(routeStartedMs);

      console.error(
        `[run-all-engines] FAIL engine1_and_shelves | totalElapsedMs=${totalElapsedMs}`
      );

      return res.json({
        ok: false,
        code: step1.code,
        startedAt,
        endedAt,
        totalElapsedMs,
        failedStep: "engine1_and_shelves",
        timings: {
          totalElapsedMs,
          engine1_and_shelves: step1.elapsedMs,
        },
        stdout: tail(step1.stdout),
        stderr: tail(step1.stderr),
      });
    }

    // ---------------------------------
    // STEP 2: Remaining engine chain
    // ---------------------------------
    const step2 = await runStep({
      name: "runAllEngines_sh",
      cmd: "bash",
      args: [JOB_SCRIPT_ALL],
      cwd: CORE_DIR,
    });

    // ---------------------------------
    // STEP 3: Replay cadence snapshot
    // ---------------------------------
    const step3 = await runStep({
      name: "write_replay_snapshot",
      cmd: "node",
      args: [REPLAY_SNAPSHOT_JOB],
      cwd: CORE_DIR,
    });

    const endedAt = nowIso();
    const totalElapsedMs = elapsedMs(routeStartedMs);

    const combinedStdout = [
      "== STEP 1: node jobs/runEngine1AndShelves.js ==",
      step1.stdout,
      "",
      "== STEP 2: bash jobs/runAllEngines.sh ==",
      step2.stdout,
      "",
      "== STEP 3: node jobs/writeReplaySnapshot.js ==",
      step3.stdout,
    ].join("\n");

    const combinedStderr = [
      "== STEP 1 STDERR ==",
      step1.stderr,
      "",
      "== STEP 2 STDERR ==",
      step2.stderr,
      "",
      "== STEP 3 STDERR ==",
      step3.stderr,
    ].join("\n");

    const ok = step2.code === 0 && step3.code === 0;
    const code = step2.code !== 0 ? step2.code : step3.code;

    console.log(
      `[run-all-engines] REQUEST END @ ${endedAt} | ok=${ok} | totalElapsedMs=${totalElapsedMs}`
    );

    return res.json({
      ok,
      code,
      startedAt,
      endedAt,
      totalElapsedMs,
      timings: {
        totalElapsedMs,
        engine1_and_shelves: step1.elapsedMs,
        runAllEngines_sh: step2.elapsedMs,
        write_replay_snapshot: step3.elapsedMs,
      },
      steps: {
        engine1_and_shelves: {
          code: step1.code,
          startedAt: step1.startedAt,
          endedAt: step1.endedAt,
          elapsedMs: step1.elapsedMs,
        },
        runAllEngines_sh: {
          code: step2.code,
          startedAt: step2.startedAt,
          endedAt: step2.endedAt,
          elapsedMs: step2.elapsedMs,
        },
        write_replay_snapshot: {
          code: step3.code,
          startedAt: step3.startedAt,
          endedAt: step3.endedAt,
          elapsedMs: step3.elapsedMs,
        },
      },
      stdout: tail(combinedStdout),
      stderr: tail(combinedStderr),
    });
  } catch (err) {
    const endedAt = nowIso();
    const totalElapsedMs = elapsedMs(routeStartedMs);

    console.error(
      `[run-all-engines] UNHANDLED ERROR @ ${endedAt} | totalElapsedMs=${totalElapsedMs}`
    );
    console.error(err?.stack || err?.message || String(err));

    return res.status(500).json({
      ok: false,
      error: err?.message || "Unhandled error",
      startedAt,
      endedAt,
      totalElapsedMs,
    });
  } finally {
    IS_RUNNING = false;
    console.log(`[run-all-engines] LOCK RELEASED @ ${nowIso()}`);
  }
}

// Browser-friendly GET
router.get("/run-all-engines", (req, res) => {
  handle(req, res);
});

// Cron-friendly POST
router.post("/run-all-engines", (req, res) => {
  handle(req, res);
});

export default router;
