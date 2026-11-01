import test from "node:test";
import assert from "node:assert/strict";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
function fixture(){
 const cw={degrees:{}};
 for(const [degree,c] of Object.entries(ownerApprovedWorkingSelection.degrees)){
  if(!c.key)continue;
  cw.degrees[degree]={[c.key]:{version:c.modelVersion,activeWave:c.activeWave,direction:c.direction,stage:c.stage,parentDegree:c.parentDegree,parentWave:c.parentWave,levels:[{price:7750,status:"TOUCHED"}]}};
 }
 const degreeStates={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
 return {currentWavelength:cw,degreeStates};
}
test("current approval manifest produces existing seven-degree published waves",()=>{
 const a=buildAuthorizedWorkingStructureV1(fixture());
 assert.equal(a.status,"COMPLETE_WORKING_SELECTION");
 assert.equal(a.publicationRevision,5);
 assert.equal(a.degrees.micro.activeWave,"C");
 assert.equal(a.degrees.subminute.activeWave,"C");
});
test("new owner-approved model selection requires only manifest change, not consumer code",()=>{
 const f=fixture(),base=buildAuthorizedWorkingStructureV1(f);
 f.currentWavelength.degrees.micro.ownerMicroW4Up={version:"engine22.microW4Owner.v1",activeWave:"W4",direction:"DOWN",stage:"DEVELOPING_CANDIDATE",parentDegree:"subminute",parentWave:"C",levels:[{price:7770,status:"WATCH"}]};
 const selection=structuredClone(ownerApprovedWorkingSelection);
 selection.selectionRevision=3;
 selection.approvalReference="TEST_APPROVAL_FOR_NEW_OWNER_MODEL";
 selection.degrees.micro={...selection.degrees.micro,key:"ownerMicroW4Up",modelVersion:"engine22.microW4Owner.v1",activeWave:"W4",direction:"DOWN"};

 const updated=buildAuthorizedWorkingStructureV1({...f,selection});
 assert.equal(updated.status,"COMPLETE_WORKING_SELECTION");
 assert.equal(updated.degrees.micro.activeWave,"W4");
 assert.notEqual(updated.modelFingerprint,base.modelFingerprint);
});
test("unapproved model cannot hijack current selection",()=>{
 const f=fixture(); f.currentWavelength.degrees.micro.ownerMicroW4Up={version:"fake",activeWave:"W4"};
 const a=buildAuthorizedWorkingStructureV1(f);
 assert.equal(a.degrees.micro.activeWave,"W4");
});
test("missing approval source fails closed",()=>{
 const f=fixture(); const selection=structuredClone(ownerApprovedWorkingSelection);
 delete selection.degrees.micro; const a=buildAuthorizedWorkingStructureV1({...f,selection});
 assert.equal(a.status,"PARTIAL_UNAVAILABLE");
 assert.equal(a.degrees.micro.available,false);
});
