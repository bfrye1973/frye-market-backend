import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";

const make=()=>{ const v=buildCurrentWavelength({symbol:"ES",currentPrice:7807,microBars5m:[]}); delete v.degrees.micro.ownerMicroCDown; delete v.degrees.micro.ownerMicroBDown; delete v.degrees.submicro.ownerSubmicroADown; return v; };
const levels=[7783.25,7793.5,7803.5,7836,7859.25,7888.75,7921.25];

test("Submicro A/B owner pivots and C upward Fibonacci targets remain isolated from historical W2",()=>{
 const root=make();
 const sub=root.degrees.submicro;
 const c=sub.ownerSubmicroAbc;
 assert.equal(c.version,"engine22.submicroAbcMicroC.v1");
 assert.equal(c.activeWave,"C");
 assert.equal(c.parentWave,"C");
 assert.equal(c.direction,"UP");
 assert.equal(c.waveA.startPrice,7708);
 assert.equal(c.waveA.high,7793.25);
 assert.equal(c.waveA.highLocalTime,"2026-10-20 16:00");
 assert.equal(c.waveB.low,7750.75);
 assert.equal(c.waveB.lowLocalTime,"2026-10-21 07:00");
 assert.deepEqual(c.levels.map(x=>x.price),levels);
 assert.ok(c.levels.every(x=>x.status==="WATCH"));
 assert.equal(c.noExecution,true);
 assert.equal(sub.ownerSubmicroW2.anchors.w1High,7800);
 assert.equal(sub.ownerSubmicroW2.levels[0].price,7780.75);
});

test("Submicro C turns first three ES Fib levels green, survives restart, recount isolates and pre-B bars ignored",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e22-submicro-c-"));
 const storePath=path.join(dir,"touch.json");
 const time=Date.parse("2026-10-21T17:00:00Z");
 try{
  const first=applyOwnerPriceTouchesV1({currentWavelength:make(),
    currentPrice:7807,evaluationTimeMs:time,storePath});
  const rows=first.degrees.submicro.ownerSubmicroAbc.levels;
  assert.deepEqual(rows.map(x=>x.status),[
   "TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
  assert.ok(rows.slice(0,3).every(x=>x.touchEvidenceType==="ES_CURRENT_PRICE"));
  assert.equal(first.degrees.submicro.ownerSubmicroW2.levels[0].status,"OWNER_OBSERVED_TOUCH");
  const retreat=applyOwnerPriceTouchesV1({currentWavelength:make(),
    previousWavelength:first,currentPrice:7795,evaluationTimeMs:time+600000,storePath});
  assert.equal(retreat.degrees.submicro.ownerSubmicroAbc.levels[2].status,"TOUCHED");
  const restarted=applyOwnerPriceTouchesV1({currentWavelength:make(),
    currentPrice:7775,evaluationTimeMs:time+1200000,storePath});
  assert.equal(restarted.degrees.submicro.ownerSubmicroAbc.levels[2].status,"TOUCHED");
  const updated=applyOwnerPriceTouchesV1({currentWavelength:make(),
    previousWavelength:retreat,currentPrice:7837,evaluationTimeMs:time+1800000,storePath});
  assert.equal(updated.degrees.submicro.ownerSubmicroAbc.levels[3].status,"TOUCHED");
  const newModel=make();
  newModel.degrees.submicro.ownerSubmicroAbc.waveB.low=7751;
  const revised=applyOwnerPriceTouchesV1({currentWavelength:newModel,
    currentPrice:7790,evaluationTimeMs:time+2400000,storePath});
  assert.equal(revised.degrees.submicro.ownerSubmicroAbc.levels[3].status,"WATCH");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("Submicro C completed 10m highs only count after B completed",()=>{
 const t=Date.parse("2026-10-21T15:00:00Z");
 const result=applyOwnerPriceTouchesV1({currentWavelength:make(),
  currentPrice:7760,evaluationTimeMs:t,
  bars10m:[
   {time:Math.floor(Date.parse("2026-10-21T13:30:00Z")/1000),low:7750,high:7950},
   {time:Math.floor(Date.parse("2026-10-21T14:10:00Z")/1000),low:7752,high:7836.25},
  ]});
 const rows=result.degrees.submicro.ownerSubmicroAbc.levels;
 assert.equal(rows[3].status,"TOUCHED");
 assert.equal(rows[4].status,"WATCH");
});
