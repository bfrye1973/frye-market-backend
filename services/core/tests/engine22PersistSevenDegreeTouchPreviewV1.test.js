import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {persistSevenDegreeTouchPreviewV1} from "../logic/engine22/research/persistSevenDegreeTouchPreviewV1.js";
const m={micro:{countId:"c",modelKey:"m",seriesId:"ESZ6",priceBasis:"RAW",originAt:"2026-10-14T10:00:00Z",direction:"UP",levels:[{key:"e1000",price:7800}]}};
const bar=(id,high)=>({sourceBarId:id,sourceTimestamp:"2026-10-14T10:05:00Z",seriesId:"ESZ6",priceBasis:"RAW",high,low:7700,completed:true,eligible:true});
test("persisted touch survives fresh rebuild and no later price touch",()=>{
 const rootPath=fs.mkdtempSync(path.join(os.tmpdir(),"engine22-preview-"));
 try{
  const first=persistSevenDegreeTouchPreviewV1({rootPath,degreeModels:m,observationsByDegree:{micro:[bar("first",7801)]}});
  assert.equal(first.degrees.micro[0].result.status,"TOUCHED");
  const next=persistSevenDegreeTouchPreviewV1({rootPath,degreeModels:m,observationsByDegree:{micro:[bar("second",7795)]}});
  assert.equal(next.degrees.micro[0].result.status,"TOUCHED");
  assert.equal(next.degrees.micro[0].result.firstTouchedBarId,"first");
  assert.equal(fs.existsSync(path.join(rootPath,"micro.json")),true);
 } finally{fs.rmSync(rootPath,{recursive:true,force:true});}
});
test("without explicit research path nothing is persisted",()=>{
 const output=persistSevenDegreeTouchPreviewV1({degreeModels:m});
 assert.equal(output.enabled,false);
});
