// services/core/jobs/buildEngine25HistoricalMacroFeeds6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  ENGINE25_FRED_SERIES,
  fetchEngine25FredBundle,
  fetchFiscalDataOperatingCashBalance,
} from "../logic/engine25DataSources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const REPLAY_BASE_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-macro-feeds-6mo.json"
);

const ENGINE_NAME = "engine25.historicalMacroFeeds.v0.3";
const MODEL_TYPE = "FRED_FISCALDATA_RAW_MAPPING_WITH_MACRO_SCORES";

const FRED_OBSERVATION_START = "2015-01-01";
const FISCALDATA_RECORD_START = "2015-01-01";

const KEY_VALIDATION_SERIES = [
  "DGS10",
  "NFCI",
  "BAMLH0A0HYM2",
  "CPIAUCSL",
  "UNRATE",
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizeReplayRows(baseReplay) {
  if (Array.isArray(baseReplay)) return baseReplay;
  if (Array.isArray(baseReplay?.rows)) return baseReplay.rows;

  throw new Error(
    "Base replay file does not contain a rows array or top-level array."
  );
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isNum(value) {
  return Number.isFinite(Number(value));
}

function scoreInverse(value, goodBelow, badAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n <= goodBelow) return 100;
  if (n >= badAbove) return 0;
  return clamp(100 - ((n - goodBelow) / (badAbove - goodBelow)) * 100);
}

function scoreDirect(value, badBelow, goodAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n >= goodAbove) return 100;
  if (n <= badBelow) return 0;
  return clamp(((n - badBelow) / (goodAbove - badBelow)) * 100);
}

function weightedAvg(items) {
  const valid = items.filter(
    (item) =>
      item &&
      Number.isFinite(Number(item.value)) &&
      Number.isFinite(Number(item.weight)) &&
      Number(item.weight) > 0
  );

  if (!valid.length) return 50;

  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  const weightedSum = valid.reduce(
    (sum, item) => sum + Number(item.value) * Number(item.weight),
    0
  );

  return clamp(weightedSum / totalWeight);
}

function getReplayDate(row) {
  return row?.date || row?.tradingDate || row?.day || null;
}

function getReplayTime(row) {
  return row?.time || row?.timestamp || row?.dateTime || null;
}

function getEsClose(row) {
  return (
    safeNumber(row?.esClose) ??
    safeNumber(row?.ESClose) ??
    safeNumber(row?.close) ??
    safeNumber(row?.es?.close) ??
    safeNumber(row?.ohlc?.close) ??
    null
  );
}

function cleanFredObservation(obs) {
  if (!obs) {
    return {
      observationDate: null,
      value: null,
      rawValue: null,
      realtime_start: null,
      realtime_end: null,
    };
  }

  return {
    observationDate: obs.date || null,
    value: Number.isFinite(obs.value) ? obs.value : null,
    rawValue: obs.rawValue ?? null,
    realtime_start: obs.realtime_start ?? null,
    realtime_end: obs.realtime_end ?? null,
  };
}

function cleanTgaRow(row) {
  if (!row) {
    return {
      recordDate: null,
      accountType: null,
      balanceField: null,
      effectiveBalance: null,
      close_today_bal: null,
      open_today_bal: null,
      table_nm: null,
      sub_table_name: null,
      src_line_nbr: null,
    };
  }

  return {
    recordDate: row.record_date || null,
    accountType: row.account_type || null,
    balanceField:
      row.close_today_bal !== null && row.close_today_bal !== undefined
        ? "close_today_bal"
        : "open_today_bal",
    effectiveBalance: Number.isFinite(row.effective_balance)
      ? row.effective_balance
      : null,
    close_today_bal: Number.isFinite(row.close_today_bal)
      ? row.close_today_bal
      : null,
    open_today_bal: Number.isFinite(row.open_today_bal)
      ? row.open_today_bal
      : null,
    table_nm: row.table_nm || null,
    sub_table_name: row.sub_table_name || null,
    src_line_nbr: row.src_line_nbr || null,
  };
}

function buildSeriesLookup(fredBundle) {
  const lookup = {};

  for (const series of ENGINE25_FRED_SERIES) {
    const block = fredBundle?.results?.[series.id];

    const observations = Array.isArray(block?.observations)
      ? block.observations
          .filter(
            (obs) =>
              obs &&
              typeof obs.date === "string" &&
              Number.isFinite(obs.value)
          )
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      : [];

    lookup[series.id] = {
      id: series.id,
      label: series.label,
      component: series.component,
      ok: Boolean(block?.ok),
      error: block?.error || null,
      count: Array.isArray(block?.observations) ? block.observations.length : 0,
      validCount: observations.length,
      observations,
    };
  }

  return lookup;
}

function buildTgaLookup(fiscalDataBundle) {
  const rows = Array.isArray(fiscalDataBundle?.rows)
    ? fiscalDataBundle.rows
        .filter(
          (row) =>
            row &&
            typeof row.record_date === "string" &&
            Number.isFinite(row.effective_balance)
        )
        .sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)))
    : [];

  return {
    ok: Boolean(fiscalDataBundle?.ok),
    source: fiscalDataBundle?.source || "U.S. Treasury FiscalData",
    dataset: fiscalDataBundle?.dataset || "Daily Treasury Statement",
    endpoint: fiscalDataBundle?.endpoint || "/v1/accounting/dts/operating_cash_balance",
    selectedAccountType:
      fiscalDataBundle?.selectedAccountType ||
      fiscalDataBundle?.latest?.account_type ||
      "Treasury General Account (TGA) Closing Balance",
    balanceField:
      fiscalDataBundle?.balanceField ||
      (fiscalDataBundle?.latest?.effective_balance === fiscalDataBundle?.latest?.open_today_bal
        ? "open_today_bal"
        : "close_today_bal"),
    count: fiscalDataBundle?.count || 0,
    validCount: rows.length,
    rows,
  };
}

function findLatestObservationOnOrBefore(observations, replayDate, dateKey = "date") {
  if (!Array.isArray(observations) || observations.length === 0 || !replayDate) {
    return null;
  }

  let lo = 0;
  let hi = observations.length - 1;
  let best = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const obs = observations[mid];
    const obsDate = obs?.[dateKey];

    if (String(obsDate) <= String(replayDate)) {
      best = obs;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

function mapFredForReplayDate({ replayDate, seriesLookup }) {
  const fred = {};

  for (const series of ENGINE25_FRED_SERIES) {
    const block = seriesLookup[series.id];
    const latestObs = findLatestObservationOnOrBefore(
      block?.observations || [],
      replayDate,
      "date"
    );

    fred[series.id] = {
      label: series.label,
      component: series.component,
      ...cleanFredObservation(latestObs),
    };
  }

  return fred;
}

function mapTgaForReplayDate({ replayDate, tgaLookup }) {
  const latestTga = findLatestObservationOnOrBefore(
    tgaLookup?.rows || [],
    replayDate,
    "record_date"
  );

  return cleanTgaRow(latestTga);
}

function fredValue(fred, key) {
  return fred?.[key]?.value ?? null;
}

function scoreLaborFromFred(fred) {
  const unrate = fredValue(fred, "UNRATE");
  const initialClaims = fredValue(fred, "ICSA");
  const continuingClaims = fredValue(fred, "CCSA");

  const unemploymentScore = scoreInverse(unrate, 3.8, 5.5);
  const initialClaimsScore = scoreInverse(initialClaims, 200000, 325000);
  const continuingClaimsScore = scoreInverse(continuingClaims, 1700000, 2300000);

  const score = weightedAvg([
    { value: unemploymentScore, weight: 0.4 },
    { value: initialClaimsScore, weight: 0.35 },
    { value: continuingClaimsScore, weight: 0.25 },
  ]);

  const warnings = [];
  if (isNum(unrate) && Number(unrate) >= 4.8) warnings.push("Unemployment rate elevated");
  if (isNum(initialClaims) && Number(initialClaims) >= 275000) {
    warnings.push("Initial claims rising into caution zone");
  }
  if (isNum(continuingClaims) && Number(continuingClaims) >= 2100000) {
    warnings.push("Continuing claims elevated");
  }

  return {
    score,
    label: score >= 70 ? "LABOR_HEALTHY" : score >= 50 ? "LABOR_MIXED" : "LABOR_WEAK",
    inputs: {
      unemploymentRate: unrate,
      initialClaims,
      continuingClaims,
      unemploymentScore,
      initialClaimsScore,
      continuingClaimsScore,
    },
    warnings,
  };
}

function scoreCreditStressFromFred(fred) {
  const nfci = fredValue(fred, "NFCI");
  const stlfsi = fredValue(fred, "STLFSI4");
  const highYieldSpread = fredValue(fred, "BAMLH0A0HYM2");

  const nfciScore = scoreInverse(nfci, -0.5, 0.5);
  const stlfsiScore = scoreInverse(stlfsi, -0.5, 1.0);
  const hyScore = scoreInverse(highYieldSpread, 3.0, 6.0);

  const score = weightedAvg([
    { value: nfciScore, weight: 0.35 },
    { value: stlfsiScore, weight: 0.35 },
    { value: hyScore, weight: 0.3 },
  ]);

  const warnings = [];
  if (isNum(nfci) && Number(nfci) > 0) warnings.push("Financial conditions tightening");
  if (isNum(stlfsi) && Number(stlfsi) > 0.5) warnings.push("Financial stress elevated");
  if (isNum(highYieldSpread) && Number(highYieldSpread) > 4.5) {
    warnings.push("High-yield credit spread widening");
  }

  return {
    score,
    label:
      score >= 75
        ? "CREDIT_STRESS_LOW"
        : score >= 50
          ? "CREDIT_STRESS_NORMAL"
          : "CREDIT_STRESS_HIGH",
    inputs: {
      nfci,
      stlfsi,
      highYieldSpread,
      nfciScore,
      stlfsiScore,
      hyScore,
    },
    warnings,
  };
}

function scoreBondMarketFromFred(fred) {
  const tenYear = fredValue(fred, "DGS10");
  const twoYear = fredValue(fred, "DGS2");
  const tenMinusTwo = fredValue(fred, "T10Y2Y");
  const tenMinusThreeMonth = fredValue(fred, "T10Y3M");

  const tenYearScore = scoreInverse(tenYear, 3.75, 5.25);
  const twoYearScore = scoreInverse(twoYear, 3.5, 5.25);
  const curveScore = scoreDirect(tenMinusTwo, -0.75, 0.75);
  const threeMonthCurveScore = scoreDirect(tenMinusThreeMonth, -1.0, 1.0);

  const score = weightedAvg([
    { value: tenYearScore, weight: 0.3 },
    { value: twoYearScore, weight: 0.25 },
    { value: curveScore, weight: 0.25 },
    { value: threeMonthCurveScore, weight: 0.2 },
  ]);

  const warnings = [];
  if (isNum(tenYear) && Number(tenYear) >= 4.5) warnings.push("10Y yield pressure elevated");
  if (isNum(twoYear) && Number(twoYear) >= 4.25) warnings.push("2Y yield suggests Fed hawkish pressure");
  if (isNum(tenMinusTwo) && Number(tenMinusTwo) < 0) warnings.push("10Y-2Y curve inverted");
  if (isNum(tenMinusThreeMonth) && Number(tenMinusThreeMonth) < 0) {
    warnings.push("10Y-3M curve inverted");
  }

  return {
    score,
    label:
      score >= 70
        ? "BONDS_SUPPORTIVE"
        : score >= 50
          ? "BONDS_MIXED"
          : "BONDS_PRESSURE",
    inputs: {
      tenYear,
      twoYear,
      tenMinusTwo,
      tenMinusThreeMonth,
      tenYearScore,
      twoYearScore,
      curveScore,
      threeMonthCurveScore,
    },
    warnings,
  };
}

function scoreLiquidityFromFredAndTga(fred, tga) {
  const fedBalanceSheet = fredValue(fred, "WALCL");
  const reverseRepo = fredValue(fred, "RRPONTSYD");
  const bankReserves = fredValue(fred, "WRESBAL");
  const m2 = fredValue(fred, "M2SL");
  const tgaBalance = tga?.effectiveBalance ?? null;

  const fedBalanceSheetScore = scoreDirect(fedBalanceSheet, 6000000, 8000000);
  const reverseRepoScore = scoreInverse(reverseRepo, 100, 1200);
  const bankReservesScore = scoreDirect(bankReserves, 2500000, 3600000);
  const m2Score = scoreDirect(m2, 20000, 23500);
  const tgaScore = scoreInverse(tgaBalance, 500000, 1000000);

  const score = weightedAvg([
    { value: fedBalanceSheetScore, weight: 0.2 },
    { value: reverseRepoScore, weight: 0.15 },
    { value: bankReservesScore, weight: 0.25 },
    { value: m2Score, weight: 0.2 },
    { value: tgaScore, weight: 0.2 },
  ]);

  const warnings = [];
  if (isNum(tgaBalance) && Number(tgaBalance) >= 850000) {
    warnings.push("TGA balance high, liquidity drain risk");
  }
  if (isNum(bankReserves) && Number(bankReserves) < 2800000) {
    warnings.push("Bank reserves low");
  }
  if (isNum(fedBalanceSheet) && Number(fedBalanceSheet) < 6400000) {
    warnings.push("Fed balance sheet liquidity declining");
  }

  return {
    score,
    label:
      score >= 70
        ? "LIQUIDITY_SUPPORTIVE"
        : score >= 50
          ? "LIQUIDITY_MIXED"
          : "LIQUIDITY_TIGHT",
    inputs: {
      fedBalanceSheet,
      reverseRepo,
      bankReserves,
      m2,
      tgaBalance,
      fedBalanceSheetScore,
      reverseRepoScore,
      bankReservesScore,
      m2Score,
      tgaScore,
      tgaRecordDate: tga?.recordDate || null,
      tgaAccountType: tga?.accountType || null,
      tgaBalanceField: tga?.balanceField || null,
    },
    warnings,
  };
}

function scoreInflationFromFred(fred) {
  const cpi = fredValue(fred, "CPIAUCSL");
  const ppi = fredValue(fred, "PPIACO");

  const cpiScore = scoreInverse(cpi, 315, 345);
  const ppiScore = scoreInverse(ppi, 260, 300);

  const score = weightedAvg([
    { value: cpiScore, weight: 0.55 },
    { value: ppiScore, weight: 0.45 },
  ]);

  const warnings = [];
  if (score < 50) warnings.push("Inflation index pressure remains elevated");

  return {
    score,
    label:
      score >= 70
        ? "INFLATION_COOLING"
        : score >= 50
          ? "INFLATION_MIXED"
          : "INFLATION_PRESSURE",
    inputs: {
      cpi,
      ppi,
      cpiScore,
      ppiScore,
    },
    warnings,
  };
}

function buildMacroScores(fred, tga) {
  const labor = scoreLaborFromFred(fred);
  const creditStress = scoreCreditStressFromFred(fred);
  const bondMarket = scoreBondMarketFromFred(fred);
  const liquidity = scoreLiquidityFromFredAndTga(fred, tga);
  const inflation = scoreInflationFromFred(fred);

  const macroScoreSummary = weightedAvg([
    { value: labor.score, weight: 0.2 },
    { value: creditStress.score, weight: 0.25 },
    { value: bondMarket.score, weight: 0.2 },
    { value: liquidity.score, weight: 0.2 },
    { value: inflation.score, weight: 0.15 },
  ]);

  const warnings = [
    ...labor.warnings,
    ...creditStress.warnings,
    ...bondMarket.warnings,
    ...liquidity.warnings,
    ...inflation.warnings,
  ];

  return {
    macroScores: {
      labor,
      creditStress,
      bondMarket,
      liquidity,
      inflation,
    },
    macroScoreSummary,
    warnings,
  };
}

function validateNoFutureLeakage(rows) {
  const leaks = [];

  for (const row of rows) {
    const replayDate = row.date;

    for (const series of ENGINE25_FRED_SERIES) {
      const mapped = row.fred?.[series.id];

      if (
        mapped?.observationDate &&
        replayDate &&
        String(mapped.observationDate) > String(replayDate)
      ) {
        leaks.push({
          type: "FRED",
          date: replayDate,
          seriesId: series.id,
          observationDate: mapped.observationDate,
        });
      }
    }

    if (
      row.fiscalData?.tga?.recordDate &&
      replayDate &&
      String(row.fiscalData.tga.recordDate) > String(replayDate)
    ) {
      leaks.push({
        type: "FiscalData",
        date: replayDate,
        seriesId: "TGA",
        observationDate: row.fiscalData.tga.recordDate,
      });
    }
  }

  return leaks;
}

function buildQuickValidation(rows) {
  const firstRow = rows[0] || null;
  const lastRow = rows[rows.length - 1] || null;

  function pick(row) {
    if (!row) return null;

    const picked = {
      date: row.date,
      time: row.time,
      esClose: row.esClose,
      macroScoreSummary: row.macroScoreSummary,
      macroScores: {
        labor: row.macroScores?.labor?.score ?? null,
        creditStress: row.macroScores?.creditStress?.score ?? null,
        bondMarket: row.macroScores?.bondMarket?.score ?? null,
        liquidity: row.macroScores?.liquidity?.score ?? null,
        inflation: row.macroScores?.inflation?.score ?? null,
      },
      fiscalData: {
        tga: row.fiscalData?.tga || null,
      },
      fred: {},
      warnings: row.warnings || [],
    };

    for (const id of KEY_VALIDATION_SERIES) {
      picked.fred[id] = row.fred?.[id] || null;
    }

    return picked;
  }

  return {
    firstRow: pick(firstRow),
    lastRow: pick(lastRow),
  };
}

function buildScoreSummary(rows) {
  const scoreKeys = ["labor", "creditStress", "bondMarket", "liquidity", "inflation"];

  const out = {
    macroScoreSummaryAvg: null,
    components: {},
  };

  function avgNumber(values) {
    const nums = values.map(Number).filter(Number.isFinite);
    if (!nums.length) return null;
    return Number((nums.reduce((sum, v) => sum + v, 0) / nums.length).toFixed(3));
  }

  out.macroScoreSummaryAvg = avgNumber(rows.map((row) => row.macroScoreSummary));

  for (const key of scoreKeys) {
    out.components[key] = {
      avg: avgNumber(rows.map((row) => row.macroScores?.[key]?.score)),
      first: rows[0]?.macroScores?.[key]?.score ?? null,
      last: rows[rows.length - 1]?.macroScores?.[key]?.score ?? null,
    };
  }

  return out;
}

async function main() {
  const startedAt = new Date().toISOString();

  const output = {
    ok: false,
    engine: ENGINE_NAME,
    modelType: MODEL_TYPE,
    symbol: "ES",
    timeframe: "1d",
    generatedAtUtc: null,
    startedAt,
    finishedAt: null,
    source: {
      fredSeries: ENGINE25_FRED_SERIES.map((series) => ({
        id: series.id,
        label: series.label,
        component: series.component,
      })),
      fiscalData: {
        source: "U.S. Treasury FiscalData",
        dataset: "Daily Treasury Statement",
        table: "Operating Cash Balance",
        endpoint: "/v1/accounting/dts/operating_cash_balance",
        selectedAccountType: "Treasury General Account (TGA) Closing Balance",
        selectedBalance: "effective_balance",
        recordStart: FISCALDATA_RECORD_START,
      },
      replayBaseFile: "engine25-historical-replay-6mo.json",
      outputFile: "engine25-historical-macro-feeds-6mo.json",
      fredObservationStart: FRED_OBSERVATION_START,
      scoringSource:
        "Copied from services/core/logic/engine25MarketHealth.js without modifying live model.",
    },
    limitations: [
      "This v0.3 version includes FRED plus FiscalData TGA historical mapping and macro component scoring.",
      "No FMP data is included yet.",
      "No route or frontend is included.",
      "FRED observation dates are used as available-date approximation unless release-date metadata is added later.",
      "FiscalData record_date is used as the historical TGA date.",
      "Each replay date uses the latest FRED/FiscalData observation date on or before that replay date.",
      "The working POLYGON_PROXY_ONLY replay file is not overwritten.",
    ],
    summary: {
      replayRowsLoaded: 0,
      rowsWritten: 0,
      fredSeriesRequested: ENGINE25_FRED_SERIES.length,
      fredSeriesLoaded: 0,
      fiscalDataRowsLoaded: 0,
      futureLeakCount: 0,
      scoreSummary: null,
    },
    validation: null,
    rows: [],
    errors: [],
  };

  try {
    const fredApiKey = process.env.FRED_API_KEY;

    if (!fredApiKey) {
      throw new Error("Missing FRED_API_KEY environment variable");
    }

    console.log("========================================");
    console.log("Engine 25 Historical Macro Feeds");
    console.log("FRED + FiscalData TGA mapping + macro scores");
    console.log("========================================");

    console.log("\nReading base replay file:");
    console.log(REPLAY_BASE_FILE);

    ensureReplayBaseFileExists();

    const baseReplay = readJsonFile(REPLAY_BASE_FILE);
    const replayRows = normalizeReplayRows(baseReplay);

    output.summary.replayRowsLoaded = replayRows.length;

    if (!replayRows.length) {
      throw new Error("Base replay file has zero rows.");
    }

    console.log("Replay rows loaded:", replayRows.length);

    console.log("\nFetching FRED bundle...");
    const fredBundle = await fetchEngine25FredBundle({
      apiKey: fredApiKey,
      observationStart: FRED_OBSERVATION_START,
    });

    output.summary.fredSeriesLoaded = fredBundle.seriesLoaded || 0;

    if (Array.isArray(fredBundle.errors) && fredBundle.errors.length) {
      output.errors.push(
        ...fredBundle.errors.map((err) => ({
          source: "FRED",
          ...err,
        }))
      );
    }

    console.log(
      "FRED loaded:",
      fredBundle.seriesLoaded,
      "/",
      fredBundle.seriesRequested
    );

    console.log("\nFetching FiscalData TGA bundle...");
    const fiscalDataBundle = await fetchFiscalDataOperatingCashBalance({
      pageSize: 5000,
      recordStart: FISCALDATA_RECORD_START,
    });

    console.log("FiscalData TGA rows:", fiscalDataBundle.validCount);

    const seriesLookup = buildSeriesLookup(fredBundle);
    const tgaLookup = buildTgaLookup(fiscalDataBundle);

    output.summary.fiscalDataRowsLoaded = tgaLookup.validCount;
    output.source.fiscalData.selectedAccountType = tgaLookup.selectedAccountType;
    output.source.fiscalData.balanceField = tgaLookup.balanceField;

    const rows = replayRows.map((row, index) => {
      const replayDate = getReplayDate(row);

      if (!replayDate) {
        throw new Error(`Replay row ${index} is missing date.`);
      }

      const fred = mapFredForReplayDate({
        replayDate,
        seriesLookup,
      });

      const tga = mapTgaForReplayDate({
        replayDate,
        tgaLookup,
      });

      const macro = buildMacroScores(fred, tga);

      return {
        date: replayDate,
        time: getReplayTime(row),
        esClose: getEsClose(row),
        fred,
        fiscalData: {
          tga,
        },
        macroScores: macro.macroScores,
        macroScoreSummary: macro.macroScoreSummary,
        warnings: macro.warnings,
      };
    });

    const futureLeaks = validateNoFutureLeakage(rows);

    output.summary.rowsWritten = rows.length;
    output.summary.futureLeakCount = futureLeaks.length;
    output.summary.scoreSummary = buildScoreSummary(rows);

    output.validation = {
      noFutureLeakage: futureLeaks.length === 0,
      futureLeaks,
      keySeriesChecked: KEY_VALIDATION_SERIES,
      ...buildQuickValidation(rows),
    };

    output.rows = rows;
    output.ok = futureLeaks.length === 0 && rows.length > 0;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Historical Macro Feeds Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rowsWritten);
    console.log("Future leaks:", output.summary.futureLeakCount);
    console.log("Avg macro score:", output.summary.scoreSummary?.macroScoreSummaryAvg);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          modelType: output.modelType,
          replayRowsLoaded: output.summary.replayRowsLoaded,
          rowsWritten: output.summary.rowsWritten,
          fredSeriesLoaded: output.summary.fredSeriesLoaded,
          fiscalDataRowsLoaded: output.summary.fiscalDataRowsLoaded,
          futureLeakCount: output.summary.futureLeakCount,
          scoreSummary: output.summary.scoreSummary,
          firstRow: output.validation?.firstRow || null,
          lastRow: output.validation?.lastRow || null,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );

    if (!output.ok) {
      process.exit(1);
    }
  } catch (err) {
    output.ok = false;
    output.finishedAt = new Date().toISOString();
    output.generatedAtUtc = output.finishedAt;
    output.errors.push({
      message: err.message,
      stack: err.stack,
    });

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25 Historical Macro Feeds Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
