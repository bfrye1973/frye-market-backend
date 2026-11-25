import test from "node:test";
import assert from "node:assert/strict";
import { buildMicroFiveMinuteEvidence } from "../logic/engine22/wave/buildMicroFiveMinuteEvidence.js";
const base=1791504000; // synthetic ordered seconds; these tests do not depend on live market time
const candle=(i,o,h,l,c)=>({time:base+i*300,open:o,high:h,low:l,close:c});
const bars=[
  candle(0,7786,7792,7782.75,7790),
  candle(1,7790,7810,7789,7807),
  candle(2,7807,7830,7804,7826),
  candle(3,7826,7864,7820,7858),
  candle(4,7858,7862,7847.75,7851),
  candle(5,7851,7852,7810,7812),
];
test("Does not invent W1 anchor when 7782.75 absent",()=>{
  const noOrigin=bars.map(b=>({...b,low:b.low===7782.75?7785:b.low}));
  const r=buildMicroFiveMinuteEvidence({bars:noOrigin,evaluationTimeMs:(base+6*300)*1000});
  assert.equal(r.evidence,null);
  assert.ok(r.reasonCodes.includes("MICRO_START_LOW_NOT_IN_COMPLETED_FIVE_MIN_HISTORY"));
});
test("Completed 5m bars derive Micro candidate and close-based evidence",()=>{
  const r=buildMicroFiveMinuteEvidence({bars,evaluationTimeMs:(base+6*300)*1000});
  assert.equal(r.candidateAnchor,7864);
  assert.equal(r.evidence.timeframe,"5m");
  assert.equal(r.evidence.closed,true);
  assert.ok(r.evidence.bodyToRange>0.65);
});
test("Forming bar is not 5m confirmation evidence",()=>{
  const r=buildMicroFiveMinuteEvidence({bars,evaluationTimeMs:(base+5*300+1)*1000});
  assert.equal(r.lastObservedBarTime,bars[4].time);
});
test("Previously observed 5m candle cannot advance a lifecycle twice",()=>{
  const r=buildMicroFiveMinuteEvidence({bars,evaluationTimeMs:(base+6*300)*1000,
    prior:{candidateAnchor:7864,lastObservedBarTime:bars[5].time}});
  assert.equal(r.evidence,null);
});
test("W2 only uses candles after W1 confirmation time",()=>{
  const r=buildMicroFiveMinuteEvidence({bars,evaluationTimeMs:(base+6*300)*1000,
    side:"LOW",prior:{startAfterTimestamp:bars[4].time,confirmedW1High:7864}});
  assert.equal(r.evidence,null);
});
