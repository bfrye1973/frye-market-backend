// services/core/logic/engine29/data/buildMarketDataBundle.js

import {
  ENGINE29_EVIDENCE_QUALITY,
  ENGINE29_TIMEFRAMES,
} from "../constants.js";
import {
  ENGINE29_SYMBOL_REGISTRY,
  ENGINE29_REQUIRED_SYMBOLS,
} from "../symbolRegistry.js";
import { normalizeFredObservations, normalizePolygonBars, getLatestNormalizedBar } from "./normalizeMarketBars.js";
import { evaluateFreshness } from "./validateFreshness.js";
import {
  fetchEngine29PolygonDaily,
  fetchEngine29PolygonHourly,
} from "./providers/polygonMarketData.js";
import { fetchEngine29FredDaily } from "./providers/fredMarketData.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function resolveConfiguredSource(definition) {
  if (!definition) return null;

  if (definition.primary?.provider !== "PENDING_DIRECT_FEED_VERIFICATION") {
    return definition.primary || null;
  }

  return definition.fallback || definition.primary || null;
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
    isProxy: false,
    proxyFor: null,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.MISSING,
    available: false,
    structural: null,
    tactical: null,
    errors: [reason],
  };
}

function sourceMetadata(source) {
  return {
    provider: source?.provider || null,
    sourceSymbol: source?.symbol || null,
    sourceSeriesId: source?.seriesId || null,
    isProxy: Boolean(source?.isProxy),
    proxyFor: source?.proxyFor || null,
    evidenceQuality: source?.evidenceQuality || ENGINE29_EVIDENCE_QUALITY.MISSING,
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
  now,
  includeTactical,
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

  const meta = sourceMetadata(source);
  const structuralAvailable = Boolean(structural?.latest);
  const tacticalAvailable = Boolean(tactical?.latest);

  return {
    canonicalSymbol: definition.canonicalSymbol,
    label: definition.label,
    group: definition.group,
    subgroup: definition.subgroup || null,
    stressDirection: definition.stressDirection,
    required: Boolean(definition.required),
    ...meta,
    available: structuralAvailable,
    structural,
    tactical,
    tacticalAvailable,
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
    errors,
  };
}

export async function buildEngine29MarketDataBundle({
  polygonApiKey = process.env.POLYGON_API_KEY,
  fredApiKey = process.env.FRED_API_KEY,
  now = Date.now(),
  structuralLookbackDays = 1400,
  tacticalLookbackDays = 45,
  includeOptionalSymbols = true,
  includeTactical = true,
} = {}) {
  const structuralTo = dateString(now);
  const structuralFrom = dateString(now - structuralLookbackDays * DAY_MS);
  const tacticalTo = structuralTo;
  const tacticalFrom = dateString(now - tacticalLookbackDays * DAY_MS);

  const definitions = Object.values(ENGINE29_SYMBOL_REGISTRY).filter(
    (definition) => includeOptionalSymbols || definition.required
  );

  const symbols = {};

  for (const definition of definitions) {
    const source = resolveConfiguredSource(definition);

    if (!source || source.provider === "PENDING_DIRECT_FEED_VERIFICATION") {
      symbols[definition.canonicalSymbol] = buildUnavailableEntry({
        definition,
        reason: "NO_VERIFIED_DATA_SOURCE",
      });
      continue;
    }

    if (source.provider === "POLYGON") {
      symbols[definition.canonicalSymbol] = await loadPolygonSymbol({
        definition,
        source,
        polygonApiKey,
        structuralFrom,
        structuralTo,
        tacticalFrom,
        tacticalTo,
        now,
        includeTactical,
      });
      continue;
    }

    if (source.provider === "FRED") {
      symbols[definition.canonicalSymbol] = await loadFredSymbol({
        definition,
        source,
        fredApiKey,
        structuralFrom,
        now,
      });
      continue;
    }

    symbols[definition.canonicalSymbol] = buildUnavailableEntry({
      definition,
      reason: `UNSUPPORTED_PROVIDER:${source.provider}`,
    });
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
      errorCount: errors.length,
    },
    symbols,
    errors,
  };
}
