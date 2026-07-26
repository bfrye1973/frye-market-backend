import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine7ProposedSizingPreview,
} from "../logic/engine7/v2/buildProposedSizingPreview.js";
import {
  buildEngine9OfficialManagementPlan,
} from "../logic/engine9/v1/buildOfficialManagementPlan.js";
import {
  buildEngine7FinalPositionSizing,
} from "../logic/engine7/v2/buildFinalPositionSizing.js";

const SETUP = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";
const SNAPSHOT_TIME = "2026-07-26T18:00:00.000Z";

const candidate = {
  active: true,
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-COMBINED-E7B",
  zoneId: "E26Z-COMBINED-E7B",
  symbol: "ES",
  direction: "LONG",
  setupType: SETUP,
  setupClass: SETUP,
  setupGrade: "A+++",
  identitySetupKey: SETUP,
  candidateIdentityVersion: "engine26.strategy1.v1",
  snapshotTime: SNAPSHOT_TIME,
  targetZone: {
    low: 6004,
    midline: 6006,
  },
};

const geometry = {
  active: true,
  geometryReady: true,
  candidateIdentityPreserved: true,
  ...candidate,
  proposedEntryPrice: 6000,
  proposedStopPrice: 5998,
  proposedStopDistancePoints: 2,
  proposedTargets: [
    { targetId: "TARGET_1", sequence: 1, price: 6004, purpose: "TARGET_1_ZONE_TOUCH" },
    { targetId: "TARGET_2", sequence: 2, price: 6006, purpose: "TARGET_2_ZONE_MIDLINE" },
    {
      targetId: "RUNNER_HANDOFF",
      sequence: 3,
      price: null,
      purpose: "ENGINE9_RUNNER_HANDOFF",
      runnerHandoffRequired: true,
    },
  ],
};

const permission = {
  decision: "FAST_INTRADAY_PAPER_ALLOW",
  allowed: true,
  planningAllowed: true,
  ...candidate,
};

const minuteDecision = {
  decisionState: "READY",

  pipelineIdentity: {
    complete: true,
    consistent: true,
  },

  reactionReady: true,
  participationReady: true,
  permissionReady: true,
  plannerReady: true,
  invalidated: false,

  readiness: {
    reactionReady: true,
    participationReady: true,
    permissionReady: true,
    plannerReady: true,
    invalidated: false,
  },

  ...candidate,
};

const minuteFib = {
  degree: "minute",
  activeLadder: "EXTENSION",
  validation: {
    available: true,
    matches: true,
  },
  anchors: {
    direction: "BULLISH",
  },
  extensions: {
    e100: { price: 6005 },
    e1168: { price: 6010 },
    e1272: { price: 6012 },
  },
};

const riskConfig = {
  instrument: "ES",
  riskBudgetDollars: 100,
  dollarsPerPoint: 50,
  minimumContracts: 1,
  maximumContracts: 1,
  roundingRule: "FLOOR",
  estimatedSlippagePointsPerSide: 0,
  commissionDollarsPerContractRoundTrip: 0,
  paperOnly: true,
};

function buildPipeline({ waiting = false } = {}) {
  const priorFlag = process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;
  process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION = "1";

  try {
    const currentPermission = waiting
      ? { ...permission, allowed: false, planningAllowed: false }
      : permission;

    const engine7A = buildEngine7ProposedSizingPreview({
      engine26ProposedGeometry: geometry,
      engine6PaperPermission: currentPermission,
      engine27MinuteReadiness: minuteDecision,
      riskConfig,
      snapshotTime: SNAPSHOT_TIME,
    });

    const engine9 = buildEngine9OfficialManagementPlan({
      engine26LocationCandidate: candidate,
      engine26ProposedGeometry: geometry,
      engine7SizingPreview: engine7A,
      engine6PaperPermission: currentPermission,
      engine27MinuteDecision: minuteDecision,
      engine27MinuteFib: minuteFib,
      snapshotTime: SNAPSHOT_TIME,
    });

    const engine7B = buildEngine7FinalPositionSizing({
      engine7SizingPreview: engine7A,
      engine6PaperPermission: currentPermission,
      engine27MinuteReadiness: minuteDecision,
      engine9OfficialManagementPlan: engine9,
      riskConfig,
      tradeState: {
        duplicateBlocked: false,
        candidateAlreadySized: false,
        candidateAlreadyOrdered: false,
        openTradeForStrategy: false,
        idempotencyKeyAlreadyUsed: false,
      },
      snapshotTime: SNAPSHOT_TIME,
    });

    return { engine7A, engine9, engine7B };
  } finally {
    if (priorFlag === undefined) delete process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;
    else process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION = priorFlag;
  }
}

test("fully qualified Engine 26B to Engine 7A to Engine 9 to Engine 7B testing result", () => {
  const { engine7A, engine9, engine7B } = buildPipeline();

  assert.equal(engine7A.testingThreeContractPlanQualified, true);
  assert.equal(engine7A.paperTestingContracts, 3);
  assert.deepEqual(engine7A.threeContractAllocation, {
    block1Contracts: 1,
    block1Purpose: "TARGET_1_ZONE_TOUCH",
    block2Contracts: 1,
    block2Purpose: "TARGET_2_ZONE_MIDLINE",
    block3Contracts: 1,
    block3Purpose: "ENGINE9_RUNNER_HANDOFF",
    totalContracts: 3,
  });

  assert.equal(engine9.managementReady, true);
  assert.equal(engine9.testingAllocationAccepted, true);
  assert.equal(
    engine9.allocationQualificationSource,
    "ENGINE7A_TESTING_DATA_COLLECTION"
  );

  // Current Engine 9 production code publishes OFFICIAL_PLAN_READY.
  // Authorized Engine 7B requirements accept only OFFICIAL.
  // This assertion intentionally exposes the cross-contract blocker.
  assert.equal(engine9.planStatus, "OFFICIAL");

  assert.equal(engine7B.productionRiskSupportedContracts, 1);
  assert.equal(engine7B.finalProductionContracts, 1);
  assert.equal(engine7B.finalPaperTestingContracts, 3);
  assert.equal(engine7B.finalContracts, 3);
  assert.equal(engine7B.finalSizingMode, "PAPER_TESTING_DATA_COLLECTION");
  assert.equal(engine7B.finalSizingReady, true);
  assert.equal(engine7B.paperOrderSizingReady, true);
  assert.equal(engine7B.status, "FINAL_SIZE_READY");
  assert.equal(engine7B.allowed, true);
  assert.equal(engine7B.executableSizing, true);
  assert.equal(engine7B.noOrderCreated, true);
  assert.equal(engine7B.noExecution, true);
  assert.equal(engine7B.noBrokerOrder, true);
  assert.equal(engine7B.noFillCreated, true);
  assert.equal(engine7B.noJournalWrite, true);
});

test("controlled Engine 6 safe-waiting result remains stable and non-executing", () => {
  const { engine7B } = buildPipeline({ waiting: true });

  assert.equal(engine7B.finalPaperTestingContracts, 0);
  assert.equal(engine7B.finalContracts, 0);
  assert.equal(engine7B.finalSizingMode, "UNAVAILABLE");
  assert.equal(engine7B.finalSizingReady, false);
  assert.equal(engine7B.paperOrderSizingReady, false);
  assert.equal(engine7B.allowed, false);
  assert.equal(engine7B.executableSizing, false);
  assert.equal(engine7B.noOrderCreated, true);
  assert.equal(engine7B.noExecution, true);
  assert.equal(engine7B.noBrokerOrder, true);
  assert.equal(engine7B.noFillCreated, true);
  assert.equal(engine7B.noJournalWrite, true);
});
