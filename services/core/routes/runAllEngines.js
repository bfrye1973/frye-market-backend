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

// Step 1: Engine 1 + shelves
const ENGINE1_RUNNER = path.resolve(CORE_DIR, "jobs/runEngine1AndShelves.js");

// Step 2: Remaining normal engine chain
const JOB_SCRIPT_ALL = path.resolve(CORE_DIR, "jobs/runAllEngines.sh");

// Step 3A: Refresh live/hourly Engine 25 context
// IMPORTANT:
// This must run before ES strategy snapshot so Engine 22 receives live
// Engine 25 zone context on every Render pod.
const ENGINE25_FULL_REFRESH_JOB = path.resolve(
CORE_DIR,
"jobs/updateEngine25Full.js"
);

// Step 3B: Build ES strategy snapshot
const ES_STRATEGY_SNAPSHOT_JOB = path.resolve(
CORE_DIR,
"jobs/buildStrategySnapshot.js"
);

// Step 3C: Archive slim ES replay snapshot
const ES_REPLAY_ARCHIVE_JOB = path.resolve(
CORE_DIR,
"jobs/archiveEsReplaySnapshot.js"
);

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

function runStep({ name, cmd, args, cwd, env = {} }) {
return new Promise((resolve) => {
const startedMs = Date.now();
logStepStart(name);

```
const child = spawn(cmd, args, {
  cwd,
  env: {
    ...process.env,
    ...env,
  },
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
  stderr:
    String(stderr || "") +
    "\n" +
    String(err?.stack || err?.message || err || ""),
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
```

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
// STEP 1: Engine 1 + shelves
// ---------------------------------
const step1 = await runStep({
name: "engine1_and_shelves",
cmd: "node",
args: [ENGINE1_RUNNER],
cwd: CORE_DIR,
});

```
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
// STEP 3A: Refresh live/hourly Engine 25 context
//
// This generates/refreshes:
// - data/engine25-market-health.json
// - data/engine25-es-zone-aware-read.json
// - data/engine25-sector-card-breadth-snapshots.json
// - data/engine25-zone-classification.json
// - data/engine25-es-overlay.json
//
// Engine 22 reads these through buildStrategySnapshot.js.
// This prevents zoneContext from going null on fresh Render pods.
// ---------------------------------
const step3a = await runStep({
  name: "update_engine25_full_live",
  cmd: "node",
  args: [ENGINE25_FULL_REFRESH_JOB],
  cwd: CORE_DIR,
  env: {
    CORE_BASE:
      process.env.CORE_BASE ||
      "https://frye-market-backend-1.onrender.com",
  },
});

// ---------------------------------
// STEP 3B: Build ES strategy snapshot
// This replaces old SPY replay cadence.
// ---------------------------------
const step3b = await runStep({
  name: "build_es_strategy_snapshot",
  cmd: "node",
  args: [ES_STRATEGY_SNAPSHOT_JOB],
  cwd: CORE_DIR,
  env: {
    SYMBOL: "ES",
    CORE_BASE:
      process.env.CORE_BASE ||
      "https://frye-market-backend-1.onrender.com",
  },
});

// ---------------------------------
// STEP 3C: Archive slim ES replay snapshot
// Writes /var/data/replay/es/YYYY-MM-DD/HHMM.json
// ---------------------------------
const step3c = await runStep({
  name: "archive_es_replay_snapshot",
  cmd: "node",
  args: [ES_REPLAY_ARCHIVE_JOB],
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
  "== STEP 3A: node jobs/updateEngine25Full.js ==",
  step3a.stdout,
  "",
  "== STEP 3B: SYMBOL=ES node jobs/buildStrategySnapshot.js ==",
  step3b.stdout,
  "",
  "== STEP 3C: node jobs/archiveEsReplaySnapshot.js ==",
  step3c.stdout,
].join("\n");

const combinedStderr = [
  "== STEP 1 STDERR ==",
  step1.stderr,
  "",
  "== STEP 2 STDERR ==",
  step2.stderr,
  "",
  "== STEP 3A STDERR ==",
  step3a.stderr,
  "",
  "== STEP 3B STDERR ==",
  step3b.stderr,
  "",
  "== STEP 3C STDERR ==",
  step3c.stderr,
].join("\n");

const ok =
  step2.code === 0 &&
  step3a.code === 0 &&
  step3b.code === 0 &&
  step3c.code === 0;

const code =
  step2.code !== 0
    ? step2.code
    : step3a.code !== 0
    ? step3a.code
    : step3b.code !== 0
    ? step3b.code
    : step3c.code;

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
    update_engine25_full_live: step3a.elapsedMs,
    build_es_strategy_snapshot: step3b.elapsedMs,
    archive_es_replay_snapshot: step3c.elapsedMs,
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
    update_engine25_full_live: {
      code: step3a.code,
      startedAt: step3a.startedAt,
      endedAt: step3a.endedAt,
      elapsedMs: step3a.elapsedMs,
    },
    build_es_strategy_snapshot: {
      code: step3b.code,
      startedAt: step3b.startedAt,
      endedAt: step3b.endedAt,
      elapsedMs: step3b.elapsedMs,
    },
    archive_es_replay_snapshot: {
      code: step3c.code,
      startedAt: step3c.startedAt,
      endedAt: step3c.endedAt,
      elapsedMs: step3c.elapsedMs,
    },
  },
  stdout: tail(combinedStdout),
  stderr: tail(combinedStderr),
});
```

} catch (err) {
const endedAt = nowIso();
const totalElapsedMs = elapsedMs(routeStartedMs);

```
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
```

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
