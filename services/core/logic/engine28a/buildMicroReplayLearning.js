// Engine 28A — Micro Replay Learning v1
//
// Offline/read-only evaluator for canonical ES Replay snapshots.
//
// Goals:
// - measure whether Micro transition states, A++ negotiated-midline confluence,
//   and position-conflict warnings were useful after the fact
// - prevent duplicate cron snapshots from manufacturing sample size
// - keep training separate from production authority
//
// This module NEVER changes a production rule or threshold.

const HORIZONS_MINUTES = Object.freeze([
  10,
  30,
  60,
]);

function upper(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMs(value) {
  if (value == null || value === "") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12
      ? numeric
      : numeric * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function minuteStrategy(snapshot) {
  return (
    snapshot
      ?.strategies
      ?.[
        "intraday_scalp@10m"
      ] ||
    null
  );
}

function snapshotTimeMs(snapshot) {
  return (
    toMs(snapshot?.snapshotTime) ??
    toMs(snapshot?.generatedAtUtc) ??
    null
  );
}

function currentPrice(snapshot) {
  const strategy =
    minuteStrategy(snapshot);

  return (
    num(snapshot?.currentPrice) ??
    num(snapshot?.price) ??
    num(
      strategy
        ?.engine26LocationCandidate
        ?.currentPrice
    ) ??
    num(
      strategy
        ?.engine22WaveStrategy
        ?.currentPrice
    ) ??
    null
  );
}

function microContext(strategy) {
  return (
    strategy
      ?.engine22WaveStrategy
      ?.microExecutionContext ||
    null
  );
}

function eventIdentity({
  micro,
  strategy,
} = {}) {
  const countId =
    String(
      micro?.sourceCountId || ""
    ).trim();

  if (!countId) return null;

  return [
    countId,
    micro?.revision ?? "NO_REVISION",
    micro?.sourceTimestamp ?? "NO_SOURCE_TIMESTAMP",
    strategy
      ?.engine22MicroNegotiatedMidlineConfluence
      ?.active === true
      ? "A2_ACTIVE"
      : "A2_INACTIVE",
    strategy
      ?.microPositionContext
      ?.conflictSeverity ??
      "NO_POSITION_SEVERITY",
  ].join("|");
}

function microTradeDirection(micro) {
  const direction =
    upper(
      micro?.waveDirection
    );

  if (direction === "UP") return "LONG";
  if (direction === "DOWN") return "SHORT";

  return "NEUTRAL";
}

function signedMove({
  from,
  to,
  direction,
} = {}) {
  if (
    from == null ||
    to == null
  ) {
    return null;
  }

  if (direction === "LONG") {
    return Number(
      (to - from).toFixed(2)
    );
  }

  if (direction === "SHORT") {
    return Number(
      (from - to).toFixed(2)
    );
  }

  return null;
}

function findAtOrAfter(
  snapshots,
  targetMs,
  startIndex
) {
  for (
    let index = startIndex;
    index < snapshots.length;
    index += 1
  ) {
    const item =
      snapshots[index];

    if (
      item.timeMs != null &&
      item.timeMs >= targetMs &&
      item.price != null
    ) {
      return item;
    }
  }

  return null;
}

function sessionDate(snapshot) {
  const explicit =
    String(
      snapshot?.dateYmd || ""
    ).trim();

  if (explicit) {
    return explicit;
  }

  const fromArizonaTime =
    String(
      snapshot?.azTime || ""
    )
      .slice(0, 10)
      .trim();

  return fromArizonaTime || null;
}

function findEndOfSession(
  snapshots,
  eventIndex,
  eventSessionDate
) {
  let last = null;

  for (
    let index = eventIndex;
    index < snapshots.length;
    index += 1
  ) {
    const item =
      snapshots[index];

    if (
      item.sessionDate !==
      eventSessionDate
    ) {
      if (last) break;
      continue;
    }

    if (
      item.price != null
    ) {
      last = item;
    }
  }

  return last;
}

function excursionBetween({
  snapshots,
  fromIndex,
  toTimeMs,
  entryPrice,
  direction,
} = {}) {
  let favorable = null;
  let adverse = null;

  for (
    let index = fromIndex + 1;
    index < snapshots.length;
    index += 1
  ) {
    const item =
      snapshots[index];

    if (
      item.timeMs == null ||
      item.timeMs > toTimeMs
    ) {
      break;
    }

    if (item.price == null) continue;

    const move =
      signedMove({
        from:
          entryPrice,
        to:
          item.price,
        direction,
      });

    if (move == null) continue;

    favorable =
      favorable == null
        ? move
        : Math.max(
            favorable,
            move
          );

    adverse =
      adverse == null
        ? move
        : Math.min(
            adverse,
            move
          );
  }

  return {
    mfePts:
      favorable == null
        ? null
        : Number(
            Math.max(
              0,
              favorable
            ).toFixed(2)
          ),

    maePts:
      adverse == null
        ? null
        : Number(
            Math.max(
              0,
              -adverse
            ).toFixed(2)
          ),
  };
}

function positionConflictSnapshot(strategy) {
  const context =
    strategy?.microPositionContext ||
    null;

  if (
    !context ||
    context.positionConflict !== true
  ) {
    return null;
  }

  return {
    severity:
      upper(
        context.conflictSeverity
      ) || "UNKNOWN",

    doNotAddAgainstImpulse:
      context.doNotAddAgainstImpulse ===
      true,

    openPositionCount:
      num(
        context.openPositionCount
      ) ?? 0,

    positions:
      Array.isArray(
        context.positions
      )
        ? context.positions.map(
            (position) => ({
              tradeId:
                position?.tradeId ??
                null,
              accountMode:
                position?.accountMode ??
                null,
              journalAccount:
                position?.journalAccount ??
                null,
              direction:
                upper(
                  position?.direction
                ) || "UNKNOWN",
              remainingQty:
                num(
                  position
                    ?.remainingQty
                ),
              averageEntry:
                num(
                  position
                    ?.averageEntry
                ),
              pointsFromEntry:
                num(
                  position
                    ?.pointsFromEntry
                ),
              conflictSeverity:
                upper(
                  position
                    ?.conflictSeverity
                ) || "UNKNOWN",
              positionTruthStatus:
                position
                  ?.positionTruthFreshness
                  ?.status ??
                null,
            })
          )
        : [],
  };
}

function engineGateSummary(strategy) {
  const e26 =
    strategy
      ?.engine26LocationCandidate ||
    null;

  const e3 =
    strategy
      ?.confluence
      ?.context
      ?.reaction
      ?.paperScalpReaction ||
    null;

  const e4 =
    strategy
      ?.confluence
      ?.context
      ?.volume
      ?.engine4AuthorizedReactionParticipation ||
    null;

  const e6 =
    strategy
      ?.permission
      ?.paper ||
    null;

  return {
    engine26: {
      candidateId:
        e26?.candidateId ??
        null,
      zoneId:
        e26?.zoneId ??
        null,
      direction:
        e26
          ?.currentObservationDirection ??
        e26?.direction ??
        null,
      status:
        e26?.status ??
        null,
    },

    engine3: {
      direction:
        e3?.direction ??
        null,
      allowed:
        e3?.allowed === true,
      reactionConfirmed:
        e3?.reactionConfirmed ===
        true,
      qualifiedForEngine6:
        e3
          ?.engine3Strategy1QualifiedForEngine6 ===
        true,
    },

    engine4: {
      direction:
        e4?.direction ??
        null,
      allowed:
        e4?.allowed === true,
      participationConfirmed:
        e4
          ?.participationConfirmed ===
        true,
      hardBlocked:
        e4?.hardBlocked === true,
    },

    engine6: {
      direction:
        e6?.direction ??
        null,
      allowed:
        e6?.allowed === true,
      decision:
        e6?.decision ??
        null,
    },
  };
}

function buildEvent({
  snapshot,
  strategy,
  micro,
  index,
} = {}) {
  const a2 =
    strategy
      ?.engine22MicroNegotiatedMidlineConfluence ||
    null;

  const positionConflict =
    positionConflictSnapshot(
      strategy
    );

  const eventTypes = [];

  if (
    [
      "REVERSAL_WINDOW",
      "TRANSITION_CONFIRMING",
      "TIMING_READY",
    ].includes(
      upper(
        micro?.microTimingState
      )
    )
  ) {
    eventTypes.push(
      "MICRO_TIMING_EVENT"
    );
  }

  if (a2?.active === true) {
    eventTypes.push(
      "A2_NEGOTIATED_MIDLINE"
    );
  }

  if (positionConflict) {
    eventTypes.push(
      "POSITION_CONFLICT"
    );
  }

  if (eventTypes.length === 0) {
    return null;
  }

  return {
    eventIndex:
      index,

    eventId:
      eventIdentity({
        micro,
        strategy,
      }),

    eventTypes,

    timeMs:
      snapshot.timeMs,

    time:
      snapshot.snapshotTime,

    sessionDate:
      snapshot.sessionDate,

    price:
      snapshot.price,

    sourceCountId:
      micro?.sourceCountId ??
      null,

    revision:
      micro?.revision ??
      null,

    sourceTimestamp:
      micro?.sourceTimestamp ??
      null,

    activeWave:
      micro?.activeWave ??
      null,

    lifecycle:
      micro?.lifecycle ??
      null,

    microTimingState:
      micro?.microTimingState ??
      null,

    microDirection:
      microTradeDirection(
        micro
      ),

    a2Confluence:
      a2?.active === true
        ? {
            quality:
              a2?.quality ??
              null,
            displayLabel:
              a2?.displayLabel ??
              null,
            distanceToMidline:
              num(
                a2
                  ?.distanceToMidline
              ),
            currentlyNearMidline:
              a2
                ?.currentlyNearMidline ===
              true,
            currentExactContact:
              a2
                ?.currentExactContact ===
              true,
            completedMidlineTouch:
              a2
                ?.completedMidlineTouch ===
              true,
            trainingTags:
              Array.isArray(
                a2?.trainingTags
              )
                ? [
                    ...a2.trainingTags,
                  ]
                : [],
          }
        : null,

    positionConflict,

    gates:
      engineGateSummary(
        strategy
      ),
  };
}

export function buildMicroReplayLearningDataset(
  rawSnapshots = []
) {
  const snapshots =
    (Array.isArray(rawSnapshots)
      ? rawSnapshots
      : [])
      .map((snapshot) => ({
        raw: snapshot,
        strategy:
          minuteStrategy(snapshot),
        timeMs:
          snapshotTimeMs(snapshot),
        snapshotTime:
          snapshot?.snapshotTime ??
          snapshot?.generatedAtUtc ??
          null,
        sessionDate:
          sessionDate(snapshot),
        price:
          currentPrice(snapshot),
      }))
      .filter(
        (item) =>
          item.timeMs != null &&
          item.strategy != null
      )
      .sort(
        (a, b) =>
          a.timeMs - b.timeMs
      );

  const events = [];
  const seen = new Set();

  for (
    let index = 0;
    index < snapshots.length;
    index += 1
  ) {
    const item =
      snapshots[index];

    const micro =
      microContext(
        item.strategy
      );

    if (
      !micro ||
      micro?.sourceCountId == null
    ) {
      continue;
    }

    const event =
      buildEvent({
        snapshot: item,
        strategy:
          item.strategy,
        micro,
        index,
      });

    if (!event?.eventId) {
      continue;
    }

    if (
      seen.has(
        event.eventId
      )
    ) {
      continue;
    }

    seen.add(
      event.eventId
    );

    const outcomes = {};

    for (
      const minutes of
      HORIZONS_MINUTES
    ) {
      const targetMs =
        event.timeMs +
        minutes * 60_000;

      const future =
        findAtOrAfter(
          snapshots,
          targetMs,
          index + 1
        );

      const closeMove =
        future
          ? signedMove({
              from:
                event.price,
              to:
                future.price,
              direction:
                event.microDirection,
            })
          : null;

      const excursion =
        excursionBetween({
          snapshots,
          fromIndex:
            index,
          toTimeMs:
            targetMs,
          entryPrice:
            event.price,
          direction:
            event.microDirection,
        });

      outcomes[
        `plus${minutes}m`
      ] = {
        complete:
          future != null,

        targetTime:
          new Date(
            targetMs
          ).toISOString(),

        observedAt:
          future?.snapshotTime ??
          null,

        observedPrice:
          future?.price ??
          null,

        moveInMicroDirectionPts:
          closeMove,

        mfePts:
          excursion.mfePts,

        maePts:
          excursion.maePts,
      };
    }

    const eos =
      findEndOfSession(
        snapshots,
        index,
        event.sessionDate
      );

    outcomes.endOfSession = {
      complete:
        eos != null &&
        eos.timeMs >
          event.timeMs,

      observedAt:
        eos?.snapshotTime ??
        null,

      observedPrice:
        eos?.price ??
        null,

      moveInMicroDirectionPts:
        eos &&
        eos.timeMs >
          event.timeMs
          ? signedMove({
              from:
                event.price,
              to:
                eos.price,
              direction:
                event.microDirection,
            })
          : null,
    };

    const conflictDirections =
      event
        ?.positionConflict
        ?.positions
        ?.map(
          (position) =>
            position.direction
        )
        .filter(
          (direction) =>
            ["LONG", "SHORT"].includes(
              direction
            )
        ) ||
      [];

    const conflictOutcome = {};

    if (
      conflictDirections.length >
      0
    ) {
      const positionDirection =
        conflictDirections[0];

      for (
        const minutes of
        HORIZONS_MINUTES
      ) {
        const future =
          findAtOrAfter(
            snapshots,
            event.timeMs +
              minutes * 60_000,
            index + 1
          );

        conflictOutcome[
          `plus${minutes}m`
        ] = {
          complete:
            future != null,

          moveForPositionPts:
            future
              ? signedMove({
                  from:
                    event.price,
                  to:
                    future.price,
                  direction:
                    positionDirection,
                })
              : null,

          moveAgainstPositionPts:
            future
              ? signedMove({
                  from:
                    event.price,
                  to:
                    future.price,
                  direction:
                    positionDirection ===
                      "LONG"
                      ? "SHORT"
                      : "LONG",
                })
              : null,
        };
      }
    }

    events.push({
      ...event,
      outcomes,
      conflictOutcome,
    });
  }

  return {
    version:
      "engine28a.microReplayLearning.v1",

    snapshotCount:
      snapshots.length,

    uniqueEventCount:
      events.length,

    events,

    safety: {
      readOnly:
        true,
      productionRulesModified:
        false,
      autoOptimizationEnabled:
        false,
      managerApprovalRequiredForPromotion:
        true,
    },

    reasonCodes: [
      "CANONICAL_MICRO_EVENT_DEDUPLICATION_ENABLED",
      "OFFLINE_REPLAY_EVALUATION_ONLY",
      "NO_LOOKAHEAD_IN_EVENT_CLASSIFICATION",
      "NO_AUTOMATIC_RULE_CHANGES",
      "MANAGER_APPROVAL_REQUIRED",
    ],
  };
}

function average(
  values
) {
  const clean =
    values.filter(
      (value) =>
        Number.isFinite(
          Number(value)
        )
    );

  if (clean.length === 0) {
    return null;
  }

  return Number(
    (
      clean.reduce(
        (sum, value) =>
          sum +
          Number(value),
        0
      ) /
      clean.length
    ).toFixed(2)
  );
}

export function summarizeMicroReplayLearning(
  dataset
) {
  const events =
    Array.isArray(
      dataset?.events
    )
      ? dataset.events
      : [];

  const groups = {
    all: events,

    a2:
      events.filter(
        (event) =>
          event
            ?.a2Confluence != null
      ),

    positionConflict:
      events.filter(
        (event) =>
          event
            ?.positionConflict != null
      ),

    w2ToW3:
      events.filter(
        (event) =>
          upper(
            event?.activeWave
          ) === "W3" &&
          [
            "TRANSITION_CONFIRMING",
            "TIMING_READY",
          ].includes(
            upper(
              event
                ?.microTimingState
            )
          )
      ),

    w4ToW5:
      events.filter(
        (event) =>
          upper(
            event?.activeWave
          ) === "W5" &&
          [
            "TRANSITION_CONFIRMING",
            "TIMING_READY",
          ].includes(
            upper(
              event
                ?.microTimingState
            )
          )
      ),
  };

  const summarizeGroup =
    (rows) => {
      const result = {
        count:
          rows.length,
      };

      for (
        const minutes of
        HORIZONS_MINUTES
      ) {
        const key =
          `plus${minutes}m`;

        const complete =
          rows.filter(
            (row) =>
              row
                ?.outcomes
                ?.[key]
                ?.complete ===
              true
          );

        const moves =
          complete.map(
            (row) =>
              row
                ?.outcomes
                ?.[key]
                ?.moveInMicroDirectionPts
          );

        const mfe =
          complete.map(
            (row) =>
              row
                ?.outcomes
                ?.[key]
                ?.mfePts
          );

        const mae =
          complete.map(
            (row) =>
              row
                ?.outcomes
                ?.[key]
                ?.maePts
          );

        result[key] = {
          evaluatedCount:
            complete.length,

          averageMoveInMicroDirectionPts:
            average(moves),

          continuationRatePct:
            complete.length > 0
              ? Number(
                  (
                    (
                      moves.filter(
                        (move) =>
                          Number(move) >
                          0
                      ).length /
                      complete.length
                    ) *
                    100
                  ).toFixed(2)
                )
              : null,

          averageMfePts:
            average(mfe),

          averageMaePts:
            average(mae),
        };
      }

      return result;
    };

  const conflictRows =
    groups.positionConflict;

  const conflictUsefulness = {};

  for (
    const minutes of
    HORIZONS_MINUTES
  ) {
    const key =
      `plus${minutes}m`;

    const evaluated =
      conflictRows.filter(
        (row) =>
          row
            ?.conflictOutcome
            ?.[key]
            ?.complete ===
          true
      );

    const adverseMoves =
      evaluated.map(
        (row) =>
          row
            ?.conflictOutcome
            ?.[key]
            ?.moveAgainstPositionPts
      );

    conflictUsefulness[key] = {
      evaluatedCount:
        evaluated.length,

      averageMoveAgainstPositionPts:
        average(
          adverseMoves
        ),

      warningCorrectDirectionPct:
        evaluated.length > 0
          ? Number(
              (
                (
                  adverseMoves.filter(
                    (move) =>
                      Number(move) >
                      0
                  ).length /
                  evaluated.length
                ) *
                100
              ).toFixed(2)
            )
          : null,
    };
  }

  return {
    version:
      "engine28a.microReplayLearningSummary.v1",

    totalUniqueEvents:
      events.length,

    groups: {
      all:
        summarizeGroup(
          groups.all
        ),

      a2NegotiatedMidline:
        summarizeGroup(
          groups.a2
        ),

      positionConflict:
        summarizeGroup(
          groups.positionConflict
        ),

      w2ToW3Transition:
        summarizeGroup(
          groups.w2ToW3
        ),

      w4ToW5Transition:
        summarizeGroup(
          groups.w4ToW5
        ),
    },

    conflictUsefulness,

    recommendationPolicy: {
      productionRuleChangesAllowed:
        false,

      output:
        "MEASUREMENT_ONLY",

      nextStep:
        "MANAGER_REVIEW_AFTER_SUFFICIENT_SAMPLE_AND_OUT_OF_SAMPLE_VALIDATION",
    },

    reasonCodes: [
      "TRAINING_AND_VALIDATION_MUST_REMAIN_SEPARATE",
      "NO_SMALL_SAMPLE_EDGE_CLAIM",
      "NO_AUTOMATIC_PRODUCTION_PROMOTION",
    ],
  };
}

export default {
  buildMicroReplayLearningDataset,
  summarizeMicroReplayLearning,
};
