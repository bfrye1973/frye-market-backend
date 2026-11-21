import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadEngine3V6Phase1ShadowState as load,
 saveEngine3V6Phase1ShadowState as save}
 from "../logic/engine3/v6/engine3V6Phase1ShadowStore.js";
const state=t=>({schema:"engine3.v6.phase1.shadow.v1",mode:"SHADOW_READ_ONLY",
 canonicalDirection:"SHORT",candidateId:"A",lastEvaluatedAtMs:t,noPermissionCreated:true,
 authoritativeDownstream:false,reactionAnchor:7353,establishedAtMs:1000});
test("shadow state survives reload and refuses stale overwrites",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e3-v6-shadow-"));
 const filePath=path.join(dir,"state.json");
 try{
  assert.equal(load({filePath}).found,false);
  assert.equal(save({filePath,state:state(2000)}).saved,true);
  assert.equal(load({filePath}).state.canonicalDirection,"SHORT");
  assert.equal(save({filePath,state:state(1999)}).saved,false);
  assert.equal(save({filePath,state:state(2000)}).saved,false);
  assert.equal(save({filePath,state:{...state(3000),noPermissionCreated:false}}).saved,false);
  assert.equal(save({filePath,state:state(3000)}).saved,true);
  assert.equal(load({filePath}).state.lastEvaluatedAtMs,3000);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("corrupted record fails neutral without touching v5",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e3-v6-shadow-"));
 const filePath=path.join(dir,"state.json");
 try{fs.writeFileSync(filePath,"{ invalid json");
  const r=load({filePath});assert.equal(r.ok,false);
  assert.equal(r.state.canonicalDirection,"NEUTRAL");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
