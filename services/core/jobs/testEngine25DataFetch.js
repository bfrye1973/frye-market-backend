// services/core/jobs/testEngine25DataFetch.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  fetchEngine25FredBundle,
  fetchFiscalDataOperatingCashBalance,
} from "../logic/engine25DataSources.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-data-test.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function safeLatest(sourceBlock, key) {
  return sourceBlock?.results?.[key]?.latest || null;
}

async function main() {
  const startedAt = new Date().toISOString();

  const fredApiKey = process.env.FRED_API_KEY;

  const output = {
    ok: false,
    engine: "engine25.marketHealth.v0.dataFetchTest",
    startedAt,
    finishedAt: null,
    sources: {
      fred: null,
      fiscalData: null,
    },
    quickRead: {},
    errors: [],
  };

  try {
    if (!fredApiKey) {
      throw new Error("Missing FRED_API_KEY environment variable");
    }

    console.log("========================================");
    console.log("Engine 25 Data Fetch Test");
    console.log("Testing FRED + FiscalData");
    console.log("========================================");

    console.log("\nFetching FRED bundle...");
    const fred = await fetchEngine25FredBundle({
      apiKey: fredApiKey,
      observationStart: "2015-01-01",
    });

    output.sources.fred = {
      ok: fred.ok,
      source: fred.source,
      observationStart: fred.observationStart,
      seriesRequested: fred.seriesRequested,
      seriesLoaded: fred.seriesLoaded,
      errors: fred.errors,
      latest: {
        UNRATE: safeLatest(fred, "UNRATE"),
        ICSA: safeLatest(fred, "ICSA"),
        CCSA: safeLatest(fred, "CCSA"),
        PAYEMS: safeLatest(fred, "PAYEMS"),
        NFCI: safeLatest(fred, "NFCI"),
        STLFSI4: safeLatest(fred, "STLFSI4"),
        BAMLH0A0HYM2: safeLatest(fred, "BAMLH0A0HYM2"),
        DGS10: safeLatest(fred, "DGS10"),
        DGS2: safeLatest(fred, "DGS2"),
        T10Y2Y: safeLatest(fred, "T10Y2Y"),
        T10Y3M: safeLatest(fred, "T10Y3M"),
        WALCL: safeLatest(fred, "WALCL"),
        RRPONTSYD: safeLatest(fred, "RRPONTSYD"),
        WRESBAL: safeLatest(fred, "WRESBAL"),
        M2SL: safeLatest(fred, "M2SL"),
        CPIAUCSL: safeLatest(fred, "CPIAUCSL"),
        PPIACO: safeLatest(fred, "PPIACO"),
      },
    };

    console.log("FRED loaded:", fred.seriesLoaded, "/", fred.seriesRequested);

    if (fred.errors.length) {
      console.log("FRED errors:", fred.errors);
    }

    console.log("\nFetching FiscalData Operating Cash Balance...");
    const fiscalData = await fetchFiscalDataOperatingCashBalance({
      pageSize: 5000,
    });

    output.sources.fiscalData = {
      ok: fiscalData.ok,
      source: fiscalData.source,
      dataset: fiscalData.dataset,
      table: fiscalData.table,
      endpoint: fiscalData.endpoint,
      count: fiscalData.count,
      validCount: fiscalData.validCount,
      latest: fiscalData.latest,
    };

    console.log("FiscalData rows:", fiscalData.validCount);

    output.quickRead = {
      laborMarketHealth: {
        unemploymentRate: output.sources.fred.latest.UNRATE,
        initialClaims: output.sources.fred.latest.ICSA,
        continuingClaims: output.sources.fred.latest.CCSA,
        nonfarmPayrolls: output.sources.fred.latest.PAYEMS,
      },
      financialStressCredit: {
        nfci: output.sources.fred.latest.NFCI,
        stLouisFinancialStress: output.sources.fred.latest.STLFSI4,
        highYieldSpread: output.sources.fred.latest.BAMLH0A0HYM2,
      },
      fedBondMarket: {
        tenYearYield: output.sources.fred.latest.DGS10,
        twoYearYield: output.sources.fred.latest.DGS2,
        tenMinusTwo: output.sources.fred.latest.T10Y2Y,
        tenMinusThreeMonth: output.sources.fred.latest.T10Y3M,
      },
      liquidityConditions: {
        fedBalanceSheet: output.sources.fred.latest.WALCL,
        reverseRepo: output.sources.fred.latest.RRPONTSYD,
        bankReserves: output.sources.fred.latest.WRESBAL,
        m2MoneySupply: output.sources.fred.latest.M2SL,
        treasuryOperatingCashBalance: output.sources.fiscalData.latest,
      },
      inflation: {
        cpi: output.sources.fred.latest.CPIAUCSL,
        ppi: output.sources.fred.latest.PPIACO,
      },
    };

    output.ok =
      output.sources.fred?.seriesLoaded > 0 && output.sources.fiscalData?.ok;

    output.finishedAt = new Date().toISOString();

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Data Fetch Test Complete");
    console.log("OK:", output.ok);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          fredLoaded: output.sources.fred.seriesLoaded,
          fiscalRows: output.sources.fiscalData.validCount,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );
  } catch (err) {
    output.ok = false;
    output.finishedAt = new Date().toISOString();
    output.errors.push({
      message: err.message,
      stack: err.stack,
    });

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25 Data Fetch Test Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
