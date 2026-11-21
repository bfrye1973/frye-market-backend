import test from "node:test";
import assert from "node:assert/strict";
import {planReplayIntake,verifyReplayIntakeReceipt} from "../waveObservation/planReplayIntake.js";
const date="2026-10-28",identity={date,time:"1301",path:"/var/data/replay/es/2026-10-28/1301.json",sha256:"a".repeat(64),hashBasis:"ORIGINAL_REPLAY_FILE_BYTES"};
test("restart safely discovers missing file even when newer was already processed",()=>{
 const result=planReplayIntake({date,times:["1303","1301","1302","1301"],processed:["2026-10-28/1303"],maxBatch:1});
 assert.equal(result.ok,true);assert.deepEqual(result.items.map(x=>x.time),["1301"]);
 assert.equal(result.remaining,2);assert.equal(result.hasMore,true);
 assert.equal(result.duplicatesInListing,1);
 const restart=planReplayIntake({date,times:["1303","1301","1302"],processed:["2026-10-28/1303","2026-10-28/1301"]});
 assert.deepEqual(restart.items.map(x=>x.time),["1302"]);
});
test("rejects invalid listing and pathological batch sizes",()=>{
 assert.equal(planReplayIntake({date,times:["1260"]}).ok,false);
 assert.equal(planReplayIntake({date,times:["1301"],maxBatch:5000}).ok,false);
});
test("acknowledges source-qualified durable seven-degree journal write only",()=>{
 const item=planReplayIntake({date,times:["1301"]}).items[0];
 assert.equal(verifyReplayIntakeReceipt({item,sourceReplay:identity,writeResult:{ok:true,stored:7,duplicates:0}}).acknowledged,true);
 assert.equal(verifyReplayIntakeReceipt({item,sourceReplay:identity,writeResult:{ok:true,stored:0,duplicates:7}}).acknowledged,true);
 assert.equal(verifyReplayIntakeReceipt({item,sourceReplay:identity,writeResult:{ok:true,stored:3,duplicates:0}}).acknowledged,false);
 assert.equal(verifyReplayIntakeReceipt({item,sourceReplay:{...identity,hashBasis:"API_REENCODED"},writeResult:{ok:true,stored:7,duplicates:0}}).acknowledged,false);
});
