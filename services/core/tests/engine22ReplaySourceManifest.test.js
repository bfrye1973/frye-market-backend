import test from "node:test";
import assert from "node:assert/strict";
import {validateEngine22EsReplayManifest as validate,ENGINE22_REPLAY_MANIFEST_SCHEMA} from "../logic/engine22/integration/validateReplaySourceManifest.js";
import {replayEngine22CompletionShadow as replay} from "../logic/engine22/integration/replayCompletionShadow.js";
const bars=Array.from({length:7},(_,i)=>({
 sourceBarId:"SOURCE:"+i,sourceTimestamp:new Date(Date.UTC(2026,9,26,14,i*5)).toISOString(),
 sourceVendor:"FIXTURE_VENDOR",sourceSeriesId:"ES-CONTRACT",sourceContract:"ESZ26",
 timeframe:"5m",closed:true,open:7700+i,high:7701+i,low:7699+i,close:7700+i,
}));
const manifest={schema:ENGINE22_REPLAY_MANIFEST_SCHEMA,symbol:"ES",timeframe:"5m",
 sourceVendor:"FIXTURE_VENDOR",sourceSeriesId:"ES-CONTRACT",sourceContract:"ESZ26",
 datasetId:"FIXTURE-NOT-REAL",datasetVersion:"1",receiptId:"FIXTURE-1",
 sessionCalendar:"ES_GLOBEX",priceBasis:"UNADJUSTED_SINGLE_CONTRACT",
 capturedAtUTC:"2026-10-26T16:00:00Z"};
test("complete source lineage is consistent but never externally authenticated",()=>{
 const x=validate({manifest,bars});
 assert.equal(x.accepted,true);assert.equal(x.sourceDataVerified,false);
 assert.equal(x.independentlyAuthenticated,false);assert.equal(x.sourceContract,"ESZ26");
});
test("wrong source contract and mixed provider fail closed",()=>{
 assert.equal(validate({manifest,bars:bars.map((x,i)=>i===3?{...x,sourceContract:"ESH27"}:x)}).accepted,false);
 assert.equal(validate({manifest,bars:bars.map((x,i)=>i===3?{...x,sourceVendor:"BAD"}:x)}).accepted,false);
});
test("noncontiguous or unclosed history rejected",()=>{
 assert.equal(validate({manifest,bars:bars.filter((_,i)=>i!==2)}).accepted,false);
 assert.equal(validate({manifest,bars:bars.map((x,i)=>i===3?{...x,closed:false}:x)}).accepted,false);
});
test("ES quarter-point tick discipline and capture chronology",()=>{
 assert.equal(validate({manifest,bars:bars.map((x,i)=>i===3?{...x,high:x.high+0.1}:x)}).accepted,false);
 assert.equal(validate({manifest:{...manifest,capturedAtUTC:"2026-10-26T13:00:00Z"},bars}).accepted,false);
});
test("replay rejects incorrectly declared lineage before evaluation",()=>{
 const owner={degreeId:"MICRO",parentDegree:"SUBMINUTE",countId:"FIXTURE-COUNT",
 sequenceDirection:"DOWN",modelVersion:"engine22.microCDownOwnerWatch.v1",
 lifecycle:"DEVELOPING",patternType:"ABC",anchors:{}};
 const result=replay({ownerCount:owner,degree:"MICRO",timeframe:"5m",bars,
 sourceManifest:{...manifest,sourceContract:"ESH27"}});
 assert.equal(result.available,false);
 assert.ok(result.reasonCodes.includes("INVALID_SOURCE_BAR_OR_LINEAGE"));
});
