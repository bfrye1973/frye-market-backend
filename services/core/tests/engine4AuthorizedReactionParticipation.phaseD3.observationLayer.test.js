// tests/engine4AuthorizedReactionParticipation.phaseD3.observationLayer.test.js
// Engine 4 Phase D3 three-timeframe observation/publication contract tests.

import assert from "node:assert/strict";
import { buildEngine4AuthorizedReactionParticipation } from "../logic/engine4/buildAuthorizedReactionParticipation.js";

function baseReaction(overrides = {}) {
  return {
    active: true,
    engine: "engine3.paperScalpReaction.v2",
    source: "confluence.context.reaction.paperScalpReaction",
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId: "E26C-D3-TEST",
    zoneId: "E26Z-D3-TEST",
    symbol: "ES",
    setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v1",
    evaluationAuthorized: true,
    authorizeEngine3Evaluation: true,
    participationEvaluationEligible: false,
    reactionConfirmed: false,
    confirmed: false,
    reactionState: "WATCHING_AUTHORIZED_LOCATION",
    authorizedReactionState: "WATCHING_AUTHORIZED_LOCATION",
    state: "REJECTING_VALUE",
    quality: "MIXED",
    direction: "SHORT",
    sourceTimeframe: "1m",
    reactionTimeframe: "10m",
    candleSourceFresh: true,
    currentCandleStatus: "COMPLETED",
    priorCandleStatus: "COMPLETED",
    supportingBarTime: 1786117080,
    currentCandle: {
      time: 1786117080,
      open: 7783,
      high: 7783.25,
      low: 7781.25,
      close: 7781.75,
      volume: 1412,
      candleClosed: true,
    },
    priorCandle: {
      time: 1786117020,
      open: 7781.5,
      high: 7783.25,
      low: 7780.75,
      close: 7783,
      volume: 1772,
      candleClosed: true,
    },
    reactionObservation1m: {
      active: true,
      diagnosticOnly: true,
      noPermissionCreated: true,
      noExecution: true,
      sourceTimeframe: "1m",
      direction: "NEUTRAL",
      quality: "MIXED",
      state: "CHOP_INSIDE_VALUE",
      candleState: "COMPLETED",
      stale: false,
      currentCandle: {
        time: 1786117080,
        open: 7783,
        high: 7783.25,
        low: 7781.25,
        close: 7781.75,
        volume: 1412,
        candleClosed: true,
      },
      priorCandle: {
        time: 1786117020,
        open: 7781.5,
        high: 7783.25,
        low: 7780.75,
        close: 7783,
        volume: 1772,
        candleClosed: true,
      },
      currentCandleStatus: "COMPLETED",
      priorCandleStatus: "COMPLETED",
      supportingBarTime: 1786117080,
    },
    reactionValidation5m: {
      active: true,
      diagnosticOnly: true,
      noPermissionCreated: true,
      noExecution: true,
      sourceTimeframe: "5m",
      validationState: "UNRESOLVED",
      direction: "NEUTRAL",
      quality: "MIXED",
      candleState: "FORMING",
      stale: false,
      currentCandle: {
        time: 1786116900,
        open: 7782,
        high: 7783.25,
        low: 7779.5,
        close: 7781.75,
        volume: 9227,
        candleClosed: false,
      },
      priorCandle: {
        time: 1786116600,
        open: 7784,
        high: 7786.75,
        low: 7781.5,
        close: 7782,
        volume: 13333,
        candleClosed: true,
      },
      currentCandleStatus: "FORMING",
      priorCandleStatus: "COMPLETED",
      supportingBarTime: 1786116900,
    },
    ...overrides,
  };
}

function baseCandidate(overrides = {}) {
  return {
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    candidateId: "E26C-D3-TEST",
    zoneId: "E26Z-D3-TEST",
    symbol: "ES",
    setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
    candidateIdentityVersion: "engine26.strategy1.v1",
    ...overrides,
  };
}

function baseFast(overrides = {}) {
  return {
    active: true,
    source: "confluence.context.reaction.engine3FastImbalanceReaction",
    mode: "FAST_IMBALANCE_WATCH",
    currentBarVolume: 11796,
    priorBarVolume: 15540,
    currentVsPriorVolumeRatio: 0.76,
    relativeVolume: 0.65,
    volumeTrend: "FADING",
    highVolumeCandles: 1,
    volumeExpansion: false,
    volumeConfirmed: false,
    participationState: "WEAK_FADING_PARTICIPATION",
    participationQuality: "WEAK",
    allowed: false,
    hardBlocked: false,
    intendedDirection: "SHORT",
    usedFastReactionCandles: true,
    usedTenMinuteFallback: false,
    ...overrides,
  };
}

function build({ reaction = baseReaction(), candidate = baseCandidate(), fast = baseFast(), current = null } = {}) {
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

runTest("fresh 1m observation stays active while Engine 3 eligibility is false", () => {
  const out = build();
  assert.equal(out.participationEvaluationEligible, false);
  assert.equal(out.observerActive, true);
  assert.equal(out.observationStatus, "ACTIVE");
  assert.equal(out.observation1mActive, true);
  assert.equal(out.participationObservation, true);
  assert.equal(out.participationConfirmed, false);
  assert.equal(out.allowed, false);
});

runTest("1m source-specific volumes do not inherit tactical compatibility volumes", () => {
  const out = build();
  assert.equal(out.currentBarVolume, 11796);
  assert.equal(out.priorBarVolume, 15540);
  assert.equal(out.rawCurrentVsPriorVolumeRatio, 0.76);
  assert.equal(out.observation1mCurrentVolume, 1412);
  assert.equal(out.observation1mPriorVolume, 1772);
  assert.equal(out.observation1mVolumeRatio, 0.8);
});

runTest("1m metadata remains source-consistent", () => {
  const out = build();
  assert.equal(out.observation1mTimeframe, "1m");
  assert.equal(out.observation1mCurrentCandleStatus, "COMPLETED");
  assert.equal(out.observation1mPriorCandleStatus, "COMPLETED");
  assert.equal(out.observation1mSupportingBarTime, 1786117080);
  assert.equal(out.observation1mState, "CHOP_INSIDE_VALUE");
  assert.equal(out.observation1mDirection, "NEUTRAL");
  assert.equal(out.observation1mQuality, "MIXED");
});

runTest("1m currentVolumeReaction is classified only from 1m observation volume", () => {
  const out = build();
  assert.equal(out.currentVolumeReaction, "VOLUME_SLIGHTLY_BELOW_PRIOR");
  assert.ok(out.observationReasonCodes.includes("ENGINE4_1M_LIVE_OBSERVATION_ACTIVE"));
  assert.ok(out.observationReasonCodes.includes("VOLUME_SLIGHTLY_BELOW_PRIOR"));
});

runTest("stale 1m observation is not presented as active", () => {
  const reaction = baseReaction();
  reaction.reactionObservation1m = {
    ...reaction.reactionObservation1m,
    stale: true,
  };
  const out = build({ reaction });
  assert.equal(out.observerActive, false);
  assert.equal(out.observationStatus, "STALE");
  assert.equal(out.participationObservation, false);
  assert.equal(out.currentVolumeReaction, "VOLUME_DATA_UNAVAILABLE");
});

runTest("missing 1m observation is unavailable rather than faked from tactical data", () => {
  const out = build({ reaction: baseReaction({ reactionObservation1m: null }) });
  assert.equal(out.observerActive, false);
  assert.equal(out.observationStatus, "UNAVAILABLE");
  assert.equal(out.observation1mCurrentVolume, null);
  assert.equal(out.currentVolumeReaction, "VOLUME_DATA_UNAVAILABLE");
  assert.equal(out.currentBarVolume, 11796);
});

runTest("5m validation is surfaced verbatim", () => {
  const out = build();
  assert.equal(out.validation5mActive, true);
  assert.equal(out.validation5mState, "UNRESOLVED");
  assert.equal(out.validation5mDirection, "NEUTRAL");
  assert.equal(out.validation5mQuality, "MIXED");
  assert.equal(out.validation5mTimeframe, "5m");
  assert.equal(out.validation5mSupportingBarTime, 1786116900);
  assert.equal(out.validation5mCurrentVolume, 9227);
  assert.equal(out.validation5mPriorVolume, 13333);
  assert.equal(out.validation5mCurrentCandleStatus, "FORMING");
  assert.equal(out.validation5mPriorCandleStatus, "COMPLETED");
  assert.equal(out.validation5mStale, false);
});

runTest("5m validation does not alter 1m currentVolumeReaction", () => {
  const reaction = baseReaction();
  reaction.reactionValidation5m = {
    ...reaction.reactionValidation5m,
    validationState: "CONFLICTING",
    direction: "LONG",
    quality: "STRONG",
  };
  const out = build({ reaction });
  assert.equal(out.validation5mState, "CONFLICTING");
  assert.equal(out.currentVolumeReaction, "VOLUME_SLIGHTLY_BELOW_PRIOR");
});

runTest("10m broader context is surfaced separately from fast raw bar volume", () => {
  const out = build();
  assert.equal(out.broader10mActive, true);
  assert.equal(out.broader10mTimeframe, "10m");
  assert.equal(out.broader10mRelativeVolume, 0.65);
  assert.equal(out.broader10mVolumeTrend, "FADING");
  assert.equal(out.broader10mVolumeExpansion, false);
  assert.equal(out.broader10mVolumeConfirmed, false);
  assert.equal(out.broader10mHighVolumeCandles, 1);
  assert.equal(out.broader10mParticipationState, null);
  assert.equal(out.broader10mParticipationQuality, null);
});

runTest("fast raw currentBarVolume is never relabeled as a 10m candle", () => {
  const out = build();
  assert.equal(out.currentBarVolume, 11796);
  assert.equal(out.volumeTimeframe, "1m");
  assert.equal(out.broader10mTimeframe, "10m");
  assert.notEqual(out.observation1mCurrentVolume, out.currentBarVolume);
});

runTest("forming 1m observation is diagnostic and cannot confirm by itself", () => {
  const reaction = baseReaction();
  reaction.reactionObservation1m = {
    ...reaction.reactionObservation1m,
    candleState: "FORMING",
    currentCandleStatus: "FORMING",
    currentCandle: {
      ...reaction.reactionObservation1m.currentCandle,
      volume: 300,
      candleClosed: false,
    },
  };
  const out = build({ reaction });
  assert.equal(out.currentVolumeReaction, "FORMING_VOLUME_LIGHT");
  assert.ok(out.observationReasonCodes.includes("RAW_FORMING_VOLUME_RATIO_DIAGNOSTIC_ONLY"));
  assert.equal(out.participationConfirmed, false);
  assert.equal(out.allowed, false);
});

runTest("explicit Engine 3 ineligibility cannot be rescued by strong 1m/10m volume", () => {
  const reaction = baseReaction();
  reaction.reactionObservation1m = {
    ...reaction.reactionObservation1m,
    currentCandle: { ...reaction.reactionObservation1m.currentCandle, volume: 4000 },
    priorCandle: { ...reaction.reactionObservation1m.priorCandle, volume: 1000 },
  };
  const out = build({
    reaction,
    fast: baseFast({
      allowed: true,
      participationConfirmed: true,
      participationQuality: "STRONG",
      relativeVolume: 2,
      volumeTrend: "EXPANDING",
      volumeExpansion: true,
      volumeConfirmed: true,
    }),
  });
  assert.equal(out.currentVolumeReaction, "VOLUME_EXPANDING_STRONG");
  assert.equal(out.participationEvaluationEligible, false);
  assert.equal(out.participationConfirmed, false);
  assert.equal(out.allowed, false);
  assert.equal(out.direction, "NEUTRAL");
});

runTest("existing completed adverse participation still hard-blocks when Engine 3 gate is satisfied", () => {
  const reaction = baseReaction({
    participationEvaluationEligible: true,
    reactionConfirmed: true,
    confirmed: true,
    reactionState: "REACTION_CONFIRMED",
    authorizedReactionState: "REACTION_CONFIRMED",
    direction: "LONG",
    currentCandle: {
      time: 1786117080,
      open: 7524,
      high: 7524.25,
      low: 7500,
      close: 7502,
      volume: 9000,
      candleClosed: true,
    },
    priorCandle: {
      time: 1786117020,
      open: 7520,
      high: 7524,
      low: 7517,
      close: 7524,
      volume: 5000,
      candleClosed: true,
    },
    entryZone: { lo: 7504, hi: 7518.25 },
  });
  const out = build({
    reaction,
    fast: baseFast({
      intendedDirection: "LONG",
      volumeExpansion: true,
      absorptionRisk: true,
      supportsDirection: false,
    }),
  });
  assert.equal(out.participationState, "ADVERSE_PARTICIPATION_BLOCKED");
  assert.equal(out.hardBlocked, true);
  assert.equal(out.allowed, false);
});

runTest("candidate invalidation still hard-blocks", () => {
  const out = build({
    reaction: baseReaction({
      reactionState: "REACTION_INVALIDATED",
      invalidationFacts: { completedCloseInvalidated: true },
    }),
  });
  assert.equal(out.participationState, "CANDIDATE_INVALIDATED");
  assert.equal(out.hardBlocked, true);
  assert.equal(out.allowed, false);
});

runTest("identity mismatch still hard-blocks", () => {
  const out = build({ candidate: baseCandidate({ candidateId: "E26C-DIFFERENT" }) });
  assert.equal(out.participationState, "IDENTITY_MISMATCH");
  assert.equal(out.hardBlocked, true);
});

runTest("safety authority remains Engine 6 only", () => {
  const out = build();
  assert.equal(out.requiresEngine6Permission, true);
  assert.equal(out.requiresEngine6PaperApproval, true);
  assert.equal(out.noPermissionCreated, true);
  assert.equal(out.noRealPermissionCreated, true);
  assert.equal(out.noExecution, true);
  assert.equal(out.realExecutionAuthority, false);
  assert.equal(out.executable, false);
});

runTest("D3 does not mutate reaction or tactical inputs", () => {
  const reaction = baseReaction();
  const fast = baseFast();
  const reactionBefore = JSON.stringify(reaction);
  const fastBefore = JSON.stringify(fast);
  build({ reaction, fast });
  assert.equal(JSON.stringify(reaction), reactionBefore);
  assert.equal(JSON.stringify(fast), fastBefore);
});

runTest("plain-English output separates 1m 5m and 10m", () => {
  const out = build();
  assert.ok(out.plainEnglishLines.includes("1m: volume lighter right now."));
  assert.ok(out.plainEnglishLines.includes("5m: validation still unresolved."));
  assert.ok(out.plainEnglishLines.includes("10m: broader participation is fading."));
  assert.ok(out.plainEnglishLines.includes("Engine 4 confirmation is waiting for Engine 3 qualification."));
  assert.ok(out.plainEnglishLines.includes("No permission. No execution."));
  assert.equal(typeof out.timelinePlainEnglish, "string");
});

runTest("plain-English 10m line can report active expansion without changing confirmation", () => {
  const out = build({ fast: baseFast({ volumeTrend: "EXPANDING", relativeVolume: 1.5, volumeExpansion: true }) });
  assert.ok(out.plainEnglishLines.includes("10m: broader participation is expanding."));
  assert.equal(out.participationConfirmed, false);
  assert.equal(out.allowed, false);
});

if (process.exitCode) {
  console.error("Engine 4 Phase D3 observation-layer tests failed.");
  process.exit(process.exitCode);
}

console.log("Engine 4 Phase D3 observation-layer tests complete.");
