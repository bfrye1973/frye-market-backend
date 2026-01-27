import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// /services/core/routes -> /services/core/jobs
const JOB_SCRIPT = path.resolve(__dirname, "../jobs/runAllEngines.sh");

function runScript(res) {
  const startedAt = new Date().toISOString();

  const child = spawn("bash", [JOB_SCRIPT], {
    cwd: path.resolve(__dirname, ".."), // services/core
    env: process.env,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  child.on("close", (code) => {
    const endedAt = new Date().toISOString();
    res.json({
      ok: code === 0,
      code,
      startedAt,
      endedAt,
      stdout: stdout.slice(-8000),
      stderr: stderr.slice(-8000),
    });
  });
}

// 🔒 optional token gate (works for both GET and POST)
function checkToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: true }; // allow if not set (dev)
  const got = req.header("X-ENGINE-CRON-TOKEN") || req.query.token || "";
  if (got !== expected) return { ok: false, status: 401, msg: "Unauthorized" };
  return { ok: true };
}

// ✅ Browser-friendly: GET /api/v1/run-all-engines
router.get("/run-all-engines", (req, res) => {
  const auth = checkToken(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.msg });
  return runScript(res);
});

// ✅ Cron-friendly: POST /api/v1/run-all-engines
router.post("/run-all-engines", (req, res) => {
  const auth = checkToken(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.msg });
  return runScript(res);
});

export default router;
