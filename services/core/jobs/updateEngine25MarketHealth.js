// services/core/jobs/updateEngine25MarketHealth.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeEngine25MarketHealth } from "../logic/engine25MarketHealth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const MACRO_FILE = path.join(DATA_DIR, "engine25-data-test.json");
const MARKET_FILE = path.join(DATA_DIR, "engine25-market-feeds-test.json");
const FMP_FILE = path.join(DATA_DIR, "engine25-fmp-feeds-test.json");
const SECTOR_FILE = path.join(DATA_DIR, "engine25-sector-health-test.json");
const ES_TECH_FILE = path.join(DATA_DIR, "engine25-es-technical-context.json");

const OUTPUT_FILE = path.join(DATA_DIR, "engine25-market-health.json");

function readJsonSafe(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) {
      throw new Error(`Missing required data file: ${file}`);
    }
    return null;
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const startedAt = new Date().toISOString();

  const output = {
    ok: false,
    engine: "engine25.marketHealth.updateJob.v0.1",
    startedAt,
    finishedAt: null,
    result: null,
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Market Health Update");
    console.log("Reading macro + market + FMP test data");
    console.log("========================================");

    const macroData = readJsonSafe(MACRO_FILE, true);
    const marketData = readJsonSafe(MARKET_FILE, true);
    const sectorHealthData = readJsonSafe(SECTOR_FILE, false);
    const ES_TECH_FILE = path.join(DATA_DIR, "engine25-es-technical-context.json");
    const fmpData = readJsonSafe(FMP_FILE, false);
    
    

   const result = computeEngine25MarketHealth({
     macroData,
     marketData,
     fmpData,
     sectorHealthData,
     esTechnicalContextData,
   });

    output.ok = result.ok;
    output.finishedAt = new Date().toISOString();
    output.result = result;

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Market Health Complete");
    console.log("OK:", result.ok);
    console.log("Score:", result.score);
    console.log("Regime:", result.regime);
    console.log("Bias:", result.bias);
    console.log("Risk:", result.riskLevel);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          engine: result.engine,
          score: result.score,
          regime: result.regime,
          bias: result.bias,
          riskLevel: result.riskLevel,
          tradePermission: result.tradePermission,
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

    fs.writeFileSync(
      path.join(DATA_DIR, "engine25-market-health-error.json"),
      JSON.stringify(output, null, 2)
    );

    console.error("Engine 25 Market Health Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
