import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEngine29SqueezeTransitionMonitor,
  ENGINE29_SQUEEZE_MONITOR_STATES,
} from "../logic/engine29/tacticalCharacter/buildSqueezeTransitionMonitor.js";

const STEP = 10 * 60 * 1000;
const T0 = Date.parse("2026-10-02T11:00:00Z");

function bar(index, open, high, low, close) {
  return {
    time: T0 + index * STEP,
    open,
    high,
    low,
    close,
    volume: 1000,
  };
}

function monitorFor(bars, direction = "UP") {
  return buildEngine29SqueezeTransitionMonitor(
    { generatedAt: "2026-10-02T14:00:00.000Z", symbols: {} },
    {
      parentMoveCharacter: {
        moveCharacter:
          direction === "UP"
            ? "UPSIDE_MOVE_ACTIVE"
            : "DOWNSIDE_MOVE_ACTIVE",
        direction,
      },
      fastTacticalState:
        direction === "UP"
          ? "BUYING_PRESSURE_INCREASING"
          : "SELLING_PRESSURE_INCREASING",
      esLiveMonitor: { bars },
    }
  );
}

test("detects high-level 10m consolidation after an upside parent move", () => {
  const bars = [
    bar(0, 7758, 7762, 7756, 7760),
    bar(1, 7760, 7768, 7759, 7766),
    bar(2, 7766, 7776, 7765, 7774),
    bar(3, 7774, 7786, 7773, 7784),
    bar(4, 7784, 7796, 7783, 7794),
    bar(5, 7794, 7801, 7790, 7796),

    bar(6, 7796, 7800, 7790, 7794),
    bar(7, 7794, 7799, 7789, 7791),
    bar(8, 7791, 7800, 7790, 7796),
    bar(9, 7796, 7799, 7791, 7793),
    bar(10, 7793, 7801, 7792, 7797),
    bar(11, 7797, 7800, 7791, 7795),
  ];

  const result = monitorFor(bars, "UP");

  assert.equal(
    result.state,
    ENGINE29_SQUEEZE_MONITOR_STATES.CONSOLIDATING_NEAR_HIGHS
  );
  assert.equal(result.metrics.consolidation.active, true);
  assert.equal(result.metrics.consolidation.nearHigh, true);
  assert.ok(result.metrics.consolidation.overlapFraction >= 0.60);
  assert.ok(result.metrics.consolidation.efficiency <= 0.45);
  assert.ok(
    result.reasonCodes.includes("ES_10M_CONSOLIDATING_NEAR_HIGHS")
  );
});

test("detects low-level 10m consolidation after a downside parent move", () => {
  const bars = [
    bar(0, 7802, 7804, 7798, 7800),
    bar(1, 7800, 7801, 7792, 7794),
    bar(2, 7794, 7795, 7784, 7786),
    bar(3, 7786, 7787, 7774, 7776),
    bar(4, 7776, 7777, 7764, 7766),
    bar(5, 7766, 7770, 7758, 7762),

    bar(6, 7762, 7768, 7758, 7764),
    bar(7, 7764, 7769, 7759, 7766),
    bar(8, 7766, 7768, 7758, 7761),
    bar(9, 7761, 7767, 7759, 7764),
    bar(10, 7764, 7769, 7758, 7762),
    bar(11, 7762, 7768, 7759, 7764),
  ];

  const result = monitorFor(bars, "DOWN");

  assert.equal(
    result.state,
    ENGINE29_SQUEEZE_MONITOR_STATES.CONSOLIDATING_NEAR_LOWS
  );
  assert.equal(result.metrics.consolidation.active, true);
  assert.equal(result.metrics.consolidation.nearLow, true);
  assert.ok(
    result.reasonCodes.includes("ES_10M_CONSOLIDATING_NEAR_LOWS")
  );
});

test("does not call a continuing directional expansion consolidation", () => {
  const bars = [
    bar(0, 7750, 7754, 7748, 7752),
    bar(1, 7752, 7758, 7751, 7757),
    bar(2, 7757, 7764, 7756, 7763),
    bar(3, 7763, 7770, 7762, 7769),
    bar(4, 7769, 7777, 7768, 7776),
    bar(5, 7776, 7784, 7775, 7783),
    bar(6, 7783, 7791, 7782, 7790),
    bar(7, 7790, 7798, 7789, 7797),
    bar(8, 7797, 7805, 7796, 7804),
    bar(9, 7804, 7812, 7803, 7811),
    bar(10, 7811, 7819, 7810, 7818),
    bar(11, 7818, 7826, 7817, 7825),
  ];

  const result = monitorFor(bars, "UP");

  assert.equal(result.metrics.consolidation.active, false);
  assert.notEqual(
    result.state,
    ENGINE29_SQUEEZE_MONITOR_STATES.CONSOLIDATING_NEAR_HIGHS
  );
});

test("consolidation remains diagnostic and does not alter the parent move", () => {
  const bars = [
    bar(0, 7758, 7762, 7756, 7760),
    bar(1, 7760, 7768, 7759, 7766),
    bar(2, 7766, 7776, 7765, 7774),
    bar(3, 7774, 7786, 7773, 7784),
    bar(4, 7784, 7796, 7783, 7794),
    bar(5, 7794, 7801, 7790, 7796),
    bar(6, 7796, 7800, 7790, 7794),
    bar(7, 7794, 7799, 7789, 7791),
    bar(8, 7791, 7800, 7790, 7796),
    bar(9, 7796, 7799, 7791, 7793),
    bar(10, 7793, 7801, 7792, 7797),
    bar(11, 7797, 7800, 7791, 7795),
  ];

  const result = monitorFor(bars, "UP");

  assert.equal(result.authority, "DIAGNOSTIC_ONLY");
  assert.equal(result.parentMove.moveCharacter, "UPSIDE_MOVE_ACTIVE");
  assert.equal(result.parentMove.direction, "UP");
});
