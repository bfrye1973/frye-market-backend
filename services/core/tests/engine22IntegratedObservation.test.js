import test from "node:test";import assert from "node:assert/strict";
import {buildEngine22IntegratedObservationShadow as run} from "../logic/engine22/integration/buildIntegratedObservationShadow.js";
const b=(i,hi,lo,cl)=>({sourceTimestamp:new Date(Date.UTC(2026,9,26,12,i*5)).toISOString(),
 sourceBarId:"ES-5m-"+i,timeframe:"5m",sourceVendor:"fixture",sourceSeriesId:"ES-TEST",
 closed:true,open:cl,high:hi,low:lo,close:cl});
const bars=[b(0,101,98,100),b(1,102,99,101),b(2,104,100,102),
 b(3,102,99,100),b(4,101,98,99),b(5,102,97,100),b(6,103,99,101),b(7,104,100,102)];
const owner={degreeId:"MICRO",parentDegree:"SUBMINUTE",countId:"ORIGINAL-MICRO-ID-01",
 modelVersion:"engine22.microCDownOwnerWatch.v1",ownerApprovalRef:"OCT25",sequenceDirection:"DOWN",
 lifecycle:"DEVELOPING",activeWave:null,patternType:"ABC",anchors:{}};
test("composes working owner recognition, with remaining modules safely unavailable",()=>{
 const x=run({degree:"MICRO",ownerCount:owner,bars,timeframe:"5m",
  expectedSource:{sourceVendor:"fixture",sourceSeriesId:"ES-TEST"}});
 assert.equal(x.available,true);assert.equal(x.workingCountId,owner.countId);
 assert.equal(x.fibonacci.available,false);assert.equal(x.completionWatch.status,"DEVELOPING");
 assert.equal(x.activationAuthorized,false);assert.equal(x.publishAuthorized,false);
 assert.equal(x.noWaveCountMutation,true);
});
test("count-scoped review observation integrates but never authorizes invalidation",()=>{
 const x=run({degree:"MICRO",ownerCount:owner,bars,timeframe:"5m",
  reviewRule:{countId:owner.countId,comparison:"BELOW",price:98,
   scope:"RECOUNT_REVIEW",trigger:"COMPLETED_CLOSE",timeframe:"5m"}});
 assert.equal(x.reviewBoundary.available,true);
 assert.equal(x.reviewBoundary.hardInvalidationConfirmed,false);
 assert.equal(x.reviewBoundary.tradePermissionEligible,false);
});
test("wrong review count cannot change owner identity",()=>{
 const x=run({degree:"MICRO",ownerCount:owner,bars,timeframe:"5m",
  reviewRule:{countId:"OTHER",comparison:"BELOW",price:98,
   scope:"WARNING",trigger:"COMPLETED_CLOSE",timeframe:"5m"}});
 assert.equal(x.reviewBoundary.available,false);
 assert.equal(x.workingCountId,owner.countId);
});
test("incomplete 5m candle fails recognition and completion",()=>{
 const x=run({degree:"MICRO",ownerCount:owner,
  bars:[...bars.slice(0,3),{...bars[3],closed:false},...bars.slice(4)],timeframe:"5m"});
 assert.equal(x.available,false);assert.equal(x.completionWatch.available,false);
});
test("synthetic V3 active identity cannot enter lifecycle",()=>{
 const x=run({degree:"MICRO",ownerCount:{...owner,countId:"ES-V3-BASELINE-MICRO"},bars,timeframe:"5m"});
 assert.equal(x.available,false);assert.equal(x.completionWatch.available,false);
});
test("no automatic completion candidate from unbound raw target observation",()=>{
 const x=run({degree:"MICRO",ownerCount:owner,bars,timeframe:"5m",
  targetObservation:{countId:owner.countId,touched:true,sourceBarId:"ES-5m-5",levelKey:"r500"}});
 assert.equal(x.completionWatch.status,"DEVELOPING");
});
test("full pipeline never mutates caller objects",()=>{
 const input={degree:"MICRO",ownerCount:owner,bars,timeframe:"5m"};const original=structuredClone(input);
 run(input);assert.deepEqual(input,original);
});
