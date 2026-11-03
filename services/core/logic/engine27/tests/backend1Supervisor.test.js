import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
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

test("real SIGTERM and SIGINT leave zero OS child processes",()=>fixture(async()=>{
 for(const signal of ["SIGTERM","SIGINT"]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-signal-"));
  const script=path.join(dir,"hold.mjs"),pidFile=path.join(dir,"children.log");
  fs.writeFileSync(script,'import fs from "node:fs";fs.appendFileSync(process.env.ENGINE27_TEST_PIDFILE,process.pid+"\\n");setInterval(()=>{},500);');
  let owner=null;
  try{
   owner=spawn(process.execPath,[path.resolve("services/core/jobs/superviseBackend1V6.js")],{
    stdio:"ignore",env:{...process.env,NODE_ENV:"test",
     ENGINE27_TEST_WATCHER_SCRIPT:script,ENGINE27_TEST_SERVER_SCRIPT:script,
     ENGINE27_TEST_RECORDER_SCRIPT:script,ENGINE27_TEST_RECORDER_ENABLED:"true",
     ENGINE27_TEST_PIDFILE:pidFile}});
   let pids=[];
   for(let i=0;i<60;i++){
    await delay(50);
    pids=fs.existsSync(pidFile)?fs.readFileSync(pidFile,"utf8").trim().split("\n").filter(Boolean).map(Number):[];
    if(pids.length===3)break;
   }
   assert.equal(pids.length,3,"All three children started");
   owner.kill(signal);
   await Promise.race([new Promise(resolve=>owner.once("exit",resolve)),delay(4000).then(()=>{throw Error("SUPERVISOR_HUNG")})]);
   for(let i=0;i<40&&pids.some(exists);i++)await delay(25);
   assert.ok(pids.every(pid=>!exists(pid)),signal+" left no orphaned child PIDs");
  }finally{
   if(owner&&owner.exitCode===null)owner.kill("SIGKILL");
   fs.rmSync(dir,{recursive:true,force:true});
  }
 }
}));
