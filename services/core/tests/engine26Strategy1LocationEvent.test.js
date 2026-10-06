import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildStrategy1LocationEvent,
  STRATEGY1_LOCATION_EVENT_THRESHOLDS,
} from "../logic/engine26/strategy1/buildStrategy1LocationEvent.js";

import {
  buildStrategy1MemoryKey,
  updateNegotiatedZoneMemory,
} from "../logic/engine26/strategy1/updateNegotiatedZoneMemory.js";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

const IDENTITY = Object.freeze({
  candidateId: "E26C-LOCATION-EVENT-A",
  zoneId: "E26Z-LOCATION-EVENT-A",
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  symbol: "ES",
  candidateIdentityVersion: "engine26.strategy1.v2",
});

const ZONE = Object.freeze({
  low: 7754.25,
  midline: 7770,
  high: 7785.75,
});

const CANONICAL_REFERENCE = Object.freeze({
  source: "ENGINE26_MANUAL_IMBALANCE",
  sourcePath: "manualImbalanceInventory.zones[0]",
  type: "MANUAL_IMBALANCE",
  lo: 7750,
  mid: 7775,
  hi: 7800,
});

const START = "2026-08-10T10:00:00.000Z";

function bar(time, open, high, low, close, completed = true) {
  return { time, open, high, low, close, completed };
}

function sequenceBars() {
  return [
    bar("2026-08-10T10:00:00.000Z", 7799, 7801, 7798, 7800),
    bar("2026-08-10T10:10:00.000Z", 7800, 7802, 7799, 7801),
    bar("2026-08-10T10:20:00.000Z", 7801, 7801.5, 7798, 7799),
    bar("2026-08-10T10:30:00.000Z", 7799, 7800, 7794, 7797.5),
    bar("2026-08-10T10:40:00.000Z", 7797.5, 7798, 7791.5, 7792),
    bar("2026-08-10T10:50:00.000Z", 7792, 7799, 7791, 7797.5),
  ];
}

function buildEvent({
  bars = sequenceBars(),
  priorLocationEvent = null,
  identity = IDENTITY,
  entryZone = ZONE,
  referenceCandidates = [CANONICAL_REFERENCE],
  snapshotTime = "2026-08-10T11:00:00.000Z",
  lifecycleStartTime = START,
} = {}) {
  return buildStrategy1LocationEvent({
    identity,
    entryZone,
    bars10m: bars,
    priorLocationEvent,
    referenceCandidates,
    lifecycleStartTime,
    snapshotTime,
    tickSize: 0.25,
  });
}

function memoryCandidate({
  identity = IDENTITY,
  locationEvent = null,
  entryZone = ZONE,
} = {}) {
  return {
    laneId: identity.laneId,
    symbol: identity.symbol,
    strategyId: identity.strategyId,
    zoneId: identity.zoneId,
    candidateId: identity.candidateId,
    directionBias: "NEUTRAL",
    direction: "NEUTRAL",
    setupClass: "NEGOTIATED_ZONE_ROTATION",
    setupGrade: "A+++",
    identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
    candidateIdentityVersion: identity.candidateIdentityVersion,
    candidateLifecycleStartTime: START,
    entryZone,
    locationEvent,
  };
}

function emptyStore() {
  return {
    schema: "engine26.negotiatedZoneMemory.v1",
    records: {},
  };
}

test("location-event V1 thresholds are frozen", () => {
  assert.deepEqual(STRATEGY1_LOCATION_EVENT_THRESHOLDS, {
    tickSize: 0.25,
    consolidationTolerancePoints: 2,
    minimumConsolidationCompletedCandles: 3,
    minimumConsolidationQualifyingCloses: 2,
    acceptanceOffsetPoints: 2,
    rotationAwayPoints: 8,
    retestProximityPoints: 3,
    retestFailurePoints: 2,
  });
});

test("three completed candles establish consolidation with two qualifying closes", () => {
  const event = buildEvent({ bars: sequenceBars().slice(0, 3) });
  assert.equal(event.currentState, "CONSOLIDATION_AT_RESISTANCE");
  assert.equal(event.consolidation.observed, true);
  assert.equal(event.consolidation.completedCandleCount, 3);
  assert.ok(event.consolidation.qualifyingCloseCount >= 2);
  assert.equal(event.referenceLevel, 7800);
  assert.equal(event.referenceSource, "ENGINE26_MANUAL_IMBALANCE");
});

test("forming candle does not count toward consolidation", () => {
  const bars = sequenceBars().slice(0, 3);
  bars[2] = { ...bars[2], completed: false };
  const event = buildEvent({ bars });
  assert.equal(event.consolidation.observed, false);
  assert.equal(event.currentState, "NONE");
});

test("at least two qualifying completed closes are required", () => {
  const bars = [
    bar("2026-08-10T10:00:00.000Z", 7798, 7801, 7797, 7800),
    bar("2026-08-10T10:10:00.000Z", 7800, 7802, 7790, 7790),
    bar("2026-08-10T10:20:00.000Z", 7790, 7801, 7788, 7790),
  ];
  const event = buildEvent({ bars });
  assert.equal(event.consolidation.observed, false);
  assert.equal(event.consolidation.qualifyingCloseCount, 1);
});

test("event lifecycle ignores completed candles before the candidate lifecycle start", () => {
  const event = buildEvent({
    bars: sequenceBars().slice(0, 3),
    lifecycleStartTime: "2026-08-10T10:30:00.000Z",
  });
  assert.equal(event, null);
});

test("failed acceptance advances the same event", () => {
  const consolidated = buildEvent({ bars: sequenceBars().slice(0, 3) });
  const failed = buildEvent({
    bars: sequenceBars().slice(0, 4),
    priorLocationEvent: consolidated,
  });
  assert.equal(failed.eventId, consolidated.eventId);
  assert.equal(failed.currentState, "FAILED_ACCEPTANCE_AT_RESISTANCE");
  assert.equal(failed.initialFailure.observed, true);
  assert.equal(failed.initialFailure.confirmedAt, "2026-08-10T10:30:00.000Z");
});

test("eight-point rotation-away qualifies", () => {
  const event = buildEvent({ bars: sequenceBars().slice(0, 5) });
  assert.equal(event.currentState, "ROTATION_AWAY_FROM_RESISTANCE");
  assert.equal(event.initialFailure.rotationAwayObserved, true);
  assert.ok(event.initialFailure.rotationDistancePoints >= 8);
});

test("negotiated-zone reach qualifies rotation-away even before eight points", () => {
  const zone = { low: 7794, midline: 7795, high: 7796 };
  const reference = {
    source: "ENGINE1",
    sourcePath: "engine1Context.render.shelves[0]",
    type: "SHELF",
    lo: 7800,
    mid: 7800,
    hi: 7800,
  };
  const bars = [
    bar("2026-08-10T10:00:00.000Z", 7799, 7801, 7798, 7800),
    bar("2026-08-10T10:10:00.000Z", 7800, 7802, 7799, 7801),
    bar("2026-08-10T10:20:00.000Z", 7801, 7801, 7798, 7799),
    bar("2026-08-10T10:30:00.000Z", 7799, 7800, 7796, 7797.5),
    bar("2026-08-10T10:40:00.000Z", 7797.5, 7798, 7795.75, 7796),
  ];
  const event = buildEvent({ bars, entryZone: zone, referenceCandidates: [reference] });
  assert.equal(event.initialFailure.rotationAwayObserved, true);
  assert.equal(event.initialFailure.reachedZone, true);
  assert.ok(event.initialFailure.rotationDistancePoints < 8);
});

test("negotiated-midline reach qualifies and is recorded", () => {
  const bars = sequenceBars().slice(0, 5);
  bars[4] = { ...bars[4], low: 7769.75, close: 7770 };
  const event = buildEvent({ bars });
  assert.equal(event.initialFailure.rotationAwayObserved, true);
  assert.equal(event.initialFailure.reachedZone, true);
  assert.equal(event.initialFailure.reachedMidline, true);
});

test("return within three points becomes a retest of the same event", () => {
  const rotated = buildEvent({ bars: sequenceBars().slice(0, 5) });
  const retestBars = sequenceBars().slice(0, 5).concat([
    bar("2026-08-10T10:50:00.000Z", 7792, 7797.25, 7791, 7798.5, false),
  ]);
  const retest = buildEvent({ bars: retestBars, priorLocationEvent: rotated });
  assert.equal(retest.eventId, rotated.eventId);
  assert.equal(retest.currentState, "PULLBACK_RETEST_OF_RESISTANCE");
  assert.equal(retest.pullbackRetest.observed, true);
  assert.equal(retest.pullbackRetest.status, "ACTIVE");
});

test("retest does not create a second independent event", () => {
  const rotated = buildEvent({ bars: sequenceBars().slice(0, 5) });
  const retested = buildEvent({ bars: sequenceBars(), priorLocationEvent: rotated });
  assert.equal(retested.eventId, rotated.eventId);
  assert.equal(retested.candidateId, rotated.candidateId);
  assert.equal(retested.zoneId, rotated.zoneId);
});

test("completed two-point retreat confirms retest failure", () => {
  const event = buildEvent();
  assert.equal(event.currentState, "PULLBACK_FAILED_AT_RESISTANCE");
  assert.equal(event.pullbackRetest.status, "FAILED");
  assert.equal(event.pullbackRetest.failureClose, 7797.5);
});

test("return below zone high is recorded as stronger failure evidence", () => {
  const bars = sequenceBars().slice(0, 5).concat([
    bar("2026-08-10T10:50:00.000Z", 7792, 7799, 7791, 7784),
  ]);
  const event = buildEvent({ bars });
  assert.equal(event.pullbackRetest.status, "FAILED");
  assert.equal(event.pullbackRetest.closedBelowZoneHigh, true);
  assert.equal(event.pullbackRetest.strongFailureObserved, true);
});

test("two consecutive completed closes above reference plus two invalidate defended resistance", () => {
  const bars = sequenceBars().slice(0, 3).concat([
    bar("2026-08-10T10:30:00.000Z", 7801, 7804, 7801, 7802.25),
    bar("2026-08-10T10:40:00.000Z", 7802.25, 7805, 7802, 7803),
  ]);
  const event = buildEvent({ bars });
  assert.equal(event.currentState, "RESISTANCE_ACCEPTED_ABOVE");
  assert.equal(event.invalidated, true);
  assert.equal(event.active, false);
  assert.equal(event.consolidation.sustainedAcceptanceAbove, true);
});

test("forming acceptance candle cannot complete resistance acceptance", () => {
  const bars = sequenceBars().slice(0, 3).concat([
    bar("2026-08-10T10:30:00.000Z", 7801, 7804, 7801, 7802.25),
    bar("2026-08-10T10:40:00.000Z", 7802.25, 7805, 7802, 7803, false),
  ]);
  const event = buildEvent({ bars });
  assert.notEqual(event.currentState, "RESISTANCE_ACCEPTED_ABOVE");
  assert.equal(event.invalidated, false);
});

test("forming retest candle cannot confirm retest failure", () => {
  const rotated = buildEvent({ bars: sequenceBars().slice(0, 5) });
  const bars = sequenceBars().slice(0, 5).concat([
    bar("2026-08-10T10:50:00.000Z", 7792, 7799, 7791, 7797.5, false),
  ]);
  const event = buildEvent({ bars, priorLocationEvent: rotated });
  assert.equal(event.currentState, "PULLBACK_RETEST_OF_RESISTANCE");
  assert.equal(event.pullbackRetest.status, "ACTIVE");
});

test("canonical reference is preferred over derived repeated-candle cluster", () => {
  const event = buildEvent();
  assert.equal(event.referenceLevel, 7800);
  assert.equal(event.referenceSource, "ENGINE26_MANUAL_IMBALANCE");
  assert.equal(event.referenceDerivation, "CANONICAL_LOCATION_REFERENCE");
});

test("derived completed-candle cluster is explicit fallback when no canonical reference exists", () => {
  const event = buildEvent({ referenceCandidates: [] });
  assert.ok(event);
  assert.equal(event.referenceSource, "ENGINE26_DERIVED_COMPLETED_10M_CLUSTER");
  assert.equal(event.referenceDerivation, "REPEATED_COMPLETED_10M_CLUSTER");
});

test("historical event survives later snapshot with no repeated original sequence", () => {
  const completed = buildEvent();
  const later = buildEvent({
    bars: [bar("2026-08-10T11:10:00.000Z", 7780, 7785, 7778, 7784)],
    priorLocationEvent: completed,
    snapshotTime: "2026-08-10T11:20:00.000Z",
  });
  assert.equal(later.eventId, completed.eventId);
  assert.equal(later.currentState, "PULLBACK_FAILED_AT_RESISTANCE");
  assert.equal(later.pullbackRetest.status, "FAILED");
});

test("memory persistence and restoration preserve the location event", () => {
  const event = buildEvent();
  const memoryKey = buildStrategy1MemoryKey({
    laneId: IDENTITY.laneId,
    symbol: IDENTITY.symbol,
    strategyId: IDENTITY.strategyId,
    zoneId: IDENTITY.zoneId,
  });

  const first = updateNegotiatedZoneMemory({
    store: emptyStore(),
    memoryKey,
    candidate: memoryCandidate({ locationEvent: event }),
    facts: {},
    snapshotTime: "2026-08-10T11:00:00.000Z",
  });

  const restored = first.record.locationEvent;
  assert.equal(restored.eventId, event.eventId);
  assert.equal(restored.currentState, "PULLBACK_FAILED_AT_RESISTANCE");

  const rebuilt = buildEvent({
    bars: [bar("2026-08-10T11:10:00.000Z", 7780, 7785, 7778, 7784)],
    priorLocationEvent: restored,
    snapshotTime: "2026-08-10T11:20:00.000Z",
  });
  assert.equal(rebuilt.eventId, event.eventId);
  assert.equal(rebuilt.currentState, event.currentState);
});

test("later bullish-style price evidence does not erase historical event", () => {
  const event = buildEvent();
  const later = buildEvent({
    bars: [
      bar("2026-08-10T11:10:00.000Z", 7775, 7790, 7774, 7789),
    ],
    priorLocationEvent: event,
    snapshotTime: "2026-08-10T11:20:00.000Z",
  });
  assert.equal(later.currentState, "PULLBACK_FAILED_AT_RESISTANCE");
  assert.equal(later.historicalDirection, "DOWN");
});

test("new candidate does not inherit prior candidate event", () => {
  const oldEvent = buildEvent();
  const identity = { ...IDENTITY, candidateId: "E26C-LOCATION-EVENT-B" };
  const fresh = buildEvent({
    identity,
    bars: sequenceBars().slice(0, 3),
    priorLocationEvent: oldEvent,
  });
  assert.notEqual(fresh.eventId, oldEvent.eventId);
  assert.equal(fresh.candidateId, identity.candidateId);
});

test("new zone does not inherit old zone event", () => {
  const oldEvent = buildEvent();
  const identity = { ...IDENTITY, zoneId: "E26Z-LOCATION-EVENT-B" };
  const zone = { low: 7755, midline: 7771, high: 7786 };
  const fresh = buildEvent({
    identity,
    entryZone: zone,
    bars: sequenceBars().slice(0, 3),
    priorLocationEvent: oldEvent,
  });
  assert.notEqual(fresh.eventId, oldEvent.eventId);
  assert.equal(fresh.zoneId, identity.zoneId);
});

test("candidate identity version mismatch prevents inheritance", () => {
  const oldEvent = buildEvent();
  const identity = { ...IDENTITY, candidateIdentityVersion: "engine26.strategy1.v3" };
  const fresh = buildEvent({
    identity,
    bars: sequenceBars().slice(0, 3),
    priorLocationEvent: oldEvent,
  });
  assert.notEqual(fresh.eventId, oldEvent.eventId);
  assert.equal(fresh.candidateIdentityVersion, "engine26.strategy1.v3");
});

test("memory does not attach old event to a different candidate on the same zone", () => {
  const event = buildEvent();
  const memoryKey = buildStrategy1MemoryKey({
    laneId: IDENTITY.laneId,
    symbol: IDENTITY.symbol,
    strategyId: IDENTITY.strategyId,
    zoneId: IDENTITY.zoneId,
  });
  const first = updateNegotiatedZoneMemory({
    store: emptyStore(),
    memoryKey,
    candidate: memoryCandidate({ locationEvent: event }),
    facts: {},
    snapshotTime: "2026-08-10T11:00:00.000Z",
  });
  const nextIdentity = { ...IDENTITY, candidateId: "E26C-NEW-SAME-ZONE" };
  const second = updateNegotiatedZoneMemory({
    store: first.store,
    memoryKey,
    candidate: memoryCandidate({ identity: nextIdentity, locationEvent: null }),
    facts: {},
    snapshotTime: "2026-08-10T11:10:00.000Z",
  });
  assert.equal(second.record.locationEvent, null);
});

test("location event creates no direction, participation, permission, or execution authority", () => {
  const event = buildEvent();
  assert.equal(event.historicalDirection, "DOWN");
  assert.equal(event.noDirectionCreated, true);
  assert.equal(event.noParticipationCreated, true);
  assert.equal(event.noPermissionCreated, true);
  assert.equal(event.noExecution, true);
  assert.equal(Object.hasOwn(event, "direction"), false);
  assert.equal(Object.hasOwn(event, "permission"), false);
});

function longLowerFactsBars() {
  return [
    bar("2026-08-10T08:00:00.000Z", 7440, 7452, 7431, 7450.5),
    bar("2026-08-10T08:10:00.000Z", 7450.5, 7452, 7437.5, 7444),
  ];
}

function eventBarsAt7525() {
  return [
    bar("2026-08-10T09:00:00.000Z", 7524, 7526, 7523, 7525),
    bar("2026-08-10T09:10:00.000Z", 7525, 7527, 7524, 7526),
    bar("2026-08-10T09:20:00.000Z", 7526, 7526.5, 7523, 7524),
    bar("2026-08-10T09:30:00.000Z", 7524, 7525, 7519, 7522.5),
    bar("2026-08-10T09:40:00.000Z", 7522.5, 7523, 7511, 7512),
    bar("2026-08-10T09:50:00.000Z", 7512, 7524, 7511, 7522.5),
  ];
}

test("integrated neutral negotiated-line contact stays neutral while carrying historical event context", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine26-location-event-neutral-"));
  const manualZonesFilePath = path.join(tempDir, "es-smz-manual-zones.txt");
  const memoryFilePath = path.join(tempDir, "negotiated-zone-memory.json");

  try {
    fs.writeFileSync(
      manualZonesFilePath,
      [
        "7419.75-7473.50 | NEG 7433.75-7457.50",
        "7490.00-7525.00 | NEG 7504.00-7518.25",
        "",
      ].join("\n"),
      "utf8"
    );

    const lower = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: 7445.75,
      snapshotTime: "2026-08-10T08:20:00.000Z",
      engine22WaveStrategy: {
        currentLifecycleState: { key: "MINUTE_ROTATION_WATCH", direction: "DOWN" },
        waveOpportunity: { setupType: "MINUTE_ROTATION_WATCH", direction: "DOWN" },
        degreeStates: { minute: { stage: "C_COMPLETION_WATCH", direction: "DOWN" } },
      },
      bars10m: longLowerFactsBars(),
      ema10Posture: "BULLISH",
      manualZonesFilePath,
      memoryFilePath,
      persistMemory: true,
      tickSize: 0.25,
      activationRangePoints: 4,
      monitoringRangePoints: 25,
    }).engine26LocationCandidate;

    const promotedResult = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: lower.targetZone.midline,
      snapshotTime: "2026-08-10T08:30:00.000Z",
      engine22WaveStrategy: {
        currentLifecycleState: { key: "MINUTE_ROTATION_WATCH", direction: "DOWN" },
        waveOpportunity: { setupType: "MINUTE_ROTATION_WATCH", direction: "DOWN" },
        degreeStates: { minute: { stage: "C_COMPLETION_WATCH", direction: "DOWN" } },
      },
      previousLocationCandidate: lower,
      bars10m: [],
      manualZonesFilePath,
      memoryFilePath,
      persistMemory: true,
      tickSize: 0.25,
      activationRangePoints: 4,
      monitoringRangePoints: 25,
    });

    const promoted = promotedResult.engine26LocationCandidate;
    assert.equal(promoted.direction, "NEUTRAL");
    assert.equal(promoted.directionState, "NEUTRAL");
    assert.equal(promoted.contactState, "NEGOTIATED_LINE_CONTACT");
    assert.equal(promoted.chainArmed, true);

    const withEvent = buildEngine26A({
      symbol: "ES",
      strategyId: "intraday_scalp@10m",
      timeframe: "10m",
      currentPrice: 7522.5,
      snapshotTime: "2026-08-10T10:00:00.000Z",
      engine22WaveStrategy: {
        currentLifecycleState: { key: "MINUTE_ROTATION_WATCH", direction: "DOWN" },
        waveOpportunity: { setupType: "MINUTE_ROTATION_WATCH", direction: "DOWN" },
        degreeStates: { minute: { stage: "C_COMPLETION_WATCH", direction: "DOWN" } },
      },
      previousLocationCandidate: promoted,
      bars10m: eventBarsAt7525(),
      manualZonesFilePath,
      memoryFilePath,
      persistMemory: true,
      tickSize: 0.25,
      activationRangePoints: 4,
      monitoringRangePoints: 25,
    });

    const candidate = withEvent.engine26LocationCandidate;
    const handoff = withEvent.engine26ReactionHandoff;

    assert.equal(candidate.direction, "NEUTRAL");
    assert.equal(candidate.tradeDirectionBias, "NEUTRAL");
    assert.equal(candidate.directionState, "NEUTRAL");
    assert.equal(candidate.expectedReactionDirection, null);
    assert.equal(candidate.expectedReversalDirection, null);
    assert.deepEqual(candidate.expectedReactions, []);
    assert.equal(candidate.reactionExpected, false);
    assert.equal(candidate.automaticDirectionFlip, false);

    assert.equal(handoff.direction, "NEUTRAL");
    assert.equal(handoff.directionState, "NEUTRAL");
    assert.equal(handoff.expectedReactionDirection, null);
    assert.equal(handoff.expectedReversalDirection, null);
    assert.deepEqual(handoff.expectedReactions, []);
    assert.equal(handoff.reactionExpected, false);
    assert.equal(handoff.authorizeEngine3Evaluation, true);
    assert.equal(handoff.active, true);
    assert.equal(handoff.armed, true);
    assert.equal(handoff.observerActive, true);

    assert.ok(candidate.locationEvent);
    assert.equal(candidate.locationEvent.currentState, "PULLBACK_FAILED_AT_RESISTANCE");
    assert.ok(handoff.locationEventContext);
    assert.equal(handoff.locationEventContext.retestStatus, "FAILED");
    assert.equal(handoff.locationEventContext.historicalDirection, "DOWN");
    assert.equal(handoff.noPermissionCreated, true);
    assert.equal(handoff.noExecution, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Phase 0 no-location observer semantics remain unchanged", () => {
  const result = buildEngine26A({
    symbol: "ES",
    strategyId: "intraday_scalp@10m",
    timeframe: "10m",
    currentPrice: null,
    snapshotTime: "2026-08-10T11:30:00.000Z",
  });
  const handoff = result.engine26ReactionHandoff;
  assert.equal(handoff.observerActive, true);
  assert.equal(handoff.active, false);
  assert.equal(handoff.armed, false);
  assert.equal(handoff.evaluationContextValid, false);
  assert.equal(handoff.authorizeEngine3Evaluation, false);
});
