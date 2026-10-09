import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalMicroMigrationShadow,
} from "../logic/engine22/microV2/buildCanonicalMicroMigrationShadow.js";

function legacyW2() {
  return {
    origin: 7782.75,
    anchorProvenance: {
      source:
        "MANAGER_LOCKED_MICRO_W4_LOW",
      price: 7782.75,
      timestamp:
        "2026-10-08 07:00",
    },
    activeWave: "W2",
    candidateW1High: 7853.75,
    confirmedW1High: 7853.75,
    w1Completion: {
      state: "LOCKED",
      anchor: 7853.75,
      evidence: {
        timeframe: "5m",
        sourceTimestamp: 1791558000,
      },
      reasonCodes: [
        "ANCHOR_LOCKED_NO_REPAINT",
      ],
    },
    w2CandidateLow: 7827,
    w2Completion: {
      state: "DEVELOPING",
      anchor: null,
      evidence: {
        timeframe: "UNVERIFIED",
      },
      reasonCodes: [
        "AWAIT_FIVE_MIN_STRUCTURAL_EVIDENCE",
      ],
    },
    projectedW2: [
      {
        key: "r236",
        label: "0.236",
        price: 7837,
        status: "TOUCHED",
      },
      {
        key: "r382",
        label: "0.382",
        price: 7826.5,
        status: "WATCH",
      },
    ],
  };
}

test("legacy W2 production state bootstraps a non-authoritative V2 shadow", () => {
  const result =
    buildCanonicalMicroMigrationShadow({
      symbol: "ES",
      legacySequence:
        legacyW2(),
      currentPrice: 7845,
      sourceTimestamp:
        "2026-10-09T19:00:00Z",
      parentWave: "W3",
      parentDirection: "UP",
    });

  assert.equal(
    result.available,
    true
  );

  assert.equal(
    result.canonicalState.activeWave,
    "W2"
  );

  assert.equal(
    result.canonicalState.waves.W1.lifecycle,
    "LOCKED"
  );

  assert.equal(
    result.canonicalState.waves.W1.lockedAnchor,
    7853.75
  );

  assert.equal(
    result.canonicalState.waves.W2.lifecycle,
    "DEVELOPING"
  );

  assert.equal(
    result.comparison.status,
    "MATCH"
  );

  assert.equal(
    result.canonicalState.migration.automationEligible,
    false
  );
});

test("existing locked V2 state cannot regress from weaker legacy state", () => {
  const first =
    buildCanonicalMicroMigrationShadow({
      legacySequence:
        legacyW2(),
      sourceTimestamp:
        "2026-10-09T19:00:00Z",
    });

  const existing =
    first.canonicalState;

  existing.waves.W2.lifecycle =
    "LOCKED";

  existing.waves.W2.confirmedAnchor =
    7818;

  existing.waves.W2.lockedAnchor =
    7818;

  existing.activeWave =
    "W3";

  const legacy =
    legacyW2();

  const second =
    buildCanonicalMicroMigrationShadow({
      legacySequence:
        legacy,
      existingCanonicalState:
        existing,
      sourceTimestamp:
        "2026-10-09T19:05:00Z",
    });

  assert.equal(
    second.canonicalState.waves.W2.lifecycle,
    "LOCKED"
  );

  assert.equal(
    second.canonicalState.waves.W2.lockedAnchor,
    7818
  );

  assert.equal(
    second.canonicalState.activeWave,
    "W3"
  );

  assert.equal(
    second.comparison.status,
    "SHADOW_MISMATCH"
  );
});

test("migration count identity is stable for the same origin provenance", () => {
  const a =
    buildCanonicalMicroMigrationShadow({
      legacySequence:
        legacyW2(),
    });

  const b =
    buildCanonicalMicroMigrationShadow({
      legacySequence:
        legacyW2(),
    });

  assert.equal(
    a.canonicalState.countId,
    b.canonicalState.countId
  );

  assert.equal(
    a.canonicalState.sequenceId,
    b.canonicalState.sequenceId
  );
});
