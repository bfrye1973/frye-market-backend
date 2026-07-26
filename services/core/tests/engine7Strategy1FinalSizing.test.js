import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine7FinalPositionSizing,
} from "../logic/engine7/v2/buildFinalPositionSizing.js";

const SETUP = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";
const SNAPSHOT_TIME = "2026-07-26T18:00:00.000Z";

const identity = (overrides = {}) => ({
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-ENGINE7B-TEST",
  zoneId: "E26Z-ENGINE7B-TEST",
  symbol: "ES",
  setupClass: SETUP,
  setupGrade: "A+++",
  identitySetupKey: SETUP,
  candidateIdentityVersion: "engine26.strategy1.v1",
  direction: "LONG",
  setupType: SETUP,
  snapshotTime: SNAPSHOT_TIME,
  ...overrides,
});

const risk = (overrides = {}) => ({
  instrument: "ES",
  riskBudgetDollars: 100,
  dollarsPerPoint: 50,
  minimumContracts: 1,
  maximumContracts: 3,
  roundingRule: "FLOOR",
  estimatedSlippagePointsPerSide: 0,
  commissionDollarsPerContractRoundTrip: 0,
  paperOnly: true,
  ...overrides,
});

const permission = (overrides = {}) => ({
  decision: "FAST_INTRADAY_PAPER_ALLOW",
  allowed: true,
  planningAllowed: true,
  ...overrides,
});

const readiness = (overrides = {}) => ({
  readiness: {
    reactionReady: true,
    participationReady: true,
    permissionReady: true,
    plannerReady: true,
    invalidated: false,
  },
  ...overrides,
});

const engine7A = (overrides = {}) => ({
  ...identity(),
  productionRiskBudgetDollars: 100,
  productionRiskSupportedContracts: 1,
  productionEstimatedRiskDollars: 100,
  productionThreeContractPlanQualified: false,
  productionRiskLimited: true,
  testingDataCollectionMode: true,
  testingRiskOverrideApplied: true,
  paperTestingContracts: 3,
  testingThreeContractPlanQualified: true,
  threeContractAllocation: {
    block1Contracts: 1,
    block2Contracts: 1,
    block3Contracts: 1,
    totalContracts: 3,
  },
  ...overrides,
});

const officialTargets = () => [
  { targetId: "T1", sequence: 1, price: 6004, purpose: "TARGET_1_ZONE_TOUCH" },
  { targetId: "T2", sequence: 2, price: 6006, purpose: "TARGET_2_ZONE_MIDLINE" },
  { targetId: "T3", sequence: 3, price: 6010, purpose: "ENGINE9_RUNNER" },
];

const managementBlocks = () => [
  { blockId: "BLOCK_1", contracts: 1, purpose: "TARGET_1_ZONE_TOUCH", targetId: "T1", targetPrice: 6004 },
  { blockId: "BLOCK_2", contracts: 1, purpose: "TARGET_2_ZONE_MIDLINE", targetId: "T2", targetPrice: 6006 },
  { blockId: "BLOCK_3", contracts: 1, purpose: "ENGINE9_RUNNER", targetId: "T3", targetPrice: 6010 },
];

const engine9 = (overrides = {}) => ({
  ...identity(),
  planId: "E9P-ENGINE7B-TEST",
  planStatus: "OFFICIAL_PLAN_READY",
  managementReady: true,
  official: true,
  officialEntryPrice: 6000,
  officialStopPrice: 5998,
  officialStopDistancePoints: 2,
  officialTargets: officialTargets(),
  openingManagementPlan: { blocks: managementBlocks() },
  threeBlockManagement: { blocks: managementBlocks() },
  runnerTargetPrice: 6010,
  runnerTargetStatus: "RUNNER_TARGET_SELECTED",
  runnerPlan: {
    enabled: true,
    blockId: "BLOCK_3",
    contracts: 1,
    runnerTargetPrice: 6010,
    runnerTargetStatus: "RUNNER_TARGET_SELECTED",
    status: "RUNNER_TARGET_SELECTED",
  },
  testingAllocationAccepted: true,
  allocationQualificationSource: "ENGINE7A_TESTING_DATA_COLLECTION",
  ...overrides,
});

function build(overrides = {}) {
  return buildEngine7FinalPositionSizing({
    engine7SizingPreview: overrides.engine7SizingPreview ?? engine7A(),
    engine6PaperPermission: overrides.engine6PaperPermission ?? permission(),
    engine27MinuteReadiness: overrides.engine27MinuteReadiness ?? readiness(),
    engine9OfficialManagementPlan: overrides.engine9OfficialManagementPlan ?? engine9(),
    riskConfig: overrides.riskConfig ?? risk(),
    tradeState: overrides.tradeState ?? {},
    snapshotTime: SNAPSHOT_TIME,
  });
}

function assertPaperSafety(output) {
  assert.equal(output.noOrderCreated, true);
  assert.equal(output.noExecution, true);
  assert.equal(output.noBrokerOrder, true);
  assert.equal(output.noFillCreated, true);
  assert.equal(output.noJournalWrite, true);
  assert.equal(output.tradeId, null);
  assert.equal(output.idempotencyKey, null);
  assert.equal(output.orderId, null);
  assert.notEqual(output.realExecutionAllowed, true);
  assert.notEqual(output.brokerExecutionAllowed, true);
  assert.notEqual(output.schwabExecutionAllowed, true);
  assert.notEqual(output.liveTradingAllowed, true);
}

test("production 1 and testing 3 coexist correctly", () => {
  const output = build();
  assert.equal(output.productionRiskSupportedContracts, 1);
  assert.equal(output.finalProductionContracts, 1);
  assert.equal(output.finalPaperTestingContracts, 3);
  assert.equal(output.finalContracts, 3);
  assert.equal(output.finalSizingMode, "PAPER_TESTING_DATA_COLLECTION");
  assert.equal(output.status, "FINAL_SIZE_READY");
  assert.equal(output.allowed, true);
  assert.equal(output.executableSizing, true);
  assert.equal(output.paperOrderSizingReady, true);
  assertPaperSafety(output);
});

test("production 0 and testing 3 coexist correctly", () => {
  const output = build({
    engine7SizingPreview: engine7A({
      productionRiskBudgetDollars: 50,
      productionRiskSupportedContracts: 0,
      productionEstimatedRiskDollars: 0,
    }),
    riskConfig: risk({ riskBudgetDollars: 50 }),
  });
  assert.equal(output.productionRiskSupportedContracts, 0);
  assert.equal(output.finalProductionContracts, 0);
  assert.equal(output.finalPaperTestingContracts, 3);
  assert.equal(output.finalContracts, 3);
  assert.equal(output.finalSizingMode, "PAPER_TESTING_DATA_COLLECTION");
});

test("production truth is preserved unchanged", () => {
  const source = engine7A({
    productionRiskBudgetDollars: 275,
    productionRiskSupportedContracts: 1,
    productionEstimatedRiskDollars: 100,
    productionThreeContractPlanQualified: false,
    productionRiskLimited: true,
  });
  const output = build({ engine7SizingPreview: source, riskConfig: risk({ riskBudgetDollars: 100 }) });
  assert.equal(output.productionRiskBudgetDollars, 275);
  assert.equal(output.productionRiskSupportedContracts, 1);
  assert.equal(output.productionEstimatedRiskDollars, 100);
  assert.equal(output.productionThreeContractPlanQualified, false);
  assert.equal(output.productionRiskLimited, true);
});

test("invalid testing permits valid production fallback", () => {
  const output = build({
    engine7SizingPreview: engine7A({ testingThreeContractPlanQualified: false }),
  });
  assert.equal(output.engine7ATestingThreeContractPlanQualified, false);
  assert.equal(output.finalTestingThreeContractPlanQualified, false);
  assert.equal(output.finalPaperTestingContracts, 0);
  assert.equal(output.finalProductionContracts, 1);
  assert.equal(output.finalContracts, 1);
  assert.equal(output.finalSizingMode, "PRODUCTION_RISK");
  assert.equal(output.status, "FINAL_SIZE_READY");
});

test("production never exceeds usable Engine 9 blocks", () => {
  const blocks = managementBlocks().slice(0, 2);
  const output = build({
    engine7SizingPreview: engine7A({
      productionRiskBudgetDollars: 300,
      productionRiskSupportedContracts: 3,
      productionEstimatedRiskDollars: 300,
      testingDataCollectionMode: false,
      testingRiskOverrideApplied: false,
      paperTestingContracts: 0,
      testingThreeContractPlanQualified: false,
    }),
    engine9OfficialManagementPlan: engine9({
      openingManagementPlan: { blocks },
      threeBlockManagement: { blocks },
      testingAllocationAccepted: false,
      allocationQualificationSource: "ENGINE7A_PRODUCTION_RISK_APPROVAL",
    }),
    riskConfig: risk({ riskBudgetDollars: 300 }),
  });
  assert.equal(output.finalProductionContracts, 2);
  assert.equal(output.finalContracts, 2);
});

test("missing optional Engine 6 identity metadata does not block", () => {
  const output = build({ engine6PaperPermission: permission() });
  assert.equal(output.status, "FINAL_SIZE_READY");
});

test("missing optional Engine 27E identity metadata does not block", () => {
  const output = build({ engine27MinuteReadiness: readiness() });
  assert.equal(output.status, "FINAL_SIZE_READY");
});

test("present Engine 6 identity conflict blocks", () => {
  const output = build({
    engine6PaperPermission: permission({ candidateId: "OTHER" }),
  });
  assert.equal(output.status, "STRATEGY1_IDENTITY_CONFLICT");
  assert.equal(output.finalContracts, 0);
});

test("present Engine 27E identity conflict blocks", () => {
  const output = build({
    engine27MinuteReadiness: readiness({ zoneId: "OTHER" }),
  });
  assert.equal(output.status, "STRATEGY1_IDENTITY_CONFLICT");
  assert.equal(output.finalContracts, 0);
});

test("malformed Strategy 1 claim does not fall back to legacy", () => {
  const malformed = engine7A({ laneId: "subminute" });
  const output = build({ engine7SizingPreview: malformed });
  assert.equal(output.status, "STRATEGY1_IDENTITY_CONFLICT");
  assert.equal(output.finalSizingMode, "UNAVAILABLE");
  assert.equal(output.finalContracts, 0);
});

test("legacy non-Strategy-1 behavior remains unchanged", () => {
  const legacyPlan = {
    planId: "LEGACY-P",
    candidateId: "LEGACY-C",
    zoneId: "LEGACY-Z",
    strategyId: "legacy_swing@1h",
    symbol: "ES",
    direction: "LONG",
    setupType: "LEGACY_SETUP",
    snapshotTime: SNAPSHOT_TIME,
    planStatus: "OFFICIAL",
    managementReady: true,
    official: true,
    officialEntryPrice: 6000,
    officialStopPrice: 5998,
    officialStopDistancePoints: 2,
    officialTargets: [{ targetId: "T1", price: 6004 }],
  };
  const output = buildEngine7FinalPositionSizing({
    engine6PaperPermission: { decision: "PAPER_ALLOW", allowed: true },
    engine27MinuteReadiness: { decisionState: "READY", ready: true },
    engine9OfficialManagementPlan: legacyPlan,
    riskConfig: risk(),
    tradeState: {},
  });
  assert.equal(output.status, "FINAL_SIZE_READY");
  assert.equal(output.finalContracts, 1);
  assert.equal(output.finalSizingMode, undefined);
});

test("Subminute remains outside strict Strategy 1", () => {
  const plan = {
    planId: "SUB-P",
    candidateId: "SUB-C",
    zoneId: "SUB-Z",
    laneId: "subminute",
    strategyId: "subminute_scalp@10m",
    symbol: "ES",
    direction: "LONG",
    setupType: "SUBMINUTE_SETUP",
    snapshotTime: SNAPSHOT_TIME,
    planStatus: "OFFICIAL",
    managementReady: true,
    officialEntryPrice: 6000,
    officialStopPrice: 5998,
    officialStopDistancePoints: 2,
    officialTargets: [{ targetId: "T1", price: 6004 }],
  };
  const output = buildEngine7FinalPositionSizing({
    engine7SizingPreview: { laneId: "subminute", strategyId: "subminute_scalp@10m" },
    engine6PaperPermission: { decision: "PAPER_ALLOW", allowed: true },
    engine27MinuteReadiness: { decisionState: "READY", ready: true },
    engine9OfficialManagementPlan: plan,
    riskConfig: risk(),
    tradeState: {},
  });
  assert.equal(output.status, "FINAL_SIZE_READY");
  assert.equal(output.finalSizingMode, undefined);
});

test("upstream testing evidence remains visible after Engine 9 rejection", () => {
  const output = build({
    engine9OfficialManagementPlan: engine9({ testingAllocationAccepted: false }),
  });
  assert.equal(output.engine7ATestingThreeContractPlanQualified, true);
  assert.deepEqual(output.engine7AThreeContractAllocation, {
    block1Contracts: 1,
    block2Contracts: 1,
    block3Contracts: 1,
    totalContracts: 3,
  });
  assert.equal(output.engine9TestingAllocationAccepted, false);
  assert.equal(output.finalTestingThreeContractPlanQualified, false);
  assert.deepEqual(output.finalThreeContractAllocation, {
    block1Contracts: 0,
    block2Contracts: 0,
    block3Contracts: 0,
    totalContracts: 0,
  });
  assert.equal(output.finalPaperTestingContracts, 0);
  assert.equal(output.finalContracts, 1);
});

test("production quantity conflict blocks production fallback but valid testing proceeds", () => {
  const output = build({
    engine7SizingPreview: engine7A({ productionRiskSupportedContracts: 2 }),
  });
  assert.equal(output.finalProductionContracts, 0);
  assert.equal(output.finalPaperTestingContracts, 3);
  assert.equal(output.finalContracts, 3);
  assert.equal(output.finalSizingMode, "PAPER_TESTING_DATA_COLLECTION");
  assert.ok(output.reasonCodes.includes("ENGINE7B_LEGACY_PRODUCTION_CROSS_CHECK_FAILED"));
});

test("blocked output keeps stable Strategy 1 schema", () => {
  const output = build({
    engine6PaperPermission: permission({ allowed: false }),
  });
  assert.equal(output.finalPaperTestingContracts, 0);
  assert.equal(output.finalContracts, 0);
  assert.equal(output.finalSizingMode, "UNAVAILABLE");
  assert.equal(output.finalSizingReady, false);
  assert.equal(output.paperOrderSizingReady, false);
  assert.equal(output.allowed, false);
  assert.equal(output.executableSizing, false);
  assert.deepEqual(output.finalThreeContractAllocation, {
    block1Contracts: 0,
    block2Contracts: 0,
    block3Contracts: 0,
    totalContracts: 0,
  });
  assertPaperSafety(output);
});

test("does not mutate any input", () => {
  const inputs = {
    engine7SizingPreview: engine7A(),
    engine6PaperPermission: permission(),
    engine27MinuteReadiness: readiness(),
    engine9OfficialManagementPlan: engine9(),
    riskConfig: risk(),
    tradeState: {},
  };
  const before = structuredClone(inputs);
  buildEngine7FinalPositionSizing(inputs);
  assert.deepEqual(inputs, before);
});
