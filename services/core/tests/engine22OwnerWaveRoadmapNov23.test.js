import test from "node:test";
import assert from "node:assert/strict";
import {buildOwnerWaveRoadmapV1} from "../logic/engine22/wave/buildOwnerWaveRoadmapV1.js";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildEngine6AdvisoryContext} from "../logic/engine6/6b-market-intelligence/buildEngine6AdvisoryContext.js";

const asOf=Date.parse("2026-11-24T06:15:00Z");
test("Primary W5 approved formula uses original W1 length and ES quarter-point rounding",()=>{
 const a=buildOwnerWaveRoadmapV1({symbol:"ES",evaluationTimeMs:asOf});
 assert.deepEqual(a.primary.levels.map(x=>x.price),[8361.25,9265,9908.50,10727.25,11631,13093.25]);
 assert.equal(a.primary.w1.length,2366);
 assert.ok(a.primary.levels.every(x=>x.status==="WATCH"&&x.provisional&&x.touchEvidenceAvailable===false));
 assert.equal(a.noExecution,true);
});
test("Intermediate W1 uses prior Primary correction retracement, not historical W1 proxy",()=>{
 const a=buildOwnerWaveRoadmapV1({symbol:"ES",evaluationTimeMs:asOf});
 assert.equal(a.intermediate.firstW1EndHigh,null);
 assert.deepEqual(a.intermediate.levels.map(x=>x.price),[7131.75,7275.75,7392,7508.25,7674,7885]);
 assert.equal(a.intermediate.parentWave,"W5");
});
test("Micro W1 cannot publish a fabricated high, completion or W2 Fib target",()=>{
 const a=buildOwnerWaveRoadmapV1({symbol:"ES",evaluationTimeMs:asOf});
 assert.equal(a.micro.observedReferenceHigh.price,7313.25);
 assert.equal(a.micro.endingHigh,null);
 assert.equal(a.micro.startingLow,null);
 assert.equal(a.micro.completionConfirmed,false);
 assert.deepEqual(a.micro.levels,[]);
 assert.equal(a.submicro.direction,"NEUTRAL");
});
test("Owner revisions are not retroactively available or cross-symbol",()=>{
 assert.equal(buildOwnerWaveRoadmapV1({symbol:"ES",evaluationTimeMs:Date.parse("2026-11-23T20:00:00Z")}),null);
 assert.equal(buildOwnerWaveRoadmapV1({symbol:"ES"}),null);
 assert.equal(buildOwnerWaveRoadmapV1({symbol:"SPY",evaluationTimeMs:asOf}),null);
});
test("Engine6 sees research UP context without entry, sizing or veto authority",()=>{
 const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7272.25,evaluationTimeMs:asOf});
 const snapshot={symbol:"ES",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{currentWavelength}}}};
 const x=buildEngine6AdvisoryContext({snapshot});
 assert.equal(x.wave.ownerWaveRoadmap.available,true);
 assert.equal(x.wave.ownerWaveRoadmap.primary.direction,"UP");
 assert.equal(x.wave.ownerWaveRoadmap.intermediate.activeWave,"W1");
 assert.equal(x.wave.ownerWaveRoadmap.micro.completionConfirmed,false);
 assert.equal(x.wave.ownerWaveRoadmap.submicro.direction,"NEUTRAL");
 assert.equal(x.wave.ownerWaveRoadmap.noEntryPermission,true);
 assert.equal(x.wave.ownerWaveRoadmap.noVeto,true);
 assert.equal(x.noPermissionCreated,true);
 assert.equal(x.noEntryVeto,true);
 assert.equal(x.wave.available,false);
});
