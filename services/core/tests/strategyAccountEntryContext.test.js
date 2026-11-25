import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStructuralContextAtEntry,
  compareStructuralContext,
} from "../logic/accounts/buildStructuralEntryContext.js";

function snapshot({
  primary = "UP",
  intermediate = "UP",
  minor = "UP",
  minute = "UP",
  subminute = "UP",
  micro = "UP",
} = {}) {
  return {
    now: "2026-10-10T19:30:00.000Z",
    strategies: {
      "intraday_scalp@10m": {
        engine22WaveStrategy: {
          microExecutionContext: {
            activeWave: "W3",
            waveDirection: micro,
            lifecycle: "DEVELOPING",
            microTimingState: "TRANSITION_CONFIRMING",
            sourceCountId: "MICRO-1",
            revision: 4,
          },
          degreeStates: {
            subminute: { activeWave: "W3", direction: subminute, stage: "ACTIVE" },
            minute: { activeWave: "W3", direction: minute, stage: "ACTIVE" },
            minor: { activeWave: "W3", direction: minor, stage: "ACTIVE" },
            intermediate: { activeWave: "W3", direction: intermediate, stage: "ACTIVE" },
            primary: { activeWave: "W3", direction: primary, stage: "ACTIVE" },
          },
        },
      },
    },
  };
}

test("Subminute entry freezes all six canonical Elliott degrees", () => {
  const entry = buildStructuralContextAtEntry({
    strategySnapshot: snapshot(),
    brokerAccountLabel: "SCHWAB_0747",
    legacyJournalAccount: "SWING",
    fillTime: "2026-10-10T19:29:58.000Z",
    capturedAt: "2026-10-10T19:30:01.000Z",
  });

  assert.equal(entry.available, true);
  assert.equal(entry.accountRole, "SUBMINUTE");
  assert.equal(entry.ownerDegree, "subminute");
  assert.equal(entry.ownerState.direction, "UP");
  assert.deepEqual(Object.keys(entry.degrees), ["micro", "subminute", "minute", "minor", "intermediate", "primary"]);
  assert.equal(entry.immutable, true);
  assert.equal(entry.historicalBackfill, false);
  assert.equal(entry.captureTiming, "LIVE_SNAPSHOT_AT_ENGINE10_INGEST");
});

test("Primary long ignores isolated lower-degree pullback as thesis break", () => {
  const entry = {
    ...buildStructuralContextAtEntry({
      strategySnapshot: snapshot(),
      brokerAccountLabel: "SCHWAB_PRIMARY_TEST",
      legacyJournalAccount: null,
      fillTime: "2026-10-10T19:29:58.000Z",
      capturedAt: "2026-10-10T19:30:01.000Z",
    }),
    available: true,
    ownerDegree: "primary",
    ownerState: { degree: "primary", activeWave: "W3", direction: "UP", stage: "ACTIVE" },
  };

  const current = snapshot({ minute: "DOWN", subminute: "DOWN", micro: "DOWN" })
    .strategies["intraday_scalp@10m"].engine22WaveStrategy;

  const out = compareStructuralContext({
    entryContext: entry,
    currentEngine22WaveStrategy: current,
    positionDirection: "LONG",
  });

  assert.equal(out.state, "LOWER_DEGREE_PULLBACK");
  assert.equal(out.ownerAlignment, "ALIGNED");
  assert.equal(out.executionAuthority, false);
});

test("Primary long escalates when Intermediate and more lower degrees oppose", () => {
  const entry = {
    available: true,
    ownerDegree: "primary",
    ownerState: { degree: "primary", activeWave: "W3", direction: "UP", stage: "ACTIVE" },
  };

  const current = snapshot({ intermediate: "DOWN", minor: "DOWN", minute: "DOWN" })
    .strategies["intraday_scalp@10m"].engine22WaveStrategy;

  const out = compareStructuralContext({
    entryContext: entry,
    currentEngine22WaveStrategy: current,
    positionDirection: "LONG",
  });

  assert.equal(out.state, "EARLY_WARNING");
  assert.deepEqual(out.opposedLowerDegrees.includes("intermediate"), true);
});

test("owner degree opposing the position is thesis broken, without creating exit authority", () => {
  const entry = {
    available: true,
    ownerDegree: "minor",
    ownerState: { degree: "minor", activeWave: "W3", direction: "UP", stage: "ACTIVE" },
  };

  const current = snapshot({ minor: "DOWN" })
    .strategies["intraday_scalp@10m"].engine22WaveStrategy;

  const out = compareStructuralContext({
    entryContext: entry,
    currentEngine22WaveStrategy: current,
    positionDirection: "LONG",
  });

  assert.equal(out.state, "THESIS_BROKEN");
  assert.equal(out.managementAuthority, false);
  assert.equal(out.executionAuthority, false);
});

test("old trades without entry structure are never silently reconstructed", () => {
  const out = compareStructuralContext({
    entryContext: null,
    currentEngine22WaveStrategy: snapshot().strategies["intraday_scalp@10m"].engine22WaveStrategy,
    positionDirection: "LONG",
  });

  assert.equal(out.available, false);
  assert.equal(out.state, "ENTRY_STRUCTURE_UNAVAILABLE");
});