import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine29EsWeeklyStructureContext,
} from "../logic/engine29/structure/buildEsWeeklyStructureContext.js";

function anchor() {
  return {
    resolvedSymbol: "ESZ6",
    source: "FRYE_FUTURES_OHLC_PROVIDER",
    structuralFreshness: { stale: false },
    structure: {
      structural: {
        barCount: 120,
        freshness: { stale: false },
        latest: {
          time: 1791849600000,
          date: "2026-10-12",
          open: 7700,
          high: 7850,
          low: 7680,
          close: 7790,
          completed: false,
        },
        movingAverages: {
          ema10: 7725,
          ema20: 7600,
          ema50: 7350,
          ema200: 6200,
          ema10SlopePct: 0.8,
          ema20SlopePct: 0.6,
          ema50SlopePct: 0.4,
        },
        swings: {
          trend: "BULLISH",
          highStructure: "HIGHER_HIGH",
          lowStructure: "HIGHER_LOW",
          priorSwingHigh: { price: 7700 },
          lastSwingHigh: { price: 7900 },
          priorSwingLow: { price: 7200 },
          lastSwingLow: { price: 7450 },
        },
        levels: {
          recentSupport: 7450,
          recentResistance: 7900,
          distanceFromSupportPct: 4.56,
          distanceFromResistancePct: -1.39,
          supportSource: "CONFIRMED_SWING_LOW",
          resistanceSource: "CONFIRMED_SWING_HIGH",
        },
        classification: {
          state: "HEALTHY",
          stage: "NORMAL",
          confidence: "HIGH",
          evidence: {
            currentBeyondStressLevel: false,
            latestCompleted: false,
          },
        },
      },
    },
  };
}

test("publishes ES weekly evidence without inventing a second structure formula", () => {
  const r = buildEngine29EsWeeklyStructureContext(anchor());

  assert.equal(r.available, true);
  assert.equal(r.authority, "ENGINE29_ES_WEEKLY_PRICE_STRUCTURE");
  assert.equal(r.timeframe, "1W");
  assert.equal(r.sourceTimeframe, "1D_AGGREGATED_TO_1W");
  assert.equal(r.classification.state, "HEALTHY");
  assert.equal(r.trend.swingTrend, "BULLISH");
  assert.equal(r.trend.highStructure, "HIGHER_HIGH");
  assert.equal(r.trend.lowStructure, "HIGHER_LOW");
  assert.equal(r.movingAverages.closeAboveEma10, true);
  assert.equal(r.movingAverages.closeAboveEma20, true);
  assert.equal(r.movingAverages.closeAboveEma50, true);
  assert.equal(r.currentWeekCompleted, false);
});

test("preserves weekly support/resistance and completion truth", () => {
  const r = buildEngine29EsWeeklyStructureContext(anchor());

  assert.equal(r.levels.recentSupport, 7450);
  assert.equal(r.levels.recentResistance, 7900);
  assert.equal(r.levels.supportSource, "CONFIRMED_SWING_LOW");
  assert.equal(r.levels.resistanceSource, "CONFIRMED_SWING_HIGH");
  assert.equal(r.latestWeeklyBar.completed, false);
});

test("fails closed when ES weekly structure is unavailable", () => {
  const r = buildEngine29EsWeeklyStructureContext({
    resolvedSymbol: "ESZ6",
    source: "FRYE_FUTURES_OHLC_PROVIDER",
    structure: { structural: null },
  });

  assert.equal(r.available, false);
  assert.equal(r.reason, "ES_WEEKLY_STRUCTURE_UNAVAILABLE");
  assert.equal(r.resolvedSymbol, "ESZ6");
});
