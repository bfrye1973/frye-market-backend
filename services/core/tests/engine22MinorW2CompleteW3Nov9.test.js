import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const wave=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const apply=(price,opts={})=>applyOwnerPriceTouchesV1({
 currentWavelength:wave(price),currentPrice:price,previousWavelength:opts.previous??null,
 bars10m:opts.bars??[],evaluationTimeMs:opts.at??Date.parse("2026-11-09T20:00:00Z"),
 storePath:opts.storePath??null
});
test("Owner Minor W2 completed anchor and W3 targets match owner direction and exact tick rounding",()=>{
 const m=wave(7515).degrees.minor.ownerMinorW3Nov9Research;
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.equal(m.anchors.w1Low,6485);
 assert.equal(m.anchors.w1High,7901.75);
 assert.equal(m.anchors.w1Length,1416.75);
 assert.equal(m.anchors.w2EndingLow,7322.25);
 assert.equal(m.anchors.w2EndingLocalTime,"2026-11-05 16:00 AZ");
 assert.equal(m.anchors.w2EndingAtUtc,"2026-11-05T23:00:00Z");
 assert.equal(m.w2CompletionConfirmedByOwner,true);
 assert.equal(m.activeWave,"W3");
 assert.equal(m.direction,"UP");
 assert.deepEqual(m.levels.map(l=>l.price),[8197.75,8739,9124.25,9614.5,10155.75,11031.25]);
 assert.equal(m.noExecution,true);
});
test("No-lookahead W3 touches before owner W2 pivot",()=>{
 const m=apply(12000,{at:Date.parse("2026-11-05T22:50:00Z")}).degrees.minor.ownerMinorW3Nov9Research;
 assert.ok(m.levels.every(l=>l.status==="WATCH"));
});
test("Upward completed candle touched level remains touched after price retreat",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"minor-w3-fibs-"));
 try {
  const storePath=path.join(dir,"touch.json"),time=Math.floor(Date.parse("2026-11-09T16:00:00Z")/1000);
  const first=apply(7500,{storePath,bars:[{time,low:7495,high:9000}]}).degrees.minor.ownerMinorW3Nov9Research;
  assert.deepEqual(first.levels.map(l=>l.status),["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
  const later=apply(7500,{storePath}).degrees.minor.ownerMinorW3Nov9Research;
  assert.equal(later.levels[1].status,"TOUCHED");
  assert.equal(later.levels[1].touchEvidence.verified,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("Minor previous retracements, old W5 selection, other degrees unchanged",()=>{
 const w=wave(7500);
 assert.equal(ownerApprovedWorkingSelection.selectionRevision,6);
 assert.equal(ownerApprovedWorkingSelection.degrees.minor.source,"degreeStates");
 assert.equal(w.degrees.minor.activeWave,"W5");
 assert.equal(w.degrees.minor.ownerMinorW2Research.version,"engine22.minorW2ResearchCardNov5.v1");
 assert.equal(w.degrees.micro.ownerMicroW2Nov6Research.version,"engine22.microW2Nov6Research.v1");
 assert.equal(w.degrees.submicro.ownerSubmicroW3Nov9Research.version,"engine22.submicroW3Nov9Research.v1");
});
