import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {runRecorderWorker} from "../waveObservation/runRecorderWorker.js";
test("worker disabled by default leaves no disk state",async()=>{
 const dir=path.join(os.tmpdir(),"e27-disabled-"+process.pid);
 const r=await runRecorderWorker({enabled:false,rootDir:dir});
 assert.equal(r.status,"DISABLED");assert.equal(fs.existsSync(dir),false);
});
test("singleton owner processes bounded cycle and cleanly releases lease",async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),"e27-worker-"));
 try{
  const replay=path.join(base,"es"),rootDir=path.join(base,"research");
  fs.mkdirSync(replay);
  let called=0;
  const r=await runRecorderWorker({enabled:true,replayRoot:replay,rootDir,maxCycles:1,
   onCycle:async p=>{called++;assert.equal(p.maxBatch,1);return {ok:true}}});
  assert.equal(r.ok,true);assert.equal(called,1);
  assert.equal(fs.existsSync(path.join(rootDir,".single-worker-lease")),false);
  fs.mkdirSync(path.join(rootDir,".single-worker-lease"));
  const blocked=await runRecorderWorker({enabled:true,replayRoot:replay,rootDir,maxCycles:1,
   onCycle:async()=>{throw Error("must not run")}});
  assert.equal(blocked.status,"ANOTHER_WORKER_OR_STALE_LEASE");
 }finally{fs.rmSync(base,{force:true,recursive:true})}
});
test("missing persistent archive prevents worker activation",async()=>{
 const r=await runRecorderWorker({enabled:true,replayRoot:"/path/that/is/not/mounted",
  onCycle:async()=>({ok:true})});
 assert.equal(r.status,"REPLAY_DISK_MISSING");
});

test("controlled worker failure releases singleton so restart is possible",async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),"e27-cycle-fail-"));
 try{
  const replay=path.join(base,"es"),rootDir=path.join(base,"research");
  fs.mkdirSync(replay);
  const fail=await runRecorderWorker({enabled:true,replayRoot:replay,rootDir,maxCycles:1,
   storagePreflight:()=>({ok:true}),
   onCycle:async()=>({ok:false,reason:"SOURCE_STALE"})});
  assert.equal(fail.status,"CYCLE_FAILED");
  assert.equal(fs.existsSync(path.join(rootDir,".single-worker-lease")),false);
  const restart=await runRecorderWorker({enabled:true,replayRoot:replay,rootDir,maxCycles:1,
   storagePreflight:()=>({ok:true}),onCycle:async()=>({ok:true})});
  assert.equal(restart.ok,true);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
