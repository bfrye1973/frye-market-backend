// services/core/jobs/updateEngine29Then25.js
// Synchronized Engine 29 -> Engine 25 orchestration.

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import {
  MAX_ENGINE29_AGE_MS,
  validateEngine29Canonical,
} from "../logic/engine25/engine29/validateEngine29Canonical.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

export const ENGINE29_JOB = path.join(CORE_DIR, "jobs", "updateEngine29CrossMarketStress.js");
export const ENGINE25_JOB = path.join(CORE_DIR, "jobs", "updateEngine25Full.js");
export const ENGINE29_CANONICAL_FILE = path.join(DATA_DIR, "engine29-cross-market-stress.json");

function defaultRunJob(jobPath) {
  execFileSync(process.execPath, [jobPath], {
    cwd: CORE_DIR,
    stdio: "inherit",
    env: process.env,
  });
}

export function runEngine29Then25({
  runJob = defaultRunJob,
  validate = validateEngine29Canonical,
  now = () => Date.now(),
  engine29Job = ENGINE29_JOB,
  engine25Job = ENGINE25_JOB,
  engine29CanonicalFile = ENGINE29_CANONICAL_FILE,
} = {}) {
  const startedAt = new Date(now()).toISOString();
  const startedMs = now();
  const steps = [];

  console.log(`[engine29-then-25] START @ ${startedAt}`);

  steps.push("ENGINE29_BUILD_START");
  runJob(engine29Job);
  steps.push("ENGINE29_BUILD_SUCCESS");

  steps.push("ENGINE29_VALIDATE_START");
  const validation = validate({
    filePath: engine29CanonicalFile,
    now: now(),
    maxAgeMs: MAX_ENGINE29_AGE_MS,
  });

  if (!validation?.ok) {
    const reason = validation?.reason || "ENGINE29_CANONICAL_VALIDATION_FAILED";
    console.error(`[engine29-then-25] FAIL validation reason=${reason}`);
    const error = new Error(`Engine 29 canonical validation failed: ${reason}`);
    error.code = "ENGINE29_CANONICAL_VALIDATION_FAILED";
    error.validation = validation;
    error.steps = [...steps, "ENGINE29_VALIDATE_FAILED"];
    throw error;
  }

  steps.push("ENGINE29_VALIDATE_SUCCESS");

  steps.push("ENGINE25_BUILD_START");
  runJob(engine25Job);
  steps.push("ENGINE25_BUILD_SUCCESS");

  const finishedAt = new Date(now()).toISOString();
  const elapsedMs = now() - startedMs;

  const result = {
    ok: true,
    engine: "engine29Then25.orchestration.v1",
    startedAt,
    finishedAt,
    elapsedMs,
    maxEngine29AgeMs: MAX_ENGINE29_AGE_MS,
    validation,
    steps,
  };

  console.log(
    `[engine29-then-25] SUCCESS @ ${finishedAt} elapsedMs=${elapsedMs} engine29AgeMs=${validation.ageMs}`
  );

  return result;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  try {
    const result = runEngine29Then25();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("[engine29-then-25] FAILED");
    console.error(error?.stack || error?.message || String(error));
    if (error?.validation) {
      console.error(JSON.stringify({ validation: error.validation, steps: error.steps || [] }, null, 2));
    }
    process.exit(1);
  }
}
