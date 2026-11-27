import test from "node:test";
import assert from "node:assert/strict";
import {buildDailyPaperVerification,buildLatestApprovedCandidateVerification,validateTrustedArizonaCoverage} from "../logic/investigator/engine12DailyPaperVerification.js";

const date="2026-11-27",fillTime="2026-11-27T15:10:00.000Z";
function evidence({orders=[],executions=[],journal=[],ledger={},stability="NO_CHANGE_OBSERVED"}={}){
 return {readAt:"2026-11-27T16:00:00.000Z",finishedAt:"2026-11-27T16:00:00.010Z",stability,
  stores:{orders:{status:"OK"},executions:{status:"OK"},journal:{status:"OK"},ledger:{status:"OK"}},
  values:{orders,executions,journal,ledger,lifecycle:{},acceptance:{}}};
}
function order(o={}){return {paper:true,orderId:"O1",strategyId:"intraday_scalp@10m",action:"NEW_ENTRY",idempotencyKey:"I1",status:"FILLED",filledQty:3,avgPrice:6000,filledAt:fillTime,symbol:"ES",side:"BUY",sourceSignal:{candidateId:"C1",planId:"P1",executionId:"X1"},...o};}
function exec(o={}){return {orderId:"O1",strategyId:"intraday_scalp@10m",action:"NEW_ENTRY",idempotencyKey:"I1",status:"FILLED",filledQty:3,avgPrice:6000,ts:fillTime,symbol:"ES",side:"BUY",sourceSignal:{candidateId:"C1",planId:"P1",executionId:"X1"},...o};}
function trade(o={}){return {tradeId:"T1",accountMode:"PAPER",strategyId:"intraday_scalp@10m",status:"OPEN",identity:{candidateId:"C1",planId:"P1",orderId:"O1",openingExecutionId:"X1",idempotencyKey:"I1"},orderLink:{orderId:"O1",executionId:"X1",idempotencyKey:"I1"},entry:{time:fillTime,price:6000,qty:3},qty:{originalQty:3,remainingQty:3},events:[],...o};}
function coverage(o={}){return {schemaVersion:"engine8.paperVerificationCoverage.v1",timezone:"America/Phoenix",date,intervalStart:"2026-11-27T00:00:00-07:00",intervalEnd:"2026-11-28T00:00:00-07:00",watermarkThrough:"2026-11-28T00:00:00-07:00",status:"COMPLETE",expectedCycles:100,observedCycles:100,gaps:[],duplicates:[],errors:[],stores:{orders:"COVERED",executions:"COVERED",lifecycle:"COVERED",ledger:"COVERED",journal:"COVERED"},originalApprovalEvidence:"COVERED",...o};}

test("verified fill => YES; no fill without trusted coverage => UNKNOWN; trusted empty => NO",()=>{
 assert.equal(buildDailyPaperVerification({date,evidence:evidence({orders:[order()],executions:[exec()],journal:[trade()]})}).verdict,"YES");
 assert.equal(buildDailyPaperVerification({date,evidence:evidence()}).verdict,"UNKNOWN");
 assert.equal(buildDailyPaperVerification({date,evidence:evidence(),coverageAttestation:coverage()}).verdict,"NO");
});
test("coverage gap prevents NO",()=>assert.equal(validateTrustedArizonaCoverage(coverage({gaps:["x"]}),date).trusted,false));
test("REAL execution cannot certify PAPER fill",()=>{
 const d=buildDailyPaperVerification({date,evidence:evidence({orders:[order()],executions:[exec({accountMode:"LIVE"})]})});
 assert.equal(d.counts.verifiedFills,0);assert.ok(d.issues.includes("PAPER_MODE_CONFLICT"));
});
test("top-level/nested identity contradiction fails closed",()=>{
 const d=buildDailyPaperVerification({date,evidence:evidence({orders:[order({candidateId:"C2"})],executions:[exec()]})});
 assert.equal(d.counts.verifiedFills,0);assert.ok(d.issues.includes("CANDIDATEID_CONFLICT"));
});
test("Journal match requires complete opening identity",()=>{
 const bad=trade({identity:{candidateId:"C1",planId:"P1",orderId:"O1"},orderLink:{orderId:"O1",idempotencyKey:"I1"}});
 const d=buildDailyPaperVerification({date,evidence:evidence({orders:[order()],executions:[exec()],journal:[bad]})});
 assert.equal(d.verdict,"YES");assert.equal(d.fills[0].journal.status,"UNKNOWN");
});
test("exit matches exit event identity, not opening identity",()=>{
 const t="2026-11-27T16:00:00.000Z";
 const o=order({orderId:"O2",action:"EXIT",idempotencyKey:"I2",filledQty:2,avgPrice:6010,filledAt:t,sourceSignal:{candidateId:"C1",planId:"P1",executionId:"X2"}});
 const e=exec({orderId:"O2",action:"EXIT",idempotencyKey:"I2",filledQty:2,avgPrice:6010,ts:t,sourceSignal:{candidateId:"C1",planId:"P1",executionId:"X2"}});
 const j=trade({status:"CLOSED",qty:{originalQty:3,remainingQty:0},events:[{orderId:"O2",executionId:"X2",idempotencyKey:"I2",action:"EXIT",source:"engine8_execution",tradeId:"T1",qtyClosed:2,fillQuantity:2,price:6010,ts:t,remainingQty:0}]});
 const d=buildDailyPaperVerification({date,evidence:evidence({orders:[o],executions:[e],journal:[j],ledger:{I2:{paper:true,orderId:"O2",executionId:"X2",status:"filled",tradeId:"T1",journalStatus:"JOURNAL_COMPLETE",journal:{ok:true,tradeId:"T1"}}}})});
 assert.equal(d.verdict,"YES");assert.equal(d.fills[0].journal.status,"MATCHED");assert.equal(d.fills[0].journal.ackStatus,"JOURNAL_COMPLETE");
});
test("matched Journal record does not erase pending Engine8 ACK",()=>{
 const ledger={I1:{paper:true,orderId:"O1",executionId:"X1",status:"filled",tradeId:"T1",journalStatus:"JOURNAL_PENDING",journal:{tradeId:"T1"}}};
 const d=buildDailyPaperVerification({date,evidence:evidence({orders:[order()],executions:[exec()],journal:[trade()],ledger})});
 assert.equal(d.fills[0].journal.status,"MATCHED");assert.equal(d.fills[0].journal.ackStatus,"PENDING_JOURNAL_ACK");assert.equal(d.counts.pendingJournalAck,1);
});
test("latest approved candidate remains visible even without fill",()=>{
 const daily=buildDailyPaperVerification({date,evidence:evidence()});
 const attempts={date,latestObservedApprovedCandidate:{strategyId:"intraday_scalp@10m",candidateId:"C1",planId:"P1",firstObservedApprovalTime:"2026-11-27T15:00:00Z",lastObservedCycleTime:"2026-11-27T15:01:00Z",attemptCount:1,outcome:"APPROVAL_REPORTED_SKIPPED",latestReceipt:{skipReason:"PAPER_ACCEPTANCE_STATE_UNAVAILABLE",rejectReason:null,blockers:["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"],orderCreated:false,orderId:null,journalAckStatus:"UNKNOWN",approvalSnapshotTime:"2026-11-27T15:00:00Z",approvalSnapshotHash:"a".repeat(64),evidenceKind:"REPORTED_CYCLE_OUTCOME_NOT_INDEPENDENT_VERIFICATION"}}};
 const latest=buildLatestApprovedCandidateVerification({daily,attempts,approvalReplay:{status:"VERIFIED"}});
 assert.equal(latest.status,"APPROVAL_REPORTED_SKIPPED");assert.equal(latest.reported.skipReason,"PAPER_ACCEPTANCE_STATE_UNAVAILABLE");assert.equal(latest.independent.fill,null);assert.equal(latest.independent.approvalReplay.status,"VERIFIED");
});
test("latest candidate correlates independently verified fill separately",()=>{
 const daily=buildDailyPaperVerification({date,evidence:evidence({orders:[order()],executions:[exec()],journal:[trade()]})});
 const attempts={date,latestObservedApprovedCandidate:{strategyId:"intraday_scalp@10m",candidateId:"C1",planId:"P1",firstObservedApprovalTime:fillTime,lastObservedCycleTime:fillTime,attemptCount:1,outcome:"ORDER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",latestReceipt:{orderCreated:true,orderId:"O1",approvalSnapshotTime:fillTime,approvalSnapshotHash:"a".repeat(64),evidenceKind:"REPORTED_CYCLE_OUTCOME_NOT_INDEPENDENT_VERIFICATION"}}};
 const latest=buildLatestApprovedCandidateVerification({daily,attempts,approvalReplay:{status:"VERIFIED"}});
 assert.match(latest.status,/FILLED_/);assert.equal(latest.independent.fill.orderId,"O1");
});
