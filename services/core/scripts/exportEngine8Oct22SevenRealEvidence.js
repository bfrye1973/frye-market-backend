#!/usr/bin/env node
// Engine 8A read-only original Schwab evidence exporter for Engine 10's
// Oct 22 seven-REAL-account offline acceptance. Does NOT mutate Engine 8/10
// durable state, call a broker write endpoint, or advance watermarks.
// Only writes a mode-0600 evidence artifact under a private /tmp directory.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {getSchwabAccountNumbers,schwabApiRequest} from "../logic/trading/schwab/schwabClient.js";
import {selectApprovedSchwabRealAccounts} from "../logic/trading/schwab/selectApprovedSchwabRealAccounts.js";
import {
  normalizeSchwabRealFutureTransaction,
  normalizeSchwabRealFutureTransactionLegs
} from "../logic/trading/schwab/engine8RealFillNormalizer.js";

const CUTOVER="2026-10-22T07:00:00.000Z";
const TARGETS=new Map([
 ["134208339582","SCHWAB_0747"],
 ["134198983672","SCHWAB_0747"],
 ["134198983630","SCHWAB_0747"],
 ["134210587334","SCHWAB_6380"],
 ["134200409656","SCHWAB_6380"],
 ["134198140062","SCHWAB_6380"],
 ["134209487262","SCHWAB_5671"],
]);
const idOf=t=>String(t?.activityId??t?.transactionId??t?.id??"").trim();
const end=new Date().toISOString();
const discovered=await getSchwabAccountNumbers();
const selected=selectApprovedSchwabRealAccounts(discovered.accounts||[],{accountScope:"SEVEN_STRATEGIES"});
if(!selected.ok)throw Error("SEVEN_APPROVED_ACCOUNT_DISCOVERY_FAILED:"+JSON.stringify(selected.errors));
const openings=[],errors=[],accountCounts={};
for(const {account,identity} of selected.approved){
 const query="/accounts/"+encodeURIComponent(account.accountHash)+"/transactions"+
  "?startDate="+encodeURIComponent(CUTOVER)+"&endDate="+encodeURIComponent(end)+"&types=TRADE";
 const response=await schwabApiRequest(query,{method:"GET",operation:"ENGINE8_OCT22_EVIDENCE_READ_FAILED"});
 if(!Array.isArray(response.body))throw Error("SCHWAB_TRANSACTION_RESPONSE_INVALID_"+identity.brokerAccountLabel);
 const txs=response.body;
 accountCounts[identity.brokerAccountLabel]={transactions:txs.length,verifiedTargetFillLegs:0};
 for(const tx of txs){
  const brokerId=idOf(tx);
  if(!TARGETS.has(brokerId))continue;
  if(TARGETS.get(brokerId)!==identity.brokerAccountLabel){
   errors.push({id:brokerId,reason:"BROKER_ACCOUNT_MISMATCH"});
   continue;
  }
  let result=normalizeSchwabRealFutureTransaction({
   transaction:tx,maskedAccountNumber:account.maskedAccountNumber,accountScope:"SEVEN_STRATEGIES"
  });
  if(!result.ok && result.reason==="MULTIPLE_FUTURE_TRANSFER_ITEMS_UNSUPPORTED"){
   result=normalizeSchwabRealFutureTransactionLegs({
    transaction:tx,maskedAccountNumber:account.maskedAccountNumber,accountScope:"SEVEN_STRATEGIES"
   });
  }
  if(!result.ok){
   errors.push({id:brokerId,reason:result.reason});
   continue;
  }
  const candidates=result.candidates||[{fill:result.fill}];
  for(const row of candidates){
   const f=row.fill;
   if(f.positionEffect!=="OPENING"||f.direction!=="LONG"||f.futuresContractCode!=="MESZ26"){
    errors.push({id:brokerId,reason:"UNEXPECTED_FILL_GEOMETRY"});
    continue;
   }
   const stamp=Date.parse(f.fillTime);
   if(!Number.isFinite(stamp)||stamp<Date.parse(CUTOVER)){
    errors.push({id:brokerId,reason:"OUTSIDE_CUTOVER"});
    continue;
   }
   openings.push({
    ...f,fillTime:new Date(stamp).toISOString(),originalFillTime:f.fillTime,
    brokerAccountLabel:identity.brokerAccountLabel
   });
   accountCounts[identity.brokerAccountLabel].verifiedTargetFillLegs++;
  }
 }
}
const foundIds=new Set(openings.map(x=>String(x.brokerTransactionId)));
for(const id of TARGETS.keys())if(!foundIds.has(id))errors.push({id,reason:"TARGET_FILL_NOT_FOUND"});
if(errors.length||openings.length!==7||foundIds.size!==7){
 console.error(JSON.stringify({status:"BLOCKED",accounts:accountCounts,errors,found:openings.length}));
 process.exit(2);
}
openings.sort((a,b)=>Date.parse(a.fillTime)-Date.parse(b.fillTime));
const evidence={
 schema:"engine8.oct22OriginalSchwabOpeningEvidence.v1",
 cutoverUtc:CUTOVER,collectedAt:end,accountCounts,openings
};
const evidencePath=path.join("/tmp","engine8-oct22-seven-openings-"+Date.now()+".json");
fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2),{mode:0o600,flag:"wx"});
fs.chmodSync(evidencePath,0o600);
const sha=crypto.createHash("sha256").update(fs.readFileSync(evidencePath)).digest("hex");
console.log(JSON.stringify({status:"READ_ONLY_EVIDENCE_READY",
 evidenceFile:evidencePath,sha256:sha,verifiedOpenings:openings.length,
 accounts:accountCounts,cutoverUtc:CUTOVER,
 note:"Keep private file inside Render; never paste full broker evidence, OAuth credentials or hashes in chat."},null,2));
