import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
test("Minute W2 triangle hypothesis does not rewrite canonical or historical wave state",()=>{
 const data=buildCurrentWavelength({symbol:"ES",currentPrice:7770,microBars5m:[]});
 const minute=data.degrees.minute;
 const view=minute.ownerMinuteW2Hypothesis;
 assert.equal(view.version,"engine22.minuteW2ComplexCorrectionWatch.v1");
 assert.equal(view.activeWave,"W2");
 assert.equal(view.stage,"COMPLEX_CORRECTION_CANDIDATE");
 assert.equal(view.confirmationStatus,"OWNER_HYPOTHESIS_UNCONFIRMED");
 assert.equal(view.internalPattern.type,"CONTRACTING_TRIANGLE_CANDIDATE");
 assert.equal(view.internalPattern.placement,"INTERNAL_B_OR_X_COMPONENT_UNRESOLVED");
 assert.equal(view.internalPattern.D,"DEVELOPING_WATCH");
 assert.equal(view.internalPattern.E,"ANTICIPATED_NOT_STARTED");
 assert.equal(view.internalPattern.completionConfirmed,false);
 assert.equal(view.activeInternalLeg,"D");
 assert.equal(view.activeInternalLegStage,"DEVELOPING_CANDIDATE");
 assert.deepEqual(view.priorPivotB,{price:7897.5,source:"OWNER_CONFIRMED_20261021"});
 assert.equal(view.priorPivotC.price,7676.5);
 assert.equal(view.priorPivotC.localTime,"2026-10-16 11:00");
 assert.deepEqual(view.internalDProjection.levels.map(x=>x.price),[
  7761,7787,7813,7850.25,7872.25,
 ]);
 assert.ok(view.internalDProjection.levels.every(x=>x.status==="WATCH"));
 assert.equal(view.childDegreeContext.subminute.currentWorkingStructure,"ABC_UP_INSIDE_MINUTE_D");
 assert.equal(view.childDegreeContext.subminute.A,"DEVELOPING_CANDIDATE");
 assert.equal(view.childDegreeContext.subminute.B,"PENDING");
 assert.equal(view.childDegreeContext.subminute.C,"PENDING");
 assert.equal(view.minuteW3Started,false);
 assert.deepEqual(Object.keys(view.childDegreeContext).sort(),["micro","submicro","subminute"]);
 for(const degree of ["micro","subminute","submicro"]){
  assert.equal(view.childDegreeContext[degree].relationship,"INSIDE_MINUTE_W2_CANDIDATE");
  assert.equal(view.childDegreeContext[degree].historicalCountPreserved,true);
  assert.equal(view.childDegreeContext[degree].noReset,true);
  assert.equal(view.childDegreeContext[degree].waveRecount,"PENDING");
 }
 assert.equal(view.noExecution,true);
 assert.equal(view.noPermissionCreated,true);
 assert.equal(minute.activeWave,"W3"); // legacy model preserved; not promoted
 assert.equal(data.degrees.subminute.activeWave,"W3");
 assert.equal(data.degrees.submicro.ownerSubmicroW2.anchors.w1High,7800);
});
