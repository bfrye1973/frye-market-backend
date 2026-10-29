#!/usr/bin/env node
// READ-ONLY October 29 Engine10B production preflight.
// Reads existing Engine 10 Journal + Engine 8 durable normalized fills.
// Creates an isolated candidate in MEMORY. Writes no production files.
import fs from "node:fs";
import crypto from "node:crypto";
import {planOct29Recovery} from "../logic/journal/oct29ChronologicalRecoveryPlan.js";
const journalFile="/var/data/replay/journal/trade-journal.json";
const ledgerFile="/var/data/replay/engine8-private/engine8-real-fill-observer-state.json";
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const raw=fs.readFileSync(journalFile),ledgerBytes=fs.readFileSync(ledgerFile);
const doc=JSON.parse(raw),trades=Array.isArray(doc)?doc:doc.trades;
const ledger=JSON.parse(ledgerBytes);
const result=planOct29Recovery(trades,ledger);
// Verify the other three October 29 openings are represented exactly once.
// These identities are source facts from Engine 8A's accepted handoff.
const alreadyIngested=[
 {account:"SCHWAB_0747",id:"134847497356",strategy:"SUBMICRO"},
 {account:"SCHWAB_6380",id:"134846674229",strategy:"MICRO"},
 {account:"SCHWAB_7727",id:"134843232714",strategy:"SUBMINUTE"},
];
const verifiedPresent=alreadyIngested.map(target=>{
 const matches=trades.filter(t=>
  String(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel)===target.account&&
  Array.isArray(t.events)&&t.events.some(e=>
   String(e.brokerTransactionId)===target.id &&
   ["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL"].includes(String(e.eventType))
  )
 );
 return {account:target.account,transactionId:target.id,strategy:target.strategy,
  matchingCampaigns:matches.length,tradeIds:matches.map(x=>x.tradeId)};
});
const threeVerified=verifiedPresent.every(x=>x.matchingCampaigns===1);
const sameHash=hash(fs.readFileSync(journalFile))===hash(raw);
const sameLedger=hash(fs.readFileSync(ledgerFile))===hash(ledgerBytes);
if(!result.ok||!sameHash||!sameLedger||!threeVerified){
 console.log(JSON.stringify({ok:false,status:"BLOCKED_READ_ONLY",
  journalSha256:hash(raw),ledgerSha256:hash(ledgerBytes),
  details:result.details||[],verifiedPresent,errors:result.errors||[result.error||"EXPECTED_THREE_EXISTING_FILLS"],
  journalUnchanged:sameHash,ledgerUnchanged:sameLedger},null,2));
 process.exitCode=2;
}else{
 const after=result.candidate;
 console.log(JSON.stringify({
  ok:true,status:"ISOLATED_COPY_RECONCILED_NO_PRODUCTION_CHANGE",
  journalSha256:hash(raw),ledgerSha256:hash(ledgerBytes),
  campaignsBefore:trades.length,campaignsAfter:after.length,
  changes:result.details,verifiedPresent,
  totalNewContracts:result.details.length,
  originalJournalUnchanged:sameHash,originalLedgerUnchanged:sameLedger,
  productionApplied:false,ownerApprovalRequired:true,
  note:"No broker orders, Journal writes, watermarks or engine8 ledger updates."
 },null,2));
}
