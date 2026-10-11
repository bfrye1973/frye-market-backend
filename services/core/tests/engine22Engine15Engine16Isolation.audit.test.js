import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine22WaveStrategy } from "../logic/engine22/wave/buildEngine22WaveStrategy.js";
import { buildFuturesWaveContext } from "../logic/engine22/wave/adapters/buildFuturesWaveContext.js";
const e16={ok:true,readiness:"READY",latestClose:7850,regimeLayers:{trigger10m:{close:7850,ema10:7840,ema20:7830},pullback1h:{close:7845,ema10:7840},trend4h:{close:7840,ema10:7800},regimeEod:{close:7800,ema10:7700}}};
const e15={readiness:"READY",readinessLabel:"READY",status:"READY"};
const input={symbol:"ES",marketType:"FUTURES",strategyId:"intraday_scalp@10m",tf:"10m",currentPrice:7850,
  engine2State:null,engine15:e15,engine16:e16,
  barsByTf:{"5m":[],"10m":[],"1h":[],"4h":[]},
  snapshotNow:"2026-10-10T16:00:00Z",evaluationTimeMs:1791648000000,
  marketRegime:{directionBias:"BULLISH",regime:"CONSTRUCTIVE",strictness:"NORMAL"},
  engine25Context:{ok:true,freshnessStatus:"FRESH",score:80,regime:"CONSTRUCTIVE"}};
const versions=[
 ["both-present",input],
 ["15-null",{...input,engine15:null}],
 ["16-null",{...input,engine16:null}],
 ["both-null",{...input,engine15:null,engine16:null}],
];
const fields=(o)=>({
 degreeStates:o?.degreeStates,currentWavelength:o?.currentWavelength,
 waveFibState:o?.waveFibState?.activeStructures,
 microExecutionContext:o?.microExecutionContext,
 waveOpportunity:o?.waveOpportunity,tradeDecision:o?.tradeDecision,
 timelineRead:o?.timelineRead,
});
const clean=(value)=>{
 const keys=new Set(["builtAt","generatedAt","timestamp","sourceTimestamp","updatedAt","snapshotNow","evaluationTimeMs","capturedAt","processedAt","createdAt"]);
 const recur=(v)=>Array.isArray(v)?v.map(recur):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).filter(([k])=>!keys.has(k)).map(([k,x])=>[k,recur(x)])):v;
 return recur(value);
};
test("ES adapter uses explicit current price with either legacy engine null",()=>{
 const base=buildFuturesWaveContext(input);
 for(const [,i] of versions){assert.equal(buildFuturesWaveContext(i).currentPrice,base.currentPrice);}
});
test("Engine22 input isolation differences classified per output family",()=>{
 const results=versions.map(([name,i])=>({name,out:fields(buildEngine22WaveStrategy(i))}));
 const families=["degreeStates","currentWavelength","waveFibState","microExecutionContext","waveOpportunity","tradeDecision","timelineRead"];
 const diffs=Object.fromEntries(families.map(key=>[key,results.slice(1).map(r=>({variant:r.name,equal:JSON.stringify(clean(r.out[key]))===JSON.stringify(clean(results[0].out[key]))}))]));
 console.log("ENGINE22_ISOLATION_DIFFERENCE_MATRIX="+JSON.stringify(diffs));
 assert.equal(results.length,4);
 // This is a diagnostic test, not a claim of equivalence.
});
