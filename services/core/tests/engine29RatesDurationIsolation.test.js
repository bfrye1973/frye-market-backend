import test from "node:test";
import assert from "node:assert/strict";
import { buildRatesDurationGroup } from "../logic/engine29/groups/buildRatesDurationGroup.js";
import { buildEngine29DownstreamContext } from "../logic/engine29/downstreamContext.js";

const view = { classification: { state:"HEALTHY",confidence:"HIGH",stage:"NONE" },
  latest: { close:100,time:Date.parse("2026-11-23T16:00:00Z") },
  freshness: { stale:false,reason:"FRESH" } };
function sym(symbol, structural=true, tactical=true, fast=true) {
 return {canonicalSymbol:symbol,label:symbol,evidenceQuality:"DIRECT",
   ...(structural?{structural:view}:{}),
   ...(tactical?{tactical:view}:{}),
   ...(fast?{fastTactical:view}:{})};
}
test("FRED daily yields can be available structurally while intentionally missing 1H/30m",()=>{
 const g=buildRatesDurationGroup({
   US10Y:sym("US10Y",true,false,false),
   US30Y:sym("US30Y",true,false,false),
   TLT:sym("TLT",true,true,true),
 });
 assert.equal(g.structural.dataDegraded,false);
 assert.equal(g.tactical.dataDegraded,true);
 assert.equal(g.fastTactical.dataDegraded,true);
 assert.deepEqual(g.tactical.missingRequiredMembers.sort(),["US10Y","US30Y"]);
 assert.deepEqual(g.fastTactical.missingRequiredMembers.sort(),["US10Y","US30Y"]);
});
test("ratesDuration degradation is not automatically inherited by independent parent or squeeze lanes",()=>{
 const ctx=buildEngine29DownstreamContext({
   timestamp:"2026-11-23T17:00:00Z",
   dataDegraded:true,
   dataQuality:{degradedGroups:["ratesDuration"],esThirtyMinuteFreshness:{stale:false,reason:"FRESH"}},
   marketCharacter:{move:{parent:{direction:"UP",state:"CONTINUED"}},
     squeezeCampaign:{direction:"DOWN",state:"SQUEEZE_WATCH"}},
   squeezeV2Observation:{available:true,dataDegraded:false,sourceTimestamp:"2026-11-23T16:59:00Z"}
 });
 assert.equal(ctx.dataDegraded,true);
 assert.equal(ctx.lanes.parentMove.dataDegraded,false);
 assert.equal(ctx.lanes.squeeze.dataDegraded,false);
 assert.equal(ctx.lanes.ratesDuration.dataDegraded,true);
});
