// services/core/jobs/testEngine25SectorHealth.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildEngine25SectorHealth } from "../logic/engine25SectorHealth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-sector-health-test.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

async function main() {
  console.log("========================================");
  console.log("Engine 25 Sector Health Test");
  console.log("Fetching /live/intraday + /live/eod sectorCards");
  console.log("========================================");

  try {
    ensureDataDir();

    const result = await buildEngine25SectorHealth();

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Sector Health Complete");
    console.log("OK:", result.ok);
    console.log("Intraday sectors:", result.intradaySummary.count);
    console.log("EOD sectors:", result.eodSummary.count);
    console.log("Distribution score:", result.distributionPressure.score);
    console.log("Distribution label:", result.distributionPressure.label);
    console.log("Breadth score:", result.breadthParticipation.score);
    console.log("Breadth label:", result.breadthParticipation.label);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          engine: result.engine,
          distributionPressure: {
            score: result.distributionPressure.score,
            label: result.distributionPressure.label,
            warnings: result.distributionPressure.warnings,
          },
          breadthParticipation: {
            score: result.breadthParticipation.score,
            label: result.breadthParticipation.label,
            warnings: result.breadthParticipation.warnings,
          },
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );

    if (!result.ok) {
      process.exit(1);
    }
  } catch (err) {
    const errorOutput = {
      ok: false,
      engine: "engine25.sectorHealth.v0.1",
      error: err.message,
      stack: err.stack,
      updatedAt: new Date().toISOString(),
    };

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(errorOutput, null, 2));

    console.error("Engine 25 Sector Health Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
