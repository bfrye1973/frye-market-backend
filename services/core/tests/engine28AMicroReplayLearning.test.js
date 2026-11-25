import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMicroReplayLearningDataset,
  summarizeMicroReplayLearning,
} from "../logic/engine28a/buildMicroReplayLearning.js";

function snapshot({
  time,
  price,
  revision,
  timing = "TRANSITION_CONFIRMING",
  wave = "W3",
  direction = "UP",
  a2 = false,
  conflict = false,
} = {}) {
  return {
    snapshotTime:
      time,

    generatedAtUtc:
      time,

    dateYmd:
      time.slice(0, 10),

    currentPrice:
      price,

    strategies: {
      "intraday_scalp@10m": {
        engine22WaveStrategy: {
          microExecutionContext: {
            available: true,
            sourceCountId:
              "COUNT-1",
            canonicalStateVersion:
              2,
            revision,
            sourceTimestamp:
              time,
            activeWave:
              wave,
            waveDirection:
              direction,
            lifecycle:
              "DEVELOPING",
            microTimingState:
              timing,
            countStatus:
              "ACTIVE",
          },
        },

        engine22MicroNegotiatedMidlineConfluence:
          a2
            ? {
                active: true,
                quality: "A++",
                displayLabel:
                  "A++ TRADING HAPPENING",
                currentExactContact:
                  true,
                completedMidlineTouch:
                  true,
                trainingTags: [
                  "A2_MICRO_NEGOTIATED_MIDLINE",
                ],
              }
            : {
                active: false,
              },

        microPositionContext:
          conflict
            ? {
                positionConflict:
                  true,
                conflictSeverity:
                  "HIGH",
                doNotAddAgainstImpulse:
                  true,
                openPositionCount:
                  1,
                positions: [
                  {
                    tradeId:
                      "T1",
                    accountMode:
                      "PAPER",
                    direction:
                      direction === "UP"
                        ? "SHORT"
                        : "LONG",
                    remainingQty:
                      2,
                    averageEntry:
                      100,
                    conflictSeverity:
                      "HIGH",
                    positionTruthFreshness: {
                      status:
                        "NOT_REQUIRED",
                    },
                  },
                ],
              }
            : {
                positionConflict:
                  false,
              },

        engine26LocationCandidate: {
          candidateId:
            "C1",
          zoneId:
            "Z1",
          currentObservationDirection:
            direction === "UP"
              ? "LONG"
              : "SHORT",
        },

        confluence: {
          context: {
            reaction: {
              paperScalpReaction: {
                direction:
                  direction === "UP"
                    ? "LONG"
                    : "SHORT",
                allowed:
                  true,
                reactionConfirmed:
                  true,
                engine3Strategy1QualifiedForEngine6:
                  true,
              },
            },

            volume: {
              engine4AuthorizedReactionParticipation: {
                direction:
                  direction === "UP"
                    ? "LONG"
                    : "SHORT",
                allowed:
                  true,
                participationConfirmed:
                  true,
                hardBlocked:
                  false,
              },
            },
          },
        },

        permission: {
          paper: {
            direction:
              direction === "UP"
                ? "LONG"
                : "SHORT",
            allowed:
              true,
            decision:
              "PAPER_ALLOW",
          },
        },
      },
    },
  };
}

test("duplicate canonical observation does not manufacture training sample size", () => {
  const first =
    snapshot({
      time:
        "2026-10-09T15:00:00Z",
      price:
        100,
      revision:
        5,
      a2:
        true,
    });

  const duplicate =
    structuredClone(first);

  duplicate.generatedAtUtc =
    "2026-10-09T15:03:00Z";

  const future =
    snapshot({
      time:
        "2026-10-09T15:10:00Z",
      price:
        105,
      revision:
        6,
      timing:
        "SETUP_DEVELOPING",
    });

  const out =
    buildMicroReplayLearningDataset([
      first,
      duplicate,
      future,
    ]);

  assert.equal(
    out.events.filter(
      (event) =>
        event.a2Confluence != null
    ).length,
    1
  );
});

test("W3 transition computes 10m forward move in Micro direction", () => {
  const out =
    buildMicroReplayLearningDataset([
      snapshot({
        time:
          "2026-10-09T15:00:00Z",
        price: 100,
        revision: 1,
      }),
      snapshot({
        time:
          "2026-10-09T15:10:00Z",
        price: 106,
        revision: 2,
        timing:
          "SETUP_DEVELOPING",
      }),
    ]);

  const event =
    out.events[0];

  assert.equal(
    event.outcomes
      .plus10m
      .complete,
    true
  );

  assert.equal(
    event.outcomes
      .plus10m
      .moveInMicroDirectionPts,
    6
  );
});

test("position-conflict warning measures later move against open position", () => {
  const out =
    buildMicroReplayLearningDataset([
      snapshot({
        time:
          "2026-10-09T15:00:00Z",
        price: 100,
        revision: 1,
        conflict: true,
      }),
      snapshot({
        time:
          "2026-10-09T15:10:00Z",
        price: 107,
        revision: 2,
        timing:
          "SETUP_DEVELOPING",
      }),
    ]);

  const conflict =
    out.events.find(
      (event) =>
        event.positionConflict != null
    );

  assert.equal(
    conflict
      .conflictOutcome
      .plus10m
      .moveAgainstPositionPts,
    7
  );
});

test("summary separates A++ and W2-to-W3 transition groups", () => {
  const dataset =
    buildMicroReplayLearningDataset([
      snapshot({
        time:
          "2026-10-09T15:00:00Z",
        price: 100,
        revision: 1,
        a2: true,
      }),
      snapshot({
        time:
          "2026-10-09T15:10:00Z",
        price: 104,
        revision: 2,
        timing:
          "SETUP_DEVELOPING",
      }),
    ]);

  const summary =
    summarizeMicroReplayLearning(
      dataset
    );

  assert.equal(
    summary.groups
      .a2NegotiatedMidline
      .count,
    1
  );

  assert.equal(
    summary.groups
      .w2ToW3Transition
      .count,
    1
  );
});

test("training output cannot auto-promote rule changes", () => {
  const summary =
    summarizeMicroReplayLearning({
      events: [],
    });

  assert.equal(
    summary
      .recommendationPolicy
      .productionRuleChangesAllowed,
    false
  );

  assert.equal(
    summary
      .recommendationPolicy
      .output,
    "MEASUREMENT_ONLY"
  );
});
