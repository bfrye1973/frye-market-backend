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
  setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  setupGrade: "A_PLUS",
  identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v1",
});

function makeInputs(overrides = {}) {
  const identity = { ...IDENTITY };

  const base = {
    engine26LocationCandidate: {
      ...identity,
      direction: "LONG",
      snapshotTime: "2026-07-23T20:00:00.000Z",
      entryZone: {
        low: 7573,
        high: 7575,
        midline: 7574,
      },
      targetZone: {
        low: 7600,
        high: 7610,
        midline: 7605,
      },
    },
    engine26ProposedGeometry: {
      ...identity,
      direction: "LONG",
      snapshotTime: "2026-07-23T20:00:00.000Z",
      geometryReady: true,
      proposedEntryPrice: 7574,
      proposedStopPrice: 7564,
      proposedStopDistancePoints: 10,
      proposedTargets: [
        {
          targetId: "TARGET_1",
          sequence: 1,
          purpose: "TARGET_1_ZONE_TOUCH",
          price: 7600,
        },
        {
          targetId: "TARGET_2",
          sequence: 2,
          purpose: "TARGET_2_ZONE_MIDLINE",
          price: 7605,
        },
        {
          targetId: "RUNNER_HANDOFF",
          sequence: 3,
          purpose: "ENGINE9_RUNNER_HANDOFF",
          price: null,
          runnerHandoffRequired: true,
        },
      ],
    },
    engine7SizingPreview: {
      ...identity,
      direction: "LONG",
      threeContractPlanQualified: true,
      threeContractAllocation: {
        block1Contracts: 1,
        block2Contracts: 1,
        block3Contracts: 1,
      },
    },
    engine6PaperPermission: {
      planningAllowed: true,
    },
    engine27MinuteDecision: {
      ...identity,
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
        e100: { price: 7605 },
        e1168: { price: 7604.75 },
        e1272: { price: "not-a-number" },
        e1618: { price: 7612.25 },
        e200: { price: 7620 },
        e2618: { price: 7630 },
      },
    },
    snapshotTime: "2026-07-23T20:00:00.000Z",
  };

  return {
    ...base,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildEngine9OfficialManagementPlan(makeInputs(overrides));
}

test("accepts two priced targets plus a null runner handoff", () => {
  const plan = build();
  assert.equal(plan.upstreamState.runnerHandoffAccepted, true);
  assert.ok(plan.reasonCodes.includes("ENGINE26B_NULL_RUNNER_HANDOFF_ACCEPTED"));
});

test("preserves Target 1 and Target 2 exactly from the Engine 26A target zone", () => {
  const plan = build();
  assert.equal(plan.officialTargets[0].price, 7600);
  assert.equal(plan.officialTargets[1].price, 7605);
  assert.equal(plan.openingManagementPlan.blocks[0].targetPrice, 7600);
  assert.equal(plan.openingManagementPlan.blocks[1].targetPrice, 7605);
});

test("selects the first approved numeric Minute Fib target strictly above Target 2", () => {
  const plan = build();
  assert.equal(plan.runnerTargetPrice, 7612.25);
  assert.equal(plan.runnerPlan.sourceTargetId, "e1618");
  assert.equal(plan.runnerTargetStatus, "RUNNER_TARGET_SELECTED");
});

test("rejects targets equal to or below Target 2 and non-numeric candidates", () => {
  const plan = build();
  assert.notEqual(plan.runnerPlan.sourceTargetId, "e100");
  assert.notEqual(plan.runnerPlan.sourceTargetId, "e1168");
  assert.notEqual(plan.runnerPlan.sourceTargetId, "e1272");
  assert.equal(plan.runnerPlan.sourceTargetId, "e1618");
});

test("does not invent a runner target when no approved target qualifies", () => {
  const inputs = makeInputs();
  for (const level of Object.values(inputs.engine27MinuteFib.extensions)) {
    level.price = 7605;
  }
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.runnerTargetPrice, null);
  assert.equal(plan.runnerTargetStatus, "RUNNER_TARGET_UNAVAILABLE");
  assert.equal(plan.managementReady, false);
  assert.ok(plan.blockers.includes("RUNNER_TARGET_UNAVAILABLE"));
});

test("requires an exact qualified 1 + 1 + 1 Engine 7A allocation", () => {
  const ready = build();
  assert.deepEqual(ready.upstreamState.allocation, {
    block1: 1,
    block2: 1,
    block3: 1,
  });
  assert.equal(ready.upstreamState.allocationValid, true);

  const missing = build({
    engine7SizingPreview: {
      ...IDENTITY,
      direction: "LONG",
      threeContractPlanQualified: true,
    },
  });
  assert.equal(missing.managementReady, false);
  assert.ok(missing.blockers.includes("ENGINE7A_ALLOCATION_INVALID"));

  const unqualifiedInputs = makeInputs();
  unqualifiedInputs.engine7SizingPreview.threeContractPlanQualified = false;
  const unqualified = buildEngine9OfficialManagementPlan(unqualifiedInputs);
  assert.equal(unqualified.managementReady, false);
  assert.ok(
    unqualified.blockers.includes("ENGINE7A_THREE_CONTRACT_PLAN_NOT_QUALIFIED")
  );
});

test("blocks identity mismatch without repairing identity", () => {
  const inputs = makeInputs();
  inputs.engine27MinuteDecision.zoneId = "DIFFERENT-ZONE";
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.planStatus, "IDENTITY_MISMATCH");
  assert.equal(plan.managementReady, false);
  assert.ok(plan.blockers.includes("PIPELINE_IDENTITY_MISMATCH"));
  assert.equal(plan.zoneId, IDENTITY.zoneId);
});

test("blocks candidate invalidation", () => {
  const inputs = makeInputs();
  inputs.engine27MinuteDecision.readiness.invalidated = true;
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.equal(plan.managementReady, false);
  assert.ok(plan.blockers.includes("CANDIDATE_INVALIDATED"));
});

test("blocks invalid entry and invalid stop", () => {
  const entryInputs = makeInputs();
  entryInputs.engine26ProposedGeometry.proposedEntryPrice = null;
  const badEntry = buildEngine9OfficialManagementPlan(entryInputs);
  assert.ok(badEntry.blockers.includes("INVALID_ENTRY_GEOMETRY"));

  const stopInputs = makeInputs();
  stopInputs.engine26ProposedGeometry.proposedStopPrice = 7575;
  const badStop = buildEngine9OfficialManagementPlan(stopInputs);
  assert.ok(badStop.blockers.includes("INVALID_STOP_GEOMETRY"));
});

test("blocks missing or malformed Engine 26B runner handoff", () => {
  const missingInputs = makeInputs();
  missingInputs.engine26ProposedGeometry.proposedTargets.pop();
  const missing = buildEngine9OfficialManagementPlan(missingInputs);
  assert.ok(missing.blockers.includes("ENGINE26B_RUNNER_HANDOFF_MISSING"));

  const malformedInputs = makeInputs();
  malformedInputs.engine26ProposedGeometry.proposedTargets[2].price = 7610;
  const malformed = buildEngine9OfficialManagementPlan(malformedInputs);
  assert.ok(malformed.blockers.includes("ENGINE26B_RUNNER_HANDOFF_MISSING"));
});

test("blocks missing or changed Target 1 and Target 2", () => {
  const changed1Inputs = makeInputs();
  changed1Inputs.engine26ProposedGeometry.proposedTargets[0].price = 7600.25;
  const changed1 = buildEngine9OfficialManagementPlan(changed1Inputs);
  assert.ok(changed1.blockers.includes("TARGET_1_CHANGED"));

  const changed2Inputs = makeInputs();
  changed2Inputs.engine26ProposedGeometry.proposedTargets[1].price = 7605.25;
  const changed2 = buildEngine9OfficialManagementPlan(changed2Inputs);
  assert.ok(changed2.blockers.includes("TARGET_2_CHANGED"));
});

test("non-Strategy-1 and Subminute inputs stay on legacy behavior", () => {
  const legacy = buildEngine9OfficialManagementPlan({});
  assert.equal(legacy.phase, undefined);
  assert.equal(legacy.planStatus, "WAITING_FOR_PROPOSED_GEOMETRY");

  const subminute = buildEngine9OfficialManagementPlan({
    engine26LocationCandidate: {
      ...IDENTITY,
      laneId: "subminute",
      strategyId: "subminute_scalp@10m",
    },
  });
  assert.equal(subminute.phase, undefined);
  assert.equal(subminute.planStatus, "WAITING_FOR_PROPOSED_GEOMETRY");
});

test("does not mutate any input and creates no execution authority", () => {
  const inputs = makeInputs();
  const before = structuredClone(inputs);
  const plan = buildEngine9OfficialManagementPlan(inputs);
  assert.deepEqual(inputs, before);
  assert.equal(plan.noPermissionCreated, true);
  assert.equal(plan.noSizingCreated, true);
  assert.equal(plan.noExecution, true);
  assert.equal(plan.noOrderCreated, true);
  assert.equal(plan.noJournalWrite, true);
  assert.equal(plan.phase8BImplemented, false);
  assert.equal(plan.dynamicManagementImplemented, false);
});

test("ready fixture publishes the official non-executable opening plan", () => {
  const plan = build();
  assert.equal(plan.planStatus, "OFFICIAL_PLAN_READY");
  assert.equal(plan.managementReady, true);
  assert.equal(plan.official, true);
  assert.equal(plan.openingManagementPlan.totalContracts, 3);
  assert.deepEqual(
    plan.openingManagementPlan.blocks.map((block) => block.contracts),
    [1, 1, 1]
  );
});
