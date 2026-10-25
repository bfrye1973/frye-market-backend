import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";

const base=()=>{ const v=buildCurrentWavelength({symbol:"ES",currentPrice:7802.25,microBars5m:[]}); delete v.degrees.micro.ownerMicroCDown; delete v.degrees.micro.ownerMicroBDown; delete v.degrees.submicro.ownerSubmicroADown; return v; };
const targets=[7745,7756.5,7767.75,7804.75,7831,7864.5,7901.5];
test("Micro C UP uses live ES quote, survives retreat/restart, isolates old Micro W3",()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"e22-micro-c-touch-"));
 const storePath=path.join(folder,"touches.json");
 const t=Date.parse("2026-10-21T17:00:00Z");
 try{
  let initial=applyOwnerPriceTouchesV1({currentWavelength:base(),currentPrice:7802.25,evaluationTimeMs:t,storePath});
  let micro=initial.degrees.micro;
  assert.deepEqual(micro.ownerMicroAbc.levels.map(x=>x.price),targets);
  assert.deepEqual(micro.ownerMicroAbc.levels.map(x=>x.status),[
    "TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
  assert.ok(micro.ownerMicroW3.levels.every(x=>x.status==="WATCH"),"superseded W3 projection remains historical");
  assert.ok(micro.ownerMicroAbc.levels.slice(0,3).every(x=>x.touchEvidenceType==="ES_CURRENT_PRICE"));
  const retreat=applyOwnerPriceTouchesV1({currentWavelength:base(),previousWavelength:initial,
    currentPrice:7790,evaluationTimeMs:t+600000,storePath});
  assert.equal(retreat.degrees.micro.ownerMicroAbc.levels[2].status,"TOUCHED");
  const restart=applyOwnerPriceTouchesV1({currentWavelength:base(),
    currentPrice:7780,evaluationTimeMs:t+1200000,storePath});
  assert.equal(restart.degrees.micro.ownerMicroAbc.levels[2].status,"TOUCHED");
  const updated=applyOwnerPriceTouchesV1({currentWavelength:base(),previousWavelength:retreat,
    currentPrice:7805,evaluationTimeMs:t+1800000,storePath});
  assert.equal(updated.degrees.micro.ownerMicroAbc.levels[3].status,"TOUCHED");
  assert.equal(updated.degrees.micro.ownerMicroAbc.levels[4].status,"WATCH");
  const recounted=base();
  recounted.degrees.micro.ownerMicroAbc.waveB.low=7709;
  const isolated=applyOwnerPriceTouchesV1({currentWavelength:recounted,currentPrice:7780,
    evaluationTimeMs:t+2400000,storePath});
  assert.equal(isolated.degrees.micro.ownerMicroAbc.levels[3].status,"WATCH");
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test("Micro C touches a completed 10m candle high reached after B, ignoring pre-B highs",()=>{
 const start=Math.floor(Date.parse("2026-10-20T12:10:00Z")/1000);
 const result=applyOwnerPriceTouchesV1({currentWavelength:base(),
  currentPrice:7730,evaluationTimeMs:Date.parse("2026-10-20T13:00:00Z"),
  bars10m:[
    {time:Math.floor(Date.parse("2026-10-19T16:00:00Z")/1000),high:8000,low:7680},
    {time:start,high:7805.25,low:7720},
  ]});
 assert.equal(result.degrees.micro.ownerMicroAbc.levels[3].status,"TOUCHED");
 assert.equal(result.degrees.micro.ownerMicroAbc.levels[4].status,"WATCH");
});
