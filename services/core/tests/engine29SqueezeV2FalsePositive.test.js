import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreESAbnormalityQuality,
  scoreSqueezePressure,
  scoreSqueezeV2Internals,
  scoreBroadeningVelocity10,
  scoreBroadeningVelocity20,
} from "../logic/engine29/tacticalCharacter/squeezeV2Scoring.js";

function snapshot({
  advancingBreadthPct,
  strong,
  neutral,
  weak,
  newHighs,
  newLows,
  advancingVolumeShare,
}) {
  return {
    advancingBreadthPct,
    decliningBreadthPct: 100 - advancingBreadthPct,
    strongSectorCount: strong,
    neutralSectorCount: neutral,
    weakSectorCount: weak,
    newHighs,
    newLows,
    advancingVolumeShare,
    decliningVolumeShare: 100 - advancingVolumeShare,
  };
}

function scoreCase({ snap, direction, q10, q20 }) {
  const internals = scoreSqueezeV2Internals(snap, direction);
  const es = scoreESAbnormalityQuality({ quality10: q10, quality20: q20 });
  const pressure = scoreSqueezePressure({
    esAbnormalityQuality: es.score,
    internalDivergence: internals.internalDivergence.score,
  });
  return { internals, es, pressure };
}

test("FP1 fast healthy upside rally does not become squeeze", () => {
  const result = scoreCase({
    direction: "UP",
    q10: 95,
    q20: 90,
    snap: snapshot({
      advancingBreadthPct: 79,
      strong: 8,
      neutral: 3,
      weak: 0,
      newHighs: 1100,
      newLows: 220,
      advancingVolumeShare: 76,
    }),
  });

  assert.ok(result.es.score >= 90);
  assert.ok(result.internals.participationConfirmation.score >= 95);
  assert.ok(result.pressure.score <= 5);
});

test("FP2 fast healthy downside selloff does not become downside squeeze", () => {
  const result = scoreCase({
    direction: "DOWN",
    q10: 94,
    q20: 92,
    snap: snapshot({
      advancingBreadthPct: 24,
      strong: 0,
      neutral: 2,
      weak: 9,
      newHighs: 200,
      newLows: 1200,
      advancingVolumeShare: 25,
    }),
  });

  assert.ok(result.es.score >= 90);
  assert.ok(result.internals.participationConfirmation.score >= 95);
  assert.ok(result.pressure.score <= 5);
});

test("FP3 weak internals plus flat ES remains non-squeeze", () => {
  const result = scoreCase({
    direction: "UP",
    q10: 0,
    q20: 0,
    snap: snapshot({
      advancingBreadthPct: 28,
      strong: 1,
      neutral: 1,
      weak: 9,
      newHighs: 300,
      newLows: 1400,
      advancingVolumeShare: 34,
    }),
  });

  assert.ok(result.internals.internalDivergence.score >= 90);
  assert.equal(result.pressure.score, 0);
});

test("FP4 broadening catch-up after narrow start collapses squeeze pressure", () => {
  const early = scoreCase({
    direction: "UP",
    q10: 90,
    q20: 85,
    snap: snapshot({
      advancingBreadthPct: 34,
      strong: 0,
      neutral: 4,
      weak: 7,
      newHighs: 500,
      newLows: 1500,
      advancingVolumeShare: 55,
    }),
  });

  const later = scoreCase({
    direction: "UP",
    q10: 85,
    q20: 80,
    snap: snapshot({
      advancingBreadthPct: 74,
      strong: 7,
      neutral: 4,
      weak: 0,
      newHighs: 1000,
      newLows: 250,
      advancingVolumeShare: 72,
    }),
  });

  assert.ok(early.pressure.score >= 65);
  assert.ok(later.pressure.score <= 5);
  assert.ok(later.internals.participationConfirmation.score >= 95);
});

test("FP5 improving participation is broadening, not fresh squeeze evidence", () => {
  const bv10 = scoreBroadeningVelocity10({
    previousParticipation: 28,
    currentParticipation: 62,
  });
  const bv20 = scoreBroadeningVelocity20({
    participationTwoObservationsAgo: 18,
    currentParticipation: 78,
  });

  assert.ok(bv10.value >= 30);
  assert.ok(bv20.value >= 50);
});

test("FP6 deteriorating participation alone cannot create squeeze without ES gate", () => {
  const bv10 = scoreBroadeningVelocity10({
    previousParticipation: 88,
    currentParticipation: 35,
  });

  const result = scoreCase({
    direction: "UP",
    q10: 5,
    q20: 8,
    snap: snapshot({
      advancingBreadthPct: 39,
      strong: 2,
      neutral: 2,
      weak: 7,
      newHighs: 450,
      newLows: 1300,
      advancingVolumeShare: 40,
    }),
  });

  assert.ok(bv10.value <= -50);
  assert.ok(result.pressure.score < 10);
});

test("FP7 strong one-bar ES burst with healthy 20m context stays below active squeeze quality", () => {
  const result = scoreCase({
    direction: "UP",
    q10: 100,
    q20: 15,
    snap: snapshot({
      advancingBreadthPct: 43,
      strong: 3,
      neutral: 3,
      weak: 5,
      newHighs: 520,
      newLows: 800,
      advancingVolumeShare: 49,
    }),
  });

  assert.equal(result.es.score, 66);
  assert.ok(result.pressure.score < 50);
});

test("FP8 reversal with broad confirmation in new direction is broad move, not squeeze", () => {
  const down = scoreCase({
    direction: "DOWN",
    q10: 90,
    q20: 85,
    snap: snapshot({
      advancingBreadthPct: 27,
      strong: 1,
      neutral: 1,
      weak: 9,
      newHighs: 220,
      newLows: 1100,
      advancingVolumeShare: 26,
    }),
  });

  assert.ok(down.internals.participationConfirmation.score >= 90);
  assert.ok(down.pressure.score <= 10);
});

test("FP9 mixed internals should produce middle score, not extreme squeeze", () => {
  const result = scoreCase({
    direction: "UP",
    q10: 80,
    q20: 75,
    snap: snapshot({
      advancingBreadthPct: 50,
      strong: 4,
      neutral: 4,
      weak: 3,
      newHighs: 700,
      newLows: 650,
      advancingVolumeShare: 53,
    }),
  });

  assert.ok(result.internals.internalDivergence.score > 10);
  assert.ok(result.internals.internalDivergence.score < 50);
  assert.ok(result.pressure.score < 40);
});

test("FP10 healthy broad move remains non-squeeze even with maximal ES abnormality", () => {
  const result = scoreCase({
    direction: "UP",
    q10: 100,
    q20: 100,
    snap: snapshot({
      advancingBreadthPct: 85,
      strong: 10,
      neutral: 1,
      weak: 0,
      newHighs: 1500,
      newLows: 100,
      advancingVolumeShare: 82,
    }),
  });

  assert.equal(result.es.score, 100);
  assert.equal(result.internals.internalDivergence.score, 0);
  assert.equal(result.pressure.score, 0);
});

test("FP11 healthy broad downside move remains non-squeeze even with maximal ES abnormality", () => {
  const result = scoreCase({
    direction: "DOWN",
    q10: 100,
    q20: 100,
    snap: snapshot({
      advancingBreadthPct: 15,
      strong: 0,
      neutral: 1,
      weak: 10,
      newHighs: 100,
      newLows: 1500,
      advancingVolumeShare: 18,
    }),
  });

  assert.equal(result.es.score, 100);
  assert.equal(result.internals.internalDivergence.score, 0);
  assert.equal(result.pressure.score, 0);
});

test("FP12 strong participation confirmation prevents stale squeeze label after broadening", () => {
  const result = scoreCase({
    direction: "UP",
    q10: 88,
    q20: 84,
    snap: snapshot({
      advancingBreadthPct: 71,
      strong: 7,
      neutral: 4,
      weak: 0,
      newHighs: 950,
      newLows: 280,
      advancingVolumeShare: 70,
    }),
  });

  assert.ok(result.internals.participationConfirmation.score >= 90);
  assert.ok(result.pressure.score <= 10);
});
