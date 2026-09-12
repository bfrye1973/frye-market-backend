import assert from "node:assert/strict";

import { normalizeNegotiatedZone } from "../../../logic/engine3/v5/zone/normalizeNegotiatedZone.js";
import { build1mEvidence } from "../../../logic/engine3/v5/timeframe/build1mEvidence.js";
import { build5mReaction } from "../../../logic/engine3/v5/timeframe/build5mReaction.js";
import { buildPriceActionControl } from "../../../logic/engine3/v5/priceAction/buildPriceActionControl.js";
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

function sellerPricePath() {
  return bars(60, [
    [108, 109, 106, 107],
    [107, 108, 104, 105],
    [105, 106, 101, 102],
    [102, 103, 98, 99],
    [99, 100, 95, 96],
    [96, 97, 93, 94],
    [94, 95, 91, 92],
    [92, 93, 89, 90],
  ]);
}

function buyerPricePath() {
  return bars(60, [
    [102, 103, 100, 101],
    [101, 104, 100, 103],
    [103, 106, 102, 105],
    [105, 108, 104, 107],
    [107, 111, 106, 110],
    [110, 113, 109, 112],
    [112, 115, 111, 114],
    [114, 117, 113, 116],
  ], 1788555000);
}

function buildPriceControl(priceBars) {
  const evidence = build1mEvidence({
    bars: priceBars,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(priceBars, 60),
    lookback: 8,
  });

  return {
    evidence,
    control: buildPriceActionControl({
      normalizedZoneInput: zoneInput,
      priceActionEvidence: evidence.current,
      sourceResolution: "DENSEST_AVAILABLE_PRICE_PATH",
    }),
  };
}

function mixedPriceActionHandoff() {
  return {
    eligible: true,
    canonicalControlAuthority: true,
    sourceResolutionAuthority: false,
    controlResolved: false,
    controlState: "CONTESTED",
    controlConfidence: "MIXED",
    quality: "MIXED",
  };
}

function pass(n, label) {
  console.log(`PASS ${n}: ${label}`);
}

// 1. Seller control from price action establishes SHORT from NEUTRAL.
{
  const { control } = buildPriceControl(sellerPricePath());

  assert.equal(control.controlState, "SELLERS_CONTROL");
  assert.equal(control.canonicalDirection, null);
  assert.equal(control.sourceResolutionAuthority, false);

  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    priceActionHandoff: control,
    previousCanonical: {
      direction: "NEUTRAL",
      candidateId: "TEST_CANDIDATE_1",
    },
  });

  assert.equal(s.direction, "SHORT");
  assert.equal(s.establishedNow, true);
  assert.equal(s.canonicalSource, "PRICE_ACTION_CONTROL");
  pass(1, "SELLERS_CONTROL price action -> SHORT");
}

// 2. Buyer control from price action establishes LONG from NEUTRAL.
{
  const { control } = buildPriceControl(buyerPricePath());

  assert.equal(control.controlState, "BUYERS_CONTROL");

  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    priceActionHandoff: control,
    previousCanonical: {
      direction: "NEUTRAL",
      candidateId: "TEST_CANDIDATE_1",
    },
  });

  assert.equal(s.direction, "LONG");
  assert.equal(s.establishedNow, true);
  pass(2, "BUYERS_CONTROL price action -> LONG");
}

// 3. Completed 5m remains supporting evidence only.
{
  const b = bars(300, [
    [112, 113, 111, 112],
    [111.5, 112, 108, 109],
    [109, 110, 105, 106],
    [106, 107, 102, 103],
    [103, 104, 98, 99],
  ]);

  const f = build5mReaction({
    bars: b,
    normalizedZoneInput: zoneInput,
    evaluationTimeMs: evalAfterAll(b, 300),
  });

  assert.equal(f.completed5mAuthorizedForStateMachine, false);
  assert.equal(f.forming5mAuthorizedForStateMachine, false);
  assert.equal(f.stateMachineHandoff.canonicalDirection, null);
  pass(3, "5m is supporting evidence, not direction authority");
}

// 4. High-resolution source interval itself still has no direction authority.
{
  const { evidence, control } = buildPriceControl(sellerPricePath());

  assert.equal(evidence.canonicalAuthority, false);
  assert.equal(evidence.canCreateCanonicalDirection, false);
  assert.equal(evidence.canFlipCanonicalDirection, false);
  assert.equal(Object.hasOwn(evidence, "direction"), false);

  assert.equal(control.canonicalControlAuthority, true);
  assert.equal(control.canonicalDirectionPublisher, false);
  assert.equal(control.sourceResolutionAuthority, false);
  pass(4, "source interval has no authority; price-action control does");
}

// 5. CONTESTED price action does not manufacture a flip.
{
  const s = runDirectionStateMachine({
    normalizedZoneInput: zoneInput,
    priceActionHandoff: mixedPriceActionHandoff(),
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
    priceActionHandoff: mixedPriceActionHandoff(),
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
    priceActionHandoff: mixedPriceActionHandoff(),
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
console.log("ENGINE 3 V5 PRICE-ACTION SMOKE TEST: 8/8 PASSED");
console.log("No permission created. No execution.");
