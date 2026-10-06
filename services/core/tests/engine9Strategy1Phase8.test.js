import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEngine9OfficialManagementPlan,
} from "../logic/engine9/v1/buildOfficialManagementPlan.js";

const IDENTITY = Object.freeze({
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-TEST",
  zoneId: "E26Z-TEST",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
});

function makeInputs() {
  return {
    engine26LocationCandidate: {
      ...IDENTITY,
      direction: "SHORT",
      snapshotTime: "2026-08-31T04:31:09.771Z",
    },
    engine26ProposedGeometry: {
      ...IDENTITY,
      direction: "LONG",
      snapshotTime: "2026-08-31T04:31:09.771Z",
      geometryReady: true,
      candidateIdentityPreserved: true,
      proposedEntryPrice: 7696.5,
      proposedStopPrice: 7687,
      proposedStopDistancePoints: 9.5,
      target1Price: 7753.25,
      target2Price: 7763.5,
      target3Price: 7763.5,
      proposedTargets: [
        { sequence: 1, price: 7753.25 },
        { sequence: 2, price: 7763.5 },
        {
          sequence: 3,
          price: null,
          purpose: "THIRD_PROFIT_TARGET_ZONE_MIDLINE_TESTING",
          runnerHandoffRequired: false,
        },
      ],
      testingExitLifecycle: {
        active: true,
        mode: "SIMPLIFIED_THREE_BLOCK_TESTING",
        block1: { price: 7753.25 },
        block2: { price: 7763.5 },
        block3: { price: 7763.5 },
        remainingRunnerExpected: false,
      },
    },
    engine7SizingPreview: {
      ...IDENTITY,
      direction: "LONG",
      productionRiskBudgetDollars: 1000,
      productionRiskSupportedContracts: 1,
      productionEstimatedRiskDollars: 642.5,
      productionThreeContractPlanQualified: false,
      productionRiskLimited: true,
      testingDataCollectionMode: false,
      testingRiskOverrideApplied: false,
      paperTestingContracts: 0,
      testingThreeContractPlanQualified: false,
      threeContractAllocation: {
        block1Contracts: 0,
        block2Contracts: 0,
        block3Contracts: 0,
      },
    },
    engine6PaperPermission: {
      decision: "FAST_INTRADAY_PAPER_ALLOW",
      direction: "LONG",
      allowed: true,
      locked: true,
      planningAllowed: true,
    },
    engine27MinuteDecision: {
      ...IDENTITY,
      direction: "LONG",
      decisionState: "ALMOST_READY",
      readiness: {
        reactionReady: true,
        participationReady: true,
        permissionReady: true,
        plannerReady: false,
        invalidated: false,
      },
    },
    engine27MinuteFib: null,
    snapshotTime: "2026-08-31T04:31:09.771Z",
  };
}

test("current Strategy 1 identity enters PHASE_8A", () => {
  const plan = buildEngine9OfficialManagementPlan(makeInputs());
  assert.equal(plan.phase, "PHASE_8A");
  assert.equal(plan.setupClass, "NEGOTIATED_ZONE_ROTATION");
});

test("locked Engine 6 plus ready Engine 26B creates official plan", () => {
  const plan = buildEngine9OfficialManagementPlan(makeInputs());
  assert.equal(plan.planStatus, "OFFICIAL_PLAN_READY");
  assert.equal(plan.managementReady, true);
  assert.equal(plan.official, true);
  assert.match(plan.planId, /^E9P-/);
});

test("Engine 27 planner readiness is context only", () => {
  const inputs = makeInputs();
  inputs.engine27MinuteDecision.decisionState = "ALMOST_READY";
  inputs.engine27MinuteDecision.readiness.plannerReady = false;
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.managementReady, true);
  assert.equal(plan.upstreamState.engine27HardGateApplied, false);
  assert.ok(plan.warnings.includes("ENGINE27_PLANNER_NOT_READY_CONTEXT_ONLY"));
});

test("Engine 7 sizing preview does not veto Engine 9 management", () => {
  const inputs = makeInputs();
  inputs.engine7SizingPreview.threeContractAllocation = {
    block1Contracts: 0,
    block2Contracts: 0,
    block3Contracts: 0,
  };
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.managementReady, true);
  assert.equal(plan.upstreamState.engine7HardGateApplied, false);
});

test("uses Engine 26B locked direction rather than candidate directional watch", () => {
  const plan = buildEngine9OfficialManagementPlan(makeInputs());
  assert.equal(plan.upstreamState.candidateDirection, "SHORT");
  assert.equal(plan.direction, "LONG");
  assert.equal(plan.upstreamState.geometryDirection, "LONG");
});

test("publishes simplified three-block lifecycle with no runner", () => {
  const plan = buildEngine9OfficialManagementPlan(makeInputs());
  assert.deepEqual(plan.officialTargets.map((t) => t.price), [
    7753.25,
    7763.5,
    7763.5,
  ]);
  assert.deepEqual(plan.officialTargets.map((t) => t.contracts), [1, 1, 1]);
  assert.equal(plan.runnerPlan.enabled, false);
  assert.equal(plan.runnerTargetStatus, "NO_RUNNER_REQUIRED");
  assert.equal(plan.openingManagementPlan.runnerExpected, false);
});

test("does not require numeric Engine 26B third proposed target", () => {
  const inputs = makeInputs();
  inputs.engine26ProposedGeometry.proposedTargets[2].price = null;
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.managementReady, true);
  assert.equal(plan.officialTargets[2].price, 7763.5);
});

test("fails closed only when official management geometry is impossible", () => {
  const inputs = makeInputs();
  inputs.engine26ProposedGeometry.proposedEntryPrice = null;
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.planStatus, "INVALID_ENTRY_GEOMETRY");
  assert.equal(plan.managementReady, false);
  assert.equal(plan.planId, null);
});

test("fails closed on candidate/geometry identity corruption", () => {
  const inputs = makeInputs();
  inputs.engine26ProposedGeometry.zoneId = "WRONG-ZONE";
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.planStatus, "IDENTITY_MISMATCH");
  assert.equal(plan.managementReady, false);
});

test("SHORT geometry is supported", () => {
  const inputs = makeInputs();
  inputs.engine26LocationCandidate.direction = "LONG";
  inputs.engine26ProposedGeometry.direction = "SHORT";
  inputs.engine26ProposedGeometry.proposedEntryPrice = 7696.5;
  inputs.engine26ProposedGeometry.proposedStopPrice = 7705.75;
  inputs.engine26ProposedGeometry.target1Price = 7690.75;
  inputs.engine26ProposedGeometry.target2Price = 7650.25;
  inputs.engine26ProposedGeometry.target3Price = 7650.25;
  inputs.engine26ProposedGeometry.testingExitLifecycle.block3.price = 7650.25;
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.direction, "SHORT");
  assert.equal(plan.managementReady, true);
  assert.deepEqual(plan.officialTargets.map((t) => t.price), [
    7690.75,
    7650.25,
    7650.25,
  ]);
});

test("does not create downstream authority", () => {
  const plan = buildEngine9OfficialManagementPlan(makeInputs());
  assert.equal(plan.noPermissionCreated, true);
  assert.equal(plan.noSizingCreated, true);
  assert.equal(plan.noOrderCreated, true);
  assert.equal(plan.noExecution, true);
  assert.equal(plan.noJournalWrite, true);
});
