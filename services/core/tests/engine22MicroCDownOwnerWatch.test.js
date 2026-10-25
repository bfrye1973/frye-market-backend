import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
const make=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7668,microBars5m:[]});
test("current Micro C downside geometry retains old count and no permissions",()=>{
 const root=make(),m=root.degrees.micro.ownerMicroCDown;
 assert.equal(m.version,"engine22.microCDownOwnerWatch.v1");
 assert.deepEqual([m.waveA.high,m.waveA.low,m.waveB.high],[7898,7678,7813.25]);
 assert.deepEqual(m.levels.map(x=>x.price),[7761.25,7729.25,7703.25,7677.25,7640.25,7593.25,7533.5,7457.25,7373.25]);
 assert.equal(m.parentWave,"C");
 assert.equal(m.noPermissionCreated,true);
 assert.equal(root.degrees.micro.ownerMicroBDown.version,"engine22.microBDownOwnerWatch.v1");
});
test("downside touch from current ES price persists and old Micro B levels remain separate",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"micro-c-down-")),file=path.join(dir,"touches.json");
 const t=Date.parse("2026-10-24T20:00:00Z");
 try{
  const first=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7668,evaluationTimeMs:t,storePath:file});
  assert.deepEqual(first.degrees.micro.ownerMicroCDown.levels.map(x=>x.status),["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH","WATCH"]);
  assert.ok(first.degrees.micro.ownerMicroBDown.levels.every(x=>x.status==="WATCH"));
  const restart=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7800,evaluationTimeMs:t+600000,storePath:file});
  assert.equal(restart.degrees.micro.ownerMicroCDown.levels[3].status,"TOUCHED");
  const after=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7638,evaluationTimeMs:t+1200000,storePath:file});
  assert.equal(after.degrees.micro.ownerMicroCDown.levels[4].status,"TOUCHED");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("Micro C ignores old pre-B observations and unfinished candles",()=>{
 const before=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7500,evaluationTimeMs:Date.parse("2026-10-21T15:00:00Z")});
 assert.ok(before.degrees.micro.ownerMicroCDown.levels.every(x=>x.status==="WATCH"));
 const t=Date.parse("2026-10-22T16:00:00Z"),bar={time:Math.floor(t/1000),high:7800,low:7400};
 const early=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7800,evaluationTimeMs:t+300000,bars10m:[bar]});
 assert.equal(early.degrees.micro.ownerMicroCDown.levels[8].status,"WATCH");
 const done=applyOwnerPriceTouchesV1({currentWavelength:make(),currentPrice:7800,evaluationTimeMs:t+600001,bars10m:[bar]});
 assert.equal(done.degrees.micro.ownerMicroCDown.levels[7].status,"TOUCHED");
});
