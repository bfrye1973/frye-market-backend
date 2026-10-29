import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createWaveReplayConsumer} from "../waveObservation/createWaveReplayConsumer.js";
const degrees=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const date="2026-10-28";
const snap=(time)=>({schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",
 snapshotTime:"2026-10-28T20:00:00Z",symbol:"ES",strategies:{"intraday_scalp@10m":{
 engine22WaveStrategy:{authorizedWorkingStructure:{schema:"engine22.authorizedWorkingStructure.v1",
 status:"COMPLETE_WORKING_SELECTION",mode:"READ_ONLY",noExecution:true,noWaveTransition:true,
 modelFingerprint:"a".repeat(64),publishedAt:"2026-10-28T19:00:00Z",
 degrees:Object.fromEntries(degrees.map((degree,i)=>[degree,{degree,available:true,
  selectionStatus:i<4?"OWNER_SELECTED_WORKING":"CANONICAL_DEGREE_STATE",
  sourcePath:"currentWavelength.degrees."+degree,modelVersion:"model."+degree+".v1",
  activeWave:"W3",direction:"UP",stage:"DEVELOPING",
  parentDegree:degrees[i+1]??null,parentWave:i<3?"W3":null,
  levels:[],review:null,officialInvalidation:null}]))}}}}});
const temp=async fn=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-intake-"));try{await fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}};
test("original bytes deliver seven events and restart resumes remaining Replay",()=>temp(async root=>{
 let calls=0;
 const reader=async item=>{calls++;return {bytes:Buffer.from(JSON.stringify(snap(item.time)))}};
 const consumer=createWaveReplayConsumer({root,readOriginalReplay:reader});
 const first=await consumer.consumeDate({date,times:["1301","1302"],maxBatch:1,observedAt:"2026-10-28T20:05:00Z"});
 assert.equal(first.ok,true);assert.equal(first.processed,1);
 assert.equal(consumer.readEvents().length,7);
 const restart=createWaveReplayConsumer({root,readOriginalReplay:reader});
 const second=await restart.consumeDate({date,times:["1301","1302"],maxBatch:5,observedAt:"2026-10-28T20:06:00Z"});
 assert.equal(second.ok,true);assert.equal(second.processed,1);
 assert.equal(calls,2);assert.equal(restart.readEvents().length,7);
 assert.deepEqual(restart.processedFor(date),[date+"/1301",date+"/1302"]);
}));
test("missing original bytes never advances durable receipt",()=>temp(async root=>{
 const consumer=createWaveReplayConsumer({root,readOriginalReplay:async()=>({bytes:null})});
 const r=await consumer.consumeDate({date,times:["1301"],observedAt:"2026-10-28T20:05:00Z"});
 assert.equal(r.ok,false);assert.equal(r.reason,"ORIGINAL_REPLAY_BYTES_REQUIRED");
 assert.deepEqual(consumer.processedFor(date),[]);
}));
test("bad canonical source cannot become a seven-degree journal record",()=>temp(async root=>{
 const consumer=createWaveReplayConsumer({root,readOriginalReplay:async()=>({bytes:Buffer.from("{}")})});
 const r=await consumer.consumeDate({date,times:["1301"],observedAt:"2026-10-28T20:05:00Z"});
 assert.equal(r.reason,"CANONICAL_REPLAY_CONTRACT_UNVERIFIED");
 assert.equal(consumer.readEvents().length,0);
}));

test("failed candle persistence blocks receipt; restart retries enrichment without duplicate wave events",()=>temp(async root=>{
 const reader=async()=>({bytes:Buffer.from(JSON.stringify(snap("1301")))});
 const failed=createWaveReplayConsumer({root,readOriginalReplay:reader,
   onWaveEvidence:async()=>({ok:false,reason:"TEN_MINUTE_EVIDENCE_NOT_SAVED"})});
 const first=await failed.consumeDate({date,times:["1301"],observedAt:"2026-10-28T20:05:00Z"});
 assert.equal(first.ok,false);assert.equal(first.reason,"TEN_MINUTE_EVIDENCE_NOT_SAVED");
 assert.equal(failed.readEvents().length,7);
 assert.deepEqual(failed.processedFor(date),[]);
 const restored=createWaveReplayConsumer({root,readOriginalReplay:reader,
   onWaveEvidence:async({sourceReplay})=>({ok:sourceReplay.sha256.length===64})});
 const retry=await restored.consumeDate({date,times:["1301"],observedAt:"2026-10-28T20:06:00Z"});
 assert.equal(retry.ok,true);assert.equal(retry.processed,1);
 assert.equal(restored.readEvents().length,7);
 assert.deepEqual(restored.processedFor(date),[date+"/1301"]);
}));

test("legacy Replay without original authorized publisher receives immutable skip receipt",()=>temp(async root=>{
 const s=snap("1301");
 delete s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure;
 const reader=async()=>({bytes:Buffer.from(JSON.stringify(s))});
 const consumer=createWaveReplayConsumer({root,readOriginalReplay:reader});
 const first=await consumer.consumeDate({date,times:["1301"],observedAt:"2026-10-28T20:05:00Z"});
 assert.equal(first.ok,true);assert.equal(first.processed,1);
 assert.equal(consumer.readEvents().length,0);
 assert.deepEqual(consumer.processedFor(date),[date+"/1301"]);
 const receipt=JSON.parse(fs.readFileSync(path.join(root,"replay-intake-receipts",date,"1301.json"),"utf8"));
 assert.equal(receipt.disposition,"SKIPPED_NO_ORIGINAL_AUTHORIZED_PUBLICATION");
 assert.equal(receipt.sevenDegreeJournalAck,false);
 const repeat=await consumer.consumeDate({date,times:["1301"]});
 assert.equal(repeat.processed,0);
}));
test("partial or conflicting authorized publication does NOT qualify for legacy skip",()=>temp(async root=>{
 const s=snap("1301");
 s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.status="BROKEN";
 const consumer=createWaveReplayConsumer({root,readOriginalReplay:async()=>({bytes:Buffer.from(JSON.stringify(s))})});
 const r=await consumer.consumeDate({date,times:["1301"],observedAt:"2026-10-28T20:05:00Z"});
 assert.equal(r.ok,false);assert.deepEqual(consumer.processedFor(date),[]);
}));
