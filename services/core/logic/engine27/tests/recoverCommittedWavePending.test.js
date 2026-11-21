import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {recoverCommittedWavePending} from "../waveObservation/recoverCommittedWavePending.js";
test("only cleans byte-identical committed pending files and leaves uncertain cases intact",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-recover-"));
 try{
  const dir=path.join(root,"events");fs.mkdirSync(dir);
  const id="a".repeat(64),name="1793217600000-"+id+".json";
  const content=JSON.stringify({eventId:id,degree:"micro"})+"\n";
  fs.writeFileSync(path.join(dir,name),content);fs.writeFileSync(path.join(dir,name+".pending"),content);
  assert.deepEqual(recoverCommittedWavePending({root}),{ok:true,recovered:1,blocked:0,reason:null});
  assert.equal(fs.existsSync(path.join(dir,name+".pending")),false);
  fs.writeFileSync(path.join(dir,"unknown.pending"),"unknown");
  const v=recoverCommittedWavePending({root});
  assert.equal(v.ok,false);assert.equal(v.blocked,1);
  assert.equal(fs.existsSync(path.join(dir,"unknown.pending")),true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
