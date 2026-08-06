// services/core/tests/engine26Strategy1V2BidirectionalRotation.test.js

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

import {
  buildStrategy1Facts,
} from "../logic/engine26/strategy1/buildStrategy1Facts.js";

import {
  buildStrategy1MemoryKey,
  updateNegotiatedZoneMemory,
  retirePriorMemoryRecord,
} from "../logic/engine26/strategy1/updateNegotiatedZoneMemory.js";

import {
  evaluateStrategy1Geometry,
} from "../logic/engine26/strategy1/evaluateStrategy1Geometry.js";

const SETUP = "NEGOTIATED_ZONE_ROTATION";
const VERSION = "engine26.strategy1.v2";

/*
 * Keep the focused suite isolated from the live persistent
 * Engine 26 negotiated-zone memory.
 */
const DEFAULT_TEST_MEMORY_DIR = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "engine26-v2-suite-memory-"
  )
);

const DEFAULT_TEST_MEMORY_PATH = path.join(
  DEFAULT_TEST_MEMORY_DIR,
  "negotiated-zone-memory.json"
);

after(() => {
  fs.rmSync(
    DEFAULT_TEST_MEMORY_DIR,
    {
      recursive: true,
      force: true,
    }
  );
});

function engine22Context() {
  return {
    currentLifecycleState: {
      key: "MINUTE_ROTATION_WATCH",
      direction: "DOWN",
    },
    waveOpportunity: {
      setupType: "MINUTE_ROTATION_WATCH",
      direction: "DOWN",
    },
    degreeStates: {
      minute: {
        stage: "C_COMPLETION_WATCH",
        direction: "DOWN",
      },
    },
  };
}

function buildAtPrice({
  currentPrice,
  previousLocationCandidate = null,
  bars10m = [],
  ema10Posture = null,
  snapshotTime =
    "2026-07-28T15:00:00.000Z",
  manualZonesFilePath = undefined,
  memoryFilePath = undefined,
  persistMemory = false,
} = {}) {
  return buildEngine26A({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    timeframe: "10m",
    currentPrice,
    snapshotTime,
    engine22WaveStrategy: engine22Context(),
    previousLocationCandidate,
    bars10m,
    ema10Posture,
    ...(manualZonesFilePath
      ? { manualZonesFilePath }
      : {}),
    memoryFilePath:
      memoryFilePath ||
      DEFAULT_TEST_MEMORY_PATH,
    persistMemory,
    tickSize: 0.25,
    activationRangePoints: 4,
    monitoringRangePoints: 25,
  });
}

function longLowerFactsBars() {
  return [
    {
      time: "2026-07-28T14:40:00.000Z",
      open: 7440,
      high: 7452,
      low: 7431,
      close: 7450.5,
      completed: true,
    },
    {
      time: "2026-07-28T14:50:00.000Z",
      open: 7450.5,
      high: 7452,
      low: 7437.5,
      close: 7444,
      completed: true,
    },
  ];
}

function shortUpperFactsBars() {
  return [
    {
      time: "2026-07-28T17:30:00.000Z",
      open: 7502,
      high: 7520,
      low: 7501,
      close: 7510,
      completed: true,
    },
    {
      time: "2026-07-28T17:40:00.000Z",
      open: 7510,
      high: 7512,
      low: 7498,
      close: 7502,
      completed: true,
    },
    {
      time: "2026-07-28T17:50:00.000Z",
      open: 7502,
      high: 7505,
      low: 7494,
      close: 7498,
      completed: true,
    },
  ];
}

test(
  "LONG first target-zone entry starts partial profit-taking without releasing the child",
  () => {
    const lower = buildAtPrice({
      currentPrice: 7445.75,
      bars10m: longLowerFactsBars(),
      ema10Posture: "BULLISH",
    }).engine26LocationCandidate;

    const partial = buildAtPrice({
      currentPrice: lower.targetZone.low,
      previousLocationCandidate: lower,
      snapshotTime:
        "2026-07-28T15:10:00.000Z",
    }).engine26LocationCandidate;

    assert.equal(partial.candidateId, lower.candidateId);
    assert.equal(partial.zoneId, lower.zoneId);
    assert.equal(partial.directionBias, "LONG");
    assert.equal(
      partial.targetApproachCompletionWatch,
      true
    );
    assert.equal(partial.targetZoneEntryTouched, true);
    assert.equal(partial.targetMidlineReached, false);
    assert.equal(
      partial.priorRotationCompletionState,
      "PARTIAL_PROFIT_TAKING"
    );
    assert.equal(
      partial.priorRotationFullyComplete,
      false
    );
    assert.equal(partial.remainingRunnerExpected, true);
    assert.equal(
      partial.completionBoundary,
      lower.targetZone.midline
    );
    assert.equal(partial.contactState, null);
    assert.equal(partial.noPermissionCreated, true);
    assert.equal(partial.noExecution, true);
  }
);

test(
  "SHORT first target-zone entry starts partial profit-taking and midline touch fully completes",
  () => {
    const upper = buildAtPrice({
      currentPrice: 7502,
      bars10m: shortUpperFactsBars(),
      ema10Posture: "BEARISH",
      snapshotTime:
        "2026-07-28T18:00:00.000Z",
    }).engine26LocationCandidate;

    assert.equal(upper.directionBias, "SHORT");
    assert.ok(upper.targetZone);

    const partial = buildAtPrice({
      currentPrice: upper.targetZone.high,
      previousLocationCandidate: upper,
      snapshotTime:
        "2026-07-28T18:10:00.000Z",
    }).engine26LocationCandidate;

    assert.equal(partial.candidateId, upper.candidateId);
    assert.equal(partial.zoneId, upper.zoneId);
    assert.equal(partial.directionBias, "SHORT");
    assert.equal(
      partial.targetApproachCompletionWatch,
      true
    );
    assert.equal(
      partial.priorRotationCompletionState,
      "PARTIAL_PROFIT_TAKING"
    );
    assert.equal(partial.priorRotationFullyComplete, false);
    assert.equal(partial.remainingRunnerExpected, true);
    assert.equal(
      partial.completionBoundary,
      upper.targetZone.midline
    );

    const completed = buildAtPrice({
      currentPrice: upper.targetZone.midline,
      previousLocationCandidate: upper,
      snapshotTime:
        "2026-07-28T18:20:00.000Z",
    }).engine26LocationCandidate;

    assert.notEqual(completed.candidateId, upper.candidateId);
    assert.notEqual(completed.zoneId, upper.zoneId);
    assert.equal(completed.directionBias, "NEUTRAL");
    assert.equal(completed.priorRotationFullyComplete, true);
    assert.equal(completed.remainingRunnerExpected, false);
    assert.equal(completed.ema20RunnerEnabled, false);
    assert.equal(
      completed.completionBoundary,
      upper.targetZone.midline
    );
    assert.equal(
      completed.promotionReason,
      "NEGOTIATED_LINE_TARGET_COMPLETION"
    );
    assert.equal(
      completed.directionState,
      "LONG_REVERSAL_WATCH"
    );
    assert.equal(
      completed.expectedReversalDirection,
      "LONG"
    );
    assert.equal(
      completed.expectedParticipationDirection,
      "LONG"
    );
    assert.ok(
      completed.expectedReactions.includes(
        "RECLAIMED_LEVEL"
      )
    );
    assert.equal(completed.priorCandidateId, upper.candidateId);
    assert.equal(completed.priorZoneId, upper.zoneId);
    assert.equal(completed.priorRotationDirection, "SHORT");
    assert.equal(
      completed.priorRotationCompletionState,
      "FULL_TARGET_COMPLETION"
    );
    assert.equal(completed.noPermissionCreated, true);
    assert.equal(completed.noExecution, true);
  }
);

test(
  "LONG target midline fully completes prior rotation and promotes an armed direction-neutral contact",
  () => {
    const lower = buildAtPrice({
      currentPrice: 7445.75,
      bars10m: longLowerFactsBars(),
      ema10Posture: "BULLISH",
    }).engine26LocationCandidate;

    assert.equal(lower.directionBias, "LONG");

    const promotedResult = buildAtPrice({
      currentPrice: 7511.25,
      previousLocationCandidate: lower,
      bars10m: [],
      ema10Posture: null,
      snapshotTime:
        "2026-07-28T15:20:00.000Z",
    });

    const promoted =
      promotedResult.engine26LocationCandidate;
    const reactionHandoff =
      promotedResult.engine26ReactionHandoff;
    const geometryHandoff =
      promotedResult.engine26GeometryHandoff;

    assert.notEqual(
      promoted.zoneId,
      lower.zoneId
    );
    assert.notEqual(
      promoted.candidateId,
      lower.candidateId
    );
    assert.equal(
      promoted.directionBias,
      "NEUTRAL"
    );
    assert.equal(
      promoted.tradeDirectionBias,
      "NEUTRAL"
    );
    assert.equal(
      promoted.preferredDirection,
      "NEUTRAL"
    );
    assert.equal(
      promoted.expectedDirection,
      null
    );
    assert.equal(
      promoted.directionState,
      "SHORT_REVERSAL_WATCH"
    );
    assert.equal(
      promoted.contactState,
      "NEGOTIATED_LINE_CONTACT"
    );
    assert.equal(promoted.chainArmed, true);
    assert.equal(
      promoted.expectedReversalDirection,
      "SHORT"
    );
    assert.equal(
      promoted.expectedParticipationDirection,
      "SHORT"
    );
    assert.ok(
      promoted.expectedReactions.includes(
        "FAILED_RECLAIM"
      )
    );
    assert.equal(
      promoted.reactionExpected,
      true
    );
    assert.equal(
      promoted.priorRotationDirection,
      "LONG"
    );
    assert.equal(
      promoted.priorRotationCompletionState,
      "FULL_TARGET_COMPLETION"
    );
    assert.equal(
      promoted.currentObservationDirection,
      "NEUTRAL"
    );
    assert.equal(promoted.shortConfirmed, false);
    assert.equal(promoted.directionalResolved, false);
    assert.equal(promoted.automaticDirectionFlip, false);
    assert.equal(promoted.priorRotationFullyComplete, true);
    assert.equal(promoted.remainingRunnerExpected, false);
    assert.equal(promoted.ema20RunnerEnabled, false);
    assert.equal(promoted.completionBoundary, 7511.25);
    assert.equal(
      promoted.completedTargetZoneId,
      lower.targetZone.zoneId
    );
    assert.deepEqual(
      promoted.completedTargetZone,
      lower.targetZone
    );
    assert.equal(
      promoted.priorCandidateId,
      lower.candidateId
    );
    assert.equal(
      promoted.priorZoneId,
      lower.zoneId
    );
    assert.equal(
      promoted.promotionReason,
      "NEGOTIATED_LINE_TARGET_COMPLETION"
    );
    assert.equal(
      promoted.promotedFromTargetCompletion,
      true
    );
    assert.equal(
      promoted.promotedObservationLocation
        .releaseReason,
      "TARGET_ZONE_REACHED"
    );

    assert.equal(
      reactionHandoff.candidateId,
      promoted.candidateId
    );
    assert.equal(
      reactionHandoff.zoneId,
      promoted.zoneId
    );
    assert.equal(reactionHandoff.active, true);
    assert.equal(reactionHandoff.armed, true);
    assert.equal(reactionHandoff.chainArmed, true);
    assert.equal(
      reactionHandoff.direction,
      "NEUTRAL"
    );
    assert.equal(
      reactionHandoff.directionState,
      "SHORT_REVERSAL_WATCH"
    );
    assert.equal(
      reactionHandoff.expectedReactionDirection,
      "SHORT"
    );
    assert.equal(
      reactionHandoff.expectedParticipationDirection,
      "SHORT"
    );
    assert.ok(
      reactionHandoff.expectedReactions.includes(
        "FAILED_RECLAIM"
      )
    );
    assert.equal(
      reactionHandoff.reactionExpected,
      true
    );
    assert.equal(
      reactionHandoff.contactState,
      "NEGOTIATED_LINE_CONTACT"
    );
    assert.equal(
      reactionHandoff.reactionConfirmed,
      false
    );

    assert.equal(geometryHandoff.active, true);
    assert.equal(geometryHandoff.armed, true);
    assert.equal(geometryHandoff.chainArmed, true);
    assert.equal(
      geometryHandoff.candidateId,
      promoted.candidateId
    );
    assert.equal(
      geometryHandoff.zoneId,
      promoted.zoneId
    );
    assert.equal(
      geometryHandoff.status,
      "WAITING_FOR_DIRECTIONAL_RESOLUTION"
    );
    assert.equal(
      geometryHandoff.directionalResolved,
      false
    );
    assert.equal(geometryHandoff.geometryReady, false);
    assert.equal(geometryHandoff.geometryFeasible, false);

    const geometry = evaluateStrategy1Geometry({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      permission: {
        paper: {
          decision: "PAPER_STAND_DOWN",
          allowed: false,
          planningAllowed: false,
        },
      },
      engine26LocationCandidate: promoted,
      engine26GeometryHandoff: geometryHandoff,
    });

    assert.equal(
      geometry.status,
      "WAITING_FOR_DIRECTIONAL_RESOLUTION"
    );
    assert.equal(geometry.direction, "NEUTRAL");
    assert.equal(geometry.directionalResolved, false);
    assert.equal(geometry.geometryReady, false);
    assert.equal(geometry.geometryFeasible, false);
    assert.equal(geometry.proposedEntryPrice, null);
    assert.equal(geometry.proposedStopPrice, null);
    assert.deepEqual(geometry.proposedTargets, []);
    assert.equal(geometry.targetApproachWarningLow, null);
    assert.equal(geometry.targetApproachWarningHigh, null);
    assert.equal(geometry.runnerHandoff, null);
    assert.equal(geometry.runnerHandoffRequired, false);
    assert.equal(geometry.remainingRunnerExpected, false);
    assert.equal(geometry.ema20RunnerEnabled, false);
    assert.equal(geometry.noOrderCreated, true);
    assert.equal(geometry.noFillCreated, true);
    assert.equal(geometry.noExecution, true);
  }
);

test(
  "prior LONG reaching upper zone does not automatically create SHORT",
  () => {
    const lower = buildAtPrice({
      currentPrice: 7445.75,
      bars10m: longLowerFactsBars(),
      ema10Posture: "BULLISH",
    }).engine26LocationCandidate;

    const promoted = buildAtPrice({
      currentPrice: 7511.25,
      previousLocationCandidate: lower,
    }).engine26LocationCandidate;

    assert.equal(
      promoted.directionBias,
      "NEUTRAL"
    );
    assert.notEqual(
      promoted.directionBias,
      "SHORT"
    );
    assert.equal(
      promoted.directionState,
      "SHORT_REVERSAL_WATCH"
    );
    assert.equal(
      promoted.expectedReversalDirection,
      "SHORT"
    );
    assert.equal(
      promoted.directionalResolved,
      false
    );
    assert.equal(promoted.shortConfirmed, false);
    assert.equal(promoted.automaticDirectionFlip, false);
  }
);

test(
  "upper-zone bullish acceptance and EMA10 context remain published without Engine 26 confirming LONG",
  () => {
    const neutralUpperResult = buildAtPrice({
      currentPrice: 7511.25,
      previousLocationCandidate:
        buildAtPrice({
          currentPrice: 7445.75,
          bars10m: longLowerFactsBars(),
          ema10Posture: "BULLISH",
        }).engine26LocationCandidate,
    });

    const neutralUpper =
      neutralUpperResult.engine26LocationCandidate;

    const continuationResult = buildAtPrice({
      currentPrice: 7522,
      previousLocationCandidate: neutralUpper,
      ema10Posture: {
        posture: "BULLISH",
        ema10: 7515,
        currentPrice: 7522,
      },
      bars10m: [
        {
          time: "2026-07-28T18:00:00.000Z",
          open: 7516,
          high: 7524,
          low: 7515,
          close: 7522,
          completed: true,
        },
      ],
    });

    const continuation =
      continuationResult.engine26LocationCandidate;
    const reactionHandoff =
      continuationResult.engine26ReactionHandoff;

    assert.equal(continuation.candidateId, neutralUpper.candidateId);
    assert.equal(continuation.zoneId, neutralUpper.zoneId);
    assert.equal(continuation.directionBias, "NEUTRAL");
    assert.equal(continuation.direction, "NEUTRAL");
    assert.equal(continuation.directionalResolved, false);
    assert.equal(
      continuation.directionState,
      "SHORT_REVERSAL_WATCH"
    );
    assert.equal(
      continuation.expectedReversalDirection,
      "SHORT"
    );
    assert.equal(
      continuation.contactState,
      "NEGOTIATED_LINE_CONTACT"
    );
    assert.equal(continuation.chainArmed, true);
    assert.equal(continuation.automaticDirectionFlip, false);
    assert.equal(
      continuation.directionalEvidence
        .bullishAcceptanceObserved,
      true
    );
    assert.equal(
      continuation.directionalEvidence
        .ema10Posture.posture,
      "BULLISH"
    );
    assert.equal(
      continuation.directionalEvidence
        .displacementFacts.bullishDisplacement,
      true
    );
    assert.equal(
      continuation.directionalEvidence
        .reactionEvaluationFactsReady,
      true
    );
    assert.equal(reactionHandoff.active, true);
    assert.equal(reactionHandoff.armed, true);
    assert.equal(reactionHandoff.chainArmed, true);
    assert.equal(
      reactionHandoff.authorizeEngine3Evaluation,
      true
    );
    assert.equal(reactionHandoff.reactionConfirmed, false);
  }
);

test(
  "upper-zone bearish rejection and EMA10 context remain published without Engine 26 confirming SHORT",
  () => {
    const neutralUpperResult = buildAtPrice({
      currentPrice: 7511.25,
      previousLocationCandidate:
        buildAtPrice({
          currentPrice: 7445.75,
          bars10m: longLowerFactsBars(),
          ema10Posture: "BULLISH",
        }).engine26LocationCandidate,
    });

    const neutralUpper =
      neutralUpperResult.engine26LocationCandidate;

    const reversalResult = buildAtPrice({
      currentPrice: 7502,
      previousLocationCandidate: neutralUpper,
      ema10Posture: {
        posture: "BEARISH",
        ema10: 7508,
        currentPrice: 7502,
      },
      bars10m: shortUpperFactsBars(),
    });

    const reversal =
      reversalResult.engine26LocationCandidate;
    const reactionHandoff =
      reversalResult.engine26ReactionHandoff;

    assert.equal(reversal.candidateId, neutralUpper.candidateId);
    assert.equal(reversal.zoneId, neutralUpper.zoneId);
    assert.equal(reversal.directionBias, "NEUTRAL");
    assert.equal(reversal.direction, "NEUTRAL");
    assert.equal(reversal.directionalResolved, false);
    assert.equal(
      reversal.directionState,
      "SHORT_REVERSAL_WATCH"
    );
    assert.equal(
      reversal.contactState,
      "NEGOTIATED_LINE_CONTACT"
    );
    assert.equal(reversal.chainArmed, true);
    assert.equal(reversal.automaticDirectionFlip, false);
    assert.equal(
      reversal.directionalEvidence
        .bearishRejectionObserved,
      true
    );
    assert.equal(
      reversal.directionalEvidence
        .completedFailedAcceptanceObserved,
      true
    );
    assert.equal(
      reversal.directionalEvidence
        .bearishDisplacement,
      true
    );
    assert.equal(
      reversal.directionalEvidence
        .ema10Posture.posture,
      "BEARISH"
    );
    assert.equal(
      reversal.directionalEvidence
        .reactionEvaluationFactsReady,
      true
    );
    assert.equal(
      reversal.expectedReversalDirection,
      "SHORT"
    );
    assert.equal(reactionHandoff.active, true);
    assert.equal(reactionHandoff.armed, true);
    assert.equal(reactionHandoff.chainArmed, true);
    assert.equal(
      reactionHandoff.expectedReactionDirection,
      "SHORT"
    );
    assert.equal(
      reactionHandoff.authorizeEngine3Evaluation,
      true
    );
    assert.equal(reactionHandoff.reactionConfirmed, false);
  }
);

test(
  "direction remains NEUTRAL when evidence and EMA10 conflict",
  () => {
    const result = buildAtPrice({
      currentPrice: 7502,
      bars10m: shortUpperFactsBars(),
      ema10Posture: "BULLISH",
    }).engine26LocationCandidate;

    assert.equal(
      result.directionBias,
      "NEUTRAL"
    );
    assert.equal(
      result.directionalEvidence
        .directionalConflict,
      true
    );
  }
);

test(
  "Engine 26B waits while promoted zone remains NEUTRAL",
  () => {
    const lower = buildAtPrice({
      currentPrice: 7445.75,
      bars10m: longLowerFactsBars(),
      ema10Posture: "BULLISH",
    }).engine26LocationCandidate;

    const promotedResult = buildAtPrice({
      currentPrice: 7511.25,
      previousLocationCandidate: lower,
    });

    const candidate =
      promotedResult.engine26LocationCandidate;
    const handoff =
      promotedResult.engine26GeometryHandoff;

    const geometry =
      evaluateStrategy1Geometry({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        permission: {
          paper: {
            decision: "PAPER_WATCH_FAST",
            allowed: false,
            planningAllowed: false,
          },
        },
        engine26LocationCandidate: candidate,
        engine26GeometryHandoff: handoff,
      });

    assert.equal(
      geometry.status,
      "WAITING_FOR_DIRECTIONAL_RESOLUTION"
    );
    assert.equal(
      geometry.geometryFeasible,
      false
    );
    assert.equal(
      geometry.proposedEntryPrice,
      null
    );
    assert.equal(geometry.proposedStopPrice, null);
    assert.deepEqual(geometry.proposedTargets, []);
    assert.equal(geometry.target1Price, null);
    assert.equal(geometry.target2Price, null);
    assert.equal(
      geometry.targetApproachWarningLow,
      null
    );
    assert.equal(
      geometry.targetApproachWarningHigh,
      null
    );
    assert.equal(geometry.direction, "NEUTRAL");
    assert.equal(
      geometry.directionState,
      "SHORT_REVERSAL_WATCH"
    );
    assert.equal(
      geometry.contactState,
      "NEGOTIATED_LINE_CONTACT"
    );
    assert.equal(geometry.chainArmed, true);
    assert.equal(
      geometry.expectedReversalDirection,
      "SHORT"
    );
    assert.equal(geometry.directionalResolved, false);
    assert.equal(geometry.geometryReady, false);
    assert.equal(geometry.geometryFeasible, false);
  }
);

test(
  "LONG and SHORT candle facts remain directionally valid",
  () => {
    const longFacts = buildStrategy1Facts({
      direction: "LONG",
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      locationInvalidationBoundary: 7433.5,
      bars10m: longLowerFactsBars(),
    });

    assert.equal(
      longFacts.lifecycleFacts
        .reactionEvaluationFactsReady,
      true
    );

    const shortFacts = buildStrategy1Facts({
      direction: "SHORT",
      entryZone: {
        low: 7504,
        high: 7518.25,
        midline: 7511.25,
      },
      locationInvalidationBoundary: 7518.5,
      bars10m: shortUpperFactsBars(),
    });

    assert.equal(
      shortFacts.lifecycleFacts
        .reactionEvaluationFactsReady,
      true
    );
  }
);

test(
  "memory preserves facts and retirement requires approved reason",
  () => {
    const memoryKey = buildStrategy1MemoryKey({
      laneId: "minute",
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      zoneId: "ZONE-A",
    });

    const first = updateNegotiatedZoneMemory({
      store: {
        schema:
          "engine26.negotiatedZoneMemory.v1",
        records: {},
      },
      memoryKey,
      candidate: {
        laneId: "minute",
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        zoneId: "ZONE-A",
        candidateId: "CANDIDATE-A",
        directionBias: "LONG",
        setupClass: SETUP,
        setupGrade: "A+++",
        identitySetupKey: SETUP,
        candidateIdentityVersion: VERSION,
      },
      facts: {
        interactionFacts: {
          interactionTimes: [
            "2026-07-28T14:40:00.000Z",
          ],
        },
        sweepFacts: {
          completedCandleSweepObserved: true,
        },
        reclaimFacts: {
          completedReclaimObserved: true,
        },
        postReclaimFacts: {
          completedHoldObserved: true,
        },
        invalidationFacts: {
          completedCloseInvalidationConfirmed:
            false,
        },
      },
      snapshotTime:
        "2026-07-28T15:00:00.000Z",
    });

    const second = updateNegotiatedZoneMemory({
      store: first.store,
      memoryKey,
      candidate: {
        laneId: "minute",
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        zoneId: "ZONE-A",
        candidateId: "CANDIDATE-A",
        directionBias: "LONG",
        setupClass: SETUP,
        setupGrade: "A+++",
        identitySetupKey: SETUP,
        candidateIdentityVersion: VERSION,
      },
      facts: {
        interactionFacts: {
          interactionTimes: [],
        },
        invalidationFacts: {
          completedCloseInvalidationConfirmed:
            false,
        },
      },
      snapshotTime:
        "2026-07-28T15:10:00.000Z",
    });

    assert.equal(
      second.record.reclaimFacts
        .completedReclaimObserved,
      true
    );

    const rejected = retirePriorMemoryRecord({
      store: second.store,
      priorMemoryKey: memoryKey,
      retiredAt:
        "2026-07-28T15:20:00.000Z",
      retirementReason:
        "HIGHER_SCORE_SELECTED",
    });

    assert.equal(
      rejected.records[memoryKey]
        .lifecycleStatus,
      "ACTIVE"
    );
  }
);

test(
  "historical completed close before current lifecycle start does not invalidate new SHORT child",
  () => {
    const facts = buildStrategy1Facts({
      direction: "SHORT",
      lifecycleStartTime:
        "2026-07-29T13:56:54.496Z",
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      locationInvalidationBoundary: 7457.75,
      bars10m: [
        {
          time: "2026-07-28T23:10:00.000Z",
          open: 7455,
          high: 7464,
          low: 7450,
          close: 7461,
          completed: true,
        },
        {
          time: "2026-07-29T13:50:00.000Z",
          open: 7440,
          high: 7442,
          low: 7428,
          close: 7430,
          completed: true,
        },
      ],
    });

    assert.equal(
      facts.rejectionFacts
        .completedRejectionObserved,
      true
    );

    assert.equal(
      facts.invalidationFacts
        .completedCloseInvalidationConfirmed,
      false
    );

    assert.equal(
      facts.invalidationFacts
        .historicalBarsIgnoredForInvalidation,
      2
    );
  }
);

test(
  "completed close after current lifecycle start invalidates current SHORT child",
  () => {
    const facts = buildStrategy1Facts({
      direction: "SHORT",
      lifecycleStartTime:
        "2026-07-29T13:56:54.496Z",
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      locationInvalidationBoundary: 7457.75,
      bars10m: [
        {
          time: "2026-07-29T14:00:00.000Z",
          open: 7430,
          high: 7463,
          low: 7428,
          close: 7460,
          completed: true,
        },
      ],
    });

    assert.equal(
      facts.invalidationFacts
        .completedCloseInvalidationConfirmed,
      true
    );

    assert.equal(
      facts.invalidationFacts
        .invalidationTime,
      "2026-07-29T14:00:00.000Z"
    );
  }
);

test(
  "completed close equal to current lifecycle start invalidates current SHORT child",
  () => {
    const lifecycleStartTime =
      "2026-07-29T13:56:54.496Z";

    const facts = buildStrategy1Facts({
      direction: "SHORT",
      lifecycleStartTime,
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      locationInvalidationBoundary: 7457.75,
      bars10m: [
        {
          time: lifecycleStartTime,
          open: 7430,
          high: 7463,
          low: 7428,
          close: 7460,
          completed: true,
        },
      ],
    });

    assert.equal(
      facts.invalidationFacts
        .completedCloseInvalidationConfirmed,
      true
    );

    assert.equal(
      facts.invalidationFacts
        .invalidationTime,
      lifecycleStartTime
    );
  }
);


test(
  "waiting snapshot does not erase recoverable SHORT continuation beyond 25 points",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "engine26-memory-recovery-")
    );
    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    try {
      const original = buildAtPrice({
        currentPrice: 7502,
        snapshotTime:
          "2026-07-28T18:10:00.000Z",
        bars10m: shortUpperFactsBars(),
        ema10Posture: {
          posture: "BEARISH",
          ema10: 7508,
          currentPrice: 7502,
        },
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(original.directionBias, "SHORT");
      assert.equal(original.active, true);
      assert.ok(original.candidateId);
      assert.ok(original.zoneId);
      assert.ok(original.targetZone);

      const waitingSnapshotCandidate = {
        active: false,
        status: "WAITING_FOR_LOCATION",
        laneId: "minute",
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: null,
        zoneId: null,
        directionBias: "NEUTRAL",
        direction: "NEUTRAL",
        setupClass: null,
        identitySetupKey: null,
        candidateIdentityVersion: null,
      };

      const recovered = buildAtPrice({
        currentPrice: 7470,
        previousLocationCandidate:
          waitingSnapshotCandidate,
        snapshotTime:
          "2026-07-28T18:20:00.000Z",
        bars10m: [
          {
            time: "2026-07-28T18:20:00.000Z",
            open: 7480,
            high: 7482,
            low: 7468,
            close: 7470,
            completed: true,
          },
        ],
        ema10Posture: {
          posture: "BEARISH",
          ema10: 7490,
          currentPrice: 7470,
        },
        memoryFilePath,
        persistMemory: false,
      }).engine26LocationCandidate;

      assert.equal(recovered.candidateId, original.candidateId);
      assert.equal(recovered.zoneId, original.zoneId);
      assert.equal(recovered.directionBias, "SHORT");
      assert.deepEqual(recovered.entryZone, original.entryZone);
      assert.deepEqual(recovered.targetZone, original.targetZone);
      assert.equal(recovered.active, true);
      assert.equal(recovered.noPermissionCreated, true);
      assert.equal(recovered.noExecution, true);
      assert.equal(
        recovered.childPreservation.recoveredFromMemory,
        true
      );
      assert.ok(
        recovered.reasonCodes.includes(
          "ENGINE26_STRATEGY1_DIRECTIONAL_CHILD_RECOVERED_FROM_MEMORY"
        )
      );
      assert.ok(
        recovered.reasonCodes.includes(
          "ENGINE26_STRATEGY1_ESTABLISHED_CHILD_BYPASSED_DISCOVERY_RANGE"
        )
      );
      assert.notEqual(recovered.directionBias, "LONG");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  "completed invalidation prevents memory-child recovery",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "engine26-memory-invalidation-")
    );
    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    try {
      const original = buildAtPrice({
        currentPrice: 7502,
        snapshotTime:
          "2026-07-28T18:10:00.000Z",
        bars10m: shortUpperFactsBars(),
        ema10Posture: "BEARISH",
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const result = buildAtPrice({
        currentPrice: 7470,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-07-28T18:20:00.000Z",
        bars10m: [
          {
            time: "2026-07-28T18:20:00.000Z",
            open: 7518,
            high: 7522,
            low: 7517,
            close: 7520,
            completed: true,
          },
        ],
        ema10Posture: "BEARISH",
        memoryFilePath,
        persistMemory: false,
      }).engine26LocationCandidate;

      assert.notEqual(result.candidateId, original.candidateId);
      assert.equal(
        result.reasonCodes?.includes(
          "ENGINE26_STRATEGY1_DIRECTIONAL_CHILD_RECOVERED_FROM_MEMORY"
        ) || false,
        false
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
);

test(
  "retired memory child is not recovered",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "engine26-memory-retired-")
    );
    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    try {
      const original = buildAtPrice({
        currentPrice: 7502,
        snapshotTime:
          "2026-07-28T18:10:00.000Z",
        bars10m: shortUpperFactsBars(),
        ema10Posture: "BEARISH",
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const store = JSON.parse(
        fs.readFileSync(memoryFilePath, "utf8")
      );
      const record = Object.values(store.records)[0];
      record.lifecycleStatus = "RETIRED";
      record.retiredAt =
        "2026-07-28T18:15:00.000Z";
      record.releaseReason = "EXPLICIT_RETIREMENT";
      fs.writeFileSync(
        memoryFilePath,
        `${JSON.stringify(store, null, 2)}\n`,
        "utf8"
      );

      const result = buildAtPrice({
        currentPrice: 7470,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-07-28T18:20:00.000Z",
        bars10m: [],
        ema10Posture: "BEARISH",
        memoryFilePath,
        persistMemory: false,
      }).engine26LocationCandidate;

      assert.notEqual(result.candidateId, original.candidateId);
      assert.equal(
        result.reasonCodes?.includes(
          "ENGINE26_STRATEGY1_DIRECTIONAL_CHILD_RECOVERED_FROM_MEMORY"
        ) || false,
        false
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
);


function longReversalWatchBars({
  includeFormingThird = false,
} = {}) {
  const bars = [];

  for (let index = 0; index < 10; index += 1) {
    const open = 7390 + index * 0.5;
    bars.push({
      time: new Date(
        Date.parse("2026-07-29T13:00:00.000Z") +
        index * 10 * 60 * 1000
      ).toISOString(),
      open,
      high: open + 1.25,
      low: open - 0.5,
      close: open + 0.75,
      completed: true,
    });
  }

  bars.push({
    time: "2026-07-29T14:40:00.000Z",
    open: 7398,
    high: 7406,
    low: 7397.5,
    close: 7405,
    completed: true,
  });

  bars.push({
    time: "2026-07-29T14:50:00.000Z",
    open: 7405,
    high: 7414,
    low: 7404.5,
    close: 7413,
    completed: true,
  });

  if (includeFormingThird) {
    bars.push({
      time: "2026-07-29T15:00:00.000Z",
      open: 7413,
      high: 7425,
      low: 7412.5,
      close: 7424,
      completed: false,
    });
  }

  return bars;
}

test(
  "two completed bullish candles above applicable EMA10 create observation-only LONG_REVERSAL_WATCH before full zone reclaim",
  () => {
    /*
     * This test controls both external Strategy 1 inventories:
     *
     * - negotiated-zone memory
     * - manual negotiated-zone source
     *
     * It must not depend on the production memory file or the live
     * services/core/data/es-smz-manual-zones.txt inventory.
     */
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-long-reversal-watch-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "",
        ].join("\n"),
        "utf8"
      );

      const result = buildAtPrice({
        currentPrice: 7413,

        snapshotTime:
          "2026-07-29T15:00:00.000Z",

        bars10m:
          longReversalWatchBars(),

        ema10Posture:
          null,

        manualZonesFilePath,

        memoryFilePath,

        persistMemory:
          false,
      });

      const candidate =
        result.engine26LocationCandidate;

      assert.equal(
        candidate.location.sourcePath,
        "manualImbalanceInventory.negotiatedZones[0]"
      );

      assert.equal(
        candidate.location.lo,
        7433.75
      );

      assert.equal(
        candidate.location.hi,
        7457.5
      );

      assert.equal(
        candidate.directionBias,
        "NEUTRAL"
      );

      assert.equal(
        candidate.direction,
        "NEUTRAL"
      );

      assert.equal(
        candidate.directionalResolved,
        false
      );

      assert.equal(
        candidate.directionState,
        "LONG_REVERSAL_WATCH"
      );

      assert.equal(
        candidate.automaticDirectionFlip,
        false
      );

      assert.equal(
        candidate.directionalEvidence
          .longReversalWatchFacts
          .qualified,
        true
      );

      assert.equal(
        candidate.directionalEvidence
          .longReversalWatchFacts
          .completedBullishSequence,
        true
      );

      assert.equal(
        candidate.directionalEvidence
          .longReversalWatchFacts
          .bothClosesAboveApplicableEma10,
        true
      );

      assert.equal(
        candidate.directionalEvidence
          .longReversalWatchFacts
          .latestBodyDisplacementStrong,
        true
      );

      assert.equal(
        candidate.directionalEvidence
          .longReversalWatchFacts
          .latestCloseAbovePreviousHigh,
        true
      );

      assert.equal(
        candidate.directionalEvidence
          .longReversalWatchFacts
          .fullNegotiatedZoneReclaimIncomplete,
        true
      );

      assert.equal(
        result.engine26ReactionHandoff.active,
        true
      );
      assert.equal(
        result.engine26ReactionHandoff.observerActive,
        true
      );
      assert.equal(
        result.engine26ReactionHandoff
          .authorizeEngine3Evaluation,
        true
      );

      assert.equal(
        result.engine26GeometryHandoff.active,
        false
      );

      const geometry =
        evaluateStrategy1Geometry({
          symbol: "ES",

          strategyId:
            "intraday_scalp@10m",

          permission: {
            paper: {
              decision:
                "PAPER_STAND_DOWN",

              allowed:
                false,

              planningAllowed:
                false,
            },
          },

          engine26LocationCandidate:
            candidate,

          engine26GeometryHandoff:
            result.engine26GeometryHandoff,
        });

      assert.equal(
        geometry.status,
        "WAITING_FOR_DIRECTIONAL_RESOLUTION"
      );

      assert.equal(
        geometry.directionalResolved,
        false
      );

      assert.equal(
        geometry.longReversalWatch,
        true
      );

      assert.equal(
        geometry.geometryReady,
        false
      );

      assert.equal(
        geometry.geometryFeasible,
        false
      );

      assert.equal(
        geometry.proposedEntryPrice,
        null
      );

      assert.equal(
        geometry.proposedStopPrice,
        null
      );

      assert.deepEqual(
        geometry.proposedTargets,
        []
      );

      assert.equal(
        geometry.target1Price,
        null
      );

      assert.equal(
        geometry.target2Price,
        null
      );

      assert.equal(
        geometry.plannerProgressionAllowed,
        false
      );

      assert.equal(
        geometry.noPermissionCreated,
        true
      );

      assert.equal(
        geometry.noSizingCreated,
        true
      );

      assert.equal(
        geometry.noManagementCreated,
        true
      );

      assert.equal(
        geometry.noExecution,
        true
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "unfinished bullish candle is excluded from LONG_REVERSAL_WATCH",
  () => {
    const bars = longReversalWatchBars({
      includeFormingThird: true,
    });

    bars[bars.length - 2] = {
      ...bars[bars.length - 2],
      open: 7413,
      high: 7414,
      low: 7408,
      close: 7409,
      completed: true,
    };

    const candidate = buildAtPrice({
      currentPrice: 7424,
      snapshotTime:
        "2026-07-29T15:00:00.000Z",
      bars10m: bars,
      ema10Posture: null,
    }).engine26LocationCandidate;

    assert.notEqual(
      candidate.directionState,
      "LONG_REVERSAL_WATCH"
    );
    assert.equal(
      candidate.directionalEvidence
        .longReversalWatchFacts.qualified,
      false
    );
  }
);

test(
  "LONG_REVERSAL_WATCH requires at least five prior completed bars for displacement evaluation",
  () => {
    const bars = longReversalWatchBars().slice(-6);

    const candidate = buildAtPrice({
      currentPrice: 7413,
      snapshotTime:
        "2026-07-29T15:00:00.000Z",
      bars10m: bars,
      ema10Posture: {
        posture: "BULLISH",
        ema10: 7399,
        currentPrice: 7413,
      },
    }).engine26LocationCandidate;

    assert.notEqual(
      candidate.directionState,
      "LONG_REVERSAL_WATCH"
    );
    assert.equal(
      candidate.directionalEvidence
        .longReversalWatchFacts.qualified,
      false
    );
  }
);

test(
  "promoted negotiated-line contact persists and restores the same armed identity after price moves away",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-promoted-contact-durable-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "",
        ].join("\n"),
        "utf8"
      );

      const priorLong = buildAtPrice({
        currentPrice: 7445.75,
        snapshotTime:
          "2026-07-30T14:00:00.000Z",
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(priorLong.directionBias, "LONG");
      assert.ok(priorLong.targetZone);

      const contactSnapshot = buildAtPrice({
        currentPrice: priorLong.targetZone.midline,
        previousLocationCandidate: priorLong,
        snapshotTime:
          "2026-07-30T14:10:00.000Z",
        bars10m: [],
        ema10Posture: null,
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      });

      const promoted =
        contactSnapshot.engine26LocationCandidate;

      assert.equal(
        promoted.contactState,
        "NEGOTIATED_LINE_CONTACT"
      );
      assert.equal(promoted.chainArmed, true);
      assert.equal(promoted.direction, "NEUTRAL");
      assert.equal(promoted.directionBias, "NEUTRAL");
      assert.equal(promoted.directionalResolved, false);
      assert.equal(
        promoted.directionState,
        "SHORT_REVERSAL_WATCH"
      );
      assert.equal(
        promoted.expectedReversalDirection,
        "SHORT"
      );
      assert.equal(
        promoted.expectedParticipationDirection,
        "SHORT"
      );
      assert.equal(
        promoted.priorRotationFullyComplete,
        true
      );
      assert.equal(
        promoted.promotionReason,
        "NEGOTIATED_LINE_TARGET_COMPLETION"
      );

      const persisted = JSON.parse(
        fs.readFileSync(memoryFilePath, "utf8")
      );

      const promotedMemoryKey =
        buildStrategy1MemoryKey({
          laneId: "minute",
          symbol: "ES",
          strategyId: "intraday_scalp@10m",
          zoneId: promoted.zoneId,
        });

      const promotedRecord =
        persisted.records[promotedMemoryKey];

      assert.ok(promotedRecord);
      assert.equal(
        promotedRecord.currentCandidateId,
        promoted.candidateId
      );
      assert.equal(
        promotedRecord.contactState,
        "NEGOTIATED_LINE_CONTACT"
      );
      assert.equal(promotedRecord.chainArmed, true);
      assert.equal(promotedRecord.direction, "NEUTRAL");
      assert.equal(promotedRecord.directionBias, "NEUTRAL");
      assert.equal(
        promotedRecord.directionalResolved,
        false
      );
      assert.equal(
        promotedRecord.directionState,
        "SHORT_REVERSAL_WATCH"
      );
      assert.equal(
        promotedRecord.expectedReversalDirection,
        "SHORT"
      );
      assert.equal(
        promotedRecord.expectedParticipationDirection,
        "SHORT"
      );
      assert.equal(
        promotedRecord.expectedReversalDirection,
        "SHORT"
      );
      assert.equal(
        promotedRecord.expectedParticipationDirection,
        "SHORT"
      );
      assert.equal(
        promotedRecord.priorCandidateId,
        priorLong.candidateId
      );
      assert.equal(
        promotedRecord.priorZoneId,
        priorLong.zoneId
      );
      assert.equal(
        promotedRecord.priorRotationDirection,
        "LONG"
      );
      assert.equal(
        promotedRecord.priorRotationCompletionState,
        "FULL_TARGET_COMPLETION"
      );
      assert.equal(
        promotedRecord.priorRotationFullyComplete,
        true
      );
      assert.equal(
        promotedRecord.remainingRunnerExpected,
        false
      );
      assert.equal(
        promotedRecord.promotionReason,
        "NEGOTIATED_LINE_TARGET_COMPLETION"
      );
      assert.equal(
        promotedRecord.promotedFromTargetCompletion,
        true
      );
      assert.ok(promotedRecord.targetZoneEntryTouchedAt);
      assert.ok(promotedRecord.targetMidlineReachedAt);
      assert.ok(promotedRecord.promotionTime);
      assert.ok(promotedRecord.profitObjectiveReachedAt);

      const waitingSnapshotCandidate = {
        active: false,
        status: "WAITING_FOR_LOCATION",
        laneId: "minute",
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: null,
        zoneId: null,
        directionBias: "NEUTRAL",
        direction: "NEUTRAL",
        setupClass: null,
        identitySetupKey: null,
        candidateIdentityVersion: null,
      };

      const restoredSnapshot = buildAtPrice({
        currentPrice: 7470,
        previousLocationCandidate:
          waitingSnapshotCandidate,
        snapshotTime:
          "2026-07-30T14:20:00.000Z",
        bars10m: [],
        ema10Posture: "BEARISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      });

      const restored =
        restoredSnapshot.engine26LocationCandidate;

      const reactionHandoff =
        restoredSnapshot.engine26ReactionHandoff;

      assert.equal(
        restored.candidateId,
        promoted.candidateId
      );
      assert.equal(restored.zoneId, promoted.zoneId);
      assert.equal(restored.active, true);
      assert.equal(restored.direction, "NEUTRAL");
      assert.equal(restored.directionBias, "NEUTRAL");
      assert.equal(restored.directionalResolved, false);
      assert.equal(
        restored.directionState,
        "SHORT_REVERSAL_WATCH"
      );
      assert.equal(
        restored.contactState,
        "NEGOTIATED_LINE_CONTACT"
      );
      assert.equal(restored.chainArmed, true);
      assert.equal(
        restored.expectedReversalDirection,
        "SHORT"
      );
      assert.equal(
        restored.expectedParticipationDirection,
        "SHORT"
      );
      assert.equal(restored.automaticDirectionFlip, false);
      assert.equal(restored.expectedDirection, null);
      assert.equal(
        restored.expectedReversalDirection,
        "SHORT"
      );
      assert.equal(
        restored.expectedParticipationDirection,
        "SHORT"
      );
      assert.ok(
        restored.expectedReactions.includes(
          "FAILED_RECLAIM"
        )
      );
      assert.equal(restored.reactionExpected, true);
      assert.equal(restored.shortConfirmed, false);
      assert.equal(
        restored.freshTargetMidlineContact,
        false
      );
      assert.equal(
        restored.restoredPromotedContact,
        true
      );
      assert.equal(
        restored.targetMidlineReachedAt,
        promoted.targetMidlineReachedAt
      );
      assert.equal(
        restored.promotionTime,
        promoted.promotionTime
      );
      assert.ok(
        restored.reasonCodes.includes(
          "ENGINE26_STRATEGY1_PROMOTED_CONTACT_RECOVERED_FROM_MEMORY"
        )
      );

      assert.equal(
        reactionHandoff.candidateId,
        promoted.candidateId
      );
      assert.equal(
        reactionHandoff.zoneId,
        promoted.zoneId
      );
      assert.equal(reactionHandoff.active, true);
      assert.equal(reactionHandoff.armed, true);
      assert.equal(reactionHandoff.chainArmed, true);
      assert.equal(
        reactionHandoff.status,
        "NEUTRAL_CONTACT_WATCH"
      );
      assert.equal(
        reactionHandoff.direction,
        "NEUTRAL"
      );
      assert.equal(
        reactionHandoff.directionalResolved,
        false
      );
      assert.equal(
        reactionHandoff.directionState,
        "SHORT_REVERSAL_WATCH"
      );
      assert.equal(
        reactionHandoff.expectedReactionDirection,
        "SHORT"
      );
      assert.equal(
        reactionHandoff.expectedParticipationDirection,
        "SHORT"
      );
      assert.equal(
        reactionHandoff.contactState,
        "NEGOTIATED_LINE_CONTACT"
      );
      assert.equal(
        reactionHandoff.authorizeEngine3Evaluation,
        true
      );
      assert.equal(
        reactionHandoff.reactionConfirmed,
        false
      );
      assert.ok(
        reactionHandoff.expectedReactions.includes(
          "FAILED_RECLAIM"
        )
      );
      assert.equal(
        reactionHandoff.reactionExpected,
        true
      );
      assert.notEqual(
        reactionHandoff.status,
        "WAITING_FOR_ACTIVATION_RANGE"
      );

      assert.equal(
        restoredSnapshot.engine26GeometryHandoff
          .directionalResolved,
        false
      );
      assert.equal(
        restoredSnapshot.engine26GeometryHandoff
          .geometryReady,
        false
      );
      assert.equal(
        restoredSnapshot.engine26GeometryHandoff
          .geometryFeasible,
        false
      );
      assert.equal(restored.noPermissionCreated, true);
      assert.equal(restored.noExecution, true);

      const persistedAfterRestore = JSON.parse(
        fs.readFileSync(memoryFilePath, "utf8")
      );

      const restoredRecord =
        persistedAfterRestore.records[
          promotedMemoryKey
        ];

      assert.equal(
        restoredRecord.contactState,
        "NEGOTIATED_LINE_CONTACT"
      );
      assert.equal(restoredRecord.chainArmed, true);
      assert.equal(
        restoredRecord.directionState,
        "SHORT_REVERSAL_WATCH"
      );
      assert.equal(
        restoredRecord.expectedReversalDirection,
        "SHORT"
      );
      assert.equal(
        restoredRecord.expectedParticipationDirection,
        "SHORT"
      );
      assert.equal(
        restoredRecord.priorRotationCompletionState,
        "FULL_TARGET_COMPLETION"
      );
      assert.equal(
        restoredRecord.priorRotationFullyComplete,
        true
      );
      assert.equal(
        restoredRecord.promotedFromTargetCompletion,
        true
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "completed-close invalidation prevents promoted contact restoration",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-promoted-contact-invalidated-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "",
        ].join("\n"),
        "utf8"
      );

      const priorLong = buildAtPrice({
        currentPrice: 7445.75,
        snapshotTime:
          "2026-07-30T15:00:00.000Z",
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const promoted = buildAtPrice({
        currentPrice: priorLong.targetZone.midline,
        previousLocationCandidate: priorLong,
        snapshotTime:
          "2026-07-30T15:10:00.000Z",
        bars10m: [],
        ema10Posture: null,
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const store = JSON.parse(
        fs.readFileSync(memoryFilePath, "utf8")
      );

      const promotedMemoryKey =
        buildStrategy1MemoryKey({
          laneId: "minute",
          symbol: "ES",
          strategyId: "intraday_scalp@10m",
          zoneId: promoted.zoneId,
        });

      store.records[
        promotedMemoryKey
      ].lifecycleStatus = "INVALIDATED";

      store.records[
        promotedMemoryKey
      ].invalidatedAt =
        "2026-07-30T15:15:00.000Z";

      store.records[
        promotedMemoryKey
      ].invalidationFacts = {
        ...(store.records[promotedMemoryKey]
          .invalidationFacts || {}),
        completedCloseInvalidationConfirmed:
          true,
        invalidationTime:
          "2026-07-30T15:15:00.000Z",
      };

      fs.writeFileSync(
        memoryFilePath,
        `${JSON.stringify(store, null, 2)}\n`,
        "utf8"
      );

      const result = buildAtPrice({
        currentPrice: 7470,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-07-30T15:20:00.000Z",
        bars10m: [],
        ema10Posture: "BEARISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: false,
      });

      assert.notEqual(
        result.engine26LocationCandidate.candidateId,
        promoted.candidateId
      );
      assert.equal(
        result.engine26LocationCandidate.reasonCodes
          ?.includes(
            "ENGINE26_STRATEGY1_PROMOTED_CONTACT_RECOVERED_FROM_MEMORY"
          ) || false,
        false
      );
      assert.equal(
        result.engine26ReactionHandoff
          .authorizeEngine3Evaluation,
        true
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "active LONG memory owner survives a favorable 10-point move and a nearer higher-ranked upper zone",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-active-long-owner-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "",
        ].join("\n"),
        "utf8"
      );

      const activeLong = buildAtPrice({
        currentPrice: 7445.75,
        snapshotTime:
          "2026-07-31T14:00:00.000Z",
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(activeLong.directionBias, "LONG");
      assert.equal(activeLong.entryZone.low, 7433.75);
      assert.equal(activeLong.entryZone.high, 7457.5);
      assert.equal(activeLong.targetZone.low, 7504);
      assert.equal(activeLong.targetZone.high, 7518.25);

      const waitingSnapshotCandidate = {
        active: false,
        status: "WAITING_FOR_LOCATION",
        laneId: "minute",
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: null,
        zoneId: null,
        directionBias: "NEUTRAL",
        direction: "NEUTRAL",
      };

      /*
       * 7490 is more than 10 points above the 7445.75 entry midpoint.
       * It is also much nearer the upper negotiated zone, but it has not
       * entered the 7504.00 target boundary.
       */
      const rebuilt = buildAtPrice({
        currentPrice: 7490,
        previousLocationCandidate:
          waitingSnapshotCandidate,
        snapshotTime:
          "2026-07-31T14:10:00.000Z",
        bars10m: [],
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(rebuilt.candidateId, activeLong.candidateId);
      assert.equal(rebuilt.zoneId, activeLong.zoneId);
      assert.equal(rebuilt.directionBias, "LONG");
      assert.deepEqual(rebuilt.entryZone, activeLong.entryZone);
      assert.deepEqual(rebuilt.targetZone, activeLong.targetZone);
      assert.equal(rebuilt.location.lo, 7433.75);
      assert.equal(rebuilt.location.hi, 7457.5);
      assert.equal(rebuilt.location.relation, "ABOVE_ZONE");
      assert.equal(rebuilt.childPreservation.recoveredFromMemory, true);
      assert.ok(
        rebuilt.reasonCodes.includes(
          "ENGINE26_STRATEGY1_DIRECTIONAL_CHILD_RECOVERED_FROM_MEMORY"
        )
      );
      assert.ok(
        rebuilt.childPreservation.nextRankedAlternativeZoneId
      );
      assert.notEqual(
        rebuilt.childPreservation.nextRankedAlternativeZoneId,
        rebuilt.zoneId
      );
      assert.equal(rebuilt.contactState, null);
      assert.equal(rebuilt.priorRotationFullyComplete, false);
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "active SHORT memory owner survives a favorable 10-point move and a nearer higher-ranked lower zone",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-active-short-owner-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "",
        ].join("\n"),
        "utf8"
      );

      const activeShort = buildAtPrice({
        currentPrice: 7502,
        snapshotTime:
          "2026-07-31T15:00:00.000Z",
        bars10m: shortUpperFactsBars(),
        ema10Posture: "BEARISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(activeShort.directionBias, "SHORT");
      assert.equal(activeShort.entryZone.low, 7504);
      assert.equal(activeShort.entryZone.high, 7518.25);
      assert.equal(activeShort.targetZone.low, 7433.75);
      assert.equal(activeShort.targetZone.high, 7457.5);

      const waitingSnapshotCandidate = {
        active: false,
        status: "WAITING_FOR_LOCATION",
        laneId: "minute",
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        candidateId: null,
        zoneId: null,
        directionBias: "NEUTRAL",
        direction: "NEUTRAL",
      };

      /*
       * 7475 is more than 10 points below the 7511.25 entry midpoint.
       * It is nearer the lower negotiated zone, but it has not entered the
       * 7457.50 target boundary.
       */
      const rebuilt = buildAtPrice({
        currentPrice: 7475,
        previousLocationCandidate:
          waitingSnapshotCandidate,
        snapshotTime:
          "2026-07-31T15:10:00.000Z",
        bars10m: [],
        ema10Posture: "BEARISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(rebuilt.candidateId, activeShort.candidateId);
      assert.equal(rebuilt.zoneId, activeShort.zoneId);
      assert.equal(rebuilt.directionBias, "SHORT");
      assert.deepEqual(rebuilt.entryZone, activeShort.entryZone);
      assert.deepEqual(rebuilt.targetZone, activeShort.targetZone);
      assert.equal(rebuilt.location.lo, 7504);
      assert.equal(rebuilt.location.hi, 7518.25);
      assert.equal(rebuilt.location.relation, "BELOW_ZONE");
      assert.equal(rebuilt.childPreservation.recoveredFromMemory, true);
      assert.ok(
        rebuilt.reasonCodes.includes(
          "ENGINE26_STRATEGY1_DIRECTIONAL_CHILD_RECOVERED_FROM_MEMORY"
        )
      );
      assert.ok(
        rebuilt.childPreservation.nextRankedAlternativeZoneId
      );
      assert.notEqual(
        rebuilt.childPreservation.nextRankedAlternativeZoneId,
        rebuilt.zoneId
      );
      assert.equal(rebuilt.contactState, null);
      assert.equal(rebuilt.priorRotationFullyComplete, false);
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "new approved negotiated-zone contact supersedes an older promoted observation",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-promoted-supersession-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "7750.00-7800.00 | NEG 7761.75-7789.75",
          "",
        ].join("\n"),
        "utf8"
      );

      const lower = buildAtPrice({
        currentPrice: 7445.75,
        snapshotTime:
          "2026-08-05T15:00:00.000Z",
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const oldPromoted = buildAtPrice({
        currentPrice:
          lower.targetZone.midline,
        previousLocationCandidate:
          lower,
        snapshotTime:
          "2026-08-05T15:10:00.000Z",
        bars10m: [],
        ema10Posture: null,
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      assert.equal(
        oldPromoted.contactState,
        "NEGOTIATED_LINE_CONTACT"
      );

      const supersededResult = buildAtPrice({
        currentPrice: 7775.75,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
          laneId: "minute",
          symbol: "ES",
          strategyId:
            "intraday_scalp@10m",
        },
        snapshotTime:
          "2026-08-05T15:20:00.000Z",
        bars10m: [],
        ema10Posture: null,
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      });

      const current =
        supersededResult
          .engine26LocationCandidate;

      const reaction =
        supersededResult
          .engine26ReactionHandoff;

      const geometry =
        supersededResult
          .engine26GeometryHandoff;

      assert.notEqual(
        current.candidateId,
        oldPromoted.candidateId
      );

      assert.notEqual(
        current.zoneId,
        oldPromoted.zoneId
      );

      assert.equal(
        current.location.lo,
        7761.75
      );

      assert.equal(
        current.location.hi,
        7789.75
      );

      assert.equal(
        current.location.relation,
        "INSIDE_ZONE"
      );

      assert.equal(
        current.direction,
        "NEUTRAL"
      );

      assert.equal(
        current.directionBias,
        "NEUTRAL"
      );

      assert.equal(
        current.tradeDirectionBias,
        "NEUTRAL"
      );

      assert.equal(
        current.directionalResolved,
        false
      );

      assert.equal(
        current.directionState,
        "SHORT_REVERSAL_WATCH"
      );

      assert.equal(
        current.expectedReversalDirection,
        "SHORT"
      );

      assert.equal(
        current.expectedReactionDirection,
        "SHORT"
      );

      assert.equal(
        current.contactState,
        "NEGOTIATED_LINE_CONTACT"
      );

      assert.equal(
        current.chainArmed,
        true
      );

      assert.equal(
        current.automaticDirectionFlip,
        false
      );

      assert.equal(
        current.priorCandidateId,
        oldPromoted.candidateId
      );

      assert.equal(
        current.priorZoneId,
        oldPromoted.zoneId
      );

      assert.equal(
        current.childPreservation
          .promotedObservationSuperseded,
        true
      );

      assert.equal(
        current.noPermissionCreated,
        true
      );

      assert.equal(
        current.noExecution,
        true
      );

      assert.equal(
        reaction.candidateId,
        current.candidateId
      );

      assert.equal(
        reaction.zoneId,
        current.zoneId
      );

      assert.equal(
        reaction.expectedReactionDirection,
        "SHORT"
      );

      assert.equal(
        reaction.direction,
        "NEUTRAL"
      );

      assert.equal(
        reaction.directionalResolved,
        false
      );

      assert.equal(
        reaction.authorizeEngine3Evaluation,
        true
      );

      assert.equal(
        reaction.reactionConfirmed,
        false
      );

      assert.equal(
        geometry.candidateId,
        current.candidateId
      );

      assert.equal(
        geometry.zoneId,
        current.zoneId
      );

      assert.equal(
        geometry.status,
        "WAITING_FOR_DIRECTIONAL_RESOLUTION"
      );

      assert.equal(
        geometry.geometryReady,
        false
      );

      assert.equal(
        geometry.geometryFeasible,
        false
      );

      const store = JSON.parse(
        fs.readFileSync(
          memoryFilePath,
          "utf8"
        )
      );

      const oldKey =
        buildStrategy1MemoryKey({
          laneId: "minute",
          symbol: "ES",
          strategyId:
            "intraday_scalp@10m",
          zoneId:
            oldPromoted.zoneId,
        });

      assert.equal(
        store.records[oldKey]
          .lifecycleStatus,
        "RETIRED"
      );

      assert.equal(
        store.records[oldKey]
          .releaseReason,
        "EXPLICIT_LIFECYCLE_PROMOTION"
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "restart restores the newest promoted observation instead of the superseded observation",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-promoted-restart-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "7750.00-7800.00 | NEG 7761.75-7789.75",
          "",
        ].join("\n"),
        "utf8"
      );

      const lower = buildAtPrice({
        currentPrice: 7445.75,
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const oldPromoted = buildAtPrice({
        currentPrice:
          lower.targetZone.midline,
        previousLocationCandidate:
          lower,
        snapshotTime:
          "2026-08-05T16:10:00.000Z",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const newestPromoted = buildAtPrice({
        currentPrice: 7775.75,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-08-05T16:20:00.000Z",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const restored = buildAtPrice({
        currentPrice: 7770,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-08-05T16:30:00.000Z",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: false,
      }).engine26LocationCandidate;

      assert.equal(
        restored.candidateId,
        newestPromoted.candidateId
      );

      assert.equal(
        restored.zoneId,
        newestPromoted.zoneId
      );

      assert.notEqual(
        restored.candidateId,
        oldPromoted.candidateId
      );

      assert.notEqual(
        restored.zoneId,
        oldPromoted.zoneId
      );

      assert.equal(
        restored.directionState,
        "SHORT_REVERSAL_WATCH"
      );

      assert.equal(
        restored.expectedReversalDirection,
        "SHORT"
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "distance alone does not supersede an active promoted observation",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-promoted-distance-only-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "7750.00-7800.00 | NEG 7761.75-7789.75",
          "",
        ].join("\n"),
        "utf8"
      );

      const lower = buildAtPrice({
        currentPrice: 7445.75,
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const promoted = buildAtPrice({
        currentPrice:
          lower.targetZone.midline,
        previousLocationCandidate:
          lower,
        snapshotTime:
          "2026-08-05T17:10:00.000Z",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      /*
       * Price is closer to the newer zone but has not entered
       * the approved negotiated boundaries.
       */
      const rebuilt = buildAtPrice({
        currentPrice: 7750,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-08-05T17:20:00.000Z",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: false,
      }).engine26LocationCandidate;

      assert.equal(
        rebuilt.candidateId,
        promoted.candidateId
      );

      assert.equal(
        rebuilt.zoneId,
        promoted.zoneId
      );

      assert.equal(
        rebuilt.childPreservation
          .promotedObservationSuperseded,
        false
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "a recent 10-minute touch supersedes the old promoted observation even after price moves back below the new zone",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-promoted-touch-then-away-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "7750.00-7800.00 | NEG 7761.75-7789.75",
          "",
        ].join("\n"),
        "utf8"
      );

      const lower = buildAtPrice({
        currentPrice: 7445.75,
        snapshotTime:
          "2026-08-05T15:00:00.000Z",
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const oldPromoted = buildAtPrice({
        currentPrice:
          lower.targetZone.midline,
        previousLocationCandidate:
          lower,
        snapshotTime:
          "2026-08-05T15:10:00.000Z",
        bars10m: [],
        ema10Posture: null,
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const switchedResult = buildAtPrice({
        currentPrice: 7757,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
          laneId: "minute",
          symbol: "ES",
          strategyId:
            "intraday_scalp@10m",
        },
        snapshotTime:
          "2026-08-05T15:20:00.000Z",
        bars10m: [
          {
            time:
              "2026-08-05T15:15:00.000Z",
            open: 7758,
            high: 7764,
            low: 7755,
            close: 7757,
            completed: false,
          },
        ],
        ema10Posture: null,
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      });

      const switched =
        switchedResult
          .engine26LocationCandidate;

      assert.notEqual(
        switched.candidateId,
        oldPromoted.candidateId
      );

      assert.notEqual(
        switched.zoneId,
        oldPromoted.zoneId
      );

      assert.equal(
        switched.location.lo,
        7761.75
      );

      assert.equal(
        switched.location.hi,
        7789.75
      );

      assert.equal(
        switched.location.relation,
        "BELOW_ZONE"
      );

      assert.equal(
        switched.childPreservation
          .promotedObservationSuperseded,
        true
      );

      assert.equal(
        switched.childPreservation
          .supersessionContactSource,
        "TEN_MINUTE_BAR_TOUCHED_NEGOTIATED_ZONE"
      );

      assert.equal(
        switched.direction,
        "NEUTRAL"
      );

      assert.equal(
        switched.directionState,
        "SHORT_REVERSAL_WATCH"
      );

      assert.equal(
        switched.expectedReactionDirection,
        "SHORT"
      );

      assert.equal(
        switched.noPermissionCreated,
        true
      );

      assert.equal(
        switched.noExecution,
        true
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "SHORT directional child remains authorized after leaving activation range below the zone",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-short-always-on-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "",
        ].join("\n"),
        "utf8"
      );

      const activeShort = buildAtPrice({
        currentPrice: 7502,
        snapshotTime:
          "2026-08-06T14:00:00.000Z",
        bars10m: shortUpperFactsBars(),
        ema10Posture: "BEARISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const result = buildAtPrice({
        currentPrice: 7475,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-08-06T14:10:00.000Z",
        bars10m: [],
        ema10Posture: "BEARISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: false,
      });

      const candidate =
        result.engine26LocationCandidate;
      const handoff =
        result.engine26ReactionHandoff;

      assert.equal(
        candidate.candidateId,
        activeShort.candidateId
      );
      assert.equal(
        candidate.zoneId,
        activeShort.zoneId
      );
      assert.equal(
        candidate.directionBias,
        "SHORT"
      );
      assert.equal(
        candidate.location.relation,
        "BELOW_ZONE"
      );

      assert.equal(handoff.active, true);
      assert.equal(handoff.armed, true);
      assert.equal(
        handoff.observerActive,
        true
      );
      assert.equal(
        handoff.evaluationContextValid,
        true
      );
      assert.equal(
        handoff.withinActivationRange,
        false
      );
      assert.equal(
        handoff.authorizeEngine3Evaluation,
        true
      );
      assert.equal(
        handoff.status,
        "ACTIVE_DIRECTIONAL_EVALUATION"
      );
      assert.ok(
        handoff.reasonCodes.includes(
          "ENGINE26_DIRECTIONAL_EVALUATION_PRESERVED_OUTSIDE_ACTIVATION_RANGE"
        )
      );
      assert.equal(
        handoff.noPermissionCreated,
        true
      );
      assert.equal(
        handoff.noExecution,
        true
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "LONG directional child remains authorized after leaving activation range above the zone",
  () => {
    const tempDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "engine26-long-always-on-"
      )
    );

    const memoryFilePath = path.join(
      tempDir,
      "negotiated-zone-memory.json"
    );

    const manualZonesFilePath = path.join(
      tempDir,
      "es-smz-manual-zones.txt"
    );

    try {
      fs.writeFileSync(
        manualZonesFilePath,
        [
          "7419.75-7473.50 | NEG 7433.75-7457.50",
          "7490.00-7525.00 | NEG 7504.00-7518.25",
          "",
        ].join("\n"),
        "utf8"
      );

      const activeLong = buildAtPrice({
        currentPrice: 7445.75,
        snapshotTime:
          "2026-08-06T15:00:00.000Z",
        bars10m: longLowerFactsBars(),
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: true,
      }).engine26LocationCandidate;

      const result = buildAtPrice({
        currentPrice: 7490,
        previousLocationCandidate: {
          active: false,
          status: "WAITING_FOR_LOCATION",
        },
        snapshotTime:
          "2026-08-06T15:10:00.000Z",
        bars10m: [],
        ema10Posture: "BULLISH",
        manualZonesFilePath,
        memoryFilePath,
        persistMemory: false,
      });

      const candidate =
        result.engine26LocationCandidate;
      const handoff =
        result.engine26ReactionHandoff;

      assert.equal(
        candidate.candidateId,
        activeLong.candidateId
      );
      assert.equal(
        candidate.zoneId,
        activeLong.zoneId
      );
      assert.equal(
        candidate.directionBias,
        "LONG"
      );
      assert.equal(
        candidate.location.relation,
        "ABOVE_ZONE"
      );

      assert.equal(handoff.active, true);
      assert.equal(handoff.armed, true);
      assert.equal(
        handoff.observerActive,
        true
      );
      assert.equal(
        handoff.evaluationContextValid,
        true
      );
      assert.equal(
        handoff.withinActivationRange,
        false
      );
      assert.equal(
        handoff.authorizeEngine3Evaluation,
        true
      );
      assert.equal(
        handoff.status,
        "ACTIVE_DIRECTIONAL_EVALUATION"
      );
      assert.ok(
        handoff.reasonCodes.includes(
          "ENGINE26_DIRECTIONAL_EVALUATION_PRESERVED_OUTSIDE_ACTIVATION_RANGE"
        )
      );
      assert.equal(
        handoff.noPermissionCreated,
        true
      );
      assert.equal(
        handoff.noExecution,
        true
      );
    } finally {
      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "Engine 26 reaction observer stays on without a valid location context",
  () => {
    const result =
      buildEngine26A({
        symbol: "ES",
        strategyId:
          "intraday_scalp@10m",
        timeframe: "10m",
        currentPrice: null,
        snapshotTime:
          "2026-08-06T16:00:00.000Z",
      });

    const handoff =
      result.engine26ReactionHandoff;

    assert.equal(handoff.active, true);
    assert.equal(handoff.armed, true);
    assert.equal(
      handoff.observerActive,
      true
    );
    assert.equal(
      handoff.evaluationContextValid,
      false
    );
    assert.equal(
      handoff.authorizeEngine3Evaluation,
      false
    );
    assert.equal(
      handoff.status,
      "OBSERVING_WITHOUT_LOCATION_CONTEXT"
    );
    assert.equal(
      handoff.noPermissionCreated,
      true
    );
    assert.equal(
      handoff.noExecution,
      true
    );
  }
);
