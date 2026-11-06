import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {ownerApprovedWorkingSelection} from "../logic/engine22/wave/ownerApprovedWorkingSelectionV1.js";
const now=Date.parse("2026-11-06T04:00:00Z");
const raw=(price=7500)=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const run=(price,options={})=>applyOwnerPriceTouchesV1({
 currentWavelength:raw(price),currentPrice:price,
 previousWavelength:options.previous??null,
 bars10m:options.bars??[],storePath:options.storePath??null,
 evaluationTimeMs:options.at??now
});
test("Subminute research-only ABC C extensions use 315 A points and 7542 B high",()=>{
 const w=raw().degrees.subminute;
 const m=w.ownerSubminuteNov5AbcResearch;
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.deepEqual([m.anchors.aHigh,m.anchors.aLow,m.anchors.bHigh],[7735,7420,7542]);
 assert.deepEqual(m.levels.map(x=>x.price),[7347.25,7227,7141.25,7032.25,6912,6717.25]);
 assert.equal(m.reviewReference,7542);
 assert.equal(m.completionConfirmed,false);
 assert.equal(m.anchors.cLowAnchorApproved,false);
 assert.equal(m.noExecution,true);
 assert.equal(ownerApprovedWorkingSelection.degrees.subminute.key,"ownerSubminuteCDownOct31");
 assert.equal(w.ownerSubminuteCDownOct31.version,"engine22.subminuteCDownOct31OwnerWorking.v1");
});
test("cross-degree chart low only supports first touch after B, not C completion",()=>{
 const m=run(7500).degrees.subminute.ownerSubminuteNov5AbcResearch;
 assert.deepEqual(m.levels.map(x=>x.status),["TOUCHED","WATCH","WATCH","WATCH","WATCH","WATCH"]);
 assert.equal(m.levels[0].touchEvidenceType,"OWNER_CHART_OBSERVATION");
 assert.equal(m.levels[0].touchEvidence.verified,false);
 assert.equal(m.completionConfirmed,false);
});
test("do not look ahead to Nov 5 16:00 reference",()=>{
 const m=run(7500,{at:Date.parse("2026-11-05T18:00:00Z")}).degrees.subminute.ownerSubminuteNov5AbcResearch;
 assert.ok(m.levels.every(x=>x.status==="WATCH"));
});
test("retain eligible deeper touch after price rebounds and restart",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"sub-nov5-")),storePath=path.join(dir,"touches.json");
 try{
  const t=Math.floor(Date.parse("2026-11-05T22:00:00Z")/1000);
  const first=run(7500,{storePath,bars:[{time:t,high:7290,low:7200}]}).degrees.subminute.ownerSubminuteNov5AbcResearch;
  assert.equal(first.levels[1].status,"TOUCHED");
  assert.equal(first.levels[1].touchEvidence.verified,false);
  const after=run(7500,{storePath}).degrees.subminute.ownerSubminuteNov5AbcResearch;
  assert.equal(after.levels[1].status,"TOUCHED");
  assert.equal(after.levels[2].status,"WATCH");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
