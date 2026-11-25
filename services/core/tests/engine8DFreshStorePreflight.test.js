import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const base = fs.mkdtempSync(path.join(os.tmpdir(),"engine8d-fresh-preflight-"));
const store = path.join(base,"engine8-paper");
const script = path.resolve("services/core/scripts/auditEngine8PaperStorage.js");
const run = () => spawnSync(process.execPath,[script],{
  env:{...process.env,ENGINE8_PAPER_DATA_DIR:store},encoding:"utf8"
});
test("missing new PAPER store passes preflight and creates no files",()=>{
  const r=run();
  assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).readyForFreshUse,true);
  assert.equal(fs.existsSync(store),false);
});
test("clean but empty new store passes without modifying directory",()=>{
  fs.mkdirSync(store);
  const r=run();
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(fs.readdirSync(store),[]);
});
test("existing PAPER identities require review, never reset",()=>{
  const file=path.join(store,"paper-idempotency-ledger.json");
  const original='{"EXISTING":{"orderId":"PAPER-IDENTITY"}}';
  fs.writeFileSync(file,original);
  const r=run();
  assert.equal(r.status,2);
  const output=JSON.parse(r.stdout);
  assert.equal(output.readyForFreshUse,false);
  assert.equal(output.files.find(x=>x.file==="paper-idempotency-ledger.json").recordCount,1);
  assert.equal(fs.readFileSync(file,"utf8"),original);
});
test("unknown lock or migration marker requires review, never delete",()=>{
  const lock=path.join(store,".instruction-locks");
  fs.mkdirSync(lock);
  const r=run();
  assert.equal(r.status,2);
  assert.equal(fs.existsSync(lock),true);
});
process.on("exit",()=>fs.rmSync(base,{recursive:true,force:true}));
