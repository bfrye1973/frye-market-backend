import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreBroadeningVelocity10,
  scoreBroadeningVelocity20,
  scoreESAbnormalityQuality,
  scoreInternalDivergence,
  scoreParticipationConfirmation,
  scoreSqueezePressure,
  scoreSqueezeV2Internals,
} from "../logic/engine29/tacticalCharacter/squeezeV2Scoring.js";

function squeezeSnapshot({
  advancingBreadthPct,
  strong,
  weak,
  newHighs,
  newLows,
  advancingVolumeShare,
}) {
  return {
    advancingBreadthPct,
    decliningBreadthPct: 100 - advancingBreadthPct,
    strongSectorCount: strong,
    neutralSectorCount: 11 - strong - weak,
    weakSectorCount: weak,
    newHighs,
    newLows,
    advancingVolumeShare,
    decliningVolumeShare: 100 - advancingVolumeShare,
  };
}

function scoreScenario(snapshot, direction, es10Quality, es20Quality) {
  const internals = scoreSqueezeV2Internals(snapshot, direction);
  const es = scoreESAbnormalityQuality({
    quality10: es10Quality,
    quality20: es20Quality,
  });
  const pressure = scoreSqueezePressure({
    esAbnormalityQuality: es.score,
    internalDivergence: internals.internalDivergence.score,
  });

  return { internals, es, pressure };
}

test("synthetic 1: terrible internals without abnormal ES cannot manufacture upside squeeze", () => {
  const result = scoreScenario(
    squeezeSnapshot({
      advancingBreadthPct: 25,
      strong: 0,
      weak: 10,
      newHighs: 250,
      newLows: 1750,
      advancingVolumeShare: 30,
    }),
    "UP",
    8,
    10,
  );

  assert.equal(result.internals.available, true);
  assert.ok(result.internals.internalDivergence.score >= 95);
  assert.ok(result.pressure.score < 12);
});

test("synthetic 2: abnormal ES plus healthy broad internals is broad move evidence, not squeeze pressure", () => {
  const result = scoreScenario(
    squeezeSnapshot({
      advancingBreadthPct: 80,
      strong: 9,
      weak: 0,
      newHighs: 1200,
      newLows: 200,
      advancingVolumeShare: 78,
    }),
    "UP",
    95,
    90,
  );

  assert.ok(result.es.score >= 90);
  assert.ok(result.internals.internalDivergence.score <= 1);
  assert.ok(result.internals.participationConfirmation.score >= 99);
  assert.ok(result.pressure.score <= 1);
});

test("synthetic 3: abnormal ES plus severe upside divergence generates high squeeze pressure", () => {
  const result = scoreScenario(
    squeezeSnapshot({
      advancingBreadthPct: 31,
      strong: 1,
      weak: 9,
      newHighs: 500,
      newLows: 1500,
      advancingVolumeShare: 38,
    }),
    "UP",
    95,
    85,
  );

  assert.ok(result.internals.internalDivergence.score >= 90);
  assert.ok(result.pressure.score >= 80);
});

test("synthetic 4: abnormal downside ES plus severe downside participation failure generates high downside squeeze pressure", () => {
  // For a DOWN squeeze, directional participation is declining breadth / declining volume.
  // Here the market underneath is still mostly advancing, so DOWN ES is disconnected.
  const result = scoreScenario(
    squeezeSnapshot({
      advancingBreadthPct: 76,
      strong: 8,
      weak: 1,
      newHighs: 1300,
      newLows: 300,
      advancingVolumeShare: 74,
    }),
    "DOWN",
    92,
    88,
  );

  assert.ok(result.internals.internalDivergence.score >= 85);
  assert.ok(result.pressure.score >= 75);
});

test("synthetic 5: positive directional volume cannot veto an otherwise extreme upside squeeze signature", () => {
  const result = scoreScenario(
    squeezeSnapshot({
      advancingBreadthPct: 32,
      strong: 0,
      weak: 8,
      newHighs: 600,
      newLows: 1500,
      advancingVolumeShare: 62,
    }),
    "UP",
    90,
    80,
  );

  assert.equal(result.internals.volume.score, 0);
  assert.ok(result.internals.internalDivergence.score >= 75);
  assert.ok(result.pressure.score >= 60);
});

test("synthetic 6: participation collapse produces strongly negative broadening velocity", () => {
  const bv10 = scoreBroadeningVelocity10({
    previousParticipation: 86,
    currentParticipation: 34,
  });
  const bv20 = scoreBroadeningVelocity20({
    participationTwoObservationsAgo: 92,
    currentParticipation: 34,
  });

  assert.equal(bv10.available, true);
  assert.equal(bv20.available, true);
  assert.ok(bv10.value <= -50);
  assert.ok(bv20.value <= -55);
});

test("synthetic 7: participation catch-up produces strongly positive broadening velocity", () => {
  const bv10 = scoreBroadeningVelocity10({
    previousParticipation: 25,
    currentParticipation: 58,
  });
  const bv20 = scoreBroadeningVelocity20({
    participationTwoObservationsAgo: 18,
    currentParticipation: 76,
  });

  assert.ok(bv10.value >= 30);
  assert.ok(bv20.value >= 55);
});

test("synthetic 8: broadening velocity alone does not create squeeze pressure", () => {
  const bv20 = scoreBroadeningVelocity20({
    participationTwoObservationsAgo: 15,
    currentParticipation: 80,
  });
  const pressure = scoreSqueezePressure({
    esAbnormalityQuality: 5,
    internalDivergence: 20,
  });

  assert.ok(bv20.value >= 60);
  assert.ok(pressure.score <= 1);
});

test("synthetic 9: missing canonical breadth fails the full internals score closed", () => {
  const snapshot = squeezeSnapshot({
    advancingBreadthPct: 40,
    strong: 2,
    weak: 7,
    newHighs: 500,
    newLows: 1200,
    advancingVolumeShare: 42,
  });
  snapshot.advancingBreadthPct = null;

  const result = scoreSqueezeV2Internals(snapshot, "UP");

  assert.equal(result.available, false);
  assert.equal(result.breadth.available, false);
  assert.equal(result.internalDivergence.available, false);
});

test("synthetic 10: missing one weighted component never silently renormalizes remaining weights", () => {
  const result = scoreInternalDivergence({
    breadthDiv: 100,
    sectorDiv: 100,
    nhnlDiv: 100,
    volumeDiv: undefined,
  });

  assert.equal(result.available, false);
  assert.equal(result.score, null);
});

test("synthetic 11: opposite direction uses the opposite Engine25 participation side", () => {
  const snapshot = squeezeSnapshot({
    advancingBreadthPct: 75,
    strong: 8,
    weak: 1,
    newHighs: 1000,
    newLows: 250,
    advancingVolumeShare: 72,
  });

  const up = scoreSqueezeV2Internals(snapshot, "UP");
  const down = scoreSqueezeV2Internals(snapshot, "DOWN");

  assert.ok(up.internalDivergence.score < down.internalDivergence.score);
  assert.ok(up.participationConfirmation.score > down.participationConfirmation.score);
});

test("synthetic 12: low divergence and high participation are exact complements", () => {
  const internal = scoreInternalDivergence({
    breadthDiv: 20,
    sectorDiv: 30,
    nhnlDiv: 10,
    volumeDiv: 40,
  });
  const participation = scoreParticipationConfirmation(internal.score);

  assert.ok(Math.abs((internal.score + participation.score) - 100) < 1e-9);
});

test("synthetic 13: strong 10m but weak 20m ES quality stays below full abnormality", () => {
  const result = scoreESAbnormalityQuality({
    quality10: 100,
    quality20: 10,
  });

  assert.equal(result.available, true);
  assert.equal(result.score, 64);
  assert.ok(result.score < 70);
});

test("synthetic 14: squeeze pressure is bounded at 0-100", () => {
  const high = scoreSqueezePressure({
    esAbnormalityQuality: 100,
    internalDivergence: 100,
  });
  const zero = scoreSqueezePressure({
    esAbnormalityQuality: 0,
    internalDivergence: 100,
  });

  assert.equal(high.score, 100);
  assert.equal(zero.score, 0);
});
