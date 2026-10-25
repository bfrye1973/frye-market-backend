import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCurrentWavelength } from "../logic/engine22/wave/buildCurrentWavelength.js";
import { applyOwnerPriceTouchesV1 } from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";

const model=()=>{ const v=buildCurrentWavelength({symbol:"ES",currentPrice:7800,microBars5m:[]}); delete v.degrees.micro.ownerMicroCDown; delete v.degrees.micro.ownerMicroBDown; delete v.degrees.submicro.ownerSubmicroADown; return v; };
test("all three owner Fib ladders use actual price and persistent touch history without cross-degree changes",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e22-price-touch-"));
 const file=path.join(dir,"touches.json");
 try{
  const time=Date.parse("2026-10-16T13:00:00Z");
  let first=applyOwnerPriceTouchesV1({
   currentWavelength:model(),currentPrice:7800,evaluationTimeMs:time,storePath:file,
  });
  const sub=first.degrees.submicro.ownerSubmicroW2.levels;
  assert.equal(sub[0].price,7780.75);
  assert.equal(sub[0].status,"OWNER_OBSERVED_TOUCH");
  assert.equal(sub[1].status,"WATCH");
  assert.ok(first.degrees.submicro.ownerSubmicroAbc.levels.every(x=>x.status==="WATCH"),"new C model must not be touched before Oct 21 B low");
  assert.equal(first.degrees.micro.ownerMicroW3.levels[0].status,"WATCH");
  assert.ok(first.degrees.micro.ownerMicroAbc.levels.every(x=>x.status==="WATCH"),"C-up must not be marked before Oct 20 B low");
  assert.equal(first.degrees.micro.ownerMicroW3.levels.find(x=>x.price===7909).status,"WATCH");
  // The original, independent Micro lifecycle levels remain unchanged.
  assert.deepEqual(first.degrees.micro.levels,model().degrees.micro.levels);
  const retreat=applyOwnerPriceTouchesV1({
   currentWavelength:model(),previousWavelength:first,
   currentPrice:7795,evaluationTimeMs:time+600000,storePath:file,
  });
  assert.equal(retreat.degrees.submicro.ownerSubmicroW2.levels[0].status,"OWNER_OBSERVED_TOUCH");
  // Simulate process restart: disk alone remembers the previously touched model.
  const afterRestart=applyOwnerPriceTouchesV1({
   currentWavelength:model(),currentPrice:7800,
   evaluationTimeMs:time+1200000,storePath:file,
  });
  assert.equal(afterRestart.degrees.submicro.ownerSubmicroW2.levels[0].status,"OWNER_OBSERVED_TOUCH");
  // A new price below 0.382 and 0.500 hits both in a single interval.
  const jump=applyOwnerPriceTouchesV1({
   currentWavelength:model(),previousWavelength:retreat,
   currentPrice:7757,evaluationTimeMs:time+1800000,storePath:file,
  });
  assert.deepEqual(jump.degrees.submicro.ownerSubmicroW2.levels.slice(0,3)
   .map(x=>x.status),["OWNER_OBSERVED_TOUCH","WATCH","WATCH"]);
  assert.equal(jump.degrees.submicro.ownerSubmicroW2.levels[3].status,"WATCH");
  // Recount changes model identity: no bleed from old price history.
  const revised=model();
  revised.degrees.submicro.ownerSubmicroW2.anchors.w1High=7801;
  const newWave=applyOwnerPriceTouchesV1({
   currentWavelength:revised,currentPrice:7795,evaluationTimeMs:time+2400000,storePath:file,
  });
  assert.equal(newWave.degrees.submicro.ownerSubmicroW2.levels[1].status,"WATCH");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("completed 10m highs and lows can register a touched extension between quotes",()=>{
 const start=Math.floor(Date.parse("2026-10-16T13:00:00Z")/1000);
 const output=applyOwnerPriceTouchesV1({
  currentWavelength:model(),currentPrice:7780,
  bars10m:[{time:start,low:7770,high:7911}],
  evaluationTimeMs:Date.parse("2026-10-16T13:20:00Z"),
 });
 assert.equal(output.degrees.micro.ownerMicroW3.levels.find(x=>x.price===7909).status,"WATCH");
 assert.equal(output.degrees.micro.ownerMicroAbc.levels.find(x=>x.price===7901.5).status,"WATCH");
 assert.equal(output.degrees.subminute.levels.find(x=>x.price===7904).status,"TOUCHED");
});
