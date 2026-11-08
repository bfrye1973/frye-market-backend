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
  fs.writeFileSync(path.join(replayRoot,date,"1301.json"),JSON.stringify({schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",snapshotTime:"2026-10-28T20:00:00Z"}));
  fs.writeFileSync(path.join(replayRoot,date,"1302.json"),JSON.stringify({schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",snapshotTime:"2026-10-28T20:02:00Z"}));
  const dry=await runWaveObservationBackfill({replayRoot,root,dates:[date]});
  assert.equal(dry.ok,true);assert.equal(dry.dryRun,true);
  assert.equal(dry.reports[0].filesAvailable,2);assert.equal(dry.reports[0].filesChecked,2);assert.equal(dry.reports[0].invalidCount,0);
  assert.equal(fs.existsSync(root),false);
  const invalid=await runWaveObservationBackfill({replayRoot,root,dates:["../../etc"]});
  assert.equal(invalid.ok,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test("dry run fails closed on malformed historical content without creating journal",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-malformed-"));
 try{
  const replayRoot=path.join(dir,"replay"),root=path.join(dir,"research"),date="2026-10-28";
  fs.mkdirSync(path.join(replayRoot,date),{recursive:true});
  fs.writeFileSync(path.join(replayRoot,date,"1301.json"),"{}");
  const result=await runWaveObservationBackfill({replayRoot,root,dates:[date]});
  assert.equal(result.ok,false);assert.equal(result.reason,"DRY_RUN_ORIGINAL_REPLAY_VALIDATION_FAILED");
  assert.equal(fs.existsSync(root),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
