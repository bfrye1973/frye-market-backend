import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {updateFibTouchResearchFileV1} from "../logic/engine22/research/updateFibTouchResearchFileV1.js";
const level=(degree,modelKey="m1")=>({degree,countId:"count1",modelKey,seriesId:"ESZ6",priceBasis:"RAW",key:"r618",price:7800,direction:"UP",originAt:"2026-10-14T10:00:00Z"});
const bar=(id,high)=>({sourceBarId:id,sourceTimestamp:"2026-10-14T10:05:00Z",seriesId:"ESZ6",priceBasis:"RAW",high,low:7790,eligible:true,completed:true});
test("research state survives separate calls and is isolated by degree and model",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e22-fib-"));
 try{
  const filePath=path.join(dir,"research.json");
  const a=updateFibTouchResearchFileV1({filePath,level:level("micro"),observations:[bar("first",7801)]});
  assert.equal(a.result.status,"TOUCHED");
  const b=updateFibTouchResearchFileV1({filePath,level:level("micro"),observations:[bar("later",7795)]});
  assert.equal(b.result.status,"TOUCHED");
  assert.equal(b.result.firstTouchedBarId,"first");
  const c=updateFibTouchResearchFileV1({filePath,level:level("subminute"),observations:[bar("miss",7795)]});
  assert.equal(c.result.status,"WATCH");
  const d=updateFibTouchResearchFileV1({filePath,level:level("micro","m2"),observations:[bar("miss",7795)]});
  assert.equal(d.result.status,"WATCH");
  assert.equal(d.recordCount,3);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test("invalid existing state blocks overwrite and implicit path is disallowed",()=>{
 assert.equal(updateFibTouchResearchFileV1({level:level("micro")}).ok,false);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e22-fib-"));
 try{
  const filePath=path.join(dir,"research.json");
  fs.writeFileSync(filePath,"not-json");
  assert.equal(updateFibTouchResearchFileV1({filePath,level:level("micro")}).reason,"EXISTING_STATE_INVALID_NO_OVERWRITE");
  assert.equal(fs.readFileSync(filePath,"utf8"),"not-json");
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
