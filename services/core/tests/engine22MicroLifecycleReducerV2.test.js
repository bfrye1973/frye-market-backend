import test from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalMicroState,
} from "../logic/engine22/microV2/canonicalMicroState.js";

import {
  reduceCanonicalMicroState,
} from "../logic/engine22/microV2/reduceCanonicalMicroState.js";

function freshState() {
  return createCanonicalMicroState({
    countId: "ES-MICRO-COUNT-001",
    sequenceId: "ES-MICRO-SEQUENCE-001",
    sequenceDirection: "UP",
    origin: {
      price: 7782.75,
      source: "TEST",
    },
    parentDegree: "SUBMINUTE",
    parentWave: "W3",
    parentDirection: "UP",
    sourceTimestamp: "2026-10-09T12:00:00Z",
  });
}

function candidateEvidence(ts, retracement = false) {
  return {
    timeframe: "5m",
    closed: true,
    sourceTimestamp: ts,
    reasonCodes: [
      "ANCHOR_REJECTION",
      "FIVE_MIN_SWING_BREAK",
      ...(retracement
        ? ["RETRACEMENT_REACTION"]
        : []),
    ],
  };
}

function confirmationEvidence(ts) {
  return {
    timeframe: "5m",
    closed: true,
    sourceTimestamp: ts,
    reasonCodes: [
      "FIVE_MIN_SWING_BREAK",
      "FIVE_MIN_DISPLACEMENT",
    ],
  };
}

function completeWave(state, wave, {
  developingAnchor,
  candidateTs,
  confirmTs,
  lockTs,
} = {}) {
  let result = reduceCanonicalMicroState(
    state,
    {
      type: "UPDATE_DEVELOPING_ANCHOR",
      wave,
      anchor: developingAnchor,
      sourceTimestamp: candidateTs,
    }
  );

  assert.equal(result.applied, true);

  result = reduceCanonicalMicroState(
    result.state,
    {
      type: "MARK_COMPLETION_CANDIDATE",
      wave,
      anchor: developingAnchor,
      evidence: candidateEvidence(
        candidateTs,
        wave === "W2" || wave === "W4"
      ),
    }
  );

  assert.equal(result.applied, true);

  result = reduceCanonicalMicroState(
    result.state,
    {
      type: "CONFIRM_COMPLETION",
      wave,
      anchor: developingAnchor,
      evidence: confirmationEvidence(confirmTs),
    }
  );

  assert.equal(result.applied, true);

  result = reduceCanonicalMicroState(
    result.state,
    {
      type: "LOCK_WAVE",
      wave,
      countId: result.state.countId,
      sourceTimestamp: lockTs,
      nextWaveContextCreated: true,
    }
  );

  assert.equal(result.applied, true);

  return result.state;
}

test("W1 through W5 use one reusable lifecycle and append history", () => {
  let state = freshState();

  const waves = [
    ["W1", 7854, "2026-10-09T12:05:00Z", "2026-10-09T12:10:00Z", "2026-10-09T12:10:01Z"],
    ["W2", 7827, "2026-10-09T12:15:00Z", "2026-10-09T12:20:00Z", "2026-10-09T12:20:01Z"],
    ["W3", 7890, "2026-10-09T12:25:00Z", "2026-10-09T12:30:00Z", "2026-10-09T12:30:01Z"],
    ["W4", 7858, "2026-10-09T12:35:00Z", "2026-10-09T12:40:00Z", "2026-10-09T12:40:01Z"],
    ["W5", 7920, "2026-10-09T12:45:00Z", "2026-10-09T12:50:00Z", "2026-10-09T12:50:01Z"],
  ];

  for (const [
    wave,
    anchor,
    candidateTs,
    confirmTs,
    lockTs,
  ] of waves) {
    state = completeWave(
      state,
      wave,
      {
        developingAnchor: anchor,
        candidateTs,
        confirmTs,
        lockTs,
      }
    );
  }

  for (const [wave, anchor] of waves) {
    assert.equal(
      state.waves[wave].lifecycle,
      "LOCKED"
    );

    assert.equal(
      state.waves[wave].lockedAnchor,
      anchor
    );
  }

  assert.equal(
    state.countStatus,
    "COMPLETE_PENDING_PARENT_HANDOFF"
  );

  assert.equal(
    state.activeWave,
    "W5"
  );

  assert.ok(
    state.history.length >= 20
  );

  assert.equal(
    state.revision,
    state.history.length
  );

  assert.equal(
    state.history.at(-1).reasonCodes.includes(
      "MICRO_SEQUENCE_COMPLETED"
    ),
    true
  );
});

test("duplicate completed 5m observation cannot confirm candidate", () => {
  let state = freshState();

  let result = reduceCanonicalMicroState(
    state,
    {
      type: "UPDATE_DEVELOPING_ANCHOR",
      wave: "W1",
      anchor: 7854,
      sourceTimestamp: "2026-10-09T12:05:00Z",
    }
  );

  state = result.state;

  result = reduceCanonicalMicroState(
    state,
    {
      type: "MARK_COMPLETION_CANDIDATE",
      wave: "W1",
      anchor: 7854,
      evidence: candidateEvidence(
        "2026-10-09T12:05:00Z"
      ),
    }
  );

  assert.equal(result.applied, true);

  state = result.state;

  result = reduceCanonicalMicroState(
    state,
    {
      type: "CONFIRM_COMPLETION",
      wave: "W1",
      evidence: confirmationEvidence(
        "2026-10-09T12:05:00Z"
      ),
    }
  );

  assert.equal(result.applied, false);

  assert.ok(
    result.reasonCodes.includes(
      "DUPLICATE_COMPLETED_FIVE_MIN_OBSERVATION"
    )
  );

  assert.equal(
    result.state.waves.W1.lifecycle,
    "COMPLETION_CANDIDATE"
  );
});

test("out-of-order 5m evidence fails closed", () => {
  let state = freshState();

  state = reduceCanonicalMicroState(
    state,
    {
      type: "UPDATE_DEVELOPING_ANCHOR",
      wave: "W1",
      anchor: 7854,
      sourceTimestamp: "2026-10-09T12:05:00Z",
    }
  ).state;

  state = reduceCanonicalMicroState(
    state,
    {
      type: "MARK_COMPLETION_CANDIDATE",
      wave: "W1",
      evidence: candidateEvidence(
        "2026-10-09T12:10:00Z"
      ),
    }
  ).state;

  const result = reduceCanonicalMicroState(
    state,
    {
      type: "CONFIRM_COMPLETION",
      wave: "W1",
      evidence: confirmationEvidence(
        "2026-10-09T12:09:00Z"
      ),
    }
  );

  assert.equal(result.applied, false);

  assert.ok(
    result.reasonCodes.includes(
      "OUT_OF_ORDER_COMPLETED_FIVE_MIN_OBSERVATION"
    )
  );
});

test("W2 and W4 candidates require retracement reaction", () => {
  let state = freshState();

  state = completeWave(
    state,
    "W1",
    {
      developingAnchor: 7854,
      candidateTs: "2026-10-09T12:05:00Z",
      confirmTs: "2026-10-09T12:10:00Z",
      lockTs: "2026-10-09T12:10:01Z",
    }
  );

  state = reduceCanonicalMicroState(
    state,
    {
      type: "UPDATE_DEVELOPING_ANCHOR",
      wave: "W2",
      anchor: 7827,
      sourceTimestamp: "2026-10-09T12:15:00Z",
    }
  ).state;

  const result = reduceCanonicalMicroState(
    state,
    {
      type: "MARK_COMPLETION_CANDIDATE",
      wave: "W2",
      evidence: candidateEvidence(
        "2026-10-09T12:15:00Z",
        false
      ),
    }
  );

  assert.equal(result.applied, false);

  assert.ok(
    result.reasonCodes.includes(
      "RETRACEMENT_REACTION_REQUIRED"
    )
  );
});

test("lock cannot occur without confirmed state and next-wave context", () => {
  let state = freshState();

  let result = reduceCanonicalMicroState(
    state,
    {
      type: "LOCK_WAVE",
      wave: "W1",
      countId: state.countId,
      nextWaveContextCreated: true,
    }
  );

  assert.equal(result.applied, false);
  assert.ok(
    result.reasonCodes.includes(
      "LOCK_REQUIRES_CONFIRMED_WAVE"
    )
  );

  state = reduceCanonicalMicroState(
    state,
    {
      type: "UPDATE_DEVELOPING_ANCHOR",
      wave: "W1",
      anchor: 7854,
      sourceTimestamp: "2026-10-09T12:05:00Z",
    }
  ).state;

  state = reduceCanonicalMicroState(
    state,
    {
      type: "MARK_COMPLETION_CANDIDATE",
      wave: "W1",
      evidence: candidateEvidence(
        "2026-10-09T12:05:00Z"
      ),
    }
  ).state;

  state = reduceCanonicalMicroState(
    state,
    {
      type: "CONFIRM_COMPLETION",
      wave: "W1",
      evidence: confirmationEvidence(
        "2026-10-09T12:10:00Z"
      ),
    }
  ).state;

  result = reduceCanonicalMicroState(
    state,
    {
      type: "LOCK_WAVE",
      wave: "W1",
      countId: state.countId,
      nextWaveContextCreated: false,
    }
  );

  assert.equal(result.applied, false);

  assert.ok(
    result.reasonCodes.includes(
      "NEXT_WAVE_CONTEXT_REQUIRED_BEFORE_LOCK"
    )
  );
});

test("invalidated count cannot silently advance lifecycle", () => {
  let state = freshState();

  state = reduceCanonicalMicroState(
    state,
    {
      type: "MARK_INVALIDATED",
      wave: "W1",
      price: 7779,
      sourceTimestamp: "2026-10-09T12:05:00Z",
      reasonCodes: [
        "COMPLETED_CLOSE_INVALIDATION",
      ],
    }
  ).state;

  assert.equal(
    state.countStatus,
    "INVALIDATED"
  );

  const result = reduceCanonicalMicroState(
    state,
    {
      type: "UPDATE_DEVELOPING_ANCHOR",
      wave: "W1",
      anchor: 7854,
      sourceTimestamp: "2026-10-09T12:10:00Z",
    }
  );

  assert.equal(result.applied, false);

  assert.ok(
    result.reasonCodes.includes(
      "MICRO_COUNT_NOT_ACTIVE"
    )
  );
});
