import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const base=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const priceRead=(price,opts={})=>applyOwnerPriceTouchesV1({
 currentWavelength:base(price),currentPrice:price,
 previousWavelength:opts.previous??null,bars10m:opts.bars??[],
 evaluationTimeMs:opts.at??Date.parse("2026-11-09T18:00:00Z"),
 storePath:opts.storePath??null,
});
test("Micro card new degree: formerly-blue W1/W2 exact owner anchors and fibs",()=>{
 const w=base(7540),m=w.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch;
 assert.equal(m.version,"engine22.ownerMicroW3Nov9ReclassifiedResearch.v1");
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.deepEqual([m.anchors.w1Low,m.anchors.w1High,m.anchors.w2Low],[7324,7469,7362]);
 assert.equal(m.anchors.w1LowLocalTime,"2026-11-05 15:20 AZ");
 assert.equal(m.anchors.w1HighLocalTime,"2026-11-06 07:40 AZ");
 assert.equal(m.anchors.w2LowLocalTime,"2026-11-08 16:00 AZ");
 assert.equal(m.anchors.w2LowAtUtc,"2026-11-08T23:00:00Z");
 assert.equal(m.anchors.priorAnchorRevision.w2LowLocalTime,"2026-11-08 15:00 AZ");
 assert.deepEqual(m.levels.map(l=>l.price),[7451.5,7507,7546.5,7596.5,7652,7741.5]);
 assert.equal(m.activeWave,"W5");
 assert.equal(m.anchors.w4Low,7492.25);
 assert.equal(m.anchors.w4LowLocalTime,"2026-11-10 10:40 AZ");
 assert.equal(m.anchors.w4LowAtUtc,"2026-11-10T17:40:00Z");
 assert.deepEqual(m.w5UpExtensionLevels.map(l=>[l.label,l.price]),[["0.618",7582],["1.000",7637.25],["1.272",7676.75],["1.618",7726.75],["2.000",7782.25],["2.618",7872]]);
 assert.ok(m.w5UpExtensionLevels.every(l=>l.status==="WATCH"&&l.provisional));
 assert.deepEqual(m.w4RetracementLevels.map(l=>[l.label,l.price]),[
  ["0.236",7543.75],["0.382",7509],["0.500",7481],
  ["0.618",7453],["0.786",7413],["1.000",7362]
 ]);
 assert(m.w4RetracementLevels.every(l=>l.status==="WATCH"&&l.provisional===true));
 assert.equal(m.anchors.w3High,7600);
 assert.equal(m.anchors.w3HighLocalTime,"2026-11-09 13:00 AZ");
 assert.equal(m.anchors.w3HighAtUtc,"2026-11-09T20:00:00Z");
 assert.equal(m.completionConfirmed,false);
});
test("Submicro black internal W1/W2 owner anchors and W3 ES quarter tick extensions",()=>{
 const w=base(7540),m=w.degrees.submicro.ownerSubmicroW3Nov9InternalResearch;
 assert.equal(m.version,"engine22.ownerSubmicroW3Nov9InternalResearch.v1");
 assert.equal(m.anchors.w1Low,7390.25);
 assert.equal(m.anchors.w1LowLocalTime,"2026-11-09 01:00 AZ");
 assert.equal(m.anchors.w1High,7476);
 assert.equal(m.anchors.w1HighLocalTime,"2026-11-09 06:00 AZ");
 assert.equal(m.anchors.w2Low,7449.25);
 assert.equal(m.anchors.w2LowLocalTime,"2026-11-09 06:20 AZ");
 assert.equal(m.anchors.w2LowAtUtc,"2026-11-09T13:20:00Z");
 assert.equal(m.anchors.w1Length,85.75);
 assert.equal(m.activeWave,"W1");
 assert.equal(m.anchors.cLow,7492.25);
 assert.equal(m.anchors.cLowLocalTime,"2026-11-10 10:40 AZ");
 assert.equal(m.anchors.cLowAtUtc,"2026-11-10T17:40:00Z");
 assert.equal(m.anchors.w1StartLow,7492.25);
 assert.equal(m.anchors.newW1High,null);
 assert.deepEqual(m.w1UpReferenceLevels.map(l=>[l.label,l.price]),[["0.618",7545.25],["1.000",7578],["1.272",7601.25],["1.618",7631],["2.000",7663.75],["2.618",7716.75]]);
 assert.ok(m.w1UpReferenceLevels.every(l=>l.status==="WATCH"&&l.provisional));
 assert.deepEqual(m.cDownExtensionLevels.map(l=>[l.label,l.price]),[
  ["0.618",7508.75],["1.000",7473.25],["1.272",7448],
  ["1.618",7416],["2.000",7380.5],["2.618",7323.25]
 ]);
 assert(m.cDownExtensionLevels.every(l=>l.status==="WATCH"&&l.provisional===true));
 assert.equal(m.anchors.aHigh,7600);
 assert.equal(m.anchors.aHighLocalTime,"2026-11-09 13:00 AZ");
 assert.equal(m.anchors.aLow,7507.25);
 assert.equal(m.anchors.aLowLocalTime,"2026-11-10 06:40 AZ");
 assert.equal(m.anchors.bHigh,7566);
 assert.equal(m.anchors.bHighLocalTime,"2026-11-10 08:00 AZ");
 assert.deepEqual(m.levels.map(l=>l.price),[7502.25,7535,7558.25,7588,7620.75,7673.75]);
 assert.equal(m.noExecution,true);
 assert.equal(m.nextWaveStarted,false);
});
test("No pre-W2 touch, even with high price; W3 touches are separate per degree",()=>{
 const early=priceRead(8000,{at:Date.parse("2026-11-08T21:50:00Z")});
 assert.ok(early.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.levels.every(l=>l.status==="WATCH"));
 assert.ok(early.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.levels.every(l=>l.status==="WATCH"));
 const beforeSubmicro=priceRead(8000,{at:Date.parse("2026-11-09T13:10:00Z")});
 assert.ok(beforeSubmicro.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.levels.every(l=>l.status==="WATCH"));
 const at=priceRead(7540);
 assert.deepEqual(at.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.levels.map(l=>l.status),["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
 assert.deepEqual(at.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.levels.map(l=>l.status),["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
});
test("Post-W2 completed candle touches persist without importing old blue Submicro journal",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"micro-submicro-redegree-"));
 try{
 const storePath=path.join(dir,"touch.json");
 const time=Math.floor(Date.parse("2026-11-09T15:00:00Z")/1000);
 const a=priceRead(7440,{storePath,bars:[{time,low:7430,high:7590}]});
 assert.deepEqual(a.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.levels.map(l=>l.status),["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH"]);
 assert.deepEqual(a.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.levels.map(l=>l.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH"]);
 const b=priceRead(7440,{storePath});
 assert.equal(b.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.levels[3].status,"TOUCHED");
 assert.equal(b.degrees.submicro.ownerSubmicroW3Nov9InternalResearch.levels[3].touchEvidence.verified,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("Old scenarios and canonical owner selection revision 6 untouched",()=>{
 const w=base(7540);
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
 assert.equal(ownerApprovedWorkingSelection.degrees.micro.key,"ownerMicroCDownOct31");
 assert.equal(ownerApprovedWorkingSelection.degrees.submicro.key,"ownerSubmicroCDownNov2");
 assert.equal(w.degrees.submicro.ownerSubmicroW3Nov9Research.version,"engine22.submicroW3Nov9Research.v1");
 assert.equal(w.degrees.micro.ownerMicroW2Nov6Research.version,"engine22.microW2Nov6Research.v1");
 assert.equal(w.degrees.minor.ownerMinorW3Nov9Research.version,"engine22.minorW3Nov9Research.v1");
});
