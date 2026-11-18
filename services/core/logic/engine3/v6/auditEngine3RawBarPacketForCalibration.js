// Engine3 v6 Phase3: REPLAY-CALIBRATION ADMISSIBILITY AUDIT (read-only).
// This is NOT a recorder, serializer, source authorizer, or a way to backfill
// missing historical data. An archive packet is inadmissible until an
// independent Engine12/18 writer supplies verified durable provenance.
import {createHash} from "node:crypto";
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const types=["1m","5m","10m"];
const durations={"1m":60000,"5m":300000,"10m":600000};
const hasText=x=>typeof x==="string"&&x.trim().length>0;
const validTime=x=>finite(x)&&x>0;
const validBar=(bar,tf,asOf)=>{
 if(!bar||typeof bar!=="object")return false;
 if(!validTime(bar.startMs)||!validTime(bar.endMs)||bar.endMs-bar.startMs!==durations[tf]||
    bar.endMs>asOf)return false;
 return ["open","high","low","close"].every(k=>finite(bar[k]))&&
   bar.low<=bar.high&&bar.open>=bar.low&&bar.open<=bar.high&&
   bar.close>=bar.low&&bar.close<=bar.high;
};
export function auditEngine3RawBarPacketForCalibration({
 prepared=null,storageReceipt=null,sourceEvidence=null,readback=null,
}={}){
 const issues=[];
 const p=prepared?.packet;
 const asOf=p?.evaluationTimeMs;
 if(prepared?.ok!==true||p?.mode!=="NOT_RECORDING"||!validTime(asOf))
   issues.push("PREPARED_PACKET_INVALID");
 if(prepared?.recordingActivated!==false||p?.schema!=="engine3.v6.rawBarPacket.preparation.v2")
   issues.push("PREPARATION_VS_RECORDING_STATE_UNVERIFIED");
 const bars=p?.completedBars;
 for(const tf of types){
   if(!Array.isArray(bars?.[tf])){issues.push("MISSING_TIMEFRAME_"+tf);continue;}
   const seen=new Set();
   for(const b of bars[tf]){
     if(!validBar(b,tf,asOf)){issues.push("INVALID_OR_FUTURE_BAR_"+tf);break;}
     if(seen.has(b.startMs)){issues.push("DUPLICATE_BAR_"+tf);break;}
     seen.add(b.startMs);
   }
   // A nonempty packet may still be too sparse; do not certify completeness.
   if(bars[tf].length===0)issues.push("EMPTY_TIMEFRAME_"+tf);
   const before=p?.sourceCountsBeforeFiltering?.[tf];
   const after=p?.sourceCountsAfterFiltering?.[tf];
   const counts=p?.sourceFiltering?.[tf];
   const coverage=p?.coverage?.[tf];
   if(!Number.isSafeInteger(before)||before<0||
      !Number.isSafeInteger(after)||after!==bars[tf].length||
      counts?.observedCount!==before||counts?.acceptedCount!==after||
      counts?.rejectedCount!==before-counts?.completedCount||
      counts?.truncatedCount!==0||
      before!==after||
      coverage?.coverageState!=="COMPLETE"||
      coverage?.gapCount!==0||p?.gapState?.[tf]!=="COMPLETE")
      issues.push("SOURCE_FILTER_COUNTS_OR_COVERAGE_UNVERIFIED_"+tf);
   if(!Array.isArray(p?.sourceBarReferences?.[tf])||
      p.sourceBarReferences[tf].length!==bars[tf].length||
      p.sourceBarReferences[tf].some(b=>!hasText(b.sourceBarId)||
       !hasText(b.sourceRevisionId)||!hasText(b.sourcePayloadDigest)||
       !hasText(b.sourceContract)||!validTime(b.availableAtMs)||
       b.availableAtMs>asOf||b.finality!=="CONFIRMED"))
      issues.push("SOURCE_BAR_REFS_OR_ASOF_UNVERIFIED_"+tf);
 }
 if(!hasText(p?.engine26?.candidateId)||!hasText(p?.engine26?.zoneId))
   issues.push("MISSING_ENGINE26_IDENTITY");
 const activationSource=p?.engine26?.activationSource;
 if(!["ENGINE26_AUTHORIZED","ENGINE3_OBSERVED"].includes(activationSource))
   issues.push("ACTIVATION_SOURCE_UNVERIFIED");
 if(activationSource==="ENGINE3_OBSERVED")
   issues.push("OBSERVED_ACTIVATION_NOT_AUTHORITATIVE");
 const authorized=p?.engine26?.engine3AuthorizationStartedAt;
 if(activationSource==="ENGINE26_AUTHORIZED" &&
   !validTime(authorized)&&!(typeof authorized==="string"&&Number.isFinite(Date.parse(authorized))))
   issues.push("ENGINE26_AUTHORIZATION_TIMESTAMP_MISSING");
 if(!hasText(p?.engine11ProvenanceReceiptId)||
    !hasText(p?.engine11ProvenanceDigest)||
    p?.engine11ProvenanceSchema!=="engine11.es.completedCandleProvenance.v1"||
    p?.provenance?.receiptId!==p?.engine11ProvenanceReceiptId||
    p?.provenance?.signatureOrDigest?.value!==p?.engine11ProvenanceDigest)
   issues.push("ENGINE11_PROVENANCE_RECEIPT_MISSING_OR_MISMATCH");
 if(sourceEvidence?.independentRawReceiptVerified!==true||
    sourceEvidence?.verifiedEngine11ReceiptId!==p?.engine11ProvenanceReceiptId||
    sourceEvidence?.verifiedEngine11Digest!==p?.engine11ProvenanceDigest)
   issues.push("ENGINE11_INDEPENDENT_ORIGIN_NOT_VERIFIED");
 if(!hasText(sourceEvidence?.provider)||!hasText(sourceEvidence?.feedId)||
   !hasText(sourceEvidence?.contractId)||!hasText(sourceEvidence?.priceBasis)||
   !hasText(sourceEvidence?.rollPolicy)||!hasText(sourceEvidence?.clockProvenance)||
   !hasText(sourceEvidence?.barCompletionMethod))
   issues.push("BAR_SOURCE_PROVENANCE_NOT_VERIFIED");
 if(sourceEvidence?.observedAsOfTimeMs!==asOf)
   issues.push("BAR_SOURCE_ASOF_TIME_NOT_VERIFIED");
 // A self-described feed ID is not proof: require a separately approved
 // evidence attestation, explicit gap coverage and roll reconciliation.
 if(sourceEvidence?.approvedSourceAttestation!==true||
    !hasText(sourceEvidence?.attestationId)||
    sourceEvidence?.gapCoverageVerified!==true||
    sourceEvidence?.gapCount!==0||
    sourceEvidence?.rollReconciliationVerified!==true)
   issues.push("BAR_PROVENANCE_ATTESTATION_OR_COVERAGE_MISSING");
 if(storageReceipt?.writerOwnerApproved!==true||
    !hasText(storageReceipt?.owner)||!hasText(storageReceipt?.writerVersion)||
    !hasText(storageReceipt?.immutableNamespace))
   issues.push("WRITER_AND_STORAGE_OWNER_UNVERIFIED");
 if(storageReceipt?.durablyCommitted!==true||
    storageReceipt?.writeMode!=="EXCLUSIVE_NO_OVERWRITE"||
    storageReceipt?.restartReconciled!==true||
    storageReceipt?.diskFailureFailClosed!==true||
    storageReceipt?.backpressureFailClosed!==true||
    storageReceipt?.corruptionRecoveryTested!==true||
    storageReceipt?.missingSourceFailClosed!==true)
   issues.push("DURABILITY_AND_FAILURE_SAFETY_UNVERIFIED");
 const body= p&&typeof p==="object"?JSON.stringify(p):null;
 const hash=body?createHash("sha256").update(body).digest("hex"):null;
 if(!hash||prepared?.sha256!==hash||storageReceipt?.sha256!==hash||
    readback?.sha256!==hash||readback?.independentVerifierApproved!==true)
   issues.push("END_TO_END_CHECKSUM_READBACK_UNVERIFIED");
 if(!hasText(prepared?.dedupeKey)||storageReceipt?.dedupeKey!==prepared?.dedupeKey||
    readback?.dedupeKey!==prepared?.dedupeKey)
   issues.push("END_TO_END_DEDUPE_UNVERIFIED");
 const unique=[...new Set(issues)];
 return {
   schema:"engine3.v6.phase3.calibrationAdmissibility.v1",
   mode:"AUDIT_ONLY",calibrationAdmissible:unique.length===0,
   issues:unique,failClosed:unique.length>0,
   recorderActivatedByAudit:false,writerInvoked:false,
   policy:"NO_HISTORICAL_REINTERPRETATION_WITHOUT_VERIFIED_SOURCE_AND_READBACK",
 };
}
export default auditEngine3RawBarPacketForCalibration;
