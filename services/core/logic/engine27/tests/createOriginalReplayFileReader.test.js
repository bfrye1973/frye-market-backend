import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createOriginalReplayFileReader} from "../waveObservation/createOriginalReplayFileReader.js";
const item={date:"2026-10-28",time:"1301",key:"2026-10-28/1301",sourceReplayPath:"/var/data/replay/es/2026-10-28/1301.json"};
const temp=async fn=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-raw-"));try{await fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}};
test("reads original byte-identical Replay instead of reserialized JSON",()=>temp(async root=>{
 const dir=path.join(root,item.date);fs.mkdirSync(dir);
 const raw=Buffer.from('{ "schema": "test" }\n');
 fs.writeFileSync(path.join(dir,"1301.json"),raw);
 const read=createOriginalReplayFileReader({replayRoot:root});
 const got=await read(item);assert.deepEqual(got.bytes,raw);
}));
test("rejects forged path, symlink and oversize source",()=>temp(async root=>{
 const dir=path.join(root,item.date);fs.mkdirSync(dir);
 const path1=path.join(dir,"1301.json");fs.writeFileSync(path1,"1234567890");
 const read=createOriginalReplayFileReader({replayRoot:root,maxBytes:8});
 await assert.rejects(read(item),/REPLAY_FILE_SIZE_UNSAFE/);
 await assert.rejects(read({...item,key:"2026-10-28/1302"}),/UNTRUSTED_REPLAY_PATH/);
 fs.unlinkSync(path1);fs.symlinkSync(path.join(root,"outside"),path1);
 await assert.rejects(read(item),/UNSAFE_REPLAY_FILE/);
}));
