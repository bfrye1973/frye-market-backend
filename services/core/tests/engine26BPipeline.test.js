import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine26BPipeline,
  isLockedEngine6PaperPackageValid,
} from "../logic/engine26/strategy1/buildEngine26BPipeline.js";

const SETUP = "NEGOTIATED_ZONE_ROTATION";
const VERSION = "engine26.strategy1.v2";
const STRATEGY = "intraday_scalp@10m";
const CANDIDATE_ID = "E26C-PIPELINE-TEST";
const ZONE_ID = "E26Z-PIPELINE-ENTRY";

function identity() {
  return {
    laneId: "minute",
    strategyId: STRATEGY,
    symbol: "ES",
    candidateId: CANDIDATE_ID,
    zoneId: ZONE_ID,
    setupClass: SETUP,
    setupGrade: "A+++",
    identitySetupKey: SETUP,
    candidateIdentityVersion: VERSION,
  };
}

function candidate(direction = "NEUTRAL") {
  return {
    active: true,
    status: "OBSERVING_ZONE_REACTION",
    ...identity(),
    directionBias: direction,
    tradeDirectionBias: direction,
    direction,
    directionState: direction === "NEUTRAL" ? "NEUTRAL" : "DIRECTIONAL_RESOLVED",
    setupType: SETUP,
    snapshotTime: "2026-08-28T16:00:00.000Z",
    entryZone: {
      id: ZONE_ID,
      zoneId: ZONE_ID,
      low: 7740,
      high: 7760,
      midline: 7750,
    },
    targetZone: {
      id: "E26Z-PIPELINE-TARGET",
      zoneId: "E26Z-PIPELINE-TARGET",
      low: direction === "LONG" ? 7790 : 7690,
      high: direction === "LONG" ? 7810 : 7710,
      midline: direction === "LONG" ? 7800 : 7700,
    },
    locationInvalidationBoundary:
      direction === "LONG" ? 7735 : 7765,
    invalidationFacts: {
      completedCloseInvalidationConfirmed: false,
    },
  };
}

function handoff(c) {
  return {
    ...identity(),
    direction: c.direction,
    directionState: c.directionState,
    snapshotTime: c.snapshotTime,
    entryZone: c.entryZone,
    targetZone: c.targetZone,
    locationInvalidationBoundary: c.locationInvalidationBoundary,
  };
}

function lockedPermission(direction) {
  return {
    paper: {
      ...identity(),
      allowed: true,
      paperAllowed: true,
      locked: true,
      direction,
      decision: "FAST_INTRADAY_PAPER_ALLOW",
      planningAllowed: true,
      identity: identity(),
    },
  };
}

test("locked Engine6 SHORT drives Engine26B while Engine26A is NEUTRAL", () => {
  const c = candidate("NEUTRAL");
  c.targetZone = {
    id: "E26Z-SHORT-TARGET",
    zoneId: "E26Z-SHORT-TARGET",
    low: 7690,
    high: 7710,
    midline: 7700,
  };
  c.locationInvalidationBoundary = 7765;

  const result = buildEngine26BPipeline({
    symbol: "ES",
    strategyId: STRATEGY,
    permission: lockedPermission("SHORT"),
    engine26LocationCandidate: c,
    engine26GeometryHandoff: handoff(c),
  });

  assert.equal(result.direction, "SHORT");
  assert.equal(result.geometryReady, true);
  assert.equal(result.permissionLocked, true);
  assert.equal(result.lockedPaperPackageValid, true);
  assert.equal(result.directionSource, "ENGINE6_LOCKED_PAPER_PERMISSION");
  assert.equal(result.geometryInputSource, "ENGINE26A_LOCATION_CONTEXT");
  assert.equal(result.permissionCandidateId, CANDIDATE_ID);
  assert.equal(result.permissionZoneId, ZONE_ID);
  assert.notEqual(result.status, "WAITING_FOR_DIRECTIONAL_RESOLUTION");
});

test("locked Engine6 LONG drives Engine26B while Engine26A is NEUTRAL", () => {
  const c = candidate("NEUTRAL");
  c.targetZone = {
    id: "E26Z-LONG-TARGET",
    zoneId: "E26Z-LONG-TARGET",
    low: 7790,
    high: 7810,
    midline: 7800,
  };
  c.locationInvalidationBoundary = 7735;

  const result = buildEngine26BPipeline({
    symbol: "ES",
    strategyId: STRATEGY,
    permission: lockedPermission("LONG"),
    engine26LocationCandidate: c,
    engine26GeometryHandoff: handoff(c),
  });

  assert.equal(result.direction, "LONG");
  assert.equal(result.geometryReady, true);
  assert.equal(result.permissionLocked, true);
  assert.equal(result.lockedPaperPackageValid, true);
  assert.notEqual(result.status, "WAITING_FOR_DIRECTIONAL_RESOLUTION");
});

test("unlocked permission cannot fall back to Engine26A as downstream authorized direction", () => {
  const c = candidate("SHORT");

  const permission = lockedPermission("SHORT");
  permission.paper.locked = false;

  assert.equal(isLockedEngine6PaperPackageValid(permission), false);

  const result = buildEngine26BPipeline({
    symbol: "ES",
    strategyId: STRATEGY,
    permission,
    engine26LocationCandidate: c,
    engine26GeometryHandoff: handoff(c),
  });

  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.geometryReady, false);
  assert.equal(result.lockedPaperPackageValid, false);
  assert.equal(result.directionSource, "PRELOCK_NO_AUTHORIZED_DIRECTION");
  assert.equal(result.status, "WAITING_FOR_DIRECTIONAL_RESOLUTION");
});

test("locked LONG/SHORT can never publish WAITING_FOR_DIRECTIONAL_RESOLUTION", () => {
  for (const direction of ["LONG", "SHORT"]) {
    const c = candidate("NEUTRAL");

    if (direction === "LONG") {
      c.targetZone = {
        id: "E26Z-LONG-INVARIANT",
        zoneId: "E26Z-LONG-INVARIANT",
        low: 7790,
        high: 7810,
        midline: 7800,
      };
      c.locationInvalidationBoundary = 7735;
    } else {
      c.targetZone = {
        id: "E26Z-SHORT-INVARIANT",
        zoneId: "E26Z-SHORT-INVARIANT",
        low: 7690,
        high: 7710,
        midline: 7700,
      };
      c.locationInvalidationBoundary = 7765;
    }

    const result = buildEngine26BPipeline({
      symbol: "ES",
      strategyId: STRATEGY,
      permission: lockedPermission(direction),
      engine26LocationCandidate: c,
      engine26GeometryHandoff: handoff(c),
    });

    assert.equal(result.lockedPaperPackageValid, true);
    assert.notEqual(result.status, "WAITING_FOR_DIRECTIONAL_RESOLUTION");
  }
});
