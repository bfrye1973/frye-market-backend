import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine27TraderIntelligenceV3,
} from "../logic/engine27/v3/buildTraderIntelligenceV3.js";

function fixture() {
  return {
    symbol: "ES",
    now: "2026-10-11T16:30:00.000Z",
    strategies: {
      "intraday_scalp@10m": {
        engine22WaveStrategy: {
          degreeStates: {
            subminute: { activeWave: "W3", direction: "UP", stage: "ACTIVE" },
            minute: { activeWave: "W3", direction: "UP", stage: "ACTIVE" },
            minor: { activeWave: "W5", direction: "UP", stage: "ACTIVE" },
            intermediate: { activeWave: "W3", direction: "UP", stage: "ACTIVE" },
            primary: { activeWave: "W5", direction: "UP", stage: "ACTIVE" },
          },
          engine22Display: {
            degrees: {
              micro: {
                badge: "W2",
                direction: "DOWN",
                headline: "Legacy fast intraday W2",
                rows: [{ label: "Invalidation", value: "7782.75" }],
                levels: [{ label: "Origin", price: 7782.75, status: "INVALIDATION" }],
                rules: [],
              },
              subminute: { badge: "W3", direction: "UP", rows: [], levels: [], rules: [] },
              minute: { badge: "W3", direction: "UP", rows: [], levels: [], rules: [] },
              minor: { badge: "W5", direction: "UP", rows: [], levels: [], rules: [] },
              intermediate: { badge: "W3", direction: "UP", rows: [], levels: [], rules: [] },
              primary: { badge: "W5", direction: "UP", rows: [], levels: [], rules: [] },
            },
          },
          currentWavelength: {
            timingDegree: "micro",
            primaryActiveDegree: "subminute",
            degrees: {
              micro: {
                activeWave: "W2",
                state: "MICRO_W2_PULLBACK_WATCH",
                invalidation: 7782.75,
                confirmationStatus: "W1_CONFIRMED_W2_PENDING",
                microSequence: {
                  activeWave: "W2",
                  w2Completion: {
                    state: "COMPLETION_CANDIDATE",
                    reasonCodes: ["FIVE_MIN_SWING_BREAK"],
                    evidence: { sourceTimestamp: "2026-10-11T16:25:00.000Z" },
                  },
                },
                levels: [{ key: "r500", label: "0.500", price: 7810, status: "WATCH" }],
                nextLevel: { key: "r500", label: "0.500", price: 7810, status: "WATCH" },
              },
            },
          },
        },
      },
    },
  };
}

test("V3 exposes seven structural degrees while preserving six strategy accounts", () => {
  const out = buildEngine27TraderIntelligenceV3({ snapshot: fixture() });

  assert.deepEqual(out.degreeOrder, [
    "submicro",
    "micro",
    "subminute",
    "minute",
    "minor",
    "intermediate",
    "primary",
  ]);
  assert.equal(out.strategyArchitecture.strategyAccountCount, 6);
  assert.equal(out.strategyArchitecture.structuralDegreeCount, 7);
  assert.equal(out.strategyArchitecture.intraday.plannedStructuralOwner, "SUBMICRO");
  assert.equal(out.strategyArchitecture.intraday.migrationAppliedToAccountRouting, false);
});

test("legacy fast Micro sequence is reclassified as Submicro without recalculating prices", () => {
  const out = buildEngine27TraderIntelligenceV3({ snapshot: fixture() });

  assert.equal(out.degrees.submicro.activeWave, "W2");
  assert.equal(out.degrees.submicro.waveDirection, "DOWN");
  assert.equal(out.degrees.submicro.currentCondition, "COMPLETION_CANDIDATE");
  assert.equal(out.degrees.submicro.invalidation.price, 7782.75);
  assert.equal(out.degrees.submicro.migration.status, "RECLASSIFIED_FROM_LEGACY_MICRO");
  assert.equal(out.degrees.submicro.migration.pricesRecalculated, false);
});

test("V3 refuses to invent the true parent Micro structure", () => {
  const out = buildEngine27TraderIntelligenceV3({ snapshot: fixture() });

  assert.equal(out.degrees.micro.activeWave, "NOT_PUBLISHED");
  assert.equal(out.degrees.micro.currentCondition, "STRUCTURE_MAPPING_REQUIRED");
  assert.equal(out.degrees.micro.potentialCompletion.levels.length, 0);
  assert.equal(out.degrees.micro.provenance.structuralSource, "NOT_PUBLISHED");
  assert.equal(out.migration.trueMicroParentMapped, false);
});

test("V2 source snapshot is not mutated by V3 migration presentation", () => {
  const source = fixture();
  const before = structuredClone(source);
  buildEngine27TraderIntelligenceV3({ snapshot: source });
  assert.deepEqual(source, before);
});
