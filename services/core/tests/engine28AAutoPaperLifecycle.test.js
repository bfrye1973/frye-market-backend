import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const managerPath = path.resolve(
  ROOT,
  "services/core/jobs/autoManageCanonicalPaperLifecycle.js"
);

const runAllPath = path.resolve(
  ROOT,
  "services/core/routes/runAllEngines.js"
);

function source(file) {
  return fs.readFileSync(file, "utf8");
}

test("Engine 28A lifecycle manager is PAPER-only and uses canonical Engine 8 lifecycle route", () => {
  const s = source(managerPath);

  for (const token of [
    "ENGINE8_AUTO_PAPER_LIFECYCLE_ENABLED",
    "ENGINE8_PAPER_ONLY",
    "ENGINE8_CANONICAL_EXECUTOR_ENABLED",
    "ENGINE8_LIVE_TRADING_ENABLED",
    "ENGINE8_ALLOW_LIVE_FUTURES",
    "ENGINE8_ADMIN_SECRET",
    "REPLAY_EXECUTION_FORBIDDEN",
    "/api/trading/paper/execute-lifecycle",
    "AMBIGUOUS_STOP_TARGET_SAME_1M_BAR",
    "OFFICIAL_PLAN_READY",
    "THREE_BLOCK_MANAGEMENT_DISABLED",
  ]) {
    assert.ok(
      s.includes(token),
      `missing lifecycle safety/contract token: ${token}`
    );
  }
});

test("lifecycle manager consumes 1m ES bars and never writes Engine 10 directly", () => {
  const s = source(managerPath);

  assert.match(
    s,
    /timeframe=1m/
  );

  assert.match(
    s,
    /listTrades/
  );

  assert.doesNotMatch(
    s,
    /writeJournalTrades|writeFileSync\([^)]*trade-journal/
  );
});

test("run-all-engines manages open PAPER lifecycle before new signal construction", () => {
  const s = source(runAllPath);

  const lifecycleIndex =
    s.indexOf("engine8_auto_paper_lifecycle");

  const engine1Index =
    s.indexOf("engine1_and_shelves");

  const entryIndex =
    s.indexOf("engine8_auto_paper_execution");

  assert.ok(lifecycleIndex >= 0);
  assert.ok(engine1Index > lifecycleIndex);
  assert.ok(entryIndex > engine1Index);

  assert.match(
    s,
    /autoManageCanonicalPaperLifecycle\.js/
  );
});
