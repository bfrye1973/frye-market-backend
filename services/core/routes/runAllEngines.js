import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// points to: src/services/core/jobs/runAllEngines.sh
const JOB_SCRIPT = path.resolve(__dirname, "../jobs/runAllEngines.sh");

function requireCronToken(req) {
  const expected = process.env.ENGINE_CRON_TOKEN;
  if (!expected) return { ok: false, status: 500, msg: "ENGINE_CRON_TOKEN not set" };

  const got = req.header("X-ENGINE-CRON-TOKEN") || "";
  if (got !== expected) return { ok: false, status: 401, msg: "Unauthorized" };

  return { ok: true };
}

router.post("/api/v1/run-all-engines", async (req, res) => {
  const auth = requireCronToken(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.msg });

  const startedAt = new Date().toISOString();

  // Spawn bash script inside the web-service container
  const child = spawn("bash", [JOB_SCRIPT], {
    cwd: path.resolve(__dirname, ".."), // core/
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
      stdout: stdout.slice(-8000), // keep response small
      stderr: stderr.slice(-8000),
    });
  });
});

export default router;
