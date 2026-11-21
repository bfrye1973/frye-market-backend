import test from "node:test";
import assert from "node:assert/strict";
import { fibonacciLevels, detectFvg, confirmedPivots, abcCandidates, computeEngine16Research } from "../logic/engine16StructuralTracker/research.js";
const bar = (hour, open, high, low, close) => ({time: new Date(Date.UTC(2026, 10, 2, hour)).toISOString(), open, high, low, close, closed: true});
test("Fibonacci preserves anchors and rounds to ES tick", () => {
  const fib = fibonacciLevels({start: 100, end: 110, direction: "UP", tickSize: 0.25});
  assert.deepEqual(fib.anchors, {start: 100, end: 110});
  assert.equal(fib.retracements.find(x => x.ratio === 0.5).price, 105);
  assert.equal(fib.extensions.find(x => x.ratio === 1.618).price, 116.25);
});
test("FVG detects closed three-candle bullish and bearish gaps", () => {
  const bullish = [bar(0, 100, 102, 99, 101), bar(1, 103, 105, 102, 104), bar(2, 107, 109, 106, 108)];
  const zones = detectFvg(bullish);
  assert.equal(zones.length, 1);
  assert.deepEqual([zones[0].lower, zones[0].upper], [102, 106]);
  const bearish = [bar(0, 108, 110, 106, 107), bar(1, 105, 107, 103, 104), bar(2, 101, 102, 99, 100)];
  assert.equal(detectFvg(bearish)[0].direction, "BEARISH");
});
test("unfinished candles and unordered timestamps are rejected", () => {
  const a = bar(0, 100, 102, 99, 101), b = bar(1, 101, 103, 100, 102);
  assert.throws(() => detectFvg([a, {...b, closed: false}]), /Unclosed/);
  assert.throws(() => detectFvg([b, a]), /increasing/);
});
test("confirmed pivot requires right-hand closed candles", () => {
  const bars = [bar(0, 10, 11, 9, 10), bar(1, 10, 15, 9.5, 14), bar(2, 12, 13, 10, 11)];
  const pivots = confirmedPivots(bars, {strength: 1});
  assert.equal(pivots[0].kind, "HIGH");
  assert.equal(pivots[0].confirmationTime, bars[2].time);
  assert.equal(confirmedPivots(bars.slice(0,2), {strength: 1}).length, 0);
});
test("ABC candidate is explicitly not a validated orthodox count", () => {
  const xs = [
    {id:"0",kind:"HIGH",price:120},{id:"1",kind:"LOW",price:100},
    {id:"2",kind:"HIGH",price:115},{id:"3",kind:"LOW",price:95}
  ];
  const [candidate] = abcCandidates(xs);
  assert.equal(candidate.direction,"DOWN");
  assert.equal(candidate.orthodoxSubdivisionsVerified,false);
});
test("snapshot is non-executable and requires explicit basis", () => {
  const bars = [bar(0, 100, 102, 99, 101)];
  assert.throws(() => computeEngine16Research({bars}), /priceBasis/);
  const result = computeEngine16Research({bars, priceBasis:"ES_PHYSICAL_UNADJUSTED"});
  assert.equal(result.researchOnly, true);
  assert.equal(result.noExecution, true);
});
