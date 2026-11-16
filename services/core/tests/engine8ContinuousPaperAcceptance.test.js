import test from "node:test";
import assert from "node:assert/strict";
import { resolveEngine8PaperAcceptanceEligibility as resolve } from
  "../logic/trading/engine8PaperAcceptanceEligibility.js";

const completed = {
  version: "engine8.paperAcceptanceState.v1",
  acceptanceTradeCompleted: true,
  newPaperOrdersAllowed: false,
  tradeId: "TRADE-A",
  executionId: "EXEC-A",
  orderId: "ORDER-A",
  candidateId: "CAND-A",
  planId: "PLAN-A",
  strategyId: "intraday_scalp@10m",
  closedAt: "2026-11-11T20:00:00Z",
  activatedAt: "2026-11-11T20:00:01Z",
  reason: "ENGINE10_CLOSED_ACKNOWLEDGED",
};

const authorized = {
  storePresent: true,
  continuousPaperAuthorized: true,
  candidateId: "CAND-B",
  planId: "PLAN-B",
};

test("P0: last completed acceptance trial is immutable audit, not a global quota", () => {
  const result = resolve({ ...authorized, state: completed });
  assert.equal(result.allowed, true);
  assert.equal(result.priorTrialCompleted, true);
  assert.equal(result.priorTrialProven, true);
  assert.equal(result.reason, "PRIOR_ACCEPTANCE_TRIAL_AUDIT_ONLY");
  assert.equal(completed.newPaperOrdersAllowed, false, "resolver must not rewrite state");
});

test("P0: completed candidate and plan cannot reopen with a new execution ID", () => {
  for (const fields of [
    { candidateId: "CAND-A", planId: "PLAN-OTHER" },
    { candidateId: "CAND-OTHER", planId: "PLAN-A" },
  ]) {
    const result = resolve({ ...authorized, ...fields, state: completed });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "COMPLETED_ACCEPTANCE_CANDIDATE_REPLAY");
  }
});

test("P0: prior trial never grants continuous execution without explicit authorization", () => {
  const result = resolve({ ...authorized, state: completed, continuousPaperAuthorized: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "CONTINUOUS_PAPER_COMPATIBILITY_NOT_AUTHORIZED");
});

test("P0: independent operator disable blocks even a proven trial and fresh candidate", () => {
  const result = resolve({ ...authorized, state: completed, operatorPaperDisabled: true });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ENGINE8_OPERATOR_PAPER_ORDERS_DISABLED");
});

test("P0: unknown legacy reason cannot reinterpret an explicit false setting", () => {
  const result = resolve({ ...authorized, state: { ...completed, reason: "MANUAL_OPERATOR_DISABLE" } });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "PAPER_ACCEPTANCE_PROVENANCE_UNVERIFIED");
});

test("P0: missing/ambiguous/corrupt-shaped authorization fails closed", () => {
  for (const [state, present] of [
    [null, false],
    [{}, true],
    [[completed], true],
    [{ ...completed, newPaperOrdersAllowed: "false" }, true],
    [{ ...completed, tradeId: null }, true],
    [{ ...completed, reason: "ENGINE10_CLOSED_ACKNOWLEDGED", closedAt: null }, true],
  ]) {
    assert.equal(resolve({ ...authorized, state, storePresent: present }).allowed, false);
  }
});

test("P0: ordinary explicitly enabled PAPER store admits fresh candidate", () => {
  const result = resolve({
    ...authorized,
    continuousPaperAuthorized: false,
    state: {
      version: "engine8.paperAcceptanceState.v1",
      acceptanceTradeCompleted: false,
      newPaperOrdersAllowed: true,
    },
  });
  assert.equal(result.allowed, true);
});

test("P0: independently disabled ordinary store blocks new PAPER orders", () => {
  const result = resolve({
    ...authorized,
    state: { acceptanceTradeCompleted: false, newPaperOrdersAllowed: false },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "NEW_PAPER_ORDERS_DISABLED");
});

test("P0: contradictory completed state is never silently migrated", () => {
  const result = resolve({
    ...authorized,
    state: { ...completed, newPaperOrdersAllowed: true },
  });
  assert.equal(result.allowed, false);
});

test("P0: alternative legacy Engine 10 receipt requires CLOSED and zero remaining", () => {
  const legacy = {
    ...completed,
    reason: "ENGINE10_CONFIRMED_FINAL_CLOSE",
    engine10Status: "CLOSED",
    remainingQty: 0,
    journalCompleted: true,
  };
  assert.equal(resolve({ ...authorized, state: legacy }).allowed, true);
  for (const broken of [
    { engine10Status: "OPEN" },
    { remainingQty: 1 },
    { journalCompleted: false },
  ]) {
    assert.equal(resolve({ ...authorized, state: { ...legacy, ...broken } }).allowed, false);
  }
});
