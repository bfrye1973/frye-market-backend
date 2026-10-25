import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildSevenDegreeInvalidationsV1} from "../logic/engine22/wave/buildSevenDegreeInvalidationsV1.js";
const wave=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7665,microBars5m:[]});
const mark=(price,confirmed=true)=>({price,confirmed,superseded:false});
test("Minute and Minor review references are published but never hard invalidations",()=>{
 const r=buildSevenDegreeInvalidationsV1({currentWavelength:wave()});
 assert.deepEqual([r.degrees.minute.invalidationReadiness.candidateZone.low,r.degrees.minute.invalidationReadiness.candidateZone.high],[7557,7575]);
 assert.deepEqual([r.degrees.minor.invalidationReadiness.candidateZone.low,r.degrees.minor.invalidationReadiness.candidateZone.high],[7398,7398]);
 for(const d of ["minute","minor","intermediate","primary"]){
  const entry=r.degrees[d].invalidationReadiness;
  assert.equal(entry.officialInvalidationPrice,null);
  assert.equal(entry.confirmedInvalidation,false);
  assert.equal(entry.zoneAuthority,"REVIEW_ONLY_NOT_STRUCTURAL_INVALIDATION");
  assert.ok(r.degrees[d].rules.every(x=>x.price===null&&x.status==="NOT_PUBLISHED"));
 }
 assert.equal(r.degrees.intermediate.invalidationReadiness.candidateZone,null);
 assert.equal(r.degrees.primary.invalidationReadiness.candidateZone,null);
});
test("Primary W5 requires confirmed W4 mark, Intermediate W3 requires confirmed W2 mark",()=>{
 const states={
  intermediate:{active:true,activeWave:"W3",marks:{W2:mark(7000)}},
  primary:{active:true,activeWave:"W5",marks:{W4:mark(6900)}},
  minor:{active:true,activeWave:"W5",marks:{W4:mark(7430)}},
 };
 const r=buildSevenDegreeInvalidationsV1({currentWavelength:wave(),degreeStates:states});
 assert.equal(r.degrees.intermediate.invalidationReadiness.candidateZone.low,7000);
 assert.equal(r.degrees.primary.invalidationReadiness.candidateZone.low,6900);
 assert.equal(r.degrees.minor.invalidationReadiness.candidateZone.low,7430);
 for(const d of ["minor","intermediate","primary"])assert.equal(r.degrees[d].invalidationReadiness.candidateZone.qualifiedMark,true);
 assert.equal(r.warningEligible,false);
});
test("unconfirmed and superseded pivots cannot fabricate zones",()=>{
 const states={
  intermediate:{active:true,activeWave:"W3",marks:{W2:mark(7000,false)}},
  primary:{active:true,activeWave:"W5",marks:{W4:{price:6900,confirmed:true,superseded:true}}},
 };
 const r=buildSevenDegreeInvalidationsV1({currentWavelength:wave(),degreeStates:states});
 assert.equal(r.degrees.intermediate.invalidationReadiness.candidateZone,null);
 assert.equal(r.degrees.primary.invalidationReadiness.candidateZone,null);
 assert.equal(r.degrees.intermediate.invalidationReadiness.zoneAvailability,"QUALIFIED_PIVOT_REQUIRED");
});
