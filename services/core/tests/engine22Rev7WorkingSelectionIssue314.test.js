import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
import {readAuthorizedWorkingStructure} from "../logic/engine27/v2/readAuthorizedWorkingStructure.js";

const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7580,microBars5m:[]});
const degreeStates={minor:{degree:"minor",activeWave:"W3",direction:"UP",stage:"ACTIVE"},
  intermediate:{degree:"intermediate",activeWave:"W3",direction:"UP",stage:"ACTIVE"},
  primary:{degree:"primary",activeWave:"W5",direction:"UP",stage:"ACTIVE"}};
const packet=buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates,
  publicationTime:"2026-11-16T17:30:00Z"});
test("revision seven selects exact authorized working Micro W5 and Submicro W2 research source models",()=>{
  assert.equal(ownerApprovedWorkingSelection.selectionRevision,7);
  assert.equal(packet.publicationRevision,7);
  assert.equal(packet.status,"COMPLETE_WORKING_SELECTION");
  assert.equal(packet.degrees.micro.available,true);
  assert.equal(packet.degrees.submicro.available,true);
  assert.equal(packet.degrees.micro.activeWave,"W5");
  assert.equal(packet.degrees.micro.direction,"UP");
  assert.equal(packet.degrees.micro.stage,"W5_UP_DEVELOPING_OWNER_RESEARCH");
  assert.equal(packet.degrees.micro.modelVersion,"engine22.ownerMicroW3Nov9ReclassifiedResearch.v1");
  assert.equal(packet.degrees.micro.sourcePath,
    "currentWavelength.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch");
  assert.equal(packet.degrees.submicro.activeWave,"W2");
  assert.equal(packet.degrees.submicro.direction,"DOWN");
  assert.equal(packet.degrees.submicro.stage,"W2_DOWN_DEVELOPING_OWNER_RESEARCH");
  assert.equal(packet.degrees.submicro.modelVersion,"engine22.ownerSubmicroW3Nov9InternalResearch.v1");
  assert.equal(packet.degrees.submicro.sourcePath,
    "currentWavelength.degrees.submicro.ownerSubmicroW3Nov9InternalResearch");
  assert.deepEqual(packet.degrees.micro.levels.map(x=>x.price),
    [7581.75,7637.25,7676.75,7726.75,7782.25,7871.75]);
  assert.deepEqual(packet.degrees.submicro.levels.map(x=>x.price),
    [7593.75,7574.25,7558.75,7543,7520.75,7492.25]);
  assert.equal(packet.degrees.micro.completionConfirmed,false);
  assert.equal(packet.degrees.submicro.completionConfirmed,false);
  assert.equal(packet.noExecution,true);
  assert.equal(packet.noPermissionCreated,true);
  assert.equal(packet.noWaveTransition,true);
  assert.equal(packet.degrees.micro.officialInvalidation,null);
  assert.equal(packet.degrees.submicro.officialInvalidation,null);
});
test("without separately authorized parent revisions consumer fails closed rather than inventing approval",()=>{
 const snapshot={symbol:"ES",strategies:{"intraday_scalp@10m":{
   engine22WaveStrategy:{authorizedWorkingStructure:packet}}}};
 const result=readAuthorizedWorkingStructure(snapshot);
 assert.equal(result.available,false);
 assert.equal(result.reasonCode,"ENGINE22_AUTHORIZED_PARENT_CONFLICT");
 assert.equal(packet.degrees.micro.parentWave,"W1_FORMING_RESEARCH");
 assert.equal(packet.degrees.subminute.activeWave,"C");
 assert.equal(packet.degrees.submicro.parentWave,"W5_RESEARCH");
 assert.equal(packet.degrees.micro.activeWave,"W5");
});
test("mismatched revised model or an unapproved substitute cannot silently publish",()=>{
 const source=structuredClone(currentWavelength);
 source.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.version="unauthorized";
 const wrong=buildAuthorizedWorkingStructureV1({currentWavelength:source,degreeStates});
 assert.equal(wrong.degrees.submicro.available,false);
 assert.equal(wrong.status,"PARTIAL_UNAVAILABLE");
});
