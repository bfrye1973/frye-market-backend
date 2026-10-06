// services/core/logic/engine25Engine29Parity.js
// Engine 25 ↔ Engine 29 parity diagnostics v0.2
//
// READ-ONLY DIAGNOSTIC LAYER.
// This module does NOT create or modify:
// - Engine 25 state
// - severity
// - equityImpact
// - marketConfirmation
// - macroShock
// - Engine 6 permission
//
// Purpose:
// Compare Engine 25's current live-macro inputs against the canonical
// Engine 29 cross-market reaction package during the transition period.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const ENGINE29_FILE = path.join(DATA_DIR, "engine29-cross-market-stress.json");
const ENGINE25_MARKET_HEALTH_FILE = path.join(DATA_DIR, "engine25-market-health.json");

export const ENGINE25_ENGINE29_PARITY_VERSION =
  "engine25.engine29Parity.v0.2";

export const PARITY_RESULTS = Object.freeze({
  MATCH: "MATCH",
  MINOR_DIFFERENCE: "MINOR_DIFFERENCE",
  MATERIAL_DIFFERENCE: "MATERIAL_DIFFERENCE",
  STALE_OR_DEGRADED: "STALE_OR_DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
});

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoFromUnixSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, data: null, error: `FILE_MISSING:${path.basename(filePath)}` };
    }

    return {
      ok: true,
      data: JSON.parse(fs.readFileSync(filePath, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: `FILE_INVALID:${path.basename(filePath)}:${error?.message || String(error)}`,
    };
  }
}

function ageMinutesFromIso(value, nowMs) {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Number(((nowMs - ms) / 60000).toFixed(2)));
}

function engine25LiveSnapshot(read = {}, nowMs) {
  const asOfUtc =
    read?.asOfUtc ||
    isoFromUnixSeconds(read?.asOfUnix) ||
    null;

  return {
    source: read?.sourceType || null,
    symbol: read?.symbol || null,
    productCode: read?.productCode || null,
    resolvedContract: read?.resolvedContract || null,
    value: num(read?.price),
    timestamp: asOfUtc,
    ageMinutes: ageMinutesFromIso(asOfUtc, nowMs),
    freshness: asOfUtc ? "TIMESTAMP_PRESENT" : "UNAVAILABLE",
    timeframe: "5m/10m → 30m/60m/session",
    changesPct: read?.changesPct || null,
  };
}

function engine25FredSnapshot({
  value = null,
  observationDate = null,
  label = null,
} = {}) {
  return {
    source: "FRED_SLOW_CONTEXT",
    symbol: label,
    value: num(value),
    timestamp: observationDate || null,
    freshness: observationDate ? "OFFICIAL_DAILY_OBSERVATION" : "UNAVAILABLE",
    timeframe: "DAILY / STRUCTURAL",
  };
}

function getEngine29Symbol(engine29, symbol) {
  return engine29?.symbols?.[symbol] || null;
}

function getEngine29Layer(symbolEntry, layerName) {
  return symbolEntry?.[layerName] || null;
}

function engine29Snapshot(engine29, symbol, layerName) {
  const entry = getEngine29Symbol(engine29, symbol);
  const layer = getEngine29Layer(entry, layerName);

  return {
    source: entry?.provider || null,
    symbol: entry?.sourceSymbol || symbol,
    sourceSeriesId: entry?.sourceSeriesId || null,
    value: num(layer?.latest?.close),
    timestamp:
      layer?.latest?.time ??
      layer?.latest?.timestamp ??
      null,
    freshness: layer?.freshness || null,
    timeframe:
      layerName === "structural"
        ? "1W / STRUCTURAL"
        : layerName === "tactical"
          ? "1H"
          : layerName === "fastTactical"
            ? "30m"
            : layerName,
    normalizedState: layer?.state || null,
    evidenceQuality: entry?.evidenceQuality || null,
  };
}

function isEngine29SymbolStaleOrUnavailable(engine29, symbol, layerName) {
  const snapshot = engine29Snapshot(engine29, symbol, layerName);
  const freshness = snapshot?.freshness;

  const stale =
    freshness?.stale === true ||
    String(freshness?.reason || "").toUpperCase().includes("STALE");

  const symbolMissing =
    !getEngine29Symbol(engine29, symbol) ||
    snapshot.value === null;

  return stale || symbolMissing;
}

function engine29GroupQuality(engine29, groupName) {
  const degradedGroups = Array.isArray(engine29?.dataQuality?.degradedGroups)
    ? engine29.dataQuality.degradedGroups
    : [];

  const degraded = degradedGroups.some(
    (group) => String(group || "").toLowerCase() === String(groupName || "").toLowerCase()
  );

  return {
    group: groupName || null,
    status: degraded ? "DEGRADED" : "OK",
    degraded,
  };
}

function comparePercentValues(a, b, {
  matchPct = 0.15,
  minorPct = 0.75,
} = {}) {
  const aa = num(a);
  const bb = num(b);

  if (aa === null || bb === null) {
    return {
      result: PARITY_RESULTS.UNAVAILABLE,
      absoluteDifference: null,
      percentDifference: null,
    };
  }

  const denominator = Math.max(Math.abs(aa), Math.abs(bb), 1e-9);
  const absoluteDifference = Math.abs(aa - bb);
  const percentDifference = (absoluteDifference / denominator) * 100;

  let result = PARITY_RESULTS.MATERIAL_DIFFERENCE;
  if (percentDifference <= matchPct) result = PARITY_RESULTS.MATCH;
  else if (percentDifference <= minorPct) {
    result = PARITY_RESULTS.MINOR_DIFFERENCE;
  }

  return {
    result,
    absoluteDifference: Number(absoluteDifference.toFixed(6)),
    percentDifference: Number(percentDifference.toFixed(4)),
  };
}

function compareYieldValues(a, b) {
  const aa = num(a);
  const bb = num(b);

  if (aa === null || bb === null) {
    return {
      result: PARITY_RESULTS.UNAVAILABLE,
      absoluteDifference: null,
      basisPointDifference: null,
    };
  }

  const absoluteDifference = Math.abs(aa - bb);
  const basisPointDifference = absoluteDifference * 100;

  let result = PARITY_RESULTS.MATERIAL_DIFFERENCE;
  if (basisPointDifference <= 2) result = PARITY_RESULTS.MATCH;
  else if (basisPointDifference <= 10) {
    result = PARITY_RESULTS.MINOR_DIFFERENCE;
  }

  return {
    result,
    absoluteDifference: Number(absoluteDifference.toFixed(4)),
    basisPointDifference: Number(basisPointDifference.toFixed(2)),
  };
}

function wrapComparison({
  engine25,
  engine29,
  comparison,
  engine29SymbolStaleOrUnavailable = false,
  groupQuality = null,
  note = null,
} = {}) {
  const result = engine29SymbolStaleOrUnavailable
    ? PARITY_RESULTS.STALE_OR_DEGRADED
    : comparison?.result || PARITY_RESULTS.UNAVAILABLE;

  return {
    result,
    groupQuality,
    engine25,
    engine29,
    difference: comparison
      ? Object.fromEntries(
          Object.entries(comparison).filter(([key]) => key !== "result")
        )
      : null,
    note,
  };
}

function marketHealthSymbol(marketHealth, component, symbol) {
  return (
    marketHealth?.components?.[component]?.inputs?.[symbol] ||
    null
  );
}

function engine25DailyMarketSnapshot(item, symbol) {
  if (!item) {
    return {
      source: "ENGINE25_MARKET_HEALTH",
      symbol,
      value: null,
      timestamp: null,
      freshness: "UNAVAILABLE",
      timeframe: "DAILY MARKET HEALTH",
    };
  }

  return {
    source: "ENGINE25_MARKET_HEALTH",
    symbol,
    value: num(item?.close ?? item?.latest?.close),
    timestamp: item?.latestDate || item?.date || null,
    freshness: item?.ok === true ? "AVAILABLE" : "UNAVAILABLE",
    timeframe: "DAILY MARKET HEALTH",
    aboveEma10: item?.aboveEma10 ?? null,
    aboveEma20: item?.aboveEma20 ?? null,
    aboveEma50: item?.aboveEma50 ?? null,
    aboveEma200: item?.aboveEma200 ?? null,
  };
}

function compareCreditSymbol({
  engine29,
  marketHealth,
  symbol,
  engine29Layer = "tactical",
} = {}) {
  const engine25Item =
    marketHealthSymbol(marketHealth, "creditFragility", symbol) ||
    (symbol === "IWM"
      ? marketHealthSymbol(marketHealth, "marketTrend", symbol)
      : null);

  const left = engine25DailyMarketSnapshot(engine25Item, symbol);
  const right = engine29Snapshot(engine29, symbol, engine29Layer);

  const degraded = isEngine29SymbolStaleOrUnavailable(
    engine29,
    symbol,
    engine29Layer,
    "credit"
  );

  return wrapComparison({
    engine25: left,
    engine29: right,
    comparison: comparePercentValues(left.value, right.value, {
      matchPct: 0.25,
      minorPct: 1.0,
    }),
    engine29SymbolStaleOrUnavailable: degraded,
    groupQuality: engine29GroupQuality(engine29, "credit"),
    note:
      "Engine 25 uses daily market-health structure while Engine 29 tactical uses 1H reaction. Price parity is diagnostic only; normalized reaction authority remains separate during Phase 1.",
  });
}

export function buildEngine25Engine29Parity({
  now = new Date(),
  engine25 = {},
  engine29File = ENGINE29_FILE,
  engine25MarketHealthFile = ENGINE25_MARKET_HEALTH_FILE,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();

  const engine29Read = readJson(engine29File);
  const marketHealthRead = readJson(engine25MarketHealthFile);

  if (!engine29Read.ok || !engine29Read.data) {
    return {
      ok: false,
      version: ENGINE25_ENGINE29_PARITY_VERSION,
      mode: "READ_ONLY_DIAGNOSTIC",
      result: PARITY_RESULTS.UNAVAILABLE,
      generatedAtUtc: new Date(safeNowMs).toISOString(),
      error: engine29Read.error,
      authorityChanged: false,
      macroShockChanged: false,
      comparisons: {},
    };
  }

  const e29 = engine29Read.data;
  const marketHealth = marketHealthRead.data || {};

  const wti25 = engine25LiveSnapshot(engine25?.wti, safeNowMs);
  const wti29 = engine29Snapshot(e29, "WTI", "fastTactical");

  const brent25 = engine25LiveSnapshot(engine25?.brent, safeNowMs);
  const brent29 = engine29Snapshot(e29, "BRENT", "fastTactical");

  const tlt25 = engine25LiveSnapshot(engine25?.tlt, safeNowMs);
  const tlt29 = engine29Snapshot(e29, "TLT", "tactical");

  const dgs1025 = engine25FredSnapshot({
    value: engine25?.slowContext?.tenYearYield,
    observationDate: engine25?.slowContext?.tenYearObservationDate,
    label: "DGS10",
  });
  const dgs1029 = engine29Snapshot(e29, "US10Y", "structural");

  const dgs3025 = engine25FredSnapshot({
    value: engine25?.slowContext?.thirtyYearYield,
    observationDate: engine25?.slowContext?.thirtyYearObservationDate,
    label: "DGS30",
  });
  const dgs3029 = engine29Snapshot(e29, "US30Y", "structural");

  const comparisons = {
    oil: {
      wti: wrapComparison({
        engine25: wti25,
        engine29: wti29,
        comparison: comparePercentValues(wti25.value, wti29.value),
        engine29SymbolStaleOrUnavailable: isEngine29SymbolStaleOrUnavailable(
          e29,
          "WTI",
          "fastTactical"
        ),
        groupQuality: engine29GroupQuality(e29, "energyInflation"),
        note: "Engine25 CL vs Engine29 WTI/CL.",
      }),

      brent: wrapComparison({
        engine25: brent25,
        engine29: brent29,
        comparison: comparePercentValues(brent25.value, brent29.value),
        engine29SymbolStaleOrUnavailable: isEngine29SymbolStaleOrUnavailable(
          e29,
          "BRENT",
          "fastTactical"
        ),
        groupQuality: engine29GroupQuality(e29, "energyInflation"),
        note: "Engine25 BZ vs Engine29 BRENT/BZ.",
      }),

      engine29Group: {
        structural1wState: e29?.groups?.energyInflation?.structural?.state ?? null,
        tactical1hState: e29?.groups?.energyInflation?.tactical?.state ?? null,
        tacticalDirectionalState:
          e29?.groups?.energyInflation?.tactical?.directionalState ?? null,
        fast30mState:
          e29?.groups?.energyInflation?.fastTactical?.state ?? null,
        fastDirectionalState:
          e29?.groups?.energyInflation?.fastTactical?.directionalState ?? null,
      },
    },

    duration: {
      tlt: wrapComparison({
        engine25: tlt25,
        engine29: tlt29,
        comparison: comparePercentValues(tlt25.value, tlt29.value, {
          matchPct: 0.2,
          minorPct: 0.8,
        }),
        engine29SymbolStaleOrUnavailable: isEngine29SymbolStaleOrUnavailable(
          e29,
          "TLT",
          "tactical"
        ),
        groupQuality: engine29GroupQuality(e29, "ratesDuration"),
        note: "Engine25 5m/10m TLT vs Engine29 1H TLT. Diagnostic timeframe mismatch is preserved.",
      }),
    },

    rates: {
      dgs10: wrapComparison({
        engine25: dgs1025,
        engine29: dgs1029,
        comparison: compareYieldValues(dgs1025.value, dgs1029.value),
        engine29SymbolStaleOrUnavailable: isEngine29SymbolStaleOrUnavailable(
          e29,
          "US10Y",
          "structural"
        ),
        groupQuality: engine29GroupQuality(e29, "ratesDuration"),
        note: "Both are slow official-yield context. Engine25 ZN remains separate live Treasury evidence.",
      }),

      dgs30: wrapComparison({
        engine25: dgs3025,
        engine29: dgs3029,
        comparison: compareYieldValues(dgs3025.value, dgs3029.value),
        engine29SymbolStaleOrUnavailable: isEngine29SymbolStaleOrUnavailable(
          e29,
          "US30Y",
          "structural"
        ),
        groupQuality: engine29GroupQuality(e29, "ratesDuration"),
        note: "Both are slow official-yield context. Engine25 ZB remains separate live Treasury evidence.",
      }),

      engine25LiveTreasuryOnly: {
        zn: engine25LiveSnapshot(engine25?.zn, safeNowMs),
        zb: engine25LiveSnapshot(engine25?.zb, safeNowMs),
        note:
          "ZN/ZB remain Engine25-only live Treasury-futures evidence during Phase 1 because Engine29 does not currently publish them.",
      },

      engine29Group: {
        structural1wState: e29?.groups?.ratesDuration?.structural?.state ?? null,
        tactical1hState: e29?.groups?.ratesDuration?.tactical?.state ?? null,
        fast30mState: e29?.groups?.ratesDuration?.fastTactical?.state ?? null,
      },
    },

    credit: {
      hyg: compareCreditSymbol({
        engine29: e29,
        marketHealth,
        symbol: "HYG",
      }),
      jnk: compareCreditSymbol({
        engine29: e29,
        marketHealth,
        symbol: "JNK",
      }),
      lqd: compareCreditSymbol({
        engine29: e29,
        marketHealth,
        symbol: "LQD",
      }),
      kre: compareCreditSymbol({
        engine29: e29,
        marketHealth,
        symbol: "KRE",
      }),
      iwm: {
        result: PARITY_RESULTS.UNAVAILABLE,
        engine25: engine25DailyMarketSnapshot(
          marketHealthSymbol(marketHealth, "marketTrend", "IWM"),
          "IWM"
        ),
        engine29: null,
        note:
          "IWM participates in Engine25 Credit Fragility but is not required as a canonical member of Engine29 groups.credit. Do not force a false one-to-one parity comparison.",
      },
      engine29Group: {
        structural1wState: e29?.groups?.credit?.structural?.state ?? null,
        tactical1hState: e29?.groups?.credit?.tactical?.state ?? null,
        fast30mState: e29?.groups?.credit?.fastTactical?.state ?? null,
      },
    },

    volatility: {
      result: PARITY_RESULTS.UNAVAILABLE,
      engine25: engine25DailyMarketSnapshot(
        marketHealthSymbol(marketHealth, "volatility", "UVXY"),
        "UVXY"
      ),
      engine29: engine29Snapshot(e29, "VIX", "fastTactical"),
      note:
        "Engine25 currently uses UVXY while Engine29 uses direct I:VIX. These are intentionally non-equivalent instruments, so numeric parity is not asserted. Engine29 direct VIX is observed only during Phase 1.",
      engine29Group: {
        structural1wState: e29?.groups?.volatility?.structural?.state ?? null,
        tactical1hState: e29?.groups?.volatility?.tactical?.state ?? null,
        fast30mState: e29?.groups?.volatility?.fastTactical?.state ?? null,
      },
    },
  };

  const flatResults = [
    comparisons.oil.wti.result,
    comparisons.oil.brent.result,
    comparisons.duration.tlt.result,
    comparisons.rates.dgs10.result,
    comparisons.rates.dgs30.result,
    comparisons.credit.hyg.result,
    comparisons.credit.jnk.result,
    comparisons.credit.lqd.result,
    comparisons.credit.kre.result,
  ];

  let overallResult = PARITY_RESULTS.MATCH;

  if (flatResults.includes(PARITY_RESULTS.STALE_OR_DEGRADED)) {
    overallResult = PARITY_RESULTS.STALE_OR_DEGRADED;
  } else if (flatResults.includes(PARITY_RESULTS.MATERIAL_DIFFERENCE)) {
    overallResult = PARITY_RESULTS.MATERIAL_DIFFERENCE;
  } else if (flatResults.includes(PARITY_RESULTS.MINOR_DIFFERENCE)) {
    overallResult = PARITY_RESULTS.MINOR_DIFFERENCE;
  } else if (
    flatResults.length === 0 ||
    flatResults.every((result) => result === PARITY_RESULTS.UNAVAILABLE)
  ) {
    overallResult = PARITY_RESULTS.UNAVAILABLE;
  }

  const degradedGroups = Array.isArray(e29?.dataQuality?.degradedGroups)
    ? e29.dataQuality.degradedGroups
    : [];

  return {
    ok: true,
    version: "engine25.engine29Parity.v0.2",
    mode: "READ_ONLY_DIAGNOSTIC",
    generatedAtUtc: new Date(safeNowMs).toISOString(),

    result: overallResult,
    dataParity: overallResult,
    engine29Quality: e29?.dataDegraded === true ? "DEGRADED" : "OK",
    degradedGroups,

    authorityChanged: false,
    engine25StillAuthoritative: true,
    macroShockChanged: false,
    marketConfirmationChanged: false,
    scoringChanged: false,

    engine29: {
      engine: e29?.engine || null,
      generatedAtUtc: e29?.generatedAtUtc || null,
      overallState: e29?.overallState || null,
      tacticalState: e29?.tacticalState || null,
      fastTacticalState: e29?.fastTacticalState || null,
      dataDegraded: e29?.dataDegraded === true,
      degradedGroups,
      missingConfirmations: Array.isArray(e29?.missingConfirmations)
        ? e29.missingConfirmations
        : [],
    },

    comparisons,

    diagnostics: {
      engine29File,
      engine25MarketHealthFile,
      engine29FileReadOk: engine29Read.ok,
      engine25MarketHealthFileReadOk: marketHealthRead.ok,
      engine25MarketHealthFileError: marketHealthRead.error,
    },

    note:
      "Phase 1 parity only. Engine29 observations cannot modify Engine25 state, severity, equityImpact, marketConfirmation, macroShock, scoring, or permission.",
  };
}

export default buildEngine25Engine29Parity;
