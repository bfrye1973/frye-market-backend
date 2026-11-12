import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {removeUnusedSpySnapshots} from "../scripts/removeUnusedSpySnapshots.js";
test("SPY snapshot dry-run and cleanup preserve ES and journal",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"frye-spy-clean-"));
 try{
  fs.writeFileSync(path.join(dir,"strategy-snapshot.json"),'{"symbol":"SPY"}');
  fs.writeFileSync(path.join(dir,"strategy-snapshot-es.json"),'{"symbol":"ES"}');
  fs.writeFileSync(path.join(dir,"trade-journal.json"),'{"trades":[]}');
  assert.equal(removeUnusedSpySnapshots({dataDir:dir}).deleted,0);
  assert.equal(removeUnusedSpySnapshots({dataDir:dir,apply:true}).deleted,1);
  assert.equal(fs.existsSync(path.join(dir,"strategy-snapshot.json")),false);
  assert.ok(fs.existsSync(path.join(dir,"strategy-snapshot-es.json")));
  assert.ok(fs.existsSync(path.join(dir,"trade-journal.json")));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("cleanup refuses symlinks to protected market data",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"frye-spy-safe-"));
 try{
  const es=path.join(dir,"strategy-snapshot-es.json");
  fs.writeFileSync(es,'{"symbol":"ES"}');
  fs.symlinkSync(es,path.join(dir,"strategy-snapshot.json"));
  assert.throws(()=>removeUnusedSpySnapshots({dataDir:dir,apply:true}),/refusing non-regular/);
  assert.ok(fs.existsSync(es));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("only ES is scheduled and direct SPY build is retired",()=>{
 const root=path.resolve(import.meta.dirname,"..");
 const wrapper=fs.readFileSync(path.join(root,"jobs/buildAllStrategySnapshots.js"),"utf8");
 const builder=fs.readFileSync(path.join(root,"jobs/buildStrategySnapshot.js"),"utf8");
 assert.match(wrapper,/const SYMBOLS = \["ES"\]/);
 assert.doesNotMatch(wrapper,/const SYMBOLS = \["SPY", "ES"\]/);
 assert.match(builder,/SPY retired; no file generated/);
 assert.match(builder,/process\.env\.SYMBOL \|\| "ES"/);
});
