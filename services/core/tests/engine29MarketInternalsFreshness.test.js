import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateEngine29FuturesBars,
} from "../logic/engine29/data/providers/futuresProductMarketData.js";
import {
  ENGINE29_SYMBOL_REGISTRY,
} from "../logic/engine29/symbolRegistry.js";
import {
  memberSnapshot,
} from "../logic/engine29/groups/groupUtils.js";

test("aggregates live 10m futures bars into 30m without losing latest time", () => {
  const base = Date.UTC(2026, 9, 5, 15, 0, 0);
  const bars = [
    { time: base, open: 90, high: 91, low: 89, close: 90.5, volume: 10 },
    { time: base + 10 * 60 * 1000, open: 90.5, high: 91.2, low: 90.2, close: 91, volume: 11 },
    { time: base + 20 * 60 * 1000, open: 91, high: 91.4, low: 90.8, close: 91.3, volume: 12 },
    { time: base + 30 * 60 * 1000, open: 91.3, high: 91.6, low: 91.1, close: 91.5, volume: 13 },
  ];

  const out = aggregateEngine29FuturesBars(bars, "30m");

  assert.equal(out.length, 2);
  assert.equal(out[0].time, base);
  assert.equal(out[0].open, 90);
  assert.equal(out[0].high, 91.4);
  assert.equal(out[0].low, 89);
  assert.equal(out[0].close, 91.3);
  assert.equal(out[0].volume, 33);
  assert.equal(out[1].time, base + 30 * 60 * 1000);
  assert.equal(out[1].close, 91.5);
});

test("rates retain FRED structural source and verified live intraday symbols", () => {
  assert.equal(
    ENGINE29_SYMBOL_REGISTRY.US10Y.primary.seriesId,
    "DGS10"
  );
  assert.equal(
    ENGINE29_SYMBOL_REGISTRY.US10Y.primary.intradaySymbol,
    "I:TNX"
  );
  assert.equal(
    ENGINE29_SYMBOL_REGISTRY.US30Y.primary.seriesId,
    "DGS30"
  );
  assert.equal(
    ENGINE29_SYMBOL_REGISTRY.US30Y.primary.intradaySymbol,
    "I:TYX"
  );
});

test("group member snapshot preserves freshness for UI quality display", () => {
  const snap = memberSnapshot(
    {
      canonicalSymbol: "SPY",
      label: "SPY",
      evidenceQuality: "DIRECT",
      fastTactical: {
        classification: {
          state: "HEALTHY",
          confidence: "HIGH",
          stage: "NONE",
        },
        freshness: {
          stale: false,
          ageMinutes: 10,
          reason: "FRESH",
        },
        latest: {
          time: Date.UTC(2026, 9, 5, 15, 30),
          close: 772,
        },
      },
    },
    "fastTactical"
  );

  assert.equal(snap.available, true);
  assert.equal(snap.freshness.stale, false);
  assert.equal(snap.freshness.ageMinutes, 10);
});
