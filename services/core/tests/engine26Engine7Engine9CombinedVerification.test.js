import test from "node:test";
import assert from "node:assert/strict";

import { buildEngine26PaperTradePlan } from "../logic/engine26/paperTradePlanner.js";
import { buildEngine7ProposedSizingPreview } from "../logic/engine7/v2/buildProposedSizingPreview.js";
import { buildEngine9OfficialManagementPlan } from "../logic/engine9/v1/buildOfficialManagementPlan.js";

const SETUP = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

const IDENTITY = Object.freeze({
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-COMBINED-VERIFY",
  zoneId: "E26Z-COMBINED-ENTRY",
  symbol: "ES",
  setupClass: SETUP,
  setupGrade: "A+++",
  identitySetupKey: SETUP,
  candidateIdentityVersion: "engine26.strategy1.v1",
});

function makeCandidate() {
  return {
    ...IDENTITY,
    active: true,
    status: "INSIDE_LOCATION",
    directionBias: "LONG",
    setupType: SETUP,
    snapshotTime: "2026-07-24T12:00:00.000Z",
    entryZone: {
      id: IDENTITY.zoneId,
      zoneId: IDENTITY.zoneId,
      low: 7441,
      high: 7450.5,
      midline: 7445.75,
    },
    targetZone: {
      id: "E26Z-COMBINED-TARGET",
      zoneId: "E26Z-COMBINED-TARGET",
      low: 7504,
      high: 7518.5,
      midline: 7511.25,
    },
    locationInvalidationBoundary: 7440.75,
    invalidationFacts: {
      completedCloseInvalidationConfirmed: false,
    },
  };
}

function makeHandoff() {
  const candidate = makeCandidate();
  return {
    ...IDENTITY,
    active: true,
    engine: "engine26.geometryHandoff.v1",
    setupType: SETUP,
    snapshotTime: candidate.snapshotTime,
    entryZone: structuredClone(candidate.entryZone),
    targetZone: structuredClone(candidate.targetZone),
    locationInvalidationBoundary: candidate.locationInvalidationBoundary,
    noPermissionCreated: true,
    noExecution: true,
  };
}

function makePermission() {
  return {
    paper: {
      ...IDENTITY,
      direction: "LONG",
      setupType: SETUP,
      snapshotTime: "2026-07-24T12:00:00.000Z",
      decision: "FAST_INTRADAY_PAPER_ALLOW",
      allowed: true,
      planningAllowed: true,
      sizeMultiplier: 1,
      mode: "PAPER_ONLY",
      realExecutionAllowed: false,
      requiresEngine8Paper: true,
      requiresEngine10Journal: true,
    },
  };
}

function buildEngine26Geometry() {
  return buildEngine26PaperTradePlan({
    symbol: "ES",
    strategyId: IDENTITY.strategyId,
    tf: "10m",
    permission: makePermission(),
    engine22WaveStrategy: {
      currentLifecycleState: {
        direction: "LONG",
        key: SETUP,
      },
    },
    engine25Context: {},
    confluence: {
      price: 7445.75,
      context: {
        reaction: {},
        volume: {},
      },
    },
    engine15Decision: {},
    engine26LocationCandidate: makeCandidate(),
    engine26GeometryHandoff: makeHandoff(),
    openPaperTrades: [],
    dailyBars: [],
  }).engine26ProposedGeometry;
}

function buildEngine7Sizing(engine26ProposedGeometry) {
  return buildEngine7ProposedSizingPreview({
    engine26ProposedGeometry,
    engine6PaperPermission: {
      ...IDENTITY,
      direction: "LONG",
      setupType: SETUP,
      snapshotTime: "2026-07-24T12:00:00.000Z",
      decision: "FAST_INTRADAY_PAPER_ALLOW",
      allowed: true,
      planningAllowed: true,
      sizeMultiplier: 1,
    },
    engine27MinuteReadiness: {
      ...IDENTITY,
      direction: "LONG",
      setupType: SETUP,
      snapshotTime: "2026-07-24T12:00:00.000Z",
      decisionState: "READY",
      reactionReady: true,
      participationReady: true,
      permissionReady: true,
      plannerReady: true,
      invalidated: false,
    },
    riskConfig: {
      instrument: "ES",
      riskBudgetDollars: 1000,
      dollarsPerPoint: 50,
      minimumContracts: 1,
      maximumContracts: 5,
      roundingRule: "FLOOR",
      estimatedSlippagePointsPerSide: 0.25,
      commissionDollarsPerContractRoundTrip: 5,
      paperOnly: true,
    },
    snapshotTime: "2026-07-24T12:00:00.000Z",
  });
}

function buildEngine9Plan(engine26ProposedGeometry, engine7SizingPreview) {
  return buildEngine9OfficialManagementPlan({
    engine26LocationCandidate: makeCandidate(),
    engine26ProposedGeometry,
    engine7SizingPreview,
    engine6PaperPermission: {
      planningAllowed: true,
    },
    engine27MinuteDecision: {
      ...IDENTITY,
      direction: "LONG",
      readiness: {
        reactionReady: true,
        participationReady: true,
        permissionReady: true,
        plannerReady: true,
        invalidated: false,
      },
    },
    engine27MinuteFib: {
      degree: "minute",
      activeLadder: "EXTENSION",
      validation: {
        available: true,
        matches: true,
      },
      extensions: {
        e100: { price: 7511.25 },
        e1168: { price: 7525 },
        e1272: { price: 7550 },
        e1618: { price: 7600 },
        e200: { price: 7650 },
        e2618: { price: 7739.5 },
      },
    },
    snapshotTime: "2026-07-24T12:00:00.000Z",
  });
}

test("combined Strategy 1 pipeline becomes ready without execution authority", () => {
  const geometry = buildEngine26Geometry();

  assert.equal(geometry.geometryReady, true);
  assert.equal(geometry.active, true);
  assert.equal(geometry.candidateIdentityPreserved, true);
  assert.equal(geometry.proposedEntryPrice, 7445.75);
  assert.equal(geometry.proposedStopPrice, 7440.75);
  assert.equal(geometry.proposedStopDistancePoints, 5);
  assert.equal(geometry.target1Price, 7504);
  assert.equal(geometry.target2Price, 7511.25);
  assert.equal(geometry.target3Price, null);
  assert.equal(geometry.runnerHandoffRequired, true);
  assert.equal(geometry.proposedTargets[2].purpose, "ENGINE9_RUNNER_HANDOFF");
  assert.equal(geometry.proposedTargets[2].price, null);

  const sizing = buildEngine7Sizing(geometry);

  assert.equal(sizing.threeContractPlanQualified, true);
  assert.equal(sizing.proposedContracts, 3);
  assert.deepEqual(sizing.allocation, [
    { contractBlock: 1, contracts: 1, purpose: "TARGET_1_ZONE_TOUCH" },
    { contractBlock: 2, contracts: 1, purpose: "TARGET_2_ZONE_MIDLINE" },
    { contractBlock: 3, contracts: 1, purpose: "ENGINE9_RUNNER_HANDOFF" },
  ]);

  const plan = buildEngine9Plan(geometry, sizing);

  assert.equal(plan.managementReady, true);
  assert.equal(plan.planStatus, "OFFICIAL_PLAN_READY");
  assert.equal(plan.officialTargets[0].price, 7504);
  assert.equal(plan.officialTargets[1].price, 7511.25);

  const runner =
    plan.officialTargets.find(
      (target) =>
        target?.role === "RUNNER" ||
        target?.purpose === "RUNNER" ||
        target?.sourcePurpose === "ENGINE9_RUNNER_HANDOFF"
    ) ?? plan.officialTargets[2];

  assert.equal(runner.price, 7739.5);

  assert.deepEqual(
    plan.openingManagementPlan.blocks.map((block) => block.contracts),
    [1, 1, 1]
  );

  assert.equal(plan.noPermissionCreated, true);
  assert.equal(plan.noSizingCreated, true);
  assert.equal(plan.noOrderCreated, true);
  assert.equal(plan.noExecution, true);
  assert.equal(plan.noJournalWrite, true);
});
