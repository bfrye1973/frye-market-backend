import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {selectApprovedSevenDegreeFibModelsV1} from "../logic/engine22/research/selectApprovedSevenDegreeFibModelsV1.js";
import {qualifyExistingEsBarsForFibTouchV1} from "../logic/engine22/research/qualifyExistingEsBarsForFibTouchV1.js";
import {persistSevenDegreeTouchPreviewV1} from "../logic/engine22/research/persistSevenDegreeTouchPreviewV1.js";
import {previewSevenDegreeTouchSnapshotV1} from "../logic/engine22/research/previewSevenDegreeTouchSnapshotV1.js";
import {buildSevenDegreeTouchDisplayV1} from "../logic/engine22/research/buildSevenDegreeTouchDisplayV1.js";
import {FIB_TOUCH_DEGREES_V1} from "../logic/engine22/research/reduceFibTouchesV1.js";

test("all seven approved ES contract models WATCH to durable TOUCHED across restart and retreat",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine22-seven-e2e-"));
 try {
  const origin="2026-10-14T14:00:00.000Z";
  const contract="ESZ6", basis="RAW_UNADJUSTED_CONTRACT",price=7800;
  const states=Object.fromEntries(FIB_TOUCH_DEGREES_V1.map(degree=>[degree,{
    activeWave:"W3",sourceCountId:"count-"+degree,
    activeFibModel:{active:true,approved:true,modelKey:"fib-model-"+degree,seriesId:contract,
      priceBasis:basis,modelOriginTime:origin,direction:"UP",levels:{e1000:price}}
  }]));
  const selected=selectApprovedSevenDegreeFibModelsV1({degreeStates:states,resolvedContract:contract,priceBasis:basis});
  assert.equal(Object.keys(selected.models).length,7);
  // ES OHLC bars use Unix seconds at bar start, and must have completed.
  const barTime=Date.parse("2026-10-14T14:10:00.000Z")/1000;
  const evaluationTimeMs=Date.parse("2026-10-14T14:30:00.000Z");
  const observations=Object.fromEntries(FIB_TOUCH_DEGREES_V1.map(degree=>[degree,
    qualifyExistingEsBarsForFibTouchV1({bars:[{time:barTime,low:7799,high:7801}],
     resolvedSymbol:contract,priceBasis:basis,timeframe:"10m",evaluationTimeMs,
     model:selected.models[degree]}).observations]));
  const persisted=persistSevenDegreeTouchPreviewV1({rootPath:root,degreeModels:selected.models,observationsByDegree:observations});
  const preview=previewSevenDegreeTouchSnapshotV1({degreeModels:selected.models,observationsByDegree:observations,persistentResults:persisted});
  const display=buildSevenDegreeTouchDisplayV1({models:selected.models,touchSnapshot:preview});
  for(const degree of FIB_TOUCH_DEGREES_V1){
   assert.equal(display.degrees[degree].available,true,degree);
   assert.equal(display.degrees[degree].levels[0].status,"TOUCHED",degree);
  }
  // Simulate a new process with only a retreating, non-touching bar.
  const retreat=Object.fromEntries(FIB_TOUCH_DEGREES_V1.map(degree=>[degree,
    qualifyExistingEsBarsForFibTouchV1({bars:[{time:barTime+600,low:7820,high:7830}],
     resolvedSymbol:contract,priceBasis:basis,timeframe:"10m",evaluationTimeMs,
     model:selected.models[degree]}).observations]));
  const persistedAgain=persistSevenDegreeTouchPreviewV1({rootPath:root,degreeModels:selected.models,observationsByDegree:retreat});
  const previewAgain=previewSevenDegreeTouchSnapshotV1({degreeModels:selected.models,observationsByDegree:retreat,persistentResults:persistedAgain});
  const displayAgain=buildSevenDegreeTouchDisplayV1({models:selected.models,touchSnapshot:previewAgain});
  for(const degree of FIB_TOUCH_DEGREES_V1) assert.equal(displayAgain.degrees[degree].levels[0].status,"TOUCHED",degree);
  const revised=structuredClone(selected.models);
  revised.micro={...revised.micro,modelKey:"recounted-micro"};
  const revisedPersistent=persistSevenDegreeTouchPreviewV1({rootPath:root,degreeModels:revised,observationsByDegree:retreat});
  const revisedPreview=previewSevenDegreeTouchSnapshotV1({degreeModels:revised,observationsByDegree:retreat,persistentResults:revisedPersistent});
  const revisedDisplay=buildSevenDegreeTouchDisplayV1({models:revised,touchSnapshot:revisedPreview});
  assert.equal(revisedDisplay.degrees.micro.levels[0].status,"WATCH");
  assert.equal(revisedDisplay.degrees.minute.levels[0].status,"TOUCHED");
  const wrongSource=selectApprovedSevenDegreeFibModelsV1({degreeStates:states,resolvedContract:"ESU6",priceBasis:basis});
  assert.equal(Object.keys(wrongSource.models).length,0);
 }finally{fs.rmSync(root,{force:true,recursive:true});}
});
