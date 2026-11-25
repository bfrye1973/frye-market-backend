// services/core/tests/tradeInvestigatorJoins.test.js
//
// Engine 12 Trade Investigator: Engine 8 / Engine 10 identity joins,
// PAPER/REAL isolation, ambiguity, conflicts, zero lookahead.
// SYNTHETIC lifecycle fixtures (isolated temp dirs; registry only proves 2026-11-24).

import test from "node:test";
import assert from "node:assert/strict";

import { buildInvestigation } from "../logic/investigator/buildInvestigation.js";
import {
  S1, LIFE_DATE, lifecycleReplay, paperOrder, journalTrade, makeScenario, nov24Scenario, nov24_1016, query,
} from "./fixtures/tradeInvestigator/syntheticScenarios.js";

function life({ replay = lifecycleReplay(), orders = [], executions = [], journal = [], journalRaw } = {}) {
  const sc = makeScenario({
    replays: { [LIFE_DATE + "/1000"]: replay },
    orders, executions, ...(journalRaw !== undefined ? { journalRaw } : { journal }),
  });
  return buildInvestigation({ query: query({ date: LIFE_DATE, time: "1000" }), config: sc.config }).body;
}

const ORDER_A = paperOrder({ orderId: "E8O-A" });

test("OPEN trade: plan-tier Engine 8 match, order-tier Journal chain, fill is subsequent", () => {
  const body = life({
    orders: [ORDER_A],
    executions: [{ ts: ORDER_A.filledAt, orderId: "E8O-A", action: "NEW_ENTRY", qty: 3, filledQty: 3, avgPrice: 7230.25, status: "filled" }],
    journal: [journalTrade({ tradeId: "T-A", orderId: "E8O-A" })],
  });
  assert.equal(body.execution.status, "MATCHED");
  assert.equal(body.execution.matchTier, "planId");
  assert.equal(body.execution.executions.length, 1);
  assert.equal(body.execution.entryFill.status, "FILLED_PER_ENGINE8_PAPER_STORE");
  assert.equal(body.journal.status, "MATCHED");
  assert.equal(body.journal.matchTier, "orderId");
  assert.equal(body.outcome.trade.status, "OPEN");
  assert.equal(body.outcome.trade.qty.remainingQty, 3);
  assert.ok(body.outcome.journalReadAt);
  assert.equal(body.journal.store.mutable, true);
  assert.equal(body.journal.store.retentionGuarantee, "NONE_DEFINED");
  assert.equal(body.execution.stores[0].retentionGuarantee, "NONE_DEFINED");
  assert.equal(body.outcome.lifecycle, "MATCHED");
  assert.equal(body.execution.lifecycle, "MATCHED");
  assert.equal(body.priorEvents.length, 0);
  assert.ok(body.subsequentEvents.length >= 2);
  for (const e of body.subsequentEvents) {
    assert.ok(Date.parse(e.eventTime) >= Date.parse(body.knownAtDecision.decisionTime));
  }
});

test("PARTIAL trade: reduction events and remaining quantity preserved with their own timestamps", () => {
  const body = life({
    orders: [ORDER_A],
    journal: [journalTrade({
      tradeId: "T-B", orderId: "E8O-A", status: "PARTIAL", remainingQty: 1,
      events: [{ eventType: "PARTIAL_CLOSE", ts: "2026-11-24T17:12:00.000Z", price: 7236, qtyClosed: 2, remainingQty: 1, targetId: "T1" }],
    })],
  });
  assert.equal(body.outcome.trade.status, "PARTIAL");
  assert.equal(body.outcome.trade.qty.remainingQty, 1);
  const reduce = body.subsequentEvents.find((e) => e.eventType === "ENGINE10_PARTIAL_CLOSE");
  assert.equal(reduce.eventTime, "2026-11-24T17:12:00.000Z");
  assert.equal(reduce.qtyClosed, 2);
});

test("CLOSED trade: exit and recorded gross P&L", () => {
  const body = life({
    orders: [ORDER_A],
    journal: [journalTrade({
      tradeId: "T-C", orderId: "E8O-A", status: "CLOSED", remainingQty: 0, realizedPnL: 78.75,
      closeTime: "2026-11-24T17:40:00.000Z",
      events: [
        { eventType: "PARTIAL_CLOSE", ts: "2026-11-24T17:12:00.000Z", price: 7236, qtyClosed: 2, remainingQty: 1 },
        { eventType: "FULL_CLOSE", ts: "2026-11-24T17:40:00.000Z", price: 7238, qtyClosed: 1, remainingQty: 0, exitReason: "TARGET2" },
      ],
    })],
  });
  assert.equal(body.outcome.trade.status, "CLOSED");
  assert.equal(body.outcome.trade.outcome.realizedPnL, 78.75);
  assert.equal(body.outcome.trade.outcome.pnlBasis, "GROSS_AS_RECORDED_BY_ENGINE10");
  assert.equal(body.subsequentEvents.at(-1).eventType, "ENGINE10_FULL_CLOSE");
});

test("no lookahead: knownAtDecision carries no fill/outcome data; events split exactly at decisionTime", () => {
  const atDecision = paperOrder({ orderId: "E8O-AT", filledAt: "2026-11-24T17:00:02.000Z" });
  const body = life({ orders: [atDecision], journal: [] });
  const k = JSON.stringify(body.knownAtDecision);
  assert.ok(!k.includes("E8O-AT"), "fill identity must not appear in knownAtDecision");
  assert.ok(!k.includes("avgPrice"));
  assert.equal(body.subsequentEvents[0].eventTime, "2026-11-24T17:00:02.000Z", "event at decisionTime is subsequent, never prior");
  assert.equal(body.knownAtDecision.executionAtDecision.orderCreated.value, false);
});

test("prior same-identity order is reported as priorEvents, not as known at decision", () => {
  const earlier = paperOrder({ orderId: "E8O-EARLY", filledAt: "2026-11-24T16:52:00.000Z" });
  const body = life({ orders: [earlier], journal: [] });
  assert.equal(body.priorEvents.length, 1);
  assert.equal(body.priorEvents[0].orderId, "E8O-EARLY");
  assert.equal(body.subsequentEvents.length, 0);
});

test("missing Engine 8 store => UNAVAILABLE; missing Journal => UNAVAILABLE", () => {
  const sc = makeScenario({ replays: { [LIFE_DATE + "/1000"]: lifecycleReplay() } });
  const body = buildInvestigation({ query: query({ date: LIFE_DATE, time: "1000" }), config: sc.config }).body;
  assert.equal(body.execution.status, "UNAVAILABLE");
  assert.equal(body.journal.status, "UNAVAILABLE");
  assert.equal(body.outcome.trade, null);
});

test("corrupt Journal => ERROR, never treated as an empty journal", () => {
  const body = life({ orders: [ORDER_A], journalRaw: "[{\"tradeId\": " });
  assert.equal(body.journal.status, "ERROR");
  assert.equal(body.journal.reason, "JSON_PARSE_FAILED");
  assert.ok(body.flags.some((f) => f.flag === "ERROR" && f.detail.source === "ENGINE10"));
});

test("ambiguous: two opening orders for the same plan => AMBIGUOUS, nothing selected", () => {
  const body = life({
    orders: [paperOrder({ orderId: "E8O-1" }), paperOrder({ orderId: "E8O-2", filledAt: "2026-11-24T17:01:00.000Z" })],
    journal: [],
  });
  assert.equal(body.execution.status, "AMBIGUOUS");
  assert.equal(body.execution.orders.length, 0);
  assert.deepEqual(body.execution.ambiguousCandidates.sort(), ["E8O-1", "E8O-2"]);
  assert.ok(body.flags.some((f) => f.flag === "AMBIGUOUS"));
});

test("ambiguous Journal: two trades on the same plan => AMBIGUOUS", () => {
  const body = life({
    orders: [],
    journal: [journalTrade({ tradeId: "T-1", orderId: "X1" }), journalTrade({ tradeId: "T-2", orderId: "X2" })],
  });
  assert.equal(body.journal.status, "AMBIGUOUS");
  assert.equal(body.outcome.trade, null);
});

test("candidate mismatch on a plan-tier hit => IDENTITY_CONFLICT, not linked", () => {
  const body = life({ orders: [paperOrder({ orderId: "E8O-A", cand: "E26C-OTHER" })], journal: [] });
  assert.equal(body.execution.status, "IDENTITY_CONFLICT");
  assert.equal(body.execution.conflicts[0].mismatches[0].field, "candidateId");
});

test("plan mismatch on an order-tier hit => IDENTITY_CONFLICT", () => {
  const replay = lifecycleReplay({ e8Overrides: { orderId: "E8O-A", orderCreated: true } });
  const body = life({ replay, orders: [paperOrder({ orderId: "E8O-A", planId: "E9P-OTHER" })], journal: [] });
  assert.equal(body.execution.status, "IDENTITY_CONFLICT");
  assert.equal(body.execution.matchTier, "orderId");
});

test("strategy mismatch => excluded, NO_MATCH", () => {
  const body = life({ orders: [paperOrder({ orderId: "E8O-A", strategyId: "minor_swing@1h" })], journal: [] });
  assert.equal(body.execution.status, "NO_MATCH");
  assert.deepEqual(body.execution.excluded, [{ reason: "STRATEGY_MISMATCH", count: 1 }]);
});

test("PAPER/REAL isolation: REAL/LIVE trades never link and are reported as counts only", () => {
  const body = life({
    orders: [],
    journal: [
      journalTrade({ tradeId: "T-REAL", orderId: "R1", accountMode: "REAL", extra: { brokerAccountLabel: "SCHWAB_6380" } }),
      journalTrade({ tradeId: "T-LIVE", orderId: "R2", accountMode: "LIVE" }),
    ],
  });
  assert.equal(body.journal.status, "NO_MATCH");
  assert.deepEqual(body.journal.excluded, [{ reason: "MODE_MISMATCH", count: 2 }]);
  const s = JSON.stringify(body);
  assert.ok(!s.includes("T-REAL") && !s.includes("T-LIVE") && !s.includes("6380"));
});

test("Journal trade without accountMode is MODE_MISSING, not assumed PAPER", () => {
  const t = journalTrade({ tradeId: "T-NOMODE", orderId: "E8O-A" });
  delete t.accountMode;
  const body = life({ orders: [ORDER_A], journal: [t] });
  assert.equal(body.journal.status, "NO_MATCH");
  assert.deepEqual(body.journal.excluded, [{ reason: "MODE_MISSING", count: 1 }]);
});

test("Engine 8 order without paper:true is MODE_MISSING / NON_PAPER, never PAPER", () => {
  const o = paperOrder({ orderId: "E8O-A" });
  delete o.paper;
  const body = life({ orders: [o], journal: [] });
  assert.equal(body.execution.status, "NO_MATCH");
  assert.deepEqual(body.execution.excluded, [{ reason: "MODE_MISSING", count: 1 }]);
});

test("never joins by price or time alone", () => {
  const o = paperOrder({ orderId: "E8O-NOID", planId: null, cand: null, executionId: null });
  o.sourceSignal = {};
  const body = life({ orders: [o], journal: [] });
  assert.equal(body.execution.status, "NO_MATCH");
});

test("candidate tier only inside the window; outside window => NO_MATCH", () => {
  const replay = lifecycleReplay({ planId: "E9P-NOT-IN-STORE" });
  const inside = paperOrder({ orderId: "E8O-IN", planId: null, filledAt: "2026-11-24T17:10:00.000Z" });
  inside.sourceSignal.planId = undefined;
  const a = life({ replay, orders: [inside], journal: [] });
  assert.equal(a.execution.status, "MATCHED");
  assert.equal(a.execution.matchTier, "candidate");
  const outside = paperOrder({ orderId: "E8O-OUT", planId: null, filledAt: "2026-11-24T18:30:00.000Z" });
  outside.sourceSignal.planId = undefined;
  const b = life({ replay, orders: [outside], journal: [] });
  assert.equal(b.execution.status, "NO_MATCH");
});

test("Nov 24 10:16: no order created in that evaluation; later unrelated orders do not link", () => {
  const unrelated = paperOrder({ orderId: "E8O-LATER", planId: "E9P-UNRELATED", cand: "E26C-UNRELATED", filledAt: "2026-11-24T17:40:00.000Z" });
  const sc = nov24Scenario({ orders: [unrelated] });
  const body = buildInvestigation({ query: query({ time: "1016" }), config: sc.config }).body;
  assert.equal(body.execution.status, "NO_MATCH");
  assert.equal(body.knownAtDecision.executionAtDecision.orderCreated.value, false);
  assert.match(body.knownAtDecision.executionAtDecision.note, /not that no earlier or later order exists/);
});

test("DUPLICATE_ORDER_BLOCKED is flagged as not proving a prior order", () => {
  const r = nov24_1016();
  r.strategies[S1].engine8PaperOrder.blockers = ["DUPLICATE_ORDER_BLOCKED"];
  const sc = makeScenario({ replays: { "2026-11-24/1016": r }, orders: [], journal: [] });
  const body = buildInvestigation({ query: query({ time: "1016" }), config: sc.config }).body;
  const f = body.flags.find((x) => x.flag === "DUPLICATE_BLOCK_RECORDED");
  assert.ok(f);
  assert.match(f.detail.note, /does not prove a prior order existed/);
  assert.equal(f.detail.priorSameIdentityOrdersFound, "UNKNOWN");
});
