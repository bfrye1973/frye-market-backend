import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { fileURLToPath } from "url";
import { deriveCandleCompletionTruth } from "../logic/engine3/candleCompletionTruth.js";
import { buildCurrentLevelAction } from "../logic/priceAction/currentLevelAction.js";
import { buildFastImbalanceReaction } from "../logic/engine3/fastImbalanceReaction.js";

const BAR_START_SEC = Date.UTC(2026, 0, 1, 9, 30, 0) / 1000;
const BAR_CLOSE_MS = BAR_START_SEC * 1000 + 600000;

function bar(time = BAR_START_SEC, overrides = {}) {
  return {
    time,
    open: 99,
    high: 102,
    low: 98,
    close: 101,
    volume: 1000,
    ...overrides,
  };
}

function truth(bars, evaluationTimeMs = BAR_CLOSE_MS) {
  return deriveCandleCompletionTruth({
    bars,
    timeframe: "10m",
    evaluationTimeMs,
  });
}

test("10m boundary classification is exact to the millisecond", () => {
  assert.equal(truth([bar()], BAR_CLOSE_MS - 1).latestBarCompletionState, "FORMING");
  assert.equal(truth([bar()], BAR_CLOSE_MS).latestBarCompletionState, "COMPLETED");
  assert.equal(truth([bar()], BAR_CLOSE_MS + 1).latestBarCompletionState, "COMPLETED");
});

test("timestamp units remain seconds for bars and milliseconds for evaluation", () => {
  const input = bar();
  const result = truth([input]);
  assert.equal(result.allBars[0].time, BAR_START_SEC);
  assert.equal(result.evaluationTimeMs, BAR_CLOSE_MS);
  assert.equal(result.latestBarStartTimeMs, BAR_START_SEC * 1000);
  assert.equal(result.latestExpectedCloseTimeMs, BAR_CLOSE_MS);
});

test("missing or invalid timestamps fail closed as completion unknown", () => {
  assert.equal(truth([{ close: 101 }]).latestBarCompletionState, "COMPLETION_UNKNOWN");
  assert.equal(truth([bar("bad")]).latestBarCompletionState, "COMPLETION_UNKNOWN");
  assert.equal(truth([bar()], null).latestBarCompletionState, "COMPLETION_UNKNOWN");
});

test("no bars returns NO_BARS and a forming bar never fabricates completion", () => {
  assert.equal(truth([]).latestBarCompletionState, "NO_BARS");
  const result = truth([bar()], BAR_CLOSE_MS - 1);
  assert.deepEqual(result.completedBars, []);
  assert.equal(result.formingBar.time, BAR_START_SEC);
});

test("missing intervals are not filled", () => {
  const result = truth([bar(BAR_START_SEC - 1200), bar(BAR_START_SEC)]);
  assert.equal(result.allBars.length, 2);
  assert.deepEqual(result.allBars.map((item) => item.time), [BAR_START_SEC - 1200, BAR_START_SEC]);
});

test("out-of-order and duplicate timestamps are deterministic", () => {
  const firstDuplicate = bar(BAR_START_SEC, { close: 100 });
  const secondDuplicate = bar(BAR_START_SEC, { close: 101 });
  const result = truth([secondDuplicate, bar(BAR_START_SEC - 600), firstDuplicate]);
  assert.deepEqual(result.allBars.map((item) => item.close), [101, 101, 100]);
});

test("helper does not mutate the input array or bar objects", () => {
  const input = [bar(BAR_START_SEC), bar(BAR_START_SEC - 600)];
  const before = structuredClone(input);
  truth(input);
  assert.deepEqual(input, before);
  assert.notEqual(truth(input).allBars[0], input[1]);
});

function currentLevel(evaluationTimeMs) {
  return buildCurrentLevelAction({
    tf: "10m",
    bars10m: [
      bar(BAR_START_SEC - 600, { high: 100, close: 99 }),
      bar(BAR_START_SEC),
    ],
    currentPrice: 101,
    referenceLevels: [100],
    evaluationTimeMs,
  });
}

test("current-level observation survives while forming confirmation fails closed", () => {
  const result = currentLevel(BAR_CLOSE_MS - 1);
  assert.equal(result.state, "WICK_BELOW_AND_RECLAIM");
  assert.equal(result.direction, "LONG");
  assert.equal(result.quality, "STRONG");
  assert.equal(result.confirmed, false);
  assert.equal(result.candleClosed, false);
  assert.equal(result.candleCompletionState, "FORMING");
});

test("current-level completed supporting candle may confirm", () => {
  const result = currentLevel(BAR_CLOSE_MS);
  assert.equal(result.confirmed, true);
  assert.equal(result.candleClosed, true);
  assert.equal(result.supportingBarTime, BAR_START_SEC);
  assert.equal(result.supportingExpectedCloseTimeMs, BAR_CLOSE_MS);
});

test("current-level unknown completion preserves observation", () => {
  const result = currentLevel(null);
  assert.equal(result.active, true);
  assert.equal(result.state, "WICK_BELOW_AND_RECLAIM");
  assert.equal(result.confirmed, false);
  assert.equal(result.candleClosed, null);
  assert.equal(result.candleCompletionState, "COMPLETION_UNKNOWN");
});

function withManualImbalance(run) {
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  fs.existsSync = () => true;
  fs.readFileSync = () => "99 - 101";
  try {
    return run();
  } finally {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
  }
}

function fastReaction(evaluationTimeMs) {
  return withManualImbalance(() =>
    buildFastImbalanceReaction({
      tf: "10m",
      bars10m: [
        bar(BAR_START_SEC - 600, { high: 100, close: 99 }),
        bar(BAR_START_SEC),
      ],
      currentPrice: 101,
      evaluationTimeMs,
    })
  );
}

test("fast reaction cannot confirm from a forming supporting candle", { concurrency: false }, () => {
  const result = fastReaction(BAR_CLOSE_MS - 1);
  assert.equal(result.state, "WICK_BELOW_AND_RECLAIM");
  assert.equal(result.earlySignal, true);
  assert.equal(result.confirmed, false);
  assert.equal(result.rawConfirmed, false);
  assert.equal(result.candleClosed, false);
});

test("fast reaction completed supporting candle may confirm", { concurrency: false }, () => {
  const result = fastReaction(BAR_CLOSE_MS);
  assert.equal(result.confirmed, true);
  assert.equal(result.rawConfirmed, true);
  assert.equal(result.candleClosed, true);
});

test("fast reaction unknown completion publishes candleClosed null", { concurrency: false }, () => {
  const result = fastReaction(null);
  assert.equal(result.state, "WICK_BELOW_AND_RECLAIM");
  assert.equal(result.confirmed, false);
  assert.equal(result.candleClosed, null);
});

test("snapshot wiring uses one evaluationTimeMs and completed bars for official EMA", () => {
  const snapshotPath = fileURLToPath(new URL("../jobs/buildStrategySnapshot.js", import.meta.url));
  const source = fs.readFileSync(snapshotPath, "utf8");
  assert.match(source, /const evaluationTimeMs = Date\.now\(\);/);
  assert.match(source, /buildEmaPostureBlock\(symbol, evaluationTimeMs\)/);
  assert.match(source, /const officialBars = completionTruth\?\.completedBars \|\| bars;/);
  assert.match(source, /attachCurrentLevelActionToConfluence\([\s\S]*?evaluationTimeMs,/);
  assert.match(source, /attachFastImbalanceReactionToConfluence\([\s\S]*?evaluationTimeMs,/);
});

test("identity constants and branch contracts remain unchanged", () => {
  const root = fileURLToPath(new URL("../logic/engine3/", import.meta.url));
  const reactionSource = fs.readFileSync(`${root}paperScalpReaction.js`, "utf8");
  const snapshotPath = fileURLToPath(new URL("../jobs/buildStrategySnapshot.js", import.meta.url));
  const snapshotSource = fs.readFileSync(snapshotPath, "utf8");
  const engine26Path = fileURLToPath(
    new URL("../logic/engine26/buildEngine26LocationCandidate.js", import.meta.url)
  );
  const engine26Source = fs.readFileSync(engine26Path, "utf8");
  assert.match(reactionSource, /WICK_BELOW_AND_RECLAIM/);
  assert.match(reactionSource, /FAILED_RECLAIM/);
  assert.match(reactionSource, /candidateIdentityVersion/);
  assert.match(snapshotSource, /intraday_scalp@10m/);
  assert.match(snapshotSource, /laneId:\s*"minute"/);
  assert.match(engine26Source, /engine26\.strategy1\.v2/);
});
