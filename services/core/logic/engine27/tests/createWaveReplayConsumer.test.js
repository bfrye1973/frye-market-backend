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
