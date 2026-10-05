import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine8CanonicalPaperAdapter } from "../logic/trading/engine8CanonicalPaperAdapter.js";

function fixtures() {
  const canonical = {
    candidateId: "E26C-TEST",
    zoneId: "ZONE-TEST",
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    setupType: "NEGOTIATED_ZONE_ROTATION",
    setupClass: "NEGOTIATED_ZONE_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v1",
  };
  const carried = {
    ...canonical,
    planId: "E9P-TEST",
    symbol: "ES",
    direction: "SHORT",
    snapshotTime: "2026-09-28T20:55:00.000Z",
  };
  const engine6 = {
    ...carried,
    decision: "FAST_INTRADAY_PAPER_ALLOW",
    allowed: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
  };
  const engine9 = {
    ...carried,
    planStatus: "OFFICIAL_PLAN_READY",
    managementReady: true,
    official: true,
    officialEntryPrice: 7600,
    officialStopPrice: 7610,
    officialStopDistancePoints: 10,
    officialTargets: [{ targetId: "T1", price: 7580 }],
  };
  const engine7 = {
    ...carried,
    status: "FINAL_SIZE_READY",
    allowed: true,
    executableSizing: true,
    paperOrderSizingReady: true,
    finalContracts: 1,
    officialEntryPrice: 7600,
    officialStopPrice: 7610,
    officialStopDistancePoints: 10,
  };
  return { canonical, engine6, engine7, engine9 };
}

function run(overrides = {}) {
  const f = fixtures();
  return buildEngine8CanonicalPaperAdapter({
    engine26LocationCandidate: overrides.canonical ?? f.canonical,
    engine6PaperPermission: overrides.engine6 ?? f.engine6,
    engine7PositionSizing: overrides.engine7 ?? f.engine7,
    engine9OfficialManagementPlan: overrides.engine9 ?? f.engine9,
    duplicateState: { newPaperOrdersAllowed: true },
    paperExecutionEnabled: true,
    liveTradingEnabled: false,
    allowLiveFutures: false,
  });
}

test("matching E26A/E6/E7/E9 canonical identity passes", () => {
  const result = run();
  assert.equal(result.status, "READY_TO_CREATE_PAPER_ORDER");
  assert.equal(result.identityMatched, true);
  assert.equal(result.setupType, "NEGOTIATED_ZONE_ROTATION");
  assert.equal(result.finalContracts, 1);
});

for (const [name, key] of [["ENGINE6", "engine6"], ["ENGINE7", "engine7"], ["ENGINE9", "engine9"]]) {
  test(`conflicting ${name} setupType blocks and identifies carrier`, () => {
    const f = fixtures();
    const result = run({ [key]: { ...f[key], setupType: "WRONG_SETUP_TYPE" } });
    assert.equal(result.status, "IDENTITY_MISMATCH");
    assert.ok(result.blockers.includes("UPSTREAM_IDENTITY_MISMATCH"));
    assert.deepEqual(result.identityMismatches.find((m) => m.field === "setupType"), {
      canonicalOwner: "ENGINE26A",
      field: "setupType",
      canonicalValue: "NEGOTIATED_ZONE_ROTATION",
      mismatchedCarrier: name,
      carrierValue: "WRONG_SETUP_TYPE",
    });
  });
}

test("missing optional repeated carrier field is not invented or treated as mismatch", () => {
  const f = fixtures();
  const engine6 = { ...f.engine6 };
  delete engine6.setupGrade;
  const result = run({ engine6 });
  assert.equal(result.status, "READY_TO_CREATE_PAPER_ORDER");
  assert.equal(result.identityMismatches.length, 0);
  assert.equal(engine6.setupGrade, undefined);
});

test("missing canonical Engine26A required identity fails closed", () => {
  const f = fixtures();
  const canonical = { ...f.canonical, setupType: null };
  const result = run({ canonical });
  assert.equal(result.status, "IDENTITY_MISMATCH");
  assert.ok(result.reasonCodes.includes("ENGINE26A_CANONICAL_IDENTITY_REQUIRED"));
  assert.equal(result.identityMismatches[0].canonicalOwner, "ENGINE26A");
});

test("setupType compares only to canonical setupType, never setupClass", () => {
  const f = fixtures();
  const canonical = { ...f.canonical, setupClass: "DIFFERENT_CLASS" };
  const engine6 = { ...f.engine6, setupClass: "DIFFERENT_CLASS" };
  const engine7 = { ...f.engine7, setupClass: "DIFFERENT_CLASS" };
  const engine9 = { ...f.engine9, setupClass: "DIFFERENT_CLASS" };
  const result = run({ canonical, engine6, engine7, engine9 });
  assert.equal(result.status, "READY_TO_CREATE_PAPER_ORDER");
  assert.equal(result.setupType, "NEGOTIATED_ZONE_ROTATION");
  assert.equal(result.setupClass, "DIFFERENT_CLASS");
});

test("Engine7 planId must still correlate exactly to Engine9 planId", () => {
  const f = fixtures();
  const result = run({ engine7: { ...f.engine7, planId: "E9P-WRONG" } });
  assert.equal(result.status, "IDENTITY_MISMATCH");
  assert.ok(result.identityMismatches.some((m) => m.field === "planId"));
});

test("copied Engine7 geometry is not treated as a second geometry authority", () => {
  const f = fixtures();
  const result = run({
    engine7: {
      ...f.engine7,
      officialEntryPrice: 9999,
      officialStopPrice: 9998,
      officialStopDistancePoints: 1,
    },
  });
  assert.equal(result.status, "READY_TO_CREATE_PAPER_ORDER");
  assert.equal(result.geometryMatched, true);
  assert.deepEqual(result.geometryMismatches, []);
});

test("invalid Engine9 entry blocks", () => {
  const f = fixtures();
  const result = run({ engine9: { ...f.engine9, officialEntryPrice: null } });
  assert.equal(result.status, "GEOMETRY_SIZE_MISMATCH");
  assert.ok(result.blockers.includes("ENGINE9_OFFICIAL_ENTRY_INVALID"));
});

test("invalid Engine9 stop blocks", () => {
  const f = fixtures();
  const result = run({ engine9: { ...f.engine9, officialStopPrice: null } });
  assert.equal(result.status, "GEOMETRY_SIZE_MISMATCH");
  assert.ok(result.blockers.includes("ENGINE9_OFFICIAL_STOP_INVALID"));
});

test("directionally invalid Engine9 stop blocks", () => {
  const f = fixtures();
  const result = run({ engine9: { ...f.engine9, officialStopPrice: 7590 } });
  assert.equal(result.status, "GEOMETRY_SIZE_MISMATCH");
  assert.ok(result.blockers.includes("ENGINE9_SHORT_STOP_NOT_ABOVE_ENTRY"));
});

test("missing Engine9 targets blocks", () => {
  const f = fixtures();
  const result = run({ engine9: { ...f.engine9, officialTargets: [] } });
  assert.equal(result.status, "GEOMETRY_SIZE_MISMATCH");
  assert.ok(result.blockers.includes("ENGINE9_OFFICIAL_TARGETS_MISSING"));
});

test("directionally invalid Engine9 target blocks", () => {
  const f = fixtures();
  const result = run({
    engine9: {
      ...f.engine9,
      officialTargets: [{ targetId: "T1", price: 7620 }],
    },
  });
  assert.equal(result.status, "GEOMETRY_SIZE_MISMATCH");
  assert.ok(result.blockers.includes("ENGINE9_SHORT_TARGET_NOT_BELOW_ENTRY_T1"));
});

test("Engine7 finalContracts zero remains blocked", () => {
  const f = fixtures();
  const result = run({
    engine7: {
      ...f.engine7,
      finalContracts: 0,
      status: "FINAL_SIZE_READY",
      allowed: true,
      executableSizing: true,
    },
  });
  assert.equal(result.status, "WAITING_FOR_ENGINE7_FINAL_SIZE");
  assert.ok(result.blockers.includes("ENGINE7_FINAL_SIZE_NOT_READY"));
});

test("canonical identity mismatch still blocks", () => {
  const f = fixtures();
  const result = run({
    engine9: { ...f.engine9, candidateId: "E26C-WRONG" },
  });
  assert.equal(result.status, "IDENTITY_MISMATCH");
  assert.ok(result.blockers.includes("UPSTREAM_IDENTITY_MISMATCH"));
});
