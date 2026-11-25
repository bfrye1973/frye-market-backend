import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
import {readAuthorizedWorkingStructure} from "../logic/engine27/v2/readAuthorizedWorkingStructure.js";
const models={
 submicro:["ownerSubmicroW3Nov9InternalResearch","engine22.ownerSubmicroW3Nov9InternalResearch.v1","W2","DOWN","W2_DOWN_DEVELOPING_OWNER_RESEARCH","C"],
 micro:["ownerMicroAbcDownNov16Research","engine22.ownerMicroAbcDownNov16Research.v1","C","DOWN","C_DOWN_DEVELOPING_OWNER_RESEARCH","C"],
 subminute:["ownerSubminuteAbcDownNov16Research","engine22.ownerSubminuteAbcDownNov16Research.v1","C","DOWN","C_DOWN_DEVELOPING_OWNER_RESEARCH","W2"],
 minute:["ownerMinuteW1FormingNov9Research","engine22.minuteW1FormingNov9Research.v1","W2","DOWN","W2_DOWN_DEVELOPING_OWNER_RESEARCH","W3_OWNER_WORKING_RESEARCH"],
};
const degreeStates={
 minor:{degree:"minor",activeWave:"W3",direction:"UP",state:"ACTIVE"},
 intermediate:{degree:"intermediate",activeWave:"W3",direction:"UP",state:"ACTIVE"},
 primary:{degree:"primary",activeWave:"W5",direction:"UP",state:"ACTIVE"},
};
const current=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const publish=(model=current(7470))=>buildAuthorizedWorkingStructureV1({
 currentWavelength:model,degreeStates,publicationTime:"2026-11-16T19:30:00Z"
});
const snap=p=>({symbol:"ES",strategies:{"intraday_scalp@10m":{
 engine22WaveStrategy:{authorizedWorkingStructure:p}}}});
test("latest owner Nov16 wave selection publishes all seven and Engine27 strict reader accepts parent chain",()=>{
 const p=publish();
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,7);
 assert.equal(p.publicationRevision,7);
 assert.equal(p.status,"COMPLETE_WORKING_SELECTION");
 assert.equal(readAuthorizedWorkingStructure(snap(p)).available,true);
 for(const [degree,[key,version,wave,direction,stage,parentWave]] of Object.entries(models)){
  const m=p.degrees[degree];
  assert.equal(m.available,true,degree);
  assert.equal(m.selectionStatus,"OWNER_SELECTED_WORKING",degree);
  assert.equal(m.sourcePath,"currentWavelength.degrees."+degree+"."+key);
  assert.equal(m.modelVersion,version);
  assert.equal(m.activeWave,wave);
  assert.equal(m.direction,direction);
  assert.equal(m.stage,stage);
  assert.equal(m.parentWave,parentWave);
  assert(m.ownerApprovalReference?.startsWith("OWNER_"),degree);
  assert.equal(m.completionConfirmed,false);
  assert.equal(m.officialInvalidation,null);
 }
 assert.deepEqual(p.degrees.submicro.levels.map(l=>l.price),
  [7593.75,7574.25,7558.75,7543,7520.75,7492.25]);
 assert.deepEqual(p.degrees.micro.levels.map(l=>l.price),
  [7522.75,7493.25,7472.25,7445.25,7415.75,7367.75]);
 assert.deepEqual(p.degrees.subminute.levels.map(l=>l.price),
  [7515.25,7454.25,7410.75,7355.5,7294.5,7195.75]);
 assert.deepEqual(p.degrees.minute.levels.map(l=>l.price),
  [7588.75,7537.75,7496.75,7455.5,7397,7322.25]);
 assert.equal(p.noExecution,true);assert.equal(p.noPermissionCreated,true);
 assert.equal(p.noWaveTransition,true);assert.equal(p.publicationId,null);
});
test("malformed model and parent conflict fail closed, with no alternate auto-select or fallback",()=>{
 const data=current(7470);data.degrees.micro.ownerMicroAbcDownNov16Research.version="unauthorized";
 const p=publish(data);
 assert.equal(p.status,"PARTIAL_UNAVAILABLE");
 assert.equal(readAuthorizedWorkingStructure(snap(p)).available,false);
 const parentChanged=structuredClone(publish());
 parentChanged.degrees.micro.parentWave="W5";
 assert.equal(readAuthorizedWorkingStructure(snap(parentChanged)).reasonCode,"ENGINE22_AUTHORIZED_PARENT_CONFLICT");
});
test("price changes do not select/approve a different wave; observed Fib touches only change evidence",()=>{
 const a=publish(current(7470)),b=publish(current(7700));
 assert.equal(a.modelFingerprint,b.modelFingerprint);
 assert.equal(a.selectionApprovalReference,b.selectionApprovalReference);
 assert.equal(a.degrees.micro.activeWave,"C");
 assert.equal(b.degrees.micro.activeWave,"C");
});
