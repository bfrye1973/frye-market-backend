// services/core/jobs/updateEngine29CrossMarketStress.js
// Engine 29 — canonical persisted cross-market stress output
// Owns persistence only. Core Engine 29 logic remains under logic/engine29/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildEngine29CrossMarketStress } from "../logic/engine29/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine29-cross-market-stress.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function compactLog(output) {
  return {
    timestamp: output?.timestamp ?? null,
    overallState: output?.overallState ?? null,
    tacticalState: output?.tacticalState ?? null,
    fastTacticalState: output?.fastTacticalState ?? null,
    esResolvedSymbol: output?.dataQuality?.esResolvedSymbol ?? null,
    moveCharacter: output?.moveCharacter?.moveCharacter ?? null,
    underlyingPressure:
      output?.moveCharacter?.underlyingPressure?.state ??
      output?.display?.underTheHood?.pressure?.state ??
      null,
    dataDegraded: Boolean(output?.dataDegraded),
    missingConfirmations: output?.missingConfirmations || [],
  };
}

export async function updateEngine29CrossMarketStress({ now = Date.now() } = {}) {
  ensureDataDir();

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  console.log(`[engine29] BUILD START @ ${startedAt}`);

  const output = await buildEngine29CrossMarketStress({ now });

  if (!output || typeof output !== "object") {
    throw new Error("Engine 29 build returned no canonical output");
  }

  if (!output.version || !output.timestamp || !output.overallState) {
    throw new Error(
      `Engine 29 output missing required canonical fields: ${JSON.stringify({
        version: output.version ?? null,
        timestamp: output.timestamp ?? null,
        overallState: output.overallState ?? null,
      })}`
    );
  }

  writeJsonAtomic(OUTPUT_FILE, output);

  const stat = fs.statSync(OUTPUT_FILE);
  const finishedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startedMs;

  const result = {
    ok: true,
    engine: "engine29.crossMarketStress.update.v1",
    startedAt,
    finishedAt,
    elapsedMs,
    outputFile: OUTPUT_FILE,
    sizeBytes: stat.size,
    summary: compactLog(output),
    data: output,
  };

  console.log(
    `[engine29] BUILD SUCCESS @ ${finishedAt} elapsedMs=${elapsedMs} ` +
      `overall=${result.summary.overallState} ` +
      `1h=${result.summary.tacticalState} ` +
      `30m=${result.summary.fastTacticalState} ` +
      `move=${result.summary.moveCharacter}`
  );

  return result;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  updateEngine29CrossMarketStress()
    .then((result) => {
      console.log(JSON.stringify({
        ok: result.ok,
        engine: result.engine,
        outputFile: result.outputFile,
        sizeBytes: result.sizeBytes,
        elapsedMs: result.elapsedMs,
        summary: result.summary,
      }, null, 2));
    })
    .catch((error) => {
      console.error("[engine29] BUILD FAIL");
      console.error(error?.stack || error?.message || String(error));
      process.exit(1);
    });
}
