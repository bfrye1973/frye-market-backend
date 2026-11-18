import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {captureReceiptV3,bindSelectedBarsToReceipt} from
 "../logic/engine11/sourceReceiptV3/captureReceiptV3.js";
import {buildEngine11ShadowObservation} from
 "../logic/engine11/sourceReceiptV3/buildShadowObservation.js";
import {buildEngine3RawBarArchivePacket,buildEngine3CandleArchiveWriterHandoff} from
 "../logic/engine3/v6/buildEngine3RawBarArchivePacket.js";
import {createEngine12CandleArchiveWriter,validateCandleArchiveInput} from
 "../logic/engine12/candleArchive/createCandleArchiveWriter.js";

const evalMs=Date.parse("2026-11-18T15:00:00.000Z");
const frames={"1m":60000,"5m":300000,"10m":600000};
const sample=(startMs)=>({time:startMs/1000,open:7000,high:7001,low:6999,close:7000.25,volume:100});
const sourceBar=(tf,dur,startMs)=>({
 sourceBarId:"SYNTH-"+tf,sourceRevisionId:"REV-TEST",
 sourcePayloadDigest:"a".repeat(64),sourceContract:"ESZ6",
 providerEventId:"SYNTH-EVENT-"+tf,firstReceivedAtMs:evalMs-10000,
 availableAtMs:evalMs-9000,completionObservedAtMs:evalMs-8000,
 finality:"CONFIRMED",clockStatus:"VERIFIED",sourceHealth:"HEALTHY",
 timeframe:tf,startMs,endMs:startMs+dur,
 open:7000,high:7001,low:6999,close:7000.25,volume:100,
});
function syntheticTrustedProvenance(){
 const bars={},coverage={},map={};
 for(const [tf,dur] of Object.entries(frames)){
   const startMs=evalMs-dur-5000;
   bars[tf]=[sourceBar(tf,dur,startMs)];
   coverage[tf]={
     observedCount:1,rejectedCount:0,acceptedCount:1,expectedIntervalCount:1,
     gapCount:0,gaps:[],duplicateCount:0,outOfOrderCount:0,lateCount:0,
     correctionCount:0,sessionCalendarVersion:"CME-SYNTHETIC",coverageState:"COMPLETE",
   };
   map[tf]="MASSIVE_"+tf;
 }
 return {
   schema:"engine11.es.completedCandleProvenance.v1",
   receiptId:"SYNTHETIC-VERIFIED-IN-SANDBOX",symbol:"ES",
   providerId:"MASSIVE_POLYGON",feedId:"SYNTHETIC_ONLY",
   entitlementMode:"LIVE_ENTITLED",sourceMode:"ORIGINAL_CAPTURE",
   physicalContract:"ESZ6",physicalContractCanonical:"ESZ2026",
   evaluationTimeMs:evalMs,
   clock:{eventClock:"PROVIDER_UTC",receiveClock:"UTC_WALL",
     clockStatus:"VERIFIED",maxUncertaintyMs:1},
   priceBasis:{kind:"UNADJUSTED_PHYSICAL",tickSize:0.25,adjustmentApplied:false},
   rollPolicy:{policyId:"SYNTHETIC-ROLL",resolverRule:"EXPLICIT",
     resolverCheckedAtMs:evalMs-10000},
   timeframeSourceMap:map,
   sourceHealth:{state:"HEALTHY",reasonCodes:[]},
   signatureOrDigest:{algorithm:"SHA256",value:"b".repeat(64),
     attestor:"ENGINE11",signatureStatus:"INDEPENDENTLY_VERIFIED"},
   bars,coverage,
 };
}
function syntheticEngine3Inputs(prov){
 return {
   evaluationTimeMs:evalMs,
   bars1m:[sample(prov.bars["1m"][0].startMs)],
   bars5m:[sample(prov.bars["5m"][0].startMs)],
   bars10m:[sample(prov.bars["10m"][0].startMs)],
   engine26:{candidateId:"SYNTH-CAND",zoneId:"SYNTH-ZONE"},
   activation:{activationSource:"ENGINE3_OBSERVED",activationStartedAtMs:evalMs},
   engine11Provenance:prov,
 };
}
function observedFrame(tf,dur) {
 const startMs=evalMs-900000;
 const b=sample(startMs);
 const body=Buffer.from(JSON.stringify({results:[{
   window_start:String(BigInt(startMs)*1000000n),
   open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,
 }]}));
 const receipt=captureReceiptV3({
   request:"https://api.polygon.io/futures/v1/aggs/ESZ6?resolution="+
     (tf==="1m"?"1min":tf==="5m"?"5min":"10min")+
     "&window_start.gte=2026-11-18&window_start.lte=2026-11-19&apiKey=SYNTHETIC",
   body,frame:tf,physicalContract:"ESZ6",
   requestStartedAtMs:evalMs+100,firstByteAtMs:evalMs+200,
   bodyCompletedAtMs:evalMs+300,
   requestToFirstByteMonoMs:100,requestToBodyMonoMs:200,
 });
 return {bars:[b],engine11Receipt:receipt,
  selectedBarReferences:bindSelectedBarsToReceipt(receipt,[b]),
  consumerReceivedAtMs:evalMs+400};
}
test("Engine11 V3 observed responses cannot be promoted to E3/E12 real attestation",()=>{
 const framesInput={};
 for(const [tf,dur] of Object.entries(frames))framesInput[tf]=observedFrame(tf,dur);
 const shadow=buildEngine11ShadowObservation({
   frames:framesInput,evaluationTimeMs:evalMs,decisionComputedAtMs:evalMs+500
 });
 assert.equal(shadow.ok,true);
 assert.equal(shadow.sourceEvidenceVerified,false);
 assert.equal(shadow.calibrationAdmissible,false);
 assert.equal(shadow.engine3ConsumptionAttested,false);
 const fakeOriginal=framesInput["1m"].engine11Receipt;
 const p=buildEngine3RawBarArchivePacket({
   evaluationTimeMs:evalMs,
   bars1m:framesInput["1m"].bars,bars5m:framesInput["5m"].bars,
   bars10m:framesInput["10m"].bars,
   engine11Provenance:fakeOriginal,
 });
 assert.equal(p.ok,false);
 const e12=validateCandleArchiveInput({
   packet:p.packet,provenance:fakeOriginal,
   trustResult:{verified:true,verificationMode:"REAL_SOURCE_ATTESTED"},
 });
 assert.equal(e12.ok,false);
});
test("E3 completed-bar packet → E12 independent sandbox writer only; canonical Replay untouched",()=>{
 const prov=syntheticTrustedProvenance();
 const prepared=buildEngine3RawBarArchivePacket(syntheticEngine3Inputs(prov));
 assert.equal(prepared.ok,true,prepared.reasonCode);
 const handoff=buildEngine3CandleArchiveWriterHandoff({
   prepared,engine11Provenance:prov
 });
 assert.equal(handoff.ok,true,handoff.reasonCode);
 assert.equal(handoff.sourceEvidenceVerified,false);
 assert.equal(handoff.calibrationAdmissible,false);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine11b-e2e-"));
 const mount=path.join(root,"replay");
 const privateRoot=path.join(mount,"engine12-candles");
 try{
   const sibling=path.join(mount,"es","2026-11-18");
   fs.mkdirSync(sibling,{recursive:true});
   const canonical=path.join(sibling,"1100.json");
   fs.writeFileSync(canonical,"CANONICAL_IMMUTABLE");
   const writer=createEngine12CandleArchiveWriter({
     root:privateRoot,enabled:true,
     trustVerifier:({provenance:p})=>({
       verified:true,receiptId:p.receiptId,digest:p.signatureOrDigest.value,
       verificationMode:"SYNTHETIC_SANDBOX",
     }),
   });
   const recorded=writer.record(handoff.writerInput);
   assert.equal(recorded.ok,true,recorded.reason);
   const receipt=JSON.parse(fs.readFileSync(recorded.receiptFile,"utf8"));
   assert.equal(receipt.sourceAttestationStatus,"SYNTHETIC_SANDBOX_ONLY");
   assert.equal(fs.readFileSync(canonical,"utf8"),"CANONICAL_IMMUTABLE");
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
