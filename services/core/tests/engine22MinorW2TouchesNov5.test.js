import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
const now=Date.parse("2026-11-06T02:30:00Z");
const base=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const apply=(price,opts={})=>applyOwnerPriceTouchesV1({
  currentWavelength:base(price),previousWavelength:opts.previous??null,
  currentPrice:price,bars10m:opts.bars??[],evaluationTimeMs:opts.at??now,
  storePath:opts.storePath??null
}).degrees.minor.ownerMinorW2Research;
test("owner Nov 5 low marks only first 2 Minor W2 retracements GREEN as unverified owner-chart evidence",()=>{
  const levels=apply(7700).levels;
  assert.deepEqual(levels.map(l=>l.status),["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH","WATCH"]);
  for(const l of levels.slice(0,2)){
    assert.equal(l.touchEvidenceAvailable,true);
    assert.equal(l.touchEvidenceType,"OWNER_CHART_OBSERVATION");
    assert.equal(l.touchEvidence?.verified,false);
    assert.equal(l.touchedAt,null);
  }
});
test("Minor touches persist after price recovers and survive a restart",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"minor-w2-fibs-")),file=path.join(dir,"touches.json");
  try {
    const first=apply(7000,{storePath:file});
    assert.deepEqual(first.levels.slice(0,5).map(l=>l.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH"]);
    const later=apply(7800,{storePath:file});
    assert.deepEqual(later.levels.slice(0,5).map(l=>l.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH"]);
    assert.equal(later.levels[3].touchEvidenceType,"ES_CURRENT_PRICE");
    assert.equal(later.levels[3].touchEvidence?.verified,false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test("No future owner chart touches before Nov 5 research observation date",()=>{
  const levels=apply(7800,{at:Date.parse("2026-09-01T20:00:00Z")}).levels;
  assert.ok(levels.every(l=>l.status==="WATCH"));
});
test("Completed ES candles may observe deeper levels but unverified price basis is not a verified touch",()=>{
  const t=Math.floor(Date.parse("2026-11-05T22:00:00Z")/1000);
  const levels=apply(7800,{bars:[{time:t,high:7500,low:7010}]}).levels;
  assert.equal(levels[3].status,"TOUCHED");
  assert.equal(levels[3].touchEvidenceType,"ES_10M_COMPLETED_OHLC");
  assert.equal(levels[3].touchEvidence.verified,false);
  assert.equal(levels[4].status,"WATCH");
});
test("Original Minor W5 selection and fibs stay distinct",()=>{
 const w=base(7325),out=applyOwnerPriceTouchesV1({currentWavelength:w,currentPrice:7325,evaluationTimeMs:now});
 assert.equal(out.degrees.minor.state,"MINOR_W5_ACTIVE_CANDIDATE");
 assert.equal(out.degrees.minor.activeWave,"W5");
 assert.deepEqual(out.degrees.minor.levels,w.degrees.minor.levels);
});
