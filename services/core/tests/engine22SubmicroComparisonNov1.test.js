import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";

test("Submicro alternatives preserve independent Fib ladders and other degrees",()=>{
  const w=buildCurrentWavelength({symbol:"ES",currentPrice:7614});
  const c=w.degrees.submicro.submicroCompare;
  assert.equal(c.parentWave,"C");
  assert.equal(c.option1.waveCStatus,"DEVELOPING_COMPLETION_UNCONFIRMED");
  assert.deepEqual(c.option1.levels.map(x=>x.price),[7659.5,7636.75,7618.5,7600.25,7574.25,7541,7498.75,7445.25,7386]);
  assert.deepEqual(c.option2.levels.map(x=>x.price),[7620,7658,7689,7719.75,7763.5]);
  assert.deepEqual(c.option1.levels.map(x=>x.status),["OWNER_OBSERVED_TOUCH","OWNER_OBSERVED_TOUCH","OWNER_OBSERVED_TOUCH","OWNER_OBSERVED_TOUCH","OWNER_OBSERVED_TOUCH","WATCH","WATCH","WATCH","WATCH"]);
  assert(c.option2.levels.every(x=>x.status==="WATCH"));
  assert(w.degrees.submicro.ownerSubmicroADownInsideMicroW4);
  assert(w.degrees.micro.ownerMicroCDownOct31);
  assert(w.degrees.subminute.ownerSubminuteCDownOct31);
  const m=ownerApprovedWorkingSelection;
  assert.equal(m.selectionRevision,5);
  assert.equal(m.degrees.submicro.key,"submicroCompare");
  assert.equal(m.degrees.micro.activeWave,"C");
  assert.equal(m.degrees.subminute.activeWave,"C");
  assert.equal(c.noExecution,true);
});
test("published selection accepts two scenarios without claiming completion",()=>{
  const w=buildCurrentWavelength({symbol:"ES",currentPrice:7614});
  const degreeStates={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
  const p=buildAuthorizedWorkingStructureV1({currentWavelength:w,degreeStates,publicationTime:"2026-10-31T23:00:00Z"});
  assert.equal(p.degrees.submicro.available,true);
  assert.equal(p.degrees.submicro.activeWave,"ALTERNATIVES");
  assert.equal(p.degrees.submicro.completionConfirmed,false);
});
