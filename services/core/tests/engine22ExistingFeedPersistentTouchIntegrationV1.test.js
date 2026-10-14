import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {qualifyExistingEsBarsForFibTouchV1} from "../logic/engine22/research/qualifyExistingEsBarsForFibTouchV1.js";
import {persistSevenDegreeTouchPreviewV1} from "../logic/engine22/research/persistSevenDegreeTouchPreviewV1.js";
import {previewSevenDegreeTouchSnapshotV1} from "../logic/engine22/research/previewSevenDegreeTouchSnapshotV1.js";

const start=Math.floor(Date.parse("2026-10-14T14:40:00Z")/1000);
const model={activeWave:"W3",countId:"owner-1",modelKey:"model-1",seriesId:"ESZ6",
 priceBasis:"RAW_UNADJUSTED_CONTRACT",originAt:"2026-10-14T14:00:00Z",
 direction:"UP",levels:[{key:"e1000",price:7800,label:"1.000",status:"WATCH"}]};
const qualify=(bars)=>qualifyExistingEsBarsForFibTouchV1({bars,model,resolvedSymbol:"ESZ6",
 priceBasis:"RAW_UNADJUSTED_CONTRACT",timeframe:"10m",
 evaluationTimeMs:Date.parse("2026-10-14T15:00:00Z")});
test("existing ES candle -> durable Engine22 touch -> seven degree snapshot, across rebuild",()=>{
 const rootPath=fs.mkdtempSync(path.join(os.tmpdir(),"e22-full-chain-"));
 try {
  const first=qualify([{time:start,high:7800.25,low:7798.5}]);
  assert.equal(first.eligible,true);
  assert.equal(first.observations.length,1);
  const saved=persistSevenDegreeTouchPreviewV1({rootPath,degreeModels:{micro:model},
    observationsByDegree:{micro:first.observations}});
  const published=previewSevenDegreeTouchSnapshotV1({degreeModels:{micro:model},
    observationsByDegree:{micro:first.observations},persistentResults:saved});
  assert.equal(published.degrees.micro.levels[0].touchResearch.status,"TOUCHED");
  assert.equal(published.degrees.micro.levels[0].touchResearch.persisted,true);
  const later=qualify([{time:start,high:7790.25,low:7785}]);
  const savedAgain=persistSevenDegreeTouchPreviewV1({rootPath,degreeModels:{micro:model},
    observationsByDegree:{micro:later.observations}});
  const next=previewSevenDegreeTouchSnapshotV1({degreeModels:{micro:model},
    observationsByDegree:{micro:later.observations},persistentResults:savedAgain});
  assert.equal(next.degrees.micro.levels[0].touchResearch.status,"TOUCHED");
  assert.equal(next.degrees.micro.levels[0].touchResearch.firstTouchedBarId,`ESZ6:10m:${start}`);
  assert.equal(next.degrees.subminute.available,false);
 } finally {fs.rmSync(rootPath,{recursive:true,force:true});}
});
test("unknown resolved contract cannot create green touch",()=>{
 const bad=qualifyExistingEsBarsForFibTouchV1({bars:[{time:start,high:7810,low:7790}],
  model,resolvedSymbol:null,priceBasis:"RAW_UNADJUSTED_CONTRACT",timeframe:"10m",
  evaluationTimeMs:Date.parse("2026-10-14T15:00:00Z")});
 assert.equal(bad.eligible,false);assert.deepEqual(bad.observations,[]);
});
