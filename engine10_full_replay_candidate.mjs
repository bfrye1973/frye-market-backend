// Isolated Engine 10 historical replay candidate. Fail closed; never writes production.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root="/var/data/replay";
const frozen=root+"/journal-recovery-sandbox/20261021-engine10-pre-reconstruction/trade-journal.json";
const evidence=root+"/engine8-private/engine8-final-inventory-evidence-2026-10-21T21-03-13-346Z";
const sandbox=root+"/journal-recovery-sandbox/20261021-engine10-pre-reconstruction/full-replay";
const hash=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const expectedJournal="ff4240448d4f9f775f0161fc54bd379eaa2c199b2f7ca580c367feea222415b1";
if(hash(frozen)!==expectedJournal)throw Error("FROZEN_JOURNAL_CHANGED");
if(hash(evidence+"/manifest.json")!=="3ee7d8f747bca5f1ca206f9056988263b6d3f18b79ebce97c4d83ab7bdd9e7c5")throw Error("EVIDENCE_MANIFEST_CHANGED");
const manifest=JSON.parse(fs.readFileSync(evidence+"/manifest.json","utf8"));
for(const [name,meta] of Object.entries(manifest.files))if(hash(evidence+"/"+name)!==meta.sha256)throw Error("EVIDENCE_FILE_CHANGED:"+name);
const original=JSON.parse(fs.readFileSync(frozen,"utf8"));
const broker=JSON.parse(fs.readFileSync(evidence+"/chronological-broker-fills.json","utf8"));
const types=new Set(["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL","REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"]);
const normalizeEvent=(t,e)=>{
 const effect=e.positionEffect||(e.eventType==="REAL_ENTRY_FILL"||e.eventType==="REAL_SCALE_IN_FILL"?"OPENING":"CLOSING");
 const direction=t.direction;
 const side=e.side||(effect==="OPENING"?(direction==="LONG"?"BUY":"SELL"):(direction==="LONG"?"SELL":"BUY"));
 return {broker:e.broker||"SCHWAB",source:"SCHWAB_BROKER_FILL",accountMode:"REAL",journalAccount:t.journalAccount,brokerAccountLabel:t.realBroker?.brokerAccountLabel,brokerTransactionId:e.brokerTransactionId,brokerFillLegId:e.brokerFillLegId||null,brokerOrderId:e.brokerOrderId,brokerSymbol:t.realBroker?.brokerSymbol||t.brokerSymbol,symbol:t.symbol,normalizedInstrumentRoot:t.realBroker?.normalizedInstrumentRoot,futuresContractCode:t.realBroker?.futuresContractCode||t.futuresContractCode,positionEffect:effect,side,direction,quantity:e.fillQuantity,fillPrice:e.price,fillTime:e.ts,commission:e.commission,futuresExchangeFee:e.futuresExchangeFee,otherFees:e.otherFees,totalFees:e.totalFees,brokerStatus:"VALID",eventType:"TRADE",assetType:"FUTURE",paper:false};
};
const identity=f=>[f.broker||"SCHWAB",f.journalAccount,f.brokerTransactionId,f.brokerFillLegId||""].join("|");
const all=new Map();
let historical=0;
for(const t of original){
 if(String(t.accountMode).toUpperCase()!=="REAL")continue;
 for(const e of t.events||[]){
  if(!types.has(e.eventType)||!e.brokerTransactionId)continue;
  const f=normalizeEvent(t,e);
  if(!f.fillTime||!Number.isFinite(Date.parse(f.fillTime))||!Number.isFinite(Number(f.fillPrice))||!Number.isFinite(Number(f.quantity)))throw Error("INCOMPLETE_HISTORICAL_EVENT:"+t.tradeId);
  const id=identity(f);
  if(all.has(id))throw Error("DUPLICATE_HISTORICAL_IDENTITY:"+id);
  all.set(id,f);historical++;
 }
}
let additions=0;
for(const row of broker){
 const f=row.fill;
 const id=identity(f);
 if(!all.has(id)){all.set(id,f);additions++;}
}
if(additions!==15)throw Error("UNEXPECTED_MISSING_FILL_COUNT:"+additions);
const fills=[...all.values()].sort((a,b)=>Date.parse(a.fillTime)-Date.parse(b.fillTime)||
 (a.positionEffect==="CLOSING"?-1:1));
fs.mkdirSync(sandbox,{recursive:true,mode:0o700});
const journalFile=path.join(sandbox,"trade-journal.json");
if(fs.existsSync(journalFile))throw Error("SANDBOX_OUTPUT_ALREADY_EXISTS");
const paper=original.filter(t=>String(t.accountMode).toUpperCase()!=="REAL");
fs.writeFileSync(journalFile,JSON.stringify(paper,null,2),{flag:"wx",mode:0o600});
process.env.TRADE_JOURNAL_DIR=sandbox;
const {ingestRealBrokerFill}=await import("./services/core/logic/journal/tradeJournalStore.js");
let applied=0,failures=[];
for(const f of fills){
 const r=await ingestRealBrokerFill(f);
 if(!r.ok||r.duplicate){failures.push({time:f.fillTime,account:f.journalAccount,contract:f.futuresContractCode,effect:f.positionEffect,error:r.error||r.reason||"UNEXPECTED_DUPLICATE"});break;}
 applied++;
}
const candidate=JSON.parse(fs.readFileSync(journalFile,"utf8"));
const open={};
for(const t of candidate.filter(t=>String(t.accountMode).toUpperCase()==="REAL")){
 const c=t.realBroker?.futuresContractCode||t.futuresContractCode;
 if(c!=="MESZ26")continue;
 const key=t.journalAccount+"|"+t.direction;
 open[key]=(open[key]||0)+Number(t.qty?.remainingQty||0);
}
const existingIds=new Set(original.filter(t=>String(t.accountMode).toUpperCase()==="REAL").map(t=>t.tradeId));
const candidateIds=new Set(candidate.filter(t=>String(t.accountMode).toUpperCase()==="REAL").map(t=>t.tradeId));
const missingExistingIds=[...existingIds].filter(id=>!candidateIds.has(id));
const report={schema:"engine10.fullReplayCandidate.v1",sandbox,originalJournalHash:expectedJournal,originalRealCampaigns:existingIds.size,historicalExecutionEvents:historical,addedMissingFills:additions,replayInputCount:fills.length,applied,failures,missingExistingIds,open,paperCountBefore:paper.length,paperCountAfter:candidate.filter(t=>String(t.accountMode).toUpperCase()!=="REAL").length,candidateSha256:hash(journalFile),productionModified:false,accepted:false};
const reportFile=path.join(sandbox,"candidate-report.json");
fs.writeFileSync(reportFile,JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
console.log(JSON.stringify({...report,missingExistingIds:missingExistingIds.slice(0,10)},null,2));
