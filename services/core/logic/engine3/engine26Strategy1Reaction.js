// services/core/logic/engine3/engine26Strategy1Reaction.js
//
// Engine 3 Strategy 1 reaction interpreter.

import assert from "node:assert/strict";
import { buildEngine26Strategy1Reaction } from "../logic/engine3/engine26Strategy1Reaction.js";

const baseHandoff = {
  active: true,
  authorized: true,
  authorizeEngine3Evaluation: true,
  evaluationAuthorized: true,
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "E26C-TEST",
  zoneId: "E26Z-TEST",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v1",
  tradeDirectionBias: "LONG",
  expectedReactions: ["HELD_LEVEL", "RECLAIMED_LEVEL", "WICK_BELOW_AND_RECLAIM", "DIP_BOUGHT_FAST", "SELLERS_TRAPPED", "BREAKOUT_HOLDING"],
  entryZone: { lo: 100, hi: 110, mid: 105 },
  targetZone: { lo: 120, hi: 130, mid: 125 },
  locationInvalidationBoundary: 99,
  currentPrice: 104,
};

function build(extra = {}) {
  return buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: {
      ...baseHandoff,
      ...extra,
      sweepFacts: { ...(extra.sweepFacts || {}) },
      lowerWickFacts: { ...(extra.lowerWickFacts || {}) },
      reclaimFacts: { ...(extra.reclaimFacts || {}) },
      postReclaimFacts: { ...(extra.postReclaimFacts || {}) },
      invalidationFacts: { ...(extra.invalidationFacts || {}) },
    },
  });
}

function assertNoAuthority(result) {
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noExecution, true);
  assert.equal(result.requiresEngine6PaperApproval, true);
  assert.equal(result.realExecutionAuthority, false);
}

{
  const result = buildEngine26Strategy1Reaction({ engine26ReactionHandoff: null });
  assert.equal(result.reactionState, "WAITING_FOR_ENGINE26_LOCATION");
  assert.equal(result.active, false);
  assertNoAuthority(result);
}

{
  const result = build({ candidateId: null });
  assert.equal(result.reactionState, "WAITING_FOR_VALID_ENGINE26_IDENTITY");
  assert.equal(result.active, false);
  assert.equal(result.evaluationAuthorized, false);
  assertNoAuthority(result);
}

{
  const result = build({ sweepFacts: { intrabarSweepObserved: true } });
  assert.equal(result.reactionState, "SWEEP_OBSERVED");
  assert.equal(result.reactionConfirmed, false);
  assertNoAuthority(result);
}

{
  const result = build({
    sweepFacts: { intrabarSweepObserved: true },
    lowerWickFacts: { lowerWickBelowZoneObserved: true, lowerWickToBodyRatio: 3 },
  });
  assert.equal(result.reactionConfirmed, false);
  assert.notEqual(result.reactionState, "REACTION_CONFIRMED");
  assertNoAuthority(result);
}

{
  const result = build({
    sweepFacts: { intrabarSweepObserved: true },
    lowerWickFacts: { lowerWickBelowZoneObserved: true, lowerWickToBodyRatio: 3, closedInsideZone: true },
    reclaimFacts: { completedClose: 102, completedCloseAboveZoneLow: true },
  });
  assert.equal(result.reactionState, "RECLAIM_OBSERVED");
  assert.equal(result.authorizedReactionState, "RECLAIM_HOLD_DEVELOPING");
  assert.equal(result.reactionConfirmed, false);
  assertNoAuthority(result);
}

{
  const result = build({
    sweepFacts: { intrabarSweepObserved: true },
    lowerWickFacts: { lowerWickBelowZoneObserved: true, lowerWickToBodyRatio: 3, closedInsideZone: true },
    reclaimFacts: { completedClose: 106, completedCloseAboveZoneLow: true, completedCloseAboveMidline: true },
    postReclaimFacts: { completedCloseCountAboveZoneLow: 1, consecutiveCompletedClosesAboveZoneLow: 1, lowestPriceSinceLatestReclaim: 100.5 },
  });
  assert.equal(result.reactionState, "REACTION_CONFIRMED");
  assert.equal(result.authorizedReactionState, "REACTION_CONFIRMED");
  assert.equal(result.reactionConfirmed, true);
  assert.equal(result.confirmed, true);
  assert.equal(result.allowed, true);
  assertNoAuthority(result);
}

{
  const result = build({
    sweepFacts: { intrabarSweepObserved: true },
    reclaimFacts: { completedClose: 106, completedCloseAboveZoneLow: true, completedCloseAboveMidline: true },
    postReclaimFacts: { completedCloseCountAboveZoneLow: 1, lowestPriceSinceLatestReclaim: 98.75 },
    invalidationFacts: { intrabarInvalidationBreach: true, completedCloseInvalidationConfirmed: false },
  });
  assert.notEqual(result.reactionState, "REACTION_INVALIDATED");
  assert.equal(result.quality, "WEAK");
  assertNoAuthority(result);
}

{
  const result = build({ invalidationFacts: { completedCloseInvalidationConfirmed: true } });
  assert.equal(result.reactionState, "REACTION_INVALIDATED");
  assert.equal(result.active, false);
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.allowed, false);
  assertNoAuthority(result);
}

{
  const first = build({ candidateId: "E26C-ONE", zoneId: "E26Z-ONE", sweepFacts: { intrabarSweepObserved: true } });
  const second = build({ candidateId: "E26C-TWO", zoneId: "E26Z-TWO" });
  assert.equal(first.candidateId, "E26C-ONE");
  assert.equal(first.zoneId, "E26Z-ONE");
  assert.equal(second.candidateId, "E26C-TWO");
  assert.equal(second.zoneId, "E26Z-TWO");
  assert.equal(second.reactionState, "WAITING_FOR_ZONE_INTERACTION");
  assertNoAuthority(second);
}

console.log("ENGINE 3 STRATEGY 1 PHASE 2 TESTS PASSED");
