import assert from "node:assert/strict";
import { test } from "node:test";
import { attachPaperScalpReactionToConfluence } from "../logic/engine3/paperScalpReaction.js";
import { buildEngine4AuthorizedReactionParticipation } from "../logic/engine4/buildAuthorizedReactionParticipation.js";

const identity = {
  symbol: "ES",
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-D3",
  zoneId: "E26Z-D3",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
};

test("canonical Engine 3 publishes the fresh 1m candle and true 5m validation contract", () => {
  const currentCandle = { time: 100, open: 5000, high: 5002, low: 4999, close: 5001, volume: 1200, candleClosed: false };
  const priorCandle = { time: 40, open: 4999, high: 5001, low: 4998, close: 5000, volume: 1000, candleClosed: true };
  const patchedConfluence = {
    context: {
      reaction: {
        currentLevelAction: { active: true, state: "RECLAIMED_LEVEL", direction: "LONG", quality: "GOOD", confirmed: true, noPermissionCreated: true, noExecution: true },
        engine3ReactionObservation1m: {
          ...identity,
          sourceTimeframe: "1m",
          supportingBarTime: 100,
          evaluationTimeMs: 100500,
          currentCandleStatus: "FORMING",
          priorCandleStatus: "COMPLETED",
          currentCandle,
          priorCandle,
          stale: false,
        },
        engine3ReactionValidation5m: {
          ...identity,
          sourceTimeframe: "5m",
          stale: false,
          validationState: "SUPPORT",
        },
      },
    },
  };

  attachPaperScalpReactionToConfluence({
    patchedConfluence,
    engine26ReactionHandoff: { ...identity, active: true, authorized: true, authorizeEngine3Evaluation: true, chainArmed: true },
    paperShortResearchEnabled: true,
  });

  const result = patchedConfluence.context.reaction.paperScalpReaction;
  assert.equal(result.reactionTimeframe, "1m");
  assert.equal(result.sourceTimeframe, "1m");
  assert.equal(result.validationTimeframe, "5m");
  assert.equal(result.supportingBarTime, 100);
  assert.equal(result.currentCandleStatus, "FORMING");
  assert.equal(result.priorCandleStatus, "COMPLETED");
  assert.deepEqual(result.currentCandle, currentCandle);
  assert.deepEqual(result.priorCandle, priorCandle);
  assert.equal(result.candleSourceFresh, true);
});

test("Engine 4 fails closed and cannot publish FORMING when canonical currentCandle is missing", () => {
  const reaction = {
    ...identity,
    active: true,
    authorized: true,
    evaluationAuthorized: true,
    participationEvaluationEligible: true,
    allowed: true,
    direction: "LONG",
    quality: "GOOD",
    state: "RECLAIMED_LEVEL",
    reactionState: "WATCHING_AUTHORIZED_LOCATION",
    sourceTimeframe: "1m",
    reactionTimeframe: "1m",
    currentCandleStatus: "FORMING",
    priorCandleStatus: "COMPLETED",
    candleSourceFresh: true,
    currentCandle: null,
    priorCandle: { time: 40, close: 5000, volume: 1000, candleClosed: true },
  };
  const result = buildEngine4AuthorizedReactionParticipation({
    paperScalpReaction: reaction,
    engine26LocationCandidate: identity,
  });
  assert.equal(result.participationState, "PARTICIPATION_WAITING");
  assert.equal(result.participationDeveloping, false);
  assert.equal(result.allowed, false);
  assert.equal(result.blockers.includes("CURRENT_CANDLE_MISSING"), true);
});

test("Engine 4 rejects a stale identified candle as participation evidence", () => {
  const reaction = {
    ...identity,
    active: true,
    authorized: true,
    evaluationAuthorized: true,
    participationEvaluationEligible: true,
    allowed: true,
    direction: "LONG",
    quality: "GOOD",
    state: "RECLAIMED_LEVEL",
    reactionState: "WATCHING_AUTHORIZED_LOCATION",
    sourceTimeframe: "1m",
    currentCandleStatus: "COMPLETED",
    priorCandleStatus: "COMPLETED",
    candleSourceFresh: false,
    currentCandle: { time: 100, close: 5001, volume: 1200, candleClosed: true },
    priorCandle: { time: 40, close: 5000, volume: 1000, candleClosed: true },
  };
  const result = buildEngine4AuthorizedReactionParticipation({
    paperScalpReaction: reaction,
    engine26LocationCandidate: identity,
  });
  assert.equal(result.participationState, "PARTICIPATION_WAITING");
  assert.equal(result.allowed, false);
  assert.equal(result.blockers.includes("CANDLE_SOURCE_NOT_FRESH"), true);
