import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStrategyTimeline,
  STAGE_ORDER,
  STATUS,
} from "./buildStrategyTimeline.js";

const VALID_STATUSES = new Set(Object.values(STATUS));

function baseFixture() {
  return {
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    snapshotTime: "2026-07-20T16:28:50.804Z",
    strategy: {
      strategyId: "intraday_scalp@10m",
      snapshotTime: "2026-07-20T16:28:50.804Z",
    },
    engine22: {
      activeWave: "W3",
      stage: "BREAKOUT_CANDIDATE",
      direction: "UP",
    },
    engine26A: {
      active: true,
      status: "LOCATION_DETECTED",
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      directionBias: "LONG",
      currentPrice: 7528,
      snapshotTime: "2026-07-20T16:28:50.804Z",
    },
    engine3: {
      active: true,
      authorized: true,
      allowed: false,
      authorizedReactionState: "REACTION_PENDING",
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
    },
    engine4: {
      active: true,
      allowed: false,
      confirmed: false,
      hardBlocked: false,
      status: "WAITING_FOR_ENGINE3_REACTION",
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
    },
    engine6: {
      decision: "PAPER_WATCH_FAST",
      allowed: false,
      mode: "PAPER_ONLY",
      realExecutionAllowed: false,
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
    },
    engine26B: {
      active: true,
      lifecycleStatus: "PROPOSED_GEOMETRY_AVAILABLE",
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      direction: "LONG",
      proposedEntryPrice: 7518.25,
      proposedStopPrice: 7503.75,
      proposedTargets: [],
    },
    engine27A: {
      active: true,
      currentWave: "W3",
      internalWave: "UNKNOWN",
      preferredTradeDirection: "LONG",
      invalidated: false,
      stage: "ACTIVE",
      currentRead: "Minute is currently advancing in Wave 3.",
    },
    engine27B: {
      currentPrice: 7528,
      nextFib: "e100",
      nextPrice: 7675.75,
    },
    engine27E: {
      decisionState: "SETTING_UP",
      direction: "LONG",
      currentWave: "W3",
      internalWave: "UNKNOWN",
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      readiness: {
        structureReady: true,
        priceReady: false,
        reactionReady: false,
        participationReady: false,
        permissionReady: false,
        plannerReady: false,
        invalidated: false,
      },
      waitingFor: ["ENGINE3_DIRECTIONAL_REACTION"],
      blockers: [],
      warnings: [],
      recommendedAction: "MONITOR_STRUCTURE",
    },
    engine7A: {
      active: true,
      status: "PREVIEW_ONLY_SETUP_NOT_READY",
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      direction: "LONG",
    },
    engine9: {
      active: true,
      official: false,
      managementReady: false,
      planStatus: "WAITING_FOR_UPSTREAM_CONFIRMATION",
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      direction: "LONG",
    },
    engine7B: {
      active: true,
      status: "WAITING_FOR_ENGINE9_OFFICIAL_PLAN",
      allowed: false,
      executableSizing: false,
      finalContracts: 0,
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      direction: "LONG",
    },
    engine8: {
      active: true,
      status: "WAITING_FOR_ENGINE6_PERMISSION",
      executable: false,
      candidateId: "C1",
      zoneId: "Z1",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      direction: "LONG",
    },
    engine10: null,
  };
}

test("stable ten-stage contract", () => {
  const timeline = buildStrategyTimeline(baseFixture());

  assert.equal(timeline.stages.length, 10);
  assert.deepEqual(
    timeline.stages.map((stage) => stage.id),
    STAGE_ORDER
  );

  for (const stage of timeline.stages) {
    assert.ok(VALID_STATUSES.has(stage.status));
    assert.ok(stage);
  }
});

test("missing data does not throw and all stages remain present", () => {
  const timeline = buildStrategyTimeline();

  assert.equal(timeline.stages.length, 10);
  assert.equal(timeline.state, "IDLE");
  assert.equal(timeline.candidateId, null);
  assert.equal(timeline.zoneId, null);
  assert.equal(timeline.executable, false);
  assert.equal(timeline.noExecution, true);
  assert.ok(timeline.stages.every((stage) => stage.status === "WAITING"));
});

test("Engine 8 exclusively owns executability", () => {
  const fixture = baseFixture();
  fixture.engine27E.decisionState = "READY";
  fixture.engine27E.readiness = {
    structureReady: true,
    priceReady: true,
    reactionReady: true,
    participationReady: true,
    permissionReady: true,
    plannerReady: true,
    invalidated: false,
  };
  fixture.engine6.allowed = true;
  fixture.engine6.decision = "FAST_INTRADAY_PAPER_ALLOW";
  fixture.engine8.executable = false;

  const timeline = buildStrategyTimeline(fixture);
  assert.equal(timeline.executable, false);
  assert.equal(timeline.noExecution, true);
});

test("normal upstream waiting never becomes a false blocker", () => {
  const timeline = buildStrategyTimeline(baseFixture());
  const execution = timeline.stages.find((stage) => stage.id === "execution");
  const management = timeline.stages.find((stage) => stage.id === "management");

  assert.equal(execution.status, "WAITING");
  assert.equal(management.status, "WAITING");
  assert.ok(!timeline.blockers.includes("ENGINE6_PAPER_NOT_ALLOWED"));
});

test("explicit Engine 6 denial blocks permission without making execution ready", () => {
  const fixture = baseFixture();
  fixture.engine6.decision = "DENY";
  fixture.engine6.allowed = false;

  const timeline = buildStrategyTimeline(fixture);
  const permission = timeline.stages.find((stage) => stage.id === "permission");
  const execution = timeline.stages.find((stage) => stage.id === "execution");

  assert.equal(permission.status, "BLOCKED");
  assert.notEqual(execution.status, "READY");
  assert.equal(timeline.executable, false);
});

test("candidate identity mismatch is exposed and source is not treated as ready", () => {
  const fixture = baseFixture();
  fixture.engine3.candidateId = "OTHER";
  fixture.engine27E.readiness.reactionReady = true;

  const timeline = buildStrategyTimeline(fixture);
  const reaction = timeline.stages.find((stage) => stage.id === "reaction");

  assert.equal(reaction.status, "BLOCKED");
  assert.ok(reaction.reasonCodes.includes("CANDIDATE_ID_MISMATCH"));
  assert.ok(timeline.blockers.includes("CANDIDATE_ID_MISMATCH"));
});

test("accepted lifecycle progresses through all ten stages", () => {
  const fixture = baseFixture();

  fixture.engine27E.decisionState = "READY";
  fixture.engine27E.recommendedAction = "REVIEW_PLANNER_TICKET";
  fixture.engine27E.readiness = {
    structureReady: true,
    priceReady: true,
    reactionReady: true,
    participationReady: true,
    permissionReady: true,
    plannerReady: true,
    invalidated: false,
  };

  fixture.engine3.allowed = true;
  fixture.engine3.authorizedReactionState = "REACTION_CONFIRMED";
  fixture.engine4.allowed = true;
  fixture.engine4.confirmed = true;
  fixture.engine4.status = "PARTICIPATION_CONFIRMED";
  fixture.engine6.allowed = true;
  fixture.engine6.decision = "FAST_INTRADAY_PAPER_ALLOW";
  fixture.engine26B.lifecycleStatus = "FAST_INTRADAY_PAPER_TICKET_READY";
  fixture.engine26B.proposedTargets = [{ price: 7675.75 }];
  fixture.engine7B.status = "FINAL_SIZE_READY";
  fixture.engine7B.allowed = true;
  fixture.engine7B.executableSizing = true;
  fixture.engine7B.finalContracts = 2;
  fixture.engine9.official = true;
  fixture.engine9.managementReady = true;
  fixture.engine9.planStatus = "OFFICIAL_PLAN_READY";
  fixture.engine8.status = "FILLED";
  fixture.engine8.executable = true;
  fixture.engine8.filled = true;
  fixture.engine10 = {
    lifecycleComplete: true,
    finalExitRecorded: true,
    candidateId: "C1",
    zoneId: "Z1",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    direction: "LONG",
  };

  const timeline = buildStrategyTimeline(fixture);
  const byId = Object.fromEntries(timeline.stages.map((stage) => [stage.id, stage]));

  assert.equal(byId.reaction.status, "READY");
  assert.equal(byId.participation.status, "READY");
  assert.equal(byId.permission.status, "READY");
  assert.equal(byId.geometry.status, "READY");
  assert.equal(byId.sizing.status, "READY");
  assert.equal(byId.management.status, "READY");
  assert.equal(byId.execution.status, "COMPLETE");
  assert.equal(byId.journal.status, "COMPLETE");
  assert.equal(timeline.executable, true);
});

test("builder does not mutate input", () => {
  const fixture = baseFixture();
  const before = structuredClone(fixture);

  buildStrategyTimeline(fixture);

  assert.deepEqual(fixture, before);
});
