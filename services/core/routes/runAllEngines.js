import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// We run everything from services/core
const CORE_DIR = path.resolve(__dirname, "..");

// New Engine 1 runner (your updated canonical command)
const ENGINE1_RUNNER = path.resolve(CORE_DIR, "jobs/runEngine1AndShelves.js");

// Existing master runner (keeps everything else intact)
const JOB_SCRIPT_ALL = path.resolve(CORE_DIR, "jobs/runAllEngines.sh");

// 🔒 optional token gate (works for both GET and POST)
function checkToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: true }; // allow if not set (dev)
  const got = req.header("X-ENGINE-CRON-TOKEN") || req.query.token || "";
  if (got !== expected) return { ok: false, status: 401, msg: "Unauthorized" };
  return { ok: true };
}

function runStep({ cmd, args, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function handle(req, res) {
  const auth = checkToken(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.msg });

  const startedAt = new Date().toISOString();

  // Step 1: ALWAYS run Engine 1 + Shelves using the new runner
  const step1 = await runStep({
    cmd: "node",
    args: [ENGINE1_RUNNER],
    cwd: CORE_DIR,
  });

  // If Engine 1 fails, stop here (don’t run the rest)
  if (step1.code !== 0) {
    const endedAt = new Date().toISOString();
    return res.json({
      ok: false,
      code: step1.code,
      startedAt,
      endedAt,
      step: "engine1_and_shelves",
      stdout: step1.stdout.slice(-12000),
      stderr: step1.stderr.slice(-12000),
    });
  }

  // Step 2: run the existing full engine chain script (keeps everything else)
  const step2 = await runStep({
    cmd: "bash",
    args: [JOB_SCRIPT_ALL],
    cwd: CORE_DIR,
  });

  const endedAt = new Date().toISOString();

  // Combine output (keep tail so response stays small)
  const combinedStdout = [
    "== STEP 1: node jobs/runEngine1AndShelves.js ==",
    step1.stdout,
    "== STEP 2: bash jobs/runAllEngines.sh ==",
    step2.stdout,
  ].join("\n");

  const combinedStderr = [
    step1.stderr,
    step2.stderr,
  ].join("\n");

  return res.json({
    ok: step2.code === 0,
    code: step2.code,
    startedAt,
    endedAt,
    stdout: combinedStdout.slice(-12000),
    stderr: combinedStderr.slice(-12000),
  });
}

// Browser-friendly GET /api/v1/run-all-engines
router.get("/run-all-engines", (req, res) => {
  handle(req, res);
});

// Cron-friendly POST /api/v1/run-all-engines
router.post("/run-all-engines", (req, res) => {
  handle(req, res);
});

export default router;
