import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const routeSource = fs.readFileSync(path.join(here, "../routes/engine25Refresh.js"), "utf8");
const builderSource = fs.readFileSync(path.join(here, "../jobs/buildEngine25CompositeOverlay6mo.js"), "utf8");

function harness(options = {}) {
  let active = true;
  let hold = false;
  let releaseHeld = null;
  let generated = false;
  let failedStep = options.failedStep || null;
  let payload = JSON.stringify({ rows: [{ date: "2026-11-05", engine25CompositeScore: 53, overlayState: "ENGINE25_DEFENSIVE_WARNING" }] });
  let modified = new Date(Date.now() - 60_000);
  const handlers = {};
  const calls = [];
  const base = "/test/core";
  const dataRoot = path.join(base, "data");

  const fakeFs = {
    existsSync: () => true,
    mkdirSync: () => {},
    statSync: (filename) => ({
      size: 100,
      mtime: filename.endsWith("engine25-composite-overlay-6mo.json") ? modified : new Date(),
    }),
    readFileSync: () => Buffer.from(payload),
  };
  const fakeSpawn = (_exec, args) => {
    const name = path.basename(args[0]);
    calls.push(name);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const finish = () => {
      if (name === "buildEngine25CompositeOverlay6mo.js" && !failedStep) {
        generated = true;
        if (!options.stale) modified = new Date(Date.now() + 1000);
        if (options.changedScore) {
          payload = JSON.stringify({ rows: [{ date: "2026-11-05", engine25CompositeScore: 58 }] });
        }
      }
      child.emit("close", name === failedStep ? 1 : 0);
    };
    if (hold) releaseHeld = finish;
    else queueMicrotask(finish);
    return child;
  };
  let source = routeSource
    .replace(/^import .*;\r?\n/gm, "")
    .replace("const __filename = fileURLToPath(import.meta.url);", 'const __filename = "/test/core/routes/engine25Refresh.js";')
    .replace("export default router;", "globalThis.__handlers = router.handlers;");
  const context = {
    express: { Router: () => ({
      handlers,
      get: (route, fn) => { handlers.GET = fn; },
      post: (route, fn) => { handlers.POST = fn; },
    }) },
    fs: fakeFs, path, crypto: { createHash: (...args) => ({
      update: (bytes) => ({
        digest: () => {
          // Equality is sufficient for this route contract fixture.
          return bytes.toString("utf8");
        },
      }),
    }) },
    fileURLToPath: () => "", spawn: fakeSpawn,
    resolveSystemOperatingSession: () => ({ operating: true }),
    process: { execPath: "node", env: { ENGINE_CRON_TOKEN: options.noConfiguredToken ? "" : "secret" } },
    console: { log() {}, error() {} }, Buffer, Date, Number, Boolean, String,
    setTimeout, clearTimeout, Promise,
  };
  vm.runInNewContext(source, context, { filename: "engine25Refresh.js" });

  async function request(method = "POST", mode = "core", token = "secret") {
    const req = {
      method, query: { mode },
      header: (key) => key === "X-ENGINE-CRON-TOKEN" ? token : undefined,
    };
    const res = {
      statusCode: 200,
      status(status) { this.statusCode = status; return this; },
      json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; },
    };
    await handlers[method](req, res);
    return res;
  }
  return {
    request, calls,
    hold: () => { hold = true; },
    release: () => { hold = false; if (releaseHeld) releaseHeld(); },
    generated: () => generated,
    makeStale: () => { modified = new Date(Date.now() - 60_000); },
  };
}

test("Core GET is rejected with 405", async () => {
  assert.equal((await harness().request("GET")).statusCode, 405);
});
test("Core missing header token is rejected with 401", async () => {
  assert.equal((await harness().request("POST", "core", "")).statusCode, 401);
});
test("Core wrong token is rejected with 401", async () => {
  assert.equal((await harness().request("POST", "core", "incorrect")).statusCode, 401);
});
test("Core fails closed without a configured token", async () => {
  assert.equal((await harness({ noConfiguredToken: true }).request()).statusCode, 401);
});
test("Valid Core runs only the three required jobs in backend route", async () => {
  const h = harness();
  const response = await h.request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.productionOutputVerified, true);
  assert.deepEqual(h.calls, [
    "updateEngine25HistoricalReplayFull.js",
    "buildEngine25CompositeOverlay6mo.js",
    "buildEngine25EsZoneAwareRead.js",
  ]);
});
test("Second Core returns 409 and Live safely skips while Core is busy", async () => {
  const h = harness();
  h.hold();
  const first = h.request();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await h.request();
  assert.equal(second.statusCode, 409);
  const live = await h.request("POST", "live");
  assert.equal(live.body.skipped, true);
  assert.equal(live.body.reason, "ENGINE25_REFRESH_ALREADY_RUNNING");
  h.release();
  assert.equal((await first).statusCode, 200);
});
test("Failed required Core step returns 500", async () => {
  const response = await harness({ failedStep: "buildEngine25CompositeOverlay6mo.js" }).request();
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.ok, false);
});
test("Stale composite cannot pass even when other required files exist", async () => {
  const response = await harness({ stale: true }).request();
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, "CORE_REFRESH_PRODUCTION_OUTPUT_NOT_VERIFIED");
});
test("Same score and unchanged hash is valid only when composite regenerated", async () => {
  const response = await harness().request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.changed, false);
  assert.equal(response.body.compositeAfter.score, 53);
});
test("Updated composite score is reported after regeneration", async () => {
  const response = await harness({ changedScore: true }).request();
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.compositeAfter.score, 58);
  assert.equal(response.body.changed, true);
});
test("Existing Live and Full mode remain available", async () => {
  const live = await harness().request("POST", "live");
  const full = await harness().request("POST", "full");
  assert.equal(live.statusCode, 200);
  assert.equal(full.statusCode, 200);
  assert.equal(live.body.mode, "live");
  assert.equal(full.body.mode, "full");
});
test("Composite writer uses temp + rename and preserves valid JSON", () => {
  const match = builderSource.match(/function writeAtomicJson\([\s\S]*?\n}\n/);
  assert.ok(match, "atomic writer function present");
  const writeAtomicJson = vm.runInNewContext("(" + match[0] + ")", { fs, path, process, Math, Date, JSON });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine25-atomic-"));
  try {
    const dest = path.join(dir, "composite.json");
    fs.writeFileSync(dest, JSON.stringify({ old: true }));
    writeAtomicJson(dest, { score: 53 });
    assert.deepEqual(JSON.parse(fs.readFileSync(dest, "utf8")), { score: 53 });
    assert.deepEqual(fs.readdirSync(dir), ["composite.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
