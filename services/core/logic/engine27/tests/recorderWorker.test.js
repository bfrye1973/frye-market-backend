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
   onCycle:async p=>{called++;assert.equal(p.maxBatch,60);return {ok:true}}});
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

test("midnight sweep continues prior-day intake and maintains 14-day oldest-first retention",async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),"e27-midnight-"));
 try{
  const replay=path.join(base,"es"),rootDir=path.join(base,"research");
  fs.mkdirSync(replay);
  const seen=[],clock=()=>new Date("2026-10-29T07:01:00Z");
  const done=await runRecorderWorker({enabled:true,replayRoot:replay,rootDir,
   clock,retentionDays:14,maxCycles:1,storagePreflight:()=>({ok:true}),
   onCycle:async p=>{seen.push(p);return {ok:true}}});
  assert.equal(done.ok,true);
  assert.equal(seen.length,1);
  assert.equal(seen[0].dates[0],"2026-10-16");
  assert.equal(seen[0].dates.at(-2),"2026-10-28");
  assert.equal(seen[0].dates.at(-1),"2026-10-29");
  assert.equal(seen[0].maxTotalBatch,60);
  const restarted=await runRecorderWorker({enabled:true,replayRoot:replay,rootDir,
   clock:()=>new Date("2026-10-29T13:00:00Z"),maxCycles:1,
   storagePreflight:()=>({ok:true}),onCycle:async p=>{seen.push(p);return {ok:true}}});
  assert.equal(restarted.ok,true);
  assert.ok(seen[1].dates.includes("2026-10-28"));
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
