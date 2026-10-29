import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createOriginalReplayFileReader} from "../waveObservation/createOriginalReplayFileReader.js";
import {createWaveReplayConsumer} from "../waveObservation/createWaveReplayConsumer.js";
const degrees=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const date="2026-10-28";
function snapshot(){return {schema:"engine12.multiStrategyReplay.v1",
 replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",snapshotTime:"2026-10-28T20:00:00Z",
 symbol:"ES",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{authorizedWorkingStructure:{
 schema:"engine22.authorizedWorkingStructure.v1",status:"COMPLETE_WORKING_SELECTION",
 mode:"READ_ONLY",noExecution:true,noWaveTransition:true,modelFingerprint:"a".repeat(64),
 publishedAt:"2026-10-28T19:59:00Z",
 degrees:Object.fromEntries(degrees.map((degree,i)=>[degree,{degree,available:true,
 selectionStatus:i<4?"OWNER_SELECTED_WORKING":"CANONICAL_DEGREE_STATE",
 sourcePath:"currentWavelength.degrees."+degree,modelVersion:"model."+degree+".v1",
 activeWave:"W3",direction:"UP",stage:"DEVELOPING",
 parentDegree:degrees[i+1]??null,parentWave:i<3?"W3":null,
 levels:[],review:null,officialInvalidation:null}]))}}}}};}
test("disk Replay backfill survives missing original file, resume, and idempotent re-run",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-backfill-"));
 try{
  const archive=path.join(root,"original","es"),working=path.join(root,"journal");
  const folder=path.join(archive,date);fs.mkdirSync(folder,{recursive:true});
  const original=Buffer.from(JSON.stringify(snapshot())+"\n");
  fs.writeFileSync(path.join(folder,"1301.json"),original);
  const reader=createOriginalReplayFileReader({replayRoot:archive});
  const first=createWaveReplayConsumer({root:working,readOriginalReplay:reader});
  const partial=await first.consumeDate({date,times:["1301","1302"],observedAt:"2026-10-28T20:07:00Z"});
  assert.equal(partial.ok,false);assert.equal(partial.processed,1);assert.equal(partial.blocked,date+"/1302");
  assert.equal(first.readEvents().length,7);
  fs.writeFileSync(path.join(folder,"1302.json"),original);
  const restored=createWaveReplayConsumer({root:working,readOriginalReplay:reader});
  const resumed=await restored.consumeDate({date,times:["1301","1302"],observedAt:"2026-10-28T20:08:00Z"});
  assert.equal(resumed.ok,true);assert.equal(resumed.processed,1);
  assert.deepEqual(restored.processedFor(date),[date+"/1301",date+"/1302"]);
  assert.equal(restored.readEvents().length,7);
  const repeat=await restored.consumeDate({date,times:["1301","1302"],observedAt:"2026-10-28T20:09:00Z"});
  assert.equal(repeat.ok,true);assert.equal(repeat.processed,0);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
