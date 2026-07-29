// services/core/tests/engine26GeneralParentStrategy1Child.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

function makeEngine22MinuteDown() {
  return {
    degreeStates: {
      primary: { direction: "UP", stage: "ACTIVE" },
      intermediate: { direction: "UP", stage: "ACTIVE" },
      minor: {
        direction: "UP",
        stage: "E_LEG_COMPLETION_WATCH",
      },
      minute: {
        direction: "DOWN",
        stage: "C_COMPLETION_WATCH",
      },
      subminute: {
        direction: "NEUTRAL",
        stage: "TACTICAL_RECLAIM_WATCH",
      },
    },
    waveOpportunity: {
      direction: "NONE",
      setupType: "NONE",
    },
    currentLifecycleState: {
      direction: "NONE",
      key: "MINUTE_C_COMPLETION_WATCH",
    },
  };
}

test(
  "broad parent and V2 negotiated Strategy 1 child publish independently",
  () => {
    const result = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: 7475,
      snapshotTime: "2026-07-28T17:00:00.000Z",
      engine22WaveStrategy: makeEngine22MinuteDown(),
      engine25Context: null,
      engine1Context: null,
      previousLocationCandidate: null,
      bars10m: [],
      persistMemory: false,
      tickSize: 0.25,
      activationRangePoints: 4,
      monitoringRangePoints: 25,
    });

    const parent = result.engine26GeneralLocation;
    const child = result.engine26LocationCandidate;

    assert.ok(parent);
    assert.ok(child);

    assert.equal(
      parent.engine,
      "engine26.generalLocation.v1"
    );
    assert.equal(
      parent.location.source,
      "ENGINE26_MANUAL_IMBALANCE"
    );
    assert.equal(parent.location.lo, 7419.75);
    assert.equal(parent.location.hi, 7473.5);
    assert.equal(parent.directionBias, "SHORT");

    assert.equal(
      child.location.source,
      "ENGINE26_MANUAL_NEGOTIATED"
    );
    assert.equal(child.entryZone.low, 7433.75);
    assert.equal(child.entryZone.high, 7457.5);
    assert.equal(child.laneId, "minute");
    assert.equal(
      child.strategyId,
      "intraday_scalp@10m"
    );
    assert.equal(
      child.setupClass,
      "NEGOTIATED_ZONE_ROTATION"
    );
    assert.equal(
      child.identitySetupKey,
      "NEGOTIATED_ZONE_ROTATION"
    );
    assert.equal(
      child.candidateIdentityVersion,
      "engine26.strategy1.v2"
    );
    assert.equal(
      child.strategyEligibility.eligible,
      true
    );
    assert.equal(child.directionBias, "LONG");
    assert.equal(child.direction, "LONG");
    assert.equal(
      child.tradeDirectionBias,
      "LONG"
    );

    assert.notEqual(
      parent.location.source,
      child.location.source
    );

    assert.equal(
      result.engine26ReactionHandoff.candidateId,
      child.candidateId
    );
    assert.equal(
      result.engine26ReactionHandoff.zoneId,
      child.zoneId
    );
    assert.equal(
      result.engine26GeometryHandoff.candidateId,
      child.candidateId
    );
    assert.equal(
      result.engine26GeometryHandoff.zoneId,
      child.zoneId
    );
    assert.equal(
      result.engine26GeometryHandoff.direction,
      "LONG"
    );
    assert.equal(
      result.engine26GeometryHandoff.entryZone.low,
      7433.75
    );
    assert.equal(
      result.engine26GeometryHandoff.entryZone.high,
      7457.5
    );

    assert.equal(
      parent.noPermissionCreated,
      true
    );
    assert.equal(parent.noExecution, true);
    assert.equal(
      child.noPermissionCreated,
      true
    );
    assert.equal(child.noExecution, true);
  }
);

test(
  "missing in-range negotiated child waits safely while general parent remains available",
  () => {
    const result = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: 7800,
      snapshotTime: "2026-07-28T17:10:00.000Z",
      engine22WaveStrategy: makeEngine22MinuteDown(),
      engine25Context: null,
      engine1Context: null,
      previousLocationCandidate: null,
      bars10m: [],
      persistMemory: false,
      tickSize: 0.25,
      activationRangePoints: 4,
      monitoringRangePoints: 25,
    });

    assert.ok(result.engine26GeneralLocation);
    assert.equal(
      result.engine26LocationCandidate.active,
      false
    );
    assert.equal(
      result.engine26LocationCandidate.status,
      "WAITING_FOR_LOCATION"
    );
    assert.equal(
      result.engine26LocationCandidate.candidateId,
      null
    );
    assert.equal(
      result.engine26ReactionHandoff.active,
      false
    );
    assert.equal(
      result.engine26GeometryHandoff.active,
      false
    );
    assert.equal(
      result.engine26LocationCandidate
        .noPermissionCreated,
      true
    );
    assert.equal(
      result.engine26LocationCandidate.noExecution,
      true
    );
  }
);

test("Engine 26A does not mutate caller inputs", () => {
  const engine22WaveStrategy =
    makeEngine22MinuteDown();

  const before =
    JSON.stringify(engine22WaveStrategy);

  buildEngine26A({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    timeframe: "10m",
    currentPrice: 7475,
    snapshotTime: "2026-07-28T17:20:00.000Z",
    engine22WaveStrategy,
    engine25Context: null,
    engine1Context: null,
    previousLocationCandidate: null,
    bars10m: [],
    persistMemory: false,
    tickSize: 0.25,
    activationRangePoints: 4,
    monitoringRangePoints: 25,
  });

  assert.equal(
    JSON.stringify(engine22WaveStrategy),
    before
  );
});
