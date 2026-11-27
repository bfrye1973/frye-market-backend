// Engine 28A #412 — integrated noninterference acceptance (Engine 8 review 7226064410).
//
// Runs the REAL executor and the REAL scheduler route in an isolated temp tree:
// - an authorized READY fixture snapshot and a local mock PAPER endpoint (no real
//   order, no network beyond 127.0.0.1)
// - completed, rejected and request-failure entry paths, with exact result/exit
//   equality against verification-off baselines and measured latency bounds
// - full scheduler cycles (Step 0 protective lifecycle through Step 4 entry) with
//   hung receipt storage in every process, concurrent requests, and a restart
//
// Stub jobs stand in for the market-data/engine build steps only. The executor,
// the scheduler route, the observers and the limiter are the code under test.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const REPO = process.cwd();
const CORE = path.join(REPO, "services/core");
const OBS_MS = 300; // observer timeout used in these tests
const HAVE_EXPRESS = fs.existsSync(path.join(REPO, "node_modules/express"));

const COPY = [
  "jobs/autoExecuteCanonicalPaperTrade.js",
  "routes/runAllEngines.js",
  "logic/engine28a/boundedObserverDispatch.js",
  "logic/trading/engine8PaperReceiptObserver.js",
  "logic/trading/engine8PrivatePaperReceipt.js",
  "logic/trading/engine8LifecycleReceiptObserver.js",
];
const STUB_JOBS = [
  "jobs/autoManageCanonicalPaperLifecycle.js",
  "jobs/runEngine1AndShelves.js",
  "jobs/buildStrategySnapshot.js",
  "jobs/alertMicroPositionConflict.js",
  "jobs/updateEngine28APipelineDoctor.js",
  "jobs/archiveEsReplaySnapshot.js",
  "jobs/auditEngine28AReplayWindow.js",
  "jobs/recordEngine6ENoTradeFunnel.js",
];

const READY_SNAPSHOT = {
  now: "2026-11-27T15:00:00.000Z",
  strategies: {
    "intraday_scalp@10m": {
      permission: { paper: { allowed: true, snapshotTime: "2026-11-27T15:00:00.000Z" } },
      engine8PaperOrder: { status: "READY_TO_CREATE_PAPER_ORDER", executable: true, direction: "SHORT", candidateId: "C1", planId: "P1", blockers: [] },
    },
  },
};

async function buildTree() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "e28a-int-"));
  const core = path.join(tmp, "services/core");
  for (const rel of COPY) {
    await fsp.mkdir(path.dirname(path.join(core, rel)), { recursive: true });
    await fsp.copyFile(path.join(CORE, rel), path.join(core, rel));
  }
  const events = path.join(tmp, "events.log");
  for (const rel of STUB_JOBS) {
    const name = path.basename(rel, ".js");
    // Stub: record the step and when it started; optional delay for restart tests.
    await fsp.writeFile(path.join(core, rel),
      `import fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(events)}, ${JSON.stringify(name)} + " " + Date.now() + "\\n");\n` +
      `const d = Number(process.env.E28A_STUB_DELAY_${name.replace(/[^A-Za-z0-9]/g, "_")} || 0);\n` +
      `if (d) await new Promise(r => setTimeout(r, d));\nconsole.log(JSON.stringify({ ok: true, stub: ${JSON.stringify(name)} }));\n`);
  }
  await fsp.writeFile(path.join(core, "jobs/runAllEngines.sh"), `#!/bin/bash\necho "runAllEngines_sh $(date +%s%3N)" >> ${JSON.stringify(events)}\nexit 0\n`);
  await fsp.mkdir(path.join(core, "data"), { recursive: true });
  await fsp.writeFile(path.join(core, "data/strategy-snapshot-es.json"), JSON.stringify(READY_SNAPSHOT));
  if (HAVE_EXPRESS) await fsp.symlink(path.join(REPO, "node_modules"), path.join(tmp, "node_modules"), "dir");
  const receipts = path.join(tmp, "receipts");
  await fsp.mkdir(receipts, { mode: 0o700 });
  await fsp.chmod(receipts, 0o700);
  const preload = path.join(tmp, "storage-fault.mjs");
  await fsp.writeFile(preload, [
    'import fsp from "node:fs/promises";',
    'const mode = process.env.E28A_TEST_STORAGE_MODE;',
    'if (mode === "hang") { fsp.realpath = () => new Promise(() => {}); }',
    'if (mode === "throw") { fsp.realpath = async () => { const e = new Error("EIO: simulated"); e.code = "EIO"; throw e; }; }',
    "",
  ].join("\n"));
  await fsp.writeFile(path.join(core, "serve.mjs"),
    'import express from "express";\nimport router from "./routes/runAllEngines.js";\n' +
    'const app = express(); app.use("/api/v1", router);\n' +
    'const s = app.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("LISTENING " + s.address().port));\n');
  return { tmp, core, events, receipts: await fsp.realpath(receipts), preload };
}

// Local mock of the protected Engine 8 PAPER route. Records every call.
async function mockEngine8(mode) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      calls.push({ at: Date.now(), method: req.method, url: req.url, secret: req.headers["x-engine8-admin-secret"] });
      if (mode === "reject") {
        res.writeHead(409, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "DUPLICATE_ORDER_BLOCKED" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, status: "PAPER_ORDER_FILLED", direction: "SHORT", candidateId: "C1", planId: "P1", orderId: "O1", executionId: "X1", tradeId: "T1", orderCreated: true, fillCreated: true, journalCompleted: true, journalPending: false }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: "http://127.0.0.1:" + server.address().port, calls, close: () => new Promise((r) => server.close(r)) };
}

function baseEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ENGINE8_|ENGINE28A_|ENGINE6E_|E28A_|ENGINE_CRON_TOKEN|NODE_OPTIONS|REPLAY_MODE|ENGINE12_REPLAY_MODE|CORE_BASE)/.test(k)) delete env[k];
  return {
    ...env,
    ENGINE8_AUTO_PAPER_EXECUTION_ENABLED: "1",
    ENGINE8_PAPER_ONLY: "1",
    ENGINE8_CANONICAL_EXECUTOR_ENABLED: "1",
    ENGINE8_ADMIN_SECRET: "test-only-not-a-secret",
    ...extra,
  };
}
function verificationEnv(t, mode) {
  const e = { ENGINE8_PAPER_VERIFICATION_ENABLED: "1", ENGINE8_PAPER_VERIFICATION_DIR: t.receipts, ENGINE28A_OBSERVER_TIMEOUT_MS: String(OBS_MS) };
  if (mode) Object.assign(e, { E28A_TEST_STORAGE_MODE: mode, NODE_OPTIONS: "--import " + t.preload });
  return e;
}

function runExecutor(t, env) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(t.core, "jobs/autoExecuteCanonicalPaperTrade.js")], { cwd: t.tmp, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const kill = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.on("close", (code) => { clearTimeout(kill); resolve({ code, stdout, stderr, t0, ms: Date.now() - t0 }); });
  });
}
function decision(stdout) { const p = JSON.parse(stdout); delete p.evaluatedAt; return p; }
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---------------------------------------------------------------------------

test("authorized entry: completed, rejected and request-failure paths are unchanged under every storage condition", async () => {
  const t = await buildTree();
  try {
    const PATHS = [
      { name: "completed", mock: "ok", expectCode: 0, expectStatus: "AUTO_PAPER_EXECUTION_COMPLETED" },
      { name: "rejected", mock: "reject", expectCode: 1, expectReason: "CANONICAL_PAPER_EXECUTION_REJECTED" },
      { name: "request failure", mock: "down", expectCode: 1, expectReason: "CANONICAL_PAPER_EXECUTION_REQUEST_FAILED" },
    ];
    for (const p of PATHS) {
      const mock = p.mock === "down" ? null : await mockEngine8(p.mock);
      // A port nobody listens on, for the request-failure path.
      const coreUrl = mock ? mock.url : "http://127.0.0.1:9";
      try {
        const base = [];
        for (let i = 0; i < 3; i++) base.push(await runExecutor(t, baseEnv({ CORE_BASE_URL: coreUrl })));
        for (const b of base) assert.equal(b.code, p.expectCode, `${p.name}: baseline exit`);
        const d0 = decision(base[0].stdout);
        if (p.expectStatus) assert.equal(d0.status, p.expectStatus);
        if (p.expectReason) assert.equal(d0.reason, p.expectReason);
        const baseMs = median(base.map((b) => b.ms));
        if (mock) assert.equal(mock.calls.length, 3, `${p.name}: baseline must POST exactly once per run`);

        for (const mode of ["healthy", "throw", "hang"]) {
          const before = mock ? mock.calls.length : 0;
          const r = await runExecutor(t, baseEnv({ CORE_BASE_URL: coreUrl, ...verificationEnv(t, mode === "healthy" ? null : mode) }));
          assert.equal(r.code, p.expectCode, `${p.name}/${mode}: exit code changed`);
          let got = decision(r.stdout), want = decision(base[0].stdout);
          if (p.name === "request failure") { delete got.detail; delete want.detail; } // OS error text may vary
          assert.deepEqual(got, want, `${p.name}/${mode}: decision payload changed`);
          if (mock) {
            assert.equal(mock.calls.length, before + 1, `${p.name}/${mode}: exactly one order request, no retry`);
            const c = mock.calls.at(-1);
            assert.equal(c.method, "POST");
            assert.equal(c.url, "/api/trading/paper/execute-canonical");
            // The order request goes out before any observer work: its timing matches baseline.
            const sentAfter = c.at - r.t0;
            assert.ok(sentAfter < baseMs + 400, `${p.name}/${mode}: order request delayed (${sentAfter}ms vs baseline exit ${baseMs}ms)`);
          }
          // Measured exit latency bound vs the verification-off median.
          const bound = mode === "hang" ? baseMs + OBS_MS + 600 : baseMs + 600;
          assert.ok(r.ms <= bound, `${p.name}/${mode}: exit ${r.ms}ms > bound ${bound}ms (baseline ${baseMs}ms)`);
          if (mode === "hang") assert.match(r.stderr, /"reason":"OBSERVER_TIMEOUT"/);
          if (mode === "throw") assert.match(r.stderr, /"status":"UNKNOWN"/);
        }
      } finally {
        if (mock) await mock.close();
      }
    }
  } finally {
    await fsp.rm(t.tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

function startServer(t, extraEnv) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(t.core, "serve.mjs")], { cwd: t.tmp, env: { ...extraEnv, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; if (/LISTENING/.test(stdout)) resolve(srv); });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => { if (!/LISTENING/.test(stdout)) reject(new Error("server failed: " + stderr)); });
    const srv = { port, child, out: () => stdout, err: () => stderr, url: `http://127.0.0.1:${port}/api/v1/run-all-engines` };
  });
}
async function cycle(srv) {
  const t0 = Date.now();
  const r = await fetch(srv.url, { method: "POST" });
  return { status: r.status, body: await r.json(), ms: Date.now() - t0, t0 };
}
function stepTimes(t, name) {
  if (!fs.existsSync(t.events)) return [];
  return fs.readFileSync(t.events, "utf8").split("\n").filter((l) => l.startsWith(name + " ")).map((l) => Number(l.split(" ")[1]));
}
const stop = (srv) => new Promise((r) => { srv.child.once("exit", r); srv.child.kill("SIGKILL"); });

test("scheduler: with hung storage everywhere, cycles, protective lifecycle and entries run on time; skips and drops are visible", { skip: HAVE_EXPRESS ? false : "express not installed (run npm ci)" }, async () => {
  const t = await buildTree();
  const mock = await mockEngine8("ok");
  try {
    // Baseline: verification off.
    let srv = await startServer(t, baseEnv({ CORE_BASE_URL: mock.url }));
    const base = [];
    for (let i = 0; i < 2; i++) base.push(await cycle(srv));
    await stop(srv);
    for (const b of base) assert.equal(b.status, 200);
    const baseMs = Math.max(...base.map((b) => b.ms));
    const ordersBase = mock.calls.length;
    assert.equal(ordersBase, 2, "baseline: one entry request per cycle");

    // Hung receipt storage in the server AND every child job.
    srv = await startServer(t, baseEnv({ CORE_BASE_URL: mock.url, ENGINE28A_OBSERVER_MAX_IN_FLIGHT: "4", ...verificationEnv(t, "hang") }));
    const lifeBefore = stepTimes(t, "autoManageCanonicalPaperLifecycle").length;
    const runs = [];
    // Cycle 1, then cycle 2 with a concurrent request that must be skipped, then cycle 3.
    runs.push(await cycle(srv));
    const p2 = cycle(srv);
    await new Promise((r) => setTimeout(r, 150));
    const concurrent = await cycle(srv);
    runs.push(await p2);
    runs.push(await cycle(srv));
    await stop(srv);

    for (const [i, r] of runs.entries()) {
      assert.equal(r.status, 200, `cycle ${i + 1} status`);
      // Only the entry receipt is awaited (bounded); allow one observer timeout plus process noise.
      assert.ok(r.ms <= baseMs + OBS_MS + 1500, `cycle ${i + 1}: ${r.ms}ms vs baseline ${baseMs}ms`);
    }
    assert.equal(concurrent.body.reason, "ALREADY_RUNNING");
    assert.equal(concurrent.body.skipped, true);
    assert.match(srv.out(), /SLOT SKIPPED ALREADY_RUNNING/);

    // Step 0 (protective lifecycle) ran at the start of every cycle, before entry.
    const life = stepTimes(t, "autoManageCanonicalPaperLifecycle").slice(lifeBefore);
    assert.equal(life.length, 3, "lifecycle step ran once per cycle");
    for (const [i, r] of runs.entries()) assert.ok(life[i] - r.t0 < 1500, `cycle ${i + 1}: lifecycle started ${life[i] - r.t0}ms after request`);
    assert.equal(mock.calls.length - ordersBase, 3, "exactly one entry request per cycle, none retried");

    // Hung fire-and-forget writes are capped and every drop is logged with its run id.
    const drops = srv.err().split("\n").filter((l) => l.includes("OBSERVER_BACKPRESSURE_DROPPED"));
    assert.ok(drops.length >= 1, "expected backpressure drops with 4-slot cap and hung storage");
    for (const l of drops) assert.match(l, /"context":\{"runId":"[0-9a-f-]{36}"\}/);
  } finally {
    await mock.close();
    await fsp.rm(t.tmp, { recursive: true, force: true });
  }
});

test("scheduler restart mid-cycle: the lock does not stay stuck and the next cycle runs protective lifecycle first", { skip: HAVE_EXPRESS ? false : "express not installed (run npm ci)" }, async () => {
  const t = await buildTree();
  const mock = await mockEngine8("ok");
  try {
    let srv = await startServer(t, baseEnv({ CORE_BASE_URL: mock.url, E28A_STUB_DELAY_runEngine1AndShelves: "3000", ...verificationEnv(t, "hang") }));
    const inflight = fetch(srv.url, { method: "POST" }).catch(() => null);
    await new Promise((r) => setTimeout(r, 800));
    await stop(srv); // simulated deploy/restart while a cycle is running
    await inflight;
    const ordersBefore = mock.calls.length;
    srv = await startServer(t, baseEnv({ CORE_BASE_URL: mock.url, ...verificationEnv(t, "hang") }));
    const lifeBefore = stepTimes(t, "autoManageCanonicalPaperLifecycle").length;
    const r = await cycle(srv);
    await stop(srv);
    assert.equal(r.status, 200);
    assert.notEqual(r.body.reason, "ALREADY_RUNNING");
    assert.equal(stepTimes(t, "autoManageCanonicalPaperLifecycle").length - lifeBefore, 1);
    assert.equal(mock.calls.length - ordersBefore, 1);
    // Known gap, recorded for the owner: the in-memory lock cannot see child jobs of the killed
    // process, so overlap across a restart is possible. Not changed here.
  } finally {
    await mock.close();
    await fsp.rm(t.tmp, { recursive: true, force: true });
  }
});
