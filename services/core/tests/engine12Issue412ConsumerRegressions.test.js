// Engine 12 #412 consumer regressions (comment 7223782428) + per-approval answers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDailyPaperVerification, buildLatestApprovedCandidateVerification, buildPerApprovalVerification, independentlyMatchedFills } from "../logic/investigator/engine12DailyPaperVerification.js";
import { summarizeObservedReplayDay } from "../logic/investigator/engine12ObservedReplayDay.js";

const date = "2026-11-27";
const t1 = "2026-11-27T15:10:00.000Z", t2 = "2026-11-27T15:40:00.000Z";
const H = { orders: "1".repeat(64), executions: "2".repeat(64), journal: "3".repeat(64), ledger: "4".repeat(64) };
function evidence({ orders = [], executions = [], journal = [], ledger = {} } = {}) {
  return { readAt: "2026-11-27T16:00:00.000Z", finishedAt: "2026-11-27T16:00:00.010Z", stability: "NO_CHANGE_OBSERVED",
    stores: { orders: { status: "OK", sha256: H.orders }, executions: { status: "OK", sha256: H.executions }, journal: { status: "OK", sha256: H.journal }, ledger: { status: "OK", sha256: H.ledger } },
    values: { orders, executions, journal, ledger, lifecycle: {}, acceptance: {} } };
}
const sig = { candidateId: "C1", planId: "P1" };
const openO = { paper: true, orderId: "O1", strategyId: "intraday_scalp@10m", action: "NEW_ENTRY", idempotencyKey: "I1", status: "FILLED", filledQty: 3, avgPrice: 6000, filledAt: t1, symbol: "ES", side: "SELL", sourceSignal: { ...sig, executionId: "X1" } };
const openE = { orderId: "O1", strategyId: "intraday_scalp@10m", action: "NEW_ENTRY", idempotencyKey: "I1", status: "FILLED", filledQty: 3, avgPrice: 6000, ts: t1, symbol: "ES", side: "SELL", sourceSignal: { ...sig, executionId: "X1" } };
const exitO = { ...openO, orderId: "O2", action: "EXIT", idempotencyKey: "I2", avgPrice: 5990, filledAt: t2, side: "BUY", sourceSignal: { ...sig, executionId: "X2" } };
const exitE = { ...openE, orderId: "O2", action: "EXIT", idempotencyKey: "I2", avgPrice: 5990, ts: t2, side: "BUY", sourceSignal: { ...sig, executionId: "X2" } };
const tradeRow = { tradeId: "T1", accountMode: "PAPER", strategyId: "intraday_scalp@10m", status: "CLOSED",
  identity: { ...sig, orderId: "O1", openingExecutionId: "X1", idempotencyKey: "I1" }, orderLink: { orderId: "O1", executionId: "X1", idempotencyKey: "I1" },
  entry: { time: t1, price: 6000, qty: 3 }, qty: { originalQty: 3, remainingQty: 0 },
  events: [{ action: "EXIT", source: "engine8_execution", tradeId: "T1", orderId: "O2", executionId: "X2", idempotencyKey: "I2", qtyClosed: 3, price: 5990, ts: t2, remainingQty: 0 }] };
const candidate = (o = {}) => ({ strategyId: "intraday_scalp@10m", ...sig, firstObservedApprovalTime: "2026-11-27T15:00:00.000Z", lastObservedCycleTime: "2026-11-27T15:09:00.000Z", attemptCount: 3, outcome: "ORDER_REPORTED", latestReceipt: { orderCreated: true, orderId: "O1" }, ...o });

test("#2: a valid opening is still matched after a later EXIT for the same candidate/plan", () => {
  const daily = buildDailyPaperVerification({ date, evidence: evidence({ orders: [openO, exitO], executions: [openE, exitE], journal: [tradeRow] }) });
  assert.equal(daily.verdict, "YES");
  assert.equal(daily.fills.length, 2);
  const m = independentlyMatchedFills(daily, candidate(), "O1");
  assert.equal(m.opening?.orderId, "O1");
  assert.deepEqual(m.lifecycle.map((f) => f.action), ["EXIT"]);
  const latest = buildLatestApprovedCandidateVerification({ daily, attempts: { latestObservedApprovedCandidate: candidate() } });
  assert.notEqual(latest.independent.fill, null, "opening must not be lost because of the exit");
  assert.equal(latest.independent.lifecycleFills.length, 1);
  assert.match(latest.status, /^FILLED_/);
});

test("#2: two openings for one candidate are ambiguous, never silently picked", () => {
  const o2 = { ...openO, orderId: "O3", idempotencyKey: "I3", sourceSignal: { ...sig, executionId: "X3" } };
  const e2 = { ...openE, orderId: "O3", idempotencyKey: "I3", sourceSignal: { ...sig, executionId: "X3" } };
  const daily = buildDailyPaperVerification({ date, evidence: evidence({ orders: [openO, o2], executions: [openE, e2] }) });
  const m = independentlyMatchedFills(daily, candidate({ latestReceipt: {} }));
  assert.equal(m.opening, null);
  assert.equal(m.openingIssue, "MULTIPLE_OPENING_FILLS");
});

test("per-approval: YES only with an independent opening fill; skipped approval stays UNKNOWN with its reported blocker", () => {
  const daily = buildDailyPaperVerification({ date, evidence: evidence({ orders: [openO], executions: [openE], journal: [] }) });
  const per = buildPerApprovalVerification({ daily, attempts: { candidates: [
    candidate(),
    candidate({ candidateId: "C2", planId: "P2", latestReceipt: { skipReason: "PAPER_ACCEPTANCE_STATE_UNAVAILABLE", blockers: ["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"], orderCreated: false } }),
  ] } });
  assert.equal(per.length, 2);
  assert.equal(per[0].verdict, "YES");
  assert.equal(per[0].independentOpeningFill.orderId, "O1");
  assert.equal(per[1].verdict, "UNKNOWN");
  assert.equal(per[1].status, "APPROVAL_REPORTED_SKIPPED");
  assert.equal(per[1].firstBlocker, "PAPER_ACCEPTANCE_STATE_UNAVAILABLE");
  assert.equal(per[1].firstBlockerSource, "ENGINE8_REPORTED_RECEIPT");
  assert.deepEqual(buildPerApprovalVerification({ daily, attempts: {} }), []);
});

// ---------- #1: observed Replay chronology ----------

function replaySnapshot({ time, allowed, executable, ffe, rootCause, blockers = [] }) {
  return {
    schema: "es.replay.slim", immutable: true, symbol: "ES", dateYmd: date, timezone: "America/Phoenix",
    snapshotTime: time, generatedAtUtc: time,
    strategies: { "intraday_scalp@10m": {
      strategyId: "intraday_scalp@10m",
      permission: { paper: { allowed, snapshotTime: time } },
      engine8PaperOrder: { status: executable ? "READY_TO_CREATE_PAPER_ORDER" : "NOT_EXECUTABLE", executable, blockers, snapshotTime: time },
      engine28APipelineDoctor: { contractVersion: "engine28a.pipelineDoctor.v1", strategyId: "intraday_scalp@10m", pipelineStatus: "WAITING", firstFailingEngine: ffe, failureType: "WAITING_FOR_MARKET", rootCause, snapshotTime: time, generatedAt: time, stages: [] },
    } },
  };
}

test("#1: Nov 27 06:45–07:30 AZ style day: NO_APPROVAL_OBSERVED, E3=7 / E4=8, fill verdict stays UNKNOWN", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e12-replay-"));
  try {
    fs.mkdirSync(path.join(root, date));
    for (let i = 0; i < 15; i++) {
      const min = 45 + i * 3, hh = 6 + Math.floor(min / 60), mm = min % 60;
      const hhmm = String(hh).padStart(2, "0") + String(mm).padStart(2, "0");
      const time = new Date(Date.parse(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00-07:00`)).toISOString();
      const e3 = i < 7;
      fs.writeFileSync(path.join(root, date, hhmm + ".json"), JSON.stringify(replaySnapshot({ time, allowed: false, executable: false, ffe: e3 ? "engine3" : "engine4", rootCause: e3 ? "ENGINE3_STRUCTURE_NOT_QUALIFIED" : "ENGINE4_PARTICIPATION_NOT_CONFIRMED" })));
    }
    const s = summarizeObservedReplayDay({ root, date });
    assert.equal(s.snapshotsRead, 15);
    assert.equal(s.observedApprovals, 0);
    assert.equal(s.classification, "NO_APPROVAL_OBSERVED");
    assert.deepEqual(s.firstBlockerCounts, { engine3: 7, engine4: 8 });
    assert.equal(s.dailyFillVerdict, "UNKNOWN");
    assert.equal(s.coverage, "UNPROVEN");
    assert.equal(s.blockerAuthority, "INCLUDES_REGISTRY_UNVERIFIED_DATES");
    // The latest view shows the chronology instead of a bare UNKNOWN, and invents no receipt.
    const daily = buildDailyPaperVerification({ date, evidence: evidence() });
    const latest = buildLatestApprovedCandidateVerification({ daily, attempts: {}, observedReplay: s });
    assert.equal(latest.status, "UNKNOWN");
    assert.equal(latest.reported, null);
    assert.equal(latest.observedReplay.classification, "NO_APPROVAL_OBSERVED");
    assert.equal(daily.verdict, "UNKNOWN");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("#1: real Nov 24 Replay snapshot reads as approval observed, Engine 8 not executable, with the acceptance-state blocker", () => {
  const fx = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "services/core/tests/fixtures/tradeInvestigator/real-2026-11-24/2026-11-24_1016.fixture.json"), "utf8"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e12-replay24-"));
  try {
    fs.mkdirSync(path.join(root, "2026-11-24"));
    fs.writeFileSync(path.join(root, "2026-11-24", "1016.json"), JSON.stringify(fx.replay));
    const s = summarizeObservedReplayDay({ root, date: "2026-11-24" });
    assert.equal(s.snapshotsRead, 1);
    assert.equal(s.rows[0].status, "APPROVAL_OBSERVED_ENGINE8_NOT_EXECUTABLE");
    assert.ok(s.rows[0].engine8Blockers.includes("PAPER_ACCEPTANCE_STATE_UNAVAILABLE"));
    assert.equal(s.classification, "APPROVAL_OBSERVED");
    assert.equal(s.dailyFillVerdict, "UNKNOWN");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("#1: missing Replay day or root is reported, never treated as zero activity", () => {
  assert.equal(summarizeObservedReplayDay({ root: null, date }).reason, "REPLAY_ROOT_NOT_CONFIGURED");
  const s = summarizeObservedReplayDay({ root: os.tmpdir(), date: "1999-01-01" });
  assert.equal(s.reason, "REPLAY_DATE_NOT_FOUND");
  assert.equal(s.classification, "UNKNOWN");
});
