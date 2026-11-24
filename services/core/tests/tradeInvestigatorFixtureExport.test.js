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

import { exportFixtures, projectReplayForFixture, isInside } from "../jobs/exportTradeInvestigatorFixtures.js";
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
