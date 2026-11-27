import test from "node:test";
import assert from "node:assert/strict";
import {projectObservedPaperCoverage as project} from "../logic/trading/engine8PaperCoverage.js";
import {buildPrivatePaperReceipt as receipt} from "../logic/trading/engine8PrivatePaperReceipt.js";
const date="2026-11-27",now="2026-11-28T08:00:00Z",t="2026-11-27T15:00:00Z";
const r=receipt({mode:"PAPER",cycleId:"CYCLE1",strategyId:"S1",cycleTime:t},t);
test("valid observations alone never prove whole day coverage",()=>{const x=project({date,now,receipts:[r]});assert.equal(x.observedCycles,1);assert.equal(x.status,"INCOMPLETE");assert.equal(x.watermarkThrough,null);});
test("missing receipts cannot imply zero activity",()=>{const x=project({date,now});assert.equal(x.status,"INCOMPLETE");assert.ok(x.errors.includes("RECEIPTS_UNAVAILABLE"));});
test("duplicate and corrupt receipts flagged",()=>{const x=project({date,now,receipts:[r,r,{...r,orderCreated:true}]});assert.equal(x.observedCycles,1);assert.equal(x.duplicates.length,1);assert.ok(x.errors.includes("RECEIPT_HASH_OR_SCHEMA_MISMATCH"));});
test("wrong Arizona date or future cycle rejected",()=>{assert.equal(project({date:"2026-11-28",now,receipts:[r]}).observedCycles,0);assert.equal(project({date,now:"2026-11-27T14:00:00Z",receipts:[r]}).observedCycles,0);});

const runReceipt=(kind,runId="RUN1",extra={})=>receipt({mode:"PAPER",cycleKind:kind,schedulerRunId:runId,cycleId:runId+":"+kind,strategyId:"S1",cycleTime:t,reportedOutcome:"COMPLETED",...extra},t);
test("observed scheduler run requires start, end, entry and lifecycle summary",()=>{const rows=["SCHEDULER_START","SCHEDULER_END","ENTRY","LIFECYCLE"].map(k=>runReceipt(k));const a=project({date,now,receipts:rows});assert.equal(a.completedObservedRuns,1);assert.deepEqual(a.runGaps,[]);assert.equal(a.status,"INCOMPLETE");assert.equal(a.receiptSetHash,project({date,now,receipts:[...rows].reverse()}).receiptSetHash);});
test("missing entry and lifecycle are detected without assuming no trade",()=>{const a=project({date,now,receipts:[runReceipt("SCHEDULER_START"),runReceipt("SCHEDULER_END")]});assert.equal(a.completedObservedRuns,0);assert.deepEqual(a.runGaps[0].reasons,["MISSING_ENTRY_RECEIPT","MISSING_LIFECYCLE_SUMMARY"]);});
test("interrupted and concurrent runs remain distinct",()=>{const rows=[runReceipt("SCHEDULER_START"),...["SCHEDULER_START","SCHEDULER_END","ENTRY","LIFECYCLE"].map(k=>runReceipt(k,"RUN2"))];const a=project({date,now,receipts:rows});assert.equal(a.schedulerRunsObserved,2);assert.equal(a.completedObservedRuns,1);assert.ok(a.runGaps[0].reasons.includes("MISSING_SCHEDULER_END"));});
test("lifecycle action is not a duplicate lifecycle summary",()=>{const rows=["SCHEDULER_START","SCHEDULER_END","ENTRY","LIFECYCLE"].map(k=>runReceipt(k));rows.push(runReceipt("LIFECYCLE","RUN1",{cycleId:"ACTION1",reportedAction:"EXIT"}));assert.equal(project({date,now,receipts:rows}).completedObservedRuns,1);});
test("unknown entry result prevents completed observation",()=>{const rows=["SCHEDULER_START","SCHEDULER_END","LIFECYCLE"].map(k=>runReceipt(k));rows.push(runReceipt("ENTRY","RUN1",{reportedOutcome:"UNKNOWN"}));assert.ok(project({date,now,receipts:rows}).runGaps[0].reasons.includes("OUTCOME_UNKNOWN"));});

test("#412: a SCHEDULER_SKIPPED slot is counted separately, never as a completed run or a run gap", async () => {
  const { buildPrivatePaperReceipt } = await import("../logic/trading/engine8PrivatePaperReceipt.js");
  const { projectObservedPaperCoverage } = await import("../logic/trading/engine8PaperCoverage.js");
  const skip = buildPrivatePaperReceipt({ mode: "PAPER", cycleKind: "SCHEDULER_SKIPPED", schedulerRunId: "skip-1", cycleId: "skip-1:SCHEDULER_SKIPPED", cycleTime: "2026-11-27T16:00:00.000Z", strategyId: "intraday_scalp@10m", reportedOutcome: "SKIPPED" }, "2026-11-27T16:00:01.000Z");
  assert.equal(skip.cycleKind, "SCHEDULER_SKIPPED");
  const c = projectObservedPaperCoverage({ date: "2026-11-27", receipts: [skip], now: "2026-11-27T17:00:00.000Z" });
  assert.equal(c.skippedSlotsObserved, 1);
  assert.equal(c.completedObservedRuns, 0);
  assert.equal(c.schedulerRunsObserved, 0);
  assert.deepEqual(c.runGaps, []);
  assert.equal(c.status, "INCOMPLETE");
});
