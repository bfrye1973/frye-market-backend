import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inspectMicroReplayFile,inspectOct26MicroReplayHistory} from "../waveObservation/inspectOct26MicroHistory.js";
const base=()=>({schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",
 snapshotTime:"2026-10-26T15:00:00Z",strategies:{"intraday_scalp@10m":{
 engine22WaveStrategy:{currentWavelength:{degrees:{micro:{activeWave:"C",direction:"DOWN"}}}}
 }}});
test("Oct26 legacy historical snapshot must not be relabeled W3 UP",()=>{
 const r=inspectMicroReplayFile(JSON.stringify(base()),{date:"2026-10-26",file:"0800.json"});
 assert.equal(r.canonical,true);assert.equal(r.hasAuthorizedPacket,false);
 assert.equal(r.originalMicroPublished,false);assert.equal(r.hasLegacyMicroState,true);
 assert.equal(r.originalMicro,null);assert.equal(r.retrospectiveW3Applied,false);
});
test("original contemporaneous authorized packet is copied, never inferred",()=>{
 const b=base();b.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure={
 status:"COMPLETE_WORKING_SELECTION",publishedAt:"2026-10-27T18:00:00Z",publicationRevision:2,
 degrees:{micro:{available:true,activeWave:"W3",direction:"UP",modelVersion:"model.v2",parentWave:"D"}}};
 const r=inspectMicroReplayFile(JSON.stringify(b),{date:"2026-10-27",file:"1100.json"});
 assert.equal(r.originalMicro.activeWave,"W3");assert.equal(r.originalMicro.publishedAt,"2026-10-27T18:00:00Z");
 assert.equal(r.originalMicro.publicationId,null);
});
test("unknown exact contract remains unavailable",()=>{
 const a=inspectMicroReplayFile(JSON.stringify(base()));
 assert.equal(a.exactContractVerified,false);assert.equal(a.exactPhysicalContract,null);
 const b=base();b.resolvedEsContract="ESZ26";
 assert.equal(inspectMicroReplayFile(JSON.stringify(b)).exactPhysicalContract,"ESZ26");
});
test("bounded Oct26 to Oct28 inventory retains source record SHA and source times",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"micro-replay-"));
 try{
  const day=path.join(root,"2026-10-26");fs.mkdirSync(day,{recursive:true});
  fs.writeFileSync(path.join(day,"0800.json"),JSON.stringify(base()));
  const r=inspectOct26MicroReplayHistory({root});
  assert.equal(r.days[0].records.length,1);
  assert.equal(r.days[0].records[0].recordSha256.length,64);
  assert.equal(r.days[1].reason,"REPLAY_DATE_NOT_FOUND");
  assert.equal(r.noBackfill,true);
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});
test("malformed replay and over-limit windows fail closed",()=>{
 assert.equal(inspectMicroReplayFile("{").reason,"INVALID_JSON");
 assert.equal(inspectOct26MicroReplayHistory({dates:["2026-10-25"]}).ok,false);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"micro-replay-"));
 try{const d=path.join(root,"2026-10-27");fs.mkdirSync(d);
 fs.writeFileSync(path.join(d,"0800.json"),JSON.stringify(base()));
 fs.writeFileSync(path.join(d,"0801.json"),JSON.stringify(base()));
 assert.equal(inspectOct26MicroReplayHistory({root,dates:["2026-10-27"],maxFilesPerDay:1}).days[0].reason,"DAY_EXCEEDS_SCAN_LIMIT");
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});

test("original Micro event source time remains absent when it was never published",()=>{
 const r=inspectMicroReplayFile(JSON.stringify(base()),{date:"2026-10-26",file:"0800.json"});
 assert.equal(r.originalMicro,null);
 assert.equal(r.retrospectiveW3Applied,false);
});
