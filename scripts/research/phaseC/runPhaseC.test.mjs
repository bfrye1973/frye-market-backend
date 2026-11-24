import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
const runner=new URL("./runPhaseC.mjs",import.meta.url).pathname;
const mk=()=>fs.mkdtempSync(path.join(os.tmpdir(),"e3-phase-c-"));
function runWith({barValue="1000,100,103,99,101,100",expectedSha=null}={}){
 const dir=mk();
 try{
  const packets=path.join(dir,"packets.json"),bars=path.join(dir,"bars.csv"),out=path.join(dir,"out.json");
  fs.writeFileSync(packets,JSON.stringify({rows:[{replay:{
   day:"2026-11-24",tm:"0737",snap:"2026-11-24T14:37:00Z",
   e3:"LONG",price:100,zid:"ZONE",zlo:90,zhi:110,elig:true},fixture:null,
   asOfReplayVerified:false}]}));
  fs.writeFileSync(bars,barValue);
  const hash=expectedSha??crypto.createHash("sha256").update(barValue).digest("hex");
  const p=spawnSync(process.execPath,[runner,"--packets",packets,"--bars",bars,
    "--bars-sha256",hash,"--out",out],{encoding:"utf8"});
  return {status:p.status,stderr:p.stderr,
    result:fs.existsSync(out)?JSON.parse(fs.readFileSync(out,"utf8")):null};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test("missing point-in-time packet never prints made-up v6 win-rate",()=>{
 const r=runWith();
 assert.equal(r.status,2);
 assert.equal(r.result.status,"INCOMPLETE_MISSING_CAUSAL_EVIDENCE");
 assert.equal(r.result.v6,null);
 assert.equal(r.result.counts.missing,1);
 assert.equal(r.result.noPermissionCreated,true);
 assert.equal(r.result.noExecution,true);
});
test("mismatched licensed bar SHA prevents comparison",()=>{
 const r=runWith({expectedSha:"a".repeat(64)});
 assert.equal(r.status,2);
 assert.match(r.stderr,/PHASE_A_BAR_SHA256_MISMATCH/);
 assert.equal(r.result,null);
});
