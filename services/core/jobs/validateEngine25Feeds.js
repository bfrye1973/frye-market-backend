// services/core/jobs/validateEngine25Feeds.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  ENGINE25_FRED_SERIES,
  ENGINE25_POLYGON_SYMBOLS,
} from "../logic/engine25DataSources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const MACRO_FILE = path.join(DATA_DIR, "engine25-data-test.json");
const MARKET_FILE = path.join(DATA_DIR, "engine25-market-feeds-test.json");
const FMP_FILE = path.join(DATA_DIR, "engine25-fmp-feeds-test.json");

const OUTPUT_FILE = path.join(DATA_DIR, "engine25-feed-validation.json");

function readJsonSafe(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) {
      return {
        ok: false,
        missing: true,
        file,
        error: `Missing required file: ${file}`,
      };
    }

    return {
      ok: false,
      missing: true,
      file,
      error: `Optional file missing: ${file}`,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return {
      ok: false,
      file,
      error: `Invalid JSON: ${err.message}`,
    };
  }
}

function daysOld(dateLike) {
  if (!dateLike) return null;

  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function isNumber(value) {
  return Number.isFinite(Number(value));
}

function validateFred(macroData) {
  const errors = [];
  const warnings = [];
  const loaded = [];
  const missing = [];
  const stale = [];

  if (!macroData || macroData.ok !== true) {
    errors.push("Macro/FRED data file is not ok");
  }

  const latest = macroData?.sources?.fred?.latest || {};
  const fredErrors = macroData?.sources?.fred?.errors || [];

  for (const series of ENGINE25_FRED_SERIES) {
    const row = latest[series.id];

    if (!row || !isNumber(row.value)) {
      missing.push(series.id);
      continue;
    }

    loaded.push({
      id: series.id,
      label: series.label,
      component: series.component,
      date: row.date,
      value: Number(row.value),
      daysOld: daysOld(row.date),
    });

    const age = daysOld(row.date);

    // Daily/weekly/monthly data can be older depending on release schedule.
    // These are broad validation thresholds, not trading rules.
    if (["DGS10", "DGS2", "T10Y2Y", "T10Y3M", "BAMLH0A0HYM2", "RRPONTSYD"].includes(series.id)) {
      if (age !== null && age > 10) stale.push(series.id);
    } else if (["ICSA", "CCSA", "NFCI", "STLFSI4", "WALCL", "WRESBAL"].includes(series.id)) {
      if (age !== null && age > 21) stale.push(series.id);
    } else if (["UNRATE", "PAYEMS", "M2SL", "CPIAUCSL", "PPIACO"].includes(series.id)) {
      if (age !== null && age > 75) stale.push(series.id);
    }
  }

  if (fredErrors.length > 0) {
    errors.push(`FRED returned ${fredErrors.length} series error(s)`);
  }

  if (missing.length > 0) {
    errors.push(`Missing FRED series: ${missing.join(", ")}`);
  }

  if (stale.length > 0) {
    warnings.push(`Potential stale FRED series: ${stale.join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    source: "FRED",
    fileOk: macroData?.ok === true,
    seriesExpected: ENGINE25_FRED_SERIES.length,
    seriesLoaded: loaded.length,
    missingSeries: missing,
    staleSeries: stale,
    fredErrors,
    latest: loaded,
    errors,
    warnings,
  };
}

function validateFiscalData(macroData) {
  const errors = [];
  const warnings = [];

  const fiscal = macroData?.sources?.fiscalData;
  const tga =
    macroData?.quickRead?.liquidityConditions?.treasuryOperatingCashBalance ||
    fiscal?.latest;

  if (!fiscal?.ok) {
    errors.push("FiscalData block is not ok");
  }

  if (!tga) {
    errors.push("Missing Treasury Operating Cash Balance / TGA row");
  }

  const accountType = String(tga?.account_type || "");
  const effectiveBalance = Number(tga?.effective_balance);
  const recordDate = tga?.record_date || null;
  const age = daysOld(recordDate);

  if (!accountType.includes("Treasury General Account")) {
    errors.push(`Unexpected TGA account_type: ${accountType || "missing"}`);
  }

  if (!accountType.includes("Closing Balance")) {
    errors.push(`TGA row is not Closing Balance: ${accountType || "missing"}`);
  }

  if (!Number.isFinite(effectiveBalance)) {
    errors.push("TGA effective_balance is missing or invalid");
  }

  if (age !== null && age > 10) {
    warnings.push(`TGA latest date may be stale: ${recordDate}`);
  }

  if (fiscal?.balanceField && fiscal.balanceField !== "open_today_bal") {
    warnings.push(`TGA balanceField is ${fiscal.balanceField}; expected open_today_bal for current DTS shape`);
  }

  return {
    ok: errors.length === 0,
    source: "U.S. Treasury FiscalData",
    fileOk: macroData?.ok === true,
    dataset: fiscal?.dataset || null,
    table: fiscal?.table || null,
    endpoint: fiscal?.endpoint || null,
    validRows: fiscal?.validCount ?? null,
    selectedAccountType: fiscal?.selectedAccountType || tga?.account_type || null,
    balanceField: fiscal?.balanceField || null,
    latestDate: recordDate,
    daysOld: age,
    effectiveBalance: Number.isFinite(effectiveBalance) ? effectiveBalance : null,
    latest: tga || null,
    errors,
    warnings,
  };
}

function validatePolygon(marketData) {
  const errors = [];
  const warnings = [];
  const loaded = [];
  const failed = [];

  if (!marketData || marketData.ok !== true) {
    errors.push("Polygon market feed file is not ok");
  }

  const polygon = marketData?.sources?.polygon;
  const polygonErrors = polygon?.errors || [];

  const groups = marketData?.quickRead || {};

  function findSymbol(symbol) {
    for (const groupName of Object.keys(groups)) {
      const item = groups[groupName]?.[symbol];
      if (item) return item;
    }
    return null;
  }

  for (const item of ENGINE25_POLYGON_SYMBOLS) {
    const row = findSymbol(item.symbol);

    if (!row || row.ok !== true) {
      failed.push(item.symbol);
      continue;
    }

    loaded.push({
      symbol: item.symbol,
      label: item.label,
      component: item.component,
      latestDate: row.latestDate,
      daysOld: daysOld(row.latestDate),
      close: row.close,
      aboveEma10: row.aboveEma10,
      aboveEma20: row.aboveEma20,
      aboveEma50: row.aboveEma50,
      aboveEma200: row.aboveEma200,
      pctChange5d: row.pctChange5d,
      pctChange20d: row.pctChange20d,
      pctChange50d: row.pctChange50d,
    });

    const age = daysOld(row.latestDate);
    if (age !== null && age > 7) {
      warnings.push(`${item.symbol} latest market date may be stale: ${row.latestDate}`);
    }
  }

  if (polygonErrors.length > 0) {
    errors.push(`Polygon returned ${polygonErrors.length} symbol error(s)`);
  }

  if (failed.length > 0) {
    errors.push(`Missing Polygon symbols: ${failed.join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    source: "Polygon",
    fileOk: marketData?.ok === true,
    symbolsExpected: ENGINE25_POLYGON_SYMBOLS.length,
    symbolsLoaded: loaded.length,
    failedSymbols: failed,
    polygonErrors,
    latestDates: loaded.map((x) => ({
      symbol: x.symbol,
      latestDate: x.latestDate,
      daysOld: x.daysOld,
    })),
    sanity: {
      SPY: loaded.find((x) => x.symbol === "SPY") || null,
      QQQ: loaded.find((x) => x.symbol === "QQQ") || null,
      IWM: loaded.find((x) => x.symbol === "IWM") || null,
      UVXY: loaded.find((x) => x.symbol === "UVXY") || null,
      NVDA: loaded.find((x) => x.symbol === "NVDA") || null,
      SMH: loaded.find((x) => x.symbol === "SMH") || null,
    },
    errors,
    warnings,
  };
}

function validateFmp(fmpData) {
  const errors = [];
  const warnings = [];

  if (!fmpData || fmpData.missing) {
    warnings.push("FMP file is missing. Event risk will be limited.");
    return {
      ok: false,
      optional: true,
      source: "FMP",
      fileOk: false,
      errors: [],
      warnings,
    };
  }

  if (fmpData.ok !== true) {
    errors.push("FMP feed file is not ok");
  }

  const fmp = fmpData?.sources?.fmp;

  const earningsCount = fmp?.earningsCalendar?.count ?? 0;
  const economicCount = fmp?.economicCalendar?.count ?? 0;
  const newsCount = fmp?.stockNews?.count ?? 0;

  if (!fmp?.earningsCalendar?.ok) errors.push("FMP earnings calendar failed");
  if (!fmp?.economicCalendar?.ok) errors.push("FMP economic calendar failed");
  if (!fmp?.stockNews?.ok) errors.push("FMP stock news failed");

  if (earningsCount === 0) warnings.push("FMP earnings calendar returned zero rows");
  if (economicCount === 0) warnings.push("FMP economic calendar returned zero rows");
  if (newsCount === 0) warnings.push("FMP stock news returned zero rows");

  const economicSample = fmpData?.quickRead?.economicCalendar || [];
  const earningsSample = fmpData?.quickRead?.earningsCalendar || [];
  const newsSample = fmpData?.quickRead?.stockNews || [];

  const usHighImpactSample = economicSample
    .filter((event) => event.country === "US" && String(event.impact).toLowerCase() === "high")
    .slice(0, 10);

  return {
    ok: errors.length === 0,
    optional: true,
    source: "FMP",
    fileOk: fmpData?.ok === true,
    earningsCalendar: {
      ok: fmp?.earningsCalendar?.ok ?? false,
      count: earningsCount,
      from: fmp?.earningsCalendar?.from || null,
      to: fmp?.earningsCalendar?.to || null,
    },
    economicCalendar: {
      ok: fmp?.economicCalendar?.ok ?? false,
      count: economicCount,
      from: fmp?.economicCalendar?.from || null,
      to: fmp?.economicCalendar?.to || null,
      usHighImpactSample,
    },
    stockNews: {
      ok: fmp?.stockNews?.ok ?? false,
      count: newsCount,
      sample: newsSample.slice(0, 5),
    },
    earningsSample: earningsSample.slice(0, 5),
    errors,
    warnings,
  };
}

function main() {
  const startedAt = new Date().toISOString();

  const macroData = readJsonSafe(MACRO_FILE, true);
  const marketData = readJsonSafe(MARKET_FILE, true);
  const fmpData = readJsonSafe(FMP_FILE, false);

  const fred = validateFred(macroData);
  const fiscalData = validateFiscalData(macroData);
  const polygon = validatePolygon(marketData);
  const fmp = validateFmp(fmpData);

  const requiredOk = fred.ok && fiscalData.ok && polygon.ok;

  const warnings = [
    ...fred.warnings,
    ...fiscalData.warnings,
    ...polygon.warnings,
    ...fmp.warnings,
  ];

  const errors = [
    ...fred.errors.map((error) => `FRED: ${error}`),
    ...fiscalData.errors.map((error) => `FiscalData: ${error}`),
    ...polygon.errors.map((error) => `Polygon: ${error}`),
    ...fmp.errors.map((error) => `FMP: ${error}`),
  ];

  const output = {
    ok: requiredOk,
    engine: "engine25.feedValidation.v0.1",
    startedAt,
    finishedAt: new Date().toISOString(),
    requiredSourcesOk: requiredOk,
    optionalSourcesOk: {
      fmp: fmp.ok,
    },
    sources: {
      fred,
      fiscalData,
      polygon,
      fmp,
    },
    errors,
    warnings,
    gate: {
      canScoreEngine25: requiredOk,
      reason: requiredOk
        ? "Required Engine 25 feeds are valid."
        : "Do not score Engine 25. One or more required feeds failed validation.",
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("========================================");
  console.log("Engine 25 Feed Validation Complete");
  console.log("OK:", output.ok);
  console.log("Can score:", output.gate.canScoreEngine25);
  console.log("Errors:", output.errors.length);
  console.log("Warnings:", output.warnings.length);
  console.log("Wrote:", OUTPUT_FILE);
  console.log("========================================");

  console.log(
    JSON.stringify(
      {
        ok: output.ok,
        canScoreEngine25: output.gate.canScoreEngine25,
        fredLoaded: fred.seriesLoaded,
        fiscalLatestDate: fiscalData.latestDate,
        fiscalBalance: fiscalData.effectiveBalance,
        polygonLoaded: polygon.symbolsLoaded,
        fmpOk: fmp.ok,
        errors: output.errors,
        warnings: output.warnings.slice(0, 10),
      },
      null,
      2
    )
  );

  if (!output.ok) {
    process.exit(1);
  }
}

main();
