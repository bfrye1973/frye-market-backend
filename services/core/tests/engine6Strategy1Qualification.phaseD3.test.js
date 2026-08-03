// services/core/tests/engine6Strategy1Qualification.phaseD3.test.js
//
// Engine 6 Phase D3 focused qualification-consumption tests.
//
// Explicit Engine 3 Strategy 1 qualification is authoritative when
// published. Explicit false fails closed. Missing field preserves the
// legacy fallback. Engine 6 retains identity, Engine 4, midline, LONG-only,
// paper-only, and no-execution safety.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  evaluateEngine6Strategy1Phase4Contract,
  resolveEngine3Strategy1Qualification,
} from "../logic/engine6/strategy1PermissionContract.js";

const IDENTITY = {
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  symbol: "ES",
  candidateId: "E26C-D3",
  zoneId: "E26Z-D3",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  setupGrade: "A+++",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  candidateIdentityVersion: "engine26.strategy1.v2",
};

function engine26(overrides = {}) {
  return {
    ...IDENTITY,
    direction: "LONG",
    directionState: "ACTIVE_LONG",
    currentPrice: 5006,
    entryZone: {
      mid: 5005,
    },
    candidateInvalidated: false,
    locationInvalidated: false,
    ...overrides,
  };
}

function engine3(overrides = {}) {
  return {
    ...IDENTITY,
    active: true,
    authorized: true,
    evaluationAuthorized: true,
    authorizeEngine3Evaluation: true,

    engine3Strategy1QualifiedForEngine6: true,

    allowed: true,
    reactionConfirmed: false,
    confirmed: false,
    authorizedReactionState: "WATCHING_AUTHORIZED_LOCATION",
    reactionState: "WATCHING_AUTHORIZED_LOCATION",
    state: "WICK_BELOW_AND_RECLAIM",
    direction: "LONG",
    quality: "GOOD",
    ...overrides,
  };
}

function engine4(overrides = {}) {
  return {
    ...IDENTITY,
    active: true,
    participationConfirmed: true,
    confirmed: true,
    allowed: true,
    hardBlocked: false,
    status: "PARTICIPATION_CONFIRMED",
    participationState: "PARTICIPATION_CONFIRMED",
    participationQuality: "CLEAN",
    intendedDirection: "LONG",
    direction: "LONG",
    completedAdverseParticipation: false,
    ...overrides,
  };
}

function evaluate({
  e26 = engine26(),
  e3 = engine3(),
  e4 = engine4(),
  direction = "LONG",
} = {}) {
  return evaluateEngine6Strategy1Phase4Contract({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    engine26LocationCandidate: e26,
    engine3Reaction: e3,
    engine4Participation: e4,
    direction,
  });
}

test("explicit true qualifies Engine 3 when reactionConfirmed is false", () => {
  const result = evaluate();

  assert.equal(result.reaction.qualificationExplicitlyPublished, true);
  assert.equal(result.reaction.engine3Qualified, true);
  assert.equal(result.reaction.reactionConfirmed, false);
  assert.equal(result.allowed, true);
  assert.equal(result.decision, "FAST_INTRADAY_PAPER_ALLOW");
  assert.ok(
    result.reasonCodes.includes(
      "ENGINE3_STRATEGY1_QUALIFIED_EXPLICIT"
    )
  );
  assert.ok(
    result.reasonCodes.includes(
      "ENGINE3_REACTION_CONFIRMED_DIAGNOSTIC_ONLY"
    )
  );
  assert.equal(
    result.blockers.includes("ENGINE3_REACTION_NOT_CONFIRMED"),
    false
  );
});

test("explicit true with reactionConfirmed true preserves valid LONG behavior", () => {
  const result = evaluate({
    e3: engine3({
      reactionConfirmed: true,
      confirmed: true,
      authorizedReactionState: "REACTION_CONFIRMED",
      reactionState: "REACTION_CONFIRMED",
    }),
  });

  assert.equal(result.reaction.engine3Qualified, true);
  assert.equal(result.allowed, true);
  assert.equal(result.decision, "FAST_INTRADAY_PAPER_ALLOW");
});

test("explicit false overrides legacy confirmation and fails closed", () => {
  const result = evaluate({
    e3: engine3({
      engine3Strategy1QualifiedForEngine6: false,
      allowed: true,
      reactionConfirmed: true,
      confirmed: true,
      authorizedReactionState: "REACTION_CONFIRMED",
      reactionState: "REACTION_CONFIRMED",
    }),
  });

  assert.equal(result.reaction.qualificationExplicitlyPublished, true);
  assert.equal(result.reaction.engine3Qualified, false);
  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes("ENGINE3_STRATEGY1_NOT_QUALIFIED")
  );
});

test("absent explicit field preserves legacy qualified fallback", () => {
  const legacy = engine3({
    reactionConfirmed: true,
    confirmed: true,
    authorizedReactionState: "REACTION_CONFIRMED",
    reactionState: "REACTION_CONFIRMED",
  });

  delete legacy.engine3Strategy1QualifiedForEngine6;

  const result = evaluate({
    e3: legacy,
  });

  assert.equal(result.reaction.qualificationExplicitlyPublished, false);
  assert.equal(result.reaction.qualificationSource,
    "ENGINE3_STRATEGY1_QUALIFICATION_LEGACY_FALLBACK");
  assert.equal(result.allowed, true);
});

test("absent explicit field preserves legacy unconfirmed blocker", () => {
  const legacy = engine3();
  delete legacy.engine3Strategy1QualifiedForEngine6;

  const result = evaluate({
    e3: legacy,
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.some((blocker) =>
      [
        "ENGINE3_REACTION_WAITING",
        "ENGINE3_REACTION_NOT_CONFIRMED",
      ].includes(blocker)
    )
  );
});

test("explicit true cannot rescue Engine 4 unconfirmed participation", () => {
  const result = evaluate({
    e4: engine4({
      participationConfirmed: false,
      confirmed: false,
      allowed: false,
      status: "PARTICIPATION_DEVELOPING",
      participationState: "PARTICIPATION_DEVELOPING",
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes("ENGINE4_PARTICIPATION_WAITING")
  );
});

test("explicit true cannot rescue Engine 4 hard block", () => {
  const result = evaluate({
    e4: engine4({
      hardBlocked: true,
      allowed: false,
      confirmed: false,
      participationConfirmed: false,
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("ENGINE4_HARD_BLOCKED"));
});

test("candidate mismatch remains blocked", () => {
  const result = evaluate({
    e4: engine4({
      candidateId: "E26C-DIFFERENT",
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("CANDIDATE_ID_MISMATCH"));
});

test("candidate invalidation remains blocked", () => {
  const result = evaluate({
    e26: engine26({
      candidateInvalidated: true,
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("CANDIDATE_INVALIDATED"));
});

test("location invalidation remains blocked", () => {
  const result = evaluate({
    e26: engine26({
      locationInvalidated: true,
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("LOCATION_INVALIDATED"));
});

test("midline not reached remains blocked", () => {
  const result = evaluate({
    e26: engine26({
      currentPrice: 5004,
      entryZone: {
        mid: 5005,
      },
    }),
  });

  assert.equal(result.allowed, false);
  assert.ok(
    result.blockers.includes(
      "ENTRY_ZONE_MIDLINE_TRIGGER_NOT_SATISFIED"
    )
  );
});

test("qualified SHORT remains non-permission under LONG-only contract", () => {
  const result = evaluate({
    e26: engine26({
      direction: "SHORT",
      directionState: "ACTIVE_SHORT",
    }),
    e3: engine3({
      state: "FAILED_RECLAIM",
      direction: "SHORT",
      engine3Strategy1QualifiedForEngine6: true,
    }),
    e4: engine4({
      intendedDirection: "SHORT",
      direction: "SHORT",
    }),
    direction: "SHORT",
  });

  assert.equal(result.reaction.engine3Qualified, true);
  assert.equal(result.allowed, false);
  assert.equal(result.paperAllowed, false);
  assert.equal(result.planningAllowed, false);
  assert.equal(result.executable, false);
  assert.equal(result.realExecutionAllowed, false);
  assert.equal(result.brokerExecutionAllowed, false);
  assert.equal(result.schwabExecutionAllowed, false);
  assert.ok(result.blockers.includes("REACTION_DIRECTION_NOT_LONG"));
});

test("qualification resolver preserves explicit true false and absent semantics", () => {
  const explicitTrue = resolveEngine3Strategy1Qualification({
    reaction: {
      engine3Strategy1QualifiedForEngine6: true,
      reactionConfirmed: false,
    },
    legacyQualified: false,
  });

  const explicitFalse = resolveEngine3Strategy1Qualification({
    reaction: {
      engine3Strategy1QualifiedForEngine6: false,
      reactionConfirmed: true,
    },
    legacyQualified: true,
  });

  const absent = resolveEngine3Strategy1Qualification({
    reaction: {},
    legacyQualified: true,
  });

  assert.deepEqual(explicitTrue, {
    explicitlyPublished: true,
    qualified: true,
    source: "ENGINE3_STRATEGY1_QUALIFIED_EXPLICIT",
    reactionConfirmedDiagnosticOnly: true,
  });

  assert.equal(explicitFalse.explicitlyPublished, true);
  assert.equal(explicitFalse.qualified, false);

  assert.equal(absent.explicitlyPublished, false);
  assert.equal(absent.qualified, true);
  assert.equal(
    absent.source,
    "ENGINE3_STRATEGY1_QUALIFICATION_LEGACY_FALLBACK"
  );
});

test("snapshot wrapper consumes shared qualification resolver and hard-disables SHORT permission", () => {
  const source = readFileSync(
    new URL("../jobs/buildStrategySnapshot.js", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /resolveEngine3Strategy1Qualification/
  );

  assert.match(
    source,
    /engine3Qualification\\.qualified === true/
  );

  assert.match(
    source,
    /ENGINE3_STRATEGY1_NOT_QUALIFIED/
  );

  assert.match(
    source,
    /paperShortAllowed:\\s*false/
  );

  assert.match(
    source,
    /direction === "LONG"/
  );
});
