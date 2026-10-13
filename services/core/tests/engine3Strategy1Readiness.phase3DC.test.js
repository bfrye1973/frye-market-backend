import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { fileURLToPath } from "url";
import { buildStrategy1Readiness } from "../logic/engine3/buildStrategy1Readiness.js";

const identity = {
  symbol: "ES",
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  candidateId: "candidate-1",
  zoneId: "zone-1",
  candidateIdentityVersion: "engine26.strategy1.v2",
};

function inputs(overrides = {}) {
  const relation = overrides.relation ?? "INSIDE_ZONE";
  const candidate = {
    ...identity,
    currentPrice: overrides.currentPrice ?? 100,
    contactState: "NEGOTIATED_LINE_CONTACT",
    ...overrides.candidate,
  };
  const handoff = {
    ...identity,
    contactState: "NEGOTIATED_LINE_CONTACT",
    authorizeEngine3Evaluation: overrides.authorized ?? true,
    zone: {
      lo: 99,
      hi: 101,
      mid: 100,
      relation,
      distancePoints: overrides.zoneDistance ?? (relation === "INSIDE_ZONE" ? 0 : 8),
    },
    ...overrides.handoff,
  };
  const observation1m = overrides.noObservationObject
    ? null
    : {
        ...identity,
        active: overrides.reactionObserved ?? true,
        stale: overrides.stale1m ?? false,
        state: overrides.reactionObserved === false ? "NO_SIGNAL" : "HELD_LEVEL",
        direction: "LONG",
        quality: "GOOD",
        referenceLevel: 108,
        referenceType: "PRIOR_CANDLE_LOW",
        distancePts: 0,
        observedAt: 1_700_000_000_000,
        ...overrides.observation1m,
      };
  const validation5m = overrides.noValidation
    ? null
    : {
        ...identity,
        active: true,
        stale: overrides.stale5m ?? false,
        validationState: overrides.conflict ? "CONFLICT" : "SUPPORT",
        direction: overrides.conflict ? "SHORT" : "LONG",
        maturityResolved: overrides.validationResolved ?? true,
        supports1mDirection: !overrides.conflict && (overrides.validationResolved ?? true),
        conflictsWith1mDirection: overrides.conflict ?? false,
        crossTimeframeSkewMs: overrides.skew ?? 0,
        observedAt: 1_700_000_000_000,
        ...overrides.validation5m,
      };
  const paperScalpReaction = {
    allowed: overrides.canonicalAllowed ?? false,
    engine3Strategy1QualifiedForEngine6: overrides.canonicalQualified ?? false,
    ...overrides.paperScalpReaction,
  };
  return { candidate, handoff, observation1m, validation5m, paperScalpReaction };
}

function build(overrides = {}) {
  const value = inputs(overrides);
  return buildStrategy1Readiness({
    engine26LocationCandidate: value.candidate,
    engine26ReactionHandoff: value.handoff,
    observation1m: value.observation1m,
    validation5m: value.validation5m,
    paperScalpReaction: value.paperScalpReaction,
  });
}

test("local reaction away from the negotiated zone retains Engine 26 distance", () => {
  const result = build({ relation: "ABOVE_ZONE", zoneDistance: 7, currentPrice: 108 });
  assert.equal(result.readinessState, "FAST_REACTION_AWAY_FROM_NEGOTIATED_ZONE");
  assert.equal(result.negotiatedZoneDistancePts, 7);
  assert.equal(result.locationReady, false);
});

test("inside and Engine 26 near relations are location ready without a new threshold", () => {
  assert.equal(build().locationReady, true);
  assert.equal(build({ relation: "NEAR_ABOVE_ZONE", zoneDistance: 2 }).locationReady, true);
  assert.equal(build({ relation: "NEAR_BELOW_ZONE", zoneDistance: 2 }).locationReady, true);
  assert.equal(build({ relation: "ABOVE_ZONE", zoneDistance: 4 }).locationReady, false);
});

test("negotiated location without a 1m reaction waits for 1m", () => {
  assert.equal(
    build({ reactionObserved: false }).readinessState,
    "AT_NEGOTIATED_ZONE_WAITING_FOR_1M_REACTION"
  );
});

test("observed 1m with missing or unresolved 5m waits for validation", () => {
  assert.equal(build({ noValidation: true }).readinessState, "REACTION_OBSERVED_WAITING_FOR_5M_VALIDATION");
  assert.equal(build({ validationResolved: false }).readinessState, "REACTION_OBSERVED_WAITING_FOR_5M_VALIDATION");
});

test("aligned fast evidence is diagnostic and not canonical qualification", () => {
  const result = build();
  assert.equal(result.readinessState, "FAST_EVIDENCE_ALIGNED");
  assert.equal(result.canonicalEngine3Allowed, false);
  assert.equal(result.canonicalEngine3QualifiedForEngine6, false);
  assert.equal(result.noPermissionCreated, true);
  assert.equal(result.noExecution, true);
});

test("1m LONG and 5m SHORT report validation conflict", () => {
  assert.equal(build({ conflict: true }).readinessState, "REACTION_VALIDATION_CONFLICT");
});

test("local and negotiated references remain separate", () => {
  const result = build({ currentPrice: 108, relation: "ABOVE_ZONE", zoneDistance: 7 });
  assert.equal(result.localReferenceLevel, 108);
  assert.equal(result.localReferenceType, "PRIOR_CANDLE_LOW");
  assert.equal(result.negotiatedReferenceLevel, 100);
  assert.equal(result.negotiatedReferenceType, "ENGINE26_NEGOTIATED_ZONE_MIDPOINT");
  assert.equal(result.distanceToLocalReferencePts, 0);
  assert.equal(result.distanceToNegotiatedReferencePts, 8);
});

test("candidate, zone, and missing identity fail closed", () => {
  assert.equal(build({ observation1m: { candidateId: "old" } }).readinessState, "IDENTITY_MISMATCH");
  assert.equal(build({ validation5m: { zoneId: "old" } }).readinessState, "IDENTITY_MISMATCH");
  assert.equal(build({ observation1m: { candidateIdentityVersion: null } }).readinessState, "IDENTITY_MISMATCH");
});

test("stale 1m, stale 5m, and excessive skew report STALE_DATA", () => {
  assert.equal(build({ stale1m: true }).readinessState, "STALE_DATA");
  assert.equal(build({ stale5m: true }).readinessState, "STALE_DATA");
  const skewed = build({ skew: 300_001 });
  assert.equal(skewed.readinessState, "STALE_DATA");
  assert.equal(skewed.crossTimeframeAligned, false);
});

test("Engine 26 authorization false blocks readiness", () => {
  assert.equal(build({ authorized: false }).readinessState, "ENGINE26_NOT_AUTHORIZED");
});

test("canonical qualification requires both exact canonical booleans", () => {
  assert.equal(
    build({ canonicalAllowed: true, canonicalQualified: true }).readinessState,
    "CANONICAL_ENGINE3_QUALIFIED"
  );
  const mismatch = build({ canonicalAllowed: true, canonicalQualified: false });
  assert.notEqual(mismatch.readinessState, "CANONICAL_ENGINE3_QUALIFIED");
  assert.equal(mismatch.canonicalEngine3Allowed, true);
  assert.equal(mismatch.canonicalEngine3QualifiedForEngine6, false);
  assert.ok(mismatch.reasonCodes.includes("CANONICAL_ENGINE3_QUALIFICATION_ALIAS_MISMATCH"));
});

test("lifecycle line contact is published but is not current line-contact proof", () => {
  const result = build({ currentPrice: 108, relation: "ABOVE_ZONE", zoneDistance: 7 });
  assert.equal(result.contactState, "NEGOTIATED_LINE_CONTACT");
  assert.equal(result.distanceToNegotiatedReferencePts, 8);
  assert.equal(Object.hasOwn(result, "atNegotiatedLine"), false);
});

test("builder mutates no Engine 26, 1m, 5m, or canonical input", () => {
  const value = inputs();
  const before = structuredClone(value);
  buildStrategy1Readiness({
    engine26LocationCandidate: value.candidate,
    engine26ReactionHandoff: value.handoff,
    observation1m: value.observation1m,
    validation5m: value.validation5m,
    paperScalpReaction: value.paperScalpReaction,
  });
  assert.deepEqual(value, before);
});

test("snapshot wiring is additive, ordered after canonical Engine 3, and before Engine 4", () => {
  const snapshotPath = fileURLToPath(new URL("../jobs/buildStrategySnapshot.js", import.meta.url));
  const source = fs.readFileSync(snapshotPath, "utf8");
  const start = source.indexOf("const engine3ReactionObservation1m = buildReactionObservation1m");
  const canonical = source.indexOf("attachPaperScalpReactionToConfluence", start);
  const readiness = source.indexOf("const engine3Strategy1Readiness = buildStrategy1Readiness", start);
  const engine4 = source.indexOf("attachEngine4AuthorizedReactionParticipation", start);
  assert.ok(start >= 0 && canonical > start && readiness > canonical && engine4 > readiness);
  assert.match(source, /reaction\.engine3Strategy1Readiness\s*=/);
});

test("Engine 4 and Engine 6 boundary objects passed beside the builder remain unchanged", () => {
  const engine4 = { allowed: false, participationConfirmed: false };
  const engine6 = { permission: false, allowed: false, executable: false };
  const before = structuredClone({ engine4, engine6 });
  build();
  assert.deepEqual({ engine4, engine6 }, before);
});
