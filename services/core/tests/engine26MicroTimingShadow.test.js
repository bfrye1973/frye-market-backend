import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine26MicroTimingShadow,
} from "../logic/engine26/strategy1/buildEngine26MicroTimingShadow.js";

function wave(overrides = {}) {
  return {
    microExecutionContext: {
      sourceCountId: "COUNT-1",
      sequenceId: "SEQ-1",
      canonicalStateVersion: 2,
      sourceTimestamp:
        "2026-10-09T19:00:00Z",
      activeWave: "W2",
      waveDirection: "DOWN",
      lifecycle: "DEVELOPING",
      microTimingState:
        "SETUP_DEVELOPING",
      countStatus: "ACTIVE",
      automationEligible: false,
      origin: {
        price: 7782.75,
      },
      lockedWaveAnchor: {
        wave: "W1",
        price: 7853.75,
      },
      lastTouchedFib: {
        key: "r236",
        price: 7837,
      },
      nextFib: {
        key: "r382",
        price: 7826.5,
      },
      ...overrides,
    },
  };
}

function candidate() {
  return {
    candidateId: "CAND-1",
    zoneId: "ZONE-1",
    currentObservationDirection:
      "NEUTRAL",
  };
}

test("Engine26 Micro timing shadow is read-only and blocked while producer is shadow-only", () => {
  const result =
    buildEngine26MicroTimingShadow({
      engine22WaveStrategy:
        wave(),
      engine26LocationCandidate:
        candidate(),
    });

  assert.equal(result.available, true);
  assert.equal(result.mode, "SHADOW_ONLY");
  assert.equal(result.sourceCountId, "COUNT-1");
  assert.equal(result.activeWave, "W2");
  assert.equal(result.waveDirection, "DOWN");
  assert.equal(result.productionTimingEligible, false);

  for (const key of [
    "affectsCandidate",
    "affectsIdentity",
    "affectsLocation",
    "affectsReactionEligibility",
    "affectsPermission",
    "affectsSizing",
    "affectsManagement",
    "affectsExecution",
    "affectsJournal",
  ]) {
    assert.equal(result[key], false);
  }
});

test("TIMING_READY remains blocked until Engine22 explicitly authorizes automation", () => {
  const shadow =
    buildEngine26MicroTimingShadow({
      engine22WaveStrategy:
        wave({
          lifecycle:
            "DEVELOPING",
          microTimingState:
            "TIMING_READY",
          automationEligible:
            false,
        }),
      engine26LocationCandidate:
        candidate(),
    });

  assert.equal(
    shadow.structuralTimingReady,
    true
  );

  assert.equal(
    shadow.productionTimingEligible,
    false
  );

  assert.ok(
    shadow.reasonCodes.includes(
      "ENGINE22_PRODUCER_AUTOMATION_NOT_ELIGIBLE"
    )
  );
});

test("candidate direction comparison is diagnostic only", () => {
  const result =
    buildEngine26MicroTimingShadow({
      engine22WaveStrategy:
        wave({
          waveDirection: "DOWN",
        }),
      engine26LocationCandidate: {
        ...candidate(),
        currentObservationDirection:
          "SHORT",
      },
    });

  assert.equal(
    result.candidateObservation
      .comparisonToMicroWave,
    "SAME_DIRECTION_DIAGNOSTIC_ONLY"
  );

  assert.equal(
    result.affectsCandidate,
    false
  );

  assert.equal(
    result.affectsPermission,
    false
  );
});

test("missing Engine22 Micro contract fails closed", () => {
  const result =
    buildEngine26MicroTimingShadow({
      engine22WaveStrategy: {},
      engine26LocationCandidate:
        candidate(),
    });

  assert.equal(result.available, false);
  assert.equal(result.affectsCandidate, false);
  assert.equal(result.affectsPermission, false);
  assert.equal(result.affectsExecution, false);
});
