import test from "node:test";import assert from "node:assert/strict";
import {evaluateEngine22ZoneBaseBreakoutWatch as run} from "../logic/engine22/completion/evaluateZoneBaseBreakoutWatch.js";
const bar=(i,o,h,l,c)=>({sourceBarId:"ESZ6-10m-"+i,sourceTimestamp:new Date(Date.UTC(2026,9,26,13,i*10)).toISOString(),
  timeframe:"10m",closed:true,sourceVendor:"FIXTURE",sourceContract:"ESZ6",
  sourceSeriesId:"TEST-ES-UNADJUSTED",open:o,high:h,low:l,close:c});
const base=[bar(0,7664,7669,7659,7665),bar(1,7665,7668,7660,7666),bar(2,7666,7670,7662,7668),
 bar(3,7668,7669,7660,7664),bar(4,7664,7668,7658,7665)];
const breakout=bar(5,7666,7681,7665,7678);
const zone={zoneId:"PREEXISTING-ZONE-1",sourceVersion:"engine26.zone.fixture.v1",low:7655,high:7670,establishedAt:"2026-10-26T12:50:00Z"};
const input={degreeId:"MICRO",countId:"ORIGINAL-COUNT-MICRO",expectedSequenceDirection:"DOWN",
  zone,bars10m:[...base,breakout]};
test("5 completed 10m closes inside established zone then strong breakout opens EARLY watch",()=>{
 const r=run(input);assert.equal(r.available,true);assert.equal(r.status,"C_COMPLETION_EARLY_WATCH");
 assert.equal(r.evidence.breakoutBarId,breakout.sourceBarId);
 assert.equal(r.cCompletionConfirmed,false);assert.equal(r.countTransitionAuthorized,false);
});
test("same first breakout has stable identity and does not create duplicate event",()=>{
 const x=run(input),y=run({...input,previous:x});
 assert.equal(y.status,"C_COMPLETION_EARLY_WATCH");
 assert.ok(y.reasonCodes.includes("REPEATED_OBSERVATION_NO_NEW_EVENT"));
});
test("wick-only breakout or insufficient body does not trigger completion watch",()=>{
 assert.equal(run({...input,bars10m:[...base,bar(5,7666,7682,7662,7669)]}).status,"BASE_ESTABLISHED");
 assert.equal(run({...input,bars10m:[...base,bar(5,7670,7672,7668,7671)]}).status,"BASE_ESTABLISHED");
});
test("unqualified base, same-size reversal and down breakout fail watch",()=>{
 const inconsistent=[...base.slice(0,3),bar(3,7650,7653,7645,7651),base[4],breakout];
 assert.equal(run({...input,bars10m:inconsistent}).status,"NO_QUALIFIED_BASE");
 assert.equal(run({...input,bars10m:[...base,bar(5,7660,7661,7640,7642)]}).status,"BASE_ESTABLISHED");
});
test("future/current forming candles, missing intervals, changed contracts fail closed",()=>{
 assert.equal(run({...input,bars10m:[...base,{...breakout,closed:false}]}).available,false);
 assert.equal(run({...input,bars10m:[...base.slice(0,3),base[4],breakout]}).available,false);
 assert.equal(run({...input,bars10m:[...base,{...breakout,sourceContract:"ESH7"}]}).available,false);
});
test("zone cannot be invented after consolidation started",()=>{
 assert.equal(run({...input,zone:{...zone,establishedAt:"2026-10-26T14:00:00Z"}}).available,false);
 assert.equal(run({...input,zone:{...zone,sourceVersion:null}}).available,false);
});
test("no source count identity or synthetic baseline ID means no watch",()=>{
 assert.equal(run({...input,countId:null}).available,false);
 assert.equal(run({...input,countId:"ES-V3-BASELINE-MICRO"}).available,false);
});
test("all inputs remain immutable",()=>{const copy=structuredClone(input);run(input);assert.deepEqual(input,copy);});
