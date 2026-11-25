import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("ES snapshot publishes strategy account registry and monitor after strategy assembly", () => {
  const file = fileURLToPath(new URL("../jobs/buildStrategySnapshot.js", import.meta.url));
  const source = fs.readFileSync(file, "utf8");

  assert.match(source, /getStrategyAccountRegistry/);
  assert.match(source, /buildStrategyAccountMonitoring/);
  assert.match(source, /strategyAccountRegistry:/);
  assert.match(source, /strategyAccountMonitoring:/);
  assert.match(source, /listTrades\(\{\s*status:\s*"OPEN",\s*accountMode:\s*"REAL"/s);

  const loop = source.indexOf("for (const s of STRATEGIES)");
  const monitor = source.lastIndexOf("result.strategyAccountMonitoring =");
  const write = source.indexOf("fs.writeFileSync(SNAPSHOT_FILE");

  assert.ok(loop >= 0);
  assert.ok(monitor > loop);
  assert.ok(write > monitor);
});

test("account monitor stays read-only in snapshot assembly", () => {
  const file = fileURLToPath(new URL("../jobs/buildStrategySnapshot.js", import.meta.url));
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /noPermissionCreated/);
  assert.match(source, /noExecution/);
  assert.match(source, /noJournalMutation/);
});