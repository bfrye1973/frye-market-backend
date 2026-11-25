// services/core/tests/engine25Engine29Orchestration.test.js

import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MAX_ENGINE29_AGE_MS,
  validateEngine29Canonical,
} from "../logic/engine25/engine29/validateEngine29Canonical.js";
import { runEngine29Then25 } from "../jobs/updateEngine29Then25.js";

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function tempFile(name = "engine29.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e29-"));
  return path.join(dir, name);
}

function writeCanonical(filePath, {
  timestamp,
  version = "engine29.test.v1",
  overallState = "HEALTHY",
} = {}) {
  fs.writeFileSync(filePath, JSON.stringify({ version, timestamp, overallState }));
}

const NOW = Date.parse("2026-09-29T12:00:00.000Z");

run("1 missing Engine29 canonical -> FAIL", () => {
  const result = validateEngine29Canonical({ filePath: tempFile(), now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ENGINE29_CANONICAL_MISSING");
});

run("2 invalid JSON -> FAIL", () => {
  const file = tempFile();
  fs.writeFileSync(file, "{not-json");
  const result = validateEngine29Canonical({ filePath: file, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ENGINE29_CANONICAL_INVALID_JSON");
});

run("3 missing version -> FAIL", () => {
  const file = tempFile();
  writeCanonical(file, { timestamp: new Date(NOW).toISOString(), version: null });
  assert.equal(validateEngine29Canonical({ filePath: file, now: NOW }).reason, "ENGINE29_VERSION_MISSING");
});

run("4 missing timestamp -> FAIL", () => {
  const file = tempFile();
  writeCanonical(file, { timestamp: null });
  assert.equal(validateEngine29Canonical({ filePath: file, now: NOW }).reason, "ENGINE29_TIMESTAMP_MISSING");
});

run("5 missing overallState -> FAIL", () => {
  const file = tempFile();
  writeCanonical(file, { timestamp: new Date(NOW).toISOString(), overallState: null });
  assert.equal(validateEngine29Canonical({ filePath: file, now: NOW }).reason, "ENGINE29_OVERALL_STATE_MISSING");
});

run("6 stale timestamp -> FAIL", () => {
  const file = tempFile();
  writeCanonical(file, { timestamp: new Date(NOW - MAX_ENGINE29_AGE_MS - 1).toISOString() });
  const result = validateEngine29Canonical({ filePath: file, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ENGINE29_CANONICAL_STALE");
});

run("7 fresh valid canonical -> PASS", () => {
  const file = tempFile();
  writeCanonical(file, { timestamp: new Date(NOW - 1000).toISOString() });
  const result = validateEngine29Canonical({ filePath: file, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.fresh, true);
});

run("8 Engine29 build failure -> Engine25 never starts", () => {
  const calls = [];
  assert.throws(() => runEngine29Then25({
    runJob: (job) => {
      calls.push(job);
      if (calls.length === 1) throw new Error("engine29 failed");
    },
    validate: () => ({ ok: true, ageMs: 0 }),
    now: () => NOW,
    engine29Job: "E29",
    engine25Job: "E25",
    engine29CanonicalFile: "canonical",
  }));
  assert.deepEqual(calls, ["E29"]);
});

run("9 validation failure -> Engine25 never starts", () => {
  const calls = [];
  assert.throws(() => runEngine29Then25({
    runJob: (job) => calls.push(job),
    validate: () => ({ ok: false, reason: "STALE" }),
    now: () => NOW,
    engine29Job: "E29",
    engine25Job: "E25",
    engine29CanonicalFile: "canonical",
  }));
  assert.deepEqual(calls, ["E29"]);
});

run("10 valid Engine29 -> Engine25 starts afterward", () => {
  const calls = [];
  const result = runEngine29Then25({
    runJob: (job) => calls.push(job),
    validate: () => ({ ok: true, ageMs: 10 }),
    now: () => NOW,
    engine29Job: "E29",
    engine25Job: "E25",
    engine29CanonicalFile: "canonical",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["E29", "E25"]);
});

run("11 Engine25 failure -> orchestration exits non-successfully", () => {
  const calls = [];
  assert.throws(() => runEngine29Then25({
    runJob: (job) => {
      calls.push(job);
      if (job === "E25") throw new Error("engine25 failed");
    },
    validate: () => ({ ok: true, ageMs: 0 }),
    now: () => NOW,
    engine29Job: "E29",
    engine25Job: "E25",
    engine29CanonicalFile: "canonical",
  }));
  assert.deepEqual(calls, ["E29", "E25"]);
});

run("12 ordering always Engine29 -> validation -> Engine25", () => {
  const order = [];
  runEngine29Then25({
    runJob: (job) => order.push(job),
    validate: () => {
      order.push("VALIDATE");
      return { ok: true, ageMs: 0 };
    },
    now: () => NOW,
    engine29Job: "ENGINE29",
    engine25Job: "ENGINE25",
    engine29CanonicalFile: "canonical",
  });
  assert.deepEqual(order, ["ENGINE29", "VALIDATE", "ENGINE25"]);
});

run("13 five-minute boundary passes; over five minutes fails", () => {
  const exact = tempFile("exact.json");
  const under = tempFile("under.json");
  const over = tempFile("over.json");

  writeCanonical(exact, { timestamp: new Date(NOW - MAX_ENGINE29_AGE_MS).toISOString() });
  writeCanonical(under, { timestamp: new Date(NOW - MAX_ENGINE29_AGE_MS + 1).toISOString() });
  writeCanonical(over, { timestamp: new Date(NOW - MAX_ENGINE29_AGE_MS - 1).toISOString() });

  assert.equal(validateEngine29Canonical({ filePath: exact, now: NOW }).ok, true);
  assert.equal(validateEngine29Canonical({ filePath: under, now: NOW }).ok, true);
  assert.equal(validateEngine29Canonical({ filePath: over, now: NOW }).ok, false);
  assert.equal(MAX_ENGINE29_AGE_MS, 300000);
});

console.log("Engine25 Engine29 Phase 3 orchestration tests PASS");
