// services/core/tests/engine3Normalization.phaseC.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaperScalpReaction } from "../logic/engine3/paperScalpReaction.js";
import { buildEngine26LocationReactionContext } from "../logic/engine3/engine26LocationReactionContext.js";

const CANONICAL = {
  active: true,
  armed: true,
  chainArmed: true,
  authorizeEngine3Evaluation: true,
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-PHASE-C",
  zoneId: "E26Z-PHASE-C",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
  snapshotTime: "2026-08-03T00:00:00.000Z",
  timeframe: "10m",
  contactState: "NEGOTIATED_LINE_CONTACT",
  directionState: "NEUTRAL",
  direction: "NEUTRAL",
  tradeDirectionBias: "NEUTRAL",
  expectedReactionDirection: null,
  expectedReactions: [],
  reactionExpected: false,
  zone: { lo: 5000, hi: 5010, mid: 5005, timeframe: "10m" },
};

function handoff(overrides = {}) {
  return { ...CANONICAL, ...overrides };
}

function reaction(overrides = {}) {
  return {
    active: true,
    state: "WICK_BELOW_AND_RECLAIM",
    direction: "LONG",
    quality: "GOOD",
    confirmed: false,
    currentPrice: 5006,
    referenceLevel: 5005,
    referenceType: "NEGOTIATED_ZONE",
    referenceLabel: "Phase C Zone",
    distancePts: 1,
    lastCandle: { open: 5002, high: 5008, low: 4999, close: 5006, volume: 1000, time: 1 },
    priorCandle: { open: 5003, high: 5006, low: 5001, close: 5003, volume: 900, time: 0 },
    noPermissionCreated: true,
    noExecution: true,
    ...overrides,
  };
}

function wave(direction = "LONG") {
  return { currentLifecycleState: { direction, confirmationContext: { direction } } };
}

function build({ current = reaction(), fast = null, h = handoff(), waveDirection = "LONG", short = true } = {}) {
  return buildPaperScalpReaction({
    currentLevelAction: current,
    fastImbalanceReaction: fast,
    engine22WaveStrategy: wave(waveDirection),
    engine26ReactionHandoff: h,
    engine26StructuralContext: null,
    paperShortResearchEnabled: short,
  });
}

function assertReadiness(result) {
  assert.equal(result.reactionReadiness.productionAllowed, result.allowed);
  assert.deepEqual(result.reactionReadiness.productionBlockers, result.blockers);
  assert.deepEqual(result.reactionReadiness.productionReasonCodes, result.reasonCodes);
  assert.deepEqual(result.reactionReadiness.canonicalIdentity, result.engine26LocationContext.canonicalIdentity);
  assert.deepEqual(result.reactionReadiness.sourceIdentity, result.engine26LocationContext.sourceIdentity);
  assert.deepEqual(result.reactionReadiness.identityComparison, result.engine26LocationContext.identityComparison);
}

for (const state of ["WICK_BELOW_AND_RECLAIM", "DIP_BOUGHT_FAST", "SELLERS_TRAPPED", "RECLAIMED_LEVEL"]) {
  test(`direct LONG ${state} may qualify with confirmed false`, () => {
    const result = build({ current: reaction({ state, confirmed: false }) });
    assert.equal(result.allowed, true);
    assert.equal(result.reactionConfirmed, false);
    assert.equal(result.direction, "LONG");
    assert.ok(!result.blockers.includes("AUTHORIZED_REACTION_NOT_CONFIRMED"));
    assert.ok(!result.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
    assertReadiness(result);
  });
}

for (const state of ["FAILED_RECLAIM", "REJECTING_VALUE", "BREAKOUT_FAILING", "LOST_LEVEL", "FAILED_ACCEPTANCE_SHORT", "LOST_SHORT_TRIGGER_LEVEL"]) {
  test(`SHORT research ${state} may qualify with confirmed false`, () => {
    const result = build({
      current: reaction({ state, direction: "SHORT", quality: "GOOD", confirmed: false }),
      waveDirection: "NONE",
      short: true,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.reactionConfirmed, false);
    assert.equal(result.direction, "SHORT");
    assertReadiness(result);
  });
}

test("conditional LONG still requires confirmed true", () => {
  const result = build({ current: reaction({ state: "HELD_LEVEL", quality: "STRONG", confirmed: false }) });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION"));
});

test("conditional LONG passes with STRONG and confirmed true", () => {
  const result = build({ current: reaction({ state: "HELD_LEVEL", quality: "STRONG", confirmed: true }) });
  assert.equal(result.allowed, true);
  assert.equal(result.reactionConfirmed, true);
});

test("canonical V2 WATCHING authorization does not block a direct branch", () => {
  const result = build({ current: reaction({ confirmed: false }) });
  assert.equal(result.authorizedReactionState, "WATCHING_AUTHORIZED_LOCATION");
  assert.equal(result.allowed, true);
  assert.ok(!result.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
});

test("authorized location with no actionable reaction remains not allowed", () => {
  const result = build({ current: reaction({ state: "NO_SIGNAL", direction: "NEUTRAL", quality: "WEAK" }), waveDirection: "NONE" });
  assert.equal(result.allowed, false);
  assert.equal(result.authorizedReactionState, "WATCHING_AUTHORIZED_LOCATION");
  assert.ok(result.blockers.includes("ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG"));
});

test("neutral V2 empty expected list permits fresh SHORT discovery", () => {
  const result = build({ current: reaction({ state: "LOST_LEVEL", direction: "SHORT", quality: "GOOD" }), waveDirection: "NONE" });
  assert.equal(result.allowed, true);
  assert.equal(result.engine26LocationContext.reactionExpected, true);
  assert.deepEqual(result.expectedReactions, []);
});

test("restrictive nonempty expected list blocks an outside state", () => {
  const result = build({ h: handoff({ expectedReactions: ["RECLAIMED_LEVEL"] }), current: reaction({ state: "LOST_LEVEL", direction: "SHORT", quality: "GOOD" }), waveDirection: "NONE" });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
  assert.ok(result.blockers.includes("REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET"));
});

test("missing source identity inherits canonical identity without blockers", () => {
  const result = build();
  assert.equal(result.candidateId, CANONICAL.candidateId);
  assert.equal(result.zoneId, CANONICAL.zoneId);
  assert.equal(result.setupClass, CANONICAL.setupClass);
  assert.deepEqual(result.identityComparison.mismatches, []);
  assert.ok(result.identityComparison.missingSourceFields.includes("candidateId"));
  assert.equal(result.allowed, true);
});

const mismatchCases = [
  ["laneId", "subminute", "ENGINE3_LANE_ID_MISMATCH"],
  ["strategyId", "other", "ENGINE3_STRATEGY_ID_MISMATCH"],
  ["candidateId", "OLD", "ENGINE3_CANDIDATE_ID_MISMATCH"],
  ["zoneId", "OLD", "ENGINE3_ZONE_ID_MISMATCH"],
  ["symbol", "NQ", "ENGINE3_SYMBOL_MISMATCH"],
  ["setupClass", "OLD_SETUP", "ENGINE3_SETUP_CLASS_MISMATCH"],
  ["identitySetupKey", "OLD_KEY", "ENGINE3_IDENTITY_SETUP_KEY_MISMATCH"],
  ["candidateIdentityVersion", "engine26.strategy1.v1", "ENGINE3_CANDIDATE_IDENTITY_VERSION_MISMATCH"],
];

for (const [field, value, blocker] of mismatchCases) {
  test(`${field} mismatch hard blocks with exact blocker`, () => {
    const result = build({ current: reaction({ [field]: value }) });
    assert.equal(result.allowed, false);
    assert.ok(result.blockers.includes(blocker));
    assert.equal(result.engine26LocationContext.forceAllowedFalse, true);
  });
}

test("multiple simultaneous identity mismatches retain both exact blockers", () => {
  const result = build({ current: reaction({ candidateId: "OLD", zoneId: "OLD-ZONE" }) });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("ENGINE3_CANDIDATE_ID_MISMATCH"));
  assert.ok(result.blockers.includes("ENGINE3_ZONE_ID_MISMATCH"));
});

test("setup grade difference is diagnostic only", () => {
  const result = build({ current: reaction({ setupGrade: "B" }) });
  assert.equal(result.allowed, true);
  assert.equal(result.setupGrade, "A+++");
  assert.ok(result.identityComparison.diagnostics.includes("SOURCE_SETUP_GRADE_DIFFERS_FROM_HANDOFF"));
});

test("inactive alternative identity mismatch cannot block selected source", () => {
  const baseline = build({ fast: null });
  const result = build({ fast: reaction({ active: false, fastMode: true, candidateId: "WRONG", state: "LOST_LEVEL", direction: "SHORT" }) });
  assert.equal(result.allowed, baseline.allowed);
  assert.deepEqual(result.blockers, baseline.blockers);
  assert.equal(result.reactionReadiness.alternativeSource, "FAST_IMBALANCE");
});

test("invalidation remains hard blocked", () => {
  const result = build({ h: handoff({ tradeDirectionBias: "LONG", locationInvalidationBoundary: 5007 }), current: reaction({ currentPrice: 5006 }) });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("ENGINE26_LOCATION_INVALIDATED"));
});

test("missing authorization remains hard blocked", () => {
  const result = build({ h: handoff({ active: false }) });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("WAITING_FOR_ENGINE26_LOCATION"));
});

test("disarmed canonical chain remains authorized for paper reaction evaluation", () => {
  const result = build({ h: handoff({ chainArmed: false }) });
  assert.equal(result.engine26LocationContext.authorized, true);
  assert.equal(result.engine26LocationContext.chainArmed, false);
  assert.equal(result.allowed, true);
  assert.ok(!result.blockers.includes("WAITING_FOR_ENGINE26_LOCATION"));
  assertReadiness(result);
});

test("missing safety flags remain hard blocked", () => {
  const result = build({ current: reaction({ noExecution: false }) });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING"));
});

test("legacy acceptance-test safety remains blocked", () => {
  const context = buildEngine26LocationReactionContext({
    engine26StructuralContext: {
      locationContext: {
        active: true,
        locationRead: "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
        priceLocation: "INSIDE_ZONE",
        handoff: { engine3ShouldTreatInsideShortZoneAs: "ACCEPTANCE_TEST_NOT_LONG_PERMISSION" },
      },
    },
    reactionInput: reaction(),
  });
  assert.equal(context.forceAllowedFalse, true);
  assert.equal(context.blocker, "LONG_BOUNCE_NOT_CLEAN_PERMISSION");
});

test("selected fast source is normalized once from its primary raw facts", () => {
  const fast = reaction({
    active: true,
    fastMode: true,
    source: "ENGINE26_IMBALANCE_WATCH",
    state: "RECLAIMED_LEVEL",
    rawState: "RECLAIMED_LEVEL",
    direction: "LONG",
    rawDirection: "LONG",
    quality: "STRONG",
    rawQuality: "STRONG",
    confirmed: false,
    rawConfirmed: false,
  });
  const result = build({ current: reaction({ state: "LOST_LEVEL", direction: "SHORT" }), fast });
  assert.equal(result.fastMode, true);
  assert.equal(result.state, "RECLAIMED_LEVEL");
  assert.equal(result.quality, "STRONG");
  assert.equal(result.direction, "LONG");
  assert.equal(result.allowed, true);
  assertReadiness(result);
});

test("inputs are not mutated", () => {
  const current = reaction();
  const h = handoff();
  const before = JSON.stringify({ current, h });
  const result = build({ current, h });
  assert.equal(JSON.stringify({ current, h }), before);
  assertReadiness(result);
});
