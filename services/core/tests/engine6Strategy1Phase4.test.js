import assert from "node:assert/strict";
import {
  evaluateEngine6Strategy1Phase4Contract,
} from "../logic/engine6/strategy1PermissionContract.js";

const setupClass = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

function valid(overrides = {}) {
  return {
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    engine26LocationCandidate: {
      laneId: "minute",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      candidateId: "C1",
      zoneId: "Z1",
      setupClass,
      setupGrade: "A+++",
      identitySetupKey: setupClass,
      candidateIdentityVersion: "engine26.strategy1.v1",
      directionBias: "LONG",
      currentPrice: 5001,
      entryZone: { midline: 5000 },
      ...(overrides.engine26LocationCandidate || {}),
    },
    engine3Reaction: {
      laneId: "minute",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      candidateId: "C1",
      zoneId: "Z1",
      setupClass,
      setupGrade: "A+++",
      identitySetupKey: setupClass,
      candidateIdentityVersion: "engine26.strategy1.v1",
      evaluationAuthorized: true,
      reactionConfirmed: true,
      reactionState: "REACTION_CONFIRMED",
      authorizedReactionState: "REACTION_CONFIRMED",
      direction: "LONG",
      quality: "STRONG",
      confirmed: true,
      allowed: true,
      ...(overrides.engine3Reaction || {}),
    },
    engine4Participation: {
      laneId: "minute",
      strategyId: "intraday_scalp@10m",
      symbol: "ES",
      candidateId: "C1",
      zoneId: "Z1",
      setupClass,
      setupGrade: "A+++",
      identitySetupKey: setupClass,
      candidateIdentityVersion: "engine26.strategy1.v1",
      participationConfirmed: true,
      participationState: "PARTICIPATION_CONFIRMED",
      participationQuality: "CLEAN",
      hardBlocked: false,
      allowed: true,
      confirmed: true,
      ...(overrides.engine4Participation || {}),
    },
  };
}

function run(input) {
  return evaluateEngine6Strategy1Phase4Contract(input);
}

let out = run(valid());
assert.equal(out.allowed, true);
assert.equal(out.decision, "FAST_INTRADAY_PAPER_ALLOW");
assert.equal(out.executable, false);
assert.equal(out.realExecutionAllowed, false);
assert.equal(out.brokerExecutionAllowed, false);
assert.equal(out.schwabExecutionAllowed, false);

out = run(valid({ engine3Reaction: { candidateId: "BAD" } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("CANDIDATE_ID_MISMATCH"));

out = run(valid({ engine4Participation: { zoneId: "BAD" } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("ZONE_ID_MISMATCH"));

out = run(valid({ engine26LocationCandidate: { setupClass: "BAD" } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("SETUP_CLASS_MISMATCH"));

out = run(valid({ engine4Participation: { identitySetupKey: "BAD" } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("IDENTITY_SETUP_KEY_MISMATCH"));

out = run(valid({ engine26LocationCandidate: { candidateInvalidated: true } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("CANDIDATE_INVALIDATED"));

out = run(valid({ engine3Reaction: { reactionConfirmed: false, reactionState: "REACTION_DEVELOPING" } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("ENGINE3_REACTION_WAITING"));

out = run(valid({ engine4Participation: { participationConfirmed: false, participationState: "PARTICIPATION_DEVELOPING" } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("ENGINE4_PARTICIPATION_WAITING"));

out = run(valid({ engine4Participation: { hardBlocked: true } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("ENGINE4_HARD_BLOCKED"));

out = run(valid({ engine26LocationCandidate: { currentPrice: 4999 } }));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("ENTRY_ZONE_MIDLINE_TRIGGER_NOT_SATISFIED"));

out = run(valid({
  engine26LocationCandidate: { laneId: "subminute" },
}));
assert.equal(out.allowed, false);
assert.ok(out.blockers.includes("LANE_ID_MISMATCH_OR_NON_MINUTE_IDENTITY"));

console.log("Engine 6 Strategy 1 Phase 4 tests");
console.log("=================================");
console.log("all valid gates produce FAST_INTRADAY_PAPER_ALLOW: PASS");
console.log("paper/planning-only and non-executable: PASS");
console.log("candidate mismatch prevents permission: PASS");
console.log("zone mismatch prevents permission: PASS");
console.log("setupClass mismatch prevents permission: PASS");
console.log("identitySetupKey mismatch prevents permission: PASS");
console.log("candidate invalidation prevents permission: PASS");
console.log("reaction developing does not allow: PASS");
console.log("participation developing does not allow: PASS");
console.log("Engine 4 hard block prevents permission: PASS");
console.log("midline not reached does not allow: PASS");
console.log("Subminute isolation proof: PASS");
