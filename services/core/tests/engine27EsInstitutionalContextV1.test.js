import test from "node:test";import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {readEngine27EsInstitutionalContextV1} from "../logic/engine27/crossMarket/readEsInstitutionalContextV1.js";
test("shares Engine1 parent vs negotiated zones with no rewriting",()=>{
 const filePath=path.join(os.tmpdir(),"e27-es-smz-"+process.pid+".json");
 fs.writeFileSync(filePath,JSON.stringify({structures:[
  {structureKey:"MANUAL|ES|PARENT",displayPriceRange:[7840,7820],status:"active"},
  {structureKey:"MANUAL|ES|NEG|1",priceRange:[7675,7651.75],isNegotiated:true}
 ]}));
 try{const o=readEngine27EsInstitutionalContextV1({filePath});assert.equal(o.available,true);
 assert.equal(o.institutionalParents.length,1);assert.equal(o.negotiatedZones.length,1);
 assert.equal(o.negotiatedZones[0].midline,7663.375);assert.equal(o.noExecution,true);}
 finally{fs.rmSync(filePath,{force:true});}
});
test("missing source fails closed",()=>{
 const o=readEngine27EsInstitutionalContextV1({filePath:"/tmp/no-e27-smz-file-ever.json"});
 assert.equal(o.available,false);assert.deepEqual(o.institutionalParents,[]);
});
