import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {runWaveObservationBackfill} from "../waveObservation/runWaveObservationBackfill.js";
import {createReplayIntakeLedger} from "../waveObservation/createReplayIntakeLedger.js";
test("midnight, restart and prior-day late arrival produce durable source-qualified receipts oldest-first",async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"e27-midnight-replay-"));
 try{
  const replayRoot=path.join(folder,"es"),root=path.join(folder,"research");
  const older="2026-10-28",newer="2026-10-29";
  for(const date of [older,newer])fs.mkdirSync(path.join(replayRoot,date),{recursive:true});
  function original(date,time){
   fs.writeFileSync(path.join(replayRoot,date,time+".json"),JSON.stringify({
    schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",
    snapshotTime:date+"T"+time.slice(0,2)+":"+time.slice(2)+":00Z",symbol:"ES"
   })+"\n");
  }
  original(older,"2359");original(newer,"0001");
  const options={replayRoot,root,dates:[older,newer],commit:true,maxBatch:1,maxTotalBatch:1,
   request:async()=>{throw Error("Legacy source must not request OHLC")}};
  const first=await runWaveObservationBackfill(options);
  assert.equal(first.ok,true);assert.equal(first.reports[0].date,older);
  const afterRestart=await runWaveObservationBackfill(options);
  assert.equal(afterRestart.ok,true);assert.equal(afterRestart.reports[0].date,newer);
  original(older,"2358"); // Late-arriving earlier Replay after midnight.
  const late=await runWaveObservationBackfill(options);
  assert.equal(late.ok,true);assert.equal(late.reports[0].date,older);
  const ledger=createReplayIntakeLedger({root});
  assert.deepEqual(ledger.processedFor(older),[older+"/2358",older+"/2359"]);
  assert.deepEqual(ledger.processedFor(newer),[newer+"/0001"]);
  const repeat=await runWaveObservationBackfill(options);
  assert.equal(repeat.ok,true);assert.equal(repeat.reports.length,0);
  assert.equal(fs.existsSync(path.join(root,"events")),false);
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
});

test("newest current Replay receipt precedes 14-day backlog without losing the old key",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-current-first-"));
 try{
  const replayRoot=path.join(dir,"es"),root=path.join(dir,"research");
  const dates=["2026-10-28","2026-10-29"];
  for(const date of dates)fs.mkdirSync(path.join(replayRoot,date),{recursive:true});
  const add=(date,time)=>fs.writeFileSync(path.join(replayRoot,date,time+".json"),
   JSON.stringify({schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",
    snapshotTime:date+"T"+time.slice(0,2)+":"+time.slice(2)+":00Z",symbol:"ES"})+"\n");
  add(dates[0],"1000");add(dates[0],"1001");add(dates[1],"1013");
  const options={replayRoot,root,dates,commit:true,currentFirst:true,maxBatch:1,maxTotalBatch:1};
  const first=await runWaveObservationBackfill(options);
  assert.equal(first.ok,true);
  assert.equal(first.reports[0].lane,"CURRENT");
  assert.equal(first.reports[0].date,dates[1]);
  const ledger=createReplayIntakeLedger({root});
  assert.deepEqual(ledger.processedFor(dates[0]),[]);
  assert.deepEqual(ledger.processedFor(dates[1]),[dates[1]+"/1013"]);
  const second=await runWaveObservationBackfill(options);
  assert.equal(second.ok,true);
  assert.equal(second.reports[0].date,dates[0]);
  add(dates[1],"1016");
  const third=await runWaveObservationBackfill(options);
  assert.equal(third.reports[0].lane,"CURRENT");
  assert.deepEqual(ledger.processedFor(dates[1]),[dates[1]+"/1013",dates[1]+"/1016"]);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});


test("current lane consumes multiple recent originals in source order ahead of historical backlog",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-current-batch-"));
 try{
  const replayRoot=path.join(dir,"es"),root=path.join(dir,"research");
  const older="2026-10-28",today="2026-10-29";
  for(const date of [older,today])fs.mkdirSync(path.join(replayRoot,date),{recursive:true});
  const add=(date,time)=>fs.writeFileSync(path.join(replayRoot,date,time+".json"),JSON.stringify({
   schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",
   snapshotTime:date+"T"+time.slice(0,2)+":"+time.slice(2)+":00Z"})+"\\n");
  for(let i=0;i<100;i++)add(older,String(i).padStart(4,"0"));
  for(const time of ["1010","1011","1012","1013"])add(today,time);
  const options={replayRoot,root,dates:[older,today],commit:true,currentFirst:true,
   maxBatch:3,maxTotalBatch:3};
  const first=await runWaveObservationBackfill(options);
  assert.equal(first.ok,true);
  assert.equal(first.reports[0].lane,"CURRENT");
  assert.equal(first.processed,3);
  const ledger=createReplayIntakeLedger({root});
  assert.deepEqual(ledger.processedFor(today),["1010","1011","1012"].map(t=>today+"/"+t));
  add(today,"1014");
  const second=await runWaveObservationBackfill(options);
  assert.equal(second.ok,true);
  assert.deepEqual(ledger.processedFor(today),["1010","1011","1012","1013","1014"].map(t=>today+"/"+t));
  assert.equal(ledger.processedFor(older).length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
