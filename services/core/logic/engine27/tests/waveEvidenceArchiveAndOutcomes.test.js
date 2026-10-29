import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createWaveEvidenceArchive} from "../waveObservation/createWaveEvidenceArchive.js";
import {scoreWaveOutcomes} from "../waveObservation/scoreWaveOutcomes.js";
const t="2026-10-28T20:10:00Z";
const candle={available:true,candleClosedAt:t,candle:{open:7784.75,high:7819.5,low:7783.75,close:7785}};
const e={ok:true,degree:"micro",sourceReplay:{sha256:"a".repeat(64)},sourceSnapshotTime:t,
 wave:{modelVersion:"micro.w3"},wickDetection:{primary:"10m",primaryAvailable:true,primaryCandle:candle},
 candleStudies:{"10m":{available:true,lastCandle:candle}}};
test("durable archive accepts primary 10m case but not supporting 1m substitute",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-evidence-"));
 try{
  const archive=createWaveEvidenceArchive({root});
  const one=archive.append(e);assert.equal(one.ok,true);
  const two=archive.append(e);assert.equal(two.ok,true);
  assert.equal(fs.readdirSync(archive.storagePath).length,1);
  assert.equal(archive.append({...e,wickDetection:{primary:"10m",primaryAvailable:false}}).ok,false);
  assert.equal(archive.append({...e,sourceReplay:{sha256:"invalid"}}).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test("10/30/60 outcomes distinguish pending, missing, and unverified contract",()=>{
 const eventClosedAt="2026-10-28T20:10:00Z",start=Date.parse(eventClosedAt)/1000;
 const bars=[{time:start+600,close:7780},{time:start+1800,close:7770},
   {time:start+3600,close:7750}];
 const r=scoreWaveOutcomes({eventClosedAt,eventPrice:7785,bars,asOf:"2026-10-28T20:45:00Z"});
 assert.equal(r.ok,true);
 assert.equal(r.horizons["10m"].deltaPoints,-5);
 assert.equal(r.horizons["10m"].statisticalEligibility,false);
 assert.equal(r.horizons["30m"].status,"CONTRACT_CONTINUITY_UNVERIFIED");
 assert.equal(r.horizons["60m"].status,"PENDING");
 const verified=scoreWaveOutcomes({eventClosedAt,eventPrice:7785,bars,asOf:"2026-10-28T21:15:00Z",contractIdentityVerified:true});
 assert.equal(verified.horizons["60m"].status,"QUALIFIED_SAME_CONTRACT");
 const noBars=scoreWaveOutcomes({eventClosedAt,eventPrice:7785,asOf:"2026-10-28T21:15:00Z"});
 assert.equal(noBars.horizons["10m"].status,"OUTCOME_MISSING");
});
