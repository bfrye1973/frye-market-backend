// Engine 10 controlled October LONG reconstruction (isolated only).
// Replays original Schwab evidence through canonical Engine 10 ingestion.
// Preserves all unaffected campaigns and PAPER history. Never writes production.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root="/var/data/replay";
const backup=root+"/journal-recovery-sandbox/20261021-engine10-pre-reconstruction/trade-journal.json";
const evidence=root+"/engine8-private/engine8-final-inventory-evidence-2026-10-21T21-03-13-346Z";
const sandbox=root+"/journal-recovery-sandbox/20261021-engine10-pre-reconstruction/long-replay-v1";
const hash=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if(hash(backup)!=="ff4240448d4f9f775f0161fc54bd379eaa2c199b2f7ca580c367feea222415b1")throw Error("BACKUP_CHANGED");
if(hash(evidence+"/manifest.json")!=="3ee7d8f747bca5f1ca206f9056988263b6d3f18b79ebce97c4d83ab7bdd9e7c5")throw Error("MANIFEST_CHANGED");
const manifest=JSON.parse(fs.readFileSync(evidence+"/manifest.json","utf8"));
for(const [name,meta] of Object.entries(manifest.files))if(hash(evidence+"/"+name)!==meta.sha256)throw Error("EVIDENCE_CHANGED:"+name);
const source=JSON.parse(fs.readFileSync(backup,"utf8"));
const rows=JSON.parse(fs.readFileSync(evidence+"/chronological-broker-fills.json","utf8"));
const affected=t=>String(t.accountMode).toUpperCase()==="REAL"&&
 ["SWING","INTRADAY"].includes(t.journalAccount)&&t.direction==="LONG"&&
 String(t.futuresContractCode||t.realBroker?.futuresContractCode).toUpperCase()==="MESZ26"&&
 Date.parse(t.entry?.time)>=Date.parse("2026-10-14T00:00:00Z");
const removed=source.filter(affected);
if(removed.length!==2)throw Error("EXPECTED_TWO_AFFECTED_LONG_CAMPAIGNS_FOUND_"+removed.length);
const retained=source.filter(t=>!affected(t));
const inputs=rows.filter(r=>r.fill?.futuresContractCode==="MESZ26"&&r.fill?.direction==="LONG")
 .map(r=>r.fill).sort((a,b)=>Date.parse(a.fillTime)-Date.parse(b.fillTime));
if(inputs.length!==24)throw Error("LONG_FILL_COUNT_CHANGED_"+inputs.length);
fs.mkdirSync(sandbox,{recursive:true,mode:0o700});
const target=path.join(sandbox,"trade-journal.json");
if(fs.existsSync(target))throw Error("SANDBOX_ALREADY_EXISTS");
fs.writeFileSync(target,JSON.stringify(retained,null,2),{flag:"wx",mode:0o600});
process.env.TRADE_JOURNAL_DIR=sandbox;
const {ingestRealBrokerFill}=await import("file:///opt/render/project/src/services/core/logic/journal/tradeJournalStore.js");
const failures=[];let applied=0;
for(const fill of inputs){
 const result=await ingestRealBrokerFill(fill);
 if(!result.ok||result.duplicate){failures.push({time:fill.fillTime,account:fill.journalAccount,error:result.error||result.reason,reasonCodes:result.reasonCodes||null});break}
 applied++;
}
const candidate=JSON.parse(fs.readFileSync(target,"utf8"));
const reconstructed=candidate.filter(affected);
const preservedIds=retained.every(t=>candidate.some(c=>c.tradeId===t.tradeId));
const paperBefore=source.filter(t=>String(t.accountMode).toUpperCase()==="PAPER");
const paperAfter=candidate.filter(t=>String(t.accountMode).toUpperCase()==="PAPER");
const paperIdentical=JSON.stringify(paperBefore)===JSON.stringify(paperAfter);
const oldIds=new Set(removed.map(t=>t.tradeId));
const newIds=new Set(reconstructed.map(t=>t.tradeId));
const identitiesPreserved=[...oldIds].every(id=>newIds.has(id));
const positions={};
for(const t of reconstructed)positions[t.journalAccount]=(positions[t.journalAccount]||0)+Number(t.qty?.remainingQty||0);
let secondPassDuplicates=0;
if(!failures.length&&applied===inputs.length){
 const beforeHash=hash(target);
 for(const fill of inputs){const result=await ingestRealBrokerFill(fill);if(!result.ok||!result.duplicate){failures.push({phase:"SECOND_PASS",time:fill.fillTime,error:result.error||"NOT_DUPLICATE"});break}secondPassDuplicates++}
 if(hash(target)!==beforeHash)failures.push({phase:"SECOND_PASS",error:"CANDIDATE_CHANGED"});
}
const report={schema:"engine10.longReplayCandidate.v1",applied,expected:inputs.length,failures,removedCampaigns:removed.length,reconstructedCampaigns:reconstructed.length,positions,preservedUnaffectedTradeIds:preservedIds,paperIdentical,affectedTradeIdsPreserved:identitiesPreserved,secondPassDuplicates,originalAffectedTradeIds:[...oldIds],reconstructedTradeIds:[...newIds],candidateSha256:hash(target),productionModified:false,accepted:false};
fs.writeFileSync(path.join(sandbox,"report.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
console.log(JSON.stringify(report,null,2));
