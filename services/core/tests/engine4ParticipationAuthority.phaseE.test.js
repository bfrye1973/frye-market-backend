// services/core/tests/engine4ParticipationAuthority.phaseE.test.js
//
// Engine 4 authority contract after B1-B4 structural freeze:
// - Engine 3 owns canonical direction.
// - 1m is diagnostic only and cannot independently confirm or hard-block.
// - 5m is primary Engine 4 participation authority.
// - 10m is broader confirmation/weakening context and does not independently hard-block.
// - structural invalidation is owned upstream; Engine 4 consumes confirmed invalidation only.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEngine4AuthorizedReactionParticipation,
} from "../logic/engine4/buildAuthorizedReactionParticipation.js";

const IDENTITY = {
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-AUTH",
  zoneId: "E26Z-AUTH",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
};

function validation5m({
  direction = "NEUTRAL",
  quality = "WEAK",
  validationState = "UNRESOLVED",
  stale = false,
  active = true,
  currentCandleStatus = "COMPLETED",
} = {}) {
  const currentCandle =
    direction === "LONG"
      ? { open: 5004, high: 5009, low: 5003, close: 5008, volume: 1200, time: 200 }
      : direction === "SHORT"
        ? { open: 5008, high: 5009, low: 5001, close: 5003, volume: 1500, time: 200 }
        : { open: 5006, high: 5008, low: 5004, close: 5006, volume: 800, time: 200 };

  const priorCandle =
    direction === "SHORT"
      ? { open: 5005, high: 5009, low: 5004, close: 5007, volume: 1000, time: 195 }
      : { open: 5002, high: 5007, low: 5001, close: 5006, volume: 1000, time: 195 };

  return {
    ...IDENTITY,
    active,
    sourceTimeframe: "5m",
    state:
      direction === "LONG"
        ? "PUSHING_HIGHER"
        : direction === "SHORT"
        ? "PUSHING_LOWER"
        : "NO_CLEAR_DIRECTION",
    direction,
    quality,
    validationState,
    stale,
    supportingBarTime: 200,
    currentCandleStatus,
    priorCandleStatus: "COMPLETED",
    currentCandle: {
      ...currentCandle,
      candleClosed: currentCandleStatus === "COMPLETED",
    },
    priorCandle: { ...priorCandle, candleClosed: true },
  };
}
function reaction(overrides = {}) {
  return {
    active: true,
    engine: "engine3.paperScalpReaction.v5",
    source: "confluence.context.reaction.paperScalpReaction",
    ...IDENTITY,

    authorized: true,
    evaluationAuthorized: true,
    authorizeEngine3Evaluation: true,
    participationEvaluationEligible: true,
    stableCanonicalSignal: true,
    reactionConfirmed: true,
    confirmed: true,
    reactionState: "REACTION_CONFIRMED",
    authorizedReactionState: "REACTION_CONFIRMED",
    state: "REACTION_CONFIRMED",
    quality: "GOOD",
    direction: "LONG",

    entryZone: {
      id: IDENTITY.zoneId,
      lo: 5000,
      hi: 5010,
      mid: 5005,
    },

    sourceTimeframe: "1m",
    reactionTimeframe: "1m",
    candleSourceFresh: true,
    currentCandleStatus: "COMPLETED",
    priorCandleStatus: "COMPLETED",
    supportingBarTime: 101,
    evaluationTimeMs: 102000,

    // Deliberately adverse 1m counter-pressure against the held LONG.
    currentCandle: {
      open: 5008,
      high: 5009,
      low: 5004,
      close: 5005,
      volume: 2062,
      time: 101,
      candleClosed: true,
    },
    lastCandle: {
      open: 5008,
      high: 5009,
      low: 5004,
      close: 5005,
      volume: 2062,
      time: 101,
      candleClosed: true,
    },
    priorCandle: {
      open: 5005,
      high: 5009,
      low: 5004,
      close: 5007,
      volume: 1964,
      time: 100,
      candleClosed: true,
    },

    reactionObservation1m: {
      active: true,
      stale: false,
      sourceTimeframe: "1m",
      state: "PUSHING_LOWER",
      direction: "SHORT",
      quality: "GOOD",
      candleState: "COMPLETED",
      currentCandleStatus: "COMPLETED",
      priorCandleStatus: "COMPLETED",
      supportingBarTime: 101,
      currentCandle: {
        open: 5008,
        high: 5009,
        low: 5004,
        close: 5005,
        volume: 2062,
        time: 101,
        candleClosed: true,
      },
      priorCandle: {
        open: 5005,
        high: 5009,
        low: 5004,
        close: 5007,
        volume: 1964,
        time: 100,
        candleClosed: true,
      },
    },

    reactionValidation5m: validation5m(),

    noPermissionCreated: true,
    noExecution: true,
    ...overrides,
  };
}

function candidate() {
  return {
    ...IDENTITY,
    active: true,
    armed: true,
    chainArmed: true,
    contactState: "NEGOTIATED_LINE_CONTACT",
    directionState: "LONG",
    direction: "LONG",
  };
}

function tactical(overrides = {}) {
  return {
    active: true,
    allowed: true,
    confirmed: true,
    hardBlocked: false,
    participationConfirmed: true,
    participationState: "BEARISH_AGAINST_LONG",
    participationQuality: "CLEAN",
    intendedDirection: "LONG",
    supportsDirection: false,
    volumeExpansion: true,
    volumeConfirmed: false,
    relativeVolume: 1.28,
    volumeTrend: "STABLE",
    highVolumeCandles: 1,
    currentBarVolume: 2062,
    priorBarVolume: 1964,
    ...overrides,
  };
}

function build({ engine3 = reaction(), fast = tactical() } = {}) {
  return buildEngine4AuthorizedReactionParticipation({
    patchedConfluence: {
      context: {
        reaction: { paperScalpReaction: engine3 },
        volume: {
          engine4FastImbalanceParticipation: fast,
          engine4CurrentScalpParticipation: null,
        },
      },
    },
    engine26LocationCandidate: candidate(),
  });
}

test("1m adverse counter-pressure cannot hard-block when 5m is unresolved", () => {
  const out = build();
  assert.equal(out.intendedDirection, "LONG");
  assert.equal(out.participationEvaluationDirection, "LONG");
  assert.equal(out.observation1mDirection, "SHORT");
  assert.equal(out.validation5mDirection, "NEUTRAL");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.participationConfirmed, false);
  assert.equal(out.allowed, false);
  assert.equal(out.hardBlocked, false);
});

test("1m adverse counter-pressure cannot prevent confirmation when 5m supports held LONG", () => {
  const engine3 = reaction({
    reactionValidation5m: validation5m({
      direction: "LONG",
      quality: "GOOD",
      validationState: "SUPPORT",
    }),
  });
  const out = build({ engine3 });
  assert.equal(out.observation1mDirection, "SHORT");
  assert.equal(out.validation5mDirection, "LONG");
  assert.equal(out.participationState, "PARTICIPATION_CONFIRMED");
  assert.equal(out.participationConfirmed, true);
  assert.equal(out.allowed, true);
  assert.equal(out.hardBlocked, false);
});

test("5m supportive plus materially weak fading 10m waits rather than confirms or blocks", () => {
  const engine3 = reaction({
    reactionValidation5m: validation5m({
      direction: "LONG",
      quality: "GOOD",
      validationState: "SUPPORT",
    }),
  });
  const out = build({
    engine3,
    fast: tactical({ volumeTrend: "FADING", relativeVolume: 0.8, volumeExpansion: false, volumeConfirmed: false, highVolumeCandles: 0 }),
  });
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.participationConfirmed, false);
  assert.equal(out.hardBlocked, false);
});

test("5m adverse against held LONG is a hard-block candidate when 10m is not weakening", () => {
  const engine3 = reaction({
    reactionValidation5m: validation5m({
      direction: "SHORT",
      quality: "GOOD",
      validationState: "CONFLICT",
    }),
  });
  const out = build({ engine3 });
  assert.equal(out.validation5mDirection, "SHORT");
  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(out.hardBlocked, true);
  assert.equal(out.allowed, false);
});

test("genuine completed adverse 5m remains a hard block even when 10m is fading", () => {
  const engine3 = reaction({
    reactionValidation5m: validation5m({
      direction: "SHORT",
      quality: "GOOD",
      validationState: "CONFLICT",
    }),
  });
  const out = build({
    engine3,
    fast: tactical({ volumeTrend: "FADING", relativeVolume: 0.8, volumeExpansion: false, volumeConfirmed: false, highVolumeCandles: 0 }),
  });
  assert.equal(out.participation5mState, "ADVERSE");
  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(out.hardBlocked, true);
});

test("10m fading cannot independently hard-block when 5m is unresolved", () => {
  const out = build({ fast: tactical({ volumeTrend: "FADING" }) });
  assert.equal(out.validation5mDirection, "NEUTRAL");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("1m close below zone does not let Engine 4 invent structural invalidation", () => {
  const engine3 = reaction({
    currentCandle: {
      open: 5003,
      high: 5004,
      low: 4997,
      close: 4999,
      volume: 2062,
      time: 101,
      candleClosed: true,
    },
    lastCandle: {
      open: 5003,
      high: 5004,
      low: 4997,
      close: 4999,
      volume: 2062,
      time: 101,
      candleClosed: true,
    },
    reactionValidation5m: validation5m({
      direction: "NEUTRAL",
      quality: "WEAK",
      validationState: "UNRESOLVED",
    }),
  });
  const out = build({ engine3 });
  assert.equal(out.participation5mState, "UNRESOLVED");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("confirmed upstream candidate invalidation still hard-blocks", () => {
  const engine3 = reaction({
    candidateInvalidated: true,
  });
  const out = build({ engine3 });
  assert.equal(out.participationState, "CANDIDATE_INVALIDATED");
  assert.equal(out.hardBlocked, true);
});

test("forming 1m remains diagnostic and does not veto supportive 5m", () => {
  const engine3 = reaction({
    currentCandleStatus: "FORMING",
    currentCandle: {
      open: 5008,
      high: 5009,
      low: 5004,
      close: 5005,
      volume: 500,
      time: 101,
      candleClosed: false,
    },
    lastCandle: {
      open: 5008,
      high: 5009,
      low: 5004,
      close: 5005,
      volume: 500,
      time: 101,
      candleClosed: false,
    },
    reactionObservation1m: {
      ...reaction().reactionObservation1m,
      candleState: "FORMING",
      currentCandleStatus: "FORMING",
      currentCandle: {
        ...reaction().reactionObservation1m.currentCandle,
        volume: 500,
        candleClosed: false,
      },
    },
    reactionValidation5m: validation5m({
      direction: "LONG",
      quality: "GOOD",
      validationState: "SUPPORT",
    }),
  });
  const out = build({ engine3 });
  assert.equal(out.formingCandle, true);
  assert.equal(out.participationState, "PARTICIPATION_CONFIRMED");
  assert.equal(out.hardBlocked, false);
});
