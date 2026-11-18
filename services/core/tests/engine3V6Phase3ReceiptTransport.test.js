import test from "node:test";
import assert from "node:assert/strict";
import {fetchEngine3DiagnosticBars} from "../logic/engine3/fetchEngine3DiagnosticBars.js";

test("v6 opt-in Engine11 receipt is transported alongside unchanged consumed bars",async()=>{
 const urls=[];
 const receipt={schema:"engine11.es.originalSourceReceipt.v3",
   physicalContract:"ESZ6",frame:"1m",bodyCompletedAtMs:1700000000000,
   sourceTrustVerified:false};
 const refs=[{sourceBarId:"ESZ6|1m|1700000000000000000",
   sourcePayloadDigest:"a".repeat(64)}];
 const result=await fetchEngine3DiagnosticBars({
   timeframe:"1m",coreBase:"http://core",includeSourceEvidence:true,
   fetchJson:async url=>{urls.push(url);return {ok:true,json:{
     bars:[{time:1700000000,close:6000}],
     engine11Receipt:receipt,selectedBarReferences:refs,
   }};},
 });
 assert.equal(urls.length,1);
 assert.equal(new URL(urls[0]).searchParams.get("evidence"),"1");
 assert.equal(result.bars[0].close,6000);
 assert.deepEqual(result.engine11SourceEvidence.receipt,receipt);
 assert.deepEqual(result.engine11SourceEvidence.selectedBarReferences,refs);
 assert.equal(result.engine11SourceEvidence.engine3ConsumptionAttested,false);
 assert.equal(result.engine11SourceEvidence.calibrationAdmissible,false);
 assert.equal(result.engine11SourceEvidence.recordingActivated,false);
 assert.ok(result.engine11SourceEvidence.consumerReceivedAtMs>0);
});
test("v6 default diagnostics preserve legacy request and bar shape",async()=>{
 const urls=[];
 const result=await fetchEngine3DiagnosticBars({
   timeframe:"5m",coreBase:"http://core",
   fetchJson:async url=>{urls.push(url);return {ok:true,json:[{time:1700000000,close:6000}]};},
 });
 assert.equal(urls.length,1);
 assert.equal(new URL(urls[0]).searchParams.has("evidence"),false);
 assert.equal(result.bars.length,1);
 assert.equal(Object.hasOwn(result,"engine11SourceEvidence"),false);
});
