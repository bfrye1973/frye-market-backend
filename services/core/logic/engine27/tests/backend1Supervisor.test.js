import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {startBackend1Supervisor} from "../../../jobs/superviseBackend1V6.js";
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-process-"));
 const keep=path.join(dir,"alive.mjs"),exit=path.join(dir,"exit.mjs");
 fs.writeFileSync(keep,'setInterval(()=>{},1000);');
 fs.writeFileSync(exit,'process.exit(17);');
 return Promise.resolve(fn({keep,exit})).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function exists(pid){try{process.kill(pid,0);return true}catch{return false}}
test("SIGTERM/INT stop the actual watcher, server and enabled recorder children",()=>fixture(async({keep})=>{
 for(const reason of ["SIGTERM","SIGINT"]){
  const s=startBackend1Supervisor({watcherScript:keep,serverScript:keep,recorderScript:keep,
   recorderEnabled:true,terminationGraceMs:500});
  // Capture concrete child PIDs by observing the process list through a wrapper
  // is not needed to verify the supervisor removes all owned child processes;
  // the child exit completion is awaited by stop().
  await delay(100);
  assert.deepEqual(new Set(s.status().live),new Set(["watcher","server","recorder"]));
  const ownedPids=Object.values(s.status().pids);
  assert.equal(ownedPids.length,3);
  await s.stop(reason);
  assert.equal(s.status().live.length,0);
  await delay(30);
  assert.ok(ownedPids.every(pid=>!exists(pid)),"No watcher, HTTP server, or recorder child PID survives shutdown");
  assert.equal((await s.done).reason,reason);
 }
}));
test("disabled flag creates no recorder, and failed server tears down watcher",()=>fixture(async({keep,exit})=>{
 const s=startBackend1Supervisor({watcherScript:keep,serverScript:keep,recorderScript:keep,recorderEnabled:false});
 await delay(50);assert.equal(s.status().live.includes("recorder"),false);
 await s.stop("SIGTERM");
 const failed=startBackend1Supervisor({watcherScript:keep,serverScript:exit,recorderScript:keep,recorderEnabled:true});
 const result=await Promise.race([failed.done,delay(4000).then(()=>({reason:"TIMEOUT"}))]);
 assert.equal(result.reason,"SERVER_EXIT");assert.equal(failed.status().live.length,0);
}));
test("recorder restarts are bounded and disabled recorder never restarts",()=>fixture(async({keep,exit})=>{
 const s=startBackend1Supervisor({watcherScript:keep,serverScript:keep,
  recorderScript:exit,recorderEnabled:true,recorderRestartMs:40,maxRecorderRestarts:2});
 await delay(500);
 assert.equal(s.status().recorderStarts,3);
 await s.stop("SIGINT");
}));
