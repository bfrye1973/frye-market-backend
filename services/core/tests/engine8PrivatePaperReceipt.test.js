import test from "node:test";
import assert from "node:assert/strict";
import {buildPrivatePaperReceipt as receipt,publicPaperReceipt} from "../logic/trading/engine8PrivatePaperReceipt.js";
const t="2026-11-27T15:00:00Z";
test("unknown is never converted into false or a fabricated fill",()=>{const x=receipt({cycleTime:t},t);assert.equal(x.orderCreated,null);assert.equal(x.filledQuantity,null);assert.equal(x.engine6Permission,null);});
test("receipt is deterministic for same facts and timestamp",()=>{assert.equal(receipt({cycleTime:t},t).receiptHash,receipt({cycleTime:t},t).receiptHash);assert.notEqual(receipt({cycleTime:t,orderCreated:true},t).receiptHash,receipt({cycleTime:t,orderCreated:false},t).receiptHash);});
test("exact blocker preserved on skipped candidate",()=>{const x=receipt({cycleTime:t,engine6Permission:true,engine8Executable:false,executorInvoked:false,orderCreated:false,blockers:["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"]},t);assert.deepEqual(x.blockers,["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"]);assert.equal(x.fillStatus,null);});
test("public log excludes IDs and fill price",()=>{const x=publicPaperReceipt(receipt({cycleTime:t,orderId:"PRIVATE-ORDER",candidateId:"PRIVATE-CAND",planId:"PRIVATE-PLAN",tradeId:"PRIVATE-TRADE",executionId:"PRIVATE-EXEC",fillPrice:6000,fillStatus:"FILLED",rejectReason:"invalid free text"},t));assert.doesNotMatch(JSON.stringify(x),/PRIVATE|6000|invalid free text/);assert.equal(x.fillStatus,"FILLED");});
test("receipt is reported outcome, not independent certification",()=>assert.equal(receipt({orderCreated:true,fillStatus:"FILLED"},t).evidenceKind,"REPORTED_CYCLE_OUTCOME_NOT_INDEPENDENT_VERIFICATION"));
