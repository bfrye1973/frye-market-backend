import assert from "node:assert/strict";
import test from "node:test";
import { buildPaperScalpReaction } from "../logic/engine3/paperScalpReaction.js";

const CANDIDATE_ID = "E26C-PHASE-A";
const ZONE_ID = "E26Z-PHASE-A";

function buildNeutralHandoff(overrides = {}) {
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
    snapshotTime: "2026-08-02T20:00:00.000Z",
    timeframe: "10m",
    zone: {
      source: "TEST",
      type: "NEGOTIATED",
      timeframe: "10m",
      lo: 5000,
      hi: 5010,
      mid: 5005,
      currentPrice: 5006,
    },
    locationInvalidationBoundary: 4975,
    ...overrides,
  };
}

function buildReactionInput(overrides = {}) {
  return {
    active: true,
    state: "RECLAIMED_LEVEL",
    quality: "GOOD",
    direction: "LONG",
    confirmed: true,
    currentPrice: 5006,
    referenceLevel: 5005,
    referenceType: "NEGOTIATED_ZONE",
    referenceLabel: "Negotiated Zone",
    distancePts: 1,
    noExecution: true,
    noPermissionCreated: true,
    lastCandle: {
      open: 5002,
      high: 5008,
      low: 4999,
      close: 5006,
      volume: 1000,
      time: 1,
    },
    priorCandle: {
      open: 4998,
      high: 5003,
      low: 4995,
      close: 5001,
      volume: 900,
      time: 0,
    },
    ...overrides,
  };
}

function buildFastReaction(overrides = {}) {
  return {
    ...buildReactionInput(),
    active: true,
    fastMode: true,
    earlySignal: true,
    ...overrides,
  };
}

function buildCurrentLevelAction(overrides = {}) {
  return {
    ...buildReactionInput(),
    active: true,
    ...overrides,
  };
}

function buildEngine22Context(direction = "NONE") {
  return {
    currentLifecycleState: {
      confirmationContext: {
        direction,
      },
    },
  };
}

function buildPaper({
  currentLevelAction = buildCurrentLevelAction(),
  fastImbalanceReaction = null,
  engine22Direction = "NONE",
  engine26ReactionHandoff = buildNeutralHandoff(),
  engine26StructuralContext = null,
  paperShortResearchEnabled = true,
} = {}) {
  return buildPaperScalpReaction({
    currentLevelAction,
    fastImbalanceReaction,
    engine22WaveStrategy: buildEngine22Context(engine22Direction),
    engine26ReactionHandoff,
    engine26StructuralContext,
    paperShortResearchEnabled,
  });
}

function assertIdentityAndSafety(out) {
  assert.equal(out.active, true);
  assert.equal(out.candidateId, CANDIDATE_ID);
  assert.equal(out.zoneId, ZONE_ID);
  assert.equal(out.laneId, "minute");
  assert.equal(out.strategyId, "intraday_scalp@10m");
  assert.equal(out.authorized, true);
  assert.equal(out.noPermissionCreated, true);
  assert.equal(out.noExecution, true);
}

function assertAllowed(out, direction) {
  assertIdentityAndSafety(out);
  assert.equal(out.allowed, true);
  assert.equal(out.direction, direction);
  assert.deepEqual(out.blockers, []);
  assert.ok(out.reasonCodes.includes("PAPER_SCALP_REACTION_ALLOWED"));
  assert.ok(out.reasonCodes.includes("ENGINE3_PAPER_SCALP_REACTION_ALLOWED"));
}

const directLongStates = [
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "RECLAIMED_LEVEL",
];

for (const state of directLongStates) {
  test(`direct LONG ${state} qualifies when current blockers clear`, () => {
    const out = buildPaper({
      currentLevelAction: buildCurrentLevelAction({
        state,
        quality: "GOOD",
        direction: "LONG",
        confirmed: true,
      }),
      engine22Direction: "NONE",
    });

    assertAllowed(out, "LONG");
    assert.equal(out.state, state);
    assert.equal(out.quality, "GOOD");
    assert.notEqual(out.setupType, "NONE");
    assert.equal(out.authorizedReactionState, "REACTION_CONFIRMED");
    assert.equal(out.reactionConfirmed, true);
  });
}

test("direct LONG confirmed false may qualify under branch-specific confirmation", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: false,
    }),
  });

  assertAllowed(out, "LONG");
  assert.equal(out.state, "RECLAIMED_LEVEL");
  assert.equal(out.direction, "LONG");
  assert.equal(out.authorizedReactionState, "WATCHING_AUTHORIZED_LOCATION");
  assert.equal(out.engine26LocationContext.forceAllowedFalse, false);
  assert.equal(out.engine26LocationContext.blocker, null);
  assert.equal(out.reactionConfirmed, false);
  assert.ok(!out.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
  assert.ok(!out.blockers.includes("AUTHORIZED_REACTION_NOT_CONFIRMED"));
});

test("direct LONG wrong direction blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: true,
    }),
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG"));
});

test("direct LONG MIXED quality blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "MIXED",
      direction: "LONG",
      confirmed: true,
    }),
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG"));
});

test("direct LONG Engine 22 SHORT conflict blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
    }),
    engine22Direction: "SHORT",
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP"));
});

test("direct LONG missing noExecution blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
      noExecution: false,
    }),
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING"));
});

test("direct LONG missing noPermissionCreated blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
      noPermissionCreated: false,
    }),
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING"));
});

const conditionalLongStates = [
  "HELD_LEVEL",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
];

for (const state of conditionalLongStates) {
  test(`conditional LONG ${state} qualifies with STRONG and confirmed`, () => {
    const out = buildPaper({
      currentLevelAction: buildCurrentLevelAction({
        state,
        quality: "STRONG",
        direction: "LONG",
        confirmed: true,
      }),
    });

    assertAllowed(out, "LONG");
    assert.equal(out.state, state);
    assert.equal(out.quality, "STRONG");
  });

  test(`conditional LONG ${state} GOOD exposes strong-quality blocker`, () => {
    const out = buildPaper({
      currentLevelAction: buildCurrentLevelAction({
        state,
        quality: "GOOD",
        direction: "LONG",
        confirmed: true,
      }),
    });

    assert.equal(out.allowed, false);
    assert.ok(out.blockers.includes("CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY"));
  });

  test(`conditional LONG ${state} confirmed false exposes confirmation blockers`, () => {
    const out = buildPaper({
      currentLevelAction: buildCurrentLevelAction({
        state,
        quality: "STRONG",
        direction: "LONG",
        confirmed: false,
      }),
    });

    assert.equal(out.allowed, false);
    assert.ok(out.blockers.includes("CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION"));
    assert.ok(!out.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
    assert.ok(!out.blockers.includes("AUTHORIZED_REACTION_NOT_CONFIRMED"));
    assert.equal(out.engine26LocationContext.forceAllowedFalse, false);
    assert.equal(out.reactionConfirmed, false);
  });
}

test("conditional LONG wrong direction blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "HELD_LEVEL",
      quality: "STRONG",
      direction: "SHORT",
      confirmed: true,
    }),
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG"));
});

test("conditional LONG Engine 22 SHORT conflict blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "HELD_LEVEL",
      quality: "STRONG",
      direction: "LONG",
      confirmed: true,
    }),
    engine22Direction: "SHORT",
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP"));
});

const shortStates = [
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
  "LOST_LEVEL",
  "FAILED_ACCEPTANCE_SHORT",
  "LOST_SHORT_TRIGGER_LEVEL",
];

for (const state of shortStates) {
  test(`SHORT research ${state} qualifies when current blockers clear`, () => {
    const out = buildPaper({
      currentLevelAction: buildCurrentLevelAction({
        state,
        quality: "GOOD",
        direction: "SHORT",
        confirmed: true,
      }),
      paperShortResearchEnabled: true,
      engine22Direction: "LONG",
    });

    assertAllowed(out, "SHORT");
    assert.equal(out.state, state);
    assert.equal(out.quality, "GOOD");
  });
}

test("SHORT confirmed false may qualify under branch-specific confirmation", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: false,
    }),
    paperShortResearchEnabled: true,
  });

  assertAllowed(out, "SHORT");
  assert.equal(out.direction, "SHORT");
  assert.equal(out.engine26LocationContext.state, "WATCHING_AUTHORIZED_LOCATION");
  assert.equal(out.engine26LocationContext.forceAllowedFalse, false);
  assert.equal(out.engine26LocationContext.blocker, null);
  assert.equal(out.reactionConfirmed, false);
  assert.ok(!out.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
  assert.ok(!out.blockers.includes("AUTHORIZED_REACTION_NOT_CONFIRMED"));
});

test("SHORT research disabled blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: true,
    }),
    paperShortResearchEnabled: false,
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("PAPER_SHORT_RESEARCH_DISABLED_V1"));
});

test("SHORT state with LONG direction blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
    }),
    paperShortResearchEnabled: true,
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("CURRENT_LEVEL_ACTION_DIRECTION_NOT_SHORT"));
});

test("SHORT MIXED quality blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "MIXED",
      direction: "SHORT",
      confirmed: true,
    }),
    paperShortResearchEnabled: true,
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG"));
});

test("SHORT missing safety flags blocks", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: true,
      noExecution: false,
    }),
    paperShortResearchEnabled: true,
  });

  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING"));
});

test("WAITING_FOR_ENGINE26_LOCATION currently forces denial", () => {
  const out = buildPaper({
    engine26ReactionHandoff: null,
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
    }),
  });

  assert.equal(out.engine26LocationContext.state, "WAITING_FOR_ENGINE26_LOCATION");
  assert.equal(out.engine26LocationContext.forceAllowedFalse, true);
  assert.equal(out.engine26LocationContext.blocker, "WAITING_FOR_ENGINE26_LOCATION");
  assert.equal(out.authorizedReactionState, "WAITING_FOR_ENGINE26_LOCATION");
  assert.equal(out.reactionConfirmed, false);
  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("WAITING_FOR_ENGINE26_LOCATION"));
});

test("canonical WATCHING_AUTHORIZED_LOCATION permits branch evaluation without automatic denial", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: false,
    }),
  });

  assert.equal(out.engine26LocationContext.state, "WATCHING_AUTHORIZED_LOCATION");
  assert.equal(out.engine26LocationContext.forceAllowedFalse, false);
  assert.equal(out.engine26LocationContext.blocker, null);
  assert.equal(out.authorizedReactionState, "WATCHING_AUTHORIZED_LOCATION");
  assert.equal(out.reactionConfirmed, false);
  assertAllowed(out, "LONG");
  assert.ok(!out.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
  assert.ok(!out.blockers.includes("AUTHORIZED_REACTION_NOT_CONFIRMED"));
});

test("REACTION_CONFIRMED permits a qualifying direct LONG", () => {
  const out = buildPaper();
  assert.equal(out.engine26LocationContext.state, "REACTION_CONFIRMED");
  assert.equal(out.engine26LocationContext.forceAllowedFalse, false);
  assert.equal(out.engine26LocationContext.blocker, null);
  assert.equal(out.authorizedReactionState, "REACTION_CONFIRMED");
  assert.equal(out.reactionConfirmed, true);
  assert.equal(out.allowed, true);
});

test("REACTION_FAILED currently forces denial", () => {
  const out = buildPaper({
    engine26ReactionHandoff: buildNeutralHandoff({
      expectedReactions: ["HELD_LEVEL"],
    }),
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
    }),
  });

  assert.equal(out.engine26LocationContext.state, "REACTION_FAILED");
  assert.equal(out.engine26LocationContext.forceAllowedFalse, true);
  assert.equal(out.engine26LocationContext.blocker, "REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET");
  assert.equal(out.authorizedReactionState, "REACTION_FAILED");
  assert.equal(out.reactionConfirmed, false);
  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
  assert.ok(out.blockers.includes("REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET"));
});

test("REACTION_INVALIDATED currently forces denial", () => {
  const out = buildPaper({
    engine26ReactionHandoff: buildNeutralHandoff({
      tradeDirectionBias: "LONG",
      locationInvalidationBoundary: 5000,
    }),
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
      currentPrice: 4990,
      lastCandle: {
        open: 4995,
        high: 4998,
        low: 4988,
        close: 4990,
        volume: 1000,
        time: 1,
      },
    }),
  });

  assert.equal(out.engine26LocationContext.state, "REACTION_INVALIDATED");
  assert.equal(out.engine26LocationContext.forceAllowedFalse, true);
  assert.equal(out.engine26LocationContext.blocker, "ENGINE26_LOCATION_INVALIDATED");
  assert.equal(out.authorizedReactionState, "REACTION_INVALIDATED");
  assert.equal(out.reactionConfirmed, false);
  assert.equal(out.allowed, false);
  assert.ok(out.blockers.includes("ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"));
  assert.ok(out.blockers.includes("ENGINE26_LOCATION_INVALIDATED"));
});

test("canonical neutral V2 handoff preserves fresh LONG raw and normalized direction", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: false,
    }),
  });

  assert.notEqual(out.authorizedReactionState, "WAITING_FOR_ENGINE26_LOCATION");
  assert.equal(out.candidateId, CANDIDATE_ID);
  assert.equal(out.zoneId, ZONE_ID);
  assert.equal(out.currentLevelAction.direction, "LONG");
  assert.equal(out.engine26LocationContext.rawState, "RECLAIMED_LEVEL");
  assert.equal(out.engine26LocationContext.direction, "LONG");
  assert.equal(out.engine26LocationContext.expectedReactionDirection, null);
  assert.deepEqual(out.engine26LocationContext.expectedReactions, []);
  assert.equal(out.allowed, true);
  assert.equal(out.reactionConfirmed, false);
});

test("canonical neutral V2 handoff preserves fresh SHORT raw and normalized direction", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: false,
    }),
    paperShortResearchEnabled: true,
  });

  assert.notEqual(out.authorizedReactionState, "WAITING_FOR_ENGINE26_LOCATION");
  assert.equal(out.candidateId, CANDIDATE_ID);
  assert.equal(out.zoneId, ZONE_ID);
  assert.equal(out.currentLevelAction.direction, "SHORT");
  assert.equal(out.engine26LocationContext.rawState, "FAILED_RECLAIM");
  assert.equal(out.engine26LocationContext.direction, "SHORT");
  assert.equal(out.engine26LocationContext.expectedReactionDirection, null);
  assert.deepEqual(out.engine26LocationContext.expectedReactions, []);
  assert.equal(out.allowed, true);
  assert.equal(out.reactionConfirmed, false);
});

test("canonical neutral V2 handoff with no actionable reaction remains authorized watching, not waiting for location", () => {
  const out = buildPaper({
    currentLevelAction: buildCurrentLevelAction({
      state: "NO_SIGNAL",
      quality: "WEAK",
      direction: "NEUTRAL",
      confirmed: false,
    }),
  });

  assert.equal(out.candidateId, CANDIDATE_ID);
  assert.equal(out.zoneId, ZONE_ID);
  assert.equal(out.engine26LocationContext.state, "WATCHING_AUTHORIZED_LOCATION");
  assert.notEqual(out.engine26LocationContext.state, "WAITING_FOR_ENGINE26_LOCATION");
  assert.equal(out.engine26LocationContext.direction, "NEUTRAL");
  assert.equal(out.engine26LocationContext.quality, "WEAK");
  assert.equal(out.allowed, false);
});

test("active fast mode selects fast reaction and ignores opposite current-level direction", () => {
  const out = buildPaper({
    fastImbalanceReaction: buildFastReaction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
    }),
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: true,
    }),
  });

  assert.equal(out.source, "confluence.context.reaction.engine3FastImbalanceReaction");
  assert.equal(out.fastMode, true);
  assert.equal(out.state, "RECLAIMED_LEVEL");
  assert.equal(out.direction, "LONG");
  assert.equal(out.quality, "GOOD");
  assert.equal(out.allowed, true);
  assert.equal(out.currentLevelAction.direction, "SHORT");
});

test("inactive fast reaction selects currentLevelAction", () => {
  const out = buildPaper({
    fastImbalanceReaction: buildFastReaction({
      active: false,
      state: "RECLAIMED_LEVEL",
      direction: "LONG",
    }),
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: true,
    }),
    paperShortResearchEnabled: true,
  });

  assert.equal(out.source, "confluence.context.reaction.currentLevelAction");
  assert.equal(out.fastMode, false);
  assert.equal(out.state, "FAILED_RECLAIM");
  assert.equal(out.direction, "SHORT");
  assert.equal(out.allowed, true);
});

test("fastMode false selects currentLevelAction", () => {
  const out = buildPaper({
    fastImbalanceReaction: buildFastReaction({
      fastMode: false,
      state: "RECLAIMED_LEVEL",
      direction: "LONG",
    }),
    currentLevelAction: buildCurrentLevelAction({
      state: "FAILED_RECLAIM",
      quality: "GOOD",
      direction: "SHORT",
      confirmed: true,
    }),
    paperShortResearchEnabled: true,
  });

  assert.equal(out.source, "confluence.context.reaction.currentLevelAction");
  assert.equal(out.fastMode, false);
  assert.equal(out.state, "FAILED_RECLAIM");
  assert.equal(out.direction, "SHORT");
  assert.equal(out.allowed, true);
});

test("paperScalpReaction performs one canonical normalization pass on raw fast facts", () => {
  const rawFast = buildFastReaction({
    state: "LOST_LEVEL",
    rawState: "LOST_LEVEL",
    quality: "GOOD",
    rawQuality: "GOOD",
    direction: "SHORT",
    rawDirection: "SHORT",
    confirmed: false,
    rawConfirmed: false,
  });

  const out = buildPaper({
    fastImbalanceReaction: rawFast,
    currentLevelAction: buildCurrentLevelAction({
      state: "RECLAIMED_LEVEL",
      quality: "GOOD",
      direction: "LONG",
      confirmed: true,
    }),
    paperShortResearchEnabled: true,
  });

  assert.equal(rawFast.state, "LOST_LEVEL");
  assert.equal(rawFast.direction, "SHORT");
  assert.equal(rawFast.quality, "GOOD");
  assert.equal(rawFast.confirmed, false);
  assert.equal(out.source, "confluence.context.reaction.engine3FastImbalanceReaction");
  assert.equal(out.engine26LocationContext.rawState, "LOST_LEVEL");
  assert.equal(out.engine26LocationContext.state, "WATCHING_AUTHORIZED_LOCATION");
  assert.equal(out.state, "LOST_LEVEL");
  assert.equal(out.direction, "SHORT");
  assert.equal(out.quality, "GOOD");
  assert.equal(out.reactionConfirmed, false);
  assert.equal(out.allowed, true);
  assert.deepEqual(out.blockers, []);
  assert.ok(!out.blockers.includes("FAST_IMBALANCE_STATE_BLOCKED_FOR_PAPER"));
  assert.ok(!out.blockers.includes("AUTHORIZED_REACTION_NOT_CONFIRMED"));
});
