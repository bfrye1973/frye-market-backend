import test from "node:test";
import assert from "node:assert/strict";

import {
  ENGINE22_MICRO_CANONICAL_SCHEMA,
  MICRO_WAVES,
  createCanonicalMicroState,
  expectedMicroWaveDirection,
  validateCanonicalMicroState,
} from "../logic/engine22/microV2/canonicalMicroState.js";

test("canonical Micro state creates one W1-W5 count", () => {
  const state =
    createCanonicalMicroState({
      countId:
        "ES-MICRO-20261009-001",
      sequenceId:
        "ES-MICRO-SEQUENCE-001",
      sequenceDirection:
        "UP",
      origin: {
        price: 7782.75,
        timestamp:
          "2026-10-08T14:00:00Z",
        source:
          "ENGINE22_CANONICAL_ORIGIN",
      },
      parentDegree:
        "SUBMINUTE",
      parentWave:
        "W3",
      parentDirection:
        "UP",
      sourceTimestamp:
        "2026-10-09T16:00:00Z",
    });

  assert.equal(
    state.schema,
    ENGINE22_MICRO_CANONICAL_SCHEMA
  );

  assert.equal(
    state.activeWave,
    "W1"
  );

  assert.equal(
    state.countStatus,
    "ACTIVE"
  );

  assert.deepEqual(
    Object.keys(state.waves),
    MICRO_WAVES
  );

  assert.deepEqual(
    MICRO_WAVES.map(
      (wave) =>
        state.waves[wave].direction
    ),
    [
      "UP",
      "DOWN",
      "UP",
      "DOWN",
      "UP",
    ]
  );

  assert.equal(
    state.noPermissionCreated,
    true
  );

  assert.equal(
    state.noExecution,
    true
  );

  assert.equal(
    validateCanonicalMicroState(
      state
    ).ok,
    true
  );
});

test("bearish Micro count mirrors W1-W5 directions", () => {
  assert.deepEqual(
    MICRO_WAVES.map(
      (wave) =>
        expectedMicroWaveDirection(
          wave,
          "DOWN"
        )
    ),
    [
      "DOWN",
      "UP",
      "DOWN",
      "UP",
      "DOWN",
    ]
  );
});

test("locked wave requires immutable anchor in canonical schema", () => {
  const state =
    createCanonicalMicroState({
      countId: "COUNT-1",
      sequenceId: "SEQ-1",
      sequenceDirection: "UP",
      origin: {
        price: 7782.75,
      },
    });

  state.waves.W1.lifecycle =
    "LOCKED";

  const result =
    validateCanonicalMicroState(
      state
    );

  assert.equal(
    result.ok,
    false
  );

  assert.ok(
    result.errors.includes(
      "LOCKED_W1_ANCHOR_REQUIRED"
    )
  );
});

test("authority guardrails fail closed if Micro claims trading authority", () => {
  const state =
    createCanonicalMicroState({
      countId: "COUNT-2",
      sequenceId: "SEQ-2",
      sequenceDirection: "UP",
      origin: {
        price: 7782.75,
      },
    });

  state.noExecution = false;

  const result =
    validateCanonicalMicroState(
      state
    );

  assert.equal(
    result.ok,
    false
  );

  assert.ok(
    result.errors.some(
      (code) =>
        code.includes(
          "NOEXECUTION"
        )
    )
  );
});
