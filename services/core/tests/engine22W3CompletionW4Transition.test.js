// services/core/tests/engine22W3CompletionW4Transition.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMinuteW3W4TransitionModel,
} from "../logic/engine22/wave/analyzeWaveStack.js";
import { buildDegreeStates } from "../logic/engine22/wave/buildDegreeStates.js";

const T0 = 1_786_000_000;

function bar(offsetMinutes, { high, low, close }) {
  return {
    time: T0 + offsetMinutes * 60,
    high,
    low,
    close,
  };
}

function minuteStructure() {
  return {
    active: true,
    tf: "10m",
    direction: "UP",
    activeWave: "W3",
    stage: "EXTENSION_MATURITY_WATCH",
    currentRead: "MINUTE_W3_ACTIVE_FROM_7427_75_EXTENSION_MATURITY_WATCH",
    marks: {
      W1: {
        low: { price: 7352, time: T0 - 7200 },
        high: { price: 7518.25, time: T0 - 3600 },
        status: "CONFIRMED",
      },
      W2: {
        price: 7427.75,
        time: T0,
        status: "CONFIRMED",
      },
      W3: {
        price: null,
        time: null,
        status: "ACTIVE",
      },
    },
    targetModel: {
      projectionBase: 7427.75,
      levels: {
        e100: 7594,
        e1272: 7639.22,
        e1618: 7696.74,
        e200: 7760.25,
        e2618: 7862.99,
      },
    },
    internalStructure: {
      active: true,
      parentDegree: "minute",
      parentWave: "W3",
      previousInternalWave: "ii",
      currentInternalWave: "iii",
      nextExpectedInternalWave: "iv",
      internalLegDirection: "UP",
      parentWaveDirection: "LONG",
      classification: "FAST_IMPULSE_EXTENSION",
      parentWaveStillValid: true,
      parentWaveComplete: false,
      parentTransitionPossible: false,
      invalidationLevel: 7427.75,
      supportLevel: 7696.74,
    },
    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,
  };
}

function baseBars() {
  return [
    bar(0, { high: 7450, low: 7427.75, close: 7445 }),
    bar(10, { high: 7540, low: 7440, close: 7525 }),
    bar(20, { high: 7630, low: 7515, close: 7615 }),
    bar(30, { high: 7705, low: 7605, close: 7698 }),
    bar(40, { high: 7780, low: 7688, close: 7774 }),
  ];
}

function bearishReactionContext() {
  return {
    paperScalpReaction: {
      direction: "SHORT",
      state: "LOST_LEVEL",
      reactionConfirmed: true,
    },
  };
}

function bullishReactionContext() {
  return {
    paperScalpReaction: {
      direction: "LONG",
      state: "RECLAIMED_LEVEL",
      reactionConfirmed: true,
    },
  };
}

function bearishVolumeContext() {
  return {
    engine4AuthorizedReactionParticipation: {
      direction: "SHORT",
      participationConfirmed: true,
      participationQuality: "CONFIRMED",
    },
  };
}

function bullishVolumeContext() {
  return {
    engine4AuthorizedReactionParticipation: {
      direction: "LONG",
      participationConfirmed: true,
      participationQuality: "CONFIRMED",
    },
  };
}

function buildModel({
  bars,
  currentPrice,
  reactionContext = null,
  volumeContext = null,
  nowOffsetMinutes = 120,
} = {}) {
  return buildMinuteW3W4TransitionModel({
    symbol: "ES",
    minuteStructure: minuteStructure(),
    bars10m: bars,
    currentPrice,
    reactionContext,
    volumeContext,
    currentTimeSec: T0 + nowOffsetMinutes * 60,
  });
}

test("Minute W3 internal iii extension produces a revisable W3 high candidate from completed 10m bars", () => {
  const model = buildModel({
    bars: baseBars(),
    currentPrice: 7774,
  });

  assert.equal(model.state, "W3_HIGH_CANDIDATE_FORMING");
  assert.equal(model.w3HighCandidate, 7780);
  assert.equal(model.w3HighCandidateStatus, "ACTIVE_CANDIDATE");
  assert.equal(model.currentInternalWave, "iii");
  assert.equal(model.nextExpectedInternalWave, "iv");
  assert.equal(model.parentWaveComplete, false);
  assert.equal(model.parentTransitionPossible, false);
});

test("forming 10m high is diagnostic only and cannot replace the completed-candle candidate", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7810, low: 7760, close: 7805 }),
  ];

  const model = buildMinuteW3W4TransitionModel({
    symbol: "ES",
    minuteStructure: minuteStructure(),
    bars10m: bars,
    currentPrice: 7805,
    currentTimeSec: T0 + 55 * 60,
  });

  assert.equal(model.w3HighCandidate, 7780);
  assert.equal(model.state, "W3_HIGH_CANDIDATE_FORMING");
});

test("W3 high candidate revises upward when a later completed 10m candle makes a higher high", () => {
  const first = buildModel({
    bars: baseBars(),
    currentPrice: 7774,
  });

  const revisedBars = [
    ...baseBars(),
    bar(50, { high: 7792.25, low: 7765, close: 7788 }),
  ];
  const revised = buildModel({
    bars: revisedBars,
    currentPrice: 7788,
  });

  assert.equal(first.w3HighCandidate, 7780);
  assert.equal(revised.w3HighCandidate, 7792.25);
  assert.ok(
    revised.supersededCandidates.some(
      (candidate) => candidate.price === 7780 && candidate.status === "SUPERSEDED"
    )
  );
});

test("first confirmed pullback after W3 high is internal iv, not parent W4", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7776, low: 7738, close: 7745 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7745,
  });

  assert.equal(model.state, "INTERNAL_IV_PULLBACK_ACTIVE");
  assert.equal(model.currentInternalWave, "iv");
  assert.equal(model.nextExpectedInternalWave, "v");
  assert.equal(model.parentWaveComplete, false);
  assert.equal(model.parentTransitionPossible, false);
});

test("internal iv hold/reclaim requires retracement support plus Engine 3 and Engine 4 bullish confirmation", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7770, low: 7685, close: 7698 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7698,
    reactionContext: bullishReactionContext(),
    volumeContext: bullishVolumeContext(),
  });

  assert.equal(model.state, "INTERNAL_IV_HOLD_RECLAIM_WATCH");
  assert.equal(model.currentInternalWave, "iv");
  assert.equal(model.nextExpectedInternalWave, "v");
  assert.equal(model.parentWaveComplete, false);
});

test("internal v continuation remains inside parent W3 and points to W4 only as the next parent wave", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7720, low: 7680, close: 7690 }),
    bar(60, { high: 7735, low: 7685, close: 7715 }),
    bar(70, { high: 7760, low: 7700, close: 7740 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7740,
    reactionContext: bullishReactionContext(),
    volumeContext: bullishVolumeContext(),
  });

  assert.equal(model.state, "INTERNAL_V_CONTINUATION_WATCH");
  assert.equal(model.currentInternalWave, "v");
  assert.equal(model.nextExpectedInternalWave, null);
  assert.equal(model.nextExpectedParentWave, "W4");
  assert.equal(model.parentWaveComplete, false);
  assert.equal(model.parentTransitionPossible, false);
});

test("W3 completion candidate does not become parent W4 without Engine 4 participation confirmation", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7772, low: 7740, close: 7748 }),
    bar(60, { high: 7758, low: 7710, close: 7718 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7718,
    reactionContext: bearishReactionContext(),
    volumeContext: null,
  });

  assert.equal(model.state, "W3_COMPLETION_CANDIDATE");
  assert.equal(model.parentWaveComplete, false);
  assert.equal(model.parentTransitionPossible, false);
});

test("bearish reaction plus participation and broken post-high structure makes parent W4 transition possible", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7772, low: 7740, close: 7748 }),
    bar(60, { high: 7758, low: 7710, close: 7718 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7718,
    reactionContext: bearishReactionContext(),
    volumeContext: bearishVolumeContext(),
  });

  assert.equal(model.state, "PARENT_W4_TRANSITION_POSSIBLE");
  assert.equal(model.parentWaveComplete, false);
  assert.equal(model.parentTransitionPossible, true);
  assert.equal(model.nextExpectedParentWave, "W4");
});

test("confirmed multi-bar down structure promotes parent W4 active candidate and completes parent W3", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7772, low: 7740, close: 7748 }),
    bar(60, { high: 7758, low: 7710, close: 7718 }),
    bar(70, { high: 7738, low: 7688, close: 7698 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7698,
    reactionContext: bearishReactionContext(),
    volumeContext: bearishVolumeContext(),
  });

  assert.equal(model.state, "PARENT_W4_ACTIVE_CANDIDATE");
  assert.equal(model.parentWaveComplete, true);
  assert.equal(model.parentTransitionPossible, true);
  assert.equal(model.nextExpectedParentWave, "W4");
  assert.equal(model.w3HighCandidateStatus, "CONFIRMED");
});



test("strong canonical completed-10m structure can confirm parent W4 without downstream reaction/participation", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7772, low: 7746, close: 7750 }),
    bar(60, { high: 7762, low: 7738, close: 7742 }),
    bar(70, { high: 7756, low: 7728, close: 7734 }),
    bar(80, { high: 7748, low: 7718, close: 7724 }),
    bar(90, { high: 7742, low: 7710, close: 7718 }),
    bar(100, { high: 7736, low: 7704, close: 7712 }),
    bar(110, { high: 7732, low: 7698, close: 7708 }),
    bar(120, { high: 7728, low: 7694, close: 7704 }),
    bar(130, { high: 7724, low: 7690, close: 7700 }),
    bar(140, { high: 7720, low: 7686, close: 7696 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7696,
    reactionContext: null,
    volumeContext: null,
    nowOffsetMinutes: 160,
  });

  assert.equal(model.state, "PARENT_W4_ACTIVE_CANDIDATE");
  assert.equal(model.parentWaveComplete, true);
  assert.equal(model.parentTransitionPossible, true);
  assert.equal(model.evidence.strongParentW4Structure, true);
  assert.equal(model.evidence.structuralTransitionAuthority, "CANONICAL_10M_STRUCTURE");
  assert.equal(model.evidence.engine3BearishReactionConfirmed, false);
  assert.equal(model.evidence.engine4BearishParticipationConfirmed, false);
});

test("W4 retracement map is anchored at W2 low and W3 high candidate with ES tick rounding", () => {
  const model = buildModel({
    bars: baseBars(),
    currentPrice: 7746,
  });

  const map = model.w4RetracementMap;
  assert.equal(map.w2Low, 7427.75);
  assert.equal(map.w3HighCandidate, 7780);
  assert.equal(map.range, 352.25);

  for (const key of ["r236", "r382", "r500", "r618", "r786"]) {
    assert.equal((map[key] * 4) % 1, 0, `${key} must be normalized to a 0.25 ES tick`);
  }

  assert.equal(typeof map.currentRetracementRatio, "number");
  assert.equal(typeof map.currentRetracementPercent, "number");
  assert.match(map.currentRetracementDisplay, /%$/);
  assert.ok(map.nearestRetracement);
  assert.ok("nextRetracementBelow" in map);
  assert.ok(map.zoneState);
});

test("degreeStates publishes new W3/W4 fields without removing the existing compatibility contract", () => {
  const structure = minuteStructure();
  structure.stage = "PARENT_W4_TRANSITION_POSSIBLE";
  structure.w3HighCandidate = 7780;
  structure.w3HighCandidateStatus = "ACTIVE_CANDIDATE";
  structure.w4PullbackState = "PARENT_W4_TRANSITION_POSSIBLE";
  structure.nextExpectedParentWave = "W4";
  structure.w4RetracementMap = {
    w2Low: 7427.75,
    w3HighCandidate: 7780,
    r236: 7696.75,
    r382: 7645.5,
    r500: 7604,
    r618: 7562.25,
    r786: 7503,
  };
  structure.internalStructure = {
    ...structure.internalStructure,
    currentInternalWave: "v",
    nextExpectedInternalWave: null,
    nextExpectedParentWave: "W4",
    parentWaveComplete: false,
    parentTransitionPossible: true,
  };

  const degreeStates = buildDegreeStates({
    activeStructures: { minute: structure },
    currentPrice: 7698,
  });
  const minute = degreeStates.minute;

  assert.equal(minute.activeWave, "W3");
  assert.equal(minute.stage, "PARENT_W4_TRANSITION_POSSIBLE");
  assert.equal(minute.currentRead, "MINUTE_W3_ACTIVE_FROM_7427_75_EXTENSION_MATURITY_WATCH");
  assert.equal(minute.w3HighCandidate, 7780);
  assert.equal(minute.w3HighCandidateStatus, "ACTIVE_CANDIDATE");
  assert.equal(minute.w4PullbackState, "PARENT_W4_TRANSITION_POSSIBLE");
  assert.equal(minute.nextExpectedParentWave, "W4");
  assert.equal(minute.internalStructure.currentInternalWave, "v");
  assert.equal(minute.internalStructure.parentWaveComplete, false);
  assert.equal(minute.internalStructure.parentTransitionPossible, true);
  assert.ok(minute.targetModel);
  assert.equal(minute.noExecution, true);
  assert.equal(minute.noPermissionCreated, true);
  assert.equal(minute.paperTradeCandidate, false);
});

test("transition model is structural only and never creates execution, permission, sizing, tickets, broker calls, or journal events", () => {
  const bars = [
    ...baseBars(),
    bar(50, { high: 7772, low: 7740, close: 7748 }),
    bar(60, { high: 7758, low: 7710, close: 7718 }),
    bar(70, { high: 7738, low: 7688, close: 7698 }),
  ];

  const model = buildModel({
    bars,
    currentPrice: 7698,
    reactionContext: bearishReactionContext(),
    volumeContext: bearishVolumeContext(),
  });

  assert.equal(model.noExecution, true);
  assert.equal(model.noPermissionCreated, true);
  assert.equal(model.watchOnly, true);
  assert.equal("allowed" in model, false);
  assert.equal("executable" in model, false);
  assert.equal("sizing" in model, false);
  assert.equal("ticket" in model, false);
  assert.equal("brokerCall" in model, false);
  assert.equal("journalEvent" in model, false);
});
