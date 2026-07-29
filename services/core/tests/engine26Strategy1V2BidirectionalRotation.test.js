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
  buildStrategy1MemoryKey,
  updateNegotiatedZoneMemory,
  retirePriorMemoryRecord,
} from "../logic/engine26/strategy1/updateNegotiatedZoneMemory.js";

import {
  evaluateStrategy1Geometry,
} from "../logic/engine26/strategy1/evaluateStrategy1Geometry.js";

const SETUP = "NEGOTIATED_ZONE_ROTATION";
const VERSION = "engine26.strategy1.v2";

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
    persistMemory: false,
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
  "target contact releases prior LONG and promotes a NEUTRAL observation zone",
  () => {
    const lower = buildAtPrice({
      currentPrice: 7445.75,
      bars10m: longLowerFactsBars(),
      ema10Posture: "BULLISH",
    }).engine26LocationCandidate;

    assert.equal(lower.directionBias, "LONG");

    const promoted = buildAtPrice({
      currentPrice: 7504,
      previousLocationCandidate: lower,
      bars10m: [],
      ema10Posture: null,
      snapshotTime:
        "2026-07-28T15:20:00.000Z",
    }).engine26LocationCandidate;

    assert.notEqual(
      promoted.zoneId,
      lower.zoneId
    );
    assert.equal(
      promoted.directionBias,
      "NEUTRAL"
    );
    assert.equal(
      promoted.directionState,
      "OBSERVING_PROMOTED_ZONE"
    );
    assert.equal(
      promoted.promotedObservationLocation
        .releaseReason,
      "TARGET_ZONE_REACHED"
    );
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
      currentPrice: 7504,
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
  }
);

test(
  "upper-zone acceptance plus bullish EMA10 resolves LONG continuation",
  () => {
    const neutralUpper = buildAtPrice({
      currentPrice: 7504,
      previousLocationCandidate:
        buildAtPrice({
          currentPrice: 7445.75,
          bars10m: longLowerFactsBars(),
          ema10Posture: "BULLISH",
        }).engine26LocationCandidate,
    }).engine26LocationCandidate;

    const continuation = buildAtPrice({
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
    }).engine26LocationCandidate;

    assert.equal(
      continuation.directionBias,
      "LONG"
    );
    assert.equal(
      continuation.directionState,
      "LONG_CONTINUATION_DEVELOPING"
    );
  }
);

test(
  "upper-zone rejection plus bearish EMA10 resolves SHORT reversal",
  () => {
    const neutralUpper = buildAtPrice({
      currentPrice: 7504,
      previousLocationCandidate:
        buildAtPrice({
          currentPrice: 7445.75,
          bars10m: longLowerFactsBars(),
          ema10Posture: "BULLISH",
        }).engine26LocationCandidate,
    }).engine26LocationCandidate;

    const reversal = buildAtPrice({
      currentPrice: 7502,
      previousLocationCandidate: neutralUpper,
      ema10Posture: {
        posture: "BEARISH",
        ema10: 7508,
        currentPrice: 7502,
      },
      bars10m: shortUpperFactsBars(),
    }).engine26LocationCandidate;

    assert.equal(
      reversal.directionBias,
      "SHORT"
    );
    assert.equal(
      reversal.directionState,
      "SHORT_REVERSAL_DEVELOPING"
    );
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
      currentPrice: 7504,
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
    assert.equal(geometry.target1Price, null);
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
