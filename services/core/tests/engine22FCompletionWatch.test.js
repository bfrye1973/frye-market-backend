import test from "node:test";
import assert from "node:assert/strict";
import {evaluateEngine22CompletionWatch as run} from "../logic/engine22/completion/evaluateCompletionWatch.js";
const ctx={degreeId:"MICRO",countId:"COUNT-ES-MICRO-01",lifecycle:"DEVELOPING",minimumReversalTicks:8,tickSize:0.25};
const bars=[
 {sourceBarId:"a",sourceTimestamp:"2026-10-26T14:00:00Z",closed:true,timeframe:"5m",high:100,low:97,close:99},
 {sourceBarId:"b",sourceTimestamp:"2026-10-26T14:05:00Z",closed:true,timeframe:"5m",high:103,low:99,close:102},
 {sourceBarId:"c",sourceTimestamp:"2026-10-26T14:10:00Z",closed:true,timeframe:"5m",high:99,low:96,close:97},
 {sourceBarId:"d",sourceTimestamp:"2026-10-26T14:15:00Z",closed:true,timeframe:"5m",high:98,low:95,close:96},
];
const target={countId:ctx.countId,levelKey:"r500",touched:true,sourceBarId:"b"};
const pivot={countId:ctx.countId,degreeId:"MICRO",side:"HIGH",price:103,sourceBarId:"b",sourceTimestamp:bars[1].sourceTimestamp,evidenceConfirmedAt:bars[2].sourceTimestamp};
test("target touch opens watch without completion or permission",()=>{
 const a=run({degreeState:ctx,bars,targetObservation:target});
 assert.equal(a.status,"TARGET_REACHED_WATCH");assert.equal(a.waveCompletionConfirmed,false);assert.equal(a.publishAuthorized,false);
});
test("completed reversal and matching pivot yield only completion CANDIDATE",()=>{
 const a=run({degreeState:ctx,bars,targetObservation:target,candidate:pivot});
 assert.equal(a.status,"COMPLETION_CANDIDATE");assert.equal(a.countTransitionAuthorized,false);
});
test("no target or reversal stays developing",()=>assert.equal(run({degreeState:ctx,bars}).status,"DEVELOPING"));
test("watch persists across lookback gaps without flip flop",()=>{
 const a=run({degreeState:ctx,bars,targetObservation:target});
 const b=run({degreeState:ctx,bars,previous:a});
 assert.equal(b.status,"TARGET_REACHED_WATCH");
});
test("forming bars, synthetic identity and duplicate bars fail closed",()=>{
 assert.equal(run({degreeState:ctx,bars:[...bars.slice(0,2),{...bars[2],closed:false},bars[3]]}).available,false);
 assert.equal(run({degreeState:{...ctx,countId:"ES-V3-BASELINE-MICRO"},bars}).available,false);
 assert.equal(run({degreeState:ctx,bars:[...bars,bars[3]]}).available,false);
});
test("rejected and locked state cannot silently reopen",()=>{
 assert.equal(run({degreeState:{...ctx,lifecycle:"LOCKED"},bars}).available,false);
 assert.equal(run({degreeState:ctx,bars,previous:{status:"REJECTED",countId:ctx.countId,degreeId:ctx.degreeId}}).available,false);
});
test("inputs are immutable",()=>{
 const input={degreeState:ctx,bars,targetObservation:target,candidate:pivot};
 const before=structuredClone(input);run(input);assert.deepEqual(input,before);
});
