import test from "node:test";import assert from "node:assert/strict";
import {proposeEngine22TransitionShadow as propose} from "../logic/engine22/transitions/proposeTransitionShadow.js";
import {buildEngine22CanonicalPublicationPreview as preview} from "../logic/engine22/publication/buildPublicationPreview.js";
const deg=["INTRADAY_SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"];
test("transition proposals never activate counts",()=>{
 const x=propose({degreeState:{degreeId:"MICRO",countId:"C1",activeWave:"W2",lifecycle:"DEVELOPING"},
 evidence:{completed:true,sourceTimestamp:"2026-10-26T18:00:00Z",sourceBarId:"bar1",sourceTimeframe:"5m",completionCandidate:true}});
 assert.equal(x.available,true);assert.equal(x.activationAuthorized,false);assert.equal(x.publishAuthorized,false);
});
test("incomplete transition evidence cannot authorize anything",()=>{
 const x=propose({degreeState:{activeWave:"W2"},evidence:null});
 assert.equal(x.available,false);assert.equal(x.activationAuthorized,false);
});
test("seven degree sidecar leaves legacy data intact",()=>{
 const legacy={degreeStates:{micro:{activeWave:"W2"}},currentWavelength:{version:"legacy"}};
 const before=structuredClone(legacy);
 const degrees=Object.fromEntries(deg.map(d=>[d,{degreeId:d,countId:"REAL_"+d,modelVersion:"OWNER",lifecycle:"DEVELOPING",provenanceStatus:"OWNER_WORKING"}]));
 const x=preview({legacy,degreeRecords:degrees});
 assert.equal(x.available,true);assert.equal(x.protectedContractsUnchanged,true);assert.equal(x.publishAuthorized,false);assert.deepEqual(legacy,before);
});
test("missing degrees and synthetic IDs fail closed",()=>{
 const legacy={};
 assert.equal(preview({legacy,degreeRecords:{MICRO:{degreeId:"MICRO"}}}).available,false);
 const degrees=Object.fromEntries(deg.map(d=>[d,{degreeId:d,countId:"C_"+d}]));
 degrees.MICRO.countId="ES-V3-BASELINE-MICRO";
 assert.equal(preview({legacy,degreeRecords:degrees}).available,false);
});
