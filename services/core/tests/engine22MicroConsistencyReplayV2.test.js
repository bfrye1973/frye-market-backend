import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalMicroState,
} from "../logic/engine22/microV2/canonicalMicroState.js";

import {
  buildMicroProjectionBundle,
  validateMicroProjectionConsistency,
} from "../logic/engine22/microV2/buildMicroProjectionBundle.js";

import {
  compareCanonicalMicroReplayEquivalence,
  processCanonicalMicroEventStream,
} from "../logic/engine22/microV2/processCanonicalMicroEventStream.js";

function initial() {
  return createCanonicalMicroState({
    countId:
      "ES-MICRO-COUNT-CONSISTENCY-1",
    sequenceId:
      "ES-MICRO-SEQUENCE-CONSISTENCY-1",
    sequenceDirection:
      "UP",
    origin: {
      price: 7782.75,
      source:
        "TEST_CANONICAL_ORIGIN",
    },
    parentDegree:
      "SUBMINUTE",
    parentWave:
      "W3",
    parentDirection:
      "UP",
    sourceTimestamp:
      "2026-10-09T14:00:00Z",
  });
}

function observations() {
  return [
    {
      type:
        "UPDATE_DEVELOPING_ANCHOR",
      wave: "W1",
      anchor: 7854,
      sourceTimestamp:
        "2026-10-09T14:05:00Z",
    },
    {
      type:
        "MARK_COMPLETION_CANDIDATE",
      wave: "W1",
      anchor: 7854,
      evidence: {
        timeframe: "5m",
        closed: true,
        sourceTimestamp:
          "2026-10-09T14:10:00Z",
        reasonCodes: [
          "ANCHOR_REJECTION",
          "FIVE_MIN_SWING_BREAK",
        ],
      },
    },
    {
      type:
        "CONFIRM_COMPLETION",
      wave: "W1",
      evidence: {
        timeframe: "5m",
        closed: true,
        sourceTimestamp:
          "2026-10-09T14:15:00Z",
        reasonCodes: [
          "FIVE_MIN_SWING_BREAK",
          "FIVE_MIN_DISPLACEMENT",
        ],
      },
    },
    {
      type: "LOCK_WAVE",
      wave: "W1",
      countId:
        "ES-MICRO-COUNT-CONSISTENCY-1",
      sourceTimestamp:
        "2026-10-09T14:15:01Z",
      nextWaveContextCreated:
        true,
    },
    {
      type:
        "INTRABAR_FIB_OBSERVATION",
      sourceTimestamp:
        "2026-10-09T14:16:00Z",
      rawHigh: 7834,
      rawLow: 7827,
      levels: [
        {
          key: "r236",
          label: "0.236",
          price: 7828.75,
        },
        {
          key: "r382",
          label: "0.382",
          price: 7820,
        },
      ],
    },
  ];
}

test("all Engine22 Micro projections carry one sourceCountId", () => {
  const canonical =
    processCanonicalMicroEventStream({
      initialState: initial(),
      events: observations(),
    }).state;

  const bundle =
    buildMicroProjectionBundle({
      canonicalState:
        canonical,
      degreeStates: {
        minute: {
          activeWave: "W3",
        },
      },
      currentWavelength: {
        degrees: {
          micro: {
            activeWave: "W2",
          },
        },
      },
      engine22Display: {
        degrees: {
          micro: {
            badge: "W2",
          },
        },
      },
    });

  assert.equal(
    bundle.available,
    true
  );

  const expected =
    canonical.countId;

  assert.equal(
    bundle.degreeStates.sourceCountId,
    expected
  );

  assert.equal(
    bundle.currentWavelength.sourceCountId,
    expected
  );

  assert.equal(
    bundle.microExecutionContext.sourceCountId,
    expected
  );

  assert.equal(
    bundle.engine22Display.sourceCountId,
    expected
  );

  const consistency =
    validateMicroProjectionConsistency({
      canonicalState:
        canonical,
      degreeStates:
        bundle.degreeStates,
      currentWavelength:
        bundle.currentWavelength,
      microExecutionContext:
        bundle.microExecutionContext,
      engine22Display:
        bundle.engine22Display,
    });

  assert.equal(
    consistency.ok,
    true
  );
});

test("mixed count projection fails closed", () => {
  const canonical =
    initial();

  const bundle =
    buildMicroProjectionBundle({
      canonicalState:
        canonical,
      degreeStates: {},
      currentWavelength: {},
      engine22Display: {},
    });

  bundle.currentWavelength.sourceCountId =
    "WRONG-COUNT";

  const consistency =
    validateMicroProjectionConsistency({
      canonicalState:
        canonical,
      degreeStates:
        bundle.degreeStates,
      currentWavelength:
        bundle.currentWavelength,
      microExecutionContext:
        bundle.microExecutionContext,
      engine22Display:
        bundle.engine22Display,
    });

  assert.equal(
    consistency.ok,
    false
  );

  assert.equal(
    consistency.mismatches[0].projection,
    "currentWavelength"
  );

  assert.ok(
    consistency.reasonCodes.includes(
      "FAIL_CLOSED"
    )
  );
});

test("live and Replay use the same reducer and finish byte-equivalent", () => {
  const liveStart =
    initial();

  const replayStart =
    initial();

  const result =
    compareCanonicalMicroReplayEquivalence({
      liveInitialState:
        liveStart,
      replayInitialState:
        replayStart,
      observations:
        observations(),
    });

  assert.equal(
    result.equivalent,
    true
  );

  assert.equal(
    result.live.activeWave,
    "W2"
  );

  assert.equal(
    result.live.waves.W2.fibState.lastTouchedFib.key,
    "r236"
  );

  assert.equal(
    result.live.waves.W2.lifecycle,
    "DEVELOPING"
  );
});

test("out-of-order stream observation is rejected without changing canonical state", () => {
  const events =
    observations();

  events.push({
    type:
      "UPDATE_DEVELOPING_ANCHOR",
    wave: "W2",
    anchor: 7819,
    sourceTimestamp:
      "2026-10-09T14:14:00Z",
  });

  const result =
    processCanonicalMicroEventStream({
      initialState:
        initial(),
      events,
    });

  const rejected =
    result.results.at(-1);

  assert.equal(
    rejected.applied,
    false
  );

  assert.ok(
    rejected.reasonCodes.includes(
      "OUT_OF_ORDER_MICRO_EVENT_STREAM"
    )
  );

  assert.equal(
    result.state.waves.W2.developingAnchor,
    null
  );
});

test("Fib touch and lifecycle evidence remain independently replayable", () => {
  const result =
    processCanonicalMicroEventStream({
      initialState:
        initial(),
      events:
        observations(),
    });

  assert.equal(
    result.state.waves.W2.fibState.lastTouchedFib.key,
    "r236"
  );

  assert.equal(
    result.state.waves.W2.lifecycle,
    "DEVELOPING"
  );

  const fibEvent =
    result.state.history.find(
      (entry) =>
        entry.eventType ===
        "INTRABAR_FIB_OBSERVATION"
    );

  assert.ok(fibEvent);

  assert.ok(
    fibEvent.reasonCodes.includes(
      "FIB_TOUCH_DOES_NOT_ADVANCE_LIFECYCLE"
    )
  );
});
