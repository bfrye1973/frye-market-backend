import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
test("Subminute C DOWN references the current larger scenario without replacing W2 history",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7672.5,microBars5m:[]});
 const ref=cw.degrees.subminute.ownerCurrentCDown;
 assert.equal(ref.version,"engine22.subminuteCurrentCDownReference.v1");
 assert.equal(ref.activeWave,"C");
 assert.equal(ref.direction,"DOWN");
 assert.equal(ref.parentWave,"W2");
 assert.equal(ref.modelStatus,"DEGREE_PLACEMENT_PROVISIONAL");
 assert.equal(ref.confirmationStatus,"NOT_STRUCTURALLY_CONFIRMED");
 assert.equal(cw.degrees.subminute.activeWave,"W3");
 assert.equal(cw.degrees.minute.ownerMinuteW2Hypothesis.activeWave,"W2");
 assert.equal(cw.degrees.minute.ownerMinuteW2Hypothesis.internalDProjection.completionConfirmed,false);
 assert.deepEqual(cw.degrees.minute.ownerLargerCDownScenario.levels.map(x=>x.price),
  [7771.5,7732.5,7693.5,7638,7567.5,7477.75,7363.5,7237.5]);
 const after=applyOwnerPriceTouchesV1({currentWavelength:cw,currentPrice:7672.5,evaluationTimeMs:Date.parse("2026-10-24T22:10:00Z")});
 assert.deepEqual(after.degrees.minute.ownerLargerCDownScenario.levels.slice(0,3).map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED"]);
 assert.equal(after.degrees.subminute.ownerCurrentCDown.noExecution,true);
});
