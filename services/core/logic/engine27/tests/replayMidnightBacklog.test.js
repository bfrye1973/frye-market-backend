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
