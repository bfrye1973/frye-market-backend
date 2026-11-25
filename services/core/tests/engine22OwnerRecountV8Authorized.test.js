import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {readAuthorizedWorkingStructure} from "../logic/engine27/v2/readAuthorizedWorkingStructure.js";
import {buildEngine6AdvisoryContext} from "../logic/engine6/6b-market-intelligence/buildEngine6AdvisoryContext.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
import {ownerApprovedWorkingSelectionV8} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV8.js";

const at="2026-11-24T06:37:00Z";
const old="2026-11-23T22:00:00Z";
const degreeStates={
 primary:{degree:"primary",activeWave:"W5",direction:"UP",stage:"RESEARCH"},
 intermediate:{degree:"intermediate",activeWave:"W1",direction:"UP",stage:"RESEARCH"},
 minor:{degree:"minor",activeWave:"W5",direction:"UP",stage:"LEGACY"}
};
function make(iso){
 const w=buildCurrentWavelength({symbol:"ES",currentPrice:7272.25,evaluationTimeMs:Date.parse(iso)});
 return {w,p:buildAuthorizedWorkingStructureV1({currentWavelength:w,degreeStates,publicationTime:iso})};
}
test("owner v8 current five lower degrees replace old direction without deleting old source models",()=>{
 const {w,p}=make(at);
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,7);
 assert.equal(ownerApprovedWorkingSelectionV8.selectionRevision,8);
 assert.equal(p.publicationRevision,8);
 assert.equal(p.status,"COMPLETE_WORKING_SELECTION");
 for(const d of ["minor","minute","subminute"]){
   assert.equal(p.degrees[d].activeWave,"RECOUNT");
   assert.equal(p.degrees[d].direction,"NEUTRAL");
   assert.equal(p.degrees[d].selectionStatus,"OWNER_SELECTED_WORKING");
   assert.deepEqual(p.degrees[d].levels,[]);
 }
 assert.equal(p.degrees.micro.activeWave,"W1");
 assert.equal(p.degrees.micro.direction,"UP");
 assert.equal(p.degrees.micro.completionConfirmed,false);
 assert.deepEqual(p.degrees.micro.levels,[]);
 assert.equal(p.degrees.submicro.activeWave,"UNRESOLVED");
 assert.equal(p.degrees.submicro.direction,"NEUTRAL");
 assert.deepEqual(p.degrees.submicro.levels,[]);
 assert.ok(w.degrees.micro.ownerMicroAbcDownNov16Research);
 assert.ok(w.degrees.submicro.ownerSubmicroW3Nov9InternalResearch);
 assert.equal(p.noExecution,true);
 assert.equal(p.noPermissionCreated,true);
});
test("strict Engine27 reader and Engine6 context accept coherent new parent chain without permission",()=>{
 const {w,p}=make(at);
 const snapshot={symbol:"ES",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{
  authorizedWorkingStructure:p,currentWavelength:w
 }}}};
 assert.equal(readAuthorizedWorkingStructure(snapshot).available,true);
 const v=buildEngine6AdvisoryContext({snapshot});
 assert.equal(v.wave.available,true);
 assert.equal(v.wave.ownerRevision,8);
 assert.equal(v.wave.micro.workingDirection,"UP");
 assert.equal(v.wave.micro.completionConfirmed,false);
 assert.equal(v.wave.submicro.workingDirection,"NEUTRAL");
 assert.equal(v.noPermissionCreated,true);
 assert.equal(v.noEntryVeto,true);
 assert.equal(v.noExecution,true);
});
test("no lookahead: before effective date remains archived owner revision 7",()=>{
 const {w,p}=make(old);
 assert.equal(w.ownerRecountV8,null);
 assert.equal(p.publicationRevision,7);
 assert.equal(p.degrees.micro.activeWave,"C");
 assert.equal(p.degrees.micro.direction,"DOWN");
});
test("no ES model leakage to other symbols or absent clock",()=>{
 const w=buildCurrentWavelength({symbol:"SPY",currentPrice:100,evaluationTimeMs:Date.parse(at)});
 assert.equal(w.ownerRecountV8,null);
 const n=buildCurrentWavelength({symbol:"ES",currentPrice:7200});
 assert.equal(n.ownerRecountV8,null);
});
