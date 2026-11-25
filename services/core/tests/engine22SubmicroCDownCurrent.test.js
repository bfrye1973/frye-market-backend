import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
const make=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7650,microBars5m:[]});
test("Submicro C uses chronological owner anchors and exact ES targets",()=>{
 const w=make(),c=w.degrees.submicro.ownerSubmicroCDown;
 assert.equal(c.version,"engine22.submicroCDownOwnerWatch.v1");
 assert.equal(c.waveA.high,7812);assert.equal(c.waveA.low,7712);
 assert.equal(c.waveB.high,7743);
 assert.equal(c.waveB.highLocalTime,"2026-10-22 18:50");
 assert.deepEqual(c.levels.map(x=>x.price),[7704.75,7693,7681.25,7664.5,7643,7615.75,7581.25,7543]);
 assert.equal(c.noExecution,true);
 assert.equal(w.degrees.submicro.ownerSubmicroADown.version,"engine22.submicroADownOwnerWatch.v1");
});
test("Submicro C touch persistence, old model isolation and completed ES bar gate",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e22-sm-c-"));
 const file=path.join(dir,"touches.json"),t=Date.parse("2026-10-24T19:00:00Z");
 try{
  const first=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7650,evaluationTimeMs:t,storePath:file});
  assert.deepEqual(first.degrees.submicro.ownerSubmicroCDown.levels.map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
  assert.equal(first.degrees.submicro.ownerSubmicroADown.levels[0].status,"WATCH");
  const after=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7730,evaluationTimeMs:t+600000,storePath:file});
  assert.equal(after.degrees.submicro.ownerSubmicroCDown.levels[3].status,"TOUCHED");
  const changed=make(); changed.degrees.submicro.ownerSubmicroCDown.waveB.high=7743.25;
  const reset=applyOwnerPriceTouchesV1({currentWavelength:changed,currentPrice:7730,evaluationTimeMs:t+1200000,storePath:file});
  assert.equal(reset.degrees.submicro.ownerSubmicroCDown.levels[3].status,"WATCH");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 const bar={time:Math.floor(Date.parse("2026-10-23T02:00:00Z")/1000),low:7600,high:7740};
 const early=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7800,bars10m:[bar],evaluationTimeMs:Date.parse("2026-10-23T02:05:00Z")});
 assert.equal(early.degrees.submicro.ownerSubmicroCDown.levels[5].status,"WATCH");
 const late=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7800,bars10m:[bar],evaluationTimeMs:Date.parse("2026-10-23T02:11:00Z")});
 assert.equal(late.degrees.submicro.ownerSubmicroCDown.levels[5].status,"TOUCHED");
});
