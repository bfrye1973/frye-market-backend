import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
const wave=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7672.5,microBars5m:[]});
test("owner C-down geometry and historical Minute D model isolation",()=>{
 const cw=wave(),c=cw.degrees.minute.ownerLargerCDownScenario;
 assert.equal(c.version,"engine22.largerCorrectionCDownWatch.v1");
 assert.equal(c.anchors.aHigh,7905);assert.equal(c.anchors.aLow,7575);
 assert.equal(c.anchors.bHigh,7897.5);
 assert.deepEqual(c.levels.map(x=>x.price),[7771.5,7732.5,7693.5,7638.25,7567.5,7477.75,7363.5,7237.5]);
 assert.equal(c.degreeAssignment,"PENDING_RECONCILIATION");
 assert.equal(c.confirmationStatus,"STRUCTURAL_C_COMPLETION_NOT_CONFIRMED");
 assert.equal(cw.degrees.minute.ownerMinuteW2Hypothesis.activeInternalLeg,"D");
 assert.ok(c.levels.every(x=>x.status==="WATCH"));
});
test("C-down levels go touched and persist after price retreats or restart",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e22-larger-c-"));
 const storePath=path.join(dir,"touch.json");
 const t=Date.parse("2026-10-24T22:10:00Z");
 try{
  const first=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7672.5,evaluationTimeMs:t,storePath});
  const list=first.degrees.minute.ownerLargerCDownScenario.levels;
  assert.deepEqual(list.map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH","WATCH"]);
  assert.equal(first.degrees.minute.ownerMinuteW2Hypothesis.internalDProjection.levels[0].status,"WATCH");
  const after=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7820,evaluationTimeMs:t+600000,storePath});
  assert.equal(after.degrees.minute.ownerLargerCDownScenario.levels[2].status,"TOUCHED");
  const altered=wave();altered.degrees.minute.ownerLargerCDownScenario.anchors.bHigh=7900;
  const recount=applyOwnerPriceTouchesV1({currentWavelength:altered,currentPrice:7900,evaluationTimeMs:t+1200000,storePath});
  assert.ok(recount.degrees.minute.ownerLargerCDownScenario.levels.every(x=>x.status==="WATCH"));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("completed candle low counts, incomplete candle does not",()=>{
 const base=Date.parse("2026-10-24T22:00:00Z");
 const bar={time:Math.floor(base/1000),low:7500,high:7800};
 const early=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7900,bars10m:[bar],evaluationTimeMs:base+300000});
 assert.equal(early.degrees.minute.ownerLargerCDownScenario.levels[4].status,"WATCH");
 const complete=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7900,bars10m:[bar],evaluationTimeMs:base+600001});
 assert.equal(complete.degrees.minute.ownerLargerCDownScenario.levels[4].status,"TOUCHED");
});
