import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import {createWaveEvidenceEnricher} from "../waveObservation/createWaveEvidenceEnricher.js";
const names=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const snapshot={snapshotTime:"2026-10-28T20:11:00Z",strategies:{"intraday_scalp@10m":{
 engine22WaveStrategy:{authorizedWorkingStructure:{status:"COMPLETE_WORKING_SELECTION",
 degrees:Object.fromEntries(names.map(degree=>[degree,{available:true,activeWave:"W3",direction:"UP",
 stage:"DEVELOPING",modelVersion:"micro-test",levels:[{key:"e1000",ratio:1,price:7787.25,status:"TOUCHED",
 touchedAt:"2026-10-28T20:00:00Z"}]}]))}}}}};
const sourceReplay={date:"2026-10-28",time:"1311",sha256:"a".repeat(64)};
const request=async url=>{
 const tf=new URL(url).searchParams.get("timeframe");
 const offset=tf==="10m"?0:tf==="5m"?5:9;
 return {ok:true,json:async()=>({ok:true,resolvedSymbol:"ESZ6",requestedSymbol:"ES",
 bars:[{time:Date.parse("2026-10-28T20:00:00Z")/1000+offset*60,
 open:7784.75,high:7819.5,low:7783.75,close:7785,volume:1000}]})};
};
test("enricher fetches existing backend OHLC and persists 10m primary evidence",async()=>{
 const root=fs.mkdtempSync(os.tmpdir()+"/e27-enrich-");
 try{
  const enrich=createWaveEvidenceEnricher({root,request});
  const result=await enrich({snapshot,sourceReplay});
  assert.equal(result.ok,true);
  assert.equal(result.degreeResults.filter(x=>x.ok).length,2);
  const one=await enrich({snapshot,sourceReplay});
  assert.equal(one.ok,true);
  assert.equal(fs.readdirSync(root+"/candle-evidence").filter(x=>x.endsWith(".json")).length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test("unavailable primary 10m source blocks intake",async()=>{
 const root=fs.mkdtempSync(os.tmpdir()+"/e27-enrich-");
 try{
  const enrich=createWaveEvidenceEnricher({root,request:async()=>({ok:false,status:502})});
  const result=await enrich({snapshot,sourceReplay});
  assert.equal(result.ok,false);assert.equal(result.reason,"PRIMARY_COMPLETED_10M_SOURCE_UNAVAILABLE");
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
