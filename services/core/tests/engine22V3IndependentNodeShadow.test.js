import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine22V3IndependentNodeShadow as build,DEGREE_CANDLE_TIMEFRAMES as map} from "../logic/engine22/v3/buildIndependentNodeShadow.js";
const ds=Object.keys(map);
const anchors={W1_LOW:{price:100,time:"2026-10-01T00:00:00Z"},W1_HIGH:{price:115,time:"2026-10-02T00:00:00Z"},W2_LOW:{price:107,time:"2026-10-03T00:00:00Z"}};
const canonical={degrees:Object.fromEntries(ds.map(degree=>[degree,{degreeId:degree,countId:degree+"-count",activeWave:"W3",lifecycle:"DEVELOPING",anchors}]))};
const highs=[110,112,116,111,108,114,119,113,110];
const bars=(tf,interval)=>highs.map((high,i)=>({time:(Date.UTC(2026,9,9,0,0,0)+interval*i)/1000,high,low:high-2,open:high-1,close:high-1}));
test("seven isolated degree keys; no fabricated weekly/monthly evidence",()=>{
 const result=build({canonical,barsByTf:{"5m":bars("5m",300000),"10m":bars("10m",600000),
   "1h":bars("1h",3600000),"4h":bars("4h",14400000),"1d":bars("1d",86400000)},
   evaluationTimeMs:Date.UTC(2026,10,20)});
 assert.equal(Object.keys(result.degrees).length,7);
 assert.ok(result.degrees.intraday_submicro.detectedNodes.HIGH.length>0);
 assert.ok(result.degrees.micro.detectedNodes.HIGH.length>0);
 assert.ok(result.degrees.subminute.detectedNodes.HIGH.length>0);
 assert.ok(result.degrees.minute.detectedNodes.HIGH.length>0);
 assert.ok(result.degrees.minor.detectedNodes.HIGH.length>0);
 for(const degree of ["intermediate","primary"]){
  const d=result.degrees[degree];
  assert.equal(d.nodeEvidenceAvailable,false);
  assert.ok(d.reasonCodes.includes("SOURCE_HISTORY_UNAVAILABLE"));
  assert.equal(d.waveCandidate,null);
 }
 for(const d of Object.values(result.degrees)){
  assert.equal(d.anchorPromotionAllowed,false);
  assert.equal(d.officialFibAuthorityChanged,false);
  assert.equal(d.noExecution,true);
 }
 assert.equal(canonical.degrees.MICRO.anchors.W1_LOW.price,100);
});
test("unclosed bars never produce confirmed nodes",()=>{
 const result=build({canonical,barsByTf:{"5m":bars("5m",300000)},
    evaluationTimeMs:Date.UTC(2026,9,9,0,12)});
 assert.equal(result.degrees.intraday_submicro.nodeEvidenceAvailable,false);
 assert.equal(result.degrees.intraday_submicro.waveCandidate,null);
});
test("duplicate source timestamps fail closed",()=>{
 const x=bars("5m",300000); x[5].time=x[4].time;
 const result=build({canonical,barsByTf:{"5m":x},evaluationTimeMs:Date.UTC(2026,10,20)});
 assert.ok(result.degrees.intraday_submicro.reasonCodes.includes("DUPLICATE_SOURCE_CANDLE_IDENTITY"));
});
