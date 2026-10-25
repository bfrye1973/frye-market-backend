import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27SevenInvalidationsV1} from "../logic/engine27/v2/buildSevenInvalidationsV1.js";
import {buildEngine27WorkingSevenDegrees} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
import {buildEngine27UnifiedMarketContextV1} from "../logic/engine27/v2/buildUnifiedMarketContextV1.js";
const wave={version:"engine22.minuteW2RetracementOwner.v1",activeWave:"W2",direction:"DOWN",levels:[{price:7721.75,status:"WATCH"}]};
const e22={
 currentWavelength:{degrees:{minute:{ownerMinuteW2Retracement:wave,ownerMinuteW2Hypothesis:{version:"engine22.minuteW2ComplexCorrectionWatch.v1",activeWave:"D"}},submicro:{ownerSubmicroCDown:{version:"engine22.submicroCDownOwnerWatch.v1",activeWave:"C",direction:"DOWN"}}}},
 sevenDegreeInvalidations:{schema:"engine22.sevenDegreeInvalidations.v1",status:"NO_APPROVED_ACTIVE_INVALIDATIONS",degrees:{
 submicro:{activeModel:"engine22.submicroCDownOwnerWatch.v1",modelSource:"ownerSubmicroCDown",rules:[{scope:"DEGREE_COUNT",status:"NOT_PUBLISHED",price:null}],invalidationReadiness:{candidateZone:{low:7743,high:7743,kind:"OWNER_COMPLETED_B_HIGH_RECOUNT_REFERENCE"},zoneAuthority:"REVIEW_ONLY_NOT_STRUCTURAL_INVALIDATION"}},
 minute:{activeModel:"engine22.minuteW2RetracementOwner.v1",invalidationReadiness:{candidateZone:{low:7419.5,high:7419.5,kind:"OWNER_CONFIRMED_MINUTE_W1_ORIGIN"},zoneAuthority:"REVIEW_ONLY_NOT_STRUCTURAL_INVALIDATION"}}
 }},
 higherDegreeBearishProtection:{schema:"engine22.higherDegreeBearishProtection.v1",degrees:{
 intermediate:{status:"WARNING",warningLevel:7200,deepRiskLevel:6800,timeframe:"4h",sourceFresh:true,structuralInvalidated:false},
 primary:{status:"UNCONFIRMED",warningLevel:7200,timeframe:"1d",sourceFresh:false}
 }}
};
const snapshot={strategies:{"intraday_scalp@10m":{engine22WaveStrategy:e22}}};
test("Engine27 copies review references, does not manufacture hard invalidations",()=>{
 const o=buildEngine27SevenInvalidationsV1({snapshot});
 assert.equal(o.degrees.submicro.price,null);assert.equal(o.degrees.submicro.review.zone.low,7743);
 assert.equal(o.degrees.minute.review.zone.low,7419.5);assert.equal(o.publishedCount,0);assert.equal(o.noExecution,true);
});
test("Minute card selects authoritative W2 owner, not old D or W3",()=>{
 const o=buildEngine27WorkingSevenDegrees({snapshot});
 assert.equal(o.degrees.minute.provenance.workingModelVersion,"engine22.minuteW2RetracementOwner.v1");
 assert.equal(o.degrees.minute.activeWave,"W2");
 assert.equal(o.degrees.minute.invalidation.price,null);
});
test("higher degree warning remains warning only and cross-market does not override",()=>{
 const o=buildEngine27UnifiedMarketContextV1({snapshot,levels:{instruments:{
 QQQ:{available:true,levels:[{}],lastCandleTime:"2026-10-23"},
 VIX:{available:true,levels:[{}],lastCandleTime:"2026-10-23"}
 }}});
 assert.equal(o.warnings.intermediate.status,"WARNING");
 assert.equal(o.warnings.intermediate.structuralInvalidated,false);
 assert.equal(o.strategyReads.minor.structuralRisk.status,"NOT_SET");
 assert.equal(o.noPermissionCreated,true);
});
