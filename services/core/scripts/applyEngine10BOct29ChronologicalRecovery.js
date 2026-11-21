#!/usr/bin/env node
// ENGINE 10B — owner-approved, two-fill Oct 29 production repair.
// No Schwab calls, no Engine 8 ledger/watermark edits, no replay endpoint.
// The Engine 10 maintenance guard must be active on ALL Journal writers.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {planOct29Recovery,OCT29_TARGETS} from "../logic/journal/oct29ChronologicalRecoveryPlan.js";
import {journalMaintenanceLockPath} from "../logic/journal/journalMaintenanceGuard.js";

const journalFile=path.resolve(process.env.ENGINE10_LIVE_JOURNAL||
  "/var/data/replay/journal/trade-journal.json");
const ledgerFile="/var/data/replay/engine8-private/engine8-real-fill-observer-state.json";
const dir=path.dirname(journalFile);
const lock=journalMaintenanceLockPath(dir);
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const assert=(value,message)=>{if(!value)throw Error(message);};
const expected=String(process.env.ENGINE10B_OCT29_EXPECTED_SHA||"").toLowerCase();
assert(process.env.ENGINE10B_OCT29_OWNER_APPROVED==="YES","OWNER_APPROVAL_FLAG_MISSING");
assert(/^[a-f0-9]{64}$/.test(expected),"EXPECTED_JOURNAL_SHA_REQUIRED");
assert(expected==="330e293d4a20a180b5194e838da65fac60e6acb1b7a0c275191b759854fbf196",
  "EXPECTED_SHA_NOT_OCT29_ACCEPTED_PREFLIGHT");
const initial=fs.readFileSync(journalFile);
assert(sha(initial)===expected,"JOURNAL_CHANGED_SINCE_APPROVED_PREFLIGHT");
assert(!fs.existsSync(lock),"EXISTING_MAINTENANCE_LOCK_DO_NOT_OVERRIDE");
const ledgerBefore=fs.readFileSync(ledgerFile);
const ledgerHash=sha(ledgerBefore);
let lockOwned=false,committed=false,backup=null,temp=null,updatedHash=null;
try{
 fs.writeFileSync(lock,JSON.stringify({owner:"ENGINE10B_OCT29_TWO_FILL_RECOVERY",
  createdAt:new Date().toISOString(),pid:process.pid,expectedJournalSha256:expected})+"\n",
  {flag:"wx",mode:0o600});
 lockOwned=true;
 // Guarded Journal writers stop on the maintenance lock; let in-flight
 // requests settle, then require that the on-disk bytes remain unchanged.
 await new Promise(resolve=>setTimeout(resolve,4000));
 assert(sha(fs.readFileSync(journalFile))===expected,
  "JOURNAL_CHANGED_AFTER_LOCK");
 assert(sha(fs.readFileSync(ledgerFile))===ledgerHash,
  "ENGINE8_LEDGER_CHANGED_AFTER_LOCK");
 const doc=JSON.parse(initial);
 const trades=Array.isArray(doc)?doc:doc.trades;
 assert(Array.isArray(trades),"INVALID_JOURNAL_SCHEMA");
 const planned=planOct29Recovery(trades,JSON.parse(ledgerBefore));
 assert(planned.ok,"ISOLATED_RECOVERY_PLAN_FAILED:"+JSON.stringify(planned.errors||planned.error));
 assert(planned.details.length===2&&
   OCT29_TARGETS.every(t=>planned.details.some(d=>d.tradeId===t.tradeId&&d.missing===t.missing)),
   "EXPECTED_EXACT_TWO_RECOVERY_TARGETS");
 assert(planned.details.every(d=>d.qtyBefore===1&&d.qtyAfter===2&&
   d.eventCountBefore===1&&d.eventCountAfter===2&&d.feesAfter===5.2),
   "UNEXPECTED_CANDIDATE_ACCOUNTING");

 const alreadyIngested=[
  ["SCHWAB_0747","134847497356"],
  ["SCHWAB_6380","134846674229"],
  ["SCHWAB_7727","134843232714"]
 ];
 for(const [acct,id] of alreadyIngested){
  const matches=trades.filter(t=>
   String(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel)===acct&&
   (t.events||[]).some(e=>String(e.brokerTransactionId)===id&&
     ["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL"].includes(e.eventType)));
  assert(matches.length===1,"EXPECTED_EXISTING_OCT29_FILL_MISSING_OR_DUPLICATE:"+id);
 }
 const changed=new Set(planned.details.map(d=>d.tradeId));
 assert(planned.candidate.length===trades.length,"CAMPAIGN_COUNT_CHANGED");
 for(let i=0;i<trades.length;i++){
  assert(trades[i].tradeId===planned.candidate[i].tradeId,
    "CAMPAIGN_ID_OR_ORDER_CHANGED");
  if(!changed.has(trades[i].tradeId))
   assert(JSON.stringify(trades[i])===JSON.stringify(planned.candidate[i]),
    "UNRELATED_CAMPAIGN_CHANGED");
 }
 const updated=Array.isArray(doc)?planned.candidate:{...doc,trades:planned.candidate};
 const candidate=Buffer.from(JSON.stringify(updated,null,2)+"\n");
 updatedHash=sha(candidate);
 const stamp=Date.now();
 backup=path.join(dir,`trade-journal.before-engine10b-oct29-${stamp}.json`);
 temp=path.join(dir,`.engine10b-oct29-${stamp}-${process.pid}.tmp`);
 fs.writeFileSync(backup,initial,{flag:"wx",mode:0o600});
 assert(sha(fs.readFileSync(backup))===expected,"BACKUP_HASH_MISMATCH");
 fs.writeFileSync(temp,candidate,{flag:"wx",mode:0o600});
 assert(sha(fs.readFileSync(temp))===updatedHash,"TEMP_HASH_MISMATCH");
 assert(fs.existsSync(lock),"MAINTENANCE_LOCK_DISAPPEARED");
 assert(sha(fs.readFileSync(journalFile))===expected,"LIVE_JOURNAL_CHANGED_BEFORE_SWAP");
 assert(sha(fs.readFileSync(ledgerFile))===ledgerHash,"LEDGER_CHANGED_BEFORE_SWAP");
 fs.renameSync(temp,journalFile);
 committed=true;
 assert(sha(fs.readFileSync(journalFile))===updatedHash,"POST_SWAP_HASH_MISMATCH");
 const actual=JSON.parse(fs.readFileSync(journalFile,"utf8"));
 const list=Array.isArray(actual)?actual:actual.trades;
 assert(list.length===trades.length,"POST_SWAP_CAMPAIGN_COUNT_CHANGED");
 for(const d of planned.details){
  const t=list.find(x=>x.tradeId===d.tradeId);
  assert(t&&t.qty.remainingQty===2&&t.realBroker.contracts.some(x=>x.contractId===d.newContractId),
    "RECOVERED_CONTRACT_NOT_PRESENT:"+d.missing);
 }
 assert(sha(fs.readFileSync(ledgerFile))===ledgerHash,
  "LEDGER_CHANGED_DURING_WRITE");
 console.log(JSON.stringify({ok:true,status:"ENGINE10B_OCT29_PRODUCTION_RECOVERY_APPLIED",
  campaigns:list.length,addedContracts:2,changes:planned.details,
  journalShaBefore:expected,journalShaAfter:updatedHash,
  ledgerShaUnchanged:ledgerHash,backup,watermarksModified:false,
  brokerOrdersModified:false,originalTradeIdsPreserved:true},null,2));
}catch(error){
 console.error(JSON.stringify({ok:false,status:committed?"POST_SWAP_REVIEW_REQUIRED":"RECOVERY_ABORTED_NO_JOURNAL_SWAP",
  error:String(error.message||error),backup,expectedJournalSha256:expected,
  candidateSha256:updatedHash,maintenanceLockRetained:committed},null,2));
 if(committed){lockOwned=false;process.exitCode=2;}
 else process.exitCode=2;
}finally{
 if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);
 if(lockOwned&&fs.existsSync(lock))fs.unlinkSync(lock);
}
