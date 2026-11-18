import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createEngine12CandleArchiveWriter,
  validateCandleArchiveInput
} from "../logic/engine12/candleArchive/createCandleArchiveWriter.js";

const evalMs=Date.parse("2026-11-18T15:00:00Z");

function packet(){
  const durations={"1m":60000,"5m":300000,"10m":600000};
  const completedBars={},sourceCountsBeforeFiltering={},sourceCountsAfterFiltering={},
    sourceFiltering={},sourceTimeframeMap={},gapState={},sourceBarReferences={};
  for(const [tf,dur] of Object.entries(durations)){
    const start=evalMs-dur-5000;
    completedBars[tf]=[{startMs:start,endMs:start+dur,open:7000,high:7001,low:6999,close:7000.25}];
    sourceCountsBeforeFiltering[tf]=1;
    sourceCountsAfterFiltering[tf]=1;
    sourceFiltering[tf]={observedCount:1,completedCount:1,acceptedCount:1,rejectedCount:0,
      formingCount:0,completionUnknownCount:0,invalidCount:0,truncatedCount:0};
    sourceTimeframeMap[tf]="MASSIVE_"+tf;
    gapState[tf]="COMPLETE";
    sourceBarReferences[tf]=[{
      sourceBarId:"bar-"+tf,sourceRevisionId:"r1",
      sourcePayloadDigest:"a".repeat(64),sourceContract:"ESZ6",
      providerEventId:"event-"+tf,firstReceivedAtMs:start+dur+100,
      availableAtMs:start+dur+200,completionObservedAtMs:start+dur+150,
      finality:"CONFIRMED"
    }];
  }
  return {
    schema:"engine3.v6.rawBarPacket.preparation.v2",
    mode:"NOT_RECORDING",
    symbol:"ES",
    strategyId:"intraday_scalp@10m",
    evaluationTimeMs:evalMs,
    engine26:{
      candidateId:"CAND-1",
      zoneId:"ZONE-1",
      engine3AuthorizationStartedAt:"2026-11-18T14:50:00Z"
    },
    engine22:{
      publishedAt:"2026-11-18T14:55:00Z",
      publicationRevision:3,
      modelFingerprint:"m".repeat(64)
    },
    engine11ProvenanceSchema:"engine11.es.completedCandleProvenance.v1",
    engine11ProvenanceReceiptId:"receipt-real-fixture",
    engine11ProvenanceDigest:"b".repeat(64),
    sourceCountsBeforeFiltering,
    sourceCountsAfterFiltering,
    sourceFiltering,
    sourceTimeframeMap,
    gapState,
    sourceBarReferences,
    completedBars
  };
}

function provenance(){
  const durations={"1m":60000,"5m":300000,"10m":600000};
  const bars={},coverage={},timeframeSourceMap={};
  for(const [tf,dur] of Object.entries(durations)){
    const start=evalMs-dur-5000;
    bars[tf]=[{
      sourceBarId:"bar-"+tf,
      sourceRevisionId:"r1",
      sourcePayloadDigest:"a".repeat(64),
      providerEventId:"event-"+tf,
      timeframe:tf,
      startMs:start,
      endMs:start+dur,
      open:7000,high:7001,low:6999,close:7000.25,volume:100,
      sourceContract:"ESZ6",
      firstReceivedAtMs:start+dur+100,
      availableAtMs:start+dur+200,
      completionObservedAtMs:start+dur+150,
      finality:"CONFIRMED",
      clockStatus:"VERIFIED",
      sourceHealth:"HEALTHY"
    }];
    coverage[tf]={
      observedCount:1,rejectedCount:0,acceptedCount:1,expectedIntervalCount:1,
      gapCount:0,gaps:[],duplicateCount:0,outOfOrderCount:0,lateCount:0,
      correctionCount:0,sessionCalendarVersion:"CME-TEST-v1",coverageState:"COMPLETE"
    };
    timeframeSourceMap[tf]="MASSIVE_"+tf;
  }
  return {
    schema:"engine11.es.completedCandleProvenance.v1",
    receiptId:"receipt-real-fixture",
    providerId:"MASSIVE_POLYGON",
    feedId:"TEST_ENTITLED_FEED",
    entitlementMode:"LIVE_ENTITLED",
    sourceMode:"ORIGINAL_CAPTURE",
    symbol:"ES",
    physicalContract:"ESZ6",
    physicalContractCanonical:"ESZ2026",
    priceBasis:{kind:"UNADJUSTED_PHYSICAL",tickSize:0.25,adjustmentApplied:false},
    rollPolicy:{policyId:"ROLL-v1",resolverRule:"EXPLICIT",resolverCheckedAtMs:evalMs-10000},
    timeframeSourceMap,
    barStartSemantics:"UTC_OPEN_INCLUSIVE",
    barCloseSemantics:"UTC_END_EXCLUSIVE",
    evaluationTimeMs:evalMs,
    clock:{eventClock:"PROVIDER_UTC",receiveClock:"UTC_WALL",clockStatus:"VERIFIED",maxUncertaintyMs:1},
    parserVersion:"parser-v1",
    configVersion:"config-v1",
    sourceFingerprint:"source-fingerprint",
    sourceHealth:{state:"HEALTHY",reasonCodes:[]},
    coverage,
    bars,
    signatureOrDigest:{
      algorithm:"SHA256",
      value:"b".repeat(64),
      attestor:"ENGINE11",
      signatureStatus:"INDEPENDENTLY_VERIFIED"
    }
  };
}

const trust=({provenance:p})=>({
  verified:true,
  receiptId:p.receiptId,
  digest:p.signatureOrDigest.value,
  verificationMode:"SYNTHETIC_SANDBOX"
});

function temp(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"e12-candle-"));
  const replay=path.join(base,"replay");
  fs.mkdirSync(replay,{recursive:true});
  return {base,replay,root:path.join(replay,"engine12-candles")};
}

test("disabled writer creates nothing",()=>{
  const t=temp();
  try{
    const w=createEngine12CandleArchiveWriter({root:t.root});
    assert.equal(w.record({packet:packet(),provenance:provenance()}).reason,"CANDLE_ARCHIVE_DISABLED");
    assert.equal(fs.existsSync(t.root),false);
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("trusted packet writes immutable data and receipt",()=>{
  const t=temp();
  try{
    const w=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
    const r=w.record({packet:packet(),provenance:provenance()});
    assert.equal(r.reason,"RECORDED_VERIFIED");
    assert.equal(fs.existsSync(r.dataFile),true);
    const receipt=JSON.parse(fs.readFileSync(r.receiptFile,"utf8"));
    assert.equal(receipt.status,"RECORDED_VERIFIED");
    assert.equal(receipt.sourceAttestationStatus,"SYNTHETIC_SANDBOX_ONLY");
    assert.equal(receipt.packetSha256,r.sha256);
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("duplicate same packet is idempotent",()=>{
  const t=temp();
  try{
    const w=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
    const a=w.record({packet:packet(),provenance:provenance()});
    const b=w.record({packet:packet(),provenance:provenance()});
    assert.equal(a.ok,true);
    assert.equal(b.ok,true);
    assert.equal(b.duplicate,true);
    assert.equal(b.reason,"CANDLE_ARCHIVE_ALREADY_RECORDED");
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("same identity with changed bytes conflicts",()=>{
  const t=temp();
  try{
    const w=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
    assert.equal(w.record({packet:packet(),provenance:provenance()}).ok,true);
    const p=packet();p.engine22.publicationRevision=4;
    assert.equal(w.record({packet:p,provenance:provenance()}).reason,"CANDLE_ARCHIVE_IDENTITY_CONFLICT");
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("unverified source trust is rejected",()=>{
  const p=packet(),prov=provenance();
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:{verified:false,receiptId:prov.receiptId}});
  assert.equal(r.ok,false);
  assert.ok(r.reasons.includes("CANDLE_SOURCE_PROVENANCE_UNVERIFIED"));
});

test("future late and nonfinal evidence fail closed",()=>{
  const p=packet(),prov=provenance();
  prov.bars["10m"][0].endMs=evalMs+1;
  prov.bars["5m"][0].availableAtMs=evalMs+1;
  prov.bars["1m"][0].finality="CORRECTED";
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:trust({provenance:prov})});
  assert.ok(r.reasons.includes("CANDLE_BAR_FUTURE_EVIDENCE"));
  assert.ok(r.reasons.includes("CANDLE_BAR_UNAVAILABLE_ASOF"));
  assert.ok(r.reasons.includes("CANDLE_BAR_NOT_FINAL"));
});

test("gap and contract mismatch fail closed",()=>{
  const p=packet(),prov=provenance();
  prov.coverage["1m"].gapCount=1;prov.coverage["1m"].coverageState="PARTIAL";
  prov.bars["5m"][0].sourceContract="ESU6";
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:trust({provenance:prov})});
  assert.ok(r.reasons.includes("CANDLE_SOURCE_COVERAGE_INCOMPLETE_1m"));
  assert.ok(r.reasons.includes("CANDLE_SOURCE_CONTRACT_MISMATCH"));
});

test("missing mount and quota exhaustion never produce receipt",()=>{
  const t=temp();
  try{
    const missing=createEngine12CandleArchiveWriter({
      root:path.join(t.base,"missing","engine12-candles"),enabled:true,trustVerifier:trust
    });
    assert.equal(missing.record({packet:packet(),provenance:provenance()}).reason,"CANDLE_ARCHIVE_MOUNT_MISSING");
    const quota=createEngine12CandleArchiveWriter({
      root:t.root,enabled:true,trustVerifier:trust,maxArchiveBytes:1
    });
    assert.equal(quota.record({packet:packet(),provenance:provenance()}).reason,"CANDLE_ARCHIVE_STORAGE_EXHAUSTED");
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("crash after final data claim is reconciled after restart",()=>{
  const t=temp();
  try{
    const crash=createEngine12CandleArchiveWriter({
      root:t.root,enabled:true,trustVerifier:trust,
      faultInjector:stage=>{if(stage==="AFTER_DATA_FINAL_CLAIM")throw Object.assign(new Error("crash"),{code:"EIO"})}
    });
    const first=crash.record({packet:packet(),provenance:provenance()});
    assert.equal(first.ok,false);
    const receipts=path.join(t.root,"receipts");
    assert.equal(fs.existsSync(receipts),false);
    const restart=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
    const recovered=restart.reconcile();
    assert.equal(recovered.ok,true);
    assert.equal(recovered.recovered,1);
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("canonical Replay sibling is untouched",()=>{
  const t=temp();
  try{
    const canonical=path.join(t.replay,"es","2026-11-18");
    fs.mkdirSync(canonical,{recursive:true});
    const replayFile=path.join(canonical,"0700.json");
    fs.writeFileSync(replayFile,'{"immutable":true}\n');
    const before=fs.readFileSync(replayFile);
    const w=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
    assert.equal(w.record({packet:packet(),provenance:provenance()}).ok,true);
    assert.deepEqual(fs.readFileSync(replayFile),before);
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("permission and ENOSPC faults never produce successful receipt",()=>{
  const t=temp();
  try{
    for(const [code,reason] of [["EACCES","CANDLE_ARCHIVE_PERMISSION_DENIED"],["ENOSPC","CANDLE_ARCHIVE_STORAGE_EXHAUSTED"]]){
      const root=path.join(t.replay,"engine12-"+code.toLowerCase());
      const w=createEngine12CandleArchiveWriter({
        root,enabled:true,trustVerifier:trust,
        faultInjector:stage=>{if(stage==="BEFORE_DATA_WRITE")throw Object.assign(new Error(code),{code})}
      });
      const r=w.record({packet:packet(),provenance:provenance()});
      assert.equal(r.reason,reason);
      assert.equal(r.recorded,false);
    }
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("nonempty provenance with empty packet bars hard rejects",()=>{
  const p=packet(),prov=provenance();
  p.completedBars["1m"]=[];
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:trust({provenance:prov})});
  assert.ok(r.reasons.includes("CANDLE_PACKET_BAR_COUNT_MISMATCH_1m"));
});

test("packet OHLC mismatch against Engine11 source hard rejects",()=>{
  const p=packet(),prov=provenance();
  p.completedBars["5m"][0].high=7002;
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:trust({provenance:prov})});
  assert.ok(r.reasons.includes("CANDLE_PACKET_BAR_MISMATCH_5m"));
});

test("source bar identity revision and digest mismatch reject",()=>{
  const p=packet(),prov=provenance();
  p.sourceBarReferences["10m"][0].sourceRevisionId="wrong";
  p.sourceBarReferences["10m"][0].sourcePayloadDigest="c".repeat(64);
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:trust({provenance:prov})});
  assert.ok(r.reasons.includes("CANDLE_PACKET_SOURCE_REFERENCE_MISMATCH_10m"));
});

test("receipt and digest crosslink mismatch reject",()=>{
  const p=packet(),prov=provenance();
  p.engine11ProvenanceReceiptId="wrong-receipt";
  p.engine11ProvenanceDigest="d".repeat(64);
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:trust({provenance:prov})});
  assert.ok(r.reasons.includes("CANDLE_PACKET_PROVENANCE_CROSSLINK_MISMATCH"));
});

test("source counts gaps and truncation mismatch reject",()=>{
  const p=packet(),prov=provenance();
  p.sourceCountsBeforeFiltering["1m"]=2;
  p.gapState["5m"]="PARTIAL";
  p.sourceFiltering["10m"].truncatedCount=1;
  const r=validateCandleArchiveInput({packet:p,provenance:prov,trustResult:trust({provenance:prov})});
  assert.ok(r.reasons.includes("CANDLE_PACKET_SOURCE_COUNT_MISMATCH_1m"));
  assert.ok(r.reasons.includes("CANDLE_PACKET_GAP_STATE_MISMATCH_5m"));
  assert.ok(r.reasons.includes("CANDLE_PACKET_TRUNCATED_SOURCE_10m"));
});

test("valid agreed packet is accepted only with explicit sandbox trust mode",()=>{
  const p=packet(),prov=provenance();
  const synthetic=validateCandleArchiveInput({
    packet:p,provenance:prov,trustResult:trust({provenance:prov})
  });
  assert.equal(synthetic.ok,true);
  const unlabelled=validateCandleArchiveInput({
    packet:p,provenance:prov,trustResult:{
      verified:true,receiptId:prov.receiptId,digest:prov.signatureOrDigest.value
    }
  });
  assert.equal(unlabelled.ok,false);
  assert.ok(unlabelled.reasons.includes("CANDLE_SOURCE_PROVENANCE_UNVERIFIED"));
});

test("real source remains not attested unless trust verifier says REAL_SOURCE_ATTESTED",()=>{
  const p=packet(),prov=provenance();
  const t=temp();
  try{
    const w=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
    const r=w.record({packet:p,provenance:prov});
    const receipt=JSON.parse(fs.readFileSync(r.receiptFile,"utf8"));
    assert.equal(receipt.sourceAttestationStatus,"SYNTHETIC_SANDBOX_ONLY");
    assert.notEqual(receipt.sourceAttestationStatus,"ATTESTED_REAL_SOURCE");
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("orphan receipt fails closed instead of inventing missing data",()=>{
  const t=temp();
  try{
    const w=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
    const first=w.record({packet:packet(),provenance:provenance()});
    assert.equal(first.ok,true);
    fs.unlinkSync(first.dataFile);
    const second=w.record({packet:packet(),provenance:provenance()});
    assert.equal(second.reason,"CANDLE_ARCHIVE_ORPHAN_RECEIPT");
  }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});

test("proposed Engine12 0700 directories and 0600 files",()=>{
 const t=temp();
 try{
   const w=createEngine12CandleArchiveWriter({root:t.root,enabled:true,trustVerifier:trust});
   const r=w.record({packet:packet(),provenance:provenance()});
   assert.equal(r.ok,true);
   for(const dir of [t.root,path.dirname(path.dirname(r.dataFile)),
     path.dirname(r.dataFile),path.dirname(path.dirname(r.receiptFile)),
     path.dirname(r.receiptFile)]){
     assert.equal(fs.statSync(dir).mode & 0o077,0,dir);
   }
   assert.equal(fs.statSync(r.dataFile).mode & 0o077,0);
 }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});
test("proposed Engine12 stops at 70 percent whole-disk usage",()=>{
 const t=temp();
 try{
   const fake={...fs,statfsSync:()=>({blocks:100,bavail:30})};
   const w=createEngine12CandleArchiveWriter({
     root:t.root,enabled:true,trustVerifier:trust,fsOps:fake
   });
   const r=w.record({packet:packet(),provenance:provenance()});
   assert.equal(r.reason,"CANDLE_ARCHIVE_WHOLE_DISK_STOP_THRESHOLD");
   assert.equal(fs.existsSync(t.root),false);
 }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});
test("proposed Engine12 rejects missing disk-health evidence",()=>{
 const t=temp();
 try{
   const fake={...fs,statfsSync:undefined};
   const w=createEngine12CandleArchiveWriter({
     root:t.root,enabled:true,trustVerifier:trust,fsOps:fake
   });
   assert.equal(w.record({packet:packet(),provenance:provenance()}).reason,
     "CANDLE_ARCHIVE_DISK_HEALTH_UNVERIFIED");
 }finally{fs.rmSync(t.base,{recursive:true,force:true})}
});
test("proposed Engine12 accepts one forming bar outside completed coverage",()=>{
 const p=packet(),prov=provenance();
 for(const tf of ["1m","5m","10m"]){
   p.sourceCountsBeforeFiltering[tf]=2;
   p.sourceFiltering[tf].observedCount=2;
   p.sourceFiltering[tf].formingCount=1;
 }
 assert.equal(validateCandleArchiveInput({
   packet:p,provenance:prov,trustResult:trust({provenance:prov})
 }).ok,true);
 const bad=structuredClone(p);
 bad.sourceFiltering["5m"].formingCount=2;
 assert.ok(validateCandleArchiveInput({
   packet:bad,provenance:prov,trustResult:trust({provenance:prov})
 }).reasons.includes("CANDLE_PACKET_SOURCE_COUNT_MISMATCH_5m"));
});
