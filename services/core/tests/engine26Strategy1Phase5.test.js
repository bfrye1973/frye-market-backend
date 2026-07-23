import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine26PaperTradePlan } from "../logic/engine26/paperTradePlanner.js";

const SETUP = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

const candidate = (overrides = {}) => ({
  active: true,
  status: "INSIDE_LOCATION",
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  symbol: "ES",
  candidateId: "E26C-PHASE5-TEST",
  zoneId: "E26Z-PHASE5-ENTRY",
  directionBias: "LONG",
  setupType: SETUP,
  setupClass: SETUP,
  setupGrade: "A+++",
  identitySetupKey: SETUP,
  candidateIdentityVersion: "engine26.strategy1.v1",
  snapshotTime: "2026-07-23T20:00:00.000Z",
  entryZone: {
    id: "E26Z-PHASE5-ENTRY",
    zoneId: "E26Z-PHASE5-ENTRY",
    low: 7540.75,
    high: 7574,
    midline: 7557.5,
  },
  targetZone: {
    id: "E26Z-PHASE5-TARGET",
    zoneId: "E26Z-PHASE5-TARGET",
    low: 7590.5,
    high: 7611.5,
    midline: 7601,
  },
  locationInvalidationBoundary: 7540.5,
  invalidationFacts: { completedCloseInvalidationConfirmed: false },
  ...overrides,
});

const handoff = (overrides = {}) => ({
  active: true,
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  symbol: "ES",
  candidateId: "E26C-PHASE5-TEST",
  zoneId: "E26Z-PHASE5-ENTRY",
  setupClass: SETUP,
  setupGrade: "A+++",
  identitySetupKey: SETUP,
  candidateIdentityVersion: "engine26.strategy1.v1",
  entryZone: {
    id: "E26Z-PHASE5-ENTRY",
    zoneId: "E26Z-PHASE5-ENTRY",
    low: 7540.75,
    high: 7574,
    midline: 7557.5,
  },
  targetZone: {
    id: "E26Z-PHASE5-TARGET",
    zoneId: "E26Z-PHASE5-TARGET",
    low: 7590.5,
    high: 7611.5,
    midline: 7601,
  },
  locationInvalidationBoundary: 7540.5,
  snapshotTime: "2026-07-23T20:00:00.000Z",
  ...overrides,
});

const permission = (overrides = {}) => ({
  paper: {
    decision: "FAST_INTRADAY_PAPER_ALLOW",
    allowed: true,
    planningAllowed: true,
    mode: "PAPER_ONLY",
    direction: "LONG",
    setupType: SETUP,
    realExecutionAllowed: false,
    requiresEngine8Paper: true,
    requiresEngine10Journal: true,
    ...overrides,
  },
});

function geometry({ c = candidate(), h = handoff(), p = permission() } = {}) {
  return buildEngine26PaperTradePlan({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    tf: "10m",
    permission: p,
    engine22WaveStrategy: { currentLifecycleState: { direction: "LONG", key: SETUP } },
    engine25Context: {},
    confluence: { price: 7550, context: { reaction: {}, volume: {} } },
    engine15Decision: {},
    engine26LocationCandidate: c,
    engine26GeometryHandoff: h,
    openPaperTrades: [],
    dailyBars: [],
  }).engine26ProposedGeometry;
}

test("authorized Strategy 1 geometry", () => {
  const g = geometry();
  assert.equal(g.active, true);
  assert.equal(g.geometryReady, true);
  assert.equal(g.status, "PROPOSED_GEOMETRY_AVAILABLE");
  assert.equal(g.geometryContractVersion, "engine26b.strategy1.v1");
  assert.equal(g.candidateId, "E26C-PHASE5-TEST");
  assert.equal(g.zoneId, "E26Z-PHASE5-ENTRY");
  assert.equal(g.proposedEntryPrice, 7557.5);
  assert.equal(g.proposedStopPrice, 7540.5);
  assert.equal(g.target1Price, 7590.5);
  assert.equal(g.target2Price, 7601);
  assert.equal(g.proposedTargets.length, 3);
  assert.equal(g.proposedTargets[0].price, 7590.5);
  assert.equal(g.proposedTargets[1].price, 7601);
  assert.equal(g.proposedTargets[2].price, null);
  assert.equal(g.proposedTargets[2].runnerHandoffRequired, true);
  assert.equal(g.target3Status, "ENGINE9_RUNNER_HANDOFF");
  assert.equal(g.planningPermissionConsumed, true);
  assert.equal(g.candidateIdentityPreserved, true);
  assert.equal(g.noPermissionCreated, true);
  assert.equal(g.noSizingCreated, true);
  assert.equal(g.noManagementCreated, true);
  assert.equal(g.noExecution, true);
});

test("waits without Engine 6 permission", () => {
  const g = geometry({ p: permission({ decision: "PAPER_WATCH_FAST", allowed: false, planningAllowed: false }) });
  assert.equal(g.active, false);
  assert.equal(g.status, "WAITING_FOR_ENGINE6_PERMISSION");
});

test("identity mismatch waits safely", () => {
  const g = geometry({ h: handoff({ candidateId: "E26C-DIFFERENT" }) });
  assert.equal(g.active, false);
  assert.equal(g.status, "IDENTITY_MISMATCH");
});

test("missing target waits", () => {
  const g = geometry({ c: candidate({ targetZone: null }), h: handoff({ targetZone: null }) });
  assert.equal(g.status, "WAITING_FOR_TARGET_ZONE");
});

test("missing invalidation waits", () => {
  const g = geometry({
    c: candidate({ locationInvalidationBoundary: null }),
    h: handoff({ locationInvalidationBoundary: null }),
  });
  assert.equal(g.status, "WAITING_FOR_INVALIDATION_BOUNDARY");
});

test("invalid stop is rejected", () => {
  const g = geometry({
    c: candidate({ locationInvalidationBoundary: 7540.75 }),
    h: handoff({ locationInvalidationBoundary: 7540.75 }),
  });
  assert.equal(g.status, "INVALID_STOP_GEOMETRY");
});

test("invalid target is rejected", () => {
  const bad = { id: "BAD", zoneId: "BAD", low: 7560, high: 7570, midline: 7565 };
  const g = geometry({ c: candidate({ targetZone: bad }), h: handoff({ targetZone: bad }) });
  assert.equal(g.status, "INVALID_TARGET_GEOMETRY");
});

test("completed-close invalidation blocks geometry", () => {
  const g = geometry({
    c: candidate({
      active: false,
      status: "INVALIDATED",
      invalidationFacts: { completedCloseInvalidationConfirmed: true },
    }),
  });
  assert.equal(g.status, "CANDIDATE_INVALIDATED");
});

test("inputs are not mutated", () => {
  const c = candidate();
  const h = handoff();
  const p = permission();
  const before = JSON.stringify({ c, h, p });
  geometry({ c, h, p });
  assert.equal(JSON.stringify({ c, h, p }), before);
});
