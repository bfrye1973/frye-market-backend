import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreBreadthDiv,
  scoreSectorDiv,
  scoreNHNLDiv,
  scoreVolumeDiv,
  scoreInternalDivergence,
  scoreParticipationConfirmation,
  scoreBroadeningVelocity10,
  scoreBroadeningVelocity20,
  scoreESAbnormalityHorizon,
  scoreESAbnormalityQuality,
  scoreSqueezePressure,
  scoreSqueezeV2Internals,
} from "../logic/engine29/tacticalCharacter/squeezeV2Scoring.js";

function close(actual, expected, tolerance = 0.15) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("BreadthDiv follows locked 55-to-35 normalization", () => {
  close(scoreBreadthDiv({ direction: "UP", advancingBreadthPct: 55 }).score, 0);
  close(scoreBreadthDiv({ direction: "UP", advancingBreadthPct: 50 }).score, 25);
  close(scoreBreadthDiv({ direction: "UP", advancingBreadthPct: 45 }).score, 50);
  close(scoreBreadthDiv({ direction: "UP", advancingBreadthPct: 40 }).score, 75);
  close(scoreBreadthDiv({ direction: "UP", advancingBreadthPct: 35 }).score, 100);
});

test("BreadthDiv orients correctly for downside squeeze", () => {
  close(
    scoreBreadthDiv({
      direction: "DOWN",
      advancingBreadthPct: 70,
      decliningBreadthPct: 30,
    }).score,
    100,
  );
});

test("SectorDiv uses Engine25-owned strong/weak counts without reclassification", () => {
  close(scoreSectorDiv({ direction: "UP", strongSectorCount: 6, weakSectorCount: 2 }).score, 0);
  close(scoreSectorDiv({ direction: "UP", strongSectorCount: 3, weakSectorCount: 3 }).score, 25);
  close(scoreSectorDiv({ direction: "UP", strongSectorCount: 0, weakSectorCount: 7 }).score, 100);
});

test("SectorDiv reverses orientation for downside squeeze", () => {
  close(
    scoreSectorDiv({
      direction: "DOWN",
      strongSectorCount: 8,
      weakSectorCount: 1,
    }).score,
    100,
  );
  close(
    scoreSectorDiv({
      direction: "DOWN",
      strongSectorCount: 1,
      weakSectorCount: 8,
    }).score,
    0,
  );
});

test("NHNLDiv normalizes by total highs+lows and orients by direction", () => {
  const up = scoreNHNLDiv({ direction: "UP", newHighs: 100, newLows: 300 });
  close(up.nhnlRatio, -0.5, 0.0001);
  close(up.score, 100);

  const down = scoreNHNLDiv({ direction: "DOWN", newHighs: 100, newLows: 300 });
  close(down.directionalNHNL, 0.5, 0.0001);
  close(down.score, 0);
});

test("VolumeDiv remains secondary but deterministic", () => {
  close(
    scoreVolumeDiv({ direction: "UP", advancingVolumeShare: 55 }).score,
    0,
  );
  close(
    scoreVolumeDiv({ direction: "UP", advancingVolumeShare: 45 }).score,
    50,
  );
});

test("InternalDivergence uses locked 35/30/25/10 weights", () => {
  const result = scoreInternalDivergence({
    breadthDiv: 100,
    sectorDiv: 100,
    nhnlDiv: 100,
    volumeDiv: 0,
  });
  close(result.score, 90);
});

test("ParticipationConfirmation is current participation quality, not velocity", () => {
  close(scoreParticipationConfirmation(87.5).score, 12.5);
  close(scoreParticipationConfirmation(5.6).score, 94.4);
});

test("Broadening velocities are signed directional changes", () => {
  close(
    scoreBroadeningVelocity10({
      currentParticipation: 32.9,
      previousParticipation: 86.4,
    }).value,
    -53.5,
  );
  close(
    scoreBroadeningVelocity20({
      currentParticipation: 0,
      participationTwoObservationsAgo: 86.4,
    }).value,
    -86.4,
  );
});

test("ES abnormality horizon uses same-window median + MAD robust z mapping", () => {
  const result = scoreESAbnormalityHorizon({
    currentReturnPct: 0.30,
    historicalSameWindowReturnsPct: [0.08, 0.10, 0.12, 0.14, 0.16],
  });

  close(result.baselineMedianAbsReturnPct, 0.12, 0.000001);
  close(result.baselineMadAbsReturnPct, 0.02, 0.000001);
  assert.ok(result.robustZ > 3);
  close(result.quality, 100);
});

test("combined ES abnormality is locked 60% 10m / 40% 20m", () => {
  close(
    scoreESAbnormalityQuality({ quality10: 80, quality20: 50 }).score,
    68,
  );
});

test("SqueezePressure is multiplicative and weak ES cannot be rescued by bad internals", () => {
  close(
    scoreSqueezePressure({
      esAbnormalityQuality: 20,
      internalDivergence: 95,
    }).score,
    19,
  );

  close(
    scoreSqueezePressure({
      esAbnormalityQuality: 90,
      internalDivergence: 90,
    }).score,
    81,
  );
});

test("Oct 5 7:09 upside calibration is extreme divergence despite positive volume", () => {
  const result = scoreSqueezeV2Internals({
    advancingBreadthPct: 33.4,
    decliningBreadthPct: 66.6,
    strongSectorCount: 0,
    weakSectorCount: 7,
    newHighs: 1021,
    newLows: 1758,
    advancingVolumeShare: 58.4,
    decliningVolumeShare: 41.6,
  }, "UP");

  assert.equal(result.available, true);
  assert.ok(result.internalDivergence.score >= 80);
  assert.ok(result.participationConfirmation.score <= 20);
});

test("Oct 5 9:05 upside calibration is broad participation, not squeeze divergence", () => {
  const result = scoreSqueezeV2Internals({
    advancingBreadthPct: 78.0,
    decliningBreadthPct: 22.0,
    strongSectorCount: 6,
    weakSectorCount: 0,
    newHighs: 676,
    newLows: 424,
    advancingVolumeShare: 75.3,
    decliningVolumeShare: 24.7,
  }, "UP");

  assert.equal(result.available, true);
  close(result.internalDivergence.score, 0, 0.001);
  close(result.participationConfirmation.score, 100, 0.001);
});

test("missing canonical component fails closed without silent weight renormalization", () => {
  const result = scoreInternalDivergence({
    breadthDiv: 50,
    sectorDiv: 50,
    nhnlDiv: 50,
    volumeDiv: null,
  });

  assert.equal(result.available, false);
  assert.equal(result.score, null);
});
