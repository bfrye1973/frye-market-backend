import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine2ChartOverlayV1 } from "../logic/engine2/buildEngine2ChartOverlayV1.js";

const mock = (micro = { activeWave: "W2", levels: [{ key: "e1272", label: "1.272", price: 7900.25 }] }) => ({
  symbol: "ES",
  strategies: { "intraday_scalp@10m": { engine22WaveStrategy: {
    degreeStates: {
      primary: { activeWave: "W5", marks: { W2: { price: 7600, time: "2026-10-01" } }, targetModel: { levels: { e1618: 8100 } } },
      intermediate: {}, minor: {}, minute: {},
      subminute: { targetModel: { levels: { e100: 9999 } }, marks: { W1: { price: 9999, time: "2026-10-01" } } }
    },
    currentWavelength: { canonicalWaveStateConflict: true, degrees: { micro } }
  } } }
});
test("separate Micro source never silently reads Subminute", () => {
  const r = buildEngine2ChartOverlayV1(mock());
  assert.equal(r.degrees.micro.drawable, true);
  assert.equal(r.degrees.micro.lines[0].price, 7900.25);
  assert.ok(r.degrees.micro.lines.every(x => x.price !== 9999));
  assert.equal(r.degrees.micro.parentDegree, "subminute");
  assert.equal(r.snapshot.authorityConflict, true);
});
test("missing Micro levels fail visibly even when Subminute has levels", () => {
  const r = buildEngine2ChartOverlayV1(mock({ activeWave: "W2", levels: [] }));
  assert.equal(r.degrees.micro.drawable, false);
  assert.equal(r.degrees.micro.reason, "NO_CANONICAL_MICRO_LEVELS");
  assert.equal(r.degrees.micro.provenance.fallbackUsed, false);
});
test("Primary uses published structural marks and levels", () => {
  const r = buildEngine2ChartOverlayV1(mock());
  assert.equal(r.degrees.primary.drawable, true);
  assert.equal(r.degrees.primary.lines[0].price, 8100);
  assert.equal(r.degrees.primary.marks[0].price, 7600);
});
test("unsupported symbol rejects source", () => {
  assert.equal(buildEngine2ChartOverlayV1(mock(), "NQ").error, "UNSUPPORTED_SYMBOL");
});
