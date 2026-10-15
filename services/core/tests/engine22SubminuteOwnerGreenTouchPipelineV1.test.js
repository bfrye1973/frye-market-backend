import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCanonicalSevenDegreeTouchSourcesV1 } from "../logic/engine22/research/buildCanonicalSevenDegreeTouchSourcesV1.js";
import { selectApprovedSevenDegreeFibModelsV1 } from "../logic/engine22/research/selectApprovedSevenDegreeFibModelsV1.js";
import { qualifyExistingEsBarsForFibTouchV1 } from "../logic/engine22/research/qualifyExistingEsBarsForFibTouchV1.js";
import { persistSevenDegreeTouchPreviewV1 } from "../logic/engine22/research/persistSevenDegreeTouchPreviewV1.js";
import { previewSevenDegreeTouchSnapshotV1 } from "../logic/engine22/research/previewSevenDegreeTouchSnapshotV1.js";
import { buildSevenDegreeTouchDisplayV1 } from "../logic/engine22/research/buildSevenDegreeTouchDisplayV1.js";

const expected = {
 e0382:7761.50,e0500:7788.75,e0618:7815.75,
 e1000:7904.00,e1272:7966.75,e1618:8046.50,e2000:8134.75,
};
const source = {
 activeWave:"W3",sourceCountId:"test-approved-subminute-count",
 activeFibModel:{
  active:true,approved:true,modelKey:"test-approved-subminute-20261015",
  seriesId:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
  modelOriginTime:"2026-10-01T14:00:00.000Z",direction:"UP",levels:expected,
 }
};
function packet(observations,root,models){
 const persisted=persistSevenDegreeTouchPreviewV1({rootPath:root,degreeModels:models,observationsByDegree:{subminute:observations}});
 const preview=previewSevenDegreeTouchSnapshotV1({degreeModels:models,observationsByDegree:{subminute:observations},persistentResults:persisted});
 return buildSevenDegreeTouchDisplayV1({models,touchSnapshot:preview}).degrees.subminute;
}
test("owner-locked Subminute W1/W2 generate the seven extension prices",()=>{
 const w1Low=7616.25,w1High=7847.00,w2Low=7673.25;
 const ratios=[["e0382",.382],["e0500",.5],["e0618",.618],["e1000",1],
  ["e1272",1.272],["e1618",1.618],["e2000",2]];
 for(const [key,ratio] of ratios)
  assert.equal(Math.round((w2Low+(w1High-w1Low)*ratio)*4)/4,expected[key],key);
});
test("seven owner-priced Subminute Fibs stay yellow until completed ES touch, then persist green through retreat and recount",()=>{
 // The test-only approved model is not a claim that production provenance is approved.
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e22-subminute-"));
 try{
  const canonical=buildCanonicalSevenDegreeTouchSourcesV1({
   degreeStates:{subminute:source},
   activeStructures:{subminute:{activeWave:"W3"},micro:{activeWave:"W2"}},
  });
  const selected=selectApprovedSevenDegreeFibModelsV1({
   degreeStates:canonical.degrees,resolvedContract:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
  });
  assert.deepEqual(selected.models.subminute.levels.map(x=>x.price),Object.values(expected));
  const models=selected.models;
  const noTouch=packet([],root,models);
  assert.ok(noTouch.levels.every(x=>x.status==="WATCH"));
  const ts=Math.floor(Date.parse("2026-10-15T14:00:00Z")/1000);
  const obs=qualifyExistingEsBarsForFibTouchV1({
   bars:[{time:ts,low:7815.5,high:7816.00}],
   resolvedSymbol:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
   model:models.subminute,timeframe:"10m",
   evaluationTimeMs:Date.parse("2026-10-15T14:20:00Z"),
  }).observations;
  let updated=packet(obs,root,models);
  assert.equal(updated.levels.find(x=>x.key==="e0618").status,"TOUCHED");
  assert.equal(updated.levels.filter(x=>x.status==="TOUCHED").length,1);
  assert.ok(updated.levels.find(x=>x.key==="e0618").touchEvidence?.verified);
  updated=packet([],root,models); // New rebuild with no source candles.
  assert.equal(updated.levels.find(x=>x.key==="e0618").status,"TOUCHED");
  const replacement={...models,subminute:{...models.subminute,modelKey:"recounted-subminute"}};
  assert.ok(packet([],root,replacement).levels.every(x=>x.status==="WATCH"));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("unapproved owner-coordinates-only model cannot manufacture a green touch",()=>{
 const pending={...source,activeFibModel:{...source.activeFibModel,approved:false}};
 const isolated=buildCanonicalSevenDegreeTouchSourcesV1({
  degreeStates:{subminute:pending},activeStructures:{subminute:{activeWave:"W3"}},
 });
 const selected=selectApprovedSevenDegreeFibModelsV1({
  degreeStates:isolated.degrees,resolvedContract:"ESZ6",priceBasis:"RAW_UNADJUSTED_CONTRACT",
 });
 assert.equal(selected.models.subminute,undefined);
});
