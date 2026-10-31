import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inspectEngine12ThirtyMinuteArchiveSlot as inspect} from "../logic/engine12/thirtyMinuteReplayCadence.js";
test("first archive of half-hour slot allowed; following 3-minute runs skipped",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e12-slot-"));
 try{
  const dateYmd="2026-10-26",day=path.join(root,dateYmd);fs.mkdirSync(day);
  assert.equal(inspect({replayRoot:root,dateYmd,timeHHMM:"1301"}).skip,false);
  fs.writeFileSync(path.join(day,"1301.json"),"{}");
  assert.equal(inspect({replayRoot:root,dateYmd,timeHHMM:"1328"}).skip,true);
  assert.equal(inspect({replayRoot:root,dateYmd,timeHHMM:"1331"}).skip,false);
  fs.writeFileSync(path.join(day,"1331.json"),"{}");
  assert.equal(inspect({replayRoot:root,dateYmd,timeHHMM:"1358"}).skip,true);
  assert.equal(inspect({replayRoot:root,dateYmd,timeHHMM:"1401"}).skip,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("does not mistake unrelated files and prior day's slot as new day's archive",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e12-slot-"));
 try{
  fs.mkdirSync(path.join(root,"2026-10-25"));fs.writeFileSync(path.join(root,"2026-10-25","1358.json"),"{}");
  const d="2026-10-26";fs.mkdirSync(path.join(root,d));fs.writeFileSync(path.join(root,d,"markers.json"),"{}");
  assert.equal(inspect({replayRoot:root,dateYmd:d,timeHHMM:"1358"}).skip,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("malformed slot inputs fail closed to caller",()=>{
 assert.equal(inspect({replayRoot:"/tmp",dateYmd:"2026-10-26",timeHHMM:"1399"}).ok,false);
});
