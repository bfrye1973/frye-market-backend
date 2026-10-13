import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEngine4AuthorizedReactionParticipation,
} from "../logic/engine4/buildAuthorizedReactionParticipation.js";

const IDENTITY = {
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-5M",
  zoneId: "E26Z-5M",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
};

function fiveMinute({
  diagnosticDirection = "NEUTRAL",
  stale = false,
  status = "COMPLETED",
  current = { open: 5004, high: 5009, low: 5003, close: 5008, volume: 1200, time: 200 },
  prior = { open: 5002, high: 5007, low: 5001, close: 5006, volume: 1000, time: 195 },
} = {}) {
  return {
    ...IDENTITY,
    active: true,
    diagnosticOnly: true,
    sourceTimeframe: "5m",
    stale,
    validationState:
      diagnosticDirection === "NEUTRAL" ? "UNRESOLVED" : "CONFLICT",
    direction: diagnosticDirection,
    quality: diagnosticDirection === "NEUTRAL" ? "WEAK" : "GOOD",
    currentCandleStatus: status,
    priorCandleStatus: "COMPLETED",
    candleState: status,
    supportingBarTime: current.time,
    currentCandle: { ...current, candleClosed: status === "COMPLETED" },
    priorCandle: { ...prior, candleClosed: true },
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
    entryZone: { id: IDENTITY.zoneId, lo: 4990, hi: 5010, mid: 5000 },

    sourceTimeframe: "1m",
    reactionTimeframe: "1m",
    candleSourceFresh: true,
    currentCandleStatus: "COMPLETED",
    priorCandleStatus: "COMPLETED",
    currentCandle: {
      open: 5008, high: 5009, low: 5004, close: 5005,
      volume: 700, time: 101, candleClosed: true,
    },
    lastCandle: {
      open: 5008, high: 5009, low: 5004, close: 5005,
      volume: 700, time: 101, candleClosed: true,
    },
    priorCandle: {
      open: 5005, high: 5009, low: 5004, close: 5007,
      volume: 900, time: 100, candleClosed: true,
    },
    reactionObservation1m: {
      ...IDENTITY,
      active: true,
      stale: false,
      sourceTimeframe: "1m",
      state: "PUSHING_LOWER",
      direction: "SHORT",
      quality: "GOOD",
      currentCandleStatus: "COMPLETED",
      priorCandleStatus: "COMPLETED",
      currentCandle: {
        open: 5008, high: 5009, low: 5004, close: 5005,
        volume: 700, time: 101, candleClosed: true,
      },
      priorCandle: {
        open: 5005, high: 5009, low: 5004, close: 5007,
        volume: 900, time: 100, candleClosed: true,
      },
    },
    reactionValidation5m: fiveMinute(),
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
    directionState: "LONG",
    direction: "LONG",
    ...overrides,
  };
}

function tactical(overrides = {}) {
  return {
    active: true,
    relativeVolume: 1.1,
    volumeTrend: "STABLE",
    volumeExpansion: false,
    volumeConfirmed: false,
    highVolumeCandles: 1,
    currentBarVolume: 1200,
    priorBarVolume: 1000,
    ...overrides,
  };
}

function build({ engine3 = reaction(), fast = tactical(), location = candidate() } = {}) {
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
    engine26LocationCandidate: location,
  });
}

test("Engine3 LONG + Engine3 diagnostic 5m SHORT + weak raw 5m participation waits, not blocks", () => {
  const engine3 = reaction({
    reactionValidation5m: fiveMinute({
      diagnosticDirection: "SHORT",
      current: { open: 5008, high: 5009, low: 5005, close: 5006, volume: 800, time: 200 },
      prior: { open: 5007, high: 5009, low: 5005, close: 5007, volume: 1000, time: 195 },
    }),
  });
  const out = build({ engine3 });
  assert.equal(out.validation5mDirection, "SHORT");
  assert.equal(out.participation5mState, "UNRESOLVED");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("Engine3 LONG + completed seller-dominant 5m participation hard-blocks", () => {
  const engine3 = reaction({
    reactionValidation5m: fiveMinute({
      diagnosticDirection: "LONG",
      current: { open: 5008, high: 5009, low: 5001, close: 5003, volume: 1500, time: 200 },
      prior: { open: 5005, high: 5009, low: 5004, close: 5007, volume: 1000, time: 195 },
    }),
  });
  const out = build({ engine3 });
  assert.equal(out.participation5mState, "ADVERSE");
  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(out.hardBlocked, true);
  assert.equal(out.allowed, false);
});

test("Engine3 SHORT + completed buyer-dominant 5m participation hard-blocks", () => {
  const engine3 = reaction({
    direction: "SHORT",
    reactionValidation5m: fiveMinute({
      diagnosticDirection: "SHORT",
      current: { open: 5002, high: 5009, low: 5001, close: 5008, volume: 1600, time: 200 },
      prior: { open: 5005, high: 5007, low: 5001, close: 5003, volume: 1000, time: 195 },
    }),
  });
  const out = build({ engine3 });
  assert.equal(out.participation5mState, "ADVERSE");
  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(out.hardBlocked, true);
});

test("supportive completed 5m survives weak 1m counter-pressure", () => {
  const out = build();
  assert.equal(out.observation1mDirection, "SHORT");
  assert.equal(out.participation5mState, "SUPPORTIVE");
  assert.equal(out.participationState, "PARTICIPATION_CONFIRMED");
  assert.equal(out.allowed, true);
});

test("supportive 5m plus materially weak fading 10m downgrades to WAIT", () => {
  const out = build({
    fast: tactical({
      relativeVolume: 0.8,
      volumeTrend: "FADING",
      volumeExpansion: false,
      volumeConfirmed: false,
      highVolumeCandles: 0,
    }),
  });
  assert.equal(out.participation5mState, "SUPPORTIVE");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("FADING 10m does not veto supportive 5m when 10m still has strong expansion", () => {
  const out = build({
    fast: tactical({
      relativeVolume: 2.03,
      volumeTrend: "FADING",
      volumeExpansion: true,
      volumeConfirmed: false,
      highVolumeCandles: 3,
    }),
  });
  assert.equal(out.participation5mState, "SUPPORTIVE");
  assert.equal(out.participationState, "PARTICIPATION_CONFIRMED");
  assert.equal(out.allowed, true);
});

test("stale 5m participation is UNRESOLVED", () => {
  const engine3 = reaction({
    reactionValidation5m: fiveMinute({ stale: true }),
  });
  const out = build({ engine3 });
  assert.equal(out.participation5mState, "UNRESOLVED");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("forming 5m participation is UNRESOLVED", () => {
  const engine3 = reaction({
    reactionValidation5m: fiveMinute({ status: "FORMING" }),
  });
  const out = build({ engine3 });
  assert.equal(out.participation5mState, "UNRESOLVED");
  assert.equal(out.participationState, "PARTICIPATION_WAITING");
  assert.equal(out.hardBlocked, false);
});

test("identity mismatch remains a hard block", () => {
  const out = build({
    location: candidate({ candidateId: "DIFFERENT-CANDIDATE" }),
  });
  assert.equal(out.participationState, "IDENTITY_MISMATCH");
  assert.equal(out.hardBlocked, true);
});

test("candidate invalidation remains a hard block", () => {
  const engine3 = reaction({ candidateInvalidated: true });
  const out = build({ engine3 });
  assert.equal(out.participationState, "CANDIDATE_INVALIDATED");
  assert.equal(out.hardBlocked, true);
});

test("Engine 4 confirmation never creates permission or execution authority", () => {
  const out = build();
  assert.equal(out.participationState, "PARTICIPATION_CONFIRMED");
  assert.equal(out.allowed, true);
  assert.equal(out.requiresEngine6Permission, true);
  assert.equal(out.noPermissionCreated, true);
  assert.equal(out.noRealPermissionCreated, true);
  assert.equal(out.noExecution, true);
  assert.equal(out.realExecutionAuthority, false);
  assert.equal(out.executable, false);
});
