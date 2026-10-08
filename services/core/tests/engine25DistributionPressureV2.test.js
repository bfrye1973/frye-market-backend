import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDistributionTimeframeObservation,
  buildEngine25DistributionPressureV2,
} from "../logic/engine25/buildDistributionPressureV2.js";

const SECTORS = [
  "Information Technology",
  "Communication Services",
  "Consumer Staples",
  "Utilities",
  "Real Estate",
  "Financials",
  "Health Care",
  "Industrials",
  "Energy",
  "Materials",
  "Consumer Discretionary",
];

function payload({
  ts,
  up = 4,
  down = 6,
  nh = 9,
  nl = 11,
  advancingVolume = 25,
  decliningVolume = 75,
  weak = 5,
  strong = 0,
} = {}) {
  const cards = SECTORS.map((sector, index) => {
    let breadth_pct = 50;
    let momentum_pct = 50;
    if (index < strong) {
      breadth_pct = 60;
      momentum_pct = 60;
    } else if (index < strong + weak) {
      breadth_pct = 40;
      momentum_pct = 40;
    }

    return {
      sector,
      breadth_pct,
      momentum_pct,
      up,
      down,
      nh,
      nl,
      advancingVolume,
      decliningVolume,
      unchangedVolume: 10,
      stocksScanned: 100,
      stocksWithVolume: 90,
    };
  });

  return { updated_at_utc: ts, sectorCards: cards };
}

const NOW = Date.parse("2026-10-07T18:45:00Z");

test("4H formula uses 35/30/20/15 weights exactly", () => {
  const out = buildDistributionTimeframeObservation({
    timeframe: "4h",
    payload: payload({
      ts: "2026-10-07T18:40:00Z",
      up: 4,
      down: 6,
      nh: 9,
      nl: 11,
      advancingVolume: 25,
      decliningVolume: 75,
      weak: 5,
    }),
    now: NOW,
  });

  assert.equal(out.available, true);
  assert.equal(out.components.volumePressure, 100);
  assert.equal(out.components.breadthPressure, 100);
  assert.equal(out.components.highLowPressure, 25);
  assert.equal(out.components.sectorPressure, 45.45);
  assert.ok(Math.abs(out.pressure - 76.82) < 0.02);
  assert.equal(out.label, "HIGH");
});

test("same source timestamp does not manufacture history", () => {
  const inputs = {
    intraday: payload({ ts: "2026-10-07T18:40:00Z" }),
    thirtyMinute: payload({ ts: "2026-10-07T18:30:00Z" }),
    hourly: payload({ ts: "2026-10-07T18:04:00Z" }),
    fourHour: payload({ ts: "2026-10-07T18:40:00Z" }),
  };

  const first = buildEngine25DistributionPressureV2({
    ...inputs,
    now: NOW,
  });
  const second = buildEngine25DistributionPressureV2({
    ...inputs,
    previous: first,
    now: NOW + 60_000,
  });

  for (const tf of ["10m", "30m", "1h", "4h"]) {
    assert.equal(second.history[tf].length, 1);
  }
  assert.equal(second.persistence.state, "PENDING_CONFIRMATION");
});

test("1H trend, 30m confirmation, and 10m acceleration require new observations", () => {
  const structural = payload({
    ts: "2026-10-07T18:40:00Z",
    up: 4,
    down: 6,
    nh: 9,
    nl: 11,
    advancingVolume: 25,
    decliningVolume: 75,
    weak: 5,
  });

  const tacticalCurrent = payload({
    ts: "2026-10-07T18:04:00Z",
    up: 5,
    down: 5,
    nh: 9,
    nl: 11,
    advancingVolume: 45,
    decliningVolume: 55,
    weak: 5,
  });

  const thirtyCurrent = payload({
    ts: "2026-10-07T18:30:00Z",
    up: 5,
    down: 5,
    nh: 9,
    nl: 11,
    advancingVolume: 45,
    decliningVolume: 55,
    weak: 5,
  });

  const tenCurrent = payload({
    ts: "2026-10-07T18:40:00Z",
    up: 6,
    down: 4,
    nh: 11,
    nl: 9,
    advancingVolume: 70,
    decliningVolume: 30,
    weak: 0,
    strong: 6,
  });

  const previous = {
    history: {
      "4h": [
        { sourceTimestamp: "2026-10-07T14:40:00Z", pressure: 75, label: "HIGH" },
      ],
      "1h": [
        { sourceTimestamp: "2026-10-07T17:04:00Z", pressure: 60, label: "ELEVATED" },
      ],
      "30m": [
        { sourceTimestamp: "2026-10-07T18:00:00Z", pressure: 36, label: "WATCH" },
      ],
      "10m": [
        { sourceTimestamp: "2026-10-07T18:30:00Z", pressure: 0, label: "LOW" },
      ],
    },
  };

  const out = buildEngine25DistributionPressureV2({
    intraday: tenCurrent,
    thirtyMinute: thirtyCurrent,
    hourly: tacticalCurrent,
    fourHour: structural,
    previous,
    now: NOW,
  });

  assert.equal(out.persistence.state, "CONFIRMED");
  assert.equal(out.tactical1h.trend.state, "EASING");
  assert.equal(
    out.confirmation30m.confirmation.state,
    "BUYING_RECOVERY_CONFIRMED"
  );
  assert.equal(
    out.acceleration10m.acceleration.state,
    "FAST_BUYING_RECOVERY_CONFIRMED"
  );
  assert.equal(out.integratedState, "REPAIRING");
});

test("coverage below 70 percent makes a timeframe unavailable rather than neutral", () => {
  const p = payload({ ts: "2026-10-07T18:40:00Z" });
  for (const card of p.sectorCards) card.stocksWithVolume = 60;

  const out = buildDistributionTimeframeObservation({
    timeframe: "4h",
    payload: p,
    now: NOW,
  });

  assert.equal(out.available, false);
  assert.equal(out.pressure, null);
  assert.equal(out.reason, "VOLUME_COVERAGE_BELOW_70_PERCENT");
});


test("equity-closed 10m and 30m expose last valid equity read without becoming live authority", () => {
  const closedNow = Date.parse("2026-10-08T11:30:00Z"); // 07:30 ET, equity session closed

  const lowCoverage10 = payload({
    ts: "2026-10-08T11:20:00Z",
    up: 5,
    down: 5,
    nh: 9,
    nl: 11,
    advancingVolume: 55,
    decliningVolume: 45,
    weak: 3,
  });
  const lowCoverage30 = payload({
    ts: "2026-10-08T10:00:00Z",
    up: 5,
    down: 5,
    nh: 9,
    nl: 11,
    advancingVolume: 55,
    decliningVolume: 45,
    weak: 3,
  });
  for (const card of lowCoverage10.sectorCards) card.stocksWithVolume = 40;
  for (const card of lowCoverage30.sectorCards) card.stocksWithVolume = 30;

  const prior = {
    history: {
      "4h": [
        { sourceTimestamp: "2026-10-07T19:24:27Z", pressure: 74.45, label: "HIGH" },
      ],
      "1h": [
        { sourceTimestamp: "2026-10-07T20:05:32Z", pressure: 48.67, label: "WATCH" },
      ],
      "30m": [
        { sourceTimestamp: "2026-10-07T20:00:00Z", pressure: 82.91, label: "HIGH" },
      ],
      "10m": [
        { sourceTimestamp: "2026-10-07T20:33:13Z", pressure: 37.72, label: "WATCH" },
      ],
    },
  };

  const out = buildEngine25DistributionPressureV2({
    intraday: lowCoverage10,
    thirtyMinute: lowCoverage30,
    hourly: payload({ ts: "2026-10-08T11:02:31Z" }),
    fourHour: payload({ ts: "2026-10-08T11:24:41Z" }),
    previous: prior,
    now: closedNow,
  });

  assert.equal(out.equitySession.active, false);

  assert.equal(out.acceleration10m.available, false);
  assert.equal(out.acceleration10m.display.state, "LAST_VALID_EQUITY_READ");
  assert.equal(out.acceleration10m.display.reason, "EQUITY_SESSION_CLOSED");
  assert.equal(out.acceleration10m.display.pressure, 37.72);
  assert.equal(
    out.acceleration10m.display.sourceTimestamp,
    "2026-10-07T20:33:13Z"
  );

  assert.equal(out.confirmation30m.available, false);
  assert.equal(out.confirmation30m.display.state, "LAST_VALID_EQUITY_READ");
  assert.equal(out.confirmation30m.display.reason, "EQUITY_SESSION_CLOSED");
  assert.equal(out.confirmation30m.display.pressure, 82.91);
  assert.equal(
    out.confirmation30m.display.sourceTimestamp,
    "2026-10-07T20:00:00Z"
  );

  // The state-machine authority stays unavailable overnight. The carried
  // observation is display/context only.
  assert.equal(out.acceleration10m.acceleration.state, "UNAVAILABLE");
  assert.equal(out.confirmation30m.confirmation.state, "UNAVAILABLE");
});

test("active equity session with low coverage stays unavailable and does not carry prior read", () => {
  const openNow = Date.parse("2026-10-08T15:30:00Z"); // 11:30 ET, equity session open
  const lowCoverage = payload({ ts: "2026-10-08T15:25:00Z" });
  for (const card of lowCoverage.sectorCards) card.stocksWithVolume = 40;

  const prior = {
    history: {
      "30m": [
        { sourceTimestamp: "2026-10-08T14:30:00Z", pressure: 70, label: "HIGH" },
      ],
      "10m": [
        { sourceTimestamp: "2026-10-08T15:10:00Z", pressure: 60, label: "ELEVATED" },
      ],
    },
  };

  const out = buildEngine25DistributionPressureV2({
    intraday: lowCoverage,
    thirtyMinute: lowCoverage,
    hourly: payload({ ts: "2026-10-08T15:05:00Z" }),
    fourHour: payload({ ts: "2026-10-08T15:20:00Z" }),
    previous: prior,
    now: openNow,
  });

  assert.equal(out.equitySession.active, true);
  assert.equal(out.acceleration10m.display.state, "UNAVAILABLE");
  assert.equal(out.confirmation30m.display.state, "UNAVAILABLE");
  assert.equal(out.acceleration10m.display.lastValidEquityRead, null);
  assert.equal(out.confirmation30m.display.lastValidEquityRead, null);
});
