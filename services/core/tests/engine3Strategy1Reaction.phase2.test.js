// services/core/tests/engine3Strategy1Reaction.phase2.test.js

import assert from "node:assert/strict";
import { buildEngine26Strategy1Reaction } from "../logic/engine3/engine26Strategy1Reaction.js";

function baseHandoff(overrides = {}) {
  return {
    active: true,
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId: "E26C-TEST-CANDIDATE",
    zoneId: "E26Z-TEST-ZONE",
    symbol: "ES",
    setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v1",

    authorized: true,
    evaluationAuthorized: true,
    authorizeEngine3Evaluation: true,

    tradeDirectionBias: "LONG",
    expectedReactions: [
      "HELD_LEVEL",
      "RECLAIMED_LEVEL",
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "BREAKOUT_HOLDING",
    ],

    currentPrice: 7519.25,

    entryZone: {
      id: "E26Z-TEST-ZONE",
      zoneId: "E26Z-TEST-ZONE",
      low: 7510,
      high: 7520,
      midline: 7515,
    },

    targetZone: {
      id: "E26Z-TARGET-ZONE",
      zoneId: "E26Z-TARGET-ZONE",
      low: 7540,
      high: 7550,
      midline: 7545,
    },

    locationInvalidationBoundary: 7509.75,

    sweepFacts: {},
    lowerWickFacts: {},
    reclaimFacts: {},
    postReclaimFacts: {},
    invalidationFacts: {},

    noPermissionCreated: true,
    noExecution: true,

    ...overrides,
  };
}

function assertNoAuthority(result) {
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noExecution, true);
  assert.equal(result.realExecutionAuthority, false);
  assert.equal(result.requiresEngine6PaperApproval, true);

  assert.equal(result.paperOrderCreated, undefined);
  assert.equal(result.orderCreated, undefined);
  assert.equal(result.fillCreated, undefined);
  assert.equal(result.journalCreated, undefined);
  assert.equal(result.executionCreated, undefined);
  assert.equal(result.positionSizingCreated, undefined);
  assert.equal(result.managementPlanCreated, undefined);
}

function compact(result) {
  return {
    candidateId: result.candidateId,
    zoneId: result.zoneId,
    evaluationAuthorized: result.evaluationAuthorized,
    reactionConfirmed: result.reactionConfirmed,
    reactionState: result.reactionState,
    authorizedReactionState: result.authorizedReactionState,
    allowed: result.allowed,
    confirmed: result.confirmed,
    quality: result.quality,
    direction: result.direction,
    noPermissionCreated: result.noPermissionCreated,
    noExecution: result.noExecution,
    reasonCodes: result.reasonCodes,
  };
}

const results = [];

/*
 * 1. Identity match preserves candidateId and zoneId
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      reclaimFacts: {
        reclaimObserved: true,
        completedCloseAboveZoneLow: true,
        completedCloseAboveMidline: true,
        completedClose: 7516,
      },
      postReclaimFacts: {
        completedCloseCountAboveZoneLow: 1,
        consecutiveCompletedClosesAboveZoneLow: 1,
      },
    }),
    expectedIdentity: {
      candidateId: "E26C-TEST-CANDIDATE",
      zoneId: "E26Z-TEST-ZONE",
    },
  });

  assert.equal(result.candidateId, "E26C-TEST-CANDIDATE");
  assert.equal(result.zoneId, "E26Z-TEST-ZONE");
  assertNoAuthority(result);

  results.push(["identity match preserves candidateId and zoneId", "PASS", compact(result)]);
}

/*
 * 2. Identity mismatch fails safely
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff(),
    expectedIdentity: {
      candidateId: "WRONG-CANDIDATE",
      zoneId: "E26Z-TEST-ZONE",
    },
  });

  assert.equal(result.reactionState, "WAITING_FOR_VALID_ENGINE26_IDENTITY");
  assert.equal(result.allowed, false);
  assert.equal(result.confirmed, false);
  assertNoAuthority(result);

  results.push(["identity mismatch fails safely", "PASS", compact(result)]);
}

/*
 * 3. Sweep alone does not confirm
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      sweepFacts: {
        intrabarSweepObserved: true,
        sweepObserved: true,
      },
    }),
  });

  assert.equal(result.reactionState, "SWEEP_OBSERVED");
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.allowed, false);
  assertNoAuthority(result);

  results.push(["sweep alone does not confirm", "PASS", compact(result)]);
}

/*
 * 4. Wick alone does not confirm
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      lowerWickFacts: {
        lowerWickBelowZoneObserved: true,
        lowerWickToBodyRatio: 2.5,
      },
    }),
  });

  assert.equal(result.reactionState, "WICK_RECLAIM_OBSERVED");
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.allowed, false);
  assertNoAuthority(result);

  results.push(["wick alone does not confirm", "PASS", compact(result)]);
}

/*
 * 5. Reclaim creates developing state
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      sweepFacts: {
        intrabarSweepObserved: true,
      },
      reclaimFacts: {
        reclaimObserved: true,
        completedCloseAboveZoneLow: true,
        completedClose: 7511,
      },
      postReclaimFacts: {
        completedCloseCountAboveZoneLow: 0,
        consecutiveCompletedClosesAboveZoneLow: 0,
      },
    }),
  });

  assert.equal(result.reactionState, "RECLAIM_OBSERVED");
  assert.equal(result.authorizedReactionState, "RECLAIM_HOLD_DEVELOPING");
  assert.equal(result.reactionConfirmed, false);
  assert.equal(result.allowed, false);
  assertNoAuthority(result);

  results.push(["reclaim creates developing state", "PASS", compact(result)]);
}

/*
 * 6. Reclaim plus hold confirms
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      sweepFacts: {
        intrabarSweepObserved: true,
      },
      reclaimFacts: {
        reclaimObserved: true,
        completedCloseAboveZoneLow: true,
        completedCloseAboveMidline: true,
        completedClose: 7516,
      },
      postReclaimFacts: {
        completedCloseCountAboveZoneLow: 1,
        consecutiveCompletedClosesAboveZoneLow: 1,
        lowestPriceSinceLatestReclaim: 7511,
      },
    }),
  });

  assert.equal(result.reactionState, "REACTION_CONFIRMED");
  assert.equal(result.authorizedReactionState, "REACTION_CONFIRMED");
  assert.equal(result.reactionConfirmed, true);
  assert.equal(result.allowed, true);
  assert.equal(result.confirmed, true);
  assertNoAuthority(result);

  results.push(["reclaim plus hold confirms", "PASS", compact(result)]);
}

/*
 * 7. Intrabar breach does not invalidate
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      reclaimFacts: {
        reclaimObserved: true,
        completedCloseAboveZoneLow: true,
        completedCloseAboveMidline: true,
        completedClose: 7516,
      },
      postReclaimFacts: {
        completedCloseCountAboveZoneLow: 1,
        consecutiveCompletedClosesAboveZoneLow: 1,
        lowestPriceSinceLatestReclaim: 7511,
      },
      invalidationFacts: {
        intrabarInvalidationBreach: true,
        completedCloseInvalidationConfirmed: false,
      },
    }),
  });

  assert.notEqual(result.reactionState, "REACTION_INVALIDATED");
  assert.equal(result.invalidated, false);
  assert.equal(result.reasonCodes.includes("INTRABAR_INVALIDATION_BREACH_QUALITY_DOWNGRADE"), true);
  assertNoAuthority(result);

  results.push(["intrabar breach does not invalidate", "PASS", compact(result)]);
}

/*
 * 8. Completed-close invalidation forces REACTION_INVALIDATED
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      invalidationFacts: {
        completedCloseInvalidationConfirmed: true,
      },
    }),
  });

  assert.equal(result.reactionState, "REACTION_INVALIDATED");
  assert.equal(result.authorizedReactionState, "REACTION_INVALIDATED");
  assert.equal(result.invalidated, true);
  assert.equal(result.allowed, false);
  assert.equal(result.confirmed, false);
  assertNoAuthority(result);

  results.push(["completed-close invalidation forces REACTION_INVALIDATED", "PASS", compact(result)]);
}

/*
 * 9. Legacy fields remain compatible
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff({
      reclaimFacts: {
        reclaimObserved: true,
        completedCloseAboveZoneLow: true,
        completedCloseAboveMidline: true,
        completedClose: 7516,
      },
      postReclaimFacts: {
        completedCloseCountAboveZoneLow: 1,
        consecutiveCompletedClosesAboveZoneLow: 1,
      },
    }),
  });

  assert.equal(result.authorized, true);
  assert.equal(result.authorizeEngine3Evaluation, true);
  assert.equal(result.allowed, result.reactionConfirmed);
  assert.equal(result.confirmed, result.reactionConfirmed);
  assert.equal(result.state, result.reactionState);
  assert.equal(result.status, result.reactionState);

  assertNoAuthority(result);

  results.push(["legacy fields remain compatible", "PASS", compact(result)]);
}

/*
 * 10. No permission / execution authority created
 */
{
  const result = buildEngine26Strategy1Reaction({
    engine26ReactionHandoff: baseHandoff(),
  });

  assertNoAuthority(result);

  results.push([
    "no permission, participation, sizing, management, execution, order, fill, or journal authority is created",
    "PASS",
    compact(result),
  ]);
}

console.log("\nEngine 3 Strategy 1 Phase 2 tests");
console.log("=================================");

for (const [name, status, proof] of results) {
  console.log(`\n${name}: ${status}`);
  console.log(JSON.stringify(proof, null, 2));
}

console.log("\nPASS SUMMARY");
console.log("============");
for (const [name, status] of results) {
  console.log(`${name}: ${status}`);
}

console.log("\nFILES CHANGED");
console.log("=============");
console.log("NO PRODUCTION CODE CHANGED BY THIS TEST");

console.log("\nENGINE BOUNDARY");
console.log("===============");
console.log(
  "No Engine 4, Engine 6, Engine 27E, Engine 27G, Engine 12, Replay, frontend, Subminute, sizing, management, execution, order, fill, or journal authority was changed."
);
