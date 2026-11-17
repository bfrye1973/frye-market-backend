import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadVerifiedEngine10PaperLock as load,saveVerifiedEngine10PaperLock as save,
 clearVerifiedEngine10PaperLock as clear} from "../logic/engine3/v6/engine3Engine10VerifiedLockStore.js";
const good=t=>({source:"ENGINE10_JOURNAL",symbol:"ES",
 strategyId:"intraday_scalp@10m",tradeId:"T-1",lockedTradeDirection:"SHORT",
 remainingQty:3,verifiedAtMs:t,lifecycleVerified:true,
 openTradeActive:true,fallbackFromVerified:false});
test("journal cache writes only fresh verified lock, never fallback, and expires externally",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e3-lock-"));
 const filePath=path.join(dir,"lock.json");
 try{
  assert.equal(load({filePath}).found,false);
  assert.equal(save({filePath,result:good(100000)}).saved,true);
  assert.equal(load({filePath}).lock.lockedTradeDirection,"SHORT");
  assert.equal(save({filePath,result:{...good(100001),fallbackFromVerified:true}}).saved,false);
  assert.equal(save({filePath,result:good(99999)}).saved,false);
  assert.equal(load({filePath}).lock.verifiedAtMs,100000);
  assert.equal(clear({filePath}).cleared,true);
  assert.equal(load({filePath}).found,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("bad cache is rejected without silently becoming verified",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e3-lock-"));
 const filePath=path.join(dir,"lock.json");
 try{
  fs.writeFileSync(filePath,"{invalid");
  assert.equal(load({filePath}).found,false);
  assert.equal(save({filePath,result:{...good(100000),lifecycleVerified:false}}).saved,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
