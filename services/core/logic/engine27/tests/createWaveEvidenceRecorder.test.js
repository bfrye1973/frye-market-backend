import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import {createWaveEvidenceRecorder} from "../waveObservation/createWaveEvidenceRecorder.js";
const degrees=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const snapshot={snapshotTime:"2026-10-28T20:11:00Z",strategies:{"intraday_scalp@10m":{
 engine22WaveStrategy:{authorizedWorkingStructure:{status:"COMPLETE_WORKING_SELECTION",
 degrees:Object.fromEntries(degrees.map(degree=>[degree,{available:true,activeWave:"W3",direction:"UP",
 stage:"DEVELOPING",modelVersion:"v1",levels:[{key:"e1000",ratio:1,price:7787.25,status:"TOUCHED",touchedAt:"2026-10-28T20:00:00Z"}]}]))}}}}};
const sourceReplay={date:"2026-10-28",time:"1311",sha256:"a".repeat(64),path:"/var/data/replay/es/2026-10-28/1311.json"};
const ten={source:"BACKEND1_FUTURES_OHLC",priceBasis:"PHYSICAL_PROVIDER_AGGREGATES",resolvedSymbol:"ESZ6",
 bars:[{time:Date.parse("2026-10-28T20:00:00Z")/1000,open:7784.75,high:7819.5,low:7783.75,close:7785,volume:65387}]};
test("Micro/Submicro persist 10m candle evidence; larger degrees remain unapproved",()=>{
 const root=fs.mkdtempSync(os.tmpdir()+"/e27-record-");
 try{
  const recorder=createWaveEvidenceRecorder({root});
  const result=recorder.record({snapshot,sourceReplay,ohlc:{"10m":ten},asOf:"2026-10-28T20:11:00Z",
   waveExtremePrices:{micro:7819.5,submicro:7819.5}});
  assert.equal(result.ok,true);
  assert.equal(result.degreeResults.filter(x=>x.ok).length,2);
  assert.equal(fs.readdirSync(recorder.storagePath).filter(x=>x.endsWith(".json")).length,2);
  assert.equal(recorder.record({snapshot,sourceReplay,ohlc:{"10m":ten},asOf:"2026-10-28T20:11:00Z"}).ok,true);
  assert.equal(fs.readdirSync(recorder.storagePath).filter(x=>x.endsWith(".json")).length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
