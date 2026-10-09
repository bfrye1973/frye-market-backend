import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMicroNegotiatedMidlineConfluence,
} from "../logic/engine22/microV2/buildMicroNegotiatedMidlineConfluence.js";

function wave({
  activeWave = "W3",
  waveDirection = "UP",
  microTimingState = "TRANSITION_CONFIRMING",
} = {}) {
  return {
    microExecutionContext: {
      available: true,
      sourceCountId: "COUNT-1",
      canonicalStateVersion: 2,
      activeWave,
      waveDirection,
      microTimingState,
      countStatus: "ACTIVE",
    },
  };
}

function candidate(overrides = {}) {
  return {
    candidateId: "C1",
    zoneId: "Z1",
    currentPrice: 7831,
    currentObservationDirection: "LONG",
    activationRangePoints: 4,
    candidateLifecycleStartTime:
      "2026-10-09T15:00:00Z",
    strategyEligibility: {
      eligible: true,
    },
    location: {
      type: "NEGOTIATED",
    },
    entryZone: {
      low: 7820.75,
      midline: 7831,
      high: 7841.25,
    },
    ...overrides,
  };
}

test("W3 at negotiated midpoint publishes A++ trading happening", () => {
  const out =
    buildMicroNegotiatedMidlineConfluence({
      engine22WaveStrategy:
        wave(),
      engine26LocationCandidate:
        candidate(),
      currentPrice:
        7831,
      bars10m: [],
    });

  assert.equal(out.active, true);
  assert.equal(out.quality, "A++");
  assert.equal(
    out.displayLabel,
    "A++ TRADING HAPPENING"
  );

  assert.equal(
    out.activeWave,
    "W3"
  );

  assert.equal(
    out.currentExactContact,
    true
  );

  assert.equal(
    out.noPermissionCreated,
    true
  );

  assert.equal(
    out.noSetupGradeMutation,
    true
  );
});

for (const activeWave of [
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
]) {
  test(`${activeWave} can qualify when Micro is near negotiated midpoint`, () => {
    const out =
      buildMicroNegotiatedMidlineConfluence({
        engine22WaveStrategy:
          wave({
            activeWave,
          }),
        engine26LocationCandidate:
          candidate({
            currentPrice:
              7833.5,
          }),
        currentPrice:
          7833.5,
        bars10m: [],
      });

    assert.equal(
      out.active,
      true
    );

    assert.equal(
      out.quality,
      "A++"
    );

    assert.ok(
      out.reasonCodes.includes(
        `MICRO_${activeWave}_ACTIVE`
      )
    );
  });
}

test("completed 10m midpoint touch stays visible after price moves away", () => {
  const out =
    buildMicroNegotiatedMidlineConfluence({
      engine22WaveStrategy:
        wave({
          activeWave: "W3",
        }),
      engine26LocationCandidate:
        candidate({
          currentPrice:
            7862,
        }),
      currentPrice:
        7862,
      bars10m: [
        {
          time:
            Date.parse(
              "2026-10-09T15:10:00Z"
            ) / 1000,
          open: 7827,
          high: 7838,
          low: 7829,
          close: 7836,
          completed: true,
        },
        {
          time:
            Date.parse(
              "2026-10-09T15:20:00Z"
            ) / 1000,
          open: 7836,
          high: 7848,
          low: 7835,
          close: 7846,
          completed: true,
        },
      ],
    });

  assert.equal(
    out.completedMidlineTouch,
    true
  );

  assert.equal(
    out.midlineContactObserved,
    true
  );

  assert.equal(
    out.active,
    true
  );

  assert.equal(
    out.quality,
    "A++"
  );
});

test("invalidated Micro never gets A++ confluence", () => {
  const out =
    buildMicroNegotiatedMidlineConfluence({
      engine22WaveStrategy:
        wave({
          microTimingState:
            "INVALIDATED",
        }),
      engine26LocationCandidate:
        candidate(),
      currentPrice:
        7831,
    });

  assert.equal(
    out.active,
    false
  );

  assert.equal(
    out.quality,
    "NONE"
  );
});

test("A++ confluence never rewrites canonical Engine26 setupGrade", () => {
  const c =
    candidate({
      setupGrade:
        "A+++",
    });

  const before =
    structuredClone(c);

  const out =
    buildMicroNegotiatedMidlineConfluence({
      engine22WaveStrategy:
        wave(),
      engine26LocationCandidate:
        c,
      currentPrice:
        7831,
    });

  assert.equal(
    out.quality,
    "A++"
  );

  assert.deepEqual(
    c,
    before
  );

  assert.equal(
    c.setupGrade,
    "A+++"
  );
});
