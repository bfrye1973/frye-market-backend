// Engine 10 isolated MESZ26 accounting diagnostic. Read-only source files.
// Does not write Journal, ledger, watermarks, or submit broker orders.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root='/var/data/replay';
const backup=root+'/journal-recovery-sandbox/20261021-engine10-pre-reconstruction/trade-journal.json';
const evidence=root+'/engine8-private/engine8-final-inventory-evidence-2026-10-21T21-03-13-346Z';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(sha(backup)!=='ff4240448d4f9f775f0161fc54bd379eaa2c199b2f7ca580c367feea222415b1')throw Error('BACKUP_HASH_MISMATCH');
const manifest=JSON.parse(fs.readFileSync(evidence+'/manifest.json','utf8'));
if(sha(evidence+'/manifest.json')!=='3ee7d8f747bca5f1ca206f9056988263b6d3f18b79ebce97c4d83ab7bdd9e7c5')throw Error('MANIFEST_HASH_MISMATCH');
for(const [name,meta] of Object.entries(manifest.files||{}))if(sha(evidence+'/'+name)!==meta.sha256)throw Error('FILE_HASH_MISMATCH:'+name);
const journal=JSON.parse(fs.readFileSync(backup,'utf8'));
const rows=JSON.parse(fs.readFileSync(evidence+'/chronological-broker-fills.json','utf8'));
const boundary=Date.parse('2026-10-14T00:00:00Z');
const report={schema:'engine10.isolatedFifoAccountingDiagnostic.v1',sourceVerified:true,accounts:{},exceptions:[],productionModified:false};
const keys=new Set();
for(const row of rows){
 const f=row.fill||{};
 const key=[f.broker,f.journalAccount,f.brokerTransactionId,f.brokerFillLegId||'LEGACY'].join('|');
 if(keys.has(key))report.exceptions.push({type:'DUPLICATE_BROKER_IDENTITY',account:f.journalAccount,time:f.fillTime});
 keys.add(key);
}
for(const account of ['SWING','INTRADAY']){
 const relevant=journal.filter(t=>String(t.accountMode).toUpperCase()==='REAL'&&t.journalAccount===account&&String(t.futuresContractCode||t.realBroker?.futuresContractCode).toUpperCase()==='MESZ26');
 const existing=relevant.flatMap(t=>(t.realBroker?.contracts||[]).map(c=>({...c,tradeId:t.tradeId})));
 const records=rows.filter(r=>r.fill?.journalAccount===account&&r.fill?.futuresContractCode==='MESZ26');
 const accountReport={};
 for(const direction of ['LONG','SHORT']){
  const before=direction==='SHORT'?existing.filter(c=>c.direction===direction&&Date.parse(c.openingFillTime)<boundary&&(!c.closingFillTime||Date.parse(c.closingFillTime)>=boundary)).sort((a,b)=>Date.parse(a.openingFillTime)-Date.parse(b.openingFillTime)): [];
  const lots=before.map(c=>({entryPrice:Number(c.entryPrice),openingBrokerTransactionId:String(c.openingBrokerTransactionId),contractId:c.contractId,fromBeforeWindow:true}));
  let opens=0,closes=0,gross=0,fees=0;
  const changedClosures=[];
  const ordered=records.filter(r=>r.fill.direction===direction).sort((a,b)=>Date.parse(a.fill.fillTime)-Date.parse(b.fill.fillTime)|| (a.fill.positionEffect==='CLOSING'?-1:1));
  for(const r of ordered){
   const f=r.fill,q=Number(f.quantity),p=Number(f.fillPrice);
   if(!Number.isInteger(q)||q<=0||!Number.isFinite(p))throw Error('INVALID_EXECUTION');
   fees+=Number(f.totalFees||0);
   if(f.positionEffect==='OPENING'){
    opens+=q;
    for(let i=0;i<q;i++)lots.push({entryPrice:p,openingBrokerTransactionId:String(f.brokerTransactionId),contractId:null,fromBeforeWindow:false});
   } else if(f.positionEffect==='CLOSING'){
    closes+=q;
    for(let i=0;i<q;i++){
     const lot=lots.shift();
     if(!lot){report.exceptions.push({type:'INSUFFICIENT_FIFO',account,direction,time:f.fillTime});continue}
     gross+=(direction==='LONG'?p-lot.entryPrice:lot.entryPrice-p)*5;
     const original=lot.contractId?existing.find(c=>c.contractId===lot.contractId):existing.find(c=>c.direction===direction&&String(c.openingBrokerTransactionId)===lot.openingBrokerTransactionId&&Number(c.entryPrice)===lot.entryPrice);
     if(original?.closingBrokerTransactionId&&String(original.closingBrokerTransactionId)!==String(f.brokerTransactionId))changedClosures.push({contractId:original.contractId,oldClosingBrokerTransactionId:original.closingBrokerTransactionId,newClosingBrokerTransactionId:String(f.brokerTransactionId)});
    }
   } else report.exceptions.push({type:'UNKNOWN_EFFECT',account,direction,time:f.fillTime});
  }
  accountReport[direction]={startingInventory:before.length,opened:opens,closed:closes,endingInventory:lots.length,grossRealized:gross,executionFees:fees,netEstimate:gross-fees,changedClosureCount:changedClosures.length,changedClosures};
  if(lots.length)report.exceptions.push({type:'ENDING_INVENTORY_NONZERO',account,direction,qty:lots.length});
 }
 report.accounts[account]=accountReport;
}
report.missingCount=rows.filter(r=>r.inEngine10===false).length;
report.brokerIdentityCount=keys.size;
report.idempotencyPrecheck=keys.size===rows.length;
report.readyForProduction=false;
console.log(JSON.stringify(report,null,2));
