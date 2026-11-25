import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine26BTargetStopGeometry,
  selectEngine26BTargetZone,
} from "../logic/engine26/strategy1/buildEngine26BTargetStopGeometry.js";

const entryZone = {
  id: "ENTRY",
  zoneId: "ENTRY",
  low: 7687.25,
  high: 7705.5,
  midline: 7696.5,
};

const zones = [
  entryZone,
  { id: "LOWER_FAR", zoneId: "LOWER_FAR", low: 7600, high: 7620, midline: 7610 },
  { id: "LOWER_NEAR", zoneId: "LOWER_NEAR", low: 7640, high: 7660, midline: 7650 },
  { id: "UPPER_NEAR", zoneId: "UPPER_NEAR", low: 7720, high: 7740, midline: 7730 },
  { id: "UPPER_FAR", zoneId: "UPPER_FAR", low: 7770, high: 7790, midline: 7780 },
];

test("LONG selects nearest approved negotiated zone completely above entry", () => {
  const target = selectEngine26BTargetZone({
    direction: "LONG",
    entryZone,
    approvedNegotiatedZones: zones,
  });

  assert.equal(target.zoneId, "UPPER_NEAR");
});

test("SHORT selects nearest approved negotiated zone completely below entry", () => {
  const target = selectEngine26BTargetZone({
    direction: "SHORT",
    entryZone,
    approvedNegotiatedZones: zones,
  });

  assert.equal(target.zoneId, "LOWER_NEAR");
});

test("LONG stop is one ES tick below entry-zone low", () => {
  const result = buildEngine26BTargetStopGeometry({
    direction: "LONG",
    entryZone,
    approvedNegotiatedZones: zones,
    tickSize: 0.25,
  });

  assert.equal(result.locationInvalidationBoundary, 7687);
  assert.equal(result.targetZone.zoneId, "UPPER_NEAR");
  assert.equal(result.target1Price, 7720);
  assert.equal(result.target2Price, 7730);
  assert.equal(result.ready, true);
});

test("SHORT stop is one ES tick above entry-zone high", () => {
  const result = buildEngine26BTargetStopGeometry({
    direction: "SHORT",
    entryZone,
    approvedNegotiatedZones: zones,
    tickSize: 0.25,
  });

  assert.equal(result.locationInvalidationBoundary, 7705.75);
  assert.equal(result.targetZone.zoneId, "LOWER_NEAR");
  assert.equal(result.target1Price, 7660);
  assert.equal(result.target2Price, 7650);
  assert.equal(result.ready, true);
});

test("missing directional target stays diagnostic without inventing a zone", () => {
  const result = buildEngine26BTargetStopGeometry({
    direction: "LONG",
    entryZone,
    approvedNegotiatedZones: [entryZone],
  });

  assert.equal(result.ready, false);
  assert.equal(result.status, "TARGET_ZONE_UNAVAILABLE");
  assert.equal(result.targetZone, null);
  assert.equal(result.locationInvalidationBoundary, 7687);
});
