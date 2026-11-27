// Engine 28A #412 — observer non-interference acceptance tests.
//
// Proves that PAPER verification receipt storage cannot delay the executor's
// exit or change its result, through the REAL executor job (spawned as a
// child process, as the scheduler does), with storage that is slow, hung,
// throwing or healthy. Also covers the bounded scheduler limiter.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  runBounded,
  createInFlightLimiter,
  resolveObserverTimeoutMs,
  GAP_EVENT,
  ENGINE28A_OBSERVER_DEFAULT_TIMEOUT_MS,
} from "../logic/engine28a/boundedObserverDispatch.js";

const ROOT = process.cwd();
const CORE = path.resolve(ROOT, "services/core");
const JOB = path.resolve(CORE, "jobs/autoExecuteCanonicalPaperTrade.js");
const RUN_ALL = path.resolve(CORE, "routes/runAllEngines.js");
const SNAPSHOT = path.resolve(CORE, "data/strategy-snapshot-es.json");
const OBSERVER_TIMEOUT_MS = 300;
const SLOW_STORAGE_MS = 15000;

const never = () => new Promise(() => {});

// ---------- unit: runBounded ----------

test("runBounded returns UNKNOWN within its timeout when the observer hangs", async () => {
  const logs = [];
  const t0 = Date.now();
  const r = await runBounded(never, { timeoutMs: 150, label: "T", log: (x) => logs.push(x) });
  const elapsed = Date.now() - t0;
  assert.deepEqual(r, { status: "UNKNOWN", reason: "OBSERVER_TIMEOUT" });
  assert.ok(elapsed < 1000, `took ${elapsed}ms`);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, GAP_EVENT);
  assert.equal(logs[0].verification, "UNKNOWN");
});

test("runBounded never throws: synchronous throw, rejection, and a throwing logger", async () => {
  const sync = await runBounded(() => { throw new Error("boom"); }, { timeoutMs: 150, log: () => { throw new Error("log down"); } });
  assert.deepEqual(sync, { status: "UNKNOWN", reason: "OBSERVER_FAILED" });
  const rej = await runBounded(async () => { throw new Error("EIO"); }, { timeoutMs: 150 });
  assert.deepEqual(rej, { status: "UNKNOWN", reason: "OBSERVER_FAILED" });
});

test("runBounded passes a completed observer result through unchanged", async () => {
  const r = await runBounded(async () => ({ status: "RECORDED" }), { timeoutMs: 150 });
  assert.deepEqual(r, { status: "COMPLETED", value: { status: "RECORDED" } });
});

test("observer timeout is clamped; bad values fall back to the default", () => {
  assert.equal(resolveObserverTimeoutMs(undefined), ENGINE28A_OBSERVER_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveObserverTimeoutMs("abc"), ENGINE28A_OBSERVER_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveObserverTimeoutMs(1), 100);
  assert.equal(resolveObserverTimeoutMs(999999), 10000);
});

// ---------- unit: in-flight limiter ----------

test("limiter caps hung writes and reports every drop as UNKNOWN evidence", async () => {
  const logs = [];
  const lim = createInFlightLimiter({ max: 3, log: (x) => logs.push(x) });
  const accepted = [1, 2, 3, 4, 5].map((i) => lim.dispatch(`W${i}`, never));
  assert.deepEqual(accepted, [true, true, true, false, false]);
  assert.deepEqual(lim.stats(), { inFlight: 3, dropped: 2, failed: 0, cap: 3 });
  assert.equal(logs.filter((x) => x.reason === "OBSERVER_BACKPRESSURE_DROPPED").length, 2);
});

test("limiter frees a slot when a write finishes or fails, and counts failures", async () => {
  const logs = [];
  const lim = createInFlightLimiter({ max: 1, log: (x) => logs.push(x) });
  let release;
  assert.equal(lim.dispatch("A", () => new Promise((r) => { release = r; })), true);
  assert.equal(lim.dispatch("B", async () => {}), false);
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(lim.dispatch("C", async () => { throw new Error("EIO"); }), true);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(lim.stats(), { inFlight: 0, dropped: 1, failed: 1, cap: 1 });
  assert.ok(logs.some((x) => x.reason === "OBSERVER_FAILED"));
});

// ---------- integration: the real executor job ----------

async function makePreload(dir) {
  const file = path.join(dir, "storage-fault.mjs");
  await fsp.writeFile(
    file,
    [
      'import fsp from "node:fs/promises";',
      "const mode = process.env.E28A_TEST_STORAGE_MODE;",
      `const slow = ${SLOW_STORAGE_MS};`,
      'if (mode === "hang") { fsp.realpath = () => new Promise(() => {}); setInterval(() => {}, 1 << 30); }',
      'if (mode === "slow") { const real = fsp.realpath.bind(fsp); fsp.realpath = (p) => new Promise((r) => setTimeout(() => r(real(p)), slow)); }',
      'if (mode === "throw") { fsp.realpath = async () => { const e = new Error("EIO: simulated disk failure"); e.code = "EIO"; throw e; }; }',
      "",
    ].join("\n")
  );
  return file;
}

function runJob({ enabled, verification, storageMode, preload, receiptDir }) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("ENGINE8_") || k.startsWith("ENGINE28A_") || k.startsWith("E28A_")) delete env[k];
    if (enabled) env.ENGINE8_AUTO_PAPER_EXECUTION_ENABLED = "1";
    if (verification) {
      env.ENGINE8_PAPER_VERIFICATION_ENABLED = "1";
      env.ENGINE8_PAPER_VERIFICATION_DIR = receiptDir;
      env.ENGINE28A_OBSERVER_TIMEOUT_MS = String(OBSERVER_TIMEOUT_MS);
    }
    if (storageMode) env.E28A_TEST_STORAGE_MODE = storageMode;
    const args = preload ? ["--import", preload, JOB] : [JOB];
    const t0 = Date.now();
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const kill = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.on("close", (code) => {
      clearTimeout(kill);
      resolve({ code, stdout, stderr, ms: Date.now() - t0 });
    });
  });
}

// The executor's decision payload, minus its wall-clock timestamp.
function decision(stdout) {
  const p = JSON.parse(stdout);
  delete p.evaluatedAt;
  return p;
}

const CASES = [
  { name: "skip path (auto execution disabled, exit 0)", enabled: false, expectCode: 0, expectReason: "ENGINE8_AUTO_PAPER_EXECUTION_DISABLED" },
  { name: "reject path (snapshot missing, exit 1)", enabled: true, expectCode: 1, expectReason: "ES_STRATEGY_SNAPSHOT_NOT_FOUND" },
];

test("executor job: slow, hung or failing receipt storage never changes its result or delays its exit", { skip: fs.existsSync(SNAPSHOT) ? "a real strategy snapshot is present; refusing to run the executor" : false }, async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "e28a-noninterference-"));
  try {
    const preload = await makePreload(tmp);
    const receiptDir = path.join(tmp, "receipts");
    await fsp.mkdir(receiptDir, { mode: 0o700 });
    await fsp.chmod(receiptDir, 0o700);
    const realReceiptDir = await fsp.realpath(receiptDir);

    for (const c of CASES) {
      const baseline = await runJob({ enabled: c.enabled, verification: false });
      assert.equal(baseline.code, c.expectCode, `${c.name}: baseline exit`);
      assert.equal(decision(baseline.stdout).reason, c.expectReason);

      for (const storageMode of ["hang", "slow", "throw"]) {
        const r = await runJob({ enabled: c.enabled, verification: true, storageMode, preload, receiptDir: realReceiptDir });
        assert.equal(r.code, baseline.code, `${c.name} / ${storageMode}: exit code changed`);
        assert.deepEqual(decision(r.stdout), decision(baseline.stdout), `${c.name} / ${storageMode}: decision changed`);
        assert.ok(r.ms < SLOW_STORAGE_MS / 2, `${c.name} / ${storageMode}: exit delayed ${r.ms}ms`);
        if (storageMode !== "throw") {
          assert.match(r.stderr, /ENGINE28A_OBSERVER_EVIDENCE_GAP/, `${c.name} / ${storageMode}: gap not reported`);
          assert.match(r.stderr, /OBSERVER_TIMEOUT/);
        } else {
          // E8's observer already turns a storage error into UNKNOWN; it must still be reported.
          assert.match(r.stderr, /"status":"UNKNOWN"/, `${c.name} / throw: UNKNOWN not reported`);
        }
      }

      // Healthy storage still records a receipt, so the bound does not drop good evidence.
      const before = (await fsp.readdir(realReceiptDir)).filter((f) => f.endsWith(".json")).length;
      const ok = await runJob({ enabled: c.enabled, verification: true, receiptDir: realReceiptDir });
      assert.equal(ok.code, baseline.code);
      assert.deepEqual(decision(ok.stdout), decision(baseline.stdout));
      const after = (await fsp.readdir(realReceiptDir)).filter((f) => f.endsWith(".json")).length;
      assert.equal(after, before + 1, `${c.name}: healthy storage did not record exactly one receipt`);
      assert.doesNotMatch(ok.stderr, /ENGINE28A_OBSERVER_EVIDENCE_GAP/);
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("executor job: concurrent cycles with hung storage all exit promptly with unchanged results", { skip: fs.existsSync(SNAPSHOT) ? "a real strategy snapshot is present" : false }, async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "e28a-concurrent-"));
  try {
    const preload = await makePreload(tmp);
    const receiptDir = path.join(tmp, "receipts");
    await fsp.mkdir(receiptDir, { mode: 0o700 });
    await fsp.chmod(receiptDir, 0o700);
    const dir = await fsp.realpath(receiptDir);
    const runs = await Promise.all([0, 1, 2, 3].map(() => runJob({ enabled: false, verification: true, storageMode: "hang", preload, receiptDir: dir })));
    for (const r of runs) {
      assert.equal(r.code, 0);
      assert.equal(decision(r.stdout).reason, "ENGINE8_AUTO_PAPER_EXECUTION_DISABLED");
      assert.ok(r.ms < SLOW_STORAGE_MS / 2, `exit delayed ${r.ms}ms`);
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

// ---------- scheduler wiring (source contract) ----------

test("scheduler: every verification write is bounded; trading steps and gating are unchanged", () => {
  const s = fs.readFileSync(RUN_ALL, "utf8");
  assert.match(s, /createInFlightLimiter/);
  assert.doesNotMatch(s, /void\s+persistPrivateReceipt/);
  assert.doesNotMatch(s, /void\s+observeCompletedPaperCycle/);
  assert.doesNotMatch(s, /void\s+observeLifecycleOutcome/);
  assert.equal((s.match(/OBSERVER_LIMITER\.dispatch\(/g) || []).length, 3);
  // Execution gating is an owner decision (#412 7225818697); E28A does not change it.
  assert.match(s, /step3doctor\.code === 0/);
  // The skip response itself is unchanged; only a log line is added.
  assert.match(s, /SLOT SKIPPED ALREADY_RUNNING/);
  assert.match(s, /reason: "ALREADY_RUNNING"/);
});

test("executor: the observer is awaited only through runBounded", () => {
  const s = fs.readFileSync(JOB, "utf8");
  assert.match(s, /await runBounded\(\(\)=>observeCompletedPaperCycle\(/);
  assert.doesNotMatch(s, /try \{ await observeCompletedPaperCycle\(/);
});
