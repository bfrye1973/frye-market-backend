import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const bridgePath = path.resolve(
  ROOT,
  "services/core/jobs/autoExecuteCanonicalPaperTrade.js"
);

const runAllPath = path.resolve(
  ROOT,
  "services/core/routes/runAllEngines.js"
);

function source(file) {
  return fs.readFileSync(file, "utf8");
}

test("Engine 28A auto-paper bridge is fail-closed and paper-only", () => {
  const s = source(bridgePath);

  assert.match(
    s,
    /ENGINE8_AUTO_PAPER_EXECUTION_ENABLED/
  );

  assert.match(
    s,
    /ENGINE8_CANONICAL_EXECUTOR_ENABLED/
  );

  assert.match(
    s,
    /ENGINE8_PAPER_ONLY/
  );

  assert.match(
    s,
    /ENGINE8_LIVE_TRADING_ENABLED/
  );

  assert.match(
    s,
    /ENGINE8_ALLOW_LIVE_FUTURES/
  );

  assert.match(
    s,
    /REPLAY_EXECUTION_FORBIDDEN/
  );

  assert.match(
    s,
    /READY_TO_CREATE_PAPER_ORDER/
  );

  assert.match(
    s,
    /\/api\/trading\/paper\/execute-canonical/
  );

  assert.match(
    s,
    /x-engine8-admin-secret/
  );
});

test("run-all-engines invokes auto-paper only after build and replay succeed", () => {
  const s = source(runAllPath);

  const buildIndex =
    s.indexOf("build_es_strategy_snapshot");

  const replayIndex =
    s.indexOf("archive_es_replay_snapshot");

  const autoIndex =
    s.indexOf("engine8_auto_paper_execution");

  assert.ok(buildIndex >= 0);
  assert.ok(replayIndex > buildIndex);
  assert.ok(autoIndex > replayIndex);

  assert.match(
    s,
    /step2\.code === 0[\s\S]*step3a\.code === 0[\s\S]*step3b\.code === 0/
  );

  assert.match(
    s,
    /autoExecuteCanonicalPaperTrade\.js/
  );
});
