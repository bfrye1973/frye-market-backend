import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27WorkingSevenDegrees} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
function fixture(direction="DOWN"){
 const start=Date.parse("2026-10-24T16:00:00Z")/1000;
 const bars=[{time:start,close:7700},{time:start+600,close:direction==="DOWN"?7695:7705}];
 const owner=(version)=>({version,activeWave:"C",direction:"DOWN",stage:"DEVELOPING_CANDIDATE"});
 return {now:"2026-10-24T16:22:00Z",symbol:"ES",marketMeter:{layers:{emaPosture:{tenMinute:{bars}}}},strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{
  currentWavelength:{currentPrice:7695,degrees:{submicro:{ownerSubmicroCDown:owner("engine22.submicroCDownOwnerWatch.v1")},micro:{ownerMicroCDown:owner("engine22.microCDownOwnerWatch.v1")},subminute:{ownerCurrentCDown:owner("engine22.subminuteCurrentCDownReference.v1")},minute:{ownerMinuteW2Hypothesis:{version:"engine22.minuteW2ComplexCorrectionWatch.v1"},ownerLargerCDownScenario:{version:"engine22.largerCorrectionCDownWatch.v1",status:"DEVELOPING",levels:[]}}}},
  sevenDegreeInvalidations:{degrees:{submicro:{invalidationReadiness:{status:"OWNER_RULE_APPROVAL_REQUIRED",proposedReview:{candidateReference:7743}}},micro:{invalidationReadiness:{status:"OWNER_RULE_APPROVAL_REQUIRED",proposedReview:{candidateReference:7813.25}}}}},degreeStates:{minor:{active:true,activeWave:"W5",direction:"UP"},intermediate:{active:true,activeWave:"W3",direction:"UP"},primary:{active:true,activeWave:"W5",direction:"UP"}}
 }}}};
}
test("seven cards distinguish aligned and conflict without declaring invalidation",()=>{
 const d=buildEngine27WorkingSevenDegrees({snapshot:fixture("DOWN")});
 assert.equal(d.degrees.submicro.directionAssessment.status,"ALIGNED");
 assert.equal(d.degrees.micro.directionAssessment.status,"ALIGNED");
 assert.equal(d.degrees.submicro.directionAssessment.reviewZone.low,7743);
 const u=buildEngine27WorkingSevenDegrees({snapshot:fixture("UP")});
 assert.equal(u.degrees.submicro.directionAssessment.status,"CONFLICT");
 for(const degree of u.degreeOrder){
   assert.equal(u.degrees[degree].directionAssessment.officialInvalidationPrice,null);
   assert.equal(u.degrees[degree].directionAssessment.noExecution,true);
 }
});
test("missing completed bars and unavailable degree evidence fail closed",()=>{
 const f=fixture();delete f.marketMeter;
 const v=buildEngine27WorkingSevenDegrees({snapshot:f});
 for(const degree of v.degreeOrder)assert.equal(v.degrees[degree].directionAssessment.status,"UNCONFIRMED");
});
