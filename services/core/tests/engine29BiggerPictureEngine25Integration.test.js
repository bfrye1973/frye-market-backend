import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine29StructuralParticipationContext,
} from "../logic/engine29/participation/buildStructuralParticipationContext.js";

function canonicalArtifact() {
  const breadth = {
    label: "BREADTH_PARTICIPATION_WEAK",
    score: 41,
    inputs: { intraday: { avgBreadth: 38 } },
  };

  const stockVolume = {
    intraday: {
      available: true,
      coveragePct: 88,
      advancingVolume: 20,
      decliningVolume: 40,
    },
  };

  const sectorParticipation = {
    intraday: {
      count: 11,
      bullishCount: 2,
      neutralCount: 3,
      bearishCount: 6,
    },
  };

  const distributionPressure = {
    schema: "engine25.distributionPressure.v2",
    engine: "engine25.distributionPressure.v2",
    available: true,
    label: "DISTRIBUTION_PRESSURE_HIGH",
    pressureLabel: "HIGH",
    rawPressure: 76.5,
    score: 23.5,
    integratedState: "DETERIORATING",
    authority: {
      owner: "ENGINE25",
      canonicalScoreTimeframe: "4h",
      oneHourRole: "TACTICAL_DIRECTION",
      thirtyMinuteRole: "CONFIRMATION_TRANSITION",
      tenMinuteRole: "ACCELERATION_WARNING",
    },
    persistence: {
      state: "CONFIRMED",
      confirmed: true,
    },
    structural4h: {
      timeframe: "4h",
      pressure: 76.5,
      label: "HIGH",
    },
    tactical1h: {
      timeframe: "1h",
      trend: { state: "RISING" },
    },
    confirmation30m: {
      timeframe: "30m",
      confirmation: { state: "SELLING_PRESSURE_CONFIRMED" },
    },
    acceleration10m: {
      timeframe: "10m",
      acceleration: { state: "FAST_SELLING_ACCELERATION_CONFIRMED" },
    },
  };

  return {
    contractValid: true,
    authority: "ENGINE25_PARTICIPATION_READ_ONLY",
    participation: {
      breadth,
      stockVolume,
      sectorParticipation,
      distributionPressure,
    },
    freshness: {
      state: "FRESH",
      reason: "ACTIVE_EQUITY_SESSION_CURRENT_VALID_SOURCE",
      equityScannerSession: { active: true },
      intraday: { state: "FRESH" },
      eod: { valid: true },
      lastValidEquityRead: false,
    },
    diagnostics: {
      lastKnownIntraday: { sourceTimestamp: "2026-10-15T15:00:00Z" },
    },
    reasonCodes: ["ENGINE25_PARTICIPATION_CURRENT_TRAP_CONFIRMATION_USABLE"],
  };
}

test("canonical Engine25 breadth/distribution truth is consumed unchanged", () => {
  const source = canonicalArtifact();
  const result = buildEngine29StructuralParticipationContext(source);

  assert.equal(result.owner, "ENGINE25");
  assert.equal(result.authority, "ENGINE25_READ_ONLY_CONTEXT");
  assert.equal(result.role, "STRUCTURAL_PARTICIPATION_CONTEXT_ONLY");
  assert.equal(result.mayRewriteEngine29StructuralState, false);
  assert.equal(result.contractValid, true);
  assert.equal(result.available, true);

  assert.deepEqual(result.breadth, source.participation.breadth);
  assert.deepEqual(result.stockVolume, source.participation.stockVolume);
  assert.deepEqual(
    result.sectorParticipation,
    source.participation.sectorParticipation
  );

  assert.equal(
    result.distribution.canonicalEngine,
    "engine25.distributionPressure.v2"
  );
  assert.equal(result.distribution.canonicalScoreTimeframe, "4h");
  assert.equal(result.distribution.rawPressure, 76.5);
  assert.equal(result.distribution.score, 23.5);
  assert.deepEqual(
    result.distribution.structural4h,
    source.participation.distributionPressure.structural4h
  );
});

test("legacy/non-v2 distribution cannot masquerade as structural participation authority", () => {
  const source = canonicalArtifact();
  source.participation.distributionPressure = {
    engine: "engine25.distributionPressure.v1",
    schema: "engine25.distributionPressure.v1",
    available: true,
    rawPressure: 90,
  };

  const result = buildEngine29StructuralParticipationContext(source);

  assert.equal(result.contractValid, true);
  assert.equal(result.available, false);
  assert.equal(result.distribution.structural4h, null);
  assert.ok(
    result.reasonCodes.includes("ENGINE25_DISTRIBUTION_V2_NOT_AVAILABLE")
  );
});

test("invalid Engine25 participation contract fails closed", () => {
  const result = buildEngine29StructuralParticipationContext({
    contractValid: false,
    participation: {
      distributionPressure: {
        engine: "engine25.distributionPressure.v2",
        schema: "engine25.distributionPressure.v2",
        available: true,
      },
    },
  });

  assert.equal(result.available, false);
  assert.equal(result.mayRewriteEngine29StructuralState, false);
  assert.ok(
    result.reasonCodes.includes("ENGINE25_PARTICIPATION_CONTRACT_INVALID")
  );
});

test("closed-session last valid read stays context and cannot rewrite 1W state", () => {
  const source = canonicalArtifact();
  source.freshness = {
    state: "LAST_VALID_EQUITY_READ",
    reason: "EQUITY_SESSION_CLOSED",
    equityScannerSession: { active: false },
    lastValidEquityRead: true,
  };

  const result = buildEngine29StructuralParticipationContext(source);

  assert.equal(result.available, true);
  assert.equal(result.freshness.lastValidEquityRead, true);
  assert.equal(result.mayRewriteEngine29StructuralState, false);
  assert.equal(result.role, "STRUCTURAL_PARTICIPATION_CONTEXT_ONLY");
});
