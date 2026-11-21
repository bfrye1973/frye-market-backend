import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createReplayIntakeLedger} from "../waveObservation/createReplayIntakeLedger.js";
import {planReplayIntake} from "../waveObservation/planReplayIntake.js";
const date="2026-10-28",time="1301",item={date,time,key:date+"/"+time,sourceReplayPath:"/var/data/replay/es/2026-10-28/1301.json"};
const sourceReplay={date,time,path:item.sourceReplayPath,sha256:"a".repeat(64),hashBasis:"ORIGINAL_REPLAY_FILE_BYTES"};
const result={ok:true,stored:7,duplicates:0};
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-receipt-"));try{fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}}
test("restart resumes only unacknowledged Replay sources",()=>temp(root=>{
 const a=createReplayIntakeLedger({root});
 assert.deepEqual(a.processedFor(date),[]);
 assert.equal(a.acknowledge({item,sourceReplay,writeResult:result,acknowledgedAt:"2026-10-28T21:00:00Z"}).ok,true);
 const b=createReplayIntakeLedger({root});
 const plan=planReplayIntake({date,times:["1301","1302"],processed:b.processedFor(date)});
 assert.deepEqual(plan.items.map(x=>x.time),["1302"]);
 const again=b.acknowledge({item,sourceReplay,writeResult:{ok:true,stored:0,duplicates:7},acknowledgedAt:"2026-10-28T21:01:00Z"});
 assert.equal(again.ok,true);assert.equal(again.duplicate,true);
 assert.equal(fs.readdirSync(path.join(root,"replay-intake-receipts",date)).length,1);
}));
test("incomplete journal write cannot create processed Replay receipt",()=>temp(root=>{
 const j=createReplayIntakeLedger({root});
 assert.equal(j.acknowledge({item,sourceReplay,writeResult:{ok:true,stored:5,duplicates:0},acknowledgedAt:"2026-10-28T21:00:00Z"}).ok,false);
 assert.deepEqual(j.processedFor(date),[]);
}));
test("existing Replay key cannot silently change raw original SHA",()=>temp(root=>{
 const j=createReplayIntakeLedger({root});
 j.acknowledge({item,sourceReplay,writeResult:result,acknowledgedAt:"2026-10-28T21:00:00Z"});
 const conflict=j.acknowledge({item,sourceReplay:{...sourceReplay,sha256:"b".repeat(64)},writeResult:result,acknowledgedAt:"2026-10-28T21:05:00Z"});
 assert.equal(conflict.ok,false);assert.equal(conflict.reason,"REPLAY_RECEIPT_IDENTITY_CONFLICT");
}));
