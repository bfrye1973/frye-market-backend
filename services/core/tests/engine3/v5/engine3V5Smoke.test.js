// services/core/tests/engine3/v5/engine3V5Smoke.test.js
import assert from "node:assert/strict";

import { normalizeNegotiatedZone } from "../../../logic/engine3/v5/zone/normalizeNegotiatedZone.js";
import { build1mEvidence } from "../../../logic/engine3/v5/timeframe/build1mEvidence.js";
import { build5mReaction } from "../../../logic/engine3/v5/timeframe/build5mReaction.js";
import { build10mContext } from "../../../logic/engine3/v5/timeframe/build10mContext.js";
import { runDirectionStateMachine } from "../../../logic/engine3/v5/state/directionStateMachine.js";
import { resolveDepartureState } from "../../../logic/engine3/v5/state/departureState.js";
import { resolveEma10TravelState } from "../../../logic/engine3/v5/state/ema10TravelState.js";

const zone = {
  id: "TEST_ZONE_1",
  zoneId: "TEST_ZONE_1",
  type: "NEGOTIATED",
  timeframe: "10m",
  low: 100,
  high: 110,
  midline: 105,
};

const candidate = {
  active: true,
  candidateId: "TEST_CANDIDATE_1",
  zoneId: "TEST_ZONE_1",
  laneId: "minute",
  symbol: "ES",
  strategyId: "intraday_scalp@10m",
  timeframe: "10m",
  currentPrice: 105,
  candidateIdentityVersion: "engine26.strategy1.v2",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  entryZone: zone,

  // Deliberately LONG so seller-control tests prove
  // Engine 26 directional opinion is not canonical authority.
  direction: "LONG",
  directionBias: "LONG",
  preferredDirection: "LONG",
};

const handoff = {
  active: true,
  candidateActive: true,
  candidateIdentityValid: true,
  strategyContextValid: true,
  terminalLifecycle: false,
  authorizeEngine3Evaluation: true,
  candidateId: "TEST_CANDIDATE_1",
  zoneId: "TEST_ZONE_1",
  laneId: "minute",
  symbol: "ES",
  strategyId: "intraday_scalp@10m",
  timeframe: "10m",
  candidateIdentityVersion: "engine26.strategy1.v2",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  identitySetupKey: "NEGOTIATED_ZONE_ROTATION",
  entryZone: zone,
  direction: "LONG",
  preferredDirection: "LONG",
  tradeDirectionBias: "LONG",
  expectedReactionDirection: "LONG",
};

const zoneInput = normalizeNegotiatedZone({
  engine26LocationCandidate: candidate,
  engine26ReactionHandoff: handoff,
});

assert.equal(zoneInput.eligible, true);

function bars(tfSec, rows, start = 1788550000) {
  return rows.map((r, i) => ({
    time: start + i * tfSec,
    open: r[0],
    high: r[1],
    low: r[2],
    close: r[3],
    volume: r[4] ?? 1000,
  }));
}

function evalAfterAll(b, tfSec) {
  return (b.at(-1).time + tfSec + 60) * 1000;
}

function seller5m() {
  return bars(300, [
    [112, 113, 111, 112],
    [111.5, 112, 108, 109],
    [109, 110, 105, 106],
    [106, 107, 102, 103],
    [103, 104, 98, 99],
  ]);
}

function buyer5m() {
  return bars(300, [
    [98, 99, 97, 98],
    [98.5, 102, 98, 101],
    [101, 106, 100, 105],
    [105, 109, 104, 108],
    [108, 112, 107, 111],
  ], 1788555000);
}

function mixed5mHandoff() {
  return {
    eligible: true,
    completedOnly: true,
    controlState: "CONTESTED",
    controlConfidence: "MIXED",
    quality: "MIXED",
    matureControlResolved: false,
    mixedControlResolved: true,
  };
}

function pass(n, label) {
  console.log(`PASS ${n}: ${label}`);
}

// 1. Completed 5m seller control establishes SHORT from NEUTRAL.
{
  const b = seller5m();
  const f = build5mReaction({
    bars: b,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(b, 300),
  });

  assert.equal(f.stateMachineHandoff.controlState, "SELLERS_CONTROL");
  assert.equal(f.stateMachineHandoff.canonicalDirection, null);

  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    completed5mHandoff: f.stateMachineHandoff,
    previousCanonical: {
      direction: "NEUTRAL",
      candidateId: "TEST_CANDIDATE_1",
    },
  });

  assert.equal(s.direction, "SHORT");
  assert.equal(s.establishedNow, true);
  pass(1, "completed 5m SELLERS_CONTROL -> SHORT");
}

// 2. Completed 5m buyer control establishes LONG from NEUTRAL.
{
  const b = buyer5m();
  const f = build5mReaction({
    bars: b,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(b, 300),
  });

  assert.equal(f.stateMachineHandoff.controlState, "BUYERS_CONTROL");

  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    completed5mHandoff: f.stateMachineHandoff,
    previousCanonical: {
      direction: "NEUTRAL",
      candidateId: "TEST_CANDIDATE_1",
    },
  });

  assert.equal(s.direction, "LONG");
  pass(2, "completed 5m BUYERS_CONTROL -> LONG");
}

// 3. Forming 5m may look opposite but cannot change completed handoff.
{
  const completed = buyer5m();
  const evaluationTimeMs = evalAfterAll(completed, 300);
  const formingTime = Math.floor(evaluationTimeMs / 1000) - 60;

  const f = build5mReaction({
    bars: [
      ...completed,
      {
        time: formingTime,
        open: 111,
        high: 111.25,
        low: 103,
        close: 104,
        volume: 2500,
      },
    ],
    normalizedZoneInput: zoneInput,
    evaluationTimeMs,
  });

  assert.equal(f.forming5mAuthorizedForStateMachine, false);
  assert.equal(f.completed5mAuthorizedForStateMachine, true);
  assert.equal(f.stateMachineHandoff.controlState, "BUYERS_CONTROL");

  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    completed5mHandoff: f.stateMachineHandoff,
    previousCanonical: {
      direction: "LONG",
      candidateId: "TEST_CANDIDATE_1",
    },
  });

  assert.equal(s.direction, "LONG");
  pass(3, "forming 5m cannot flip canonical");
}

// 4. 1m is diagnostic only.
{
  const b = bars(60, [
    [111, 111.5, 109, 109.5],
    [109.5, 110, 106, 107],
    [107, 108, 103, 104],
    [104, 105, 101, 102],
    [102, 103, 98, 99],
  ], 1788560000);

  const e = build1mEvidence({
    bars: b,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(b, 60),
  });

  assert.equal(e.canonicalAuthority, false);
  assert.equal(e.canCreateCanonicalDirection, false);
  assert.equal(e.canFlipCanonicalDirection, false);
  assert.equal(Object.hasOwn(e, "direction"), false);
  pass(4, "1m remains diagnostic only");
}

// 5. CONTESTED does not manufacture a flip.
{
  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    completed5mHandoff: mixed5mHandoff(),
    previousCanonical: {
      direction: "LONG",
      candidateId: "TEST_CANDIDATE_1",
    },
  });

  assert.equal(s.direction, "LONG");
  assert.equal(s.reversedNow, false);
  pass(5, "CONTESTED preserves prior LONG");
}

// 6. Departure cannot create direction from NEUTRAL.
{
  const b = bars(600, [
    [104, 105, 101, 102],
    [102, 103, 97, 98],
    [98, 99, 94, 96],
    [96, 97, 92, 94],
  ], 1788570000);

  const c = build10mContext({
    bars: b,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(b, 600),
  });

  assert.equal(c.travelEvidence.twoCompletedClosesBelowZone, true);

  const d = resolveDepartureState({
    establishedDirection: "NEUTRAL",
    zone: zoneInput.zone,
    tenMinuteContext: c,
  });

  assert.equal(d.departureConfirmed, false);
  assert.equal(d.neutralBlocked, true);
  pass(6, "departure cannot create direction from NEUTRAL");
}

// 7. Established SHORT + valid departure + below EMA10 holds.
{
  const b = bars(600, [
    [105, 106, 101, 103],
    [103, 104, 98, 99],
    [99, 100, 95, 97],
    [97, 98, 93, 95],
  ], 1788580000);

  const c = build10mContext({
    bars: b,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(b, 600),
  });

  const d = resolveDepartureState({
    establishedDirection: "SHORT",
    zone: zoneInput.zone,
    tenMinuteContext: c,
  });

  assert.equal(d.departureConfirmed, true);

  const t = resolveEma10TravelState({
    establishedDirection: "SHORT",
    departureState: d,
    tenMinuteContext: c,
    ema10: 102,
  });

  assert.equal(t.holdEstablishedDirection, true);

  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    completed5mHandoff: mixed5mHandoff(),
    previousCanonical: {
      direction: "SHORT",
      candidateId: "TEST_CANDIDATE_1",
    },
    departureState: d,
    ema10TravelState: t,
  });

  assert.equal(s.direction, "SHORT");
  assert.equal(s.mode, "TRAVEL");
  pass(7, "SHORT travel holds below EMA10");
}

// 8. Established SHORT + confirmed departure + close above EMA10 resets.
{
  const b = bars(600, [
    [105, 106, 101, 103],
    [103, 104, 98, 99],
    [99, 100, 95, 97],
    [97, 98, 93, 95],
  ], 1788590000);

  const c = build10mContext({
    bars: b,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(b, 600),
  });

  const d = resolveDepartureState({
    establishedDirection: "SHORT",
    zone: zoneInput.zone,
    tenMinuteContext: c,
  });

  assert.equal(d.departureConfirmed, true);

  const t = resolveEma10TravelState({
    establishedDirection: "SHORT",
    departureState: d,
    tenMinuteContext: c,
    // Latest close = 95, so SHORT resets because 95 > EMA10 94.
    ema10: 94,
  });

  assert.equal(t.resetEstablishedDirection, true);

  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    completed5mHandoff: mixed5mHandoff(),
    previousCanonical: {
      direction: "SHORT",
      candidateId: "TEST_CANDIDATE_1",
    },
    departureState: d,
    ema10TravelState: t,
  });

  assert.equal(s.direction, "NEUTRAL");
  assert.equal(s.resetNow, true);
  pass(8, "SHORT travel resets above EMA10");
}

console.log("");
console.log("ENGINE 3 V5 SMOKE TEST: 8/8 PASSED");
console.log("No permission created. No execution.");
