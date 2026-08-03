// services/core/tests/engine3ReactionReadiness.phaseB.test.js
//
// Phase B additive diagnostic tests.
//
// These tests prove that reactionReadiness reports current production truth
// without changing the canonical paperScalpReaction decision contract.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaperScalpReaction } from "../logic/engine3/paperScalpReaction.js";

const CANDIDATE_ID = "E26C-PHASE-B";
const ZONE_ID = "E26Z-PHASE-B";

function neutralHandoff(overrides = {}) {
  return {
    active: true,
    armed: true,
    chainArmed: true,

    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",

    candidateId: CANDIDATE_ID,
    zoneId: ZONE_ID,

    setupClass: "NEGOTIATED_ZONE_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v2",

    direction: "NEUTRAL",
    tradeDirectionBias: "NEUTRAL",
    directionState: "NEUTRAL",

    expectedReactionDirection: null,
    expectedReactions: [],
    reactionExpected: false,

    authorizeEngine3Evaluation: true,
    contactState: "NEGOTIATED_LINE_CONTACT",

    zone: {
      source: "TEST",
      type: "NEGOTIATED",
      timeframe: "10m",
      lo: 5000,
      hi: 5010,
      mid: 5005,
    },

    ...overrides,
  };
}

function reactionInput({
  state = "WICK_BELOW_AND_RECLAIM",
  direction = "LONG",
  quality = "GOOD",
  confirmed = true,
  ...overrides
} = {}) {
  return {
    active: true,
    state,
    direction,
    quality,
    confirmed,

    currentPrice: 5006,
    referenceLevel: 5005,
    referenceType: "NEGOTIATED_ZONE",
    referenceLabel: "Test Negotiated Zone",
    distancePts: 1,

    lastCandle: {
      open: 5002,
      high: 5008,
      low: 4999,
      close: 5006,
      volume: 1200,
      time: 1000,
    },

    priorCandle: {
      open: 5004,
      high: 5006,
      low: 5001,
      close: 5003,
      volume: 1000,
      time: 990,
    },

    noPermissionCreated: true,
    noExecution: true,

    ...overrides,
  };
}

function fastReaction(overrides = {}) {
  return reactionInput({
    fastMode: true,
    source: "ENGINE26_IMBALANCE_WATCH",
    ...overrides,
  });
}

function engine22(direction = "LONG") {
  return {
    currentLifecycleState: {
      direction,
      confirmationContext: {
        direction,
      },
    },
  };
}

function build({
  current = reactionInput(),
  fast = null,
  handoff = neutralHandoff(),
  waveDirection = "LONG",
  paperShortResearchEnabled = true,
} = {}) {
  return buildPaperScalpReaction({
    currentLevelAction: current,
    fastImbalanceReaction: fast,
    engine22WaveStrategy: engine22(waveDirection),
    engine26ReactionHandoff: handoff,
    engine26StructuralContext: null,
    paperShortResearchEnabled,
  });
}

function assertExactCopies(result) {
  assert.deepEqual(
    result.reactionReadiness.productionBlockers,
    result.blockers
  );

  assert.deepEqual(
    result.reactionReadiness.productionReasonCodes,
    result.reasonCodes
  );

  assert.notEqual(
    result.reactionReadiness.productionBlockers,
    result.blockers
  );

  assert.notEqual(
    result.reactionReadiness.productionReasonCodes,
    result.reasonCodes
  );
}

function assertSafety(result) {
  assert.equal(result.reactionReadiness.diagnosticOnly, true);
  assert.equal(result.reactionReadiness.noPermissionCreated, true);
  assert.equal(result.reactionReadiness.noExecution, true);
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noExecution, true);
  assert.equal(result.realExecutionAuthority, false);
}

test("direct LONG readiness is additive and canonical decision remains unchanged", () => {
  const result = build({
    current: reactionInput({
      state: "WICK_BELOW_AND_RECLAIM",
      direction: "LONG",
      quality: "GOOD",
      confirmed: true,
    }),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.direction, "LONG");
  assert.equal(result.quality, "GOOD");
  assert.equal(result.state, "WICK_BELOW_AND_RECLAIM");
  assert.deepEqual(result.blockers, []);

  assert.equal(
    result.reactionReadiness.productionAllowed,
    result.allowed
  );

  assert.equal(
    result.reactionReadiness.selectedSource,
    "CURRENT_LEVEL_ACTION"
  );

  assert.deepEqual(result.reactionReadiness.raw, {
    state: "WICK_BELOW_AND_RECLAIM",
    direction: "LONG",
    quality: "GOOD",
    confirmed: true,
  });

  assertExactCopies(result);
  assertSafety(result);
});

test("conditional LONG passing and blocked cases retain canonical behavior", () => {
  const passing = build({
    current: reactionInput({
      state: "HELD_LEVEL",
      direction: "LONG",
      quality: "STRONG",
      confirmed: true,
    }),
  });

  assert.equal(passing.allowed, true);
  assert.equal(passing.setupType, "HELD_LEVEL_LONG_CONDITIONAL");
  assertExactCopies(passing);

  const blocked = build({
    current: reactionInput({
      state: "HELD_LEVEL",
      direction: "LONG",
      quality: "GOOD",
      confirmed: true,
    }),
  });

  assert.equal(blocked.allowed, false);
  assert.ok(
    blocked.blockers.includes(
      "CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY"
    )
  );

  assertExactCopies(blocked);
});

test("SHORT passing and MIXED cases retain canonical behavior", () => {
  const passing = build({
    current: reactionInput({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      quality: "GOOD",
      confirmed: true,
    }),
    waveDirection: "NONE",
    paperShortResearchEnabled: true,
  });

  assert.equal(passing.allowed, true);
  assert.equal(passing.direction, "SHORT");
  assertExactCopies(passing);

  const blocked = build({
    current: reactionInput({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      quality: "MIXED",
      confirmed: true,
    }),
    waveDirection: "NONE",
    paperShortResearchEnabled: true,
  });

  assert.equal(blocked.allowed, false);
  assert.ok(
    blocked.blockers.includes(
      "ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG"
    )
  );

  assertExactCopies(blocked);
});

test("WATCHING_AUTHORIZED_LOCATION exposes forced denial without changing blockers", () => {
  const result = build({
    current: reactionInput({
      state: "WICK_BELOW_AND_RECLAIM",
      direction: "LONG",
      quality: "GOOD",
      confirmed: false,
    }),
  });

  assert.equal(result.allowed, false);
  assert.equal(
    result.authorizedReactionState,
    "WATCHING_AUTHORIZED_LOCATION"
  );

  assert.equal(
    result.reactionReadiness.normalized.authorizationState,
    "WATCHING_AUTHORIZED_LOCATION"
  );

  assert.equal(
    result.reactionReadiness.authorization.forceAllowedFalse,
    true
  );

  assert.equal(
    result.reactionReadiness.authorization.blocker,
    "AUTHORIZED_REACTION_NOT_CONFIRMED"
  );

  assert.equal(
    result.reactionReadiness.productionAllowed,
    false
  );

  assertExactCopies(result);
});

test("neutral V2 handoff exposes fresh LONG raw and normalized direction", () => {
  const result = build({
    current: reactionInput({
      state: "RECLAIMED_LEVEL",
      direction: "LONG",
      quality: "GOOD",
      confirmed: true,
    }),
  });

  assert.equal(result.expectedReactionDirection, "NEUTRAL");
  assert.deepEqual(result.expectedReactions, []);
  assert.equal(result.reactionExpected, true);

  assert.equal(
    result.reactionReadiness.raw.direction,
    "LONG"
  );

  assert.equal(
    result.reactionReadiness.normalized.direction,
    "LONG"
  );

  assert.equal(
    result.reactionReadiness.authorization.contactState,
    null
  );

  assertExactCopies(result);
});

test("neutral V2 handoff exposes fresh SHORT raw and normalized direction", () => {
  const result = build({
    current: reactionInput({
      state: "LOST_LEVEL",
      direction: "SHORT",
      quality: "GOOD",
      confirmed: true,
    }),
    waveDirection: "NONE",
  });

  assert.equal(
    result.reactionReadiness.raw.direction,
    "SHORT"
  );

  assert.equal(
    result.reactionReadiness.normalized.direction,
    "SHORT"
  );

  assert.equal(
    result.reactionReadiness.identity.candidateId,
    CANDIDATE_ID
  );

  assert.equal(
    result.reactionReadiness.identity.zoneId,
    ZONE_ID
  );

  assertExactCopies(result);
});

test("fast selected diagnostics report production-selected source without arbitration", () => {
  const current = reactionInput({
    state: "LOST_LEVEL",
    direction: "SHORT",
    quality: "GOOD",
    confirmed: true,
  });

  const fast = fastReaction({
    state: "RECLAIMED_LEVEL",
    direction: "LONG",
    quality: "GOOD",
    confirmed: true,
  });

  const result = build({
    current,
    fast,
  });

  assert.equal(
    result.reactionReadiness.selectedSource,
    "FAST_IMBALANCE"
  );

  assert.equal(
    result.reactionReadiness.alternativeSource,
    "CURRENT_LEVEL_ACTION"
  );

  assert.equal(
    result.reactionReadiness.raw.direction,
    "LONG"
  );

  assert.equal(result.direction, "LONG");
  assertExactCopies(result);
});

test("current-level selected diagnostics report inactive fast as alternative only", () => {
  const result = build({
    current: reactionInput({
      state: "RECLAIMED_LEVEL",
      direction: "LONG",
      quality: "GOOD",
      confirmed: true,
    }),

    fast: fastReaction({
      active: false,
      state: "LOST_LEVEL",
      direction: "SHORT",
      quality: "GOOD",
      confirmed: true,
    }),
  });

  assert.equal(
    result.reactionReadiness.selectedSource,
    "CURRENT_LEVEL_ACTION"
  );

  assert.equal(
    result.reactionReadiness.alternativeSource,
    "FAST_IMBALANCE"
  );

  assert.equal(
    result.reactionReadiness.raw.direction,
    "LONG"
  );

  assertExactCopies(result);
});

test("no source publishes readiness with exact canonical missing-reaction blockers", () => {
  const result = build({
    current: null,
    fast: null,
  });

  assert.equal(
    result.reactionReadiness.selectedSource,
    "NONE"
  );

  assert.equal(
    result.reactionReadiness.alternativeSource,
    "NONE"
  );

  assert.deepEqual(result.reactionReadiness.raw, {
    state: null,
    direction: null,
    quality: null,
    confirmed: null,
  });

  assert.equal(result.allowed, false);
  assertExactCopies(result);
});

test("identity transport gaps remain visible as null rather than repaired", () => {
  const result = build();

  assert.equal(
    result.reactionReadiness.identity.laneId,
    "minute"
  );

  assert.equal(
    result.reactionReadiness.identity.strategyId,
    "intraday_scalp@10m"
  );

  assert.equal(
    result.reactionReadiness.identity.candidateId,
    CANDIDATE_ID
  );

  assert.equal(
    result.reactionReadiness.identity.zoneId,
    ZONE_ID
  );

  assert.equal(
    result.reactionReadiness.identity.setupClass,
    null
  );

  assert.equal(
    result.reactionReadiness.identity.setupGrade,
    null
  );

  assert.equal(
    result.reactionReadiness.identity.identitySetupKey,
    null
  );

  assert.equal(
    result.reactionReadiness.identity.candidateIdentityVersion,
    null
  );
});

test("readiness helper does not mutate inputs", () => {
  const current = reactionInput();
  const fast = fastReaction({ active: false });
  const handoff = neutralHandoff();

  const before = JSON.stringify({
    current,
    fast,
    handoff,
  });

  const result = build({
    current,
    fast,
    handoff,
  });

  assert.equal(
    JSON.stringify({
      current,
      fast,
      handoff,
    }),
    before
  );

  assertExactCopies(result);
});

test("readiness object is additive and does not introduce scored fields", () => {
  const result = build();

  assert.equal("reactionReadiness" in result, true);
  assert.equal("score" in result.reactionReadiness, false);
  assert.equal("band" in result.reactionReadiness, false);
  assert.equal("components" in result.reactionReadiness, false);
  assert.equal("passedGates" in result.reactionReadiness, false);
  assert.equal("missingGates" in result.reactionReadiness, false);
  assert.equal("hardBlockers" in result.reactionReadiness, false);
  assert.equal("temporaryBlockers" in result.reactionReadiness, false);
  assert.equal("nextNeededEvidence" in result.reactionReadiness, false);
});
