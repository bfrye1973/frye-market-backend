// Engine 10 final read-only acceptance: candidate accounting, source freshness, fee and lineage.
// Never writes any files or places orders. Rejects stale production before cutover.
import fs from "node:fs";
import crypto from "node:crypto";
const base="/var/data/replay/journal-recovery-sandbox/20261021-engine10-pre-reconstruction";
const candidate=base+"/complete-candidate-v1/trade-journal.json";
const frozen=base+"/trade-journal.json";
const live=(process.env.TRADE_JOURNAL_DIR||"/var/data/replay/journal")+"/trade-journal.json";
const evidence="/var/data/replay/engine8-private/engine8-final-inventory-evidence-2026-10-21T21-03-13-346Z";
const hash=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const expectedCandidate="571fb34a1ec059dc5be9e569c50b1f81bea27bce4e087fcf7dfd80247b9e3e8e";
const expectedFrozen="ff4240448d4f9f775f0161fc54bd379eaa2c199b2f7ca580c367feea222415b1";
const expectedManifest="3ee7d8f747bca5f1ca206f9056988263b6d3f18b79ebce97c4d83ab7bdd9e7c5";
if(hash(candidate)!==expectedCandidate||hash(frozen)!==expectedFrozen||hash(evidence+"/manifest.json")!==expectedManifest)throw Error("SOURCE_CHECKSUM_CHANGED");
const original=JSON.parse(fs.readFileSync(frozen,"utf8"));
const next=JSON.parse(fs.readFileSync(candidate,"utf8"));
const current=JSON.parse(fs.readFileSync(live,"utf8"));
const rows=JSON.parse(fs.readFileSync(evidence+"/chronological-broker-fills.json","utf8"));
const real=t=>String(t.accountMode).toUpperCase()==="REAL";
const contract=t=>String(t.realBroker?.futuresContractCode||t.futuresContractCode).toUpperCase();
const ids=t=>[t.journalAccount,t.direction,contract(t)].join("|");
const beforeReal=original.filter(real),afterReal=next.filter(real);
const beforePaper=original.filter(t=>!real(t)),afterPaper=next.filter(t=>!real(t));
const samePaper=JSON.stringify(beforePaper)===JSON.stringify(afterPaper);
const sourceContracts=beforeReal.flatMap(t=>t.realBroker?.contracts||[]);
const targetContracts=afterReal.flatMap(t=>t.realBroker?.contracts||[]);
const byId=new Map(targetContracts.map(c=>[c.contractId,c]));
const allIdsUnique=byId.size===targetContracts.length;
const originalIdsPreserved=sourceContracts.every(c=>byId.has(c.contractId));
const dpp=c=>String(c.symbol).toUpperCase()==="MES"||String(c.brokerSymbol).toUpperCase().includes("MES")?5:null;
const closed=targetContracts.filter(c=>c.status==="CLOSED"&&c.closingFillTime&&Date.parse(c.closingFillTime)>=Date.parse("2026-10-14T00:00:00Z")&&c.futuresContractCode==="MESZ26");
const pnlIssues=[];
for(const c of closed){
 const mult=dpp(c);
 const expected=mult==null?null:Math.round(((c.direction==="SHORT"?Number(c.entryPrice)-Number(c.exitPrice):Number(c.exitPrice)-Number(c.entryPrice))*mult)*100)/100;
 if(expected===null||!Number.isFinite(expected)||Math.abs(expected-Number(c.grossRealizedPnL))>0.011)pnlIssues.push({contractId:c.contractId,expected,actual:c.grossRealizedPnL});
}
const affected=afterReal.filter(t=>contract(t)==="MESZ26");
const inventory={};
for(const t of affected){const k=ids(t);inventory[k]=(inventory[k]||0)+Number(t.qty?.remainingQty||0);}
const allFlat=["SWING|LONG|MESZ26","SWING|SHORT|MESZ26","INTRADAY|LONG|MESZ26","INTRADAY|SHORT|MESZ26"].every(k=>(inventory[k]||0)===0);
const journalEvents=afterReal.flatMap(t=>(t.events||[]).filter(e=>e.brokerTransactionId).map(e=>({account:t.journalAccount,event:e})));
const matching=f=>journalEvents.filter(x=>x.account===f.journalAccount&&String(x.event.brokerTransactionId)===String(f.brokerTransactionId)&&(!f.brokerFillLegId||!x.event.brokerFillLegId||x.event.brokerFillLegId===f.brokerFillLegId));
const missing=rows.filter(r=>matching(r.fill).length===0);
const feeIssues=[];
for(const r of rows){
 const f=r.fill;
 const matches=matching(f);
 const fee=Number(f.totalFees||0);
 if(matches.length===1){
  const actual=Number(matches[0].event.totalFees);
  if(Number.isFinite(actual)&&Math.abs(actual-fee)>0.011)feeIssues.push({account:f.journalAccount,time:f.fillTime,expected:fee,actual});
 }
}
const frozenIdentity=new Set(beforeReal.flatMap(t=>(t.events||[]).filter(e=>e.brokerTransactionId).map(e=>[t.journalAccount,e.brokerTransactionId,e.brokerFillLegId||""].join("|"))));
const liveNew=current.filter(real).flatMap(t=>(t.events||[]).filter(e=>e.brokerTransactionId).map(e=>[t.journalAccount,e.brokerTransactionId,e.brokerFillLegId||""].join("|"))).filter(k=>!frozenIdentity.has(k));
const stale=liveNew.length>0||hash(live)!==expectedFrozen;
const report={schema:"engine10.finalAccountingPreflight.v1",candidateSha256:hash(candidate),liveSha256:hash(live),frozenSha256:hash(frozen),staleProduction:stale,newBrokerEventsSinceBackup:liveNew.length,originalRealCampaigns:beforeReal.length,candidateRealCampaigns:afterReal.length,paperUnchanged:samePaper,originalContractIdsPreserved:originalIdsPreserved,contractIdsUnique:allIdsUnique,allFlat,inventory,closedContractsChecked:closed.length,pnlIssueCount:pnlIssues.length,pnlIssues:pnlIssues.slice(0,10),missingBrokerFills:missing.length,feeIssueCount:feeIssues.length,feeIssues:feeIssues.slice(0,10),productionModified:false};
report.pass=!stale&&samePaper&&originalIdsPreserved&&allIdsUnique&&allFlat&&!pnlIssues.length&&!missing.length&&!feeIssues.length;
console.log(JSON.stringify(report,null,2));
