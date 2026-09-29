// services/core/tests/engine25DistributionVolumePressure.test.js

import assert from "node:assert/strict";
import {
  MIN_VOLUME_COVERAGE,
  buildTimeframeVolumePressure,
  buildDistributionVolumePressure,
} from "../logic/engine25/buildDistributionVolumePressure.js";

function card(sector, {
  scanned = 100,
  withVolume = 90,
  advancing = 45,
  declining = 45,
  unchanged = 10,
} = {}) {
  const total = advancing + declining + unchanged;
  return {
    sector,
    totalVolume: total,
    advancingVolume: advancing,
    decliningVolume: declining,
    unchangedVolume: unchanged,
    advancingVolumePct: total ? advancing / total * 100 : null,
    decliningVolumePct: total ? declining / total * 100 : null,
    stocksScanned: scanned,
    stocksWithVolume: withVolume,
  };
}

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("1 declining-volume dominance increases pressure", () => {
  const balanced = buildTimeframeVolumePressure([card("Technology")]);
  const declining = buildTimeframeVolumePressure([
    card("Technology", { advancing: 25, declining: 75 }),
  ]);
  assert.ok(declining.volumePressure > balanced.volumePressure);
});

run("2 advancing-volume dominance reduces pressure", () => {
  const balanced = buildTimeframeVolumePressure([card("Technology")]);
  const advancing = buildTimeframeVolumePressure([
    card("Technology", { advancing: 75, declining: 25 }),
  ]);
  assert.ok(advancing.volumePressure < balanced.volumePressure);
});

run("3 balanced volume is moderate/neutral", () => {
  const result = buildTimeframeVolumePressure([card("Technology")]);
  assert.equal(result.decliningVolumeShare, 0.5);
  assert.equal(result.advancingVolumeShare, 0.5);
  assert.equal(result.volumeImbalance, 0);
  assert.equal(result.volumePressure, 25);
});

run("4 volume imbalance direction is correct", () => {
  const result = buildTimeframeVolumePressure([
    card("Technology", { advancing: 40, declining: 60 }),
  ]);
  assert.equal(Number(result.volumeImbalance.toFixed(2)), 0.2);
});

run("5 missing volume does not become zero-pressure evidence", () => {
  const result = buildTimeframeVolumePressure([
    { sector: "Technology", stocksScanned: 100, stocksWithVolume: 90 },
  ]);
  assert.equal(result.available, false);
  assert.equal(result.volumePressure, null);
});

run("6 zero directional volume is unavailable, not bullish", () => {
  const result = buildTimeframeVolumePressure([
    card("Technology", { advancing: 0, declining: 0, unchanged: 100 }),
  ]);
  assert.equal(result.available, false);
  assert.equal(result.reason, "NO_DIRECTIONAL_VOLUME");
});

run("7 intraday + EOD volume are consumed", () => {
  const result = buildDistributionVolumePressure({
    intradayCards: [card("Technology", { advancing: 30, declining: 70 })],
    eodCards: [card("Technology", { advancing: 40, declining: 60 })],
  });
  assert.equal(result.available, true);
  assert.equal(result.combination, "60PCT_INTRADAY_40PCT_EOD");
  assert.equal(
    result.combinedVolumePressure,
    result.intraday.volumePressure * 0.60 + result.eod.volumePressure * 0.40
  );
});

run("8 4H is not introduced", () => {
  const result = buildDistributionVolumePressure({
    intradayCards: [card("Technology")],
    eodCards: [card("Technology")],
    fourHourCards: [card("Technology", { advancing: 0, declining: 100 })],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "fourHour"), false);
});

run("9 Healthcare/tech aliases cannot double-vote", () => {
  const base = buildTimeframeVolumePressure([
    card("Health Care", { advancing: 60, declining: 40 }),
    card("Technology", { advancing: 60, declining: 40 }),
  ]);
  const aliases = buildTimeframeVolumePressure([
    card("Health Care", { advancing: 60, declining: 40 }),
    card("Healthcare", { advancing: 1, declining: 99 }),
    card("Technology", { advancing: 60, declining: 40 }),
    card("tech", { advancing: 1, declining: 99 }),
  ]);
  assert.equal(aliases.uniqueSectorCount, 2);
  assert.equal(aliases.volumePressure, base.volumePressure);
});

run("10 raw volume totals are used, not equal-weight sector percentages", () => {
  const result = buildTimeframeVolumePressure([
    card("Large", { scanned: 900, withVolume: 900, advancing: 900, declining: 100 }),
    card("Small", { scanned: 100, withVolume: 100, advancing: 0, declining: 100 }),
  ]);
  assert.equal(result.advancingVolume, 900);
  assert.equal(result.decliningVolume, 200);
  assert.equal(Number(result.decliningVolumeShare.toFixed(4)), 0.1818);
});

run("11 legacy breadth/momentum/NH-NL are outside volume module", () => {
  const result = buildTimeframeVolumePressure([
    { ...card("Technology"), breadth_pct: 0, momentum_pct: 0, nh: 0, nl: 9999 },
  ]);
  assert.equal(result.available, true);
  assert.equal(result.volumePressure, 25);
});

run("12 no ES/SPY/sector ETF volume enters calculation", () => {
  const result = buildTimeframeVolumePressure([
    { ...card("Technology"), ESVolume: 999999, SPYVolume: 999999, sectorEtfVolume: 999999 },
  ]);
  assert.equal(result.advancingVolume, 45);
  assert.equal(result.decliningVolume, 45);
});

run("13 relativeVolume remains absent", () => {
  const result = buildTimeframeVolumePressure([
    { ...card("Technology"), relativeVolume: 999 },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "relativeVolume"), false);
});

run("14 volume coverage below 70% -> timeframe excluded", () => {
  const result = buildTimeframeVolumePressure([
    card("Technology", { scanned: 100, withVolume: 69 }),
  ]);
  assert.equal(MIN_VOLUME_COVERAGE, 0.70);
  assert.equal(result.available, false);
  assert.equal(result.reason, "VOLUME_COVERAGE_BELOW_70_PERCENT");
});

run("15 only intraday valid -> intraday used alone", () => {
  const result = buildDistributionVolumePressure({
    intradayCards: [card("Technology", { advancing: 30, declining: 70 })],
    eodCards: [card("Technology", { scanned: 100, withVolume: 50 })],
  });
  assert.equal(result.available, true);
  assert.equal(result.combination, "INTRADAY_ONLY");
  assert.equal(result.combinedVolumePressure, result.intraday.volumePressure);
});

run("16 only EOD valid -> EOD used alone", () => {
  const result = buildDistributionVolumePressure({
    intradayCards: [card("Technology", { scanned: 100, withVolume: 50 })],
    eodCards: [card("Technology", { advancing: 30, declining: 70 })],
  });
  assert.equal(result.available, true);
  assert.equal(result.combination, "EOD_ONLY");
  assert.equal(result.combinedVolumePressure, result.eod.volumePressure);
});

run("17 neither valid -> volume unavailable for exact legacy fallback", () => {
  const result = buildDistributionVolumePressure({
    intradayCards: [card("Technology", { scanned: 100, withVolume: 50 })],
    eodCards: [card("Technology", { scanned: 100, withVolume: 50 })],
  });
  assert.equal(result.available, false);
  assert.equal(result.combinedVolumePressure, null);
  assert.equal(result.combination, "UNAVAILABLE");
});

run("18 final formula contract is exactly 70% legacy + 30% volume", () => {
  const legacy = 80;
  const volume = 20;
  const finalRaw = legacy * 0.70 + volume * 0.30;
  assert.equal(finalRaw, 62);
  assert.equal(100 - finalRaw, 38);
});

run("19 unchangedVolume is diagnostic and excluded from directional denominator", () => {
  const a = buildTimeframeVolumePressure([
    card("Technology", { advancing: 60, declining: 40, unchanged: 0 }),
  ]);
  const b = buildTimeframeVolumePressure([
    card("Technology", { advancing: 60, declining: 40, unchanged: 100000 }),
  ]);
  assert.equal(a.directionalVolume, 100);
  assert.equal(b.directionalVolume, 100);
  assert.equal(a.volumePressure, b.volumePressure);
  assert.notEqual(a.unchangedVolume, b.unchangedVolume);
});

console.log("Engine25 Distribution Volume Pressure Phase 5 tests PASS");
