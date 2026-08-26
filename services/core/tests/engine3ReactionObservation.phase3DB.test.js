import test from "node:test";
import assert from "node:assert/strict";
import { buildReactionObservation1m } from "../logic/engine3/buildReactionObservation1m.js";

const START = 1_700_000_000;
const identity = {
  symbol: "ES",
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "candidate-1",
  zoneId: "zone-1",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
  contactState: "NEGOTIATED_LINE_CONTACT",
  chainArmed: true,
  authorizeEngine3Evaluation: true,
  zone: { lo: 99, hi: 100 },
};

function bars() {
  return [
    { time: START - 60, open: 99, high: 100, low: 98.5, close: 99, volume: 10 },
    { time: START, open: 99, high: 101, low: 98, close: 101, volume: 20 },
  ];
}

test("1m observation preserves Engine 26 identity and remains diagnostic", () => {
  const result = buildReactionObservation1m({
    bars: bars(),
    evaluationTimeMs: START * 1000 + 60_000,
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });
  for (const field of ["symbol", "laneId", "strategyId", "candidateId", "zoneId", "setupClass", "setupGrade", "identitySetupKey", "candidateIdentityVersion", "contactState", "chainArmed", "authorizeEngine3Evaluation"]) {
    assert.equal(result[field], identity[field]);
  }
  assert.equal(result.direction, "LONG");
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.noPermissionCreated, true);
  assert.equal("allowed" in result, false);
});

test("1m forming/completed state is truthful and inputs are not mutated", () => {
  const input = bars();
  const before = structuredClone(input);
  const forming = buildReactionObservation1m({ bars: input, evaluationTimeMs: START * 1000 + 59_999, engine26LocationCandidate: identity, engine26ReactionHandoff: identity });
  const completed = buildReactionObservation1m({ bars: input, evaluationTimeMs: START * 1000 + 60_000, engine26LocationCandidate: identity, engine26ReactionHandoff: identity });
  assert.equal(forming.candleState, "FORMING");
  assert.equal(completed.candleState, "COMPLETED");
  assert.deepEqual(input, before);
});

test("1m quality GOOD SHORT comes from newest completed pair only", () => {
  const input = [
    { time: START - 120, open: 100, high: 102, low: 99, close: 100, volume: 10 },
    { time: START - 60, open: 100, high: 102.5, low: 99.5, close: 101, volume: 10 },
    { time: START, open: 101, high: 101.5, low: 98.5, close: 100, volume: 10 },
  ];

  const result = buildReactionObservation1m({
    bars: input,
    evaluationTimeMs: START * 1000 + 60_000,
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });

  assert.equal(result.direction, "SHORT");
  assert.equal(result.quality, "GOOD");
});

test("1m quality STRONG SHORT requires both latest completed pairs SHORT", () => {
  const input = [
    { time: START - 120, open: 102, high: 102.5, low: 100, close: 102, volume: 10 },
    { time: START - 60, open: 102, high: 102, low: 99.5, close: 101, volume: 10 },
    { time: START, open: 101.5, high: 101.5, low: 99, close: 100, volume: 10 },
  ];

  const result = buildReactionObservation1m({
    bars: input,
    evaluationTimeMs: START * 1000 + 60_000,
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });

  assert.equal(result.direction, "SHORT");
  assert.equal(result.quality, "STRONG");
});

test("1m quality GOOD LONG comes from newest completed pair only", () => {
  const input = [
    { time: START - 120, open: 100, high: 101.5, low: 98.5, close: 100, volume: 10 },
    { time: START - 60, open: 100, high: 100.5, low: 98, close: 99, volume: 10 },
    { time: START, open: 99, high: 101, low: 98.5, close: 100, volume: 10 },
  ];

  const result = buildReactionObservation1m({
    bars: input,
    evaluationTimeMs: START * 1000 + 60_000,
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });

  assert.equal(result.direction, "LONG");
  assert.equal(result.quality, "GOOD");
});

test("1m quality STRONG LONG requires both latest completed pairs LONG", () => {
  const input = [
    { time: START - 120, open: 98, high: 99, low: 97.5, close: 98, volume: 10 },
    { time: START - 60, open: 98, high: 100, low: 97.5, close: 99, volume: 10 },
    { time: START, open: 99, high: 101, low: 98, close: 100, volume: 10 },
  ];

  const result = buildReactionObservation1m({
    bars: input,
    evaluationTimeMs: START * 1000 + 60_000,
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });

  assert.equal(result.direction, "LONG");
  assert.equal(result.quality, "STRONG");
});

test("legacy currentLevelAction quality cannot downgrade canonical 1m STRONG", () => {
  const input = [
    { time: START - 120, open: 101, high: 102, low: 100, close: 101, volume: 10 },
    { time: START - 60, open: 101, high: 101.5, low: 99.5, close: 100, volume: 10 },
    { time: START, open: 100.5, high: 101, low: 99, close: 99.5, volume: 10 },
  ];

  const result = buildReactionObservation1m({
    bars: input,
    evaluationTimeMs: START * 1000 + 60_000,
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });

  assert.equal(result.direction, "SHORT");
  assert.equal(result.quality, "STRONG");
  assert.notEqual(result.levelActionQuality, result.quality);
});

test("1m quality WEAK when newest completed pair has no qualifying direction", () => {
  const input = [
    { time: START - 60, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { time: START, open: 100, high: 100.5, low: 99.5, close: 100, volume: 10 },
  ];

  const result = buildReactionObservation1m({
    bars: input,
    evaluationTimeMs: START * 1000 + 60_000,
    engine26LocationCandidate: identity,
    engine26ReactionHandoff: identity,
  });

  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.quality, "WEAK");
});
