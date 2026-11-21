import test from "node:test";
import assert from "node:assert/strict";
import {observeEngine22ReviewBoundary as observe} from "../logic/engine22/invalidations/observeBoundaryShadow.js";
const bars=[{sourceBarId:"a",sourceTimestamp:"2026-10-26T15:00:00Z",timeframe:"10m",closed:true,low:7730,high:7745,close:7739},
{sourceBarId:"b",sourceTimestamp:"2026-10-26T15:10:00Z",timeframe:"10m",closed:true,low:7740,high:7748,close:7746}];
const rule={countId:"COUNT-SUBMICRO",price:7743,comparison:"ABOVE",scope:"RECOUNT_REVIEW",trigger:"COMPLETED_CLOSE",timeframe:"10m"};
test("closed-bar B-high recount review never becomes structural invalidation",()=>{
 const r=observe({countId:rule.countId,rule,bars});
 assert.equal(r.status,"REVIEW_OBSERVED");assert.equal(r.evidenceBarId,"b");
 assert.equal(r.hardInvalidationConfirmed,false);assert.equal(r.tradePermissionEligible,false);
});
test("wick-only observation is different from close-based confirmation",()=>{
 const result=observe({countId:rule.countId,rule,bars:bars.slice(0,1)});
 assert.equal(result.status,"NOT_OBSERVED");
});
test("reject wrong count, synthetic identity and unapproved hard scope",()=>{
 assert.equal(observe({countId:"OTHER",rule,bars}).available,false);
 assert.equal(observe({countId:"ES-V3-BASELINE-MINUTE",rule:{...rule,countId:"ES-V3-BASELINE-MINUTE"},bars}).available,false);
 assert.equal(observe({countId:rule.countId,rule:{...rule,scope:"HARD_INVALIDATION"},bars}).available,false);
});
test("forming bar and mixed timeframe fail closed",()=>{
 assert.equal(observe({countId:rule.countId,rule,bars:[{...bars[0],closed:false}]}).available,false);
 assert.equal(observe({countId:rule.countId,rule,bars:[{...bars[0],timeframe:"5m"}]}).available,false);
});
