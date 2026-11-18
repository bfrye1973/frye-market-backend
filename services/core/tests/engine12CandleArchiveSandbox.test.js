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
  return {
    schema:"engine3.v6.rawBarPacket.preparation.v1",
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
    completedBars:{"1m":[],"5m":[],"10m":[]}
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

const trust=({provenance:p})=>({verified:true,receiptId:p.receiptId});

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
