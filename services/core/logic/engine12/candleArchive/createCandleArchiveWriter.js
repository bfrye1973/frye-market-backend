// Engine 12 sandbox-only immutable ES candle archive writer.
// Issue #344. Recording OFF by default. No scheduler or production activation.
// Canonical Replay under /var/data/replay/es is never touched.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ENGINE12_CANDLE_ARCHIVE_SCHEMA="engine12.es.candleArchive.v1";
export const ENGINE11_PROVENANCE_SCHEMA="engine11.es.completedCandleProvenance.v1";
const TF_MS=Object.freeze({"1m":60000,"5m":300000,"10m":600000});
const finalStatuses=new Set(["CONFIRMED"]);

const isObj=x=>x&&typeof x==="object"&&!Array.isArray(x);
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const sha256=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const safeDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||""));
const safeTime=t=>/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(String(t||""));
const contract=x=>/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(String(x||""));

export function canonicalJson(value){
  if(Array.isArray(value))return "["+value.map(canonicalJson).join(",")+"]";
  if(isObj(value))return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonicalJson(value[k])).join(",")+"}";
  return JSON.stringify(value);
}

function normalizeError(error){
  const code=String(error?.code||"");
  if(code==="ENOSPC")return "CANDLE_ARCHIVE_STORAGE_EXHAUSTED";
  if(code==="EACCES"||code==="EPERM")return "CANDLE_ARCHIVE_PERMISSION_DENIED";
  return "CANDLE_ARCHIVE_WRITE_FAILED";
}

export function validateCandleArchiveInput({packet,provenance,trustResult}={}){
  const reasons=[];
  if(!isObj(packet)||packet?.symbol!=="ES"||!finite(packet?.evaluationTimeMs))
    reasons.push("CANDLE_PACKET_INVALID");
  if(!isObj(provenance)||provenance.schema!==ENGINE11_PROVENANCE_SCHEMA)
    reasons.push("CANDLE_SOURCE_PROVENANCE_UNVERIFIED");
  if(provenance?.evaluationTimeMs!==packet?.evaluationTimeMs)
    reasons.push("CANDLE_SOURCE_EVALUATION_ASOF_MISMATCH");
  if(provenance?.symbol!=="ES"||!contract(provenance?.physicalContract))
    reasons.push("CANDLE_SOURCE_CONTRACT_MISMATCH");
  if(provenance?.entitlementMode!=="LIVE_ENTITLED"||provenance?.sourceMode!=="ORIGINAL_CAPTURE")
    reasons.push("CANDLE_SOURCE_ENTITLEMENT_UNVERIFIED");
  if(provenance?.clock?.clockStatus!=="VERIFIED")
    reasons.push("CANDLE_SOURCE_CLOCK_UNVERIFIED");
  if(provenance?.sourceHealth?.state!=="HEALTHY")
    reasons.push("CANDLE_SOURCE_HEALTH_UNVERIFIED");
  if(provenance?.signatureOrDigest?.signatureStatus!=="INDEPENDENTLY_VERIFIED"||
     trustResult?.verified!==true||
     !["SYNTHETIC_SANDBOX","REAL_SOURCE_ATTESTED"].includes(trustResult?.verificationMode))
    reasons.push("CANDLE_SOURCE_PROVENANCE_UNVERIFIED");
  if(trustResult?.receiptId!==provenance?.receiptId||
     trustResult?.digest!==provenance?.signatureOrDigest?.value)
    reasons.push("CANDLE_SOURCE_RECEIPT_DIGEST_MISMATCH");
  if(packet?.engine11ProvenanceSchema!==provenance?.schema||
     packet?.engine11ProvenanceReceiptId!==provenance?.receiptId||
     packet?.engine11ProvenanceDigest!==provenance?.signatureOrDigest?.value)
    reasons.push("CANDLE_PACKET_PROVENANCE_CROSSLINK_MISMATCH");

  const packetBars=packet?.completedBars||{};
  for(const [tf,duration] of Object.entries(TF_MS)){
    const bars=provenance?.bars?.[tf];
    const coverage=provenance?.coverage?.[tf];
    if(!Array.isArray(bars)||!coverage||coverage.coverageState!=="COMPLETE"||
       coverage.gapCount!==0||coverage.acceptedCount!==bars?.length||bars.length===0){
      reasons.push("CANDLE_SOURCE_COVERAGE_INCOMPLETE_"+tf);
      continue;
    }
    if(!Array.isArray(packetBars?.[tf])){
      reasons.push("CANDLE_PACKET_TIMEFRAME_MISSING_"+tf);
    }else{
      const before=packet?.sourceCountsBeforeFiltering?.[tf];
      const after=packet?.sourceCountsAfterFiltering?.[tf];
      const filtering=packet?.sourceFiltering?.[tf];
      const map=packet?.sourceTimeframeMap?.[tf];
      const refs=packet?.sourceBarReferences?.[tf];
      // Forming observations are not rejected completed candles. They are
      // excluded from the completed-only source/coverage comparison.
      if(before!==filtering?.observedCount||
         after!==coverage.acceptedCount||
         filtering?.acceptedCount!==coverage.acceptedCount||
         filtering?.completedCount!==coverage.observedCount||
         filtering?.rejectedCount!==coverage.rejectedCount||
         filtering?.rejectedCount!==0||
         filtering?.invalidCount!==0||
         filtering?.completionUnknownCount!==0||
         !Number.isSafeInteger(filtering?.formingCount)||
         filtering.formingCount<0||filtering.formingCount>1||
         filtering.observedCount!==filtering.completedCount+filtering.formingCount)
        reasons.push("CANDLE_PACKET_SOURCE_COUNT_MISMATCH_"+tf);
      if(filtering?.truncatedCount!==0)
        reasons.push("CANDLE_PACKET_TRUNCATED_SOURCE_"+tf);
      if(packet?.gapState?.[tf]!==coverage.coverageState)
        reasons.push("CANDLE_PACKET_GAP_STATE_MISMATCH_"+tf);
      if(map!==provenance?.timeframeSourceMap?.[tf])
        reasons.push("CANDLE_PACKET_TIMEFRAME_MAP_MISMATCH_"+tf);
      if(packetBars[tf].length!==bars.length)
        reasons.push("CANDLE_PACKET_BAR_COUNT_MISMATCH_"+tf);
      if(!Array.isArray(refs)||refs.length!==bars.length)
        reasons.push("CANDLE_PACKET_SOURCE_REFERENCE_COUNT_MISMATCH_"+tf);
      else{
        for(let i=0;i<bars.length;i++){
          const a=packetBars[tf][i], b=bars[i], r=refs[i];
          if(a?.startMs!==b?.startMs||a?.endMs!==b?.endMs||
             ["open","high","low","close"].some(k=>a?.[k]!==b?.[k]))
            reasons.push("CANDLE_PACKET_BAR_MISMATCH_"+tf);
          if(r?.sourceBarId!==b?.sourceBarId||
             r?.sourceRevisionId!==b?.sourceRevisionId||
             r?.sourcePayloadDigest!==b?.sourcePayloadDigest||
             r?.sourceContract!==b?.sourceContract||
             r?.providerEventId!==(b?.providerEventId??null)||
             r?.firstReceivedAtMs!==b?.firstReceivedAtMs||
             r?.availableAtMs!==b?.availableAtMs||
             r?.completionObservedAtMs!==b?.completionObservedAtMs||
             r?.finality!==b?.finality)
            reasons.push("CANDLE_PACKET_SOURCE_REFERENCE_MISMATCH_"+tf);
        }
      }
    }
    for(const b of bars){
      if(!contract(b?.sourceContract)||b.sourceContract!==provenance.physicalContract)
        reasons.push("CANDLE_SOURCE_CONTRACT_MISMATCH");
      if(b?.timeframe!==tf||!finite(b?.startMs)||!finite(b?.endMs)||
         b.endMs-b.startMs!==duration||b.endMs>packet.evaluationTimeMs)
        reasons.push("CANDLE_BAR_FUTURE_EVIDENCE");
      if(!finite(b?.availableAtMs)||!finite(b?.completionObservedAtMs)||
         b.availableAtMs>packet.evaluationTimeMs||b.completionObservedAtMs>packet.evaluationTimeMs)
        reasons.push("CANDLE_BAR_UNAVAILABLE_ASOF");
      if(!finalStatuses.has(b?.finality))reasons.push("CANDLE_BAR_NOT_FINAL");
      if(typeof b?.sourceBarId!=="string"||typeof b?.sourceRevisionId!=="string"||
         !/^[a-f0-9]{64}$/.test(String(b?.sourcePayloadDigest||"")))
        reasons.push("CANDLE_SOURCE_BAR_INVALID");
    }
  }
  return {ok:reasons.length===0,reasons:[...new Set(reasons)]};
}

function archiveDateTime(ms){
  const d=new Date(ms);
  if(Number.isNaN(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Phoenix",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(d);
  const get=t=>parts.find(x=>x.type===t)?.value;
  return {date:get("year")+"-"+get("month")+"-"+get("day"),time:get("hour")+get("minute")+get("second")};
}

function fsyncDir(dir,ops){
  const fd=ops.openSync(dir,"r");
  try{ops.fsyncSync(fd)}finally{ops.closeSync(fd)}
}
function writeExclusiveFile(file,bytes,ops){
  // The archive namespace must never become readable by other users.
  const directory=path.dirname(file);
  ops.mkdirSync(directory,{recursive:true,mode:0o700});
  const archiveRoot=path.dirname(path.dirname(directory));
  for(const dir of [archiveRoot,path.dirname(directory),directory]){
    const mode=ops.statSync(dir).mode & 0o777;
    if((mode & 0o077)!==0){
      const error=new Error("CANDLE_ARCHIVE_DIRECTORY_PERMISSIONS");
      error.code="EACCES";throw error;
    }
  }
  const tmp=file+"."+process.pid+"."+Date.now()+".pending";
  let fd;
  try{
    fd=ops.openSync(tmp,"wx",0o600);
    ops.writeFileSync(fd,bytes);
    ops.fsyncSync(fd);
    ops.closeSync(fd);fd=null;
    ops.linkSync(tmp,file);
    fsyncDir(path.dirname(file),ops);
    ops.unlinkSync(tmp);
    return {ok:true};
  }catch(error){
    if(fd!=null)try{ops.closeSync(fd)}catch{}
    try{ops.unlinkSync(tmp)}catch{}
    if(error?.code==="EEXIST")return {ok:false,reason:"EXISTS"};
    throw error;
  }
}

export function createEngine12CandleArchiveWriter({
  root="/var/data/replay/engine12-candles",
  enabled=process.env.ENGINE12_CANDLE_ARCHIVE_ENABLED==="true",
  trustVerifier=()=>({verified:false,receiptId:null}),
  fsOps=fs,
  maxRecordBytes=1024*1024,
  maxArchiveBytes=1024*1024*1024,
  faultInjector=()=>{},
}={}){
  const fault=stage=>faultInjector(stage);
  function treeBytes(dir){
    if(!fsOps.existsSync(dir))return 0;
    let total=0,stack=[dir];
    while(stack.length){
      const cur=stack.pop();
      for(const e of fsOps.readdirSync(cur,{withFileTypes:true})){
        const p=path.join(cur,e.name);
        if(e.isDirectory())stack.push(p);
        else if(e.isFile())total+=fsOps.statSync(p).size;
      }
    }
    return total;
  }
  function checkDiskHeadroom(){
    // The whole mount, not merely this archive folder, determines safe headroom.
    // Conservative unavailable/invalid measurements must never permit writes.
    if(typeof fsOps.statfsSync!=="function")return "CANDLE_ARCHIVE_DISK_HEALTH_UNVERIFIED";
    try{
      const s=fsOps.statfsSync(path.dirname(root));
      const blocks=Number(s.blocks),available=Number(s.bavail);
      if(!Number.isFinite(blocks)||blocks<=0||
         !Number.isFinite(available)||available<0||available>blocks)
         return "CANDLE_ARCHIVE_DISK_HEALTH_UNVERIFIED";
      if((blocks-available)/blocks>=0.70)
         return "CANDLE_ARCHIVE_WHOLE_DISK_STOP_THRESHOLD";
      return null;
    }catch{return "CANDLE_ARCHIVE_DISK_HEALTH_UNVERIFIED";}
  }
  function record({packet,provenance}={}){
    if(!enabled)return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_DISABLED"};
    if(!fsOps.existsSync(path.dirname(root)))
      return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_MOUNT_MISSING"};
    const diskStop=checkDiskHeadroom();
    if(diskStop)return {ok:false,recorded:false,reason:diskStop};
    const trustResult=trustVerifier({provenance,packet});
    const valid=validateCandleArchiveInput({packet,provenance,trustResult});
    if(!valid.ok)return {ok:false,recorded:false,reason:valid.reasons[0],reasons:valid.reasons};

    const envelope={schema:ENGINE12_CANDLE_ARCHIVE_SCHEMA,writerVersion:"engine12.candleArchiveWriter.v1",
      recordedPayload:{packet,provenance},sourceTrust:{
        verified:true,
        receiptId:trustResult.receiptId,
        digest:trustResult.digest,
        verificationMode:trustResult.verificationMode,
        sourceAttestationStatus:trustResult.verificationMode==="REAL_SOURCE_ATTESTED"?
          "ATTESTED_REAL_SOURCE":"SYNTHETIC_SANDBOX_ONLY"
      }};
    const bytes=Buffer.from(canonicalJson(envelope)+"\n");
    if(bytes.length>maxRecordBytes)return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_RECORD_TOO_LARGE"};
    if(treeBytes(root)+bytes.length>maxArchiveBytes)
      return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_STORAGE_EXHAUSTED"};

    const digest=sha256(bytes);
    const stamp=archiveDateTime(packet.evaluationTimeMs);
    if(!stamp||!safeDate(stamp.date)||!safeTime(stamp.time))
      return {ok:false,recorded:false,reason:"CANDLE_PACKET_INVALID_TIME"};
    const identity=sha256(Buffer.from(canonicalJson({
      symbol:packet.symbol,strategyId:packet.strategyId,evaluationTimeMs:packet.evaluationTimeMs,
      candidateId:packet?.engine26?.candidateId??null,zoneId:packet?.engine26?.zoneId??null
    })));
    const dataFile=path.join(root,"es",stamp.date,stamp.time+"-"+digest+".json");
    const receiptFile=path.join(root,"receipts",stamp.date,identity+".json");

    try{
      fault("BEFORE_RECEIPT_LOOKUP");
      if(fsOps.existsSync(receiptFile)){
        const receipt=JSON.parse(fsOps.readFileSync(receiptFile,"utf8"));
        if(receipt.packetSha256===digest&&receipt.dataFile===dataFile){
          if(!fsOps.existsSync(dataFile))
            return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_ORPHAN_RECEIPT"};
          const existingBytes=fsOps.readFileSync(dataFile);
          if(sha256(existingBytes)!==digest)
            return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_IMMUTABILITY_CONFLICT"};
          return {ok:true,recorded:true,duplicate:true,reason:"CANDLE_ARCHIVE_ALREADY_RECORDED",dataFile,receiptFile,sha256:digest};
        }
        return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_IDENTITY_CONFLICT"};
      }
      if(fsOps.existsSync(dataFile)){
        const current=fsOps.readFileSync(dataFile);
        if(sha256(current)!==digest)return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_IMMUTABILITY_CONFLICT"};
      }else{
        fault("BEFORE_DATA_WRITE");
        const wr=writeExclusiveFile(dataFile,bytes,fsOps);
        fault("AFTER_DATA_FINAL_CLAIM");
        if(!wr.ok){
          const current=fsOps.readFileSync(dataFile);
          if(sha256(current)!==digest)return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_IMMUTABILITY_CONFLICT"};
        }
      }
      fault("BEFORE_DATA_READBACK");
      const readback=fsOps.readFileSync(dataFile);
      if(sha256(readback)!==digest)
        return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_READBACK_HASH_MISMATCH"};

      const receipt={schema:"engine12.es.candleArchiveReceipt.v1",status:"RECORDED_VERIFIED",
        packetSha256:digest,dedupeIdentity:identity,dataFile,byteSize:bytes.length,
        evaluationTimeMs:packet.evaluationTimeMs,engine11ProvenanceReceiptId:provenance.receiptId,
        engine11ProvenanceDigest:provenance.signatureOrDigest.value,
        sourceAttestationStatus:trustResult.verificationMode==="REAL_SOURCE_ATTESTED"?
          "ATTESTED_REAL_SOURCE":"SYNTHETIC_SANDBOX_ONLY",
        engine26:{candidateId:packet?.engine26?.candidateId??null,zoneId:packet?.engine26?.zoneId??null,
          engine3AuthorizationStartedAt:packet?.engine26?.engine3AuthorizationStartedAt??null},
        engine22:{publishedAt:packet?.engine22?.publishedAt??null,
          publicationRevision:packet?.engine22?.publicationRevision??null,
          modelFingerprint:packet?.engine22?.modelFingerprint??null},
        readbackSha256:digest,verifiedAtUtc:new Date().toISOString()};
      const receiptBytes=Buffer.from(canonicalJson(receipt)+"\n");
      fault("BEFORE_RECEIPT_WRITE");
      const rw=writeExclusiveFile(receiptFile,receiptBytes,fsOps);
      fault("AFTER_RECEIPT_FINAL_CLAIM");
      if(!rw.ok){
        const stored=JSON.parse(fsOps.readFileSync(receiptFile,"utf8"));
        if(stored.packetSha256!==digest||stored.dataFile!==dataFile)
          return {ok:false,recorded:false,reason:"CANDLE_ARCHIVE_IDENTITY_CONFLICT"};
      }
      return {ok:true,recorded:true,duplicate:false,reason:"RECORDED_VERIFIED",dataFile,receiptFile,sha256:digest};
    }catch(error){
      return {ok:false,recorded:false,reason:normalizeError(error),errorCode:error?.code??null};
    }
  }

  function reconcile(){
    if(!enabled)return {ok:false,reason:"CANDLE_ARCHIVE_DISABLED",recovered:0,conflicts:0};
    const dataRoot=path.join(root,"es"),receiptRoot=path.join(root,"receipts");
    let recovered=0,conflicts=0;
    if(!fsOps.existsSync(dataRoot))return {ok:true,recovered,conflicts};
    for(const date of fsOps.readdirSync(dataRoot)){
      const dir=path.join(dataRoot,date);
      if(!safeDate(date)||!fsOps.statSync(dir).isDirectory())continue;
      for(const name of fsOps.readdirSync(dir).filter(x=>x.endsWith(".json"))){
        const file=path.join(dir,name),bytes=fsOps.readFileSync(file),digest=sha256(bytes);
        let envelope;try{envelope=JSON.parse(bytes.toString("utf8"))}catch{conflicts++;continue}
        const packet=envelope?.recordedPayload?.packet;
        if(!packet){conflicts++;continue}
        const identity=sha256(Buffer.from(canonicalJson({symbol:packet.symbol,strategyId:packet.strategyId,
          evaluationTimeMs:packet.evaluationTimeMs,candidateId:packet?.engine26?.candidateId??null,
          zoneId:packet?.engine26?.zoneId??null})));
        const receiptFile=path.join(receiptRoot,date,identity+".json");
        if(fsOps.existsSync(receiptFile))continue;
        const provenance=envelope?.recordedPayload?.provenance;
        const trustResult=trustVerifier({provenance,packet});
        const valid=validateCandleArchiveInput({packet,provenance,trustResult});
        if(!valid.ok){conflicts++;continue}
        const receipt={schema:"engine12.es.candleArchiveReceipt.v1",status:"RECORDED_VERIFIED",
          packetSha256:digest,dedupeIdentity:identity,dataFile:file,byteSize:bytes.length,
          evaluationTimeMs:packet.evaluationTimeMs,engine11ProvenanceReceiptId:provenance.receiptId,
          engine11ProvenanceDigest:provenance.signatureOrDigest.value,
          sourceAttestationStatus:trustResult.verificationMode==="REAL_SOURCE_ATTESTED"?
            "ATTESTED_REAL_SOURCE":"SYNTHETIC_SANDBOX_ONLY",
          readbackSha256:digest,
          recoveredAfterRestart:true,verifiedAtUtc:new Date().toISOString()};
        try{
          const wr=writeExclusiveFile(receiptFile,Buffer.from(canonicalJson(receipt)+"\n"),fsOps);
          if(wr.ok)recovered++;
        }catch{conflicts++}
      }
    }
    return {ok:conflicts===0,recovered,conflicts};
  }
  return Object.freeze({record,reconcile,root,enabled});
}
