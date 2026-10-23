#!/usr/bin/env node
// Engine 10B: controlled provenance-only Journal update.
// REQUIRES maintenance lock, independently stopped writers, explicit approval,
// and the expected live Journal SHA. Never replays fills or changes accounting.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {journalMaintenanceLockPath} from "../logic/journal/journalMaintenanceGuard.js";
import {planVerifiedPrecutoverProvenance,applyVerifiedPrecutoverProvenanceToCopy}
  from "../logic/journal/verifiedPrecutoverProvenance.js";
const live=path.resolve(process.env.ENGINE10_LIVE_JOURNAL ||
  "/var/data/replay/journal/trade-journal.json");
const dir=path.dirname(live);
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
if(process.env.ENGINE10_WRITERS_STOPPED!=="CONFIRMED")
  throw Error("STOP_WRITERS_NOT_CONFIRMED");
if(process.env.ENGINE10_APPROVE_PRECUTOVER_PROVENANCE!=="YES")
  throw Error("STOP_CHANGE_NOT_APPROVED");
const lock=journalMaintenanceLockPath(dir);
if(!fs.existsSync(lock))throw Error("STOP_MAINTENANCE_LOCK_REQUIRED");
const expected=String(process.env.ENGINE10_EXPECTED_JOURNAL_SHA256||"").trim();
if(!/^[a-f0-9]{64}$/i.test(expected))throw Error("STOP_EXPECTED_HASH_REQUIRED");
const initial=fs.readFileSync(live);
if(hash(initial)!==expected)throw Error("STOP_LIVE_HASH_CHANGED");
const parsed=JSON.parse(initial);
const list=Array.isArray(parsed)?parsed:parsed.trades;
if(!Array.isArray(list))throw Error("STOP_INVALID_JOURNAL_STRUCTURE");
const plan=planVerifiedPrecutoverProvenance(list);
if(!plan.ok)throw Error("STOP_IDENTITY_MISMATCH:"+JSON.stringify(plan.errors));
if(plan.changes.length!==2)throw Error("STOP_EXPECTED_EXACTLY_TWO_CHANGES");
const updated=applyVerifiedPrecutoverProvenanceToCopy(list,plan);
const verified=planVerifiedPrecutoverProvenance(updated);
if(!verified.ok||verified.changes.length)throw Error("STOP_POST_UPDATE_VERIFICATION_FAILED");
const candidate=Array.isArray(parsed)?updated:{...parsed,trades:updated};
const data=Buffer.from(JSON.stringify(candidate,null,2)+"\n");
const stamp=Date.now();
const backup=path.join(dir,`trade-journal.before-engine10b-provenance-${stamp}.json`);
const temp=path.join(dir,`.engine10b-provenance-${stamp}-${process.pid}.tmp`);
let committed=false;
try{
 fs.writeFileSync(backup,initial,{flag:"wx",mode:0o600});
 if(hash(fs.readFileSync(backup))!==expected)throw Error("STOP_BACKUP_INTEGRITY_FAILED");
 if(!fs.existsSync(lock))throw Error("STOP_MAINTENANCE_LOCK_REMOVED");
 if(hash(fs.readFileSync(live))!==expected)throw Error("STOP_LIVE_CHANGED_DURING_PREPARE");
 fs.writeFileSync(temp,data,{flag:"wx",mode:0o600});
 if(hash(fs.readFileSync(temp))!==hash(data))throw Error("STOP_CANDIDATE_HASH_MISMATCH");
 if(!fs.existsSync(lock)||hash(fs.readFileSync(live))!==expected)
   throw Error("STOP_CONCURRENT_CHANGE_OR_LOCK_REMOVED");
 fs.renameSync(temp,live);
 committed=true;
 const newHash=hash(fs.readFileSync(live));
 if(newHash!==hash(data))throw Error("STOP_POST_SWAP_HASH_MISMATCH");
 console.log(JSON.stringify({ok:true,classificationChanges:plan.changes,
   journalSha256Before:expected,journalSha256After:newHash,
   backup,maintenanceLockPreserved:true,watermarksModified:false,
   feesModified:false,brokerOrdersModified:false},null,2));
}finally{
 if(!committed&&fs.existsSync(temp))fs.unlinkSync(temp);
}
