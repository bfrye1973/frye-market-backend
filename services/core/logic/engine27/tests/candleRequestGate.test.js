import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createCandleRequestGate} from "../waveObservation/createCandleRequestGate.js";
import {createWaveEvidenceEnricher} from "../waveObservation/createWaveEvidenceEnricher.js";
test("rate gate permits only two requests per minute, enforces spacing, and resets",async()=>{
 let clock=100000,called=0;
 const g=createCandleRequestGate({maxPerMinute:2,minSpacingMs:15000,now:()=>clock});
 const run=()=>g.execute(async()=>{called++;return {available:true}});
 assert.equal((await run()).available,true);
 clock+=1000;assert.equal((await run()).reason,"CANDLE_REQUEST_BACKPRESSURE");
 clock+=15000;assert.equal((await run()).available,true);
 clock+=15000;assert.equal((await run()).reason,"CANDLE_REQUEST_BACKPRESSURE");
 clock+=60000;assert.equal((await run()).available,true);
 assert.equal(called,3);
});
test("one worker never starts concurrent remote candle calls",async()=>{
 let release;
 const g=createCandleRequestGate({maxPerMinute:2,minSpacingMs:0});
 const first=g.execute(()=>new Promise(resolve=>{release=resolve}));
 const second=await g.execute(async()=>({available:true}));
 assert.equal(second.reason,"CANDLE_REQUEST_BACKPRESSURE");
 release({available:true});await first;
});

test("rolling two-request quota persists through new backfill instances and simulated restart",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-rolling-quota-"));
 try{
  let clock=100000,remoteCalls=0;
  const hit=async()=>{remoteCalls++;return {available:true}};
  const instance=()=>createCandleRequestGate({root,maxPerMinute:2,minSpacingMs:15000,now:()=>clock});
  assert.equal((await instance().execute(hit)).available,true);
  clock+=16000;
  assert.equal((await instance().execute(hit)).available,true);
  clock+=16000;
  assert.equal((await instance().execute(hit)).reason,"CANDLE_REQUEST_BACKPRESSURE");
  assert.equal(remoteCalls,2);
  // Simulate a fresh process with no in-memory state: durable quota remains.
  const afterRestart=instance();
  assert.equal((await afterRestart.execute(hit)).reason,"CANDLE_REQUEST_BACKPRESSURE");
  clock+=29000;
  assert.equal((await afterRestart.execute(hit)).available,true);
  assert.equal(remoteCalls,3);
  assert.equal(fs.existsSync(path.join(root,"ohlc-request-budget.json")),true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
