import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { fileURLToPath } from "url";
import { buildReactionValidation5m } from "../logic/engine3/buildReactionValidation5m.js";

const START = 1_700_000_000;
const identity = {
  symbol: "ES", laneId: "minute", strategyId: "intraday_scalp@10m",
  candidateId: "candidate-1", zoneId: "zone-1",
  setupClass: "NEGOTIATED_ZONE_ROTATION", setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
  contactState: "NEGOTIATED_LINE_CONTACT", chainArmed: true,
  authorizeEngine3Evaluation: true, zone: { lo: 99, hi: 100 },
};

function fiveBars(direction) {
  return direction === "LONG"
    ? [{ time: START - 300, open: 99, high: 100, low: 98.5, close: 99 }, { time: START, open: 99, high: 101, low: 98, close: 101 }]
    : [{ time: START - 300, open: 100, high: 101, low: 99, close: 100 }, { time: START, open: 100, high: 100.5, low: 98, close: 98.5 }];
}

function observation(direction = "LONG", overrides = {}) {
  return { active: true, direction, barEnd: START * 1000 + 300_000, ...identity, ...overrides };
}

function validate(fiveDirection, oneDirection = fiveDirection, overrides = {}) {
  return buildReactionValidation5m({
    bars: fiveBars(fiveDirection),
    evaluationTimeMs: START * 1000 + 300_000,
    observation1m: observation(oneDirection, overrides.observation),
    engine26LocationCandidate: overrides.candidate || identity,
    engine26ReactionHandoff: overrides.handoff || identity,
  });
}

test("LONG/LONG and SHORT/SHORT publish support", () => {
  assert.equal(validate("LONG").validationState, "SUPPORT");
  assert.equal(validate("SHORT").validationState, "SUPPORT");
});

test("LONG/SHORT publishes conflict", () => {
  const result = validate("SHORT", "LONG");
  assert.equal(result.validationState, "CONFLICT");
  assert.equal(result.conflictsWith1mDirection, true);
});

test("candidate and zone mismatch block alignment", () => {
  assert.equal(validate("LONG", "LONG", { observation: { candidateId: "old" } }).validationState, "IDENTITY_MISMATCH");
  assert.equal(validate("LONG", "LONG", { observation: { zoneId: "old" } }).validationState, "IDENTITY_MISMATCH");
});

test("stale or skewed 5m cannot validate 1m and inputs are not mutated", () => {
  const input = fiveBars("LONG");
  const before = structuredClone(input);
  const result = buildReactionValidation5m({
    bars: input,
    evaluationTimeMs: START * 1000 + 1_000_000,
    observation1m: observation("LONG", { barEnd: START * 1000 + 1_000_000 }),
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });
  assert.equal(result.validationState, "STALE");
  assert.equal(result.supports1mDirection, false);
  assert.deepEqual(input, before);
});

test("snapshot attachment is additive and canonical authority builders are unchanged", () => {
  const snapshotPath = fileURLToPath(new URL("../jobs/buildStrategySnapshot.js", import.meta.url));
  const source = fs.readFileSync(snapshotPath, "utf8");
  assert.match(source, /engine3ReactionObservation1m,/);
  assert.match(source, /engine3ReactionValidation5m,/);
  assert.match(source, /attachPaperScalpReactionToConfluence/);
  assert.doesNotMatch(source, /engine3ReactionObservation1m[\s\S]{0,200}\.allowed\s*=/);
});
