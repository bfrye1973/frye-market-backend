import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMicroTimingAutomationShadow,
} from "../logic/engine28a/buildMicroTimingAutomationShadow.js";

function base() {
  return {
    engine22WaveStrategy: {
      microExecutionContext: {
        sourceCountId: "COUNT-1",
        canonicalStateVersion: 2,
        sourceTimestamp:
          "2026-10-09T20:00:00Z",
        activeWave: "W3",
        waveDirection: "UP",
        lifecycle: "DEVELOPING",
        microTimingState: "TIMING_READY",
        countStatus: "ACTIVE",
        automationEligible: false,
      },
    },

    engine26MicroTimingShadow: {
      available: true,
      sourceCountId: "COUNT-1",
    },

    engine26LocationCandidate: {
      candidateId: "C1",
      zoneId: "Z1",
      currentObservationDirection: "LONG",
    },

    confluence: {
      context: {
        reaction: {
          paperScalpReaction: {
            allowed: true,
            reactionConfirmed: true,
            engine3Strategy1QualifiedForEngine6: true,
            direction: "LONG",
          },
        },

        volume: {
          engine4AuthorizedReactionParticipation: {
            participationConfirmed: true,
            allowed: true,
            hardBlocked: false,
            direction: "LONG",
          },
        },
      },
    },

    permission: {
      paper: {
        allowed: true,
        direction: "LONG",
        decision: "PAPER_ALLOW",
      },
    },
  };
}

test("all downstream gates can pass while production remains blocked by Engine22 producer authorization", () => {
  const result =
    buildMicroTimingAutomationShadow(
      base()
    );

  assert.equal(
    result.hypotheticalPaperTimingReady,
    true
  );

  assert.equal(
    result.producerAutomationEligible,
    false
  );

  assert.equal(
    result.productionActivationEligible,
    false
  );

  assert.equal(
    result.shadowStatus,
    "WOULD_BE_PAPER_TIMING_READY_PRODUCER_BLOCKED"
  );

  assert.equal(
    result.paperOrderCreated,
    false
  );

  assert.equal(
    result.affectsPermission,
    false
  );

  assert.equal(
    result.affectsExecution,
    false
  );
});

test("first waiting stage is Engine22 when Micro timing is not ready", () => {
  const strategy = base();

  strategy.engine22WaveStrategy
    .microExecutionContext
    .microTimingState =
      "SETUP_DEVELOPING";

  const result =
    buildMicroTimingAutomationShadow(
      strategy
    );

  assert.equal(
    result.firstWaitingStage,
    "engine22Micro"
  );

  assert.equal(
    result.shadowStatus,
    "WAIT_ENGINE22_MICRO"
  );
});

test("first waiting stage is Engine3 after Micro and Engine26 pass", () => {
  const strategy = base();

  strategy.confluence.context
    .reaction.paperScalpReaction
    .engine3Strategy1QualifiedForEngine6 =
      false;

  const result =
    buildMicroTimingAutomationShadow(
      strategy
    );

  assert.equal(
    result.firstWaitingStage,
    "engine3"
  );

  assert.equal(
    result.shadowStatus,
    "WAIT_ENGINE3_REACTION"
  );
});

test("Engine4 waits after qualified Engine3", () => {
  const strategy = base();

  strategy.confluence.context
    .volume.engine4AuthorizedReactionParticipation
    .participationConfirmed =
      false;

  const result =
    buildMicroTimingAutomationShadow(
      strategy
    );

  assert.equal(
    result.firstWaitingStage,
    "engine4"
  );

  assert.equal(
    result.shadowStatus,
    "WAIT_ENGINE4_PARTICIPATION"
  );
});

test("Engine6 remains final permission gate", () => {
  const strategy = base();

  strategy.permission.paper.allowed =
    false;

  const result =
    buildMicroTimingAutomationShadow(
      strategy
    );

  assert.equal(
    result.firstWaitingStage,
    "engine6"
  );

  assert.equal(
    result.shadowStatus,
    "WAIT_ENGINE6_PERMISSION"
  );

  assert.equal(
    result.noPermissionCreated,
    true
  );
});
