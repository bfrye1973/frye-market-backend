import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalMicroState,
} from "../logic/engine22/microV2/canonicalMicroState.js";

import {
  buildMicroW2W3TransitionFibs,
} from "../logic/engine22/microV2/buildMicroW2W3TransitionFibs.js";

function state() {
  const s =
    createCanonicalMicroState({
      countId:
        "COUNT-W2-W3",
      sequenceId:
        "SEQ-W2-W3",
      sequenceDirection:
        "UP",
      origin: {
        price: 7782.75,
      },
    });

  s.activeWave = "W3";

  s.waves.W1.lifecycle =
    "LOCKED";
  s.waves.W1.lockedAnchor =
    7853.75;

  s.waves.W2.lifecycle =
    "LOCKED";
  s.waves.W2.lockedAnchor =
    7827;

  s.waves.W3.lifecycle =
    "DEVELOPING";

  s.currentPrice =
    7862;

  return s;
}

test("W3 developing publishes both W2 retracements and W3 extensions", () => {
  const out =
    buildMicroW2W3TransitionFibs({
      canonicalState:
        state(),
      currentPrice:
        7862,
    });

  assert.equal(
    out.available,
    true
  );

  assert.equal(
    out.displayMode,
    "DUAL_FIB_TRANSITION"
  );

  assert.equal(
    out.w2Down.levels.length,
    5
  );

  assert.equal(
    out.w3Up.levels.length,
    7
  );

  assert.equal(
    out.anchors.w1High,
    7853.75
  );

  assert.equal(
    out.anchors.w2Low,
    7827
  );
});

test("W2 .382 retracement is touched when W2 low reaches through it", () => {
  const out =
    buildMicroW2W3TransitionFibs({
      canonicalState:
        state(),
    });

  const r382 =
    out.w2Down.levels.find(
      (item) =>
        item.key === "r382"
    );

  assert.equal(
    r382.status,
    "TOUCHED"
  );
});

test("W3 extension targets are projected from W2 low using W1 length", () => {
  const out =
    buildMicroW2W3TransitionFibs({
      canonicalState:
        state(),
      currentPrice:
        7862,
    });

  const e500 =
    out.w3Up.levels.find(
      (item) =>
        item.key === "e500"
    );

  // W1 length = 71; W2 7827 + 35.5 = 7862.5
  assert.equal(
    e500.price,
    7862.5
  );
});

test("dual map collapses once W3 leaves launch-developing lifecycle", () => {
  const s =
    state();

  s.waves.W3.lifecycle =
    "COMPLETION_CANDIDATE";

  const out =
    buildMicroW2W3TransitionFibs({
      canonicalState:
        s,
    });

  assert.equal(
    out.available,
    false
  );

  assert.ok(
    out.reasonCodes.includes(
      "W3_NO_LONGER_IN_LAUNCH_DEVELOPING_STATE"
    )
  );
});

test("projection never creates trade authority", () => {
  const out =
    buildMicroW2W3TransitionFibs({
      canonicalState:
        state(),
    });

  assert.equal(
    out.noPermissionCreated,
    true
  );

  assert.equal(
    out.noExecution,
    true
  );

  assert.equal(
    out.noJournalMutation,
    true
  );
});
