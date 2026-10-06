// services/core/tests/engine4AuthorizedReactionParticipation.phaseD2.test.js
//
// Engine 4 Phase D2 focused contract tests.
//
// Engine 3 participationEvaluationEligible gates qualified participation
// evaluation. Engine 4 independently owns completed-candle participation
// confirmation. Engine 6 remains final paper-permission authority.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEngine4AuthorizedReactionParticipation,
} from "../logic/engine4/buildAuthorizedReactionParticipation.js";

const IDENTITY = {
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-D2",
  zoneId: "E26Z-D2",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
};

function reaction(overrides = {}) {
  return {
    active: true,
    engine: "engine3.paperScalpReaction.v2",
    source: "confluence.context.reaction.paperScalpReaction",

    ...IDENTITY,

    authorized: true,
    evaluationAuthorized: true,
    authorizeEngine3Evaluation: true,

    participationEvaluationEligible: true,
    allowed: true,

    reactionConfirmed: false,
    confirmed: false,
    reactionState: "WATCHING_AUTHORIZED_LOCATION",
    authorizedReactionState: "WATCHING_AUTHORIZED_LOCATION",

    state: "WICK_BELOW_AND_RECLAIM",
    quality: "GOOD",
    direction: "LONG",

    contactState: "NEGOTIATED_LINE_CONTACT",
    chainArmed: true,
    armed: true,
    directionState: "NEUTRAL",
    expectedReactionDirection: null,
    expectedParticipationDirection: null,
    expectedReversalDirection: null,

    entryZone: {
      id: "E26Z-D2",
      lo: 5000,
      hi: 5010,
      mid: 5005,
    },

    lastCandle: {
      open: 5002,
      high: 5008,
      low: 5001,
      close: 5007,
      volume: 1500,
      time: 2,
      candleClosed: true,
    },

    priorCandle: {
      open: 5000,
      high: 5004,
      low: 4999,
      close: 5002,
      volume: 1000,
      time: 1,
      candleClosed: true,
    },

    candleClosed: true,
    earlySignal: false,

    noPermissionCreated: true,
    noExecution: true,

    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    ...IDENTITY,
    active: true,
    armed: true,
    chainArmed: true,
    contactState: "NEGOTIATED_LINE_CONTACT",
    directionState: "NEUTRAL",
    direction: "NEUTRAL",
    ...overrides,
  };
}

function constructiveLong(overrides = {}) {
  return {
    active: true,
    allowed: true,
    confirmed: true,
    hardBlocked: false,
    participationConfirmed: true,
    participationState: "RECLAIM_VOLUME_CONFIRMED",
    participationQuality: "CLEAN",
    intendedDirection: "LONG",
    supportsDirection: true,
    volumeExpansion: true,
    volumeConfirmed: true,
    relativeVolume: 1.6,
    ...overrides,
  };
}

function constructiveShort(overrides = {}) {
  return {
    active: true,
    allowed: true,
    confirmed: true,
    hardBlocked: false,
    participationConfirmed: true,
    participationState: "SELLER_PARTICIPATION_CONFIRMED",
    participationQuality: "CLEAN",
    intendedDirection: "SHORT",
    direction: "SHORT",
    supportsDirection: true,
    volumeExpansion: true,
    volumeConfirmed: true,
    relativeVolume: 1.7,
    ...overrides,
  };
}

function build({
  engine3 = reaction(),
  engine26 = candidate(),
  fast = null,
  current = null,
  handoff = null,
} = {}) {
  return buildEngine4AuthorizedReactionParticipation({
    patchedConfluence: {
      context: {
        reaction: {
          paperScalpReaction: engine3,
        },
        volume: {
          engine4FastImbalanceParticipation: fast,
          engine4CurrentScalpParticipation: current,
        },
      },
    },
    engine26LocationCandidate: engine26,
    engine26ReactionHandoff: handoff,
  });
}

function assertNoPermissionOrExecution(result) {
  assert.equal(result.requiresEngine6Permission, true);
  assert.equal(result.requiresEngine6PaperApproval, true);
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noRealPermissionCreated, true);
  assert.equal(result.noExecution, true);
  assert.equal(result.realExecutionAuthority, false);
  assert.equal(result.executable, false);

  assert.equal("ticketAllowed" in result, false);
  assert.equal("paperShortAllowed" in result, false);
}

test("eligible direct LONG can confirm participation without Engine 3 reactionConfirmed", () => {
  const result = build({
    fast: constructiveLong(),
  });

  assert.equal(result.participationEvaluationEligible, true);
  assert.equal(result.qualifiedParticipationEvaluation, true);
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.participationEvaluationDirection, "LONG");
  assert.equal(result.participationConfirmed, true);
  assert.equal(result.allowed, true);
  assert.equal(result.direction, "LONG");
  assertNoPermissionOrExecution(result);
});

test("eligible SHORT research can confirm seller participation without creating permission", () => {
  const result = build({
    engine3: reaction({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      quality: "GOOD",
      participationEvaluationEligible: true,
      allowed: true,
      reactionConfirmed: false,
      confirmed: false,
      lastCandle: {
        open: 5008,
        high: 5009,
        low: 4998,
        close: 5000,
        volume: 1700,
        time: 2,
        candleClosed: true,
      },
      priorCandle: {
        open: 5005,
        high: 5009,
        low: 5002,
        close: 5006,
        volume: 1000,
        time: 1,
        candleClosed: true,
      },
    }),
    fast: constructiveShort(),
  });

  assert.equal(result.participationEvaluationEligible, true);
  assert.equal(result.qualifiedParticipationEvaluation, true);
  assert.equal(result.participationEvaluationDirection, "SHORT");
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.participationConfirmed, true);
  assert.equal(result.allowed, true);
  assert.equal(result.direction, "SHORT");
  assertNoPermissionOrExecution(result);
});

test("ineligible Engine 3 branch cannot be rescued by constructive participation", () => {
  const result = build({
    engine3: reaction({
      participationEvaluationEligible: false,
      allowed: false,
      reactionConfirmed: true,
      confirmed: true,
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.participationObservation, true);
  assert.equal(result.participationEvaluationEligible, false);
  assert.equal(result.qualifiedParticipationEvaluation, false);
  assert.equal(result.participationConfirmed, false);
  assert.equal(result.allowed, false);
  assert.equal(result.direction, "NEUTRAL");
  assertNoPermissionOrExecution(result);
});

test("eligible forming candle remains developing and cannot confirm", () => {
  const result = build({
    engine3: reaction({
      candleClosed: false,
      earlySignal: true,
      lastCandle: {
        open: 5002,
        high: 5008,
        low: 5001,
        close: 5007,
        volume: 400,
        time: 2,
        candleClosed: false,
      },
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.participationEvaluationEligible, true);
  assert.equal(result.participationDeveloping, true);
  assert.equal(result.participationConfirmed, false);
  assert.equal(result.allowed, false);
  assert.equal(result.hardBlocked, false);
});

test("qualified fresh LONG overrides promoted SHORT fallback", () => {
  const result = build({
    engine3: reaction({
      direction: "LONG",
      participationEvaluationEligible: true,
      expectedParticipationDirection: "SHORT",
      expectedReactionDirection: "SHORT",
      directionState: "SHORT_REVERSAL_WATCH",
    }),
    engine26: candidate({
      directionState: "SHORT_REVERSAL_WATCH",
      expectedParticipationDirection: "SHORT",
      expectedReversalDirection: "SHORT",
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.expectedParticipationDirection, "SHORT");
  assert.equal(result.participationEvaluationDirection, "LONG");
  assert.equal(result.direction, "LONG");
  assert.equal(result.participationConfirmed, true);
});

test("qualified fresh SHORT overrides conflicting promoted LONG metadata", () => {
  const result = build({
    engine3: reaction({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      participationEvaluationEligible: true,
      expectedParticipationDirection: "LONG",
      expectedReactionDirection: "LONG",
      lastCandle: {
        open: 5008,
        high: 5009,
        low: 4998,
        close: 5000,
        volume: 1700,
        time: 2,
        candleClosed: true,
      },
      priorCandle: {
        open: 5005,
        high: 5009,
        low: 5002,
        close: 5006,
        volume: 1000,
        time: 1,
        candleClosed: true,
      },
    }),
    engine26: candidate({
      expectedParticipationDirection: "LONG",
      expectedReversalDirection: "LONG",
    }),
    fast: constructiveShort(),
  });

  assert.equal(result.expectedParticipationDirection, "LONG");
  assert.equal(result.participationEvaluationDirection, "SHORT");
  assert.equal(result.direction, "SHORT");
  assert.equal(result.participationConfirmed, true);
});

test("candidate mismatch remains a hard block", () => {
  const result = build({
    engine26: candidate({
      candidateId: "E26C-DIFFERENT",
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.hardBlocked, true);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("CANDIDATE_ID_MISMATCH"));
});

test("zone mismatch remains a hard block", () => {
  const result = build({
    engine26: candidate({
      zoneId: "E26Z-DIFFERENT",
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.hardBlocked, true);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("ZONE_ID_MISMATCH"));
});

test("wrong lane remains a hard identity block", () => {
  const result = build({
    engine3: reaction({
      laneId: "subminute",
    }),
    engine26: candidate({
      laneId: "subminute",
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.hardBlocked, true);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("LANE_ID_MISMATCH"));
});

test("wrong strategy remains a hard identity block", () => {
  const result = build({
    engine3: reaction({
      strategyId: "subminute_scalp@10m",
    }),
    engine26: candidate({
      strategyId: "subminute_scalp@10m",
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.hardBlocked, true);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("STRATEGY_ID_MISMATCH"));
});

test("candidate invalidation remains hard blocked", () => {
  const result = build({
    engine3: reaction({
      reactionState: "REACTION_INVALIDATED",
      authorizedReactionState: "REACTION_INVALIDATED",
      invalidationFacts: {
        completedCloseInvalidated: true,
      },
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.participationState, "CANDIDATE_INVALIDATED");
  assert.equal(result.hardBlocked, true);
  assert.equal(result.allowed, false);
});

test("completed adverse LONG participation remains hard blocked", () => {
  const result = build({
    engine3: reaction({
      lastCandle: {
        open: 5008,
        high: 5009,
        low: 4995,
        close: 4998,
        volume: 5000,
        time: 2,
        candleClosed: true,
      },
      priorCandle: {
        open: 5003,
        high: 5009,
        low: 5001,
        close: 5007,
        volume: 2000,
        time: 1,
        candleClosed: true,
      },
    }),
    fast: constructiveLong({
      supportsDirection: false,
      absorptionRisk: true,
      highVolumeNoProgress: true,
    }),
  });

  assert.equal(result.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(result.hardBlocked, true);
  assert.equal(result.allowed, false);
});

test("completed zone loss remains hard blocked", () => {
  const result = build({
    engine3: reaction({
      lastCandle: {
        open: 5005,
        high: 5006,
        low: 4990,
        close: 4995,
        volume: 4000,
        time: 2,
        candleClosed: true,
      },
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(result.hardBlocked, true);
  assert.equal(result.allowed, false);
});

test("missing Engine 3 reaction remains inactive and blocked", () => {
  const result = build({
    engine3: null,
    fast: constructiveLong(),
  });

  assert.equal(result.active, false);
  assert.equal(result.participationObservation, false);
  assert.equal(result.participationEvaluationEligible, false);
  assert.equal(result.participationConfirmed, false);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("ENGINE3_REACTION_MISSING"));
});

test("eligible NEUTRAL direction cannot enter qualified evaluation", () => {
  const result = build({
    engine3: reaction({
      direction: "NEUTRAL",
      participationEvaluationEligible: true,
      allowed: true,
    }),
    fast: constructiveLong(),
  });

  assert.equal(result.participationEvaluationEligible, true);
  assert.equal(result.qualifiedParticipationEvaluation, false);
  assert.equal(result.participationEvaluationDirection, "NEUTRAL");
  assert.equal(result.participationConfirmed, false);
  assert.equal(result.allowed, false);
});

test("inputs are not mutated", () => {
  const engine3 = reaction();
  const engine26 = candidate();
  const fast = constructiveLong();

  const before = JSON.stringify({
    engine3,
    engine26,
    fast,
  });

  build({
    engine3,
    engine26,
    fast,
  });

  assert.equal(
    JSON.stringify({
      engine3,
      engine26,
      fast,
    }),
    before
  );
});
