import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildSevenDegreeInvalidationsV1} from "../logic/engine22/wave/buildSevenDegreeInvalidationsV1.js";
const degreeNames=["submicro","micro","subminute","minute","minor","intermediate","primary"];
test("seven independent active degree records, no invented invalidations",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 const before=JSON.stringify(cw);
 const higher={
   minor:{active:true,activeWave:"W5",direction:"UP",invalidation:7398},
   intermediate:{active:true,activeWave:"W3",direction:"UP",correctionModel:{invalidationLevel:7000,invalidationRule:"legacy"}},
   primary:{active:true,activeWave:"W5",direction:"UP"},
 };
 const beforeHigher=JSON.stringify(higher);
 const output=buildSevenDegreeInvalidationsV1({currentWavelength:cw,degreeStates:higher,evaluationTimeMs:Date.parse("2026-10-24T22:00:00Z")});
 assert.equal(output.schema,"engine22.sevenDegreeInvalidations.v1");
 assert.equal(output.mode,"READ_ONLY");
 assert.equal(output.warningEligible,false);
 assert.deepEqual(Object.keys(output.degrees),degreeNames);
 assert.equal(output.evaluationTime,"2026-10-24T22:00:00.000Z");
 assert.equal(output.degrees.submicro.activeModel,"engine22.submicroADownOwnerWatch.v1");
 assert.equal(output.degrees.micro.activeModel,"engine22.microBDownOwnerWatch.v1");
 assert.equal(output.degrees.minute.activeModel,"engine22.minuteW2ComplexCorrectionWatch.v1");
 assert.equal(output.degrees.subminute.activeModel,null);
 assert.equal(output.degrees.subminute.waveIdentity,"SUBMINUTE_ABC_UP");
 assert.equal(output.degrees.minute.largerCorrectionDirection,"CORRECTIVE");
 assert.equal(output.degrees.minute.direction,"UP");
 assert.equal(output.degrees.micro.waveIdentity,"MICRO_B_DOWN");
 assert.equal(output.degrees.submicro.waveIdentity,"SUBMICRO_A_DOWN");
 assert.deepEqual(output.degrees.minute.rules.map(x=>x.scope),["INTERNAL_D_UP","MINUTE_W2_DEGREE_COUNT","PARENT_STRUCTURE"]);
 for(const degree of degreeNames){
  const item=output.degrees[degree];
  assert.equal(item.sourceCountId,null);
  assert.equal(item.countIdentityStatus,"NOT_PUBLISHED");
  for(const rule of item.rules){
    assert.equal(rule.status,"NOT_PUBLISHED");
    assert.equal(rule.lifecycle,"NOT_PUBLISHED");
    assert.equal(rule.price,null);
    assert.equal(rule.trigger,null);
    assert.equal(rule.timeframe,null);
    assert.equal(rule.confirmedAt,null);
    assert.equal(rule.evidence,null);
  }
 }
 assert.equal(JSON.stringify(cw),before);
 assert.equal(JSON.stringify(higher),beforeHigher);
});
test("legacy or superseded owner models never supply invalidation",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7760,microBars5m:[]});
 delete cw.degrees.micro.ownerMicroBDown;
 delete cw.degrees.submicro.ownerSubmicroADown;
 delete cw.degrees.minute.ownerMinuteW2Hypothesis;
 const out=buildSevenDegreeInvalidationsV1({
   currentWavelength:cw,degreeStates:{
    micro:{active:true,invalidation:7782.75},
    subminute:{active:true,invalidation:7673.25},
    minor:{active:true,invalidation:7398},
   }});
 for(const d of ["micro","submicro","minute"]){
  assert.equal(out.degrees[d].activeModel,null);
  assert.equal(out.degrees[d].modelStatus,"NOT_PUBLISHED");
 }
 assert.ok(out.degrees.micro.rules.every(x=>x.status==="NOT_PUBLISHED"));
 assert.ok(out.degrees.submicro.rules.every(x=>x.status==="NOT_PUBLISHED"));
 assert.ok(out.degrees.minute.rules.every(x=>x.status==="NOT_PUBLISHED"));
 assert.equal(out.degrees.minor.rules[0].price,null);
});
test("no price touch, incomplete candle, normal recount or model change can imply confirmation",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7700,microBars5m:[]});
 cw.degrees.micro.ownerMicroBDown.levels[0].status="TOUCHED";
 cw.degrees.submicro.ownerSubmicroADown.levels[0].status="TOUCHED";
 cw.degrees.micro.microSequence.invalidation=7782.75;
 const output=buildSevenDegreeInvalidationsV1({currentWavelength:cw});
 for(const item of Object.values(output.degrees)){
  for(const rule of item.rules) assert.notEqual(rule.lifecycle,"CONFIRMED_INVALIDATED");
 }
 assert.equal(output.warningEligible,false);
});
