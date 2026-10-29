import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import {createWaveOutcomeArchive} from "../waveObservation/createWaveOutcomeArchive.js";
import {scoreWaveOutcomes} from "../waveObservation/scoreWaveOutcomes.js";
test("stores verified and provisional 10/30 outcomes without freezing pending 60m",()=>{
 const root=fs.mkdtempSync(os.tmpdir()+"/e27-outcomes-");
 try{
  const archive=createWaveOutcomeArchive({root});
  const eventClosedAt="2026-10-28T20:10:00Z",base=Date.parse(eventClosedAt)/1000;
  const bars=[{time:base+600,close:7780},{time:base+1800,close:7770}];
  const study=scoreWaveOutcomes({eventClosedAt,eventPrice:7785,bars,asOf:"2026-10-28T20:45:00Z"});
  const data={evidenceKey:"a".repeat(64),study,recordedAt:"2026-10-28T20:45:00Z"};
  assert.equal(archive.append(data).ok,true);
  assert.equal(fs.readdirSync(archive.storagePath).filter(x=>x.endsWith(".json")).length,2);
  assert.equal(archive.append(data).ok,true);
  assert.equal(fs.readdirSync(archive.storagePath).filter(x=>x.endsWith(".json")).length,2);
  assert.equal(archive.append({...data,evidenceKey:"bad"}).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
