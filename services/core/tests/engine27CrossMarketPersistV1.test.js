import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {persistEngine27CrossMarketLevelsV1} from "../jobs/persistEngine27CrossMarketLevelsV1.js";
import {readEngine27CrossMarketLevelsV1} from "../jobs/readEngine27CrossMarketLevelsV1.js";
const now=new Date("2026-10-24T19:00:00Z");
const fake=async ({symbol})=>({ok:true,symbol,bars:Array.from({length:16},(_,i)=>({
 time:Date.parse("2026-10-06T00:00:00Z")+i*86400000,
 high:symbol==="QQQ"?715+(i%3):20+(i%3)*0.2,
 low:symbol==="QQQ"?700+(i%3):18.9+(i%3)*0.2,
 close:symbol==="QQQ"?704+(i%3):19.2+(i%3)*0.2
}))});
test("atomic publication preserves both markets and is readable without re-fetching",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"engine27-cross-"));
 try{
  const filePath=path.join(root,"levels.json");
  const result=await persistEngine27CrossMarketLevelsV1({filePath,apiKey:"TEST_ONLY",fetchBars:fake,now});
  assert.equal(result.written,true);
  const loaded=readEngine27CrossMarketLevelsV1({filePath,now});
  assert.equal(loaded.instruments.QQQ.available,true);
  assert.equal(loaded.instruments.VIX.available,true);
  assert.equal(readEngine27CrossMarketLevelsV1({filePath,now:new Date("2026-11-15T00:00:00Z")}).instruments.VIX.available,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test("explicit persistence path is mandatory",async()=>{
 const r=await persistEngine27CrossMarketLevelsV1({apiKey:"TEST_ONLY",now,fetchBars:fake});
 assert.equal(r.written,false);
 assert.equal(r.reason,"ABSOLUTE_PUBLICATION_PATH_REQUIRED");
});
