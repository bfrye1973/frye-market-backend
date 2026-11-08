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
  evaluationTimeMs:opts.at??Date.parse("2026-11-08T18:00:00Z"),
  storePath:opts.storePath??null
});
test("Micro Nov6 W1 148-point research: exact owner anchors, seven W2 retracements",()=>{
 const m=base(7460).degrees.micro.ownerMicroW2Nov6Research;
 assert.equal(m.version,"engine22.microW2Nov6Research.v1");
 assert.equal(m.anchors.w1Low,7321.75);
 assert.equal(m.anchors.w1High,7469.75);
 assert.equal(m.anchors.w1HighLocalTime,"2026-11-06 07:50 AZ");
 assert.deepEqual(m.levels.map(x=>x.price),[7434.75,7413.25,7395.75,7378.25,7353.5,7338.5,7321.75]);
 assert.equal(m.structuralReference,7321.75);
 assert.equal(m.nextWaveStarted,false);
 assert.equal(m.noExecution,true);
});
test("Submicro Nov6 A 73 points B 7436.75: exactly six down extensions",()=>{
 const s=base(7450).degrees.submicro.ownerSubmicroNov6AbcResearch;
 assert.deepEqual([s.anchors.aHigh,s.anchors.aLow,s.anchors.bHigh],[7469.75,7396.75,7436.75]);
 assert.deepEqual(s.levels.map(x=>x.price),[7391.75,7363.75,7344,7318.75,7290.75,7245.75]);
 assert.equal(s.anchors.cLow,null);
 assert.equal(s.reviewReference,7436.75);
 assert.equal(s.completionConfirmed,false);
});
test("No lookahead: Submicro A low does not count as a later C extension touch",()=>{
 const s=check(7420,{at:Date.parse("2026-11-06T17:00:00Z")}).degrees.submicro.ownerSubmicroNov6AbcResearch;
 assert.ok(s.levels.every(x=>x.status==="WATCH"));
});
test("Eligible Micro W2 quotes touch levels with snapshot provenance, no unverified confirmation",()=>{
 const m=check(7393.25).degrees.micro.ownerMicroW2Nov6Research;
 assert.deepEqual(m.levels.map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
 assert.equal(m.levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
 assert.equal(m.levels[0].touchEvidence.verified,false);
 const s=check(7393.25).degrees.submicro.ownerSubmicroNov6AbcResearch;
 assert.ok(s.levels.every(x=>x.status==="WATCH"));
});
test("Submicro touches persist independently after post-B eligible new low",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"micro-sub-nov6-"));
 const storePath=path.join(dir,"touches.json");
 try{
 const t=Math.floor(Date.parse("2026-11-06T21:00:00Z")/1000);
 const first=check(7450,{storePath,bars:[{time:t,low:7380,high:7450}]}).degrees.submicro.ownerSubmicroNov6AbcResearch;
 assert.equal(first.levels[0].status,"TOUCHED");
 assert.equal(first.levels[1].status,"WATCH");
 assert.equal(first.levels[0].touchEvidence.verified,false);
 const later=check(7450,{storePath}).degrees.submicro.ownerSubmicroNov6AbcResearch;
 assert.equal(later.levels[0].status,"TOUCHED");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("Old owner selections, older Fibonacci models, higher degrees preserved",()=>{
 const w=base(7400);
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
 assert.equal(ownerApprovedWorkingSelection.degrees.micro.key,"ownerMicroCDownOct31");
 assert.equal(ownerApprovedWorkingSelection.degrees.submicro.key,"ownerSubmicroCDownNov2");
 assert.equal(w.degrees.micro.ownerMicroCDownOct31.version,"engine22.microCDownOct31OwnerWorking.v1");
 assert.equal(w.degrees.submicro.ownerSubmicroCDownNov2.version,"engine22.submicroCDownNov2OwnerWorking.v1");
 assert.equal(w.degrees.minute.ownerMinuteAbcResearch.version,"engine22.minuteAbcDownNov5Research.v1");
 assert.equal(w.degrees.minor.ownerMinorW2Research.version,"engine22.minorW2ResearchCardNov5.v1");
});
