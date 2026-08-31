import test from "node:test";
import assert from "node:assert/strict";

import {
  attachPaperScalpReactionToConfluence,
} from "../logic/engine3/paperScalpReaction.js";

const identity = {
  symbol: "ES",
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "candidate-1",
  zoneId: "zone-1",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
  contactState: "NEGOTIATED_LINE_CONTACT",
  chainArmed: true,
  authorizeEngine3Evaluation: true,
};

function handoff({
  bias = "SHORT",
  zone = { lo: 99, hi: 101, mid: 100, relation: "INSIDE_ZONE" },
} = {}) {
  return {
    ...identity,
    active: true,
    status: "ACTIVE",
    armed: true,
    tradeDirectionBias: bias,
    expectedReactionDirection: bias,
    expectedReactions: [],
    zone,
  };
}

function observation1m({
  completedState = "PUSHING_LOWER",
  completedDirection = "SHORT",
  completedQuality = "GOOD",
  currentState = completedState,
  currentDirection = completedDirection,
  currentQuality = completedQuality,
  price = 100,
  stale = false,
  active = true,
} = {}) {
  return {
    ...identity,
    active,
    diagnosticOnly: true,
    noPermissionCreated: true,
    noExecution: true,
    sourceTimeframe: "1m",

    state: currentState,
    direction: currentDirection,
    quality: currentQuality,

    currentPriceActionState: currentState,
    currentPriceActionDirection: currentDirection,
    currentPriceActionQuality: currentQuality,

    completedPriceActionState: completedState,
    completedPriceActionDirection: completedDirection,
    completedPriceActionQuality: completedQuality,

    stale,
    currentPrice: price,
    currentCandle: {
      time: 1_700_000_000,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price,
    },
  };
}

function validation5m({
  state = "NO_CLEAR_DIRECTION",
  direction = "NEUTRAL",
  quality = "WEAK",
  active = true,
} = {}) {
  return {
    ...identity,
    active,
    sourceTimeframe: "5m",
    state,
    direction,
    quality,
    currentPriceActionState: state,
    currentPriceActionDirection: direction,
    currentPriceActionQuality: quality,
  };
}

function confirmation10m({
  state = "NO_CLEAR_DIRECTION",
  direction = "NEUTRAL",
  quality = "WEAK",
  active = true,
} = {}) {
  return {
    ...identity,
    active,
    sourceTimeframe: "10m",
    state,
    direction,
    quality,
    currentPriceActionState: state,
    currentPriceActionDirection: direction,
    currentPriceActionQuality: quality,
  };
}

function build({
  oneMinute = observation1m(),
  fiveMinute = validation5m(),
  tenMinuteDiagnostic = confirmation10m(),
  engine26 = handoff(),
  previousCanonicalDirection = "NEUTRAL",
  previousReactionConfirmed = false,
  previousEstablishedTripDirection = "NEUTRAL",
  previousEstablishedTripCandidateId = null,
  tenMinutePriorCompletedClose = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
} = {}) {
  const patchedConfluence = {
    context: {
      reaction: {
        currentLevelAction: null,
        engine3FastImbalanceReaction: null,
        engine3ReactionObservation1m: oneMinute,
        engine3ReactionValidation5m: fiveMinute,
        engine3ReactionConfirmation10m: tenMinuteDiagnostic,
      },
    },
  };

  attachPaperScalpReactionToConfluence({
    patchedConfluence,
    engine22WaveStrategy: null,
    engine26ReactionHandoff: engine26,
    engine26StructuralContext: null,
    paperShortResearchEnabled: true,
    previousCanonicalDirection,
    previousReactionConfirmed,
    previousEstablishedTripDirection,
    previousEstablishedTripCandidateId,
    tenMinutePriorCompletedClose,
    tenMinuteCompletedClose,
    tenMinuteEma10,
  });

  return patchedConfluence.context.reaction.paperScalpReaction;
}

test("1 SHORT GOOD inside zone establishes from completed 1m", () => {
  const result = build({
    oneMinute: observation1m({
      completedDirection: "SHORT",
      completedQuality: "GOOD",
    }),
  });
  assert.equal(result.direction, "SHORT");
  assert.equal(result.quality, "GOOD");
  assert.equal(result.reactionConfirmed, true);
  assert.equal(result.directionEstablishedByFresh1m, true);
});

test("2 SHORT STRONG inside zone establishes from completed 1m", () => {
  const result = build({
    oneMinute: observation1m({
      completedDirection: "SHORT",
      completedQuality: "STRONG",
    }),
  });
  assert.equal(result.direction, "SHORT");
  assert.equal(result.quality, "STRONG");
  assert.equal(result.reactionConfirmed, true);
});

test("3 LONG GOOD inside zone establishes from completed 1m", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "PUSHING_HIGHER",
      completedDirection: "LONG",
      completedQuality: "GOOD",
    }),
    engine26: handoff({ bias: "LONG" }),
  });
  assert.equal(result.direction, "LONG");
  assert.equal(result.quality, "GOOD");
  assert.equal(result.reactionConfirmed, true);
});

test("4 LONG STRONG inside zone establishes from completed 1m", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "PUSHING_HIGHER",
      completedDirection: "LONG",
      completedQuality: "STRONG",
    }),
    engine26: handoff({ bias: "LONG" }),
  });
  assert.equal(result.direction, "LONG");
  assert.equal(result.quality, "STRONG");
  assert.equal(result.reactionConfirmed, true);
});

test("5 forming/live 1m cannot establish when completed 1m is neutral", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "NO_CLEAR_DIRECTION",
      completedDirection: "NEUTRAL",
      completedQuality: "WEAK",
      currentState: "PUSHING_LOWER",
      currentDirection: "SHORT",
      currentQuality: "STRONG",
    }),
  });
  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.directionEstablishedByFresh1m, false);
});

test("6 bullish semantic label alone cannot veto completed SHORT", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "WICK_BELOW_AND_RECLAIM",
      completedDirection: "SHORT",
      completedQuality: "STRONG",
    }),
  });
  assert.equal(result.direction, "SHORT");
  assert.equal(result.reactionConfirmed, true);
});

test("7 bearish semantic label alone cannot veto completed LONG", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "REJECTING_VALUE",
      completedDirection: "LONG",
      completedQuality: "STRONG",
    }),
    engine26: handoff({ bias: "LONG" }),
  });
  assert.equal(result.direction, "LONG");
  assert.equal(result.reactionConfirmed, true);
});

test("8 5m conflict and opposing 10m diagnostic cannot create or flip direction", () => {
  const result = build({
    oneMinute: observation1m({
      completedDirection: "SHORT",
      completedQuality: "GOOD",
    }),
    fiveMinute: validation5m({
      state: "PUSHING_HIGHER",
      direction: "LONG",
      quality: "STRONG",
    }),
    tenMinuteDiagnostic: confirmation10m({
      state: "PUSHING_HIGHER",
      direction: "LONG",
      quality: "STRONG",
    }),
  });
  assert.equal(result.direction, "SHORT");
  assert.equal(result.reactionConfirmed, true);
  assert.equal(result.fiveMinuteValidationRequired, false);
});

test("9 established SHORT persists outside despite 1m/5m LONG diagnostics", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "PUSHING_HIGHER",
      completedDirection: "LONG",
      completedQuality: "STRONG",
      price: 98,
    }),
    fiveMinute: validation5m({
      state: "PUSHING_HIGHER",
      direction: "LONG",
      quality: "STRONG",
    }),
    engine26: handoff({
      bias: "SHORT",
      zone: { lo: 99, hi: 101, mid: 100, relation: "BELOW_ZONE" },
    }),
    previousCanonicalDirection: "SHORT",
    previousReactionConfirmed: true,
    tenMinuteCompletedClose: 98.5,
    tenMinuteEma10: 99,
  });
  assert.equal(result.direction, "SHORT");
  assert.equal(result.directionPersistenceActive, true);
  assert.equal(result.ema10ResetTriggered, false);
});

test("10 established SHORT resets only when completed 10m closes above EMA10", () => {
  const result = build({
    oneMinute: observation1m({ price: 98 }),
    engine26: handoff({
      bias: "SHORT",
      zone: { lo: 99, hi: 101, mid: 100, relation: "BELOW_ZONE" },
    }),
    previousCanonicalDirection: "SHORT",
    previousReactionConfirmed: true,
    tenMinuteCompletedClose: 100.25,
    tenMinuteEma10: 100,
  });
  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.ema10ResetTriggered, true);
  assert.equal(result.reactionConfirmed, false);
});

test("11 established LONG persists outside despite 1m/5m SHORT diagnostics", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "PUSHING_LOWER",
      completedDirection: "SHORT",
      completedQuality: "STRONG",
      price: 102,
    }),
    fiveMinute: validation5m({
      state: "PUSHING_LOWER",
      direction: "SHORT",
      quality: "STRONG",
    }),
    engine26: handoff({
      bias: "LONG",
      zone: { lo: 99, hi: 101, mid: 100, relation: "ABOVE_ZONE" },
    }),
    previousCanonicalDirection: "LONG",
    previousReactionConfirmed: true,
    tenMinuteCompletedClose: 101.5,
    tenMinuteEma10: 101,
  });
  assert.equal(result.direction, "LONG");
  assert.equal(result.directionPersistenceActive, true);
  assert.equal(result.ema10ResetTriggered, false);
});

test("12 established LONG resets only when completed 10m closes below EMA10", () => {
  const result = build({
    oneMinute: observation1m({ price: 102 }),
    engine26: handoff({
      bias: "LONG",
      zone: { lo: 99, hi: 101, mid: 100, relation: "ABOVE_ZONE" },
    }),
    previousCanonicalDirection: "LONG",
    previousReactionConfirmed: true,
    tenMinuteCompletedClose: 99.75,
    tenMinuteEma10: 100,
  });
  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.ema10ResetTriggered, true);
  assert.equal(result.reactionConfirmed, false);
});

test("13 NEUTRAL outside below zone stays NEUTRAL even below EMA10", () => {
  const result = build({
    oneMinute: observation1m({
      completedDirection: "SHORT",
      completedQuality: "STRONG",
      price: 98,
    }),
    engine26: handoff({
      bias: "SHORT",
      zone: { lo: 99, hi: 101, mid: 100, relation: "BELOW_ZONE" },
    }),
    previousCanonicalDirection: "NEUTRAL",
    previousReactionConfirmed: false,
    tenMinuteCompletedClose: 98.5,
    tenMinuteEma10: 99,
  });
  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.canonicalResolutionReason, "EMA10_CANNOT_CREATE_INITIAL_DIRECTION");
});

test("14 NEUTRAL outside above zone stays NEUTRAL even above EMA10", () => {
  const result = build({
    oneMinute: observation1m({
      completedState: "PUSHING_HIGHER",
      completedDirection: "LONG",
      completedQuality: "STRONG",
      price: 102,
    }),
    engine26: handoff({
      bias: "LONG",
      zone: { lo: 99, hi: 101, mid: 100, relation: "ABOVE_ZONE" },
    }),
    previousCanonicalDirection: "NEUTRAL",
    previousReactionConfirmed: false,
    tenMinuteCompletedClose: 101.5,
    tenMinuteEma10: 101,
  });
  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.canonicalResolutionReason, "EMA10_CANNOT_CREATE_INITIAL_DIRECTION");
});

test("15 two clean 10m closes outside zone cannot manufacture direction from NEUTRAL", () => {
  const long = build({
    oneMinute: observation1m({
      completedState: "PUSHING_HIGHER",
      completedDirection: "LONG",
      completedQuality: "STRONG",
      price: 103,
    }),
    engine26: handoff({
      bias: "LONG",
      zone: { lo: 99, hi: 101, mid: 100, relation: "ABOVE_ZONE" },
    }),
    previousCanonicalDirection: "NEUTRAL",
    previousReactionConfirmed: false,
    tenMinutePriorCompletedClose: 102,
    tenMinuteCompletedClose: 103,
    tenMinuteEma10: 102.5,
  });

  assert.equal(long.cleanTenMinuteDeparture.active, true);
  assert.equal(long.cleanTenMinuteDeparture.direction, "LONG");
  assert.equal(long.cleanTenMinuteDeparture.canonicalDirectionAuthority, false);
  assert.equal(long.direction, "NEUTRAL");
  assert.equal(long.travelModeActivated, false);

  const short = build({
    oneMinute: observation1m({
      completedDirection: "SHORT",
      completedQuality: "STRONG",
      price: 97,
    }),
    engine26: handoff({
      bias: "SHORT",
      zone: { lo: 99, hi: 101, mid: 100, relation: "BELOW_ZONE" },
    }),
    previousCanonicalDirection: "NEUTRAL",
    previousReactionConfirmed: false,
    tenMinutePriorCompletedClose: 98,
    tenMinuteCompletedClose: 97,
    tenMinuteEma10: 97.5,
  });

  assert.equal(short.cleanTenMinuteDeparture.active, true);
  assert.equal(short.cleanTenMinuteDeparture.direction, "SHORT");
  assert.equal(short.cleanTenMinuteDeparture.canonicalDirectionAuthority, false);
  assert.equal(short.direction, "NEUTRAL");
  assert.equal(short.travelModeActivated, false);
});
