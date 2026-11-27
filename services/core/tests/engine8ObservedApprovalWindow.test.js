import test from "node:test";
import assert from "node:assert/strict";
import {summarizeObservedApprovalWindow as summarize} from "../logic/trading/engine8ObservedApprovalWindow.js";
// Sanitized transcription of recorded findings in issue412 comment 7223551674.
// Minute labels only, not original snapshot bytes; no claims of complete coverage.
const chronology=[["0645","engine3"],["0648","engine3"],["0651","engine4"],["0654","engine4"],["0657","engine3"],["0700","engine3"],["0704","engine3"],["0706","engine4"],["0709","engine4"],["0712","engine4"],["0716","engine3"],["0718","engine3"],["0721","engine4"],["0725","engine4"],["0727","engine4"]];
const snapshots=chronology.map(([t,firstBlocker])=>({observedAt:"2026-11-27T"+t.slice(0,2)+":"+t.slice(2)+":00-07:00",strategyId:"intraday_scalp@10m",engine6Allowed:false,engine8Executable:false,orderCreated:false,firstBlocker,rootCause:firstBlocker==="engine3"?"ENGINE3_STRATEGY1_NOT_QUALIFIED":"ENGINE4_PARTICIPATION_NOT_CONFIRMED"}));
const window={start:"2026-11-27T06:45:00-07:00",end:"2026-11-27T07:30:00-07:00"};
test("Nov27 recorded chronology is upstream blocked, not Engine8 execution failure or daily NO",()=>{const x=summarize({...window,snapshots});assert.equal(x.observedCount,15);assert.equal(x.observedApprovals,0);assert.deepEqual(x.firstBlockerCounts,{engine3:7,engine4:8});assert.equal(x.classification,"NO_APPROVAL_OBSERVED");assert.equal(x.dailyFillVerdict,"UNKNOWN");});
test("approved blocked attempt differs from historical upstream case",()=>{const x=summarize({...window,snapshots:[{...snapshots[0],engine6Allowed:true,firstBlocker:"engine8",rootCause:"PAPER_ACCEPTANCE_STATE_UNAVAILABLE"}]});assert.equal(x.rows[0].status,"APPROVAL_OBSERVED_ENGINE8_NOT_EXECUTABLE");});
test("missing or duplicate snapshots cannot certify absence",()=>{assert.equal(summarize(window).classification,"UNKNOWN");assert.equal(summarize({...window,snapshots:[snapshots[0],snapshots[0]]}).classification,"UNKNOWN");});
