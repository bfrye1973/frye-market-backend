import test from "node:test";import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
test("Subminute owner D-UP developing proposal preserves old C and Minute W2",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 const d=cw.degrees.subminute.ownerCurrentDUp;
 assert.equal(d.version,"engine22.subminuteDUpOwnerWorking.v1");
 assert.equal(d.activeWave,"D");assert.equal(d.direction,"UP");
 assert.equal(d.stage,"DEVELOPING_CANDIDATE");
 assert.equal(d.proposedPriorC.endingPrice,7648.5);
 assert.equal(d.proposedPriorC.endingLocalTime,"2026-10-23 07:00");
 assert.equal(d.proposedPriorC.confirmationStatus,"OWNER_WORKING_ENDING_NOT_STRUCTURALLY_VERIFIED");
 assert.deepEqual(d.levels,[]);
 assert.equal(cw.degrees.subminute.ownerCurrentCDown.activeWave,"C");
 assert.equal(cw.degrees.subminute.ownerCurrentCDown.direction,"DOWN");
 assert.equal(cw.degrees.minute.ownerMinuteW2Retracement.activeWave,"W2");
 assert.equal(cw.degrees.minute.ownerMinuteW2Retracement.nextWaveStarted,false);
 assert.equal(d.noExecution,true);assert.equal(d.noPermissionCreated,true);
});
test("Submicro and Micro existing C-down owner models stay unchanged",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 assert.equal(cw.degrees.submicro.ownerSubmicroCDown.version,"engine22.submicroCDownOwnerWatch.v1");
 assert.equal(cw.degrees.submicro.ownerSubmicroCDown.stage,"DEVELOPING_CANDIDATE");
 assert.equal(cw.degrees.micro.ownerMicroCDown.version,"engine22.microCDownOwnerWatch.v1");
 assert.equal(cw.degrees.micro.ownerMicroCDown.stage,"DEVELOPING_CANDIDATE");
});

test("D-up Fibonacci retracements use owner B and C anchors; old C projection remains unchanged",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 assert.deepEqual(cw.degrees.subminute.ownerCurrentDUp.levels.map(x=>x.price),
   [7707.25,7743.5,7773,7802.5,7844.25,7869,7897.5]);
 assert.equal(cw.degrees.subminute.ownerCurrentDUp.projectionMethod,
   "C_LOW_PLUS_B_TO_C_RANGE_TIMES_RETRACEMENT_RATIO");
 assert.deepEqual(cw.degrees.minute.ownerLargerCDownScenario.levels.map(x=>x.price),
   [7771.5,7732.5,7693.5,7638,7567.5,7477.75,7363.5,7237.5]);
 assert.ok(cw.degrees.subminute.ownerCurrentDUp.levels.every(x=>x.status==="WATCH"));
});
test("D-up touch marks from snapshot are provisional and do not overwrite old C levels",()=>{
 const base=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 const updated=applyOwnerPriceTouchesV1({currentWavelength:base,currentPrice:7760,
   evaluationTimeMs:Date.parse("2026-10-27T16:00:00Z")});
 const d=updated.degrees.subminute.ownerCurrentDUp;
 assert.deepEqual(d.levels.map(x=>x.status),
   ["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH","WATCH"]);
 assert.equal(d.levels[0].touchEvidence.verified,false);
 assert.equal(d.levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
 assert.equal(updated.degrees.subminute.ownerCurrentCDown.activeWave,"C");
 assert.equal(updated.degrees.minute.ownerMinuteW2Retracement.activeWave,"W2");
 assert.ok(base.degrees.subminute.ownerCurrentDUp.levels.every(x=>x.status==="WATCH"));
});
test("D-up touched levels persist with previous count state after price retraces",()=>{
 const first=buildCurrentWavelength({symbol:"ES",currentPrice:7804,microBars5m:[]});
 const touched=applyOwnerPriceTouchesV1({currentWavelength:first,currentPrice:7804,
  evaluationTimeMs:Date.parse("2026-10-27T16:00:00Z")});
 const next=buildCurrentWavelength({symbol:"ES",currentPrice:7710,microBars5m:[]});
 const retained=applyOwnerPriceTouchesV1({currentWavelength:next,previousWavelength:touched,
   currentPrice:7710,evaluationTimeMs:Date.parse("2026-10-27T16:10:00Z")});
 assert.equal(retained.degrees.subminute.ownerCurrentDUp.levels[3].status,"TOUCHED");
 assert.equal(retained.degrees.subminute.ownerCurrentDUp.levels[3].touchEvidenceAvailable,true);
});
test("D-up touches before owner-nominated C low time are not fabricated",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7900,microBars5m:[]});
 const old=applyOwnerPriceTouchesV1({currentWavelength:cw,currentPrice:7900,
  evaluationTimeMs:Date.parse("2026-10-22T12:00:00Z")});
 assert.ok(old.degrees.subminute.ownerCurrentDUp.levels.every(x=>x.status==="WATCH"));
});
