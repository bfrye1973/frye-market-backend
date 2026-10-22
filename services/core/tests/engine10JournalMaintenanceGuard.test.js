import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {assertJournalWritable,journalMaintenanceLockPath,journalMaintenanceStatus} from "../logic/journal/journalMaintenanceGuard.js";
test("persistent Journal maintenance lock blocks writes and preserves reads",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine10-maintenance-"));
 try{
  const journal=path.join(dir,"trade-journal.json");
  fs.writeFileSync(journal,"[]");
  assert.doesNotThrow(()=>assertJournalWritable(dir));
  const lock=journalMaintenanceLockPath(dir);
  fs.writeFileSync(lock,JSON.stringify({reason:"TEST"}),{flag:"wx",mode:0o600});
  assert.equal(journalMaintenanceStatus(dir).locked,true);
  assert.throws(()=>assertJournalWritable(dir),{code:"ENGINE10_JOURNAL_MAINTENANCE_LOCKED"});
  assert.equal(fs.readFileSync(journal,"utf8"),"[]");
  fs.unlinkSync(lock);
  assert.doesNotThrow(()=>assertJournalWritable(dir));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
