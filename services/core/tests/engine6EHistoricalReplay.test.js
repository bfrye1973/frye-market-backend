import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
test("historical replay reads only dated canonical snapshots in ascending sequence",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine6e-replay-"));
 const day=path.join(root,"replay","es","2026-11-11");fs.mkdirSync(day,{recursive:true});
 const snapshot=(id,time)=>({ok:true,symbol:"ES",snapshotTime:time,strategies:{"intraday_scalp@10m":{engine26LocationCandidate:{candidateId:id,zoneId:"z"}}}});
 fs.writeFileSync(path.join(day,"1600.json"),JSON.stringify(snapshot("B","2026-11-11T23:00:00Z")));
 fs.writeFileSync(path.join(day,"1500.json"),JSON.stringify(snapshot("A","2026-11-11T22:00:00Z")));
 const job=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../jobs/replayEngine6ENoTradeFunnel.js");
 try{
   const out=spawnSync(process.execPath,[job,"2026-11-11"],{env:{...process.env,REPLAY_DATA_DIR:root},encoding:"utf8"});
   assert.equal(out.status,0,out.stderr);
   const data=JSON.parse(out.stdout);
   assert.equal(data.observedSnapshots,2);
   assert.equal(data.noOrders,true);
   assert.equal(data.noJournalWrites,true);
   assert.equal(data.distinctCandidates,2);
   assert.equal(data.last20[0].candidateId,"B");
   assert.equal(fs.readdirSync(day).length,2);
 }finally{fs.rmSync(root,{force:true,recursive:true});}
});
