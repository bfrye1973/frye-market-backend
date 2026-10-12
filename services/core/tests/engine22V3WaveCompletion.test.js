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
 altered[2].high=16;altered[2].close=14.5;
 altered[3].high=16;altered[3].close=15;
 const r=verify({degreeState:state(),candidate:candidate(),bars:altered});
 assert.equal(r.verified,false);
 assert.ok(r.reasonCodes.includes("MINIMUM_REVERSAL_NOT_CONFIRMED"));
});
test("unbound reversal bar cannot claim completion",()=>{
 const s=state();s.confirmationRule.reversalBarId="different-bar";
 assert.equal(verify({degreeState:s,candidate:candidate(),bars}).verified,false);
});

test("mixed timeframes cannot validate the same wave completion",()=>{
 const data=structuredClone(bars);data[3].timeframe="10m";
 const r=verify({degreeState:state(),candidate:candidate(),bars:data});
 assert.equal(r.verified,false);
 assert.ok(r.reasonCodes.includes("MIXED_TIMEFRAME_EVIDENCE"));
});
test("reversal bar must equal independently claimed confirmation bar",()=>{
 const s=state();s.confirmationRule.evidenceBarId="follow";
 const c=candidate();c.evidenceConfirmedAt=bars[3].sourceTimestamp;
 const r=verify({degreeState:s,candidate:c,bars});
 assert.equal(r.verified,false);
 assert.ok(r.reasonCodes.includes("CONFIRMATION_BAR_NOT_REVERSAL_BAR"));
});

test("W2 correction may not be confirmed using a bullish high pivot",()=>{
 const s=state();s.activeWave="W2";s.confirmationRule.wave="W2";
 const candidateHigh=candidate();candidateHigh.activeWave="W2";
 const r=verify({degreeState:s,candidate:candidateHigh,bars});
 assert.equal(r.verified,false);
 assert.ok(r.reasonCodes.includes("WAVE_PIVOT_SIDE_MISMATCH"));
});
