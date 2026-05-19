// services/core/jobs/testEngine25EsTechnicalContext.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildEngine25EsTechnicalContext } from "../logic/engine25EsTechnicalContext.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-es-technical-context.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

async function main() {
  console.log("========================================");
  console.log("Engine 25 ES Technical Context Test");
  console.log("Fetching ES 10m / 1h / 4h / 1d candles");
  console.log("========================================");

  try {
    ensureDataDir();

    const result = await buildEngine25EsTechnicalContext({ symbol: "ES" });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 ES Technical Context Complete");
    console.log("OK:", result.ok);
    console.log("State:", result.technicalRead.state);
    console.log("Bias:", result.technicalRead.bias);
    console.log("Permission:", result.technicalRead.permission);
    console.log("Required:", result.technicalRead.requiredAction);
    console.log("Size Cap:", result.technicalRead.sizeCap);
    console.log("Daily close:", result.daily.close);
    console.log("Daily EMA20:", result.daily.ema20);
    console.log("Daily above EMA20:", result.daily.aboveEma20);
    console.log("4H close:", result.fourHour.close);
    console.log("4H EMA50:", result.fourHour.ema50);
    console.log("4H above EMA50:", result.fourHour.aboveEma50);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          engine: result.engine,
          state: result.technicalRead.state,
          bias: result.technicalRead.bias,
          permission: result.technicalRead.permission,
          requiredAction: result.technicalRead.requiredAction,
          sizeCap: result.technicalRead.sizeCap,
          notes: result.technicalRead.notes,
          daily: {
            close: result.daily.close,
            ema10: result.daily.ema10,
            ema20: result.daily.ema20,
            ema50: result.daily.ema50,
            aboveEma20: result.daily.aboveEma20,
            distanceToEma20Pct: result.daily.distanceToEma20Pct,
          },
          fourHour: {
            close: result.fourHour.close,
            ema10: result.fourHour.ema10,
            ema20: result.fourHour.ema20,
            ema50: result.fourHour.ema50,
            aboveEma10: result.fourHour.aboveEma10,
            aboveEma20: result.fourHour.aboveEma20,
            aboveEma50: result.fourHour.aboveEma50,
          },
          oneHour: {
            close: result.oneHour.close,
            ema10: result.oneHour.ema10,
            ema20: result.oneHour.ema20,
            ema50: result.oneHour.ema50,
            aboveEma10: result.oneHour.aboveEma10,
            aboveEma20: result.oneHour.aboveEma20,
          },
          tenMinute: {
            close: result.tenMinute.close,
            ema10: result.tenMinute.ema10,
            ema20: result.tenMinute.ema20,
            aboveEma10: result.tenMinute.aboveEma10,
            aboveEma20: result.tenMinute.aboveEma20,
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
      engine: "engine25.esTechnicalContext.v0.1",
      error: err.message,
      stack: err.stack,
      updatedAt: new Date().toISOString(),
    };

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(errorOutput, null, 2));

    console.error("Engine 25 ES Technical Context Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
