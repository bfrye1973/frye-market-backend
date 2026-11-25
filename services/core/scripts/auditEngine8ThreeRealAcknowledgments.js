#!/usr/bin/env node
// STRICTLY READ-ONLY offline evidence for three durable observer discrepancies.
// Does not persist acknowledgment flags. Never POSTs any fill.
import {readEngine8RealFillObserverState} from "../logic/trading/schwab/engine8RealFillStore.js";
import {OCT23_ACK_REPAIR_IDS,readEngine10JournalForRealAck,
 verifyEngine10RealFillIdentity} from "../logic/trading/schwab/engine8RealAckVerification.js";
const state=readEngine8RealFillObserverState();
const journal=readEngine10JournalForRealAck();
const records=Object.values(state.observations||{});
const report=OCT23_ACK_REPAIR_IDS.map(id=>{
 const matching=records.filter(r=>String(r.brokerTransactionId||r.normalizedFill?.brokerTransactionId)===id);
 const checks=matching.map(r=>({
  account:r.brokerAccountLabel||r.normalizedFill?.brokerAccountLabel||null,
  ledgerStatus:r.deliveryStatus||null,
  ledgerDelivered:r.delivered===true,
  journal:verifyEngine10RealFillIdentity(journal,r.normalizedFill)
 }));
 return {brokerTransactionId:id,observations:matching.length,checks};
});
const pass=report.every(r=>r.observations===1&&r.checks[0].journal?.confirmed===true);
console.log(JSON.stringify({
 schema:"engine8.durableRealAckReadOnlyAudit.v1",
 readOnly:true,productionModified:false,pass,report
},null,2));
if(!pass)process.exitCode=2;
