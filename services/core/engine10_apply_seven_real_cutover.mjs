#!/usr/bin/env node
// Controlled Engine 10 cutover: never run while any Journal writer is active.
// Requires explicit operator acknowledgement after writers are stopped.
// This script only installs the two-classification candidate; MINOR is separate.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const live=process.env.ENGINE10_LIVE_JOURNAL||"/var/data/replay/journal/trade-journal.json";
const workspace="/var/data/replay/journal-recovery-sandbox/seven-real-prepared-2026-10-22T20-00-19-258Z";
const source=path.join(workspace,"original-journal.json");
const candidate=path.join(workspace,"candidate-journal.json");
const expectedSource="13757373ae6ed4f0b0cc0ea489269695cc33e89791972472a6450243375fada5";
const expectedCandidate="7c72d7fc4dac85f68a143a7ff12d0957c075bb12d540e9051193f054de5d8368";
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
if(process.env.ENGINE10_WRITERS_STOPPED!=="CONFIRMED")throw Error("STOP_WRITERS_NOT_CONFIRMED");
if(process.env.ENGINE10_APPROVE_TWO_CLASSIFICATIONS!=="YES")throw Error("STOP_MIGRATION_NOT_APPROVED");
const original=fs.readFileSync(source),replacement=fs.readFileSync(candidate),current=fs.readFileSync(live);
if(hash(original)!==expectedSource||hash(replacement)!==expectedCandidate)throw Error("STOP_SOURCE_HASH_MISMATCH");
if(hash(current)!==expectedSource)throw Error("STOP_LIVE_JOURNAL_CHANGED");
const oldTrades=JSON.parse(current),newTrades=JSON.parse(replacement);
if(!Array.isArray(oldTrades)||!Array.isArray(newTrades)||oldTrades.length!==63||newTrades.length!==63)throw Error("STOP_CAMPAIGN_COUNT");
const allowed=new Map([
 ["TRD-MES-schwab_real_broker-2026-10-22T12-05-14+0000-a998","MICRO"],
 ["TRD-MES-schwab_real_broker-2026-10-22T12-12-38+0000-1bca","SUBMICRO"]
]);
let changed=0;
for(let i=0;i<oldTrades.length;i++){
 const a=structuredClone(oldTrades[i]),b=structuredClone(newTrades[i]);
 if(a.tradeId!==b.tradeId)throw Error("STOP_TRADE_ORDER_OR_IDENTITY_CHANGED");
 for(const field of ["performanceGroup","performanceClassificationSource","performanceClassificationVersion"]){delete a[field];delete b[field];}
 if(JSON.stringify(a)!==JSON.stringify(b))throw Error("STOP_UNAUTHORIZED_TRADE_CHANGE");
 const diff=JSON.stringify(oldTrades[i])!==JSON.stringify(newTrades[i]);
 if(diff){changed++;if(allowed.get(newTrades[i].tradeId)!==newTrades[i].performanceGroup)throw Error("STOP_UNAUTHORIZED_CLASSIFICATION");}
}
if(changed!==2)throw Error("STOP_EXPECTED_TWO_CLASSIFICATIONS");
const backup=path.join(path.dirname(live),`trade-journal.before-seven-real-${Date.now()}.json`);
fs.writeFileSync(backup,current,{flag:"wx",mode:0o600});
if(hash(fs.readFileSync(backup))!==expectedSource)throw Error("STOP_BACKUP_FAILED");
if(hash(fs.readFileSync(live))!==expectedSource)throw Error("STOP_LIVE_CHANGED_BEFORE_SWAP");
const temp=path.join(path.dirname(live),`.seven-real-cutover-${process.pid}.tmp`);
fs.writeFileSync(temp,replacement,{flag:"wx",mode:0o600});
if(hash(fs.readFileSync(temp))!==expectedCandidate)throw Error("STOP_TEMP_HASH_FAILED");
fs.renameSync(temp,live);
const actual=hash(fs.readFileSync(live));
const result={schema:"engine10.sevenRealCutoverApplied.v1",success:actual===expectedCandidate,backup,backupHash:expectedSource,liveHash:actual,classificationChanges:changed,minorIngested:false,watermarksModified:false};
console.log(JSON.stringify(result,null,2));
if(!result.success)process.exitCode=2;
