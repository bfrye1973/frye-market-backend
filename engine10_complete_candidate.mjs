// Engine 10 final isolated candidate: add verified October 21 SHORT pair to identity-preserved LONG candidate.
// Uses canonical ingestion, never modifies active Journal or Engine 8 state.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const base="/var/data/replay/journal-recovery-sandbox/20261021-engine10-pre-reconstruction";
const evidence="/var/data/replay/engine8-private/engine8-final-inventory-evidence-2026-10-21T21-03-13-346Z";
const source=base+"/long-replay-v1/identity-preserved.json";
const frozen=base+"/trade-journal.json";
const sandbox=base+"/complete-candidate-v1";
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if(sha(source)!=="ce37959e2aeafe6b32e9f704834450be772badf66846094d1a6f860f1edd0d6c")throw Error("IDENTITY_PRESERVED_SOURCE_CHANGED");
if(sha(frozen)!=="ff4240448d4f9f775f0161fc54bd379eaa2c199b2f7ca580c367feea222415b1")throw Error("FROZEN_JOURNAL_CHANGED");
if(sha(evidence+"/manifest.json")!=="3ee7d8f747bca5f1ca206f9056988263b6d3f18b79ebce97c4d83ab7bdd9e7c5")throw Error("EVIDENCE_MANIFEST_CHANGED");
const manifest=JSON.parse(fs.readFileSync(evidence+"/manifest.json","utf8"));
for(const [name,meta] of Object.entries(manifest.files))if(sha(evidence+"/"+name)!==meta.sha256)throw Error("EVIDENCE_CHANGED:"+name);
const original=JSON.parse(fs.readFileSync(frozen,"utf8"));
const seed=JSON.parse(fs.readFileSync(source,"utf8"));
const rows=JSON.parse(fs.readFileSync(evidence+"/chronological-broker-fills.json","utf8"));
const shortPair=rows.filter(r=>r.fill?.journalAccount==="SWING"&&r.fill?.direction==="SHORT"&&r.inEngine10===false).map(r=>r.fill).sort((a,b)=>Date.parse(a.fillTime)-Date.parse(b.fillTime));
if(shortPair.length!==2||shortPair[0].positionEffect!=="OPENING"||shortPair[1].positionEffect!=="CLOSING"||Number(shortPair[0].quantity)!==1||Number(shortPair[1].quantity)!==1)throw Error("SHORT_PAIR_NOT_AS_EXPECTED");
if(fs.existsSync(sandbox))throw Error("SANDBOX_ALREADY_EXISTS");
fs.mkdirSync(sandbox,{recursive:true,mode:0o700});
const target=sandbox+"/trade-journal.json";
fs.writeFileSync(target,JSON.stringify(seed,null,2),{flag:"wx",mode:0o600});
process.env.TRADE_JOURNAL_DIR=sandbox;
const {ingestRealBrokerFill}=await import("file:///opt/render/project/src/services/core/logic/journal/tradeJournalStore.js");
const responses=[];
for(const fill of shortPair){
 const r=await ingestRealBrokerFill(fill);
 responses.push({ok:r.ok,duplicate:r.duplicate,error:r.error||null,effect:fill.positionEffect});
 if(!r.ok||r.duplicate)break;
}
const beforeReplayHash=sha(target);
let duplicates=0;
if(responses.length===2&&responses.every(r=>r.ok&&!r.duplicate)){
 for(const fill of shortPair){
  const r=await ingestRealBrokerFill(fill);
  if(!r.ok||!r.duplicate)throw Error("SHORT_IDEMPOTENCY_FAILED");
  duplicates++;
 }
 if(sha(target)!==beforeReplayHash)throw Error("SHORT_SECOND_REPLAY_CHANGED_JOURNAL");
}
const result=JSON.parse(fs.readFileSync(target,"utf8"));
const isReal=t=>String(t.accountMode).toUpperCase()==="REAL";
const isPaper=t=>!isReal(t);
const paperUnchanged=JSON.stringify(original.filter(isPaper))===JSON.stringify(result.filter(isPaper));
const preservedIds=original.filter(isReal).every(t=>result.some(c=>c.tradeId===t.tradeId));
const allContracts=result.filter(isReal).flatMap(t=>t.realBroker?.contracts||[]);
const originalContracts=original.filter(isReal).flatMap(t=>t.realBroker?.contracts||[]);
const contractIdsPreserved=originalContracts.every(c=>allContracts.some(x=>x.contractId===c.contractId));
const contractIdUnique=new Set(allContracts.map(c=>c.contractId)).size===allContracts.length;
const inventory={};
for(const t of result.filter(isReal)){
 if(String(t.realBroker?.futuresContractCode||t.futuresContractCode)!=="MESZ26")continue;
 const k=t.journalAccount+"|"+t.direction;
 inventory[k]=(inventory[k]||0)+Number(t.qty?.remainingQty||0);
}
const brokerKeys=new Set(rows.map(r=>[r.fill?.journalAccount,r.fill?.brokerTransactionId,r.fill?.brokerFillLegId||""].join("|")));
const journalKeys=new Set(result.filter(isReal).flatMap(t=>(t.events||[]).filter(e=>e.brokerTransactionId).map(e=>[t.journalAccount,e.brokerTransactionId,e.brokerFillLegId||""].join("|"))));
const missingBrokerKeys=[...brokerKeys].filter(k=>!journalKeys.has(k));
const allFlat=["SWING|LONG","SWING|SHORT","INTRADAY|LONG","INTRADAY|SHORT"].every(k=>(inventory[k]||0)===0);
const report={schema:"engine10.completeCandidateAcceptance.v1",shortResponses:responses,shortDuplicateReplays:duplicates,brokerFillCount:rows.length,missingBrokerFillIdentities:missingBrokerKeys.length,missingBrokerKeys,allFlat,inventory,paperUnchanged,preservedExistingRealTradeIds:preservedIds,preservedExistingContractIds:contractIdsPreserved,contractIdUnique,originalRealCampaigns:original.filter(isReal).length,candidateRealCampaigns:result.filter(isReal).length,candidateSha256:sha(target),productionModified:false,accepted:false};
report.pass=responses.length===2&&responses.every(r=>r.ok&&!r.duplicate)&&duplicates===2&&missingBrokerKeys.length===0&&allFlat&&paperUnchanged&&preservedIds&&contractIdsPreserved&&contractIdUnique;
fs.writeFileSync(sandbox+"/acceptance-report.json",JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
console.log(JSON.stringify(report,null,2));
