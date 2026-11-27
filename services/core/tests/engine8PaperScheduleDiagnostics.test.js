import test from "node:test";import assert from "node:assert/strict";
import {projectNominalPaperSchedule as project} from "../logic/trading/engine8PaperScheduleDiagnostics.js";
import {buildPrivatePaperReceipt as receipt} from "../logic/trading/engine8PrivatePaperReceipt.js";
const date="2026-11-27",now="2026-11-27T07:11:00Z";
const row=(t,id)=>receipt({mode:"PAPER",cycleKind:"SCHEDULER_START",schedulerRunId:id,cycleId:id+":START",strategyId:"S1",cycleTime:t},t);
test("only elapsed slots with grace are checked",()=>{const x=project({date,now,receipts:[]});assert.equal(x.elapsedSlots,3);assert.equal(x.missingSlots.length,3);assert.equal(x.coverage,"UNPROVEN");});
test("missing middle slot and extra run detected",()=>{const x=project({date,now,receipts:[row("2026-11-27T07:00:30Z","A"),row("2026-11-27T07:06:30Z","B"),row("2026-11-27T07:06:40Z","C")]});assert.equal(x.observedSlots,2);assert.deepEqual(x.missingSlots,["2026-11-27T07:03:00.000Z"]);assert.equal(x.multipleRunSlots.length,1);});
test("Arizona day has nominal 480 slots but elapsed day is not certified",()=>{const x=project({date,now:"2026-11-29T07:00:00Z",receipts:[]});assert.equal(x.elapsedSlots,480);assert.equal(x.status,"UNVERIFIED_SCHEDULE");});
