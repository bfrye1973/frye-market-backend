// Owner directive #425: an Engine 6-approved trade that does not become an order is
// always logged and alerted. Synthetic data only; no network (send is injected).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  alertIfApprovedNotOrdered, engine6ApprovedTrade,
} from "../logic/trading/engine8ApprovedNotOrderedAlert.js";
import {
  engine8ExecutionBlockers, engine8PrimaryStatus,
} from "../logic/trading/engine8ExecutionGuards.js";

const approved = (extra = {}) => ({
  status: "DUPLICATE_ORDER_BLOCKED", blocker: "PLAN_ALREADY_ORDERED",
  blockers: ["PLAN_ALREADY_ORDERED", "NO_ORDER_CREATED"],
  direction: "SHORT", candidateId: "CAND-1", planId: "PLAN-1",
  engine6: { allowed: true, decision: "FAST_INTRADAY_PAPER_ALLOW" }, ...extra,
});

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "e8-alert-")); }

test("approved but not ordered: logs every cycle, alerts once per trade+reason", async () => {
  const root = tmp(); const sent = []; const logs = [];
  const send = async (m) => { sent.push(m); return { ok: true }; };
  try {
    const first = await alertIfApprovedNotOrdered({ engine8PaperOrder: approved(), stage: "ADAPTER_NOT_READY", reason: "X", root, send, log: (l) => logs.push(l) });
    assert.equal(first.alertSent, true);
    assert.equal(first.primaryBlocker, "PLAN_ALREADY_ORDERED");
    assert.match(sent[0].message, /Engine 6 approved SHORT but Engine 8 placed NO order/);
    assert.match(sent[0].message, /PLAN_ALREADY_ORDERED/);
    const again = await alertIfApprovedNotOrdered({ engine8PaperOrder: approved(), stage: "ADAPTER_NOT_READY", reason: "X", root, send, log: (l) => logs.push(l) });
    assert.equal(again.deduped, true);
    assert.equal(sent.length, 1, "one push per trade+reason");
    assert.equal(logs.length, 2, "but logged every cycle");
    assert.equal(logs[0].event, "ENGINE8_APPROVED_TRADE_NOT_ORDERED");
    await alertIfApprovedNotOrdered({ engine8PaperOrder: approved({ blocker: "PAPER_TRADING_DISABLED" }), reason: "X", root, send, log: () => {} });
    assert.equal(sent.length, 2, "a different reason alerts again");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("no Engine 6 approval: no log, no alert", async () => {
  const root = tmp(); let calls = 0;
  try {
    for (const o of [null, approved({ engine6: { allowed: false, decision: "PAPER_STAND_DOWN" } }),
      approved({ engine6: { allowed: true, decision: "PAPER_WATCH_FAST" } }), approved({ direction: "NONE" })]) {
      assert.equal(engine6ApprovedTrade(o), false);
      assert.equal(await alertIfApprovedNotOrdered({ engine8PaperOrder: o, root, send: async () => { calls++; return { ok: true }; }, log: () => { calls++; } }), null);
    }
    assert.equal(calls, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("alert failure or hang never throws and is retried next cycle", async () => {
  const root = tmp(); let calls = 0;
  try {
    const failed = await alertIfApprovedNotOrdered({ engine8PaperOrder: approved(), root, log: () => {}, send: async () => { calls++; return { ok: false, error: "x" }; } });
    assert.equal(failed.alertSent, false);
    const thrown = await alertIfApprovedNotOrdered({ engine8PaperOrder: approved(), root, log: () => {}, send: () => { calls++; throw new Error("boom"); } });
    assert.equal(thrown, null, "never throws");
    const ok = await alertIfApprovedNotOrdered({ engine8PaperOrder: approved(), root, log: () => {}, send: async () => { calls++; return { ok: true }; } });
    assert.equal(ok.alertSent, true, "not deduped after a failed send");
    assert.equal(calls, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("execution guards: only the PAPER switch and true duplicates block, in priority order", () => {
  assert.deepEqual(engine8ExecutionBlockers({}), []);
  assert.deepEqual(engine8ExecutionBlockers({
    openTradeForStrategy: true, acceptanceTradeCompleted: true, newPaperOrdersAllowed: false,
    otherTradeJournalPending: true,
  }), [], "open trade, legacy trial lock and another trade's pending Journal never block");
  const all = engine8ExecutionBlockers({
    paperTradingDisabled: true, idempotencyKeyAlreadyUsed: true, orderExistsForPlanId: true,
    candidateAlreadyOrdered: true, activeTradeIdExists: true, journalPendingExecution: true,
  });
  assert.deepEqual(all, ["PAPER_TRADING_DISABLED", "IDEMPOTENCY_KEY_ALREADY_USED", "PLAN_ALREADY_ORDERED",
    "CANDIDATE_ALREADY_ORDERED", "SAME_TRADE_ALREADY_ACTIVE", "SAME_TRADE_JOURNAL_PENDING"]);
  assert.equal(engine8PrimaryStatus(all), "PAPER_TRADING_DISABLED");
  assert.equal(engine8PrimaryStatus(["PLAN_ALREADY_ORDERED"]), "DUPLICATE_ORDER_BLOCKED");
  assert.equal(engine8PrimaryStatus([]), null);
});
