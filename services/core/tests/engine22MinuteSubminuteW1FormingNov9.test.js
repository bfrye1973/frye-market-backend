import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const wave=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7540.75,microBars5m:[]});
test("Owner Minute W1 high 7671 and W2 provisional retracements preserve proposed W1 start reference",()=>{
 const m=wave().degrees.minute.ownerMinuteW1FormingNov9Research;
 assert.equal(m.version,"engine22.minuteW1FormingNov9Research.v1");
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.equal(m.activeWave,"W2");
 assert.equal(m.direction,"DOWN");
 assert.equal(m.parentDegree,"minor");
 assert.equal(m.parentWave,"W3_OWNER_WORKING_RESEARCH");
 assert.equal(m.anchors.w1StartReference,7322.25);
 assert.equal(m.anchors.w1StartReferenceLocalTime,"2026-11-05 16:00 AZ");
 assert.equal(m.anchors.w1StartReferenceAtUtc,"2026-11-05T23:00:00Z");
 assert.equal(m.anchors.w1StartIndependentlyConfirmed,false);
 assert.equal(m.anchors.w1EndingHigh,7671);
 assert.equal(m.anchors.w1EndingHighLocalTime,"2026-11-11 08:00 AZ");
 assert.equal(m.anchors.w1EndingHighAtUtc,"2026-11-11T15:00:00Z");
 assert.equal(m.anchors.w1StartIndependentlyConfirmed,false);
 assert.equal(m.anchors.w2EndingLow,null);
 assert.equal(m.completionConfirmed,false);
 assert.deepEqual(m.levels.map(l=>[l.label,l.price]),[
  ["0.236",7588.75],["0.382",7537.75],["0.500",7496.75],
  ["0.618",7455.5],["0.786",7397],["1.000",7322.25]]);
 assert(m.levels.every(l=>l.provisional&&l.status==="WATCH"));
 assert.equal(m.noExecution,true);
});
test("Owner Subminute W1 forming points to Micro child W1–W5 and retains unresolved time mismatch",()=>{
 const m=wave().degrees.subminute.ownerSubminuteW1FormingNov9Research;
 assert.equal(m.version,"engine22.subminuteW1FormingNov9Research.v1");
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.equal(m.activeWave,"W1");
 assert.equal(m.direction,"UP");
 assert.equal(m.parentDegree,"minute");
 assert.equal(m.parentWave,"W1_FORMING_RESEARCH");
 assert.equal(m.childDegree,"micro");
 assert.equal(m.anchors.w1StartReference,7322.25);
 assert.equal(m.anchors.w1StartReferenceLocalTime,"2026-11-05 16:00 AZ");
 assert.equal(m.microVsParentStartTimeReviewPending,true);
 assert.equal(m.anchors.w1StartIndependentlyConfirmed,false);
 assert.equal(m.w1CompletionConfirmed,false);
 assert.deepEqual(m.levels,[]);
 assert.equal(m.noExecution,true);
});
test("Canonical counts, older A-B-C research and all five other degree packets untouched",()=>{
 const w=wave();
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
 assert.equal(ownerApprovedWorkingSelection.degrees.minute.key,"ownerMinuteW2Retracement");
 assert.equal(ownerApprovedWorkingSelection.degrees.subminute.key,"ownerSubminuteCDownOct31");
 assert.equal(w.degrees.minute.ownerMinuteAbcResearch.version,"engine22.minuteAbcDownNov5Research.v1");
 assert.equal(w.degrees.subminute.ownerSubminuteNov5AbcResearch.version,"engine22.subminuteNov5AbcResearch.v1");
 assert.equal(w.degrees.minor.ownerMinorW3Nov9Research.version,"engine22.minorW3Nov9Research.v1");
 assert.equal(w.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.version,"engine22.ownerMicroW3Nov9ReclassifiedResearch.v1");
 assert.equal(w.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.version,"engine22.ownerSubmicroW3Nov9InternalResearch.v1");
});
