#!/usr/bin/env node
// Engine10B PRIVATE, READ-ONLY production preflight. No journal writes.
import fs from "node:fs";
import crypto from "node:crypto";
import {planVerifiedPrecutoverProvenance,applyVerifiedPrecutoverProvenanceToCopy}
  from "../logic/journal/verifiedPrecutoverProvenance.js";
const file=process.env.ENGINE10_LIVE_JOURNAL||"/var/data/replay/journal/trade-journal.json";
const original=fs.readFileSync(file);
const journal=JSON.parse(original);
const trades=Array.isArray(journal)?journal:journal.trades;
if(!Array.isArray(trades))throw Error("UNEXPECTED_JOURNAL_STRUCTURE");
const plan=planVerifiedPrecutoverProvenance(trades);
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
if(!plan.ok){
 console.log(JSON.stringify({ok:false,schema:"engine10b.precutoverReadOnlyPreflight.v1",
   journalSha256:sha(original),campaignCount:trades.length,errors:plan.errors,readOnly:true},null,2));
 process.exitCode=2;
}else{
 const copy=applyVerifiedPrecutoverProvenanceToCopy(trades,plan);
 const after=planVerifiedPrecutoverProvenance(copy);
 const integrity=copy.length===trades.length &&
   copy.every((t,i)=>{
     const a=structuredClone(t),b=structuredClone(trades[i]);
     delete a.performanceClassificationSource;delete b.performanceClassificationSource;
     delete a.performanceClassificationVersion;delete b.performanceClassificationVersion;
     return JSON.stringify(a)===JSON.stringify(b);
   }) &&
   after.ok&&after.changes.length===0;
 console.log(JSON.stringify({ok:integrity,schema:"engine10b.precutoverReadOnlyPreflight.v1",
   journalSha256:sha(original),campaignCount:trades.length,
   provenanceChanges:plan.changes,alreadyApplied:plan.changes.length===0,
   unchangedNonProvenanceFields:integrity,readOnly:true,
   note:"No production Journal changes were made; copy was held only in memory."},null,2));
 if(!integrity)process.exitCode=2;
}
