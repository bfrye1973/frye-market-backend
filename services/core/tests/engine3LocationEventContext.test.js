import assert from "node:assert/strict";
import test from "node:test";

import { buildEngine26LocationReactionContext } from "../logic/engine3/engine26LocationReactionContext.js";

const historicalEvent = {
  active: true,
  eventType: "RESISTANCE_PULLBACK_SEQUENCE",
  currentState: "PULLBACK_FAILED_AT_RESISTANCE",
  referenceLevel: 7800,
  retestObserved: true,
  retestStatus: "FAILED",
  historicalDirection: "DOWN",
};

function handoff(overrides = {}) {
  return {
    active: true,
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId: "E26C-LOCATION-EVENT",
    zoneId: "E26Z-LOCATION-EVENT",
    symbol: "ES",
    setupClass: "NEGOTIATED_ZONE_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v2",
    chainArmed: true,
    authorizeEngine3Evaluation: true,
    direction: "NEUTRAL",
    directionState: "NEUTRAL",
    tradeDirectionBias: "NEUTRAL",
    expectedReactionDirection: null,
    expectedReactions: [],
    reactionExpected: false,
    locationEventContext: historicalEvent,
    ...overrides,
  };
}

function reaction(direction, state) {
  return {
    direction,
    state,
    quality: "CONFIRMED",
    confirmed: direction !== "NEUTRAL",
    candidateId: "E26C-LOCATION-EVENT",
    zoneId: "E26Z-LOCATION-EVENT",
  };
}

for (const [label, direction, state] of [
  ["bearish evidence remains SHORT", "SHORT", "REJECTING_VALUE"],
  ["bullish evidence remains LONG", "LONG", "HELD_LEVEL"],
  ["unresolved evidence remains NEUTRAL", "NEUTRAL", "NO_SIGNAL"],
]) {
  test(label, () => {
    const result = buildEngine26LocationReactionContext({
      engine26ReactionHandoff: handoff(),
      reactionInput: reaction(direction, state),
    });

    assert.equal(result.direction, direction);
    assert.equal(result.reactionDirection, direction);
    assert.equal(result.locationEventContext.currentState, "PULLBACK_FAILED_AT_RESISTANCE");
    assert.equal(result.locationEventContext.historicalDirection, "DOWN");
    assert.notEqual(result.locationEventContext, historicalEvent);
    assert.equal(result.noPermissionCreated, true);
    assert.equal(result.noExecution, true);
  });
}

test("historical event does not create eligibility when Engine 26 authorization is false", () => {
  const result = buildEngine26LocationReactionContext({
    engine26ReactionHandoff: handoff({ authorizeEngine3Evaluation: false }),
    reactionInput: reaction("SHORT", "REJECTING_VALUE"),
  });

  assert.equal(result.active, false);
  assert.equal(result.authorized, false);
  assert.equal(result.authorizeEngine3Evaluation, false);
  assert.equal(result.locationEventContext.historicalDirection, "DOWN");
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noExecution, true);
});

test("an absent historical event preserves existing Engine 3 behavior", () => {
  const result = buildEngine26LocationReactionContext({
    engine26ReactionHandoff: handoff({ locationEventContext: undefined }),
    reactionInput: reaction("LONG", "RECLAIMED_LEVEL"),
  });

  assert.equal(result.direction, "LONG");
  assert.equal(result.locationEventContext, null);
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noExecution, true);
});
