import fs from "fs";
import assert from "node:assert/strict";
import {
  classifyTenMinuteDiagnosticDirection,
} from "../logic/engine3/fastImbalanceReaction.js";

function bar(open, high, low, close, time = null) {
  return { open, high, low, close, time };
}

function flatHistory(price = 100, count = 11, range = 4) {
  return Array.from({ length: count }, (_, index) =>
    bar(
      price,
      price + range / 2,
      price - range / 2,
      price,
      1_000 + index * 600
    )
  );
}

function withWindow(windowBars, basePrice = 100, baseRange = 4) {
  return [
    ...flatHistory(basePrice, 11, baseRange),
    ...windowBars,
  ];
}

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// 1. Clean LONG.
test("clean LONG", () => {
  const bars = withWindow([
    bar(99, 102, 98, 100),
    bar(100, 103, 99, 101.5),
    bar(101.5, 105, 101, 103.5),
    bar(103.5, 107, 103, 105.5),
  ]);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "LONG"
  );
});

// 2. Clean SHORT.
test("clean SHORT", () => {
  const bars = withWindow([
    bar(101, 102, 98, 100),
    bar(100, 101, 97, 98.5),
    bar(98.5, 99, 95, 96.5),
    bar(96.5, 97, 93, 94.5),
  ]);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "SHORT"
  );
});

// 3. Large bearish displacement must beat tiny bullish bodies.
test("large bearish displacement", () => {
  const bars = withWindow(
    [
      bar(7787.75, 7791.75, 7787.5, 7791),
      bar(7791, 7792, 7786.25, 7791.25),
      bar(7791, 7793.5, 7790, 7791.75),
      bar(7791.75, 7792.5, 7774.75, 7777.5),
    ],
    7790,
    4
  );

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "SHORT"
  );
});

// 4. Materially contradicted LONG becomes NEUTRAL.
test("materially contradicted LONG", () => {
  const bars = withWindow(
    [
      bar(7778.75, 7778.75, 7777.25, 7778),
      bar(7778, 7778.5, 7775.75, 7777.25),
      bar(7777.25, 7778, 7775, 7778),
      bar(7778, 7787.75, 7777.75, 7786),
    ],
    7778,
    4
  );

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 5. Body-conflicted SHORT becomes NEUTRAL.
test("body-conflicted SHORT", () => {
  const bars = withWindow(
    [
      bar(7785.25, 7796, 7784.75, 7792.5),
      bar(7792.75, 7794.75, 7787.75, 7788),
      bar(7788, 7789, 7787, 7788.25),
      bar(7788.25, 7789.25, 7785.75, 7786.5),
    ],
    7790,
    4
  );

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 6. Original false-LONG style: tiny/mixed movement must be NEUTRAL.
test("original false-LONG style window", () => {
  const bars = withWindow(
    [
      bar(7753, 7753.75, 7751.75, 7753.25),
      bar(7753, 7753.25, 7752, 7753),
      bar(7753, 7754.25, 7752.75, 7754),
      bar(7753.75, 7753.75, 7752, 7752.25),
    ],
    7753,
    4
  );

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 7. Exactly 1.25 ATR passes.
test("exactly 1.25 ATR passes", () => {
  const bars = withWindow([
    bar(99, 102, 98, 100),
    bar(100, 103, 99, 101),
    bar(101, 105, 101, 103),
    bar(103, 107, 103, 105),
  ]);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "LONG"
  );
});

// 8. Below threshold is NEUTRAL.
test("below 1.25 ATR is NEUTRAL", () => {
  const bars = withWindow([
    bar(99, 102, 98, 100),
    bar(100, 103, 99, 101),
    bar(101, 105, 101, 103),
    bar(103, 106.75, 102.75, 104.75),
  ]);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 9. Equal body totals are NEUTRAL.
test("equal body totals are NEUTRAL", () => {
  const bars = withWindow([
    bar(98, 100.25, 97.75, 100),
    bar(106, 106.25, 103.75, 104),
    bar(102, 104.25, 101.75, 104),
    bar(108, 108.25, 105.75, 106),
  ]);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 10. Zero net displacement is NEUTRAL.
test("zero net displacement is NEUTRAL", () => {
  const bars = withWindow([
    bar(99, 102, 98, 100),
    bar(100, 103, 99, 101),
    bar(101, 103, 99, 100),
    bar(100, 102, 98, 100),
  ]);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 11. Insufficient ATR history is NEUTRAL.
test("insufficient ATR history", () => {
  const bars = flatHistory(100, 14, 4);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 12. Invalid/zero ATR is NEUTRAL.
test("invalid zero ATR", () => {
  const bars = Array.from({ length: 15 }, (_, index) =>
    bar(100, 100, 100, 100, index * 600)
  );

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 13. Missing/non-finite OHLC is NEUTRAL.
test("invalid OHLC", () => {
  const bars = withWindow([
    bar(99, 102, 98, 100),
    bar(100, 103, 99, 101),
    bar(101, Number.NaN, 101, 103),
    bar(103, 107, 103, 105),
  ]);

  assert.equal(
    classifyTenMinuteDiagnosticDirection(bars),
    "NEUTRAL"
  );
});

// 14. Structure cannot reverse direction.
test("structure cannot reverse direction", () => {
  const bars = withWindow(
    [
      bar(7778.75, 7778.75, 7777.25, 7778),
      bar(7778, 7778.5, 7775.75, 7777.25),
      bar(7777.25, 7778, 7775, 7778),
      bar(7778, 7787.75, 7777.75, 7786),
    ],
    7778,
    4
  );

  const result = classifyTenMinuteDiagnosticDirection(bars);
  assert.equal(result, "NEUTRAL");
  assert.notEqual(result, "SHORT");
});

// 15. Integration uses completed bars and retired point voting is absent.
test("completed-bars integration and no point-voting fallback", () => {
  const sourceUrl = new URL(
    "../logic/engine3/fastImbalanceReaction.js",
    import.meta.url
  );
  const source = fs.readFileSync(sourceUrl, "utf8");

  assert.match(
    source,
    /classifyTenMinuteDiagnosticDirection\(\s*candleCompletionTruth\.completedBars\s*\)/
  );

  assert.doesNotMatch(
    source,
    /classifyHeldLevelCandleDirection/
  );

  assert.doesNotMatch(
    source,
    /bullishScore|bearishScore/
  );
});

console.log(`\n${passed}/15 PASS`);
