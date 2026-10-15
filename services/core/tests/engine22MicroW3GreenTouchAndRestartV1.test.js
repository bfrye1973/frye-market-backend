import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCurrentWavelength } from "../logic/engine22/wave/buildCurrentWavelength.js";
import { selectApprovedSevenDegreeFibModelsV1 } from "../logic/engine22/research/selectApprovedSevenDegreeFibModelsV1.js";
import { qualifyExistingEsBarsForFibTouchV1 } from "../logic/engine22/research/qualifyExistingEsBarsForFibTouchV1.js";
import { persistSevenDegreeTouchPreviewV1 } from "../logic/engine22/research/persistSevenDegreeTouchPreviewV1.js";
import { previewSevenDegreeTouchSnapshotV1 } from "../logic/engine22/research/previewSevenDegreeTouchSnapshotV1.js";
import { buildSevenDegreeTouchDisplayV1 } from "../logic/engine22/research/buildSevenDegreeTouchDisplayV1.js";

test("locked Micro W3 seven Fib prices: exact candle touch persists, retreat retains green, recount resets",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine22-micro-w3-"));
 try {
  const owner=buildCurrentWavelength({symbol:"ES",currentPrice:7950,microBars5m:[]})
    .degrees.micro.ownerMicroW3;
  const expected=[7791,7813.5,7836,7909,7961,8027,8100];
  assert.deepEqual(owner.levels.map(l=>l.price),expected);
  assert.ok(owner.levels.every(l=>l.status==="WATCH"&&l.touchEvidenceAvailable===false));
  // Approval and a matching raw futures contract are TEST FIXTURE data;
  // owner geometry alone is never asserted approved in production.
  const modelState={micro:{activeWave:"W3",sourceCountId:"TEST_OWNER_MICRO_W3",
    activeFibModel:{approved:true,active:true,modelKey:"TEST_MICRO_W3_20261015",
      seriesId:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
      modelOriginTime:"2026-10-15T13:30:00.000Z",direction:"UP",
      levels:Object.fromEntries(owner.levels.map(l=>[l.key,l.price]))}}};
  const models=selectApprovedSevenDegreeFibModelsV1({
    degreeStates:modelState,resolvedContract:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
  }).models;
  assert.deepEqual(models.micro.levels.map(l=>l.price),expected);
  function render(bars,modelSet=models){
   const observations=qualifyExistingEsBarsForFibTouchV1({
     bars,model:modelSet.micro,resolvedSymbol:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
     timeframe:"10m",evaluationTimeMs:Date.parse("2026-10-15T14:00:00.000Z"),
   }).observations;
   const observationsByDegree={micro:observations};
   const persistentResults=persistSevenDegreeTouchPreviewV1({
     rootPath:root,degreeModels:modelSet,observationsByDegree,
   });
   const touchSnapshot=previewSevenDegreeTouchSnapshotV1({
     degreeModels:modelSet,observationsByDegree,persistentResults,
   });
   return buildSevenDegreeTouchDisplayV1({models:modelSet,touchSnapshot}).degrees.micro;
  }
  assert.ok(render([]).levels.every(x=>x.status==="WATCH"));
  const hit=Math.floor(Date.parse("2026-10-15T13:40:00Z")/1000);
  const touched=render([{time:hit,low:7835.75,high:7836.25}]);
  assert.equal(touched.levels.find(x=>x.key==="e0618").status,"TOUCHED");
  assert.equal(touched.levels.filter(x=>x.status==="TOUCHED").length,1);
  assert.equal(touched.levels.find(x=>x.key==="e0618").touchEvidence.verified,true);
  assert.equal(render([]).levels.find(x=>x.key==="e0618").status,"TOUCHED");
  const revision={...models,micro:{...models.micro,modelKey:"RECOUNTED_TEST_MICRO_W3"}};
  assert.ok(render([],revision).levels.every(x=>x.status==="WATCH"));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
