import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine7ProposedSizingPreview,
  buildEngine7PositionSizingCompatibility,
} from "../logic/engine7/v2/buildProposedSizingPreview.js";

const risk = (overrides = {}) => ({
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
});

const geometry = (overrides = {}) => ({
  strategyId: "intraday_scalp@10m",
  symbol: "ES",
  direction: "SHORT",
  candidateId: "E26C-1216",
  zoneId: "E26Z-1216",
  proposedEntryPrice: 7600,
  proposedStopPrice: 7605,
  proposedStopDistancePoints: 5,
  proposedTargets: [],
  snapshotTime: "2026-09-28T19:16:00.000Z",
  ...overrides,
});

test("SHORT sizing succeeds without setup metadata or upstream requalification", () => {
  const old = process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;
  process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION = "1";
  try {
    const out = buildEngine7ProposedSizingPreview({
      engine26ProposedGeometry: geometry({
        laneId: null,
        setupClass: null,
        setupGrade: null,
        identitySetupKey: null,
        candidateIdentityVersion: null,
      }),
      engine6PaperPermission: {
        decision: "WAIT",
        allowed: false,
        planningAllowed: false,
      },
      engine27MinuteReadiness: {
        readiness: {
          reactionReady: false,
          participationReady: false,
          permissionReady: false,
          plannerReady: false,
          invalidated: true,
        },
      },
      riskConfig: risk(),
    });

    assert.equal(out.status, "FINAL_SIZE_READY");
    assert.equal(out.allowed, true);
    assert.equal(out.executableSizing, true);
    assert.equal(out.finalContracts, 3);
    assert.equal(out.finalSizingMode, "PAPER_TESTING_DATA_COLLECTION");
    assert.equal(out.blockers.length, 0);
  } finally {
    if (old === undefined) delete process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;
    else process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION = old;
  }
});

test("production risk still controls production quantity", () => {
  const old = process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;
  process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION = "0";
  try {
    const out = buildEngine7ProposedSizingPreview({
      engine26ProposedGeometry: geometry(),
      riskConfig: risk({ riskBudgetDollars: 300 }),
    });

    assert.equal(out.productionRiskSupportedContracts, 1);
    assert.equal(out.finalProductionContracts, 1);
    assert.equal(out.finalContracts, 1);
    assert.equal(out.finalSizingMode, "PRODUCTION_RISK");
    assert.equal(out.status, "FINAL_SIZE_READY");
  } finally {
    if (old === undefined) delete process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;
    else process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION = old;
  }
});

test("genuine sizing geometry failure still returns zero", () => {
  const out = buildEngine7ProposedSizingPreview({
    engine26ProposedGeometry: geometry({
      proposedStopPrice: 7595,
    }),
    riskConfig: risk(),
  });

  assert.equal(out.finalContracts, 0);
  assert.equal(out.allowed, false);
  assert.equal(out.executableSizing, false);
  assert.equal(out.status, "SIZING_GEOMETRY_INVALID");
  assert.ok(out.blockers.includes("ENGINE7_STOP_DIRECTION_INVALID_FOR_SIZING"));
});

test("compatibility publication does not recalculate size", () => {
  const sizing = buildEngine7ProposedSizingPreview({
    engine26ProposedGeometry: geometry(),
    riskConfig: risk({ riskBudgetDollars: 300 }),
  });

  const view = buildEngine7PositionSizingCompatibility({
    engine7Sizing: sizing,
    engine9OfficialManagementPlan: {
      planId: "E9P-1216",
      candidateId: "E26C-1216",
      zoneId: "E26Z-1216",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      direction: "SHORT",
      setupType: "TEST",
      snapshotTime: "2026-09-28T19:16:00.000Z",
      officialEntryPrice: 7600,
      officialStopPrice: 7605,
      officialStopDistancePoints: 5,
      planStatus: "OFFICIAL_PLAN_READY",
      managementReady: true,
      official: true,
    },
  });

  assert.equal(view.finalContracts, sizing.finalContracts);
  assert.equal(view.status, sizing.status);
  assert.equal(view.allowed, sizing.allowed);
  assert.equal(view.executableSizing, sizing.executableSizing);
  assert.equal(view.planId, "E9P-1216");
});
