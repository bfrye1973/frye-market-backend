import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const state = {
  version: "engine8.paperAcceptanceState.v1",
  acceptanceTradeCompleted: true,
  newPaperOrdersAllowed: false,
  tradeId: "TRD-A",
  executionId: "EXEC-A",
  orderId: "ORDER-A",
  idempotencyKey: "KEY-A",
  candidateId: "CAND-A",
  planId: "PLAN-A",
  strategyId: "intraday_scalp@10m",
  closedAt: "2026-11-11T20:00:00Z",
  activatedAt: "2026-11-11T20:00:00Z",
  reason: "ENGINE10_CLOSED_ACKNOWLEDGED",
};

function tempPaperStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine8c-isolated-paper-"));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  write("engine8-paper-acceptance-state.json", state);
  write("paper-orders.json", [{
    orderId: "ORDER-A", candidateId: "CAND-A", planId: "PLAN-A",
    strategyId: "intraday_scalp@10m", status: "FILLED",
  }]);
  write("paper-idempotency-ledger.json", {});
  write("engine8-paper-execution-state.json", {
    version: "engine8.paperExecutionState.v1",
    executions: {
      "EXEC-A": {
        executionId: "EXEC-A", candidateId: "CAND-A", planId: "PLAN-A",
        strategyId: "intraday_scalp@10m", status: "ACCEPTANCE_TRADE_COMPLETED",
        tradeId: "TRD-A", executionSuccessful: true, journalPending: false,
      },
    },
  });
  return dir;
}

const script = `
import fs from "node:fs";
import path from "node:path";
import {
  getEngine8DuplicateState, markEngine8AcceptanceTradeCompleted
} from "./services/core/logic/trading/engine8DuplicateState.js";
const query = (candidateId, planId) =>
  getEngine8DuplicateState({strategyId:"intraday_scalp@10m",candidateId,planId});
const a = query("CAND-A", "PLAN-A");
const b = query("CAND-B", "PLAN-B");
const result = process.env.TEST_SECOND_CLOSE === "1" ?
  markEngine8AcceptanceTradeCompleted({
    executionId:"EXEC-B",orderId:"ORDER-B",tradeId:"TRD-B",
    idempotencyKey:"KEY-B",candidateId:"CAND-B",planId:"PLAN-B",
    strategyId:"intraday_scalp@10m",journalStatus:"CLOSED",remainingQty:0,
  }) : null;
const original = JSON.parse(fs.readFileSync(
  path.join(process.env.ENGINE8_PAPER_DATA_DIR,"engine8-paper-acceptance-state.json"),"utf8"
));
console.log(JSON.stringify({a,b,result,original}));
`;

function run(dir, extraEnv = {}) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      ENGINE8_PAPER_DATA_DIR: dir,
      ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED: "1",
      ENGINE8_PAPER_OPERATOR_DISABLED: "0",
      ENGINE8_LIVE_TRADING_ENABLED: "0",
      ENGINE8_ALLOW_LIVE_FUTURES: "0",
      ...extraEnv,
    },
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test("isolated durable store: completed A blocked, distinct B eligible", () => {
  const dir = tempPaperStore();
  try {
    const {a,b} = run(dir);
    assert.equal(a.candidateAlreadyOrdered, true);
    assert.equal(a.acceptanceEligibility.allowed, false);
    assert.equal(b.candidateAlreadyOrdered, false);
    assert.equal(b.journalPendingExecution, false);
    assert.equal(b.acceptanceEligibility.allowed, true);
    assert.equal(b.acceptanceEligibility.priorTrialProven, true);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test("isolated durable store: operator disables B, regardless of completed A", () => {
  const dir = tempPaperStore();
  try {
    assert.equal(run(dir, {ENGINE8_PAPER_OPERATOR_DISABLED:"1"}).b.acceptanceEligibility.allowed, false);
    assert.equal(run(dir, {ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED:"0"}).b.acceptanceEligibility.allowed, false);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test("isolated durable store: later B close preserves first trial receipt and B linkage", () => {
  const dir = tempPaperStore();
  try {
    const {result,original} = run(dir, {TEST_SECOND_CLOSE:"1"});
    assert.equal(result.ok, true);
    assert.equal(result.updated, false);
    assert.equal(result.auditPreserved, true);
    assert.deepEqual(original, state);
    const lifecycle = JSON.parse(fs.readFileSync(path.join(dir,"engine8-paper-execution-state.json"),"utf8"));
    assert.ok(Object.values(lifecycle.executions).some(x=>x.tradeId==="TRD-B"));
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test("isolated durable store: pending Journal blocks fresh B despite valid eligibility", () => {
  const dir = tempPaperStore();
  try {
    const file=path.join(dir,"engine8-paper-execution-state.json");
    const lifecycle=JSON.parse(fs.readFileSync(file,"utf8"));
    lifecycle.executions["EXEC-UNRESOLVED"]={
      strategyId:"intraday_scalp@10m",candidateId:"CAND-UNRESOLVED",
      status:"JOURNAL_PENDING",journalPending:true,executionSuccessful:true,
    };
    fs.writeFileSync(file,JSON.stringify(lifecycle));
    const {b}=run(dir);
    assert.equal(b.journalPendingExecution,true);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
