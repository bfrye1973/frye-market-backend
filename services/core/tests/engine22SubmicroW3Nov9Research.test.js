import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const base=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const check=(price,opts={})=>applyOwnerPriceTouchesV1({
 currentWavelength:base(price),currentPrice:price,
 previousWavelength:opts.previous??null,bars10m:opts.bars??[],
 evaluationTimeMs:opts.at??Date.parse("2026-11-09T18:00:00Z"),
 storePath:opts.storePath??null,
});
test("Nov 9 Submicro W1/W2 timestamps and exact W3 upward ES Fib ladder",()=>{
 const m=base(7400).degrees.submicro.ownerSubmicroW3Nov9Research;
 assert.equal(m.version,"engine22.submicroW3Nov9Research.v1");
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.equal(m.anchors.w1Low,7324);
 assert.equal(m.anchors.w1LowLocalTime,"2026-11-05 15:20 AZ");
 assert.equal(m.anchors.w1High,7469);
 assert.equal(m.anchors.w1HighLocalTime,"2026-11-06 07:40 AZ");
 assert.equal(m.anchors.w2Low,7362);
 assert.equal(m.anchors.w2LowLocalTime,"2026-11-08 15:00 AZ");
 assert.equal(m.anchors.w2LowAtUtc,"2026-11-08T22:00:00Z");
 assert.equal(m.anchors.w1Length,145);
 assert.equal(m.fibMethod,"W3_UP_W2_LOW_PLUS_W1_LENGTH_TIMES_RATIO");
 assert.deepEqual(m.levels.map(x=>x.price),[7451.5,7507,7546.5,7596.5,7652,7741.5]);
 assert.equal(m.nextWaveStarted,false);
 assert.equal(m.completionConfirmed,false);
 assert.equal(m.noExecution,true);
});
test("W3 cannot be touched before W2 low, even when price would exceed extension",()=>{
 const result=check(7800,{at:Date.parse("2026-11-08T21:50:00Z")});
 assert.ok(result.degrees.submicro.ownerSubmicroW3Nov9Research.levels.every(l=>l.status==="WATCH"));
});
test("Post-W2 prices touch W3 extensions from above; no false lower-level pre-W2 touches",()=>{
 const result=check(7550);
 const levels=result.degrees.submicro.ownerSubmicroW3Nov9Research.levels;
 assert.deepEqual(levels.map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH"]);
 assert.equal(levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
 assert.equal(levels[0].touchEvidence.verified,false);
 assert.equal(result.degrees.submicro.ownerSubmicroNov6AbcResearch.version,"engine22.submicroNov6AbcResearch.v1");
});
test("10m completed candle touch stays green after quote falls back, separate old models",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"submicro-w3-"));
 const storePath=path.join(dir,"touch.json");
 try{
  const time=Math.floor(Date.parse("2026-11-09T15:00:00Z")/1000);
  const one=check(7400,{storePath,bars:[{time,low:7400,high:7600}]}).degrees.submicro.ownerSubmicroW3Nov9Research;
  assert.deepEqual(one.levels.map(l=>l.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH"]);
  const two=check(7400,{storePath}).degrees.submicro.ownerSubmicroW3Nov9Research;
  assert.equal(two.levels[3].status,"TOUCHED");
  assert.equal(two.levels[4].status,"WATCH");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("Canonical Submicro C selection, Oct/Nov ABC, Micro and higher waves not replaced",()=>{
 const w=base(7400);
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
 assert.equal(ownerApprovedWorkingSelection.degrees.submicro.key,"ownerSubmicroCDownNov2");
 assert.equal(w.degrees.submicro.ownerSubmicroCDownNov2.version,"engine22.submicroCDownNov2OwnerWorking.v1");
 assert.equal(w.degrees.submicro.ownerSubmicroNov6AbcResearch.version,"engine22.submicroNov6AbcResearch.v1");
 assert.equal(w.degrees.micro.ownerMicroW2Nov6Research.version,"engine22.microW2Nov6Research.v1");
 assert.equal(w.degrees.minute.ownerMinuteAbcResearch.version,"engine22.minuteAbcDownNov5Research.v1");
});
