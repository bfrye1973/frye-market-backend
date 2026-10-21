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
 assert.equal(view.minuteW3Started,false);
 assert.equal(view.noExecution,true);
 assert.equal(view.noPermissionCreated,true);
 assert.equal(minute.activeWave,"W3"); // legacy model preserved; not promoted
 assert.equal(data.degrees.subminute.activeWave,"W3");
 assert.equal(data.degrees.submicro.ownerSubmicroW2.anchors.w1High,7800);
});
