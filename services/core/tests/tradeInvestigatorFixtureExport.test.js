// services/core/tests/tradeInvestigatorFixtureExport.test.js
//
// The fixture export job: source SHA over original bytes, projection keeps
// investigator outcomes identical, redaction, no overwrite, refuses protected
// output locations, source untouched.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { exportFixtures, projectReplayForFixture, isInside, parseExpectedHashes } from "../jobs/exportTradeInvestigatorFixtures.js";
import { buildInvestigation } from "../logic/investigator/buildInvestigation.js";
import { S1, nov24Scenario, makeScenario, query } from "./fixtures/tradeInvestigator/syntheticScenarios.js";

test("export: original-byte SHA, projection preserves investigation outcome, source untouched", () => {
  const sc = nov24Scenario();
  const src = path.join(sc.config.replayRoot, "2026-11-24", "1016.json");
  const srcBytes = fs.readFileSync(src);
  const srcStat = fs.statSync(src);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "e12-fixture-out-"));
  const results = exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746", "0752", "1016", "1025"], strategyId: S1, outDir: out });
  assert.equal(results.filter((r) => r.ok).length, 4);
  const fx = JSON.parse(fs.readFileSync(path.join(out, "2026-11-24_1016.fixture.json"), "utf8"));
  assert.equal(fx.sourceSha256, crypto.createHash("sha256").update(srcBytes).digest("hex"));
  assert.equal(fs.statSync(src).mtimeMs, srcStat.mtimeMs);

  for (const time of ["0746", "0752", "1016", "1025"]) {
    const f = JSON.parse(fs.readFileSync(path.join(out, "2026-11-24_" + time + ".fixture.json"), "utf8"));
    const projected = makeScenario({ replays: { ["2026-11-24/" + time]: f.replay }, orders: [], journal: [] });
    const a = buildInvestigation({ query: query({ time }), config: sc.config }).body.knownAtDecision;
    const b = buildInvestigation({ query: query({ time }), config: projected.config }).body.knownAtDecision;
    assert.deepEqual(b.firstBlocker, a.firstBlocker, time);
    assert.deepEqual(b.pipeline.map((r) => [r.engine, r.status]), a.pipeline.map((r) => [r.engine, r.status]), time);
  }
});

test("export never overwrites an existing fixture", () => {
  const sc = nov24Scenario();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "e12-fixture-out-"));
  exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746"], strategyId: S1, outDir: out });
  assert.throws(() => exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746"], strategyId: S1, outDir: out }), /EEXIST/);
});

test("export refuses output inside /var/data/replay or the Replay root", () => {
  const sc = nov24Scenario();
  assert.throws(() => exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746"], strategyId: S1, outDir: "/var/data/replay/fixtures" }), /PROTECTED/);
  assert.throws(() => exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746"], strategyId: S1, outDir: path.join(sc.config.replayRoot, "x") }), /PROTECTED/);
  assert.equal(isInside("/var/data/replay-other", "/var/data/replay"), false);
});

test("before/after proof recorded and manifest written exclusively", () => {
  const sc = nov24Scenario();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "e12-fixture-out-"));
  const [r] = exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["1016"], strategyId: S1, outDir: out });
  assert.equal(r.status, "EXPORTED");
  assert.equal(r.sourceUnchanged, true);
  assert.equal(r.before.sha256, r.after.sha256);
  assert.equal(r.before.byteLength, r.after.byteLength);
  assert.equal(r.before.mtimeMs, r.after.mtimeMs);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "2026-11-24_export-manifest.json"), "utf8"));
  assert.equal(manifest.allSucceeded, true);
  assert.equal(manifest.results[0].before.sha256, r.before.sha256);
});

test("source mutated between before and after reads => FAILED, fixture removed", () => {
  const sc = nov24Scenario();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "e12-fixture-out-"));
  const [r] = exportFixtures({
    replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["1016"], strategyId: S1, outDir: out,
    testHooks: { afterFixtureWrite: (_t, src) => fs.appendFileSync(src, " ") },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, "FAILED_SOURCE_CHANGED_DURING_EXPORT");
  assert.notEqual(r.before.sha256, r.after.sha256);
  assert.equal(fs.existsSync(path.join(out, "2026-11-24_1016.fixture.json")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "2026-11-24_export-manifest.json"), "utf8"));
  assert.equal(manifest.allSucceeded, false);
});

test("independent host hash: match recorded, mismatch refused before any write", () => {
  const sc = nov24Scenario();
  const src = path.join(sc.config.replayRoot, "2026-11-24", "0746.json");
  const good = crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex");
  const out1 = fs.mkdtempSync(path.join(os.tmpdir(), "e12-fixture-out-"));
  const [a] = exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746"], strategyId: S1, outDir: out1, expectedSha256: { "0746": good } });
  assert.equal(a.hostHashMatch, true);
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), "e12-fixture-out-"));
  const [b] = exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746"], strategyId: S1, outDir: out2, expectedSha256: { "0746": "0".repeat(64) } });
  assert.equal(b.status, "SOURCE_HASH_DIFFERS_FROM_HOST_RECORD");
  assert.equal(fs.existsSync(path.join(out2, "2026-11-24_0746.fixture.json")), false);
  assert.throws(() => parseExpectedHashes("0746=nothex"), /BAD_EXPECTED_SHA256_ENTRY/);
});

test("output path that resolves through a symlink into the Replay root is refused", () => {
  const sc = nov24Scenario();
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e12-link-")), "out");
  fs.symlinkSync(sc.config.replayRoot, link);
  assert.throws(() => exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0746"], strategyId: S1, outDir: path.join(link, "fixtures") }), /PROTECTED/);
  assert.equal(fs.existsSync(path.join(sc.config.replayRoot, "fixtures")), false);
});

test("symlinked source file is refused, never followed", () => {
  const sc = nov24Scenario();
  const day = path.join(sc.config.replayRoot, "2026-11-24");
  fs.symlinkSync(path.join(day, "0746.json"), path.join(day, "0800.json"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "e12-fixture-out-"));
  const [r] = exportFixtures({ replayRoot: sc.config.replayRoot, date: "2026-11-24", times: ["0800"], strategyId: S1, outDir: out });
  assert.equal(r.status, "SOURCE_PATH_POLICY_REFUSED");
});

test("projection keeps only one lane and investigator paths; redacts", () => {
  const replay = {
    schema: "s", generatedAtUtc: "t",
    strategies: {
      [S1]: { strategyId: S1, engine8PaperOrder: { accountId: "999888", status: "X" }, unrelatedBulk: { big: [1, 2, 3] } },
      "minor_swing@1h": { strategyId: "minor_swing@1h" },
    },
  };
  const p = projectReplayForFixture(replay, S1);
  assert.deepEqual(Object.keys(p.strategies), [S1]);
  assert.equal(p.strategies[S1].unrelatedBulk, undefined);
});
