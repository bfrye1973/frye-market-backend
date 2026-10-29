import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {runWaveObservationBackfill} from "../waveObservation/runWaveObservationBackfill.js";
test("owner-gated backfill enumerates real filenames without writing by default",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-backfill-plan-"));
 try{
  const replayRoot=path.join(dir,"replay"),root=path.join(dir,"research"),date="2026-10-28";
  fs.mkdirSync(path.join(replayRoot,date),{recursive:true});
  fs.writeFileSync(path.join(replayRoot,date,"1301.json"),"{}");
  fs.writeFileSync(path.join(replayRoot,date,"1302.json"),"{}");
  const dry=await runWaveObservationBackfill({replayRoot,root,dates:[date]});
  assert.equal(dry.ok,true);assert.equal(dry.dryRun,true);
  assert.equal(dry.reports[0].filesAvailable,2);
  assert.equal(fs.existsSync(root),false);
  const invalid=await runWaveObservationBackfill({replayRoot,root,dates:["../../etc"]});
  assert.equal(invalid.ok,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
