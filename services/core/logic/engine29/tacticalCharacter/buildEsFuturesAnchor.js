// services/core/logic/engine29/tacticalCharacter/buildEsFuturesAnchor.js
//
// Engine 29 ES tactical anchor.
//
// Purpose:
// - ES futures is the PRIMARY intraday move-character trigger.
// - Reuse Frye's existing shared futuresOhlcProvider.
// - Build 1H + 30m ES structure without adding ES to the 1W cross-market universe.
// - Add 10m ES bars for the diagnostic live squeeze/momentum monitor.
// - Add 2H + 4H location context for macro trap/liquidity detection only.
// - SPY/QQQ and all other Engine 29 groups remain confirmation/context.

import { fetchFuturesBars } from "../../../providers/futuresOhlcProvider.js";
import {
  ENGINE29_EVIDENCE_QUALITY,
  ENGINE29_STRESS_DIRECTIONS,
} from "../constants.js";
import { evaluateFreshness } from "../data/validateFreshness.js";
import { buildEngine29SymbolStructure } from "../structure/buildSymbolStructure.js";

function normalizeFuturesBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => {
      const rawTime = Number(bar?.time);
      const time = Number.isFinite(rawTime)
        ? rawTime < 1e12
          ? rawTime * 1000
          : rawTime
        : null;

      const open = Number(bar?.open);
      const high = Number(bar?.high);
      const low = Number(bar?.low);
      const close = Number(bar?.close);
      const volume = Number(bar?.volume ?? 0);

      if (![time, open, high, low, close].every(Number.isFinite)) return null;

      return {
        date: new Date(time).toISOString().slice(0, 10),
        time,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        vwap: null,
        transactions: null,
        dataShape: "OHLCV",
        syntheticOhlc: false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function latest(bars = []) {
  return bars.at(-1) || null;
}

function aggregateOneHourToTwoHour(oneHourBars = []) {
  const bars = (Array.isArray(oneHourBars) ? oneHourBars : [])
    .filter((bar) =>
      Number.isFinite(Number(bar?.time)) &&
      Number.isFinite(Number(bar?.open)) &&
      Number.isFinite(Number(bar?.high)) &&
      Number.isFinite(Number(bar?.low)) &&
      Number.isFinite(Number(bar?.close))
    )
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time));

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const groups = new Map();

  for (const bar of bars) {
    const bucket = Math.floor(Number(bar.time) / TWO_HOURS_MS) * TWO_HOURS_MS;

    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(bar);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, members]) => {
      const ordered = members.slice().sort((a, b) => Number(a.time) - Number(b.time));
      const first = ordered[0];
      const last = ordered.at(-1);

      return {
        date: new Date(bucket).toISOString().slice(0, 10),
        time: bucket,
        open: Number(first.open),
        high: Math.max(...ordered.map((bar) => Number(bar.high))),
        low: Math.min(...ordered.map((bar) => Number(bar.low))),
        close: Number(last.close),
        volume: ordered.reduce(
          (sum, bar) => sum + (Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : 0),
          0
        ),
        vwap: null,
        transactions: null,
        dataShape: "OHLCV",
        syntheticOhlc: false,
        derivedFrom: "1H",
        sourceBarCount: ordered.length,
      };
    })
    .filter((bar) => bar.sourceBarCount === 2);
}

function marketEntry({
  hourly,
  thirtyMinute,
  tenMinute,
  now,
}) {
  const oneHourBars = normalizeFuturesBars(hourly?.bars);
  const thirtyMinuteBars = normalizeFuturesBars(thirtyMinute?.bars);
  const tenMinuteBars = normalizeFuturesBars(tenMinute?.bars);

  return {
    canonicalSymbol: "ES",
    label: "E-mini S&P 500 Futures",
    group: "TACTICAL_ANCHOR",
    subgroup: "ES_FUTURES",

    // Structure classifier requires a stress direction, but ES anchor classification
    // is NOT used as a trade-direction command. Move character reads price action.
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,

    required: true,
    provider: "FRYE_FUTURES_OHLC_PROVIDER",
    sourceSymbol:
      tenMinute?.resolvedSymbol ||
      thirtyMinute?.resolvedSymbol ||
      hourly?.resolvedSymbol ||
      null,
    sourceSeriesId: null,
    isProxy: false,
    proxyFor: null,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.DIRECT,

    available: Boolean(
      oneHourBars.length ||
      thirtyMinuteBars.length ||
      tenMinuteBars.length
    ),

    structural: null,

    tactical: {
      timeframe: "1H",
      sourceTimeframe: "1H",
      count: oneHourBars.length,
      latest: latest(oneHourBars),
      bars: oneHourBars,
      freshness: evaluateFreshness({
        latestTime: latest(oneHourBars)?.time,
        timeframe: "1H",
        now,
      }),
    },

    fastTactical: {
      timeframe: "30m",
      sourceTimeframe: "30m",
      count: thirtyMinuteBars.length,
      latest: latest(thirtyMinuteBars),
      bars: thirtyMinuteBars,
      freshness: evaluateFreshness({
        latestTime: latest(thirtyMinuteBars)?.time,
        timeframe: "30m",
        now,
      }),
    },

    // Diagnostic-only live layer.
    liveMonitor: {
      timeframe: "10m",
      sourceTimeframe: "10m",
      count: tenMinuteBars.length,
      latest: latest(tenMinuteBars),
      bars: tenMinuteBars,
      freshness: evaluateFreshness({
        latestTime: latest(tenMinuteBars)?.time,
        timeframe: "10m",
        now,
      }),
    },

    tacticalAvailable: oneHourBars.length > 0,
    fastTacticalAvailable: thirtyMinuteBars.length > 0,
    liveMonitorAvailable: tenMinuteBars.length > 0,
    errors: [],
  };
}

export async function buildEngine29EsFuturesAnchor({
  now = Date.now(),
  symbol = "ES",
  oneHourLimit = 2500,
  thirtyMinuteLimit = 3500,
  tenMinuteLimit = 5000,
  fourHourLimit = 1800,
} = {}) {
  const [hourly, thirtyMinute, tenMinute, fourHour] = await Promise.all([
    fetchFuturesBars({
      symbol,
      timeframe: "1h",
      limit: oneHourLimit,
    }),
    fetchFuturesBars({
      symbol,
      timeframe: "30m",
      limit: thirtyMinuteLimit,
    }),
    fetchFuturesBars({
      symbol,
      timeframe: "10m",
      limit: tenMinuteLimit,
    }),
    fetchFuturesBars({
      symbol,
      timeframe: "4h",
      limit: fourHourLimit,
    }),
  ]);

  const entry = marketEntry({
    hourly,
    thirtyMinute,
    tenMinute,
    now,
  });

  const structure = buildEngine29SymbolStructure(entry, { now });

  const oneHourBars = entry.tactical?.bars || [];
  const twoHourBars = aggregateOneHourToTwoHour(oneHourBars);
  const fourHourBars = normalizeFuturesBars(fourHour?.bars);

  const macroContext = {
    authority: "LOCATION_CONTEXT_ONLY",

    twoHour: {
      timeframe: "2H",
      sourceTimeframe: "1H",
      source: "DERIVED_FROM_CONSECUTIVE_1H_BARS",
      count: twoHourBars.length,
      latest: latest(twoHourBars),
      bars: twoHourBars,

      // No new 2H freshness threshold is invented.
      // This layer inherits the existing 1H source freshness truth.
      sourceFreshness: entry.tactical?.freshness || null,
    },

    fourHour: {
      timeframe: "4H",
      sourceTimeframe: "4H",
      source: "FRYE_FUTURES_OHLC_PROVIDER",
      count: fourHourBars.length,
      latest: latest(fourHourBars),
      bars: fourHourBars,

      // 4H is macro location context only in this phase.
      // A dedicated 4H freshness policy is intentionally not invented here.
      freshness: null,
    },
  };

  return {
    version: "engine29.esAnchor.v1.2.macroLocation",
    timestamp: new Date(now).toISOString(),
    productCode: symbol,

    resolvedSymbol:
      tenMinute?.resolvedSymbol ||
      thirtyMinute?.resolvedSymbol ||
      hourly?.resolvedSymbol ||
      fourHour?.resolvedSymbol ||
      null,

    source: "FRYE_FUTURES_OHLC_PROVIDER",

    resolver:
      tenMinute?.resolver ||
      thirtyMinute?.resolver ||
      hourly?.resolver ||
      fourHour?.resolver ||
      null,

    tacticalFreshness: entry.tactical?.freshness || null,
    fastTacticalFreshness: entry.fastTactical?.freshness || null,
    liveMonitorFreshness: entry.liveMonitor?.freshness || null,

    tacticalAvailable: Boolean(structure?.tactical),
    fastTacticalAvailable: Boolean(structure?.fastTactical),
    liveMonitorAvailable: Boolean(entry.liveMonitor?.latest),

    // Raw normalized 10m ES bars for the diagnostic live monitor.
    // This does NOT become 30m / 1H / 1W authority.
    liveMonitor: entry.liveMonitor,

    // Macro trap-location context only. It does not overwrite 1H/30m authority.
    macroContext,

    structure,
  };
}
