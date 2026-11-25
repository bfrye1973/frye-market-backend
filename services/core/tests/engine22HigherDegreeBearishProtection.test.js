import test from "node:test";
import assert from "node:assert/strict";
import {buildHigherDegreeBearishProtectionV1 as build} from "../logic/engine22/wave/buildHigherDegreeBearishProtectionV1.js";
const H=3600000,D=86400000, now=Date.parse("2026-10-23T20:00:00Z");
const bar=(time,close,extra={})=>({time:new Date(time).toISOString(),close,...extra});
const run=(hourCloses,dailyCloses,opts={})=>build({symbol:"ES",evaluationTimeMs:now,barsByTf:{
 "4h":hourCloses.map((v,i)=>bar(now-16*H+i*4*H,v)),
 "1d":dailyCloses.map((v,i)=>bar(now-4*D+i*D,v)),
},...opts});
test("Intermediate uses two COMPLETED 4h closes and Primary two completed daily closes",()=>{
 let a=run([7300,7199],[7300,7198]);
 assert.equal(a.degrees.intermediate.status,"WARNING");
 assert.equal(a.degrees.primary.status,"WARNING");
 a=run([7190,7199],[7190,7198]);
 assert.equal(a.degrees.intermediate.status,"BEARISH_RISK_CONFIRMED");
 assert.equal(a.degrees.primary.status,"MAJOR_BEARISH_RISK");
 assert.equal(a.noStructuralInvalidation,true);
 assert.equal(a.degrees.primary.structuralInvalidated,false);
 assert.equal(a.degrees.intermediate.structuralReference,6407);
 assert.equal(a.degrees.primary.structuralReference,5182);
});
test("prices above warning do not trigger, and deeper than 6800 escalates risk",()=>{
 const a=run([7190,7210],[7190,7210]);
 assert.equal(a.degrees.intermediate.status,"BULLISH_STRUCTURE_ABOVE_WARNING");
 assert.equal(a.degrees.primary.status,"BULLISH_STRUCTURE_ABOVE_WARNING");
 const b=run([7190,6799],[7190,6799]);
 assert.equal(b.degrees.intermediate.status,"HIGH_BEARISH_RISK");
 assert.equal(b.degrees.primary.status,"HIGH_BEARISH_RISK");
});
test("forming and future bars cannot trigger; stale sources fail closed",()=>{
 const forming=run([7310,7290],[7300,7295]);
 const data=run([7190,7191],[7190,7191],{barsByTf:{
 "4h":[bar(now-8*H,7190),bar(now,7191)],
 "1d":[bar(now-D,7190),bar(now+H,7191)],
 }});
 assert.equal(forming.degrees.intermediate.status,"BULLISH_STRUCTURE_ABOVE_WARNING");
 assert.equal(data.degrees.intermediate.status,"WARNING");
 assert.equal(data.degrees.primary.status,"WARNING");
 const stale=build({symbol:"ES",evaluationTimeMs:now,barsByTf:{
 "4h":[bar(now-100*H,7100),bar(now-96*H,7000)],
 "1d":[bar(now-30*D,7100),bar(now-29*D,7000)],
 }});
 assert.equal(stale.degrees.intermediate.status,"UNCONFIRMED");
 assert.equal(stale.degrees.primary.status,"UNCONFIRMED");
});
test("missing series and non-ES never assert bearish risk",()=>{
 const missing=build({symbol:"ES",evaluationTimeMs:now});
 assert.equal(missing.degrees.intermediate.status,"UNCONFIRMED");
 assert.equal(missing.degrees.primary.status,"UNCONFIRMED");
 assert.equal(build({symbol:"SPY",evaluationTimeMs:now}).available,false);
});
