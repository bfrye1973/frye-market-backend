import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildSevenDegreeInvalidationsV1 as build} from "../logic/engine22/wave/buildSevenDegreeInvalidationsV1.js";
test("Micro W4 and Subminute D get owner start REVIEW references but never active invalidations",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7750,microBars5m:[]});
 const result=build({currentWavelength:cw});
 const micro=result.degrees.micro,subminute=result.degrees.subminute;
 assert.equal(micro.waveIdentity,"MICRO_W4_DOWN");
 assert.equal(micro.parentWave,"D");
 assert.equal(micro.invalidationReadiness.candidateZone.low,7820);
 assert.equal(micro.invalidationReadiness.candidateZone.kind,"OWNER_W4_START_HIGH_RECOUNT_REVIEW_ONLY");
 assert.equal(micro.invalidationReadiness.proposedReview.candidateReference,7820);
 assert.equal(subminute.waveIdentity,"SUBMINUTE_D_UP");
 assert.equal(subminute.invalidationReadiness.candidateZone.low,7648.5);
 assert.equal(subminute.invalidationReadiness.candidateZone.kind,"OWNER_SUBMINUTE_C_LOW_D_START_REVIEW");
 for(const d of [micro,subminute]){
  assert.equal(d.invalidationReadiness.confirmedInvalidation,false);
  assert.equal(d.invalidationReadiness.tradePermissionEligible,false);
  assert.equal(d.invalidationReadiness.alertEligible,false);
  assert.equal(d.invalidationReadiness.approvedRules,0);
  assert.equal(d.invalidationReadiness.candidateZone.triggerApproved,false);
  assert.ok(d.rules.every(r=>r.status==="NOT_PUBLISHED"));
 }
 assert.equal(result.status,"NO_APPROVED_ACTIVE_INVALIDATIONS");
});
test("Minute W2 still unfinished; Submicro retains C-down old B-high review",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7750,microBars5m:[]});
 const result=build({currentWavelength:cw});
 assert.equal(cw.degrees.minute.ownerMinuteW2Retracement.nextWaveStarted,false);
 assert.equal(result.degrees.submicro.invalidationReadiness.candidateZone.low,7820);
 assert.equal(result.degrees.minute.invalidationReadiness.candidateZone.low,7419.5);
 assert.equal(cw.degrees.micro.ownerMicroCDown.waveB.high,7813.25);
});
test("missing owner-wave identities do not invent review zone or approvals",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7750,microBars5m:[]});
 cw.degrees.micro.ownerMicroW4Down.priorW3Ending.price=null;
 cw.degrees.subminute.ownerCurrentDUp.proposedPriorC.endingPrice=null;
 const r=build({currentWavelength:cw});
 assert.equal(r.degrees.micro.invalidationReadiness.candidateZone,null);
 assert.equal(r.degrees.subminute.invalidationReadiness.candidateZone,null);
});
