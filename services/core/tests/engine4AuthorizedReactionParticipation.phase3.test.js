// tests/engine4AuthorizedReactionParticipation.phase3.test.js
// Focused Engine 4 Phase 3 contract tests.

import assert from "node:assert/strict";
import { buildEngine4AuthorizedReactionParticipation } from "../logic/engine4/buildAuthorizedReactionParticipation.js";

function baseReaction(overrides = {}) {
  return {
    active: true,
    engine: "engine3.paperScalpReaction.v2",
    source: "confluence.context.reaction.paperScalpReaction",
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId: "E26C-TEST-CANDIDATE",
    zoneId: "E26Z-TEST-ZONE",
    symbol: "ES",
    setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v1",
    evaluationAuthorized: true,
    reactionConfirmed: true,
    reactionState: "REACTION_CONFIRMED",
    authorizedReactionState: "REACTION_CONFIRMED",
    state: "RECLAIM_OBSERVED",
    quality: "GOOD",
    direction: "LONG",
    entryZone: { id: "E26Z-TEST-ZONE", lo: 7504, hi: 7518.25, mid: 7511.13 },
    lastCandle: {
      open: 7524,
      high: 7524.25,
      low: 7522.5,
      close: 7523,
      volume: 413,
      time: 1787418060,
    },
    priorCandle: {
      open: 7520.5,
      high: 7524.25,
      low: 7517.5,
      close: 7524,
      volume: 5914,
      time: 1787417460,
      candleClosed: true,
    },
    candleClosed: false,
    earlySignal: true,
    noPermissionCreated: true,
    noExecution: true,
    ...overrides,
  };
}

function baseCandidate(overrides = {}) {
  return {
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId: "E26C-TEST-CANDIDATE",
    zoneId: "E26Z-TEST-ZONE",
    symbol: "ES",
    setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v1",
    ...overrides,
  };
}

function build({ reaction = baseReaction(), candidate = baseCandidate(), fast = null, current = null } = {}) {
  return buildEngine4AuthorizedReactionParticipation({
    patchedConfluence: {
      context: {
        reaction: { paperScalpReaction: reaction },
        volume: {
          engine4FastImbalanceParticipation: fast,
          engine4CurrentScalpParticipation: current,
        },
      },
    },
    engine26LocationCandidate: candidate,
  });
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`${name}: PASS`);
  } catch (err) {
    console.error(`${name}: FAIL`);
    console.error(err);
    process.exitCode = 1;
  }
}

runTest("July 22 forming candle does not hard-block", () => {
  const out = build({
    fast: {
      active: true,
      allowed: false,
      hardBlocked: true,
      participationState: "VOLUME_RISK_PRESENT",
      participationQuality: "RISK",
      intendedDirection: "LONG",
      currentBarVolume: 413,
      priorBarVolume: 5914,
      currentVsPriorVolumeRatio: 0.07,
      volumeExpansion: false,
      volumeConfirmed: false,
      relativeVolume: 0.07,
      volumeTrend: "FADING",
    },
  });

  assert.equal(out.participationState, "FORMING_CANDLE_PARTICIPATION_DEVELOPING");
  assert.equal(out.participationQuality, "PROVISIONAL");
  assert.equal(out.participationDeveloping, true);
  assert.equal(out.participationConfirmed, false);
  assert.equal(out.hardBlocked, false);
  assert.equal(out.allowed, false);
  assert.equal(out.currentBarVolume, 413);
  assert.equal(out.priorBarVolume, 5914);
  assert.equal(out.rawCurrentVsPriorVolumeRatio, 0.07);
  assert.equal(out.normalizedVolumeRatio, null);
  assert.equal(out.formingCandleComparisonValid, false);
  assert.equal(out.noPermissionCreated, true);
  assert.equal(out.noExecution, true);
});

runTest("completed adverse candle still hard-blocks", () => {
  const out = build({
    reaction: baseReaction({
      lastCandle: {
        open: 7524,
        high: 7524.25,
        low: 7510,
        close: 7502,
        volume: 9000,
        candleClosed: true,
      },
      priorCandle: {
        open: 7520.5,
        high: 7524.25,
        low: 7517.5,
        close: 7524,
        volume: 5914,
        candleClosed: true,
      },
      candleClosed: true,
      earlySignal: false,
    }),
    fast: {
      active: true,
      allowed: false,
      hardBlocked: true,
      participationState: "VOLUME_RISK_PRESENT",
      participationQuality: "RISK",
      intendedDirection: "LONG",
      volumeExpansion: true,
      supportsDirection: false,
      absorptionRisk: true,
      highVolumeNoProgress: true,
    },
  });

  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(out.hardBlocked, true);
  assert.equal(out.allowed, false);
});

runTest("completed zone loss hard-blocks", () => {
  const out = build({
    reaction: baseReaction({
      entryZone: { id: "E26Z-TEST-ZONE", lo: 7504, hi: 7518.25 },
      lastCandle: { open: 7510, high: 7512, low: 7498, close: 7500, volume: 7000, candleClosed: true },
      priorCandle: { open: 7515, high: 7520, low: 7510, close: 7511, volume: 4000, candleClosed: true },
      candleClosed: true,
      earlySignal: false,
    }),
  });

  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(out.hardBlocked, true);
});

runTest("completed-close candidate invalidation blocks safely", () => {
  const out = build({
    reaction: baseReaction({
      reactionState: "REACTION_INVALIDATED",
      invalidationFacts: { completedCloseInvalidated: true },
      candleClosed: true,
    }),
  });

  assert.equal(out.participationState, "CANDIDATE_INVALIDATED");
  assert.equal(out.hardBlocked, true);
  assert.equal(out.allowed, false);
});

runTest("identity mismatch hard-blocks and preserves incoming identity", () => {
  const out = build({
    candidate: baseCandidate({ candidateId: "E26C-DIFFERENT" }),
  });

  assert.equal(out.participationState, "IDENTITY_MISMATCH");
  assert.equal(out.hardBlocked, true);
  assert.equal(out.candidateId, "E26C-TEST-CANDIDATE");
  assert.equal(out.zoneId, "E26Z-TEST-ZONE");
});

runTest("unconfirmed reaction cannot confirm participation", () => {
  const out = build({
    reaction: baseReaction({ reactionConfirmed: false, confirmed: false, candleClosed: true }),
    fast: {
      active: true,
      allowed: true,
      hardBlocked: false,
      participationState: "RECLAIM_VOLUME_CONFIRMED",
      participationQuality: "CLEAN",
      intendedDirection: "LONG",
    },
  });

  assert.equal(out.participationConfirmed, false);
  assert.equal(out.allowed, false);
});

runTest("confirmed reaction plus constructive participation confirms", () => {
  const out = build({
    reaction: baseReaction({
      lastCandle: { open: 7520, high: 7526, low: 7518, close: 7525, volume: 7000, candleClosed: true },
      priorCandle: { open: 7515, high: 7520, low: 7512, close: 7518, volume: 4000, candleClosed: true },
      candleClosed: true,
      quality: "STRONG",
    }),
    fast: {
      active: true,
      allowed: true,
      hardBlocked: false,
      participationState: "RECLAIM_VOLUME_CONFIRMED",
      participationQuality: "CLEAN",
      intendedDirection: "LONG",
      relativeVolume: 1.8,
      volumeExpansion: true,
      volumeConfirmed: true,
    },
  });

  assert.equal(out.participationState, "PARTICIPATION_CONFIRMED");
  assert.equal(out.participationConfirmed, true);
  assert.equal(out.allowed, true);
  assert.equal(out.direction, "LONG");
});

runTest("legacy fields remain available and no authority is created", () => {
  const out = build();
  assert.equal("allowed" in out, true);
  assert.equal("confirmed" in out, true);
  assert.equal("hardBlocked" in out, true);
  assert.equal("participationState" in out, true);
  assert.equal("participationQuality" in out, true);
  assert.equal(out.requiresEngine6Permission, true);
  assert.equal(out.noPermissionCreated, true);
  assert.equal(out.noExecution, true);
  assert.equal(out.executable, false);
});

runTest("inputs are not mutated", () => {
  const reaction = baseReaction();
  const before = JSON.stringify(reaction);
  build({ reaction });
  assert.equal(JSON.stringify(reaction), before);
});

runTest("non-Strategy-1 identity fails safely", () => {
  const out = build({
    reaction: baseReaction({ strategyId: "subminute_scalp@10m", laneId: "subminute" }),
    candidate: baseCandidate({ strategyId: "subminute_scalp@10m", laneId: "subminute" }),
  });

  assert.equal(out.participationState, "IDENTITY_MISMATCH");
  assert.equal(out.hardBlocked, true);
});

if (process.exitCode) {
  console.error("Engine 4 Phase 3 tests failed.");
  process.exit(process.exitCode);
}

console.log("Engine 4 Phase 3 tests complete.");
