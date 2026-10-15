import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine29SqueezeTransitionMonitor,
} from "../logic/engine29/tacticalCharacter/buildSqueezeTransitionMonitor.js";

function barsFromCloses(closes, start = Date.parse("2026-10-15T14:20:00Z")) {
  return closes.map((close, index) => ({
    time: start + index * 10 * 60 * 1000,
    open: close - 1,
    high: close + 4,
    low: close - 4,
    close,
    volume: 1000 + index,
  }));
}

function run(closes, {
  fastTacticalState = "BUYING_PRESSURE_INCREASING",
  parentMoveCharacter = {
    parent: { active: false, direction: "FLAT" },
    character: {
      squeeze: { active: false },
      broadConfirmation: { confirmed: false },
    },
  },
} = {}) {
  return buildEngine29SqueezeTransitionMonitor(
    {
      generatedAt: "2026-10-15T15:30:00.000Z",
      symbols: {},
    },
    {
      parentMoveCharacter,
      fastTacticalState,
      esLiveMonitor: {
        timeframe: "10m",
        bars: barsFromCloses(closes),
      },
    }
  );
}

test("small counter-bar after dominant upside impulse is a pullback, not downside acceleration", () => {
  // Large rise 7725 -> 7782 remains dominant. The newest red bar makes the
  // latest 10m/20m direction DOWN, but price still retains most of the rise.
  const r = run([7725, 7740, 7760, 7782, 7778, 7772]);

  assert.equal(r.direction, "DOWN");
  assert.equal(r.state, "PULLBACK_WITHIN_UPSIDE_IMPULSE");
  assert.equal(r.metrics.recentImpulse.direction, "UP");
  assert.equal(r.metrics.recentImpulse.activePullback, true);
  assert.ok(r.metrics.recentImpulse.retainedFraction > 0.5);
  assert.ok(
    r.reasonCodes.includes(
      "CURRENT_10M_PULLBACK_WITHIN_RETAINED_UPSIDE_IMPULSE"
    )
  );
  assert.match(r.display.headline, /pulling back inside/i);
});

test("upside impulse loses protection after price breaks its midpoint", () => {
  const r = run([7725, 7740, 7760, 7782, 7778, 7745]);

  assert.equal(r.direction, "DOWN");
  assert.equal(r.metrics.recentImpulse.direction, "UP");
  assert.equal(r.metrics.recentImpulse.activePullback, false);
  assert.ok(r.metrics.recentImpulse.retainedFraction < 0.5);
  assert.notEqual(r.state, "PULLBACK_WITHIN_UPSIDE_IMPULSE");
  assert.equal(r.state, "DOWNSIDE_MOMENTUM_ACCELERATING");
});

test("small bounce after dominant downside impulse is not upside acceleration", () => {
  const r = run(
    [7782, 7768, 7750, 7725, 7730, 7738],
    { fastTacticalState: "SELLING_PRESSURE_INCREASING" }
  );

  assert.equal(r.direction, "UP");
  assert.equal(r.state, "BOUNCE_WITHIN_DOWNSIDE_IMPULSE");
  assert.equal(r.metrics.recentImpulse.direction, "DOWN");
  assert.equal(r.metrics.recentImpulse.activePullback, true);
  assert.ok(r.metrics.recentImpulse.retainedFraction > 0.5);
});

test("canonical active parent is not overridden by opposite recent impulse memory", () => {
  const r = run(
    [7725, 7740, 7760, 7782, 7778, 7772],
    {
      fastTacticalState: "BUYING_PRESSURE_INCREASING",
      parentMoveCharacter: {
        parent: { active: true, direction: "DOWN" },
        character: {
          squeeze: { active: false },
          broadConfirmation: { confirmed: false },
        },
      },
    }
  );

  assert.equal(r.direction, "DOWN");
  assert.equal(r.contextVsParent, "ALIGNED_WITH_PARENT");
  assert.equal(r.metrics.recentImpulse.direction, "UP");
  assert.equal(r.metrics.recentImpulse.activePullback, false);
  assert.notEqual(r.state, "PULLBACK_WITHIN_UPSIDE_IMPULSE");
});
