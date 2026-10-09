import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalMicroState,
} from "../logic/engine22/microV2/canonicalMicroState.js";

import {
  applyCanonicalMicroIntrabarFibObservation,
} from "../logic/engine22/microV2/applyCanonicalMicroIntrabarFibObservation.js";

function w2State() {
  const state =
    createCanonicalMicroState({
      countId: "COUNT-W2",
      sequenceId: "SEQ-W2",
      sequenceDirection: "UP",
      origin: {
        price: 7782.75,
      },
      parentDegree: "SUBMINUTE",
      parentWave: "W3",
      parentDirection: "UP",
      sourceTimestamp:
        "2026-10-09T14:00:00Z",
    });

  state.waves.W1.lifecycle =
    "LOCKED";
  state.waves.W1.lockedAnchor =
    7843;
  state.waves.W1.confirmedAnchor =
    7843;
  state.activeWave =
    "W2";
  state.waves.W2.startedAt =
    "2026-10-09T14:00:00Z";

  return state;
}

const W2_LEVELS = [
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
  {
    key: "r500",
    label: "0.500",
    price: 7812.75,
  },
];

test("W2 wick through .236 marks .236 touched and leaves deeper fibs watch", () => {
  const before =
    w2State();

  const result =
    applyCanonicalMicroIntrabarFibObservation(
      before,
      {
        sourceTimestamp:
          "2026-10-09T14:05:00Z",
        rawHigh: 7834,
        rawLow: 7827,
        levels: W2_LEVELS,
      }
    );

  assert.equal(
    result.applied,
    true
  );

  const fib =
    result.state.waves.W2.fibState;

  assert.equal(
    fib.levels.find(
      (level) =>
        level.key === "r236"
    ).status,
    "TOUCHED"
  );

  assert.equal(
    fib.levels.find(
      (level) =>
        level.key === "r382"
    ).status,
    "WATCH"
  );

  assert.equal(
    fib.lastTouchedFib.key,
    "r236"
  );

  assert.equal(
    fib.nextFib.key,
    "r382"
  );
});

test("Fib touch cannot change lifecycle or active wave", () => {
  const before =
    w2State();

  const lifecycleBefore =
    before.waves.W2.lifecycle;

  const result =
    applyCanonicalMicroIntrabarFibObservation(
      before,
      {
        sourceTimestamp:
          "2026-10-09T14:05:00Z",
        rawLow: 7827,
        levels: W2_LEVELS,
      }
    );

  assert.equal(
    result.state.activeWave,
    "W2"
  );

  assert.equal(
    result.state.waves.W2.lifecycle,
    lifecycleBefore
  );

  assert.ok(
    result.reasonCodes.includes(
      "FIB_TOUCH_DOES_NOT_ADVANCE_LIFECYCLE"
    )
  );
});

test("touched Fib remains touched after later bounce", () => {
  let state =
    w2State();

  state =
    applyCanonicalMicroIntrabarFibObservation(
      state,
      {
        sourceTimestamp:
          "2026-10-09T14:05:00Z",
        rawLow: 7827,
        levels: W2_LEVELS,
      }
    ).state;

  state =
    applyCanonicalMicroIntrabarFibObservation(
      state,
      {
        sourceTimestamp:
          "2026-10-09T14:06:00Z",
        rawLow: 7832,
        levels: W2_LEVELS,
      }
    ).state;

  assert.equal(
    state.waves.W2.fibState.levels.find(
      (level) =>
        level.key === "r236"
    ).status,
    "TOUCHED"
  );
});

test("duplicate and out-of-order raw observations fail closed", () => {
  let state =
    w2State();

  state =
    applyCanonicalMicroIntrabarFibObservation(
      state,
      {
        sourceTimestamp:
          "2026-10-09T14:05:00Z",
        rawLow: 7827,
        levels: W2_LEVELS,
      }
    ).state;

  const duplicate =
    applyCanonicalMicroIntrabarFibObservation(
      state,
      {
        sourceTimestamp:
          "2026-10-09T14:05:00Z",
        rawLow: 7826,
        levels: W2_LEVELS,
      }
    );

  assert.equal(
    duplicate.applied,
    false
  );

  assert.ok(
    duplicate.reasonCodes.includes(
      "DUPLICATE_INTRABAR_OBSERVATION"
    )
  );

  const outOfOrder =
    applyCanonicalMicroIntrabarFibObservation(
      state,
      {
        sourceTimestamp:
          "2026-10-09T14:04:00Z",
        rawLow: 7820,
        levels: W2_LEVELS,
      }
    );

  assert.equal(
    outOfOrder.applied,
    false
  );

  assert.ok(
    outOfOrder.reasonCodes.includes(
      "OUT_OF_ORDER_INTRABAR_OBSERVATION"
    )
  );
});

test("UP-wave Fib touch uses raw high rather than raw low", () => {
  const state =
    createCanonicalMicroState({
      countId: "COUNT-W1",
      sequenceId: "SEQ-W1",
      sequenceDirection: "UP",
      origin: {
        price: 7782.75,
      },
      sourceTimestamp:
        "2026-10-09T14:00:00Z",
    });

  const result =
    applyCanonicalMicroIntrabarFibObservation(
      state,
      {
        sourceTimestamp:
          "2026-10-09T14:01:00Z",
        rawHigh: 7848,
        rawLow: 7830,
        levels: [
          {
            key: "e500",
            label: "0.500",
            price: 7847.75,
          },
          {
            key: "e618",
            label: "0.618",
            price: 7863,
          },
        ],
      }
    );

  assert.equal(
    result.state.waves.W1.fibState.levels[0].status,
    "TOUCHED"
  );

  assert.equal(
    result.state.waves.W1.fibState.levels[1].status,
    "WATCH"
  );
});
