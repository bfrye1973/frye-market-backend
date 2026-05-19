// services/core/jobs/updateEngine25HistoricalReplayFull.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const PIPELINE_STEPS = [
  {
    step: "1/7",
    label: "ES forward returns",
    job: "buildEngine25EsForwardReturns6mo.js",
    output: "engine25-es-price-forward-returns-6mo.json",
  },
  {
    step: "2/7",
    label: "Daily technical replay",
    job: "buildEngine25EsReplayDailyTechnical6mo.js",
    output: "engine25-es-replay-daily-technical-6mo.json",
  },
  {
    step: "3/7",
    label: "Setup replay",
    job: "buildEngine25EsReplaySetups6mo.js",
    output: "engine25-es-replay-setups-6mo.json",
  },
  {
    step: "4/7",
    label: "Proxy scores",
    job: "buildEngine25EsReplayProxyScores6mo.js",
    output: "engine25-es-replay-proxy-scores-6mo.json",
  },
  {
    step: "5/7",
    label: "Historical replay base",
    job: "buildEngine25HistoricalReplay6mo.js",
    output: "engine25-historical-replay-6mo.json",
  },
  {
    step: "6/7",
    label: "Historical macro feeds",
    job: "buildEngine25HistoricalMacroFeeds6mo.js",
    output: "engine25-historical-macro-feeds-6mo.json",
  },
  {
    step: "7/7",
    label: "Historical replay macro merge",
    job: "buildEngine25HistoricalReplayMacro6mo.js",
    output: "engine25-historical-replay-macro-6mo.json",
  },
];

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function verifyOutput(outputFile) {
  const outputPath = path.join(DATA_DIR, outputFile);

  if (!fileExists(outputPath)) {
    throw new Error(`Expected output file was not created: ${outputPath}`);
  }

  const stat = fs.statSync(outputPath);

  if (!stat.size || stat.size <= 0) {
    throw new Error(`Expected output file is empty: ${outputPath}`);
  }

  console.log(
    `[Engine25 Historical Full] Verified output: ${outputFile} (${formatBytes(
      stat.size
    )})`
  );
}

function runJob({ step, label, job, output }) {
  const jobPath = path.join(__dirname, job);

  if (!fileExists(jobPath)) {
    throw new Error(`Missing required job file: ${jobPath}`);
  }

  console.log("");
  console.log(`[Engine25 Historical Full] Step ${step} ${label}...`);
  console.log(`[Engine25 Historical Full] Running: node jobs/${job}`);

  const result = spawnSync(process.execPath, [jobPath], {
    cwd: CORE_DIR,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `[Engine25 Historical Full] Failed at step ${step}: ${label} (${job})`
    );
  }

  verifyOutput(output);
}

async function main() {
  const startedAt = new Date().toISOString();

  console.log("========================================");
  console.log("[Engine25 Historical Full] Starting");
  console.log("========================================");
  console.log("[Engine25 Historical Full] Started:", startedAt);
  console.log("[Engine25 Historical Full] Core dir:", CORE_DIR);
  console.log("[Engine25 Historical Full] Data dir:", DATA_DIR);

  if (!fileExists(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  try {
    for (const pipelineStep of PIPELINE_STEPS) {
      runJob(pipelineStep);
    }

    const finishedAt = new Date().toISOString();

    console.log("");
    console.log("========================================");
    console.log("[Engine25 Historical Full] Complete.");
    console.log("========================================");
    console.log("[Engine25 Historical Full] Started:", startedAt);
    console.log("[Engine25 Historical Full] Finished:", finishedAt);
    console.log("[Engine25 Historical Full] Final outputs:");

    for (const pipelineStep of PIPELINE_STEPS) {
      const outputPath = path.join(DATA_DIR, pipelineStep.output);
      const stat = fs.statSync(outputPath);

      console.log(`- ${pipelineStep.output} (${formatBytes(stat.size)})`);
    }
  } catch (err) {
    console.error("");
    console.error("========================================");
    console.error("[Engine25 Historical Full] Failed.");
    console.error("========================================");
    console.error(err);
    process.exit(1);
  }
}

main();
