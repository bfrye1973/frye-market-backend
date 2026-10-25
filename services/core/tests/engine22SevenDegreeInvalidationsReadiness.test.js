import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildSevenDegreeInvalidationsV1} from "../logic/engine22/wave/buildSevenDegreeInvalidationsV1.js";
const names=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const build=()=>buildSevenDegreeInvalidationsV1({
 currentWavelength:buildCurrentWavelength({symbol:"ES",currentPrice:7672.5,microBars5m:[]}),
 degreeStates:{minor:{active:true,activeWave:"W5",direction:"UP",invalidation:7398},
 intermediate:{active:true,activeWave:"W3",direction:"UP"},primary:{active:true,activeWave:"W5",direction:"UP"}}});
test("seven-degree readiness is readable by Engine27 but no false invalidation or authorization",()=>{
 const v=build();
 assert.deepEqual(Object.keys(v.degrees),names);
 assert.equal(v.degrees.submicro.invalidationReadiness.proposedReview.candidateReference,7743);
 assert.equal(v.degrees.micro.invalidationReadiness.proposedReview.candidateReference,7813.25);
 assert.equal(v.degrees.submicro.invalidationReadiness.proposedReview.reviewTimeframe,"10m");
 assert.equal(v.degrees.micro.invalidationReadiness.proposedReview.reviewTimeframe,"1h");
 for(const n of names){
  const d=v.degrees[n],q=d.invalidationReadiness;
  assert.equal(q.status,"OWNER_RULE_APPROVAL_REQUIRED");
  assert.equal(q.officialInvalidationPrice,null);
  assert.equal(q.confirmedInvalidation,false);
  assert.equal(q.tradePermissionEligible,false);
  assert.equal(q.alertEligible,false);
  assert.equal(q.approvedRules,0);
  assert.equal(q.prerequisites.length,7);
  assert.equal(q.proposedReview.parentRecountOnReview,false);
  assert.ok(d.rules.every(x=>x.price===null && x.status==="NOT_PUBLISHED" && x.confirmedAt===null));
 }
 assert.equal(v.warningEligible,false);
 assert.equal(v.currentCountIdsVerified,false);
 for(const n of names.slice(2))assert.equal(v.degrees[n].invalidationReadiness.proposedReview.candidateReference,null);
});
test("superceded or missing owner model never leaks historical review reference",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7672.5,microBars5m:[]});
 delete cw.degrees.submicro.ownerSubmicroCDown;
 delete cw.degrees.micro.ownerMicroCDown;
 const v=buildSevenDegreeInvalidationsV1({currentWavelength:cw});
 for(const n of ["submicro","micro"]){
  assert.equal(v.degrees[n].activeModel,null);
  assert.equal(v.degrees[n].invalidationReadiness.proposedReview.candidateReference,null);
 }
});
test("tampered legacy invalidation, touched Fibs, and premature price observation do not approve anything",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:8000,microBars5m:[]});
 cw.degrees.micro.invalidation=7813.25;
 cw.degrees.subminute.invalidation=7618;
 cw.degrees.micro.ownerMicroCDown.levels[0].status="TOUCHED";
 const v=buildSevenDegreeInvalidationsV1({currentWavelength:cw});
 assert.equal(v.status,"NO_APPROVED_ACTIVE_INVALIDATIONS");
 for(const n of names)assert.equal(v.degrees[n].invalidationReadiness.confirmedInvalidation,false);
});
