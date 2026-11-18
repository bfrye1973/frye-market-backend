import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3RawBarArchivePacket as packet}
 from "../logic/engine3/v6/buildEngine3RawBarArchivePacket.js";
const now=Date.parse("2026-11-18T14:00:00.000Z");
const durations={"1m":60000,"5m":300000,"10m":600000};
const sample=(tf)=>({time:(now-durations[tf])/1000,
 open:7600,high:7601,low:7599,close:7600});
const input=()=>({evaluationTimeMs:now,bars1m:[sample("1m")],
 bars5m:[sample("5m")],bars10m:[sample("10m")],
 engine26:{candidateId:"C",zoneId:"Z"},
 activation:{activationSource:"ENGINE3_OBSERVED",activationStartedAtMs:now}});
function syntheticReceipt(){
 const bars={};
 for(const [tf,duration] of Object.entries(durations)){
  bars[tf]=[{sourceBarId:"B-"+tf,sourceRevisionId:"r1",
   sourcePayloadDigest:"a".repeat(64),sourceContract:"ESZ6",
   providerEventId:"E-"+tf,firstReceivedAtMs:now-150,
   availableAtMs:now-100,completionObservedAtMs:now-50,
   finality:"CONFIRMED",clockStatus:"VERIFIED",sourceHealth:"HEALTHY",
   timeframe:tf,startMs:now-duration,endMs:now,
   open:7600,high:7601,low:7599,close:7600}];
 }
 return {schema:"engine11.es.completedCandleProvenance.v1",
  symbol:"ES",evaluationTimeMs:now,receiptId:"synthetic-receipt",
  providerId:"MASSIVE_POLYGON",feedId:"SYNTHETIC_UNVERIFIED",
  entitlementMode:"UNKNOWN",sourceMode:"RESEARCH_REPLAY",
  physicalContract:"ESZ6",signatureOrDigest:{
   algorithm:"SHA256",value:"b".repeat(64),
   signatureStatus:"UNVERIFIED"},
  timeframeSourceMap:{"1m":"SYNTH","5m":"SYNTH","10m":"SYNTH"},
  coverage:Object.fromEntries(Object.keys(durations).map(tf=>[
   tf,{observedCount:1,acceptedCount:1,rejectedCount:0,
       gapCount:0,gaps:[],coverageState:"UNKNOWN"}])),
  bars};
}
test("source-unverified v2 preparation never grants authority",()=>{
 const p=packet(input());
 assert.equal(p.ok,true);assert.equal(p.packet.schema,"engine3.v6.rawBarPacket.preparation.v2");
 assert.equal(p.recordingActivated,false);assert.equal(p.calibrationAdmissible,false);
 assert.equal(p.sourceEvidenceVerified,false);
 assert.deepEqual(p.packet.sourceCountsBeforeFiltering,{"1m":1,"5m":1,"10m":1});
 assert.deepEqual(p.packet.sourceCountsAfterFiltering,{"1m":1,"5m":1,"10m":1});
 assert.deepEqual(p.packet.gapState,{"1m":"UNKNOWN","5m":"UNKNOWN","10m":"UNKNOWN"});
 assert.equal(p.packet.engine11ProvenanceReceiptId,null);
 assert.equal(p.reasonCode,"ARCHIVE_PACKET_PREPARED_NO_ENGINE11_RECEIPT");
});
test("synthetic Engine11 envelope carries exact raw IDs/revisions/timing but cannot certify provenance",()=>{
 const data={...input(),engine11Provenance:syntheticReceipt()};
 const p=packet(data);
 assert.equal(p.ok,true);assert.equal(p.recordingActivated,false);
 assert.equal(p.calibrationAdmissible,false);assert.equal(p.sourceEvidenceVerified,false);
 assert.equal(p.packet.engine11ProvenanceSchema,"engine11.es.completedCandleProvenance.v1");
 assert.equal(p.packet.engine11ProvenanceReceiptId,"synthetic-receipt");
 assert.equal(p.packet.engine11ProvenanceDigest,"b".repeat(64));
 for(const tf of Object.keys(durations)){
  assert.equal(p.packet.sourceBarReferences[tf][0].sourceBarId,"B-"+tf);
  assert.equal(p.packet.sourceBarReferences[tf][0].availableAtMs,now-100);
 }
 assert.deepEqual(packet(data),p,"deterministic preparation");
});
test("future availability and missing finality fail closed before packet creation",()=>{
 const d=syntheticReceipt();d.bars["1m"][0].availableAtMs=now+100;
 assert.equal(packet({...input(),engine11Provenance:d}).reasonCode,
  "CANDLE_BAR_UNAVAILABLE_ASOF_OR_NOT_FINAL_1m");
 d.bars["1m"][0].availableAtMs=now-100;
 d.bars["1m"][0].finality="PROVISIONAL";
 assert.equal(packet({...input(),engine11Provenance:d}).ok,false);
});
test("no source identity fabrication: receipt OHLC, revision or count mismatch rejects",()=>{
 const d=syntheticReceipt();d.bars["5m"][0].close=7600.25;
 assert.equal(packet({...input(),engine11Provenance:d}).reasonCode,
  "CANDLE_SOURCE_BAR_REFERENCE_MISMATCH_5m");
 d.bars["5m"][0].close=7600;d.coverage["5m"].observedCount=2;
 assert.equal(packet({...input(),engine11Provenance:d}).reasonCode,
  "CANDLE_SOURCE_COVERAGE_COUNT_MISMATCH_5m");
});
test("bounded size and invalid max settings cannot silently succeed",()=>{
 assert.equal(packet({...input(),maxBytes:10}).reasonCode,"ARCHIVE_PACKET_SIZE_LIMIT");
 assert.equal(packet({...input(),maxBarsPerTf:0}).ok,false);
 assert.equal(packet({...input(),maxBytes:-1}).ok,false);
});
test("no raw packet can be prepared from invalid OHLC or nonexistent/empty arrays as complete",()=>{
 const x=input();x.bars1m=[{...sample("1m"),high:7590}];
 const failed=packet(x);
 assert.equal(failed.recordingActivated,false);
 assert.equal(failed.calibrationAdmissible,false);
 assert.equal(packet({...input(),bars10m:[]}).packet.gapState["10m"],"UNKNOWN");
});
