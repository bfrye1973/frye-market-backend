import test from "node:test";import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
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
