// services/core/tests/engine12Engine27ReplayPreservation.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReplayArchive } from "../jobs/archiveEsReplaySnapshot.js";

function engine27() {
  return {
    engine27WaveIntelligence: { minute: { currentWave: "W3", snapshotTime: "2026-08-28T17:30:00.000Z" } },
    engine27FibIntelligence: { minute: { nextFib: "e100", nextPrice: 7812.25, snapshotTime: "2026-08-28T17:30:00.000Z" } },
    engine27Alignment: { waveStageCompatibility: { minuteVsMinor: "ALIGNED" }, snapshotTime: "2026-08-28T17:30:00.000Z" },
    engine27MarketStory: { headline: "Minute W3 continuation", outlook: "CONTINUATION_WATCH", snapshotTime: "2026-08-28T17:30:00.000Z" },
    engine27TraderDecision: { decisions: { minute: {
      laneId: "minute", strategyId: "intraday_scalp@10m", candidateId: "E26C-TEST",
      zoneId: "E26Z-TEST", symbol: "ES", direction: "LONG",
      setupType: "NEGOTIATED_ZONE_ROTATION", decisionState: "READY",
      plannerReady: true, invalidated: false, waitingFor: [], blockers: [],
      warnings: [], reasonCodes: ["ENGINE27E_READY"], currentPrice: 7800.25,
      snapshotTime: "2026-08-28T17:30:00.000Z"
    } } },
    decisions: { minute: { decision: "READY", snapshotTime: "2026-08-28T17:30:00.000Z" } }
  };
}

function source(include27 = true) {
  const o = {
    ok: true,
    schema: "strategy.snapshot.test.v1",
    generatedAtUtc: "2026-08-28T17:30:00.000Z",
    snapshotTime: "2026-08-28T17:30:00.000Z",
    symbol: "ES",
    strategies: {
      "intraday_scalp@10m": {
        strategyId: "intraday_scalp@10m",
        analytics: { engine5: { duplicateOnly: true } },
        confluence: { context: { reaction: { preserved: "ENGINE3" }, volume: { preserved: "ENGINE4" } } },
        permission: { paper: { decision: "FAST_INTRADAY_PAPER_ALLOW", allowed: true } },
        engine22Scalp: { preserved: true },
        engine22WaveStrategy: { preserved: true },
        engine26LocationCandidate: { candidateId: "E26C-TEST", zoneId: "E26Z-TEST" },
        engine26PaperTradePlan: { preserved: true },
        engine7PositionSizing: { preserved: true },
        engine9OfficialManagementPlan: { preserved: true },
        engine8PaperOrder: { preserved: true },
        engine10Journal: null,
        strategyTimeline: { preserved: true }
      }
    }
  };
  if (include27) o.engine27Strategies = engine27();
  return o;
}

function fixture(src) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "engine12-e27-"));
  const sourceFile = path.join(root, "strategy-snapshot-es.json");
  const replayRoot = path.join(root, "replay", "es");
  const markerIndexFile = path.join(replayRoot, "markers", "engine26-replay-markers.jsonl");
  fs.writeFileSync(sourceFile, JSON.stringify(src, null, 2));
  return { root, sourceFile, replayRoot, markerIndexFile };
}

test("preserves full Engine 27 root unchanged", () => {
  const src = source(true);
  const f = fixture(src);
  try {
    const result = runReplayArchive({
      now: new Date("2026-08-28T17:30:00.000Z"),
      sourceFile: f.sourceFile,
      replayRoot: f.replayRoot,
      markerIndexFile: f.markerIndexFile
    });
    assert.equal(result.replayWritten, true);
    const text = fs.readFileSync(result.file, "utf8");
    const replay = JSON.parse(text);

    assert.equal(text, JSON.stringify(replay));
    assert.deepStrictEqual(replay.engine27Strategies, src.engine27Strategies);
    assert.deepStrictEqual(replay.engine27Strategies.engine27WaveIntelligence.minute, src.engine27Strategies.engine27WaveIntelligence.minute);
    assert.deepStrictEqual(replay.engine27Strategies.engine27FibIntelligence.minute, src.engine27Strategies.engine27FibIntelligence.minute);
    assert.deepStrictEqual(replay.engine27Strategies.engine27Alignment, src.engine27Strategies.engine27Alignment);
    assert.deepStrictEqual(replay.engine27Strategies.engine27MarketStory, src.engine27Strategies.engine27MarketStory);
    assert.deepStrictEqual(replay.engine27Strategies.engine27TraderDecision.decisions.minute, src.engine27Strategies.engine27TraderDecision.decisions.minute);
    assert.deepStrictEqual(replay.engine27Strategies.decisions.minute, src.engine27Strategies.decisions.minute);

    const a = src.strategies["intraday_scalp@10m"];
    const b = replay.strategies["intraday_scalp@10m"];
    for (const key of [
      "engine22Scalp","engine22WaveStrategy","engine26LocationCandidate",
      "engine26PaperTradePlan","confluence","permission","engine7PositionSizing",
      "engine9OfficialManagementPlan","engine8PaperOrder","engine10Journal","strategyTimeline"
    ]) assert.deepStrictEqual(b[key], a[key]);

    assert.equal(b.analytics, undefined);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("does not manufacture Engine 27 when source omits it", () => {
  const src = source(false);
  const f = fixture(src);
  try {
    const result = runReplayArchive({
      now: new Date("2026-08-28T17:31:00.000Z"),
      sourceFile: f.sourceFile,
      replayRoot: f.replayRoot,
      markerIndexFile: f.markerIndexFile
    });
    const replay = JSON.parse(fs.readFileSync(result.file, "utf8"));
    assert.equal(Object.prototype.hasOwnProperty.call(replay, "engine27Strategies"), false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
