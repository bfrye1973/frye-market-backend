// Read-only diagnostic projection. Observed health never grants trading authority.
import {projectObservedPaperCoverage} from "./engine8PaperCoverage.js";
const ms=v=>typeof v==="string"?Date.parse(v):NaN;
export function projectPaperObserverHealth({date,receipts,now,evidence,staleAfterMs=600000,ackGraceMs=180000}={}){
 if(!Number.isFinite(ms(now))||!Number.isSafeInteger(staleAfterMs)||staleAfterMs<1||!Number.isSafeInteger(ackGraceMs)||ackGraceMs<0)throw Error("INVALID_HEALTH_CONFIG");
 const coverage=projectObservedPaperCoverage({date,receipts,now});
 const alerts=new Set();
 const isCurrent=ms(now)>=ms(coverage.intervalStart)&&ms(now)<ms(coverage.intervalEnd);
 const latest=ms(coverage.latestReceiptCreatedAt);
 if(isCurrent&&(!Number.isFinite(latest)||ms(now)-latest>staleAfterMs))alerts.add("VERIFICATION_OBSERVER_STALE");
 if(coverage.runGaps.length)alerts.add("SCHEDULER_RECEIPT_GAP");
 if(coverage.errors.length||coverage.duplicates.length)alerts.add("RECEIPT_EVIDENCE_INVALID");
 const ledger=evidence?.values?.ledger,stable=evidence?.stability==="NO_CHANGE_OBSERVED";
 let pendingAckCount=null;
 if(stable&&evidence?.stores?.ledger?.status==="OK"&&ledger&&typeof ledger==="object"&&!Array.isArray(ledger)){
  pendingAckCount=0;
  for(const row of Object.values(ledger)){
   if(row?.paper!==true||row?.status!=="filled"||row?.journalStatus!=="JOURNAL_PENDING")continue;
   pendingAckCount++;
   const t=ms(row.filledAt??row.ts);
   if(!Number.isFinite(t)||ms(now)-t>=ackGraceMs)alerts.add("PENDING_JOURNAL_ACK");
  }
 }else alerts.add("DURABLE_LEDGER_UNAVAILABLE");
 return {schemaVersion:"engine8.paperObserverHealth.v1",date,observedAt:now,coverageStatus:coverage.status,lastReceiptAt:coverage.latestReceiptCreatedAt,schedulerRunsObserved:coverage.schedulerRunsObserved,completedObservedRuns:coverage.completedObservedRuns,pendingAckCount,alerts:[...alerts],status:alerts.size?"ATTENTION_REQUIRED":"OBSERVED_NO_ALERT",independentVerification:"UNKNOWN"};
}
