// services/core/tests/engine3Eligibility.phaseD.test.js
//
// Phase D1 additive Engine 3 downstream-handoff aliases.
//
// Contract:
// - participationEvaluationEligible === final paperScalpReaction.allowed
// - engine3Strategy1QualifiedForEngine6 === final paperScalpReaction.allowed
// - neither field creates Engine 4 confirmation, Engine 6 permission,
//   ticket authority, execution authority, or SHORT permission.
// - no branch qualification is recalculated here.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaperScalpReaction } from "../logic/engine3/paperScalpReaction.js";

const CANONICAL_HANDOFF = {
  active: true,
  armed: true,
  chainArmed: true,
  authorizeEngine3Evaluation: true,

  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-PHASE-D1",
  zoneId: "E26Z-PHASE-D1",
  symbol: "ES",

  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",

  snapshotTime: "2026-08-03T12:00:00.000Z",
  timeframe: "10m",

  contactState: "NEGOTIATED_LINE_CONTACT",
  directionState: "NEUTRAL",
  direction: "NEUTRAL",
  tradeDirectionBias: "NEUTRAL",

  expectedReactionDirection: null,
  expectedReactions: [],
  reactionExpected: false,

  zone: {
    lo: 5000,
    hi: 5010,
    mid: 5005,
    timeframe: "10m",
  },
};

function handoff(overrides = {}) {
  return {
    ...CANONICAL_HANDOFF,
    ...overrides,
  };
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
    referenceLabel: "Phase D1 Zone",
    distancePts: 1,

    lastCandle: {
      open: 5002,
      high: 5008,
      low: 4999,
      close: 5006,
      volume: 1000,
      time: 1,
    },

    priorCandle: {
      open: 5003,
      high: 5006,
      low: 5001,
      close: 5003,
      volume: 900,
      time: 0,
    },

    noPermissionCreated: true,
    noExecution: true,

    ...overrides,
  };
}

function wave(direction = "LONG") {
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
  current = reaction(),
  fast = null,
  engine26Handoff = handoff(),
  waveDirection = "LONG",
  shortResearchEnabled = true,
} = {}) {
  return buildPaperScalpReaction({
    currentLevelAction: current,
    fastImbalanceReaction: fast,
    engine22WaveStrategy: wave(waveDirection),
    engine26ReactionHandoff: engine26Handoff,
    engine26StructuralContext: null,
    paperShortResearchEnabled: shortResearchEnabled,
  });
}

function assertAliasesEqualFinalAllowed(result) {
  assert.equal(
    result.participationEvaluationEligible,
    result.allowed
  );

  assert.equal(
    result.engine3Strategy1QualifiedForEngine6,
    result.allowed
  );
}

function assertNoAuthorityCreated(result) {
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noRealPermissionCreated, true);
  assert.equal(result.noExecution, true);
  assert.equal(result.realExecutionAuthority, false);
  assert.equal(result.requiresEngine6PaperApproval, true);

  assert.equal("ticketAllowed" in result, false);
  assert.equal("paperShortAllowed" in result, false);
  assert.equal("executable" in result, false);
}

function assertCanonicalUnchangedShape(result) {
  assert.equal(result.mode, "PAPER_ONLY");
  assert.equal(result.researchOnly, true);
  assert.equal(result.laneId, "minute");
  assert.equal(result.strategyId, "intraday_scalp@10m");
  assert.equal(result.candidateId, "E26C-PHASE-D1");
  assert.equal(result.zoneId, "E26Z-PHASE-D1");
  assert.equal(result.setupClass, "NEGOTIATED_ZONE_ROTATION");
  assert.equal(result.setupGrade, "A+++");
  assert.equal(result.identitySetupKey, "NEGOTIATED_ZONE_ROTATION");
  assert.equal(result.candidateIdentityVersion, "engine26.strategy1.v2");

  assert.equal(
    result.reactionReadiness.productionAllowed,
    result.allowed
  );

  assert.deepEqual(
    result.reactionReadiness.productionBlockers,
    result.blockers
  );

  assert.deepEqual(
    result.reactionReadiness.productionReasonCodes,
    result.reasonCodes
  );
}

test("direct LONG unconfirmed but qualified publishes both aliases true", () => {
  const result = build({
    current: reaction({
      state: "WICK_BELOW_AND_RECLAIM",
      direction: "LONG",
      quality: "GOOD",
      confirmed: false,
    }),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.direction, "LONG");

  assertAliasesEqualFinalAllowed(result);
  assertNoAuthorityCreated(result);
  assertCanonicalUnchangedShape(result);
});

test("direct LONG confirmed and qualified publishes both aliases true", () => {
  const result = build({
    current: reaction({
      state: "RECLAIMED_LEVEL",
      direction: "LONG",
      quality: "GOOD",
      confirmed: true,
    }),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reactionConfirmed, true);

  assertAliasesEqualFinalAllowed(result);
  assertNoAuthorityCreated(result);
});

test("conditional LONG unconfirmed publishes both aliases false", () => {
  const result = build({
    current: reaction({
      state: "HELD_LEVEL",
      direction: "LONG",
      quality: "STRONG",
      confirmed: false,
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes(
      "CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION"
    )
  );

  assertAliasesEqualFinalAllowed(result);
  assertNoAuthorityCreated(result);
});

test("conditional LONG qualified publishes both aliases true", () => {
  const result = build({
    current: reaction({
      state: "HELD_LEVEL",
      direction: "LONG",
      quality: "STRONG",
      confirmed: true,
    }),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reactionConfirmed, true);

  assertAliasesEqualFinalAllowed(result);
  assertNoAuthorityCreated(result);
});

test("SHORT research unconfirmed but qualified publishes both aliases true without permission", () => {
  const result = build({
    current: reaction({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      quality: "GOOD",
      confirmed: false,
    }),
    waveDirection: "NONE",
    shortResearchEnabled: true,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.direction, "SHORT");

  assertAliasesEqualFinalAllowed(result);
  assertNoAuthorityCreated(result);
});

test("MIXED quality publishes both aliases false", () => {
  const result = build({
    current: reaction({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      quality: "MIXED",
      confirmed: false,
    }),
    waveDirection: "NONE",
    shortResearchEnabled: true,
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes(
      "ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG"
    )
  );

  assertAliasesEqualFinalAllowed(result);
});

test("authorized location with no actionable state publishes both aliases false", () => {
  const result = build({
    current: reaction({
      state: "NO_SIGNAL",
      direction: "NEUTRAL",
      quality: "WEAK",
      confirmed: false,
    }),
    waveDirection: "NONE",
  });

  assert.equal(result.allowed, false);
  assert.equal(
    result.authorizedReactionState,
    "WATCHING_AUTHORIZED_LOCATION"
  );

  assertAliasesEqualFinalAllowed(result);
});

test("identity mismatch publishes both aliases false", () => {
  const result = build({
    current: reaction({
      candidateId: "WRONG-CANDIDATE",
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes(
      "ENGINE3_CANDIDATE_ID_MISMATCH"
    )
  );

  assertAliasesEqualFinalAllowed(result);
});

test("invalidation publishes both aliases false", () => {
  const result = build({
    engine26Handoff: handoff({
      tradeDirectionBias: "LONG",
      locationInvalidationBoundary: 5007,
    }),

    current: reaction({
      currentPrice: 5006,
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes(
      "ENGINE26_LOCATION_INVALIDATED"
    )
  );

  assertAliasesEqualFinalAllowed(result);
});

test("missing safety flags publish both aliases false", () => {
  const result = build({
    current: reaction({
      noExecution: false,
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes(
      "CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING"
    )
  );

  assertAliasesEqualFinalAllowed(result);
});

test("disabled SHORT research publishes both aliases false", () => {
  const result = build({
    current: reaction({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      quality: "GOOD",
      confirmed: false,
    }),
    waveDirection: "NONE",
    shortResearchEnabled: false,
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes(
      "PAPER_SHORT_RESEARCH_DISABLED_V1"
    )
  );

  assertAliasesEqualFinalAllowed(result);
  assertNoAuthorityCreated(result);
});

test("missing reaction path publishes both aliases false", () => {
  const result = build({
    current: null,
    fast: null,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.participationEvaluationEligible, false);
  assert.equal(result.engine3Strategy1QualifiedForEngine6, false);

  assertNoAuthorityCreated(result);
});

test("both aliases are exact final-allowed aliases across passing and blocked cases", () => {
  const cases = [
    build(),
    build({
      current: reaction({
        state: "HELD_LEVEL",
        quality: "STRONG",
        confirmed: false,
      }),
    }),
    build({
      current: reaction({
        state: "FAILED_RECLAIM",
        direction: "SHORT",
        quality: "GOOD",
        confirmed: false,
      }),
      waveDirection: "NONE",
      shortResearchEnabled: true,
    }),
    build({
      current: reaction({
        state: "FAILED_RECLAIM",
        direction: "SHORT",
        quality: "GOOD",
        confirmed: false,
      }),
      waveDirection: "NONE",
      shortResearchEnabled: false,
    }),
    build({
      engine26Handoff: handoff({
        active: false,
      }),
    }),
  ];

  for (const result of cases) {
    assertAliasesEqualFinalAllowed(result);
  }
});
