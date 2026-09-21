'fetchEngine29PolygonThirtyMinute'
]
render@srv-d2ds5nodl3ps73b7i2og-866d65df45-2krqp:~/project/src$ cd /opt/render/project/src && sed -n '1,620p' services/core/logic/engine29/data/buildMarketDataBundle.js
// services/core/logic/engine29/data/buildMarketDataBundle.js

import {
  ENGINE29_EVIDENCE_QUALITY,
  ENGINE29_TIMEFRAMES,
} from "../constants.js";
import {
  ENGINE29_SYMBOL_REGISTRY,
  ENGINE29_REQUIRED_SYMBOLS,
} from "../symbolRegistry.js";
import {
  normalizeFredObservations,
  normalizePolygonBars,
  getLatestNormalizedBar,
} from "./normalizeMarketBars.js";
import { evaluateFreshness } from "./validateFreshness.js";
import {
  fetchEngine29PolygonDaily,
  fetchEngine29PolygonHourly,
  fetchEngine29PolygonThirtyMinute,
  fetchEngine29PolygonTenMinute,
} from "./providers/polygonMarketData.js";
import { fetchEngine29FredDaily } from "./providers/fredMarketData.js";
import { fetchEngine29FuturesProductBars } from "./providers/futuresProductMarketData.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function buildUnavailableEntry({ definition, reason }) {
  return {
    canonicalSymbol: definition.canonicalSymbol,
    label: definition.label,
    group: definition.group,
    subgroup: definition.subgroup || null,
    stressDirection: definition.stressDirection,
    required: Boolean(definition.required),
    provider: null,
    sourceSymbol: null,
    sourceSeriesId: null,
    sourceProductCode: null,
    isProxy: false,
    proxyFor: null,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.MISSING,
    available: false,
    structural: null,
    tactical: null,
    fastTactical: null,
    liveMonitor: null,
    tacticalAvailable: false,
    fastTacticalAvailable: false,
    liveMonitorAvailable: false,
    errors: [reason],
  };
}

function sourceMetadata(source) {
  return {
    provider: source?.provider || null,
    sourceSymbol: source?.symbol || null,
    sourceSeriesId: source?.seriesId || null,
    sourceProductCode: source?.productCode || null,
    isProxy: Boolean(source?.isProxy),
    proxyFor: source?.proxyFor || null,
    evidenceQuality:
      source?.evidenceQuality || ENGINE29_EVIDENCE_QUALITY.MISSING,
  };
}

async function loadPolygonSymbol({
  definition,
  source,
  polygonApiKey,
  structuralFrom,
  structuralTo,
  tacticalFrom,
  tacticalTo,
  fastTacticalFrom,
  fastTacticalTo,
  liveMonitorFrom,
  liveMonitorTo,
  now,
  includeTactical,
  includeFastTactical,
  includeLiveMonitor,
}) {
  const errors = [];

  let structural = null;
  try {
    const daily = await fetchEngine29PolygonDaily({
      symbol: source.symbol,
      apiKey: polygonApiKey,
      from: structuralFrom,
      to: structuralTo,
    });
    const bars = normalizePolygonBars(daily.bars);
    const latest = getLatestNormalizedBar(bars);
    const freshness = evaluateFreshness({
      latestTime: latest?.time,
      timeframe: "1D",
      now,
    });

    structural = {
      timeframe: ENGINE29_TIMEFRAMES.STRUCTURAL,
      sourceTimeframe: "1D",
      count: bars.length,
      latest,
      bars,
      freshness,
    };
  } catch (err) {
    errors.push(`STRUCTURAL: ${err.message}`);
  }

  let tactical = null;
  if (includeTactical) {
    try {
      const hourly = await fetchEngine29PolygonHourly({
        symbol: source.symbol,
        apiKey: polygonApiKey,
        from: tacticalFrom,
        to: tacticalTo,
      });
      const bars = normalizePolygonBars(hourly.bars);
      const latest = getLatestNormalizedBar(bars);
      const freshness = evaluateFreshness({
        latestTime: latest?.time,
        timeframe: ENGINE29_TIMEFRAMES.TACTICAL,
        now,
      });

      tactical = {
        timeframe: ENGINE29_TIMEFRAMES.TACTICAL,
        sourceTimeframe: "1H",
        count: bars.length,
        latest,
        bars,
        freshness,
      };
    } catch (err) {
      errors.push(`TACTICAL: ${err.message}`);
    }
  }

  let fastTactical = null;
  if (includeFastTactical) {
    try {
      const thirtyMinute = await fetchEngine29PolygonThirtyMinute({
        symbol: source.symbol,
        apiKey: polygonApiKey,
        from: fastTacticalFrom,
        to: fastTacticalTo,
      });
      const bars = normalizePolygonBars(thirtyMinute.bars);
      const latest = getLatestNormalizedBar(bars);
      const freshness = evaluateFreshness({
        latestTime: latest?.time,
        timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
        now,
      });

      fastTactical = {
        timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
        sourceTimeframe: "30m",
        count: bars.length,
        latest,
        bars,
        freshness,
      };
    } catch (err) {
      errors.push(`FAST_TACTICAL: ${err.message}`);
    }
  }

  let liveMonitor = null;
  if (includeLiveMonitor) {
    try {
      const tenMinute = await fetchEngine29PolygonTenMinute({
        symbol: source.symbol,
        apiKey: polygonApiKey,
        from: liveMonitorFrom,
        to: liveMonitorTo,
      });
      const bars = normalizePolygonBars(tenMinute.bars);
      const latest = getLatestNormalizedBar(bars);
      const freshness = evaluateFreshness({
        latestTime: latest?.time,
        timeframe: "10m",
        now,
      });

      liveMonitor = {
        timeframe: "10m",
        sourceTimeframe: "10m",
        count: bars.length,
        latest,
        bars,
        freshness,
      };
    } catch (err) {
      errors.push(`LIVE_MONITOR: ${err.message}`);
    }
  }

  const meta = sourceMetadata(source);

  return {
    canonicalSymbol: definition.canonicalSymbol,
    label: definition.label,
    group: definition.group,
    subgroup: definition.subgroup || null,
    stressDirection: definition.stressDirection,
    required: Boolean(definition.required),
    ...meta,
    available: Boolean(structural?.latest),
    structural,
    tactical,
    tacticalAvailable: Boolean(tactical?.latest),
    fastTactical,
    fastTacticalAvailable: Boolean(fastTactical?.latest),
    liveMonitor,
    liveMonitorAvailable: Boolean(liveMonitor?.latest),
    errors,
  };
}

async function loadFredSymbol({
  definition,
  source,
  fredApiKey,
  structuralFrom,
  now,
}) {
  const errors = [];
  let structural = null;

  try {
    const daily = await fetchEngine29FredDaily({
      seriesId: source.seriesId,
      apiKey: fredApiKey,
      observationStart: structuralFrom,
    });
    const bars = normalizeFredObservations(daily.observations);
    const latest = getLatestNormalizedBar(bars);
    const freshness = evaluateFreshness({
      latestTime: latest?.time,
      timeframe: "1D",
      now,
    });

    structural = {
      timeframe: ENGINE29_TIMEFRAMES.STRUCTURAL,
      sourceTimeframe: "1D",
      count: bars.length,
      latest,
      bars,
      freshness,
    };
  } catch (err) {
    errors.push(`STRUCTURAL: ${err.message}`);
  }

  const meta = sourceMetadata(source);

  return {
    canonicalSymbol: definition.canonicalSymbol,
    label: definition.label,
    group: definition.group,
    subgroup: definition.subgroup || null,
    stressDirection: definition.stressDirection,
    required: Boolean(definition.required),
    ...meta,
    available: Boolean(structural?.latest),
    structural,
    tactical: null,
    tacticalAvailable: false,
    tacticalUnavailableReason: "FRED_DAILY_ONLY",
    fastTactical: null,
    fastTacticalAvailable: false,
    fastTacticalUnavailableReason: "FRED_DAILY_ONLY",
    liveMonitor: null,
    liveMonitorAvailable: false,
    liveMonitorUnavailableReason: "FRED_DAILY_ONLY",
    errors,
  };
}

async function loadFuturesProductSymbol({
  definition,
  source,
  structuralFrom,
  structuralTo,
  tacticalFrom,
  tacticalTo,
  fastTacticalFrom,
  fastTacticalTo,
  liveMonitorFrom,
  liveMonitorTo,
  now,
  includeTactical,
  includeFastTactical,
  includeLiveMonitor,
}) {
  const errors = [];
  let resolvedSymbol = null;
  let resolver = null;

  let structural = null;
  try {
    const daily = await fetchEngine29FuturesProductBars({
      productCode: source.productCode,
      timeframe: "1D",
      from: structuralFrom,
      to: structuralTo,
      now,
    });
    resolvedSymbol = daily.resolvedSymbol || resolvedSymbol;
    resolver = daily.resolver || resolver;
    const bars = daily.bars || [];
    const latest = getLatestNormalizedBar(bars);
    const freshness = evaluateFreshness({
      latestTime: latest?.time,
      timeframe: "1D",
      now,
    });

    structural = {
      timeframe: ENGINE29_TIMEFRAMES.STRUCTURAL,
      sourceTimeframe: "1D",
      count: bars.length,
      latest,
      bars,
      freshness,
      resolvedSymbol,
      productCode: source.productCode,
      contractSpecificHistory: true,
      continuousHistory: false,
    };
  } catch (err) {
    errors.push(`STRUCTURAL: ${err.message}`);
  }

  let tactical = null;
  if (includeTactical) {
    try {
      const hourly = await fetchEngine29FuturesProductBars({
        productCode: source.productCode,
        timeframe: "1H",
        from: tacticalFrom,
        to: tacticalTo,
        now,
      });
      resolvedSymbol = hourly.resolvedSymbol || resolvedSymbol;
      resolver = hourly.resolver || resolver;
      const bars = hourly.bars || [];
      const latest = getLatestNormalizedBar(bars);
      const freshness = evaluateFreshness({
        latestTime: latest?.time,
        timeframe: ENGINE29_TIMEFRAMES.TACTICAL,
        now,
      });

      tactical = {
        timeframe: ENGINE29_TIMEFRAMES.TACTICAL,
        sourceTimeframe: "1H",
        count: bars.length,
        latest,
        bars,
        freshness,
        resolvedSymbol,
        productCode: source.productCode,
      };
    } catch (err) {
      errors.push(`TACTICAL: ${err.message}`);
    }
  }

  let fastTactical = null;
  if (includeFastTactical) {
    try {
      const thirtyMinute = await fetchEngine29FuturesProductBars({
        productCode: source.productCode,
        timeframe: "30m",
        from: fastTacticalFrom,
        to: fastTacticalTo,
        now,
      });
      resolvedSymbol = thirtyMinute.resolvedSymbol || resolvedSymbol;
      resolver = thirtyMinute.resolver || resolver;
      const bars = thirtyMinute.bars || [];
      const latest = getLatestNormalizedBar(bars);
      const freshness = evaluateFreshness({
        latestTime: latest?.time,
        timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
        now,
      });

      fastTactical = {
        timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
        sourceTimeframe: "30m",
        count: bars.length,
        latest,
        bars,
        freshness,
        resolvedSymbol,
        productCode: source.productCode,
      };
    } catch (err) {
      errors.push(`FAST_TACTICAL: ${err.message}`);
    }
  }

  return {
    canonicalSymbol: definition.canonicalSymbol,
    label: definition.label,
    group: definition.group,
    subgroup: definition.subgroup || null,
    stressDirection: definition.stressDirection,
    required: Boolean(definition.required),
    provider: "FRYE_FUTURES_PRODUCT",
    sourceSymbol: resolvedSymbol,
    sourceSeriesId: null,
    sourceProductCode: source.productCode,
    isProxy: false,
    proxyFor: null,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.DIRECT,
    available: Boolean(structural?.latest),
    structural,
    tactical,
    tacticalAvailable: Boolean(tactical?.latest),
    fastTactical,
    fastTacticalAvailable: Boolean(fastTactical?.latest),
    liveMonitor: null,
    liveMonitorAvailable: false,
    liveMonitorUnavailableReason: "NOT_WIRED_YET",
    resolver,
    errors,
  };
}

async function loadSource({
  definition,
  source,
  polygonApiKey,
  fredApiKey,
  structuralFrom,
  structuralTo,
  tacticalFrom,
  tacticalTo,
  fastTacticalFrom,
  fastTacticalTo,
  now,
  includeTactical,
  includeFastTactical,
}) {
  if (!source) {
    return buildUnavailableEntry({ definition, reason: "NO_VERIFIED_DATA_SOURCE" });
  }

  if (source.provider === "POLYGON") {
    return loadPolygonSymbol({
      definition,
      source,
      polygonApiKey,
      structuralFrom,
      structuralTo,
      tacticalFrom,
      tacticalTo,
      fastTacticalFrom,
      fastTacticalTo,
      liveMonitorFrom,
      liveMonitorTo,
      now,
      includeTactical,
      includeFastTactical,
      includeLiveMonitor,
    });
  }

  if (source.provider === "FRED") {
    return loadFredSymbol({
      definition,
      source,
      fredApiKey,
      structuralFrom,
      now,
    });
  }

  if (source.provider === "FRYE_FUTURES_PRODUCT") {
    return loadFuturesProductSymbol({
      definition,
      source,
      structuralFrom,
      structuralTo,
      tacticalFrom,
      tacticalTo,
      fastTacticalFrom,
      fastTacticalTo,
      liveMonitorFrom,
      liveMonitorTo,
      now,
      includeTactical,
      includeFastTactical,
      includeLiveMonitor,
    });
  }

  return buildUnavailableEntry({
    definition,
    reason: `UNSUPPORTED_PROVIDER:${source.provider}`,
  });
}

export async function buildEngine29MarketDataBundle({
  polygonApiKey = process.env.POLYGON_API_KEY,
  fredApiKey = process.env.FRED_API_KEY,
  now = Date.now(),
  structuralLookbackDays = 2200,
  tacticalLookbackDays = 45,
  fastTacticalLookbackDays = 30,
  liveMonitorLookbackDays = 3,
  includeOptionalSymbols = true,
  includeTactical = true,
  includeFastTactical = true,
  includeLiveMonitor = true,
} = {}) {
  const structuralTo = dateString(now);
  const structuralFrom = dateString(now - structuralLookbackDays * DAY_MS);
  const tacticalTo = structuralTo;
  const tacticalFrom = dateString(now - tacticalLookbackDays * DAY_MS);
  const fastTacticalTo = structuralTo;
  const fastTacticalFrom = dateString(now - fastTacticalLookbackDays * DAY_MS);
  const liveMonitorTo = structuralTo;
  const liveMonitorFrom = dateString(now - liveMonitorLookbackDays * DAY_MS);

  const definitions = Object.values(ENGINE29_SYMBOL_REGISTRY).filter(
    (definition) => includeOptionalSymbols || definition.required
  );

  const symbols = {};

  for (const definition of definitions) {
    const primary = definition.primary || null;
    const fallback = definition.fallback || null;

    let entry = await loadSource({
      definition,
      source: primary,
      polygonApiKey,
      fredApiKey,
      structuralFrom,
      structuralTo,
      tacticalFrom,
      tacticalTo,
      fastTacticalFrom,
      fastTacticalTo,
      now,
      includeTactical,
      includeFastTactical,
    });

    if (!entry?.available && fallback) {
      const primaryErrors = [...(entry?.errors || [])];
      const fallbackEntry = await loadSource({
        definition,
        source: fallback,
        polygonApiKey,
        fredApiKey,
        structuralFrom,
        structuralTo,
        tacticalFrom,
        tacticalTo,
        fastTacticalFrom,
        fastTacticalTo,
        liveMonitorFrom,
        liveMonitorTo,
        now,
        includeTactical,
        includeFastTactical,
        includeLiveMonitor,
      });

      entry = {
        ...fallbackEntry,
        fallbackUsed: true,
        primaryProvider: primary?.provider || null,
        primarySourceProductCode: primary?.productCode || null,
        primarySourceSymbol: primary?.symbol || null,
        errors: [
          ...primaryErrors.map((error) => `PRIMARY_FAILED: ${error}`),
          ...(fallbackEntry?.errors || []),
        ],
      };
    }

    symbols[definition.canonicalSymbol] = entry;
  }

  const values = Object.values(symbols);
  const missingRequiredSymbols = ENGINE29_REQUIRED_SYMBOLS.filter(
    (symbol) => !symbols[symbol]?.available
  );
  const staleRequiredSymbols = ENGINE29_REQUIRED_SYMBOLS.filter(
    (symbol) => symbols[symbol]?.structural?.freshness?.stale === true
  );
  const proxySymbols = values
    .filter((item) => item.isProxy)
    .map((item) => item.canonicalSymbol);
  const tacticalAvailableSymbols = values
    .filter((item) => item.tacticalAvailable)
    .map((item) => item.canonicalSymbol);
  const fastTacticalAvailableSymbols = values
    .filter((item) => item.fastTacticalAvailable)
    .map((item) => item.canonicalSymbol);
  const liveMonitorAvailableSymbols = values
    .filter((item) => item.liveMonitorAvailable)
    .map((item) => item.canonicalSymbol);

  const errors = values.flatMap((item) =>
    (item.errors || []).map((error) => ({
      canonicalSymbol: item.canonicalSymbol,
      error,
    }))
  );

  return {
    version: "engine29.marketDataBundle.v1",
    generatedAt: new Date(now).toISOString(),
    structuralTimeframe: ENGINE29_TIMEFRAMES.STRUCTURAL,
    tacticalTimeframe: ENGINE29_TIMEFRAMES.TACTICAL,
    fastTacticalTimeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
    liveMonitorTimeframe: "10m",
    sourceWindows: {
      structural: {
        sourceTimeframe: "1D",
        from: structuralFrom,
        to: structuralTo,
      },
      tactical: {
        sourceTimeframe: "1H",
        from: tacticalFrom,
        to: tacticalTo,
      },
      fastTactical: {
        sourceTimeframe: "30m",
        from: fastTacticalFrom,
        to: fastTacticalTo,
      },
      liveMonitor: {
        sourceTimeframe: "10m",
        from: liveMonitorFrom,
        to: liveMonitorTo,
      },
    },
    dataDegraded:
      missingRequiredSymbols.length > 0 || staleRequiredSymbols.length > 0,
    summary: {
      symbolsRequested: definitions.length,
      symbolsAvailable: values.filter((item) => item.available).length,
      requiredSymbols: ENGINE29_REQUIRED_SYMBOLS.length,
      missingRequiredSymbols,
      staleRequiredSymbols,
      proxySymbols,
      tacticalAvailableSymbols,
      fastTacticalAvailableSymbols,
      liveMonitorAvailableSymbols,
      errorCount: errors.length,
    },
    symbols,
    errors,
  };
}
render@srv-d2ds5nodl3ps73b7i2og-866d65df45-2krqp:~/project/src$ 
