import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEngine18Candles, ENGINE18_SCHEMA } from "../logic/engine18/liquidityBaseline.js";

const bar = (time, open, high, low, close, volume = 100) => ({ time, open, high, low, close, volume });
const history = [
  bar(1,100,101,99,100),bar(2,100,102,99.5,101),
  bar(3,101,101.5,99.75,100),bar(4,100,102,99.5,101),
  bar(5,101,101.75,100,101),bar(6,101,101.5,100,101)
];
test("Engine 18 baseline is ES-only, no execution, and labels inferred levels", () => {
  const r=analyzeEngine18Candles({bars:history,lookback:3,contractSymbol:"ESZ26"});
  assert.equal(r.schema,ENGINE18_SCHEMA);
  assert.equal(r.noExecution,true);
  assert.equal(r.contractSymbol,"ESZ26");
  assert.ok(r.levels.every(x=>x.confirmedRestingLiquidity===false));
  assert.ok(r.levels.some(x=>x.kind==="EQUAL_HIGHS_CANDIDATE"));
});
test("A high wick beyond prior highs closing back below is a sweep candidate",()=>{
  const bars=[...history.slice(0,3),bar(4,101,102.5,100,101)];
  const r=analyzeEngine18Candles({bars,lookback:3});
  assert.equal(r.latestEvent.type,"BUY_SIDE_SWEEP_CANDIDATE");
});
test("A close beyond the prior highs is not misclassified as a rejection",()=>{
  const bars=[...history.slice(0,3),bar(4,101,103,100,102.5)];
  const r=analyzeEngine18Candles({bars,lookback:3});
  assert.equal(r.latestEvent.type,"BUY_SIDE_BREAKOUT_CANDIDATE");
});
test("A low wick below prior lows closing back above is a sweep candidate",()=>{
  const bars=[...history.slice(0,3),bar(4,100,101,98.5,100)];
  const r=analyzeEngine18Candles({bars,lookback:3});
  assert.equal(r.latestEvent.type,"SELL_SIDE_SWEEP_CANDIDATE");
});
test("Rejects out-of-order candles and malformed bars",()=>{
  assert.throws(()=>analyzeEngine18Candles({bars:[history[1],history[0]],lookback:3}),/INVALID_OR_UNSORTED/);
  assert.throws(()=>analyzeEngine18Candles({bars:[bar(1,100,99,101,100)] ,lookback:3}),/INVALID_OR_UNSORTED/);
  assert.throws(()=>analyzeEngine18Candles({bars:history,symbol:"SPY",lookback:3}),/ES_ONLY/);
});
test("No future candles change events computed at an earlier as-of",()=>{
 const short=analyzeEngine18Candles({bars:history.slice(0,5),lookback:3});
 const longer=analyzeEngine18Candles({bars:history,lookback:3});
 assert.deepEqual(longer.events.filter(x=>x.time<=short.asOfUnixSec),short.events);
});
