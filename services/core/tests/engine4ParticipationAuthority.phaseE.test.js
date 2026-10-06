// services/core/tests/engine4ParticipationAuthority.phaseE.test.js
//
// Engine 4 authority contract after B1-B4 structural freeze:
// - Engine 3 owns canonical direction.
// - 1m is diagnostic only and cannot independently confirm or hard-block.
// - 5m is primary Engine 4 participation authority.
// - 10m is broader confirmation/weakening context and does not independently hard-block.
// - structural completed zone loss remains an immediate hard block.

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
  currentCandleStatus = "FORMING",
} = {}) {
  return {
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
    currentCandle: { volume: 7300 },
    priorCandle: { volume: 9000 },
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

test("5m supportive plus fading 10m context waits rather than confirms or blocks", () => {
  const engine3 = reaction({
    reactionValidation5m: validation5m({
      direction: "LONG",
      quality: "GOOD",
      validationState: "SUPPORT",
    }),
  });
  const out = build({
    engine3,
    fast: tactical({ volumeTrend: "FADING" }),
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

test("5m adverse plus fading 10m context weakens to WAIT rather than hard-block", () => {
  const engine3 = reaction({
    reactionValidation5m: validation5m({
      direction: "SHORT",
      quality: "GOOD",
      validationState: "CONFLICT",
    }),
  });
  const out = build({
    engine3,
    fast: tactical({ volumeTrend: "FADING" }),
  });
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("10m fading cannot independently hard-block when 5m is unresolved", () => {
  const out = build({ fast: tactical({ volumeTrend: "FADING" }) });
  assert.equal(out.validation5mDirection, "NEUTRAL");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("completed structural zone loss remains an immediate hard block", () => {
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
  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
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
