// services/core/jobs/updateEngine28APipelineDoctor.js
//
// Builds Engine 28A from the completed canonical ES Strategy 1 snapshot.
// Engine 28A owns only its diagnostic output and attachment.
// It never mutates fields owned by other engines.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  buildEngine28APipelineDoctor,
} from "../logic/engine28a/buildPipelineDoctor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(CORE_DIR, "data");

const SNAPSHOT_FILE = path.resolve(
  DATA_DIR,
  "strategy-snapshot-es.json"
);

const OUTPUT_FILE = path.resolve(
  DATA_DIR,
  "engine28a-pipeline-doctor.json"
);

const STRATEGY_ID = "intraday_scalp@10m";

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function writeJsonAtomic(file, value) {
  const temp = file + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2),
    "utf8"
  );

  fs.renameSync(temp, file);
}

if (!fs.existsSync(SNAPSHOT_FILE)) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "ES_STRATEGY_SNAPSHOT_NOT_FOUND",
      file: SNAPSHOT_FILE,
    })
  );
  process.exit(1);
}

let snapshot;

try {
  snapshot = readJson(SNAPSHOT_FILE);
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "ES_STRATEGY_SNAPSHOT_UNREADABLE",
      detail: String(
        error?.message || error
      ),
    })
  );
  process.exit(1);
}

const strategy =
  snapshot?.strategies?.[STRATEGY_ID];

if (
  !strategy ||
  typeof strategy !== "object"
) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "STRATEGY1_NOT_FOUND",
      strategyId: STRATEGY_ID,
    })
  );
  process.exit(1);
}

const diagnosis =
  buildEngine28APipelineDoctor(
    strategy
  );

writeJsonAtomic(
  OUTPUT_FILE,
  diagnosis
);

// Attach only Engine 28A diagnostic result.
snapshot.strategies[
  STRATEGY_ID
].engine28APipelineDoctor =
  diagnosis;

writeJsonAtomic(
  SNAPSHOT_FILE,
  snapshot
);

console.log(
  JSON.stringify(
    {
      ok: true,
      outputFile: OUTPUT_FILE,
      snapshotAttached: true,
      pipelineStatus:
        diagnosis.pipelineStatus,
      firstFailingEngine:
        diagnosis.firstFailingEngine,
      failureType:
        diagnosis.failureType,
      rootCause:
        diagnosis.rootCause,
      snapshotTime:
        diagnosis.snapshotTime,
      generatedAt:
        diagnosis.generatedAt,
    },
    null,
    2
  )
);
