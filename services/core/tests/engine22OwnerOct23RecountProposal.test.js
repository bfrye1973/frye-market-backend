import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine22Oct23OwnerRecountProposal as build} from "../logic/engine22/wave/buildOwnerOct23RecountProposal.js";
const existing=()=>{
 const model=(version)=>({version,activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE"});
 return {degrees:{
  submicro:{ownerSubmicroCDown:model("engine22.submicroCDownOwnerWatch.v1")},
  micro:{ownerMicroCDown:model("engine22.microCDownOwnerWatch.v1")},
  subminute:{ownerCurrentCDown:model("engine22.subminuteCurrentCDownReference.v1")},
  minute:{ownerMinuteW2Retracement:{version:"engine22.minuteW2RetracementOwner.v1",
    activeWave:"W2",nextWaveStarted:false}},
 }};
};
test("owner nominated 7648.50 Oct23 7am AZ for three independent proposed C endpoints",()=>{
 const x=build({currentWavelength:existing()});
 assert.equal(x.ok,true);
 assert.deepEqual(Object.keys(x.models),["submicro","micro","subminute"]);
 for(const m of Object.values(x.models)){
  assert.equal(m.nominatedCDownEndpoint.price,7648.50);
  assert.equal(m.nominatedCDownEndpoint.instant,"2026-10-23T14:00:00.000Z");
  assert.equal(m.completionStatus,"OWNER_PROPOSED_PENDING_INDEPENDENT_STRUCTURAL_VALIDATION");
  assert.equal(m.activePointerChangeAuthorized,false);
 }
 assert.equal(x.models.subminute.proposedNextStructure,"D_UP_DEVELOPING_CANDIDATE");
});
test("Minute W2 stays incomplete and W3 unstarted",()=>{
 const x=build({currentWavelength:existing()});
 assert.equal(x.minutePreservation.correctionComplete,false);
 assert.equal(x.minutePreservation.nextWaveStarted,false);
 assert.equal(x.approvedForPublication,false);
});
test("invalid or replaced existing model blocks this proposal",()=>{
 const e=existing();e.degrees.micro.ownerMicroCDown.version="WRONG";
 assert.equal(build({currentWavelength:e}).ok,false);
});
test("attempt to replace minute W2 or start W3 blocks proposal",()=>{
 const e=existing();e.degrees.minute.ownerMinuteW2Retracement.nextWaveStarted=true;
 assert.equal(build({currentWavelength:e}).ok,false);
});
test("previous owner count, anchors and touch history stay unmodified",()=>{
 const e=existing();e.degrees.submicro.ownerSubmicroCDown.levels=[{price:7664.5,status:"TOUCHED"}];
 const before=structuredClone(e);build({currentWavelength:e});assert.deepEqual(e,before);
});
