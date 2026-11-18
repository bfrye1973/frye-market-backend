// Phase3 preparation: deterministic bounded original-as-of ES raw bar packet.
// In-memory only; Engine11 owns upstream provenance and Engine12 owns durable
// storage, receipt verification, retention, activation and immutable readback.
import {createHash} from "node:crypto";
import {deriveCandleCompletionTruth} from "../candleCompletionTruth.js";

const frames=Object.freeze({"1m":60000,"5m":300000,"10m":600000});
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const integer=x=>Number.isSafeInteger(x)&&x>0;
const text=x=>typeof x==="string"&&x.trim().length>0;
const iso=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?x:null;
const sha=x=>createHash("sha256").update(x).digest("hex");
const rejected=(reason,extra={})=>({ok:false,recordingActivated:false,
 calibrationAdmissible:false,sourceEvidenceVerified:false,reasonCode:reason,...extra});
const parseBar=(b,duration)=> {
 const t=Number(b?.time??b?.t??b?.tSec);
 const open=Number(b?.open),high=Number(b?.high),
   low=Number(b?.low),close=Number(b?.close);
 if(!finite(t)||!Number.isSafeInteger(t*1000)||t<=0||
    ![open,high,low,close].every(finite)||high<low||
    open>high||open<low||close>high||close<low)return null;
 return {startMs:t*1000,endMs:t*1000+duration,open,high,low,close};
};
function collect(bars,tf,now,limit){
 if(!Array.isArray(bars))return {error:"CANDLE_SOURCE_BARS_INVALID_"+tf};
 const duration=frames[tf],truth=deriveCandleCompletionTruth({
   bars,timeframe:tf,evaluationTimeMs:now});
 const completed=truth.completedBars||[];
 const truncated=Math.max(0,completed.length-limit);
 const bounded=completed.slice(-limit);
 const values=bounded.map(b=>parseBar(b,duration));
 const invalid=values.some(b=>!b||b.endMs>now);
 if(invalid)return {error:"CANDLE_SOURCE_BAR_INVALID_OR_FUTURE_"+tf};
 const unique=new Set(values.map(b=>b.startMs));
 if(unique.size!==values.length)return {error:"CANDLE_SOURCE_DUPLICATE_"+tf};
 // Reject malformed completed candles rather than silently returning only a
 // plausible subset. The source attestor must explain all exclusions.
 const invalidCompleted=completed.length-values.length-truncated;
 if(invalidCompleted>0)return {error:"CANDLE_SOURCE_FILTERED_INVALID_"+tf};
 const completionUnknownCount=truth.completionUnknownBars?.length??0;
 const formingCount=bars.length-completed.length-completionUnknownCount;
 if(completionUnknownCount!==0||formingCount<0||formingCount>1)
   return {error:"CANDLE_SOURCE_COMPLETION_CLASSIFICATION_INVALID_"+tf};
 const counts={observedCount:bars.length,completedCount:completed.length,
  acceptedCount:values.length,rejectedCount:0,
  formingCount,completionUnknownCount,invalidCount:0,truncatedCount:truncated};
 return {values,counts};
}
function matchProvenanceBars(provenance,tf,values,now){
 const source=provenance?.bars?.[tf];
 if(!Array.isArray(source)||source.length!==values.length)
   return {reason:"CANDLE_SOURCE_BAR_REFERENCE_COUNT_MISMATCH_"+tf};
 const references=[];
 for(let i=0;i<values.length;i++){
  const bar=values[i],p=source[i];
  if(!p||p.timeframe!==tf||p.startMs!==bar.startMs||p.endMs!==bar.endMs||
     ["open","high","low","close"].some(k=>p[k]!==bar[k])||
     !text(p.sourceBarId)||!text(p.sourceRevisionId)||!text(p.sourcePayloadDigest)||
     !text(p.sourceContract))
    return {reason:"CANDLE_SOURCE_BAR_REFERENCE_MISMATCH_"+tf};
  if(!integer(p.firstReceivedAtMs)||!integer(p.availableAtMs)||
     !integer(p.completionObservedAtMs)||p.firstReceivedAtMs>p.availableAtMs||
     p.availableAtMs>now||p.completionObservedAtMs>now||p.finality!=="CONFIRMED"||
     p.clockStatus!=="VERIFIED"||p.sourceHealth!=="HEALTHY")
    return {reason:"CANDLE_BAR_UNAVAILABLE_ASOF_OR_NOT_FINAL_"+tf};
  references.push({sourceBarId:p.sourceBarId,sourceRevisionId:p.sourceRevisionId,
   sourcePayloadDigest:p.sourcePayloadDigest,sourceContract:p.sourceContract,
   providerEventId:p.providerEventId??null,
   firstReceivedAtMs:p.firstReceivedAtMs,availableAtMs:p.availableAtMs,
   completionObservedAtMs:p.completionObservedAtMs,finality:p.finality});
 }
 return {references};
}
export function buildEngine3RawBarArchivePacket({
 evaluationTimeMs=null,symbol="ES",strategyId="intraday_scalp@10m",
 bars1m=[],bars5m=[],bars10m=[],engine26=null,engine22=null,
 activation=null,engine11Provenance=null,maxBarsPerTf=200,maxBytes=500000,
}={}){
 if(!integer(evaluationTimeMs)||symbol!=="ES"||
   strategyId!=="intraday_scalp@10m"||
   !integer(maxBarsPerTf)||!integer(maxBytes))
   return rejected("INVALID_ARCHIVE_CONTEXT");
 const limit=Math.min(2000,maxBarsPerTf),max=Math.min(1000000,maxBytes);
 const inputs={"1m":bars1m,"5m":bars5m,"10m":bars10m};
 const bars={},before={},after={},filtered={},refs={};
 for(const tf of Object.keys(frames)){
  const c=collect(inputs[tf],tf,evaluationTimeMs,limit);
  if(c.error)return rejected(c.error);
  bars[tf]=c.values;before[tf]=c.counts.observedCount;
  after[tf]=c.counts.acceptedCount;filtered[tf]=c.counts;
  if(engine11Provenance){
   const m=matchProvenanceBars(engine11Provenance,tf,c.values,evaluationTimeMs);
   if(m.reason)return rejected(m.reason);
   refs[tf]=m.references;
  }else refs[tf]=[];
 }
 // A verified Engine11 source receipt must cover the same instant, all
 // timeframes and every omitted/incomplete source interval. Never invent
 // receipt times or source coverage from the candle close boundary.
 if(engine11Provenance &&
   (engine11Provenance.schema!=="engine11.es.completedCandleProvenance.v1"||
    engine11Provenance.symbol!=="ES"||
    engine11Provenance.evaluationTimeMs!==evaluationTimeMs||
    !text(engine11Provenance.receiptId)||
    !text(engine11Provenance.signatureOrDigest?.value)))
   return rejected("CANDLE_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
 const coverage={},gapState={},sourceTimeframeMap={};
 for(const tf of Object.keys(frames)){
  const declared=engine11Provenance?.coverage?.[tf];
  coverage[tf]=declared?{...declared}:null;
  gapState[tf]=declared?.coverageState??"UNKNOWN";
  sourceTimeframeMap[tf]=engine11Provenance?.timeframeSourceMap?.[tf]??null;
  if(declared&&(
    declared.acceptedCount!==after[tf]||
    declared.observedCount!==filtered[tf].completedCount||
    declared.rejectedCount!==0||
    !Array.isArray(declared.gaps)||declared.gapCount!==declared.gaps.length))
    return rejected("CANDLE_SOURCE_COVERAGE_COUNT_MISMATCH_"+tf);
 }
 const publication=engine22?.authorizedWorkingStructure??null;
 const publishedAt=iso(publication?.publishedAt);
 const validPublication=publishedAt!==null&&Date.parse(publishedAt)<=evaluationTimeMs;
 // Caller-side digest is a pointer only. Independent Engine11 origin,
 // source raw bytes and Engine12 readback MUST be separately verified.
 const sourceProof=engine11Provenance?{
  schema:engine11Provenance.schema,receiptId:engine11Provenance.receiptId,
  signatureOrDigest:engine11Provenance.signatureOrDigest??null,
  providerId:engine11Provenance.providerId??null,
  feedId:engine11Provenance.feedId??null,
  entitlementMode:engine11Provenance.entitlementMode??"UNKNOWN",
  sourceMode:engine11Provenance.sourceMode??"UNKNOWN",
  physicalContract:engine11Provenance.physicalContract??null,
  priceBasis:engine11Provenance.priceBasis??null,
  rollPolicy:engine11Provenance.rollPolicy??null,
  sourceFingerprint:engine11Provenance.sourceFingerprint??null,
 }:null;
 const body={schema:"engine3.v6.rawBarPacket.preparation.v2",mode:"NOT_RECORDING",
  symbol,strategyId,evaluationTimeMs,
  engine26:{candidateId:engine26?.candidateId??null,zoneId:engine26?.zoneId??null,
   zone:engine26?.entryZone??null,
   engine3AuthorizationStartedAt:engine26?.engine3AuthorizationStartedAt??null,
   observedActivationStartedAtMs:activation?.activationStartedAtMs??null,
   activationSource:activation?.activationSource??"UNAVAILABLE"},
  engine22:validPublication?{schema:publication.schema,publishedAt,
   publicationRevision:publication.publicationRevision??null,
   modelFingerprint:publication.modelFingerprint??null,
   submicro:publication.degrees?.submicro??null,
   micro:publication.degrees?.micro??null}:null,
  engine22PublicationAsOfValid:validPublication,
  engine11ProvenanceReceiptId:sourceProof?.receiptId??null,
  engine11ProvenanceDigest:sourceProof?.signatureOrDigest?.value??null,
  engine11ProvenanceSchema:sourceProof?.schema??null,
  provenance:sourceProof,
  sourceCountsBeforeFiltering:before,
  sourceCountsAfterFiltering:after,
  sourceFiltering:filtered,
  coverage,gapState,sourceTimeframeMap,
  sourceBarReferences:refs,
  completedBars:bars};
 const json=JSON.stringify(body),byteSize=Buffer.byteLength(json,"utf8");
 if(byteSize>max)return rejected("ARCHIVE_PACKET_SIZE_LIMIT",{byteSize,maxBytes:max});
 const receiptVerified=false; // Engine3 never certifies Engine11 origin.
 return {ok:true,recordingActivated:false,calibrationAdmissible:false,
  sourceEvidenceVerified:receiptVerified,packet:body,
  sha256:sha(json),byteSize,dedupeKey:[symbol,strategyId,evaluationTimeMs].join("|"),
  reasonCode:engine11Provenance?
    "ARCHIVE_PACKET_PREPARED_PROVENANCE_NOT_INDEPENDENTLY_VERIFIED":
    "ARCHIVE_PACKET_PREPARED_NO_ENGINE11_RECEIPT"};
}
// Minimal caller adapter for Engine12 record({packet,provenance}).
// It NEVER calls a writer or verifies cryptographic source origin.
// Only complete, untruncated and exact-reference packets may be submitted
// for Engine12's independent trust verification.
export function buildEngine3CandleArchiveWriterHandoff({
 prepared=null,engine11Provenance=null,
}={}){
 const packet=prepared?.packet;
 if(prepared?.ok!==true||packet?.schema!=="engine3.v6.rawBarPacket.preparation.v2"||
    prepared?.recordingActivated!==false||
    prepared?.sourceEvidenceVerified!==false||
    prepared?.calibrationAdmissible!==false)
   return rejected("ENGINE3_PACKET_PREPARATION_NOT_SAFE");
 if(engine11Provenance?.schema!=="engine11.es.completedCandleProvenance.v1"||
    !text(engine11Provenance.receiptId)||
    !text(engine11Provenance.signatureOrDigest?.value)||
    packet?.engine11ProvenanceReceiptId!==engine11Provenance.receiptId||
    packet?.engine11ProvenanceDigest!==engine11Provenance.signatureOrDigest.value||
    packet?.evaluationTimeMs!==engine11Provenance.evaluationTimeMs)
   return rejected("CANDLE_SOURCE_RECEIPT_IDENTITY_MISMATCH");
 if(!text(packet?.engine26?.candidateId)||!text(packet?.engine26?.zoneId))
   return rejected("ENGINE26_CANDIDATE_ZONE_IDENTITY_MISSING");
 for(const tf of Object.keys(frames)){
  const bars=packet?.completedBars?.[tf],src=engine11Provenance?.bars?.[tf];
  const counts=packet?.sourceFiltering?.[tf],coverage=engine11Provenance?.coverage?.[tf];
  const refs=packet?.sourceBarReferences?.[tf];
  if(!Array.isArray(bars)||!Array.isArray(src)||!Array.isArray(refs)||
     bars.length===0||bars.length!==src.length||refs.length!==src.length||
     counts?.truncatedCount!==0||counts?.invalidCount!==0||
     counts?.completionUnknownCount!==0||counts?.formingCount>1||
     counts?.observedCount!==counts?.completedCount+counts?.formingCount||
     counts?.completedCount!==bars.length||
     packet?.sourceCountsBeforeFiltering?.[tf]!==counts.observedCount||
     packet?.sourceCountsAfterFiltering?.[tf]!==bars.length||
     coverage?.coverageState!=="COMPLETE"||coverage?.gapCount!==0||
     coverage?.acceptedCount!==bars.length||
     coverage?.observedCount!==counts.completedCount||
     coverage?.rejectedCount!==0||packet?.gapState?.[tf]!=="COMPLETE"||
     !text(packet?.sourceTimeframeMap?.[tf]))
    return rejected("CANDLE_SOURCE_COVERAGE_INCOMPLETE_"+tf);
  for(let i=0;i<bars.length;i++){
   const b=bars[i],v=src[i],r=refs[i];
   if(!v||!r||v.timeframe!==tf||v.startMs!==b.startMs||
      v.endMs!==b.endMs||v.endMs-b.startMs!==frames[tf]||
      v.endMs>packet.evaluationTimeMs||
      ["open","high","low","close"].some(k=>v[k]!==b[k])||
      !text(r.sourceBarId)||r.sourceBarId!==v.sourceBarId||
      r.sourceRevisionId!==v.sourceRevisionId||
      r.sourcePayloadDigest!==v.sourcePayloadDigest||
      r.sourceContract!==v.sourceContract||
      r.availableAtMs!==v.availableAtMs||
      v.finality!=="CONFIRMED")
     return rejected("CANDLE_SOURCE_BAR_REFERENCE_MISMATCH_"+tf);
  }
 }
 // Packet SHA is only Engine3's own deterministic digest, not Engine11
 // origin authentication. Engine12 must independently verify both bytes.
 if(prepared.sha256!==sha(JSON.stringify(packet)))
   return rejected("ENGINE3_PACKET_DIGEST_MISMATCH");
 return {
  ok:true,mode:"PREPARED_FOR_INDEPENDENT_ENGINE12_VALIDATION",
  recordingActivated:false,calibrationAdmissible:false,
  sourceEvidenceVerified:false,writerInvoked:false,
  writerInput:{packet,provenance:engine11Provenance},
  packetSha256:prepared.sha256,dedupeKey:prepared.dedupeKey,
  reasonCode:"ENGINE12_INDEPENDENT_PROVENANCE_VERIFICATION_REQUIRED",
 };
}
export default buildEngine3RawBarArchivePacket;
