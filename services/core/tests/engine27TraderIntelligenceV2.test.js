// services/core/tests/engine27TraderIntelligenceV2.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine27TraderIntelligenceV2,
} from "../logic/engine27/v2/buildTraderIntelligenceV2.js";

function fixture() {
  return {
    symbol: "ES",
    now: "2026-10-09T01:30:00.000Z",
    strategies: {
      "intraday_scalp@10m": {
        engine22WaveStrategy: {
          degreeStates: {
            subminute: {
              activeWave: "W3",
              direction: "UP",
              parentDegree: "minute",
              parentWave: "W3",
              stage: "ACTIVE_CANDIDATE",
            },
            minute: {
              activeWave: "W3",
              direction: "UP",
              parentDegree: "minor",
              parentWave: "W5",
              stage: "CONFIRMATION_PENDING",
            },
            minor: {
              activeWave: "W5",
              direction: "UP",
              parentDegree: "intermediate",
              parentWave: "W3",
              stage: "ACTIVE_CANDIDATE",
            },
            intermediate: {
              activeWave: "W3",
              direction: "UP",
              parentDegree: "primary",
              parentWave: "W5",
              stage: "ACTIVE",
            },
            primary: {
              activeWave: "W5",
              direction: "UP",
              stage: "ACTIVE",
            },
          },

          engine22Display: {
            degrees: {
              micro: {
                badge: "W2",
                direction: "DOWN",
                headline: "Micro W2 retracement watch",
                rows: [
                  { label: "Invalidation", value: "7782.75" },
                ],
                levels: [
                  { label: "Micro origin", price: 7782.75, status: "INVALIDATION" },
                ],
                rules: [
                  "5m confirms wave completion; 1m diagnostic only.",
                ],
              },
              subminute: {
                badge: "W3",
                direction: "UP",
                headline: "Subminute W3 active candidate",
                rows: [{ label: "Parent", value: "Minute W3" }],
                levels: [],
                rules: [],
              },
              minute: {
                badge: "W3",
                direction: "UP",
                headline: "Minute W3 started — confirmation pending",
                rows: [{ label: "Parent", value: "Minor W5" }],
                levels: [],
                rules: [],
              },
              minor: {
                badge: "W5",
                direction: "UP",
                headline: "Minor W5 active candidate",
                rows: [{ label: "Parent", value: "Intermediate W3" }],
                levels: [],
                rules: [],
              },
              intermediate: {
                badge: "W3",
                direction: "UP",
                headline: "Intermediate W3 active",
                rows: [{ label: "Parent", value: "Primary W5" }],
                levels: [],
                rules: [],
              },
              primary: {
                badge: "W5",
                direction: "UP",
                headline: "Primary W5 active",
                rows: [],
                levels: [],
                rules: [],
              },
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
                    evidence: {
                      sourceTimestamp: "2026-10-09T01:25:00.000Z",
                    },
                  },
                },
                levels: [
                  { key: "r500", label: "0.500", price: 7810, status: "WATCH" },
                ],
                nextLevel: {
                  key: "r500",
                  label: "0.500",
                  price: 7810,
                  status: "WATCH",
                },
              },
              minute: {
                activeWave: "W3",
                state: "MINUTE_W3_STARTED_CONFIRMATION_PENDING",
                confirmationStatus: "PENDING",
                confirmationRule: "RECLAIM_LEVELS_REQUIRED",
                levels: [
                  { label: "Confirm", price: 7906.25, status: "CONFIRMATION" },
                ],
              },
            },
          },
        },

        engine26LocationCandidate: {
          laneId: "minute",
          strategyId: "intraday_scalp@10m",
          candidateId: "C1",
          zoneId: "Z1",
          setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
          setupGrade: "A+++",
          identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
          candidateIdentityVersion: "engine26.strategy1.v1",
          direction: "NEUTRAL",
          expectedReversalDirection: "SHORT",
          contactState: "SHORT_REVERSAL_WATCH",
          currentPrice: 7833.75,
        },

        confluence: {
          context: {
            reaction: {
              paperScalpReaction: {
                armed: true,
                reactionConfirmed: false,
                expectedReactionDirection: "SHORT",
              },
            },
            volume: {
              engine4AuthorizedReactionParticipation: {
                armed: true,
                participationConfirmed: false,
                intendedDirection: "SHORT",
              },
            },
          },
        },

        permission: {
          paper: {
            decision: "PAPER_STAND_DOWN",
            allowed: false,
            planningAllowed: false,
          },
        },

        engine26ProposedGeometry: {
          active: false,
          lifecycleStatus: "WAITING_FOR_DIRECTION",
        },
      },
    },
  };
}

test("V2 publishes all six degrees additively", () => {
  const result = buildEngine27TraderIntelligenceV2({
    snapshot: fixture(),
  });

  assert.deepEqual(result.degreeOrder, [
    "micro",
    "subminute",
    "minute",
    "minor",
    "intermediate",
    "primary",
  ]);

  assert.deepEqual(Object.keys(result.degrees), result.degreeOrder);
  assert.equal(result.compatibility.additiveOnly, true);
  assert.equal(result.compatibility.existingEngine27ContractsUntouched, true);
});

test("Micro preserves Engine 22 completion state and evidence freshness", () => {
  const result = buildEngine27TraderIntelligenceV2({
    snapshot: fixture(),
  });

  const micro = result.degrees.micro;

  assert.equal(micro.activeWave, "W2");
  assert.equal(micro.waveDirection, "DOWN");
  assert.equal(micro.currentCondition, "COMPLETION_CANDIDATE");
  assert.equal(micro.provenance.confirmationStatus, "W1_CONFIRMED_W2_PENDING");
  assert.notEqual(
    micro.currentCondition,
    micro.provenance.confirmationStatus
  );
  assert.equal(
    micro.provenance.freshness.evidenceTimestamp,
    "2026-10-09T01:25:00.000Z"
  );
  assert.ok(micro.confirmationNeeded.evidence.includes("FIVE_MIN_SWING_BREAK"));
  assert.equal(
    micro.provenance.sourceMap.activeWave,
    "engine22WaveStrategy.currentWavelength"
  );
  assert.equal(
    micro.provenance.sourceMap.waveDirection,
    "engine22WaveStrategy.engine22Display"
  );
  assert.equal(
    micro.provenance.sourceMap.currentCondition,
    "engine22WaveStrategy.currentWavelength.degrees.micro.microSequence"
  );
  assert.equal(
    micro.provenance.structuralSource,
    "ENGINE22_CANONICAL_COMPOSITE"
  );
});

test("Minute keeps Elliott direction separate from Strategy 1 direction", () => {
  const result = buildEngine27TraderIntelligenceV2({
    snapshot: fixture(),
  });

  const minute = result.degrees.minute;

  assert.equal(minute.waveDirection, "UP");
  assert.equal(minute.strategy1Readiness.strategyDirection, "NEUTRAL");
  assert.equal(minute.strategy1Readiness.expectedReversal, "SHORT");
  assert.equal(minute.strategy1Readiness.permission.allowed, false);
  assert.equal(minute.strategy1Readiness.noExecution, true);
});

test("V2 does not mutate the source snapshot", () => {
  const source = fixture();
  const before = structuredClone(source);

  buildEngine27TraderIntelligenceV2({ snapshot: source });

  assert.deepEqual(source, before);
});

test("candidate identity is carried read-only without alteration", () => {
  const result = buildEngine27TraderIntelligenceV2({
    snapshot: fixture(),
  });

  assert.deepEqual(
    result.degrees.minute.strategy1Readiness.candidateIdentity,
    {
      laneId: "minute",
      strategyId: "intraday_scalp@10m",
      candidateId: "C1",
      zoneId: "Z1",
      setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
      setupGrade: "A+++",
      identitySetupKey: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
      candidateIdentityVersion: "engine26.strategy1.v1",
    }
  );
});
