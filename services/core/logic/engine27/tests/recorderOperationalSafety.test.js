import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {checkRecorderStorage} from "../waveObservation/checkRecorderStorage.js";
import {writeRecorderHeartbeat} from "../waveObservation/writeRecorderHeartbeat.js";
test("disk pressure check blocks total research size over budget",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-space-"));
 try{
  fs.writeFileSync(path.join(root,"sample.bin"),Buffer.alloc(4096));
  const result=checkRecorderStorage({root,diskMount:root,maxRootBytes:2048,minFreeBytes:0});
  assert.equal(result.ok,false);
  assert.equal(result.reason,"RESEARCH_ROOT_BUDGET_EXCEEDED");
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test("atomic heartbeat persists sanitized lifecycle status",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-heart-"));
 try{
  assert.equal(writeRecorderHeartbeat({root,status:"RUNNING",cycleCount:2}).ok,true);
  const record=JSON.parse(fs.readFileSync(path.join(root,"worker-status.json"),"utf8"));
  assert.equal(record.status,"RUNNING");assert.equal(record.cycleCount,2);
  assert.equal(writeRecorderHeartbeat({root,status:"MADE_UP"}).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
