import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createCanonicalMicroState} from "../logic/engine22/microV2/canonicalMicroState.js";
import {auditEngine22MicroV2StoreReadOnly as audit} from "../logic/engine22/history/auditMicroV2StoreReadOnly.js";
const state=()=>createCanonicalMicroState({countId:"MICRO-ORIGINAL-1",sequenceId:"SEQ-1",
 sequenceDirection:"DOWN",origin:{price:7650,source:"TEST_FIXTURE"},
 sourceTimestamp:"2026-10-26T12:00:00Z",createdAt:"2026-10-26T12:00:00Z"});
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e22e-readonly-"));
 const counts=path.join(root,"counts");fs.mkdirSync(counts);
 const s=state();fs.writeFileSync(path.join(counts,"MICRO-ORIGINAL-1.json"),JSON.stringify(s));
 fs.writeFileSync(path.join(root,"active-count.json"),JSON.stringify(s));
 fs.writeFileSync(path.join(root,"transitions.jsonl"),"");
 fs.writeFileSync(path.join(root,"recounts.jsonl"),"");
 try{return fn({root,counts,s});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test("fixture audit is read-only, checksums stable, original count ID retained",()=>fixture(({root})=>{
 const a=audit({rootDir:root}),b=audit({rootDir:root});
 assert.equal(a.ok,true);assert.equal(a.safeToMigrate,true);
 assert.equal(a.originalCountIds[0],"MICRO-ORIGINAL-1");
 assert.match(a.countFiles[0].sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(a,b);assert.equal(a.productionModified,false);
}));
test("missing journal is explicit uncertainty, not fabricated",()=>fixture(({root})=>{
 fs.rmSync(path.join(root,"transitions.jsonl"));
 const a=audit({rootDir:root});
 assert.equal(a.safeToMigrate,false);
 assert.ok(a.uncertainties.some(x=>x.code==="TRANSITION_LEDGER_ABSENT"));
}));
test("partial un-terminated JSONL cannot be accepted",()=>fixture(({root})=>{
 fs.writeFileSync(path.join(root,"transitions.jsonl"),'{"revision":1}');
 const a=audit({rootDir:root});
 assert.equal(a.ok,false);assert.equal(a.reasonCodes[0],"INTEGRITY_AUDIT_FAILED");
}));
test("invalid JSON history refuses audit",()=>fixture(({root})=>{
 fs.writeFileSync(path.join(root,"recounts.jsonl"),"{invalid}\n");
 assert.equal(audit({rootDir:root}).ok,false);
}));
test("symlinked count file or unexpected temp refuses audit",()=>fixture(({root,counts})=>{
 fs.writeFileSync(path.join(counts,"orphan.tmp"),"{}");
 assert.equal(audit({rootDir:root}).ok,false);
 fs.rmSync(path.join(counts,"orphan.tmp"));
 fs.symlinkSync(path.join(counts,"MICRO-ORIGINAL-1.json"),path.join(counts,"copy.json"));
 assert.equal(audit({rootDir:root}).ok,false);
}));
test("bad active-copy or unaccounted revision fails closed",()=>fixture(({root,s,counts})=>{
 fs.writeFileSync(path.join(root,"active-count.json"),JSON.stringify({...s,revision:3}));
 assert.equal(audit({rootDir:root}).ok,false);
 fs.writeFileSync(path.join(root,"active-count.json"),JSON.stringify(s));
 fs.writeFileSync(path.join(counts,"MICRO-ORIGINAL-1.json"),JSON.stringify({...s,revision:2}));
 const a=audit({rootDir:root});
 assert.equal(a.ok,false); // active stored copy is inconsistent
}));
test("valid canonical revision with incomplete ledger must not be safe to migrate",()=>fixture(({root,s,counts})=>{
 fs.writeFileSync(path.join(counts,"MICRO-ORIGINAL-1.json"),JSON.stringify({...s,revision:2}));
 fs.writeFileSync(path.join(root,"active-count.json"),JSON.stringify({...s,revision:2}));
 const a=audit({rootDir:root});
 assert.equal(a.ok,true);assert.equal(a.safeToMigrate,false);
 assert.deepEqual(a.uncertainties.filter(x=>x.code==="TRANSITION_REVISION_EVIDENCE_MISSING").map(x=>x.revision),[1,2]);
}));
