import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {runWaveObservationBackfill} from "../waveObservation/runWaveObservationBackfill.js";
import {measureReplayBacklog} from "../waveObservation/measureReplayBacklog.js";
test("14-day legacy backlog drains in bounded batches, handles midnight late files and restart",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-14day-"));
 const replayRoot=path.join(root,"es"),journal=path.join(root,"journal");
 try{
  const dates=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,9,16+i)).toISOString().slice(0,10));
  const record=date=>JSON.stringify({schema:"engine12.multiStrategyReplay.v1",
   replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",snapshotTime:date+"T12:00:00Z",symbol:"ES"})+"\n";
  const filesPerDay=40;
  for(const date of dates){
   const folder=path.join(replayRoot,date);fs.mkdirSync(folder,{recursive:true});
   for(let i=0;i<filesPerDay;i++){
    const time=String(1000+i).padStart(4,"0");
    fs.writeFileSync(path.join(folder,time+".json"),record(date));
   }
  }
  let total=0,cycles=0;
  const started=performance.now();
  while(total<dates.length*filesPerDay){
   const r=await runWaveObservationBackfill({replayRoot,root:journal,dates,commit:true,maxBatch:60,maxTotalBatch:60,
    request:()=>{throw Error("No provider request for Replay without authorized wave")}});
   assert.equal(r.ok,true);
   assert.ok(r.processed<=60);
   assert.equal(r.legacySkipped,r.processed);
   assert.ok(r.processed>0);
   total+=r.processed;cycles++;
   assert.ok(cycles<=15);
  }
  const seconds=(performance.now()-started)/1000;
  const rate=total/Math.max(seconds,.001);
  const inventory=measureReplayBacklog({replayRoot,root:journal,now:new Date("2026-10-29T18:00:00Z")});
  assert.equal(inventory.remainingBacklogCount,0);
  assert.equal(inventory.processedRetainedCount,total);
  // Previous-day late delivery, found even after all newer receipts exist.
  const late=path.join(replayRoot,"2026-10-28","2358.json");
  fs.writeFileSync(late,record("2026-10-28"));
  const resumed=await runWaveObservationBackfill({replayRoot,root:journal,dates,commit:true,maxBatch:60,maxTotalBatch:60});
  assert.equal(resumed.ok,true);assert.equal(resumed.processed,1);
  const restart=await runWaveObservationBackfill({replayRoot,root:journal,dates,commit:true,maxBatch:60,maxTotalBatch:60});
  assert.equal(restart.processed,0);
  assert.equal(fs.existsSync(path.join(journal,"events")),false);
  console.log("BACKLOG_BENCHMARK",JSON.stringify({days:14,filesPerDay,total:total+1,cycles:cycles+2,
   elapsedSeconds:Number(seconds.toFixed(3)),legacyFilesPerSecond:Number(rate.toFixed(2)),
   providerRequests:0,remaining:0,lateArrivalRecovered:true}));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
