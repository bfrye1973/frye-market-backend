import test from "node:test";import assert from "node:assert/strict";
import fs from "node:fs/promises";import os from "node:os";import path from "node:path";
import {maybeRefreshEngine27CrossMarketLevelsV1} from "../jobs/maybeRefreshEngine27CrossMarketLevelsV1.js";
const now=new Date("2026-10-24T20:00:00Z");
const fake=async({symbol})=>({ok:true,symbol,bars:Array.from({length:16},(_,i)=>({
time:Date.parse("2026-10-06T00:00:00Z")+i*86400000,high:symbol==="QQQ"?715+i%3:20+i%3/5,
low:symbol==="QQQ"?700+i%3:18.8+i%3/5,close:symbol==="QQQ"?704+i%3:19.2+i%3/5}))});
test("refresh once and read again without extra provider traffic",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"e27refresh-"));const filePath=path.join(dir,"levels.json");let calls=0;
 try{
  const opts={filePath,apiKey:"TEST_ONLY",now,fetchBars:async p=>{calls++;return fake(p);}};
  assert.equal((await maybeRefreshEngine27CrossMarketLevelsV1(opts)).state,"REFRESHED");
  assert.equal((await maybeRefreshEngine27CrossMarketLevelsV1(opts)).state,"CURRENT");
  assert.equal(calls,2);
  assert.equal((await fs.stat(filePath)).isFile(),true);
  assert.equal((await fs.stat(filePath+".refresh-lock").catch(()=>null)),null);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test("preexisting refresh lock is respected",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"e27locked-"));const filePath=path.join(dir,"levels.json");
 try{await fs.writeFile(filePath+".refresh-lock","");const out=await maybeRefreshEngine27CrossMarketLevelsV1({filePath,apiKey:"TEST_ONLY",now,fetchBars:fake});assert.equal(out.state,"REFRESH_ALREADY_RUNNING");}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
test("missing config skips safely",async()=>{assert.equal((await maybeRefreshEngine27CrossMarketLevelsV1({now})).state,"DISABLED_OR_UNCONFIGURED");});
