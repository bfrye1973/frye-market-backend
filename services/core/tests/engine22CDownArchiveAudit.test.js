import test from "node:test";import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {inspectEngine22CDownMorningSnapshots as audit} from "../scripts/auditCDownMorningArchiveReadOnly.js";
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine22-cdown-"));
 const dir=path.join(root,"2026-10-26");fs.mkdirSync(dir);
 const mk=(file,time,price,stage)=>fs.writeFileSync(path.join(dir,file),JSON.stringify({
  symbol:"ES",snapshotTime:time,currentPrice:price,strategies:{"intraday_scalp@10m":{
  engine22WaveStrategy:{currentWavelength:{degrees:{
   micro:{ownerMicroCDown:{version:"engine22.microCDownOwnerWatch.v1",direction:"DOWN",stage}},
   submicro:{ownerSubmicroCDown:{version:"engine22.submicroCDownOwnerWatch.v1",direction:"DOWN",stage:"DEVELOPING"}}
  }}}}}}));
 mk("0800.json","2026-10-26T15:00:00Z",7660,"DEVELOPING");
 mk("0803.json","2026-10-26T15:03:00Z",7648.5,"DEVELOPING");
 mk("0806.json","2026-10-26T15:06:00Z",7670,"WATCH");
 try{return fn(root,dir);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test("inventory records lowest archived PRICE SAMPLE, never fabricates OHLC completion",()=>fixture(root=>{
 const before=fs.readdirSync(path.join(root,"2026-10-26"));
 const x=audit({root,fromHHMM:"0800",toHHMM:"0810"});
 assert.equal(x.ok,true);assert.equal(x.lowSample.price,7648.5);
 assert.equal(x.micro.first.direction,"DOWN");assert.equal(x.micro.last.stage,"WATCH");
 assert.equal(x.cCompletionDetected,null);
 assert.equal(x.completionVerdict,"NOT_TESTABLE_FROM_SNAPSHOT_PRICES_ALONE");
 assert.deepEqual(fs.readdirSync(path.join(root,"2026-10-26")),before);
}));
test("missing day and oversized window fail closed",()=>fixture(root=>{
 assert.equal(audit({root,fromHHMM:"0900",toHHMM:"0930"}).ok,false);
 assert.equal(audit({root,limit:2}).reason,"AUDIT_WINDOW_TOO_LARGE");
}));
test("invalid file content reported and cannot pass integrity",()=>fixture((root,dir)=>{
 fs.writeFileSync(path.join(dir,"0809.json"),"{bad");
 const x=audit({root,fromHHMM:"0800",toHHMM:"0810"});
 assert.equal(x.ok,false);assert.equal(x.errors[0].file,"0809.json");
}));
