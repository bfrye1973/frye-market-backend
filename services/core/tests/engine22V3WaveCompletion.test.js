import test from "node:test";
import assert from "node:assert/strict";
import {verifyEngine22V3WaveCompletion as verify} from "../logic/engine22/v3/verifyWaveCompletion.js";
const bars=[{sourceBarId:"a",sourceTimestamp:"2026-10-11T12:00:00Z",timeframe:"5m",closed:true,high:13,low:9,close:11},
{sourceBarId:"pivot",sourceTimestamp:"2026-10-11T12:05:00Z",timeframe:"5m",closed:true,high:16,low:10,close:15},
{sourceBarId:"confirm",sourceTimestamp:"2026-10-11T12:10:00Z",timeframe:"5m",closed:true,high:14,low:8,close:13},
{sourceBarId:"follow",sourceTimestamp:"2026-10-11T12:15:00Z",timeframe:"5m",closed:true,high:13,low:9,close:11}];
const state=()=>({countId:"COUNT-1",degreeId:"MICRO",activeWave:"W1",sequenceDirection:"UP",
 confirmationRule:{id:"STRUCTURE-W1",passed:true,countId:"COUNT-1",wave:"W1",evidenceBarId:"confirm",reversalBarId:"confirm"}});
const candidate=()=>({countId:"COUNT-1",degreeId:"MICRO",activeWave:"W1",sequenceDirection:"UP",
 side:"HIGH",price:16,sourceBarId:"pivot",sourceTimeframe:"5m",
 sourceTimestamp:"2026-10-11T12:05:00Z",evidenceConfirmedAt:"2026-10-11T12:10:00Z"});
test("verified W1 high produces count-bound proof, never a trade signal",()=>{
 const r=verify({degreeState:state(),candidate:candidate(),bars});
 assert.equal(r.verified,true);assert.equal(r.proof.anchorKey,"W1_HIGH");
 assert.equal(r.proof.sourceBarId,"confirm");
});
test("pivot without structural rule is never wave completion",()=>{
 const s=state();delete s.confirmationRule;
 assert.equal(verify({degreeState:s,candidate:candidate(),bars}).verified,false);
});
test("different count cannot reuse proof",()=>{
 const c=candidate();c.countId="OTHER";
 assert.equal(verify({degreeState:state(),candidate:c,bars}).verified,false);
});

test("external passed flag cannot override insufficient price reversal",()=>{
 const altered=structuredClone(bars);
 altered[2].close=14.5;
 const r=verify({degreeState:state(),candidate:candidate(),bars:altered});
 assert.equal(r.verified,false);
 assert.ok(r.reasonCodes.includes("MINIMUM_REVERSAL_NOT_CONFIRMED"));
});
test("unbound reversal bar cannot claim completion",()=>{
 const s=state();s.confirmationRule.reversalBarId="different-bar";
 assert.equal(verify({degreeState:s,candidate:candidate(),bars}).verified,false);
});
