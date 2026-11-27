// Issue #412: one private, read-only producer contract. No trading authority.
// Server callers supply fixed, trusted configuration, not request-selected paths.
import {createHash} from "node:crypto";
import {readDailyPaperEvidence} from "./engine8DailyEvidenceReader.js";
import {readPrivatePaperReceipts,projectObservedPaperAttempts} from "./engine8PaperReceiptReader.js";
import {projectObservedPaperCoverage} from "./engine8PaperCoverage.js";
import {projectNominalPaperSchedule} from "./engine8PaperScheduleDiagnostics.js";
import {projectPaperObserverHealth} from "./engine8PaperObserverHealth.js";
import {projectPaperDailyFills} from "./engine8DailyFillEvidence.js";
import {attachDailyJournalEvidence} from "./engine8DailyJournalEvidence.js";
const hash=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const validHash=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const requiredStores=["orders","executions","lifecycle","ledger","acceptance","journal"];
export function buildDailyVerificationProducer({date,now,evidence,archive}={}){
 const receipts=Array.isArray(archive?.receipts)?archive.receipts:null;
 const coverage=projectObservedPaperCoverage({date,now,receipts});
 const schedule=projectNominalPaperSchedule({date,now,receipts});
 const attempts=projectObservedPaperAttempts({date,now,receipts});
 const health=projectPaperObserverHealth({date,now,receipts,evidence});
 const stable=evidence?.stability==="NO_CHANGE_OBSERVED";
 const storeOk=k=>stable&&evidence?.stores?.[k]?.status==="OK"&&validHash(evidence.stores[k].sha256);
 const missing=requiredStores.filter(k=>!storeOk(k));
 const issues=new Set([...coverage.errors,...coverage.duplicates,...(archive?.issues??[]),...schedule.issues]);
 if(!stable)issues.add("DURABLE_READ_UNSTABLE");
 for(const k of missing)issues.add(k.toUpperCase()+"_EVIDENCE_UNAVAILABLE");
 if(archive?.date!==date)issues.add("RECEIPT_ARCHIVE_DATE_UNVERIFIED");
 const raw=projectPaperDailyFills({date,orders:storeOk("orders")?evidence.values?.orders:null,executions:storeOk("executions")?evidence.values?.executions:null});
 const fills=attachDailyJournalEvidence(raw,storeOk("journal")?evidence.values?.journal:null,{ledger:storeOk("ledger")?evidence.values?.ledger:null,meta:storeOk("journal")?evidence.stores.journal:null});
 const provenance={readAt:evidence?.readAt??null,finishedAt:evidence?.finishedAt??null,stability:evidence?.stability??"UNKNOWN",receiptSetHash:coverage.receiptSetHash,storeHashes:Object.fromEntries(requiredStores.map(k=>[k,storeOk(k)?evidence.stores[k].sha256:null]))};
 // Snapshot hashes authenticate neither origin nor interval retention. No COMPLETE
 // attestation or NO verdict is generated from mutable stores or nominal cron.
 return {schemaVersion:"engine8.dailyVerificationProducer.v1",date,generatedAt:now,reportedAttempts:attempts,durableFills:fills,schedule,health,coverage:{...coverage,issues:[...issues],storeObservation:Object.fromEntries(requiredStores.map(k=>[k,storeOk(k)?"READABLE_NOT_RETENTION_PROOF":"UNKNOWN"])),evidenceBindingHash:hash(provenance),provenance,status:"INCOMPLETE",watermarkThrough:null},independentVerification:"UNKNOWN"};
}
export async function readDailyVerificationProducer({date,paperDir,journalDir,receiptDir,now=()=>new Date().toISOString()}={}){
 const archive=await readPrivatePaperReceipts({root:receiptDir,date,now:now()});
 const evidence=readDailyPaperEvidence({paperDir,journalDir,now});
 return buildDailyVerificationProducer({date,now:now(),evidence,archive});
}
