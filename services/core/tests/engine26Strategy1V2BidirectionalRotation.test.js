// services/core/tests/engine26Strategy1V2BidirectionalRotation.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

import {
  buildStrategy1Facts,
} from "../logic/engine26/strategy1/buildStrategy1Facts.js";

import {
  resolveEngine26Strategy1Identity,
} from "../logic/engine26/strategy1/resolveStrategy1Identity.js";

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

function engine22Context(direction = "DOWN") {
  return {
    currentLifecycleState: {
      key: "MINUTE_ROTATION_WATCH",
      direction,
    },
    waveOpportunity: {
      setupType: "MINUTE_ROTATION_WATCH",
      direction,
    },
    degreeStates: {
      minute: {
        stage: "C_COMPLETION_WATCH",
        direction,
      },
      subminute: {
        stage: "TACTICAL_ROTATION_WATCH",
        direction: "NEUTRAL",
      },
    },
  };
}

function buildAtPrice({
  currentPrice,
  previousLocationCandidate = null,
  bars10m = [],
  snapshotTime =
    "2026-07-28T15:00:00.000Z",
} = {}) {
  return buildEngine26A({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    timeframe: "10m",
    currentPrice,
    snapshotTime,
    engine22WaveStrategy: engine22Context(),
    engine25Context: null,
    engine1Context: null,
    previousLocationCandidate,
    bars10m,
    persistMemory: false,
    tickSize: 0.25,
    activationRangePoints: 4,
    monitoringRangePoints: 25,
  });
}

test(
  "preserved LONG child survives ranking and distance changes",
  () => {
    const first = buildAtPrice({
      currentPrice: 7445.75,
    });

    const lower =
      first.engine26LocationCandidate;

    assert.equal(lower.directionBias, "LONG");

    const second = buildAtPrice({
      currentPrice: 7500,
      previousLocationCandidate: lower,
      snapshotTime:
        "2026-07-28T15:10:00.000Z",
    });

    const preserved =
      second.engine26LocationCandidate;

    assert.equal(
      preserved.candidateId,
      lower.candidateId
    );
    assert.equal(preserved.zoneId, lower.zoneId);
    assert.equal(
      preserved.childPreservation
        .preservedBeforeRanking,
      true
    );
    assert.equal(
      second.engine26ReactionHandoff.active,
      false
    );
    assert.equal(
      second.engine26ReactionHandoff
        .authorizeEngine3Evaluation,
      false
    );
  }
);

test(
  "LONG target contact releases lower child and permits upper SHORT child",
  () => {
    const first = buildAtPrice({
      currentPrice: 7445.75,
    });

    const lower =
      first.engine26LocationCandidate;

    const promoted = buildAtPrice({
      currentPrice: 7504,
      previousLocationCandidate: lower,
      snapshotTime:
        "2026-07-28T15:20:00.000Z",
    }).engine26LocationCandidate;

    assert.notEqual(
      promoted.zoneId,
      lower.zoneId
    );
    assert.equal(promoted.directionBias, "SHORT");
    assert.equal(
      promoted.setupClass,
      SETUP
    );
  }
);

test(
  "preserved SHORT child survives ranking changes until lower target contact",
  () => {
    const lower = buildAtPrice({
      currentPrice: 7445.75,
    }).engine26LocationCandidate;

    const upper = buildAtPrice({
      currentPrice: 7504,
      previousLocationCandidate: lower,
      snapshotTime:
        "2026-07-28T15:20:00.000Z",
    }).engine26LocationCandidate;

    assert.equal(upper.directionBias, "SHORT");

    const preserved = buildAtPrice({
      currentPrice: 7460,
      previousLocationCandidate: upper,
      snapshotTime:
        "2026-07-28T15:30:00.000Z",
    }).engine26LocationCandidate;

    assert.equal(
      preserved.candidateId,
      upper.candidateId
    );
    assert.equal(preserved.zoneId, upper.zoneId);
    assert.equal(
      preserved.directionBias,
      "SHORT"
    );
  }
);

test(
  "LONG facts require sweep, completed reclaim, and post-reclaim hold",
  () => {
    const facts = buildStrategy1Facts({
      direction: "LONG",
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      locationInvalidationBoundary: 7433.5,
      bars10m: [
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
      ],
    });

    assert.equal(
      facts.sweepFacts.intrabarSweepObserved,
      true
    );
    assert.equal(
      facts.reclaimFacts
        .completedReclaimObserved,
      true
    );
    assert.equal(
      facts.postReclaimFacts
        .completedHoldObserved,
      true
    );
    assert.equal(
      facts.lifecycleFacts
        .reactionEvaluationFactsReady,
      true
    );
  }
);

test(
  "SHORT facts record rejection, failed acceptance, and hold",
  () => {
    const facts = buildStrategy1Facts({
      direction: "SHORT",
      entryZone: {
        low: 7504,
        high: 7518.25,
        midline: 7511.25,
      },
      locationInvalidationBoundary: 7518.5,
      bars10m: [
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
      ],
    });

    assert.equal(
      facts.rejectionFacts
        .completedRejectionObserved,
      true
    );
    assert.equal(
      facts.failedAcceptanceFacts
        .completedFailedAcceptanceObserved,
      true
    );
    assert.equal(
      facts.postRejectionFacts
        .completedHoldObserved,
      true
    );
    assert.equal(
      facts.lifecycleFacts
        .reactionEvaluationFactsReady,
      true
    );
  }
);

test(
  "intrabar invalidation breach does not retire either direction",
  () => {
    const longFacts = buildStrategy1Facts({
      direction: "LONG",
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      locationInvalidationBoundary: 7433.5,
      bars10m: [
        {
          time: "2026-07-28T14:40:00.000Z",
          open: 7440,
          high: 7452,
          low: 7432,
          close: 7448,
          completed: true,
        },
        {
          time: "2026-07-28T14:50:00.000Z",
          open: 7448,
          high: 7450,
          low: 7433,
          close: 7440,
          completed: false,
        },
      ],
    });

    assert.equal(
      longFacts.invalidationFacts
        .intrabarInvalidationBreachObserved,
      true
    );
    assert.equal(
      longFacts.invalidationFacts
        .completedCloseInvalidationConfirmed,
      false
    );

    const shortFacts = buildStrategy1Facts({
      direction: "SHORT",
      entryZone: {
        low: 7504,
        high: 7518.25,
        midline: 7511.25,
      },
      locationInvalidationBoundary: 7518.5,
      bars10m: [
        {
          time: "2026-07-28T17:30:00.000Z",
          open: 7508,
          high: 7520,
          low: 7502,
          close: 7510,
          completed: false,
        },
      ],
    });

    assert.equal(
      shortFacts.invalidationFacts
        .intrabarInvalidationBreachObserved,
      true
    );
    assert.equal(
      shortFacts.invalidationFacts
        .completedCloseInvalidationConfirmed,
      false
    );
  }
);

test(
  "memory preserves confirmed facts when later bar windows omit them",
  () => {
    const memoryKey = buildStrategy1MemoryKey({
      laneId: "minute",
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      zoneId: "ZONE-A",
    });

    const candidate = {
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
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
    };

    const first = updateNegotiatedZoneMemory({
      store: {
        schema:
          "engine26.negotiatedZoneMemory.v1",
        records: {},
      },
      memoryKey,
      candidate,
      facts: {
        interactionFacts: {
          interactionTimes: ["2026-07-28T14:40:00.000Z"],
        },
        sweepFacts: {
          intrabarSweepObserved: true,
          completedCandleSweepObserved: true,
          maximumSweepDepthPoints: 2.75,
        },
        reclaimFacts: {
          reclaimObserved: true,
          completedReclaimObserved: true,
          firstReclaimAt:
            "2026-07-28T14:40:00.000Z",
          latestReclaimAt:
            "2026-07-28T14:40:00.000Z",
        },
        postReclaimFacts: {
          completedHoldObserved: true,
          completedHoldCount: 1,
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
      candidate,
      facts: {
        interactionFacts: {
          interactionTimes: [],
        },
        sweepFacts: {},
        reclaimFacts: {},
        postReclaimFacts: {},
        invalidationFacts: {
          completedCloseInvalidationConfirmed:
            false,
        },
      },
      snapshotTime:
        "2026-07-28T15:10:00.000Z",
    });

    assert.equal(
      second.record.sweepFacts
        .completedCandleSweepObserved,
      true
    );
    assert.equal(
      second.record.reclaimFacts
        .completedReclaimObserved,
      true
    );
    assert.equal(
      second.record.postReclaimFacts
        .completedHoldObserved,
      true
    );
  }
);

test(
  "retirement requires an approved machine-readable reason",
  () => {
    const key = "minute::ES::intraday_scalp@10m::ZONE-A";
    const store = {
      schema:
        "engine26.negotiatedZoneMemory.v1",
      records: {
        [key]: {
          lifecycleStatus: "ACTIVE",
        },
      },
    };

    const rejected = retirePriorMemoryRecord({
      store,
      priorMemoryKey: key,
      retiredAt:
        "2026-07-28T15:00:00.000Z",
      retirementReason: "HIGHER_SCORE_SELECTED",
    });

    assert.equal(
      rejected.records[key].lifecycleStatus,
      "ACTIVE"
    );

    const accepted = retirePriorMemoryRecord({
      store,
      priorMemoryKey: key,
      retiredAt:
        "2026-07-28T15:00:00.000Z",
      retirementReason: "TARGET_ZONE_REACHED",
    });

    assert.equal(
      accepted.records[key].lifecycleStatus,
      "RETIRED"
    );
    assert.equal(
      accepted.records[key].releaseReason,
      "TARGET_ZONE_REACHED"
    );
  }
);

test(
  "V1 history is not adopted or rewritten as V2 identity",
  () => {
    const identity =
      resolveEngine26Strategy1Identity({
        symbol: "ES",
        strategyId: "intraday_scalp@10m",
        zoneId: "ZONE-A",
        directionBias: "LONG",
        previousLocationCandidate: {
          active: true,
          status: "ACTIVE",
          symbol: "ES",
          strategyId: "intraday_scalp@10m",
          zoneId: "ZONE-A",
          directionBias: "LONG",
          candidateId: "OLD-V1-CANDIDATE",
          setupClass:
            "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
          identitySetupKey:
            "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
          candidateIdentityVersion:
            "engine26.strategy1.v1",
        },
      });

    assert.notEqual(
      identity.candidateId,
      "OLD-V1-CANDIDATE"
    );
    assert.equal(
      identity.candidateIdentityVersion,
      VERSION
    );
    assert.equal(
      identity.identityAdoptedFromLegacy,
      false
    );
  }
);

function geometryFixture({
  direction,
  entryZone,
  targetZone,
  invalidation,
  candidateId = "CANDIDATE",
  zoneId = "ZONE",
} = {}) {
  const candidate = {
    active: true,
    status: "ACTIVE",
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    candidateId,
    zoneId,
    directionBias: direction,
    direction,
    setupType: SETUP,
    setupClass: SETUP,
    setupGrade: "A+++",
    identitySetupKey: SETUP,
    candidateIdentityVersion: VERSION,
    snapshotTime:
      "2026-07-28T15:00:00.000Z",
    entryZone,
    targetZone,
    locationInvalidationBoundary:
      invalidation,
    invalidationFacts: {
      completedCloseInvalidationConfirmed:
        false,
    },
  };

  const handoff = {
    active: true,
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    candidateId,
    zoneId,
    direction,
    setupClass: SETUP,
    setupGrade: "A+++",
    identitySetupKey: SETUP,
    candidateIdentityVersion: VERSION,
    snapshotTime:
      "2026-07-28T15:00:00.000Z",
    entryZone,
    targetZone,
    locationInvalidationBoundary:
      invalidation,
  };

  return evaluateStrategy1Geometry({
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
}

test(
  "LONG and SHORT geometry are symmetric and Engine 9 owns runner",
  () => {
    const longGeometry = geometryFixture({
      direction: "LONG",
      entryZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      targetZone: {
        low: 7504,
        high: 7518.25,
        midline: 7511.25,
      },
      invalidation: 7433.5,
    });

    assert.equal(
      longGeometry.target1Price,
      7504
    );
    assert.equal(
      longGeometry.target2Price,
      7511.25
    );
    assert.equal(
      longGeometry.targetApproachWarningLow,
      7497
    );
    assert.equal(
      longGeometry.targetApproachWarningHigh,
      7499
    );

    const shortGeometry = geometryFixture({
      direction: "SHORT",
      entryZone: {
        low: 7504,
        high: 7518.25,
        midline: 7511.25,
      },
      targetZone: {
        low: 7433.75,
        high: 7457.5,
        midline: 7445.75,
      },
      invalidation: 7518.5,
    });

    assert.equal(
      shortGeometry.target1Price,
      7457.5
    );
    assert.equal(
      shortGeometry.target2Price,
      7445.75
    );
    assert.equal(
      shortGeometry.targetApproachWarningLow,
      7462.5
    );
    assert.equal(
      shortGeometry.targetApproachWarningHigh,
      7464.5
    );

    for (const geometry of [
      longGeometry,
      shortGeometry,
    ]) {
      assert.equal(geometry.geometryReady, true);
      assert.equal(geometry.noExecution, true);
      assert.equal(
        geometry.officialPlanOwner,
        "ENGINE9"
      );
      assert.equal(
        geometry.proposedTargets[2].price,
        null
      );
      assert.equal(
        geometry.proposedTargets[2]
          .runnerHandoffRequired,
        true
      );
    }
  }
);
