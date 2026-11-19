import test from "node:test";
import assert from "node:assert/strict";
import {inspectEngine11CandleProvenanceV1,ENGINE11_CANDLE_PROVENANCE_SCHEMA}
 from "../logic/engine11/candleProvenanceV1/inspectProvenance.js";

const evalAt=Date.parse("2026-11-18T15:00:00.000Z");
const durations={"1m":60000,"5m":300000,"10m":600000};
const fakeSha="a".repeat(64);
function example(){
 const bars={};const coverage={};const timeframeSourceMap={};
 for(const [tf,ms] of Object.entries(durations)){
  const start=evalAt-ms-2000;
  bars[tf]=[{
   sourceBarId:"synthetic-"+tf,sourceRevisionId:"revision-1",
   sourcePayloadDigest:fakeSha,providerEventId:"SYNTHETIC-FIXTURE",
   timeframe:tf,startMs:start,endMs:start+ms,open:7000,high:7001,
   low:6999,close:7000.25,volume:100,sourceContract:"ESZ6",
   firstReceivedAtMs:start+ms+100,
   completionObservedAtMs:start+ms+110,
   availableAtMs:start+ms+130,finality:"CONFIRMED",
   clockStatus:"VERIFIED",sourceHealth:"HEALTHY"
  }];
  coverage[tf]={
   observedCount:1,rejectedCount:0,acceptedCount:1,expectedIntervalCount:1,
   gapCount:0,gaps:[],duplicateCount:0,outOfOrderCount:0,lateCount:0,
   correctionCount:0,sessionCalendarVersion:"SYNTHETIC-CALENDAR",
   coverageState:"COMPLETE"
  };
  timeframeSourceMap[tf]="SYNTHETIC-SOURCE-"+tf;
 }
 return {
  schema:ENGINE11_CANDLE_PROVENANCE_SCHEMA,receiptId:"SYNTHETIC-RECEIPT",
  providerId:"MASSIVE_POLYGON",feedId:"SYNTHETIC-NOT-REAL",
  entitlementMode:"LIVE_ENTITLED",sourceMode:"ORIGINAL_CAPTURE",
  symbol:"ES",physicalContract:"ESZ6",physicalContractCanonical:"ESZ2026",
  priceBasis:{kind:"UNADJUSTED_PHYSICAL",currency:"USD",tickSize:0.25,
   adjustmentApplied:false},
  rollPolicy:{policyId:"SYNTHETIC-ROLL-V1",resolverRule:"SYNTHETIC",
   resolverCheckedAtMs:evalAt-10000,rollEventId:null},
  timeframeSourceMap,barStartSemantics:"UTC_OPEN_INCLUSIVE",
  barCloseSemantics:"UTC_END_EXCLUSIVE",evaluationTimeMs:evalAt,
  clock:{eventClock:"PROVIDER_UTC",receiveClock:"UTC_WALL",
   clockStatus:"VERIFIED",maxUncertaintyMs:1},
  parserVersion:"SYNTHETIC-PARSER",configVersion:"SYNTHETIC-CONFIG",
  sourceFingerprint:"SYNTHETIC-SOURCE-FINGERPRINT",
  sourceHealth:{state:"HEALTHY",reasonCodes:[]},
  coverage,bars,signatureOrDigest:{algorithm:"SHA256",value:fakeSha,
   attestor:"ENGINE11",signatureStatus:"INDEPENDENTLY_VERIFIED"}
 };
}
const inspect=p=>inspectEngine11CandleProvenanceV1({provenance:p,evaluationTimeMs:evalAt});
const fails=(p,code)=>assert.ok(inspect(p).issues.includes(code),code);

test("synthetic well-formed example NEVER becomes trusted without independent attestation",()=>{
 const r=inspect(example());
 assert.equal(r.validStructure,true);
 assert.equal(r.barsInspected,3);
 assert.equal(r.calibrationAdmissible,false);
 assert.equal(r.independentSourceAttestationVerified,false);
 assert.equal(r.recordingActivated,false);
 assert.equal(r.writerInvoked,false);
});
test("future 1m bar rejects as-of, even if normalized OHLC looks good",()=>{
 const p=example();p.bars["1m"][0].endMs=evalAt+100;
 fails(p,"CANDLE_BAR_FUTURE_EVIDENCE_1m");
});
test("5m late bar delivered after original evaluation is rejected",()=>{
 const p=example();p.bars["5m"][0].firstReceivedAtMs=evalAt+2000;
 p.bars["5m"][0].availableAtMs=evalAt+2100;
 fails(p,"CANDLE_BAR_UNAVAILABLE_ASOF_5m");
});
test("10m correction cannot stand in for final original bar",()=>{
 const p=example();p.bars["10m"][0].finality="CORRECTED";
 fails(p,"CANDLE_BAR_NOT_FINAL_10m");
});
test("physical contract mismatch across a synthetic roll is rejected",()=>{
 const p=example();p.bars["5m"][0].sourceContract="ESU6";
 fails(p,"CANDLE_SOURCE_BAR_INVALID_5m");
});
test("missing session coverage and gaps must be declared, never complete",()=>{
 const p=example();p.coverage["1m"].gapCount=1;
 p.coverage["1m"].gaps=[{startMs:evalAt-180000,endMs:evalAt-120000,reason:"SOURCE_OUTAGE"}];
 fails(p,"CANDLE_SOURCE_COVERAGE_INCOMPLETE_1m");
});
test("missing feed entitlement, trusted clock and source digest all fail closed",()=>{
 const p=example();p.entitlementMode="UNKNOWN";
 p.clock.clockStatus="UNVERIFIED";
 p.signatureOrDigest.signatureStatus="UNVERIFIED";
 fails(p,"CANDLE_SOURCE_ENTITLEMENT_UNVERIFIED");
 fails(p,"CANDLE_SOURCE_CLOCK_UNVERIFIED");
 fails(p,"CANDLE_SOURCE_PROVENANCE_UNVERIFIED");
});
test("missing 1m feed, UTC clock identity and 10m timeframe source fail closed",()=>{
 const p=example();delete p.bars["1m"];delete p.timeframeSourceMap["10m"];
 p.clock.eventClock="LOCAL_TIME";
 fails(p,"CANDLE_SOURCE_COVERAGE_INCOMPLETE_1m");
 fails(p,"CANDLE_SOURCE_TIMEFRAME_MAP_MISSING_10m");
 fails(p,"CANDLE_SOURCE_CLOCK_UNVERIFIED");
});
test("DST fixture: Chicago offset changes, Phoenix stays UTC-7",()=>{
 const fmt=(d,tz)=>new Intl.DateTimeFormat("en-US",{
  timeZone:tz,timeZoneName:"shortOffset",hour:"2-digit",minute:"2-digit",
  hourCycle:"h23"
 }).format(new Date(d));
 const jan="2026-01-15T15:00:00.000Z",jul="2026-07-15T15:00:00.000Z";
 assert.match(fmt(jan,"America/Phoenix"),/GMT-7/);
 assert.match(fmt(jul,"America/Phoenix"),/GMT-7/);
 assert.match(fmt(jan,"America/Chicago"),/GMT-6/);
 assert.match(fmt(jul,"America/Chicago"),/GMT-5/);
});
test("synthetic outage / sample or replay cannot be attested live",()=>{
 for(const [mode,source] of [["SAMPLE","ORIGINAL_CAPTURE"],["LIVE_ENTITLED","HISTORICAL_REFETCH"]]){
  const p=example();p.entitlementMode=mode;p.sourceMode=source;
  fails(p,"CANDLE_SOURCE_ENTITLEMENT_UNVERIFIED");
 }
 const p=example();p.sourceHealth.state="OUTAGE";
 fails(p,"CANDLE_SOURCE_HEALTH_UNVERIFIED");
});
test("duplicate/revised bar identity cannot be swallowed by filtering",()=>{
 const p=example();const a=p.bars["1m"][0];
 p.bars["1m"].push({...a,sourcePayloadDigest:"b".repeat(64)});
 p.coverage["1m"].acceptedCount=2;p.coverage["1m"].observedCount=2;
 fails(p,"CANDLE_SOURCE_DUPLICATE_CONFLICT_1m");
});
