import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  persistEngineRuntimeFiles,
  restoreEngineRuntimeFiles,
} from "../logic/durableEngineRuntimeState.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "engine-runtime-state-"));
}

test("persist then restore survives simulated redeploy", () => {
  const root = tempRoot();
  const dataDir = path.join(root, "data");
  const persistDir = path.join(root, "persist");
  fs.mkdirSync(dataDir, { recursive: true });

  const file = "engine29-cross-market-stress.json";
  const source = { ok: true, version: "test", timestamp: "2026-10-25T19:47:16Z" };
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(source), "utf8");

  const saved = persistEngineRuntimeFiles({
    fileNames: [file],
    dataDir,
    persistDir,
  });

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.saved, [file]);

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const restored = restoreEngineRuntimeFiles({
    fileNames: [file],
    dataDir,
    persistDir,
  });

  assert.equal(restored.ok, true);
  assert.deepEqual(restored.restored, [file]);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")),
    source
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test("valid runtime copy is preserved when already present", () => {
  const root = tempRoot();
  const dataDir = path.join(root, "data");
  const persistDir = path.join(root, "persist");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(persistDir, { recursive: true });

  const file = "engine25-context.json";
  const runtime = { score: 55 };
  const durable = { score: 49 };

  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(runtime), "utf8");
  fs.writeFileSync(path.join(persistDir, file), JSON.stringify(durable), "utf8");

  const restored = restoreEngineRuntimeFiles({
    fileNames: [file],
    dataDir,
    persistDir,
  });

  assert.deepEqual(restored.preserved, [file]);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")),
    runtime
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test("invalid runtime copy is replaced by durable valid copy", () => {
  const root = tempRoot();
  const dataDir = path.join(root, "data");
  const persistDir = path.join(root, "persist");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(persistDir, { recursive: true });

  const file = "engine25-market-health.json";
  const durable = { ok: true, score: 49 };

  fs.writeFileSync(path.join(dataDir, file), "{bad-json", "utf8");
  fs.writeFileSync(path.join(persistDir, file), JSON.stringify(durable), "utf8");

  const restored = restoreEngineRuntimeFiles({
    fileNames: [file],
    dataDir,
    persistDir,
  });

  assert.deepEqual(restored.restored, [file]);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")),
    durable
  );

  fs.rmSync(root, { recursive: true, force: true });
});
