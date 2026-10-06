// services/core/logic/engine29/structure/buildSymbolStructure.js

import { ENGINE29_TIMEFRAMES } from "../constants.js";
import { aggregateDailyToWeekly } from "./aggregateDailyToWeekly.js";
import { attachEmaSet, emaSlope } from "./calculateEma.js";
import {
  detectConfirmedSwings,
  summarizeSwingTrend,
} from "./detectSwingStructure.js";
import { deriveSupportResistance } from "./deriveSupportResistance.js";
import { classifySymbolStructure } from "./classifySymbolStructure.js";

function pct(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function latestSnapshot(bars = []) {
  const latest = bars.at(-1) || null;

  if (!latest) return null;

  return {
    date: latest.date,
    time: latest.time,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    close: latest.close,
    completed: latest.completed,
    ema10: latest.ema10 ?? null,
    ema20: latest.ema20 ?? null,
    ema50: latest.ema50 ?? null,
    ema200: latest.ema200 ?? null,
  };
}

function prepareIntradayBars(
  bars = [],
  now = Date.now(),
  durationMs = 60 * 60 * 1000
) {
  return bars
    .map((bar) => ({
      ...bar,
      completed: Number.isFinite(Number(bar?.time))
        ? Number(bar.time) + durationMs <= now
        : true,
    }))
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function buildOneTimeframe({
  bars,
  timeframe,
  stressDirection,
  evidenceQuality,
  freshness = null,
  now,
  swingLeft,
  swingRight,
  supportLookbackBars,
  testingThresholdPct,
}) {
  const baseBars =
    timeframe === ENGINE29_TIMEFRAMES.STRUCTURAL
      ? aggregateDailyToWeekly(bars, { now })
      : prepareIntradayBars(
          bars,
          now,
          timeframe === ENGINE29_TIMEFRAMES.FAST_TACTICAL
            ? 30 * 60 * 1000
            : 60 * 60 * 1000
        );

  const enriched = attachEmaSet(
    baseBars,
    [10, 20, 50, 200]
  );

  const swings = detectConfirmedSwings(enriched, {
    left: swingLeft,
    right: swingRight,
  });

  const swingSummary = summarizeSwingTrend(swings);

  const levels = deriveSupportResistance({
    bars: enriched,
    swings,
    lookbackBars: supportLookbackBars,
  });

  const classification = classifySymbolStructure({
    bars: enriched,
    stressDirection,
    evidenceQuality,
    levels,
    swingSummary,
    testingThresholdPct,
  });

  return {
    timeframe,
    barCount: enriched.length,

    // Preserve the market-data freshness truth unchanged.
    // The validation layer remains the authority for stale/age thresholds.
    freshness,

    latest: latestSnapshot(enriched),

    movingAverages: {
      ema10: enriched.at(-1)?.ema10 ?? null,
      ema20: enriched.at(-1)?.ema20 ?? null,
      ema50: enriched.at(-1)?.ema50 ?? null,
      ema200: enriched.at(-1)?.ema200 ?? null,
      ema10SlopePct: pct(
        emaSlope(enriched, "ema10", 3)
      ),
      ema20SlopePct: pct(
        emaSlope(enriched, "ema20", 3)
      ),
      ema50SlopePct: pct(
        emaSlope(enriched, "ema50", 3)
      ),
    },

    swings: {
      trend: swingSummary.trend,
      highStructure: swingSummary.highStructure,
      lowStructure: swingSummary.lowStructure,
      priorSwingHigh: swingSummary.priorSwingHigh,
      lastSwingHigh: swingSummary.lastSwingHigh,
      priorSwingLow: swingSummary.priorSwingLow,
      lastSwingLow: swingSummary.lastSwingLow,
      confirmedHighCount: swings.highs.length,
      confirmedLowCount: swings.lows.length,
    },

    levels,
    classification,
    bars: enriched,
  };
}

export function buildEngine29SymbolStructure(
  symbolEntry,
  { now = Date.now() } = {}
) {
  if (!symbolEntry) return null;

  const common = {
    stressDirection: symbolEntry.stressDirection,
    evidenceQuality: symbolEntry.evidenceQuality,
    now,
  };

  const structural = symbolEntry.structural?.bars?.length
    ? buildOneTimeframe({
        ...common,
        bars: symbolEntry.structural.bars,
        freshness:
          symbolEntry.structural?.freshness ?? null,
        timeframe: ENGINE29_TIMEFRAMES.STRUCTURAL,
        swingLeft: 2,
        swingRight: 2,
        supportLookbackBars: 80,
        testingThresholdPct: 1.5,
      })
    : null;

  const tactical = symbolEntry.tactical?.bars?.length
    ? buildOneTimeframe({
        ...common,
        bars: symbolEntry.tactical.bars,
        freshness:
          symbolEntry.tactical?.freshness ?? null,
        timeframe: ENGINE29_TIMEFRAMES.TACTICAL,
        swingLeft: 2,
        swingRight: 2,
        supportLookbackBars: 120,
        testingThresholdPct: 0.75,
      })
    : null;

  const fastTactical =
    symbolEntry.fastTactical?.bars?.length
      ? buildOneTimeframe({
          ...common,
          bars: symbolEntry.fastTactical.bars,
          freshness:
            symbolEntry.fastTactical?.freshness ?? null,
          timeframe:
            ENGINE29_TIMEFRAMES.FAST_TACTICAL,
          swingLeft: 2,
          swingRight: 2,
          supportLookbackBars: 160,
          testingThresholdPct: 0.5,
        })
      : null;

  return {
    canonicalSymbol: symbolEntry.canonicalSymbol,
    label: symbolEntry.label,
    group: symbolEntry.group,
    subgroup: symbolEntry.subgroup,
    stressDirection: symbolEntry.stressDirection,
    provider: symbolEntry.provider,
    sourceSymbol: symbolEntry.sourceSymbol,
    sourceSeriesId: symbolEntry.sourceSeriesId,
    isProxy: symbolEntry.isProxy,
    proxyFor: symbolEntry.proxyFor,
    evidenceQuality: symbolEntry.evidenceQuality,
    available: symbolEntry.available,

    structural,

    tactical,
    tacticalAvailable: Boolean(tactical),

    fastTactical,
    fastTacticalAvailable: Boolean(fastTactical),

    errors: symbolEntry.errors || [],
  };
}
