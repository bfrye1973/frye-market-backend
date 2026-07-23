import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine7ProposedSizingPreview } from "../logic/engine7/v2/buildProposedSizingPreview.js";

const IDENTITY = Object.freeze({
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-STRATEGY1-TEST",
  zoneId: "E26Z-STRATEGY1-TEST",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "minute|intraday_scalp@10m|NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  candidateIdentityVersion: "engine26.candidateIdentity.v1",
});

function geometry(overrides = {}) {
  return {
    ...IDENTITY,
    direction: "LONG",
    setupType: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    snapshotTime: "2026-07-23T12:00:00.000Z",
    candidateIdentityPreserved: true,
    active: true,
    geometryReady: true,
    proposedEntryPrice: 6000,
    proposedStopPrice: 5998,
    proposedStopDistancePoints: 2,
    proposedTargets: [
      { targetId: "T1", price: 6004, purpose: "TARGET_1_ZONE_TOUCH" },
      { targetId: "T2", price: 6006, purpose: "TARGET_2_ZONE_MIDLINE" },
      { targetId: "T3", price: null, purpose: "ENGINE9_RUNNER_HANDOFF" },
    ],
    runnerHandoffRequired: true,
    ...overrides,
  };
}

function permission(overrides = {}) {
  return {
    ...IDENTITY,
    direction: "LONG",
    setupType: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    snapshotTime: "2026-07-23T12:00:00.000Z",
    decision: "FAST_INTRADAY_PAPER_ALLOW",
    allowed: true,
    planningAllowed: true,
    sizeMultiplier: 1,
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return {
    ...IDENTITY,
    direction: "LONG",
    setupType: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    snapshotTime: "2026-07-23T12:00:00.000Z",
    decisionState: "READY",
    reactionReady: true,
    participationReady: true,
    permissionReady: true,
    plannerReady: true,
    invalidated: false,
    ...overrides,
  };
}

function risk(overrides = {}) {
  return {
    instrument: "ES",
    riskBudgetDollars: 1000,
    dollarsPerPoint: 50,
    minimumContracts: 1,
    maximumContracts: 5,
    roundingRule: "FLOOR",
    estimatedSlippagePointsPerSide: 0.25,
    commissionDollarsPerContractRoundTrip: 5,
    paperOnly: true,
    ...overrides,
  };
}

function build({
  geometryOverride = {},
  permissionOverride = {},
  readinessOverride = {},
  riskOverride = {},
  riskConfig,
} = {}) {
  return buildEngine7ProposedSizingPreview({
    engine26ProposedGeometry: geometry(geometryOverride),
    engine6PaperPermission: permission(permissionOverride),
    engine27MinuteReadiness: readiness(readinessOverride),
    riskConfig: riskConfig === undefined ? risk(riskOverride) : riskConfig,
    snapshotTime: "2026-07-23T12:00:00.000Z",
  });
}

function assertNotReady(output) {
  assert.equal(output.sizingReady, false);
  assert.equal(output.threeContractPlanQualified, false);
  assert.equal(output.executableSizing, false);
  assert.equal(output.noExecution, true);
}

test("valid Strategy 1 gates produce an exact 1/1/1 three-contract preview", () => {
  const output = build();

  assert.equal(output.status, "STRATEGY1_THREE_CONTRACT_PREVIEW_READY");
  assert.equal(output.sizingState, "THREE_CONTRACT_PREVIEW_READY");
  assert.equal(output.sizingReady, true);
  assert.equal(output.threeContractPlanRequested, true);
  assert.equal(output.threeContractPlanQualified, true);
  assert.equal(output.riskSupportedContracts >= 3, true);
  assert.equal(output.proposedContracts, 3);
  assert.equal(output.totalContracts, 3);
  assert.equal(output.target1Contracts, 1);
  assert.equal(output.target2Contracts, 1);
  assert.equal(output.runnerContracts, 1);

  assert.deepEqual(output.allocation, [
    { contractBlock: 1, contracts: 1, purpose: "TARGET_1_ZONE_TOUCH" },
    { contractBlock: 2, contracts: 1, purpose: "TARGET_2_ZONE_MIDLINE" },
    { contractBlock: 3, contracts: 1, purpose: "ENGINE9_RUNNER_HANDOFF" },
  ]);

  assert.equal(output.proposedTargets[2].price, null);
  assert.equal(output.noRunnerTargetCreated, true);
  assert.equal(output.executableSizing, false);
});

test("preserves the complete Strategy 1 identity exactly", () => {
  const output = build();
  for (const [key, value] of Object.entries(IDENTITY)) {
    assert.equal(output[key], value, key);
  }
});

const waitingCases = [
  ["Engine 6 planning permission", { permissionOverride: { planningAllowed: false } }, "ENGINE6_PLANNING_PERMISSION_REQUIRED"],
  ["Engine 6 exact decision", { permissionOverride: { decision: "PAPER_ALLOW" } }, "ENGINE6_PLANNING_PERMISSION_REQUIRED"],
  ["Engine 6 allowed", { permissionOverride: { allowed: false } }, "ENGINE6_PLANNING_PERMISSION_REQUIRED"],
  ["Engine 26B geometryReady", { geometryOverride: { geometryReady: false } }, "ENGINE26B_GEOMETRY_READY_REQUIRED"],
  ["Engine 27E reaction readiness", { readinessOverride: { reactionReady: false } }, "ENGINE27E_REACTION_READY_REQUIRED"],
  ["Engine 27E participation readiness", { readinessOverride: { participationReady: false } }, "ENGINE27E_PARTICIPATION_READY_REQUIRED"],
  ["Engine 27E permission readiness", { readinessOverride: { permissionReady: false } }, "ENGINE27E_PERMISSION_READY_REQUIRED"],
  ["Engine 27E planner readiness", { readinessOverride: { plannerReady: false } }, "ENGINE27E_PLANNER_READY_REQUIRED"],
  ["candidate invalidation", { readinessOverride: { invalidated: true } }, "ENGINE27E_CANDIDATE_INVALIDATED"],
  ["candidate identity match", { permissionOverride: { candidateId: "OTHER" } }, "ENGINE6_CANDIDATEID_MISMATCH"],
  ["zone identity match", { readinessOverride: { zoneId: "OTHER" } }, "ENGINE27E_ZONEID_MISMATCH"],
  ["lane identity match", { geometryOverride: { laneId: "subminute" }, permissionOverride: { laneId: "subminute" }, readinessOverride: { laneId: "subminute" } }, "ENGINE7A_STRATEGY1_LANE_MISMATCH"],
  ["strategy identity match", { geometryOverride: { strategyId: "other" }, permissionOverride: { strategyId: "other" }, readinessOverride: { strategyId: "other" } }, "ENGINE7A_STRATEGY1_STRATEGY_MISMATCH"],
  ["valid entry and stop", { geometryOverride: { proposedStopPrice: 6001 } }, "ENGINE26B_GEOMETRY_INVALID"],
  ["Target 1", { geometryOverride: { proposedTargets: [{ price: null }, { price: 6006 }, { price: null, purpose: "ENGINE9_RUNNER_HANDOFF" }] } }, "ENGINE26B_TARGET1_REQUIRED"],
  ["Target 2", { geometryOverride: { proposedTargets: [{ price: 6004 }, { price: null }, { price: null, purpose: "ENGINE9_RUNNER_HANDOFF" }] } }, "ENGINE26B_TARGET2_REQUIRED"],
  ["runner handoff", { geometryOverride: { proposedTargets: [{ price: 6004 }, { price: 6006 }] } }, "ENGINE26B_RUNNER_HANDOFF_REQUIRED"],
  ["runner handoff null price", { geometryOverride: { proposedTargets: [{ price: 6004 }, { price: 6006 }, { price: 6010, purpose: "ENGINE9_RUNNER_HANDOFF" }] } }, "ENGINE26B_RUNNER_HANDOFF_REQUIRED"],
  ["runner handoff purpose", { geometryOverride: { proposedTargets: [{ price: 6004 }, { price: 6006 }, { price: null, purpose: "TARGET_3" }] } }, "ENGINE26B_RUNNER_HANDOFF_REQUIRED"],
  ["runner handoff required flag", { geometryOverride: { runnerHandoffRequired: false } }, "ENGINE26B_RUNNER_HANDOFF_REQUIRED"],
];

for (const [name, args, blocker] of waitingCases) {
  test(`${name} is required`, () => {
    const output = build(args);
    assertNotReady(output);
    assert.equal(output.blockers.includes(blocker), true, `${blocker} missing`);
  });
}

test("risk insufficient for three contracts never forces three", () => {
  const output = build({ riskOverride: { riskBudgetDollars: 250 } });

  assert.equal(output.status, "STRATEGY1_RISK_LIMITED");
  assert.equal(output.sizingState, "RISK_LIMITED");
  assert.equal(output.riskLimited, true);
  assert.equal(output.riskSupportedContracts, 1);
  assert.equal(output.proposedContracts, 1);
  assert.equal(output.totalContracts, 1);
  assertNotReady(output);
});

test("missing risk evidence waits safely", () => {
  const output = build({ riskConfig: null });
  assert.equal(output.status, "RISK_CONFIG_MISSING");
  assert.equal(output.sizingState, "RISK_EVIDENCE_UNAVAILABLE");
  assertNotReady(output);
});

test("legacy non-Strategy-1 sizing schema remains unchanged", () => {
  const legacyGeometry = {
    candidateId: "LEGACY-C",
    zoneId: "LEGACY-Z",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    direction: "LONG",
    setupType: "LEGACY_SETUP",
    snapshotTime: "2026-07-23T12:00:00.000Z",
    candidateIdentityPreserved: true,
    proposedEntryPrice: 6000,
    proposedStopPrice: 5998,
    proposedStopDistancePoints: 2,
    proposedTargets: [{ price: 6004 }],
  };

  const output = buildEngine7ProposedSizingPreview({
    engine26ProposedGeometry: legacyGeometry,
    engine6PaperPermission: { decision: "PAPER_ALLOW", allowed: true },
    engine27MinuteReadiness: { decisionState: "READY", ready: true },
    riskConfig: risk(),
  });

  assert.equal(output.threeContractPlanRequested, undefined);
  assert.equal(output.proposedContracts, undefined);
  assert.equal(output.allocation, undefined);
  assert.equal(output.estimatedContracts > 0, true);
  assert.equal(output.nonExecutable, true);
});

test("Subminute input remains on the legacy path and is not converted to Strategy 1", () => {
  const output = buildEngine7ProposedSizingPreview({
    engine26ProposedGeometry: {
      ...geometry(),
      laneId: "subminute",
      strategyId: "subminute_scalp@10m",
      setupClass: "SUBMINUTE_W3_CONTINUATION",
      setupType: "SUBMINUTE_W3_CONTINUATION",
    },
    engine6PaperPermission: null,
    engine27MinuteReadiness: null,
    riskConfig: risk(),
  });

  assert.equal(output.threeContractPlanRequested, undefined);
  assert.equal(output.allocation, undefined);
  assert.equal(output.nonExecutable, true);
});

test("does not mutate any input object", () => {
  const g = geometry();
  const p = permission();
  const r = readiness();
  const c = risk();
  const before = JSON.stringify({ g, p, r, c });

  buildEngine7ProposedSizingPreview({
    engine26ProposedGeometry: g,
    engine6PaperPermission: p,
    engine27MinuteReadiness: r,
    riskConfig: c,
  });

  assert.equal(JSON.stringify({ g, p, r, c }), before);
});

test("creates no permission, geometry, management, execution, order, fill, journal, or broker authority", () => {
  const output = build();

  assert.equal(output.noPermissionCreated, true);
  assert.equal(output.noOfficialPlanCreated, true);
  assert.equal(output.noManagementCreated, true);
  assert.equal(output.noRunnerTargetCreated, true);
  assert.equal(output.noOrderCreated, true);
  assert.equal(output.noFillCreated, true);
  assert.equal(output.noJournalEventCreated, true);
  assert.equal(output.noBrokerOrder, true);
  assert.equal(output.noExecution, true);
  assert.equal(output.executableSizing, false);
  assert.equal(output.tradeId, null);
  assert.equal(output.idempotencyKey, null);
});
