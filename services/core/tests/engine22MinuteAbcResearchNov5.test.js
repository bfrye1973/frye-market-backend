import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const observedAt=Date.parse("2026-11-06T02:30:00Z");
const model=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const apply=(price,opts={})=>applyOwnerPriceTouchesV1({
  currentWavelength:model(price),previousWavelength:opts.previous??null,
  currentPrice:price,bars10m:opts.bars??[],evaluationTimeMs:opts.at??observedAt,
  storePath:opts.storePath??null
});
test("Minute ABC research anchored correctly, C fibs are A-length projections from B",()=>{
 const m=model(7500).degrees.minute.ownerMinuteAbcResearch;
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.equal(m.anchors.aHigh,7901.75);
 assert.equal(m.anchors.aLow,7575.25);
 assert.equal(m.anchors.bHigh,7890.25);
 assert.equal(m.anchors.cObservedCandidateLow,7322.25);
 assert.equal(m.anchors.cCandidateAtUtc,"2026-11-05T23:00:00Z");
 assert.deepEqual(m.levels.map(x=>x.price),[7688.5,7563.75,7475,7362,7237.25,7035.5]);
 assert.equal(m.completionConfirmed,false);
 assert.equal(m.officialInvalidation,null);
 assert.equal(m.reviewReference,7890.25);
});
test("owner-chart Nov 5 low touches four levels but never verifies C completion",()=>{
 const m=apply(7800).degrees.minute.ownerMinuteAbcResearch;
 assert.deepEqual(m.levels.map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH"]);
 for(const l of m.levels.slice(0,4)){
   assert.equal(l.touchEvidenceType,"OWNER_CHART_OBSERVATION");
   assert.equal(l.touchEvidence.verified,false);
 }
 assert.equal(m.completionConfirmed,false);
});
test("no lookahead to future owner-chart evidence",()=>{
 const m=apply(7800,{at:Date.parse("2026-10-20T00:00:00Z")}).degrees.minute.ownerMinuteAbcResearch;
 assert.ok(m.levels.every(l=>l.status==="WATCH"));
});
test("Minute ABC deeper candle-sourced touch persists through restart while original Minute W2 is preserved",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"minute-abc-")),storePath=path.join(dir,"touches.json");
 try{
   const time=Math.floor(Date.parse("2026-11-05T23:30:00Z")/1000);
   const first=apply(7800,{storePath,bars:[{time,high:7380,low:7200}]}).degrees.minute.ownerMinuteAbcResearch;
   assert.equal(first.levels[4].status,"TOUCHED");
   assert.equal(first.levels[5].status,"WATCH");
   assert.equal(first.levels[4].touchEvidenceType,"ES_10M_COMPLETED_OHLC");
   assert.equal(first.levels[4].touchEvidence.verified,false);
   const recovered=apply(7800,{storePath}).degrees.minute.ownerMinuteAbcResearch;
   assert.equal(recovered.levels[4].status,"TOUCHED");
   assert.equal(recovered.levels[4].touchEvidenceType,"ES_10M_COMPLETED_OHLC");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
 const raw=model(7800);
 assert.equal(raw.degrees.minute.ownerMinuteW2Retracement.version,"engine22.minuteW2RetracementOwner.v1");
 assert.equal(raw.degrees.minute.ownerLargerCDownScenario.version,"engine22.largerCorrectionCDownWatch.v1");
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
 assert.equal(ownerApprovedWorkingSelection.degrees.minute.key,"ownerMinuteW2Retracement");
 assert.equal(raw.degrees.minor.ownerMinorW2Research.version,"engine22.minorW2ResearchCardNov5.v1");
});
