// services/core/tests/engine26Engine3AuthorizationClock.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveEngine3AuthorizationClock,
} from "../logic/engine26/engine3AuthorizationClock.js";

import {
  buildEngine26ReactionHandoff,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

function candidate(overrides = {}) {
  return {
    active: true,
    candidateId: "C1",
    zoneId: "Z1",
    laneId: "minute",
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    timeframe: "10m",
    snapshotTime: "2026-11-18T13:00:00.000Z",
    status: "LOCATION_DETECTED",
    directionBias: "NEUTRAL",
    directionState: "NEUTRAL",
    contactState: null,
    chainArmed: false,
    strategyEligibility: {
      eligible: true,
    },
    zoneMemorySummary: {
      lifecycleStatus: "ACTIVE",
    },
    location: {
      distancePoints: 0,
    },
    activationRangePoints: 4,
    expectedReactions: [],
    sourceRefs: [],
    ...overrides,
  };
}

function makeClockPath() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "engine26-engine3-auth-")
  );
  return {
    dir,
    filePath: path.join(dir, "clock.json"),
  };
}

function resolveFromCandidate({
  locationCandidate,
  sourceAsOf,
  filePath,
}) {
  const handoff = buildEngine26ReactionHandoff({
    locationCandidate: {
      ...locationCandidate,
      snapshotTime: sourceAsOf,
    },
    snapshotTime: sourceAsOf,
  });

  const clock = resolveEngine3AuthorizationClock({
    symbol: locationCandidate.symbol,
    strategyId: locationCandidate.strategyId,
    candidateId: locationCandidate.candidateId,
    zoneId: locationCandidate.zoneId,
    authorized:
      handoff.authorizeEngine3Evaluation === true,
    sourceAsOf,
    filePath,
    persist: true,
  });

  return {
    handoff,
    clock,
  };
}

test(
  "Engine26 authorization clock preserves the earliest as-of for one uninterrupted authorized identity across restart",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      const first = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      assert.equal(
        first.handoff.authorizeEngine3Evaluation,
        true
      );
      assert.equal(
        first.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        first.clock.engine3AuthorizationContinuous,
        false
      );

      const second = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        second.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        second.clock.engine3AuthorizationContinuous,
        true
      );

      // A fresh function call re-reads persisted state, simulating process restart.
      const afterRestart = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        afterRestart.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        afterRestart.clock.engine3AuthorizationSourceAsOf,
        "2026-11-18T13:02:00.000Z"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 resets authorization continuity on ineligible interruption and reauthorization",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const interrupted = resolveFromCandidate({
        locationCandidate: candidate({
          strategyEligibility: {
            eligible: false,
          },
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        interrupted.handoff.authorizeEngine3Evaluation,
        false
      );
      assert.equal(
        interrupted.clock.engine3AuthorizationStartedAt,
        null
      );
      assert.equal(
        interrupted.clock.engine3AuthorizationActive,
        false
      );

      const reauthorized = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        reauthorized.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:02:00.000Z"
      );
      assert.equal(
        reauthorized.clock.engine3AuthorizationContinuous,
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 resets authorization continuity on candidate or zone identity change",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const candidateChanged = resolveFromCandidate({
        locationCandidate: candidate({
          candidateId: "C2",
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        candidateChanged.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:01:00.000Z"
      );

      const zoneChanged = resolveFromCandidate({
        locationCandidate: candidate({
          candidateId: "C2",
          zoneId: "Z2",
        }),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        zoneChanged.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:02:00.000Z"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 terminal lifecycle ends authorization and requires a fresh run after terminal clears",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const terminal = resolveFromCandidate({
        locationCandidate: candidate({
          zoneMemorySummary: {
            lifecycleStatus: "COMPLETED",
          },
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        terminal.handoff.terminalLifecycle,
        true
      );
      assert.equal(
        terminal.handoff.authorizeEngine3Evaluation,
        false
      );
      assert.equal(
        terminal.clock.engine3AuthorizationStartedAt,
        null
      );

      const fresh = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:02:00.000Z",
        filePath,
      });

      assert.equal(
        fresh.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:02:00.000Z"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 authorization continuity is independent of direction and negotiated-line contact",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate({
          directionBias: "SHORT",
          directionState:
            "SHORT_DIRECTIONAL_CHILD_ACTIVE",
        }),
        sourceAsOf: "2026-11-18T13:00:00.000Z",
        filePath,
      });

      const neutralContact = resolveFromCandidate({
        locationCandidate: candidate({
          directionBias: "NEUTRAL",
          directionState: "NEUTRAL",
          contactState:
            "NEGOTIATED_LINE_CONTACT",
          chainArmed: true,
        }),
        sourceAsOf: "2026-11-18T13:01:00.000Z",
        filePath,
      });

      assert.equal(
        neutralContact.handoff.authorizeEngine3Evaluation,
        true
      );
      assert.equal(
        neutralContact.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:00:00.000Z"
      );
      assert.equal(
        neutralContact.clock.engine3AuthorizationContinuous,
        true
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 authorization clock never uses a future persisted record to backdate an older as-of evaluation",
  () => {
    const { dir, filePath } = makeClockPath();
    try {
      resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T14:00:00.000Z",
        filePath,
      });

      const historicalAsOf = resolveFromCandidate({
        locationCandidate: candidate(),
        sourceAsOf: "2026-11-18T13:30:00.000Z",
        filePath,
      });

      assert.equal(
        historicalAsOf.clock.engine3AuthorizationStartedAt,
        "2026-11-18T13:30:00.000Z"
      );
      assert.equal(
        historicalAsOf.clock.engine3AuthorizationSourceAsOf,
        "2026-11-18T13:30:00.000Z"
      );
      assert.equal(
        historicalAsOf.clock.engine3AuthorizationContinuous,
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "Engine26 reaction handoff publishes source-owned authorization timestamp and identity without substituting candidate lifecycle time",
  () => {
    const handoff = buildEngine26ReactionHandoff({
      locationCandidate: candidate({
        candidateLifecycleStartTime:
          "2026-11-18T12:00:00.000Z",
        engine3AuthorizationStartedAt:
          "2026-11-18T13:00:00.000Z",
        engine3AuthorizationSourceAsOf:
          "2026-11-18T13:05:00.000Z",
        engine3AuthorizationIdentity: {
          candidateId: "C1",
          zoneId: "Z1",
        },
        engine3AuthorizationContinuous: true,
        engine3AuthorizationActive: true,
      }),
      snapshotTime:
        "2026-11-18T13:05:00.000Z",
    });

    assert.equal(
      handoff.authorizeEngine3Evaluation,
      true
    );
    assert.equal(
      handoff.candidateLifecycleStartTime,
      "2026-11-18T12:00:00.000Z"
    );
    assert.equal(
      handoff.engine3AuthorizationStartedAt,
      "2026-11-18T13:00:00.000Z"
    );
    assert.equal(
      handoff.engine3AuthorizationSourceAsOf,
      "2026-11-18T13:05:00.000Z"
    );
    assert.deepEqual(
      handoff.engine3AuthorizationIdentity,
      {
        candidateId: "C1",
        zoneId: "Z1",
      }
    );
  }
);
