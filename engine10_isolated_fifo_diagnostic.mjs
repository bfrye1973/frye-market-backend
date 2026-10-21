// Engine 10 — isolated, READ-ONLY October 14–21 MESZ26 FIFO diagnostic.
// Does NOT invoke ingestRealBrokerFill, place orders, or write to production.
// Produces only an audit report in the separate journal-recovery-sandbox.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root="/var/data/replay";
const evidence=path.join(root,"engine8-private/engine8-final-inventory-evidence-2026-10-21T21-03-13-346Z");
const backup=path.join(root,"journal-recovery-sandbox/20261021-engine10-pre-reconstruction/trade-journal.json");
const outDir=path.join(root,"journal-recovery-sandbox/20261021-engine10-pre-reconstruction");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const load=p=>{const b=fs.readFileSync(p);return {value:JSON.parse(b.toString("utf8")),hash:sha(b)}};
const manifest=load(path.join(evidence,"manifest.json"));
if(manifest.hash!=="3ee7d8f747bca5f1ca206f9056988263b6d3f18b79ebce97c4d83ab7bdd9e7c5")throw Error("MANIFEST_HASH_MISMATCH");
for(const [name,meta] of Object.entries(manifest.value.files||{})){
 if(sha(fs.readFileSync(path.join(evidence,name)))!==meta.sha256)throw Error("EVIDENCE_HASH_MISMATCH:"+name);
}
const broker=load(path.join(evidence,"chronological-broker-fills.json")).value;
const journal=load(backup);
if(journal.hash!=="ff4240448d4f9f775f0161fc54bd379eaa2c199b2f7ca580c367feea222415b1")throw Error("FROZEN_JOURNAL_HASH_MISMATCH");
if(!Array.isArray(broker)||broker.length!==34||!Array.isArray(journal.value))throw Error("INPUT_SHAPE_MISMATCH");
const relevant=journal.value.filter(t=>String(t.accountMode).toUpperCase()==="REAL"&&String(t.futuresContractCode||t.realBroker?.futuresContractCode).toUpperCase()==="MESZ26");
const originalEvents=relevant.flatMap(t=>(t.events||[]).filter(e=>e.brokerTransactionId).map(e=>({tradeId:t.tradeId,account:t.journalAccount,event:e})));
const originalContracts=relevant.flatMap(t=>(t.realBroker?.contracts||[]).map(c=>({...c,tradeId:t.tradeId})));
const hasEvent=f=>originalEvents.some(({account,event:e})=>
 String(account).toUpperCase()===String(f.journalAccount).toUpperCase()&&
 String(e.brokerTransactionId)===String(f.brokerTransactionId)&&
 (!f.brokerFillLegId||!e.brokerFillLegId||String(e.brokerFillLegId)===String(f.brokerFillLegId))
);
const sorted=[...broker].sort((a,b)=>Date.parse(a.fill?.fillTime)-Date.parse(b.fill?.fillTime)||
 (a.fill?.positionEffect==="CLOSING"?-1:1));
const accounts=["SWING","INTRADAY"];
const result={schema:"engine10.mesz26IsolatedDiagnostic.v1",readOnly:true,manifestSha256:manifest.hash,journalBackupSha256:journal.hash,brokerRows:broker.length,accounts:{},exceptions:[],notAProductionRepair:true};
for(const account of accounts){
 const lots=[];const closures=[];const originalAccountContracts=originalContracts.filter(c=>c.journalAccount===account);
 const rows=sorted.filter(r=>r.fill?.journalAccount===account&&r.fill?.futuresContractCode==="MESZ26"&&r.fill?.direction==="LONG");
 let opens=0,closes=0,fees=0;
 for(const row of rows){
  const f=row.fill,q=Number(f.quantity),p=Number(f.fillPrice);
  if(!Number.isSafeInteger(q)||q<=0||!Number.isFinite(p))throw Error("INVALID_FILL_QUANTITY_OR_PRICE");
  fees+=Number(f.totalFees||0);
  if(f.positionEffect==="OPENING"){
   opens+=q;
   for(let i=0;i<q;i++)lots.push({entryPrice:p,openingBrokerTransactionId:String(f.brokerTransactionId),entryTime:f.fillTime});
  }else if(f.positionEffect==="CLOSING"){
   closes+=q;
   for(let i=0;i<q;i++){
    const lot=lots.shift();
    if(!lot){result.exceptions.push({account,kind:"LONG_CLOSE_WITHOUT_OPEN",time:f.fillTime});continue}
    const original=originalAccountContracts.find(c=>String(c.openingBrokerTransactionId)===lot.openingBrokerTransactionId&&Number(c.entryPrice)===lot.entryPrice);
    closures.push({openingBrokerTransactionId:lot.openingBrokerTransactionId,closingBrokerTransactionId:String(f.brokerTransactionId),entryPrice:lot.entryPrice,exitPrice:p,grossPnL:(p-lot.entryPrice)*5,existingContractId:original?.contractId||null,existingClosingBrokerTransactionId:original?.closingBrokerTransactionId||null,closingIdentityWouldChange:!!original?.closingBrokerTransactionId&&String(original.closingBrokerTransactionId)!==String(f.brokerTransactionId)});
   }
  }else result.exceptions.push({account,kind:"UNKNOWN_POSITION_EFFECT",time:f.fillTime});
 }
 const missing=sorted.filter(r=>r.fill?.journalAccount===account&&!hasEvent(r.fill)).length;
 result.accounts[account]={longOpenQuantity:opens,longCloseQuantity:closes,longRemaining:lots.length,longGrossRealized:closures.reduce((n,c)=>n+c.grossPnL,0),longExecutionFees:fees,missingBrokerFillRecords:missing,existingOpenLongContracts:originalAccountContracts.filter(c=>c.status==="OPEN"&&c.direction==="LONG").length,changedClosureLineage:closures.filter(c=>c.closingIdentityWouldChange),unmatchedNewOpeningLots:closures.filter(c=>!c.existingContractId).length,closures,remainingLots:lots};
 if(lots.length)result.exceptions.push({account,kind:"LONG_INVENTORY_NOT_FLAT",qty:lots.length});
}
const missingTotal=sorted.filter(r=>!hasEvent(r.fill)).length;
result.missingTotal=missingTotal;
if(missingTotal!==15)result.exceptions.push({kind:"MISSING_COUNT_CHANGED",expected:15,actual:missingTotal});
result.shortReconstructionStatus="NOT_PERFORMED: prior-to-Oct14 opening inventory required";
result.readyForProduction=false;
fs.mkdirSync(outDir,{recursive:true,mode:0o700});
const target=path.join(outDir,"isolated-long-fifo-diagnostic.json");
fs.writeFileSync(target,JSON.stringify(result,null,2)+"\n",{flag:"w",mode:0o600});
console.log(JSON.stringify({ok:true,reportPath:target,reportSha256:sha(fs.readFileSync(target)),missingTotal,accounts:Object.fromEntries(Object.entries(result.accounts).map(([k,v])=>[k,{longOpenQuantity:v.longOpenQuantity,longCloseQuantity:v.longCloseQuantity,longRemaining:v.longRemaining,longGrossRealized:v.longGrossRealized,longExecutionFees:v.longExecutionFees,missingBrokerFillRecords:v.missingBrokerFillRecords,existingOpenLongContracts:v.existingOpenLongContracts,changedClosureLineage:v.changedClosureLineage.length,unmatchedNewOpeningLots:v.unmatchedNewOpeningLots}])),exceptions:result.exceptions,shortReconstructionStatus:result.shortReconstructionStatus,productionModified:false},null,2));
