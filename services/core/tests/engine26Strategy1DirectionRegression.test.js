import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

const EXPECTED_SETUP =
  "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

test("Strategy 1 does not inherit Engine 22 Minute DOWN as trade direction", () => {
  const result = buildEngine26A({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    timeframe: "10m",
    currentPrice: 7445.75,
    snapshotTime: "2026-07-28T15:15:00.000Z",

    engine22WaveStrategy: {
      currentLifecycleState: {
        key: "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
        direction: "DOWN",
      },
      waveOpportunity: {
        setupType: "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
        direction: "DOWN",
      },
      degreeStates: {
        minor: {
          stage: "E_LEG_COMPLETION_WATCH",
          direction: "UP",
        },
        minute: {
          stage: "C_COMPLETION_WATCH",
          direction: "DOWN",
        },
        subminute: {
          stage: "TACTICAL_RECLAIM_WATCH",
          direction: "NEUTRAL",
        },
      },
    },

    bars10m: [
      {
        time: "2026-07-28T14:40:00.000Z",
        open: 7440,
        high: 7452,
        low: 7431,
        close: 7450.5,
        volume: 32000,
        completed: true,
      },
      {
        time: "2026-07-28T14:50:00.000Z",
        open: 7450.5,
        high: 7452,
        low: 7437.5,
        close: 7444,
        volume: 23033,
        completed: true,
      },
      {
        time: "2026-07-28T15:00:00.000Z",
        open: 7444,
        high: 7454.75,
        low: 7442,
        close: 7451.5,
        volume: 21523,
        completed: false,
      },
    ],

    persistMemory: false,
  });

  const candidate = result.engine26LocationCandidate;
  const handoff = result.engine26ReactionHandoff;

  assert.equal(candidate.strategyEligibility?.eligible, true);
  assert.equal(candidate.setupClass, EXPECTED_SETUP);
  assert.equal(candidate.setupGrade, "A+++");

  assert.equal(candidate.entryZone?.low, 7433.75);
  assert.equal(candidate.entryZone?.high, 7457.5);
  assert.equal(candidate.entryZone?.midline, 7445.75);

  assert.equal(candidate.directionBias, "LONG");
  assert.equal(candidate.direction, "LONG");
  assert.equal(candidate.tradeDirectionBias, "LONG");

  assert.equal(candidate.triggerLevel, 7457.5);
  assert.equal(candidate.reclaimBoundary, 7433.75);
  assert.equal(candidate.locationInvalidationBoundary, 7433.5);

  assert.equal(candidate.sweepFacts?.intrabarSweepObserved, true);
  assert.equal(candidate.sweepFacts?.completedCandleSweepObserved, true);
  assert.equal(candidate.reclaimFacts?.reclaimObserved, true);
  assert.equal(
    candidate.reclaimFacts?.latestReclaim?.closedAboveMidline,
    true
  );

  assert.equal(
    candidate.invalidationFacts?.completedCloseInvalidationConfirmed,
    false
  );

  assert.equal(candidate.active, true);
  assert.notEqual(candidate.status, "INVALIDATED");

  assert.equal(handoff.active, true);
  assert.equal(handoff.authorizeEngine3Evaluation, true);
  assert.equal(handoff.tradeDirectionBias, "LONG");
  assert.equal(handoff.expectedReactionDirection, "LONG");

  assert.equal(candidate.noPermissionCreated, true);
  assert.equal(candidate.noExecution, true);
  assert.equal(handoff.noPermissionCreated, true);
  assert.equal(handoff.noExecution, true);

  assert.ok(
    candidate.reasonCodes.includes(
      "ENGINE26_STRATEGY1_TACTICAL_DIRECTION_LONG"
    )
  );

  assert.ok(
    candidate.reasonCodes.includes(
      "ENGINE22_INTERNAL_LEG_DIRECTION_NOT_USED_AS_TRADE_DIRECTION"
    )
  );
});
