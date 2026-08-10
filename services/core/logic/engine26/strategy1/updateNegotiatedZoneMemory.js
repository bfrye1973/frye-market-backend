export const ENGINE26_RETIREMENT_REASONS = Object.freeze([
  "COMPLETED_CLOSE_INVALIDATION",
  "TARGET_ZONE_REACHED",
  "TARGET_APPROACH_COMPLETION",
  "OBJECTIVE_COMPLETED",
  "EXPLICIT_LIFECYCLE_PROMOTION",
  "EXPLICIT_RETIREMENT",
]);

export function buildStrategy1MemoryKey({
  laneId,
  symbol,
  strategyId,
  zoneId,
}) {
  return [laneId, symbol, strategyId, zoneId].join("::");
}

function clone(value) {
  return value == null
    ? value
    : JSON.parse(JSON.stringify(value));
}

function firstNonNull(...values) {
  return values.find(
    (value) => value !== null && value !== undefined
  ) ?? null;
}

function mergeBooleanTrue(previous, current) {
  return previous === true || current === true;
}

function mergeEarliest(previous, current) {
  if (!previous) return current || null;
  if (!current) return previous;
  return String(previous) <= String(current)
    ? previous
    : current;
}

function mergeLatest(previous, current) {
  if (!previous) return current || null;
  if (!current) return previous;
  return String(previous) >= String(current)
    ? previous
    : current;
}

function mergeMax(previous, current) {
  const a = Number(previous);
  const b = Number(current);

  if (!Number.isFinite(a)) {
    return Number.isFinite(b) ? b : previous ?? current ?? null;
  }

  if (!Number.isFinite(b)) return a;
  return Math.max(a, b);
}

function mergeMin(previous, current) {
  const a = Number(previous);
  const b = Number(current);

  if (!Number.isFinite(a)) {
    return Number.isFinite(b) ? b : previous ?? current ?? null;
  }

  if (!Number.isFinite(b)) return a;
  return Math.min(a, b);
}

function mergeObject(previous = {}, current = {}) {
  return {
    ...(clone(previous) || {}),
    ...(clone(current) || {}),
  };
}

function mergeLongFacts(previous = {}, current = {}) {
  return {
    ...mergeObject(previous, current),

    intrabarSweepObserved:
      mergeBooleanTrue(
        previous?.intrabarSweepObserved,
        current?.intrabarSweepObserved
      ),

    completedCandleSweepObserved:
      mergeBooleanTrue(
        previous?.completedCandleSweepObserved,
        current?.completedCandleSweepObserved
      ),

    latestSweepTime:
      mergeLatest(
        previous?.latestSweepTime,
        current?.latestSweepTime
      ),

    latestSweepLow:
      firstNonNull(
        current?.latestSweepLow,
        previous?.latestSweepLow
      ),

    maximumSweepDepthPoints:
      mergeMax(
        previous?.maximumSweepDepthPoints,
        current?.maximumSweepDepthPoints
      ),

    reclaimObserved:
      mergeBooleanTrue(
        previous?.reclaimObserved,
        current?.reclaimObserved
      ),

    completedReclaimObserved:
      mergeBooleanTrue(
        previous?.completedReclaimObserved,
        current?.completedReclaimObserved
      ),

    firstReclaimAt:
      mergeEarliest(
        previous?.firstReclaimAt,
        current?.firstReclaimAt
      ),

    latestReclaimAt:
      mergeLatest(
        previous?.latestReclaimAt,
        current?.latestReclaimAt
      ),

    currentReclaimSequence:
      mergeMax(
        previous?.currentReclaimSequence,
        current?.currentReclaimSequence
      ),

    latestReclaim:
      current?.latestReclaim ||
      previous?.latestReclaim ||
      null,
  };
}

function mergeShortFacts(previous = {}, current = {}) {
  return {
    ...mergeObject(previous, current),

    rejectionObserved:
      mergeBooleanTrue(
        previous?.rejectionObserved,
        current?.rejectionObserved
      ),

    completedRejectionObserved:
      mergeBooleanTrue(
        previous?.completedRejectionObserved,
        current?.completedRejectionObserved
      ),

    firstRejectionAt:
      mergeEarliest(
        previous?.firstRejectionAt,
        current?.firstRejectionAt
      ),

    latestRejectionAt:
      mergeLatest(
        previous?.latestRejectionAt,
        current?.latestRejectionAt
      ),

    maximumRejectionDepthPoints:
      mergeMax(
        previous?.maximumRejectionDepthPoints,
        current?.maximumRejectionDepthPoints
      ),

    completedFailedAcceptanceObserved:
      mergeBooleanTrue(
        previous?.completedFailedAcceptanceObserved,
        current?.completedFailedAcceptanceObserved
      ),

    firstFailedAcceptanceAt:
      mergeEarliest(
        previous?.firstFailedAcceptanceAt,
        current?.firstFailedAcceptanceAt
      ),

    latestFailedAcceptanceAt:
      mergeLatest(
        previous?.latestFailedAcceptanceAt,
        current?.latestFailedAcceptanceAt
      ),

    failedReclaimObserved:
      mergeBooleanTrue(
        previous?.failedReclaimObserved,
        current?.failedReclaimObserved
      ),

    firstFailedReclaimAt:
      mergeEarliest(
        previous?.firstFailedReclaimAt,
        current?.firstFailedReclaimAt
      ),

    latestFailedReclaimAt:
      mergeLatest(
        previous?.latestFailedReclaimAt,
        current?.latestFailedReclaimAt
      ),

    currentFailedReclaimSequence:
      mergeMax(
        previous?.currentFailedReclaimSequence,
        current?.currentFailedReclaimSequence
      ),

    latestFailedReclaim:
      current?.latestFailedReclaim ||
      previous?.latestFailedReclaim ||
      null,
  };
}

function mergeHoldFacts(previous = {}, current = {}) {
  return {
    ...mergeObject(previous, current),

    completedHoldObserved:
      mergeBooleanTrue(
        previous?.completedHoldObserved,
        current?.completedHoldObserved
      ),

    completedHoldCount:
      mergeMax(
        previous?.completedHoldCount,
        current?.completedHoldCount
      ),

    latestHoldTime:
      mergeLatest(
        previous?.latestHoldTime,
        current?.latestHoldTime
      ),

    latestHoldClose:
      firstNonNull(
        current?.latestHoldClose,
        previous?.latestHoldClose
      ),

    heldAboveReclaimBoundary:
      mergeBooleanTrue(
        previous?.heldAboveReclaimBoundary,
        current?.heldAboveReclaimBoundary
      ),

    heldAboveTriggerLevel:
      mergeBooleanTrue(
        previous?.heldAboveTriggerLevel,
        current?.heldAboveTriggerLevel
      ),

    heldBelowTriggerLevel:
      mergeBooleanTrue(
        previous?.heldBelowTriggerLevel,
        current?.heldBelowTriggerLevel
      ),

    heldBelowMidline:
      mergeBooleanTrue(
        previous?.heldBelowMidline,
        current?.heldBelowMidline
      ),

    lowestPriceSinceLatestReclaim:
      mergeMin(
        previous?.lowestPriceSinceLatestReclaim,
        current?.lowestPriceSinceLatestReclaim
      ),

    highestPriceSinceLatestEvidence:
      mergeMax(
        previous?.highestPriceSinceLatestEvidence,
        current?.highestPriceSinceLatestEvidence
      ),
  };
}

function mergeInvalidationFacts(previous = {}, current = {}) {
  const confirmed =
    previous?.completedCloseInvalidationConfirmed === true ||
    current?.completedCloseInvalidationConfirmed === true;

  return {
    ...mergeObject(previous, current),

    boundary:
      firstNonNull(current?.boundary, previous?.boundary),

    direction:
      firstNonNull(current?.direction, previous?.direction),

    intrabarInvalidationBreachObserved:
      mergeBooleanTrue(
        previous?.intrabarInvalidationBreachObserved,
        current?.intrabarInvalidationBreachObserved
      ),

    completedCloseInvalidationConfirmed: confirmed,

    invalidationTime:
      confirmed
        ? mergeEarliest(
            previous?.invalidationTime,
            current?.invalidationTime
          )
        : null,

    invalidationClose:
      confirmed
        ? firstNonNull(
            previous?.invalidationClose,
            current?.invalidationClose
          )
        : null,
  };
}

function mergeLifecycleFacts(previous = {}, current = {}) {
  return {
    ...mergeObject(previous, current),

    setupDeveloping:
      mergeBooleanTrue(
        previous?.setupDeveloping,
        current?.setupDeveloping
      ),

    reactionEvaluationFactsReady:
      mergeBooleanTrue(
        previous?.reactionEvaluationFactsReady,
        current?.reactionEvaluationFactsReady
      ),
  };
}

const CONTACT_STATE_RANK = Object.freeze({
  NO_CONTACT: 0,
  TARGET_ZONE_ENTRY: 1,
  NEGOTIATED_LINE_CONTACT: 2,
});

const ROTATION_COMPLETION_RANK = Object.freeze({
  ACTIVE_ROTATION: 0,
  PARTIAL_PROFIT_TAKING: 1,
  FULL_TARGET_COMPLETION: 2,
});

function normalizeLifecycleText(value) {
  return String(value || "").trim().toUpperCase();
}

function mergeRankedLifecycleValue({
  previous,
  current,
  rankMap,
  fallback = null,
}) {
  const previousKey = normalizeLifecycleText(previous);
  const currentKey = normalizeLifecycleText(current);

  const previousRank =
    Object.prototype.hasOwnProperty.call(rankMap, previousKey)
      ? rankMap[previousKey]
      : -1;

  const currentRank =
    Object.prototype.hasOwnProperty.call(rankMap, currentKey)
      ? rankMap[currentKey]
      : -1;

  if (currentRank > previousRank) {
    return current || fallback;
  }

  if (previousRank >= 0) {
    return previous || fallback;
  }

  return firstNonNull(current, previous, fallback);
}

function preserveEstablishedLifecycleValue(previous, current) {
  return firstNonNull(previous, current);
}

function preserveEstablishedObject(previous, current) {
  return clone(previous) || clone(current) || null;
}

function locationEventMatchesCandidate(event, candidate) {
  if (!event || !candidate) return false;

  const eventZone = event?.zone || {};
  const candidateZone = candidate?.entryZone || {};

  return (
    event?.candidateId === candidate?.candidateId &&
    event?.zoneId === candidate?.zoneId &&
    event?.laneId === (candidate?.laneId || "minute") &&
    event?.strategyId === candidate?.strategyId &&
    String(event?.symbol || "").toUpperCase() ===
      String(candidate?.symbol || "").toUpperCase() &&
    event?.candidateIdentityVersion ===
      candidate?.candidateIdentityVersion &&
    Number(eventZone?.lo) === Number(candidateZone?.low) &&
    Number(eventZone?.midline) === Number(candidateZone?.midline) &&
    Number(eventZone?.hi) === Number(candidateZone?.high)
  );
}

function resolvePersistedLocationEvent({
  previousEvent,
  candidate,
  currentEvent,
}) {
  if (
    currentEvent &&
    locationEventMatchesCandidate(currentEvent, candidate)
  ) {
    return clone(currentEvent);
  }

  if (
    previousEvent &&
    locationEventMatchesCandidate(previousEvent, candidate)
  ) {
    return clone(previousEvent);
  }

  return null;
}

export function updateNegotiatedZoneMemory({
  store,
  memoryKey,
  candidate,
  facts,
  snapshotTime,
  lifecycleUpdate = null,
} = {}) {
  const records = { ...(store?.records || {}) };
  const previous = clone(records[memoryKey] || null);

  const interactionTimes = [
    ...(Array.isArray(previous?.interactionTimes)
      ? previous.interactionTimes
      : []),
    ...(Array.isArray(
      facts?.interactionFacts?.interactionTimes
    )
      ? facts.interactionFacts.interactionTimes
      : []),
  ];

  const uniqueInteractionTimes = [
    ...new Set(interactionTimes),
  ].sort();

  const mergedInvalidationFacts =
    mergeInvalidationFacts(
      previous?.invalidationFacts,
      facts?.invalidationFacts
    );

  const invalidated =
    mergedInvalidationFacts
      ?.completedCloseInvalidationConfirmed === true;

  const requestedLifecycleStatus =
    lifecycleUpdate?.lifecycleStatus || null;

  const releaseReason =
    lifecycleUpdate?.releaseReason || null;

  const record = {
    memoryKey,
    laneId: candidate?.laneId || "minute",
    symbol: candidate?.symbol || "ES",
    strategyId: candidate?.strategyId || null,
    zoneId: candidate?.zoneId || null,
    direction:
      (
        previous?.contactState === "NEGOTIATED_LINE_CONTACT" ||
        lifecycleUpdate?.contactState === "NEGOTIATED_LINE_CONTACT" ||
        candidate?.contactState === "NEGOTIATED_LINE_CONTACT"
      )
        ? "NEUTRAL"
        : (
            candidate?.directionBias ??
            candidate?.direction ??
            previous?.direction ??
            null
          ),
    setupClass:
      candidate?.setupClass ??
      previous?.setupClass ??
      null,
    setupGrade:
      candidate?.setupGrade ??
      previous?.setupGrade ??
      null,
    identitySetupKey:
      candidate?.identitySetupKey ??
      previous?.identitySetupKey ??
      null,

    originalCandidateId:
      previous?.originalCandidateId ||
      candidate?.candidateId ||
      null,

    currentCandidateId:
      candidate?.candidateId ||
      previous?.currentCandidateId ||
      null,

    candidateIdentityVersion:
      candidate?.candidateIdentityVersion ||
      previous?.candidateIdentityVersion ||
      null,

    candidateLifecycleStartTime:
      candidate?.candidateLifecycleStartTime ||
      previous?.candidateLifecycleStartTime ||
      snapshotTime,

    directionResolvedAt:
      candidate?.directionResolvedAt ||
      previous?.directionResolvedAt ||
      null,

    contactState:
      mergeRankedLifecycleValue({
        previous: previous?.contactState,
        current:
          lifecycleUpdate?.contactState ??
          candidate?.contactState,
        rankMap: CONTACT_STATE_RANK,
        fallback: null,
      }),

    chainArmed:
      mergeBooleanTrue(
        previous?.chainArmed,
        lifecycleUpdate?.chainArmed ??
          candidate?.chainArmed
      ),

    directionBias:
      firstNonNull(
        lifecycleUpdate?.directionBias,
        candidate?.directionBias,
        previous?.directionBias,
        candidate?.direction,
        previous?.direction
      ),

    directionalResolved:
      previous?.contactState === "NEGOTIATED_LINE_CONTACT" ||
      lifecycleUpdate?.contactState === "NEGOTIATED_LINE_CONTACT" ||
      candidate?.contactState === "NEGOTIATED_LINE_CONTACT"
        ? false
        : (
            lifecycleUpdate?.directionalResolved ??
            candidate?.directionalResolved ??
            previous?.directionalResolved ??
            false
          ),

    directionState:
      preserveEstablishedLifecycleValue(
        previous?.directionState,
        lifecycleUpdate?.directionState ??
          candidate?.directionState
      ),

    expectedReversalDirection:
      preserveEstablishedLifecycleValue(
        previous?.expectedReversalDirection,
        lifecycleUpdate?.expectedReversalDirection ??
          candidate?.expectedReversalDirection
      ),

    expectedParticipationDirection:
      preserveEstablishedLifecycleValue(
        previous?.expectedParticipationDirection,
        lifecycleUpdate?.expectedParticipationDirection ??
          candidate?.expectedParticipationDirection
      ),

    targetZoneEntryTouched:
      mergeBooleanTrue(
        previous?.targetZoneEntryTouched,
        lifecycleUpdate?.targetZoneEntryTouched ??
          candidate?.targetZoneEntryTouched
      ),

    targetMidlineReached:
      mergeBooleanTrue(
        previous?.targetMidlineReached,
        lifecycleUpdate?.targetMidlineReached ??
          candidate?.targetMidlineReached
      ),

    priorRotationCompletionState:
      mergeRankedLifecycleValue({
        previous:
          previous?.priorRotationCompletionState,
        current:
          lifecycleUpdate?.priorRotationCompletionState ??
          candidate?.priorRotationCompletionState,
        rankMap: ROTATION_COMPLETION_RANK,
        fallback: null,
      }),

    priorRotationFullyComplete:
      mergeBooleanTrue(
        previous?.priorRotationFullyComplete,
        lifecycleUpdate?.priorRotationFullyComplete ??
          candidate?.priorRotationFullyComplete
      ),

    remainingRunnerExpected:
      (
        previous?.priorRotationFullyComplete === true ||
        lifecycleUpdate?.priorRotationFullyComplete === true ||
        candidate?.priorRotationFullyComplete === true
      )
        ? false
        : firstNonNull(
            lifecycleUpdate?.remainingRunnerExpected,
            candidate?.remainingRunnerExpected,
            previous?.remainingRunnerExpected
          ),

    completionBoundary:
      preserveEstablishedLifecycleValue(
        previous?.completionBoundary,
        lifecycleUpdate?.completionBoundary ??
          candidate?.completionBoundary
      ),

    completedTargetZoneId:
      preserveEstablishedLifecycleValue(
        previous?.completedTargetZoneId,
        lifecycleUpdate?.completedTargetZoneId ??
          candidate?.completedTargetZoneId
      ),

    completedTargetZone:
      preserveEstablishedObject(
        previous?.completedTargetZone,
        lifecycleUpdate?.completedTargetZone ??
          candidate?.completedTargetZone
      ),

    priorCandidateId:
      preserveEstablishedLifecycleValue(
        previous?.priorCandidateId,
        lifecycleUpdate?.priorCandidateId ??
          candidate?.priorCandidateId
      ),

    priorZoneId:
      preserveEstablishedLifecycleValue(
        previous?.priorZoneId,
        lifecycleUpdate?.priorZoneId ??
          candidate?.priorZoneId
      ),

    priorRotationDirection:
      preserveEstablishedLifecycleValue(
        previous?.priorRotationDirection,
        lifecycleUpdate?.priorRotationDirection ??
          candidate?.priorRotationDirection
      ),

    promotionReason:
      preserveEstablishedLifecycleValue(
        previous?.promotionReason,
        lifecycleUpdate?.promotionReason ??
          candidate?.promotionReason
      ),

    promotedFromTargetCompletion:
      mergeBooleanTrue(
        previous?.promotedFromTargetCompletion,
        lifecycleUpdate?.promotedFromTargetCompletion ??
          candidate?.promotedFromTargetCompletion
      ),

    targetZoneEntryTouchedAt:
      mergeEarliest(
        previous?.targetZoneEntryTouchedAt,
        lifecycleUpdate?.targetZoneEntryTouchedAt ??
          candidate?.targetZoneEntryTouchedAt
      ),

    targetMidlineReachedAt:
      mergeEarliest(
        previous?.targetMidlineReachedAt,
        lifecycleUpdate?.targetMidlineReachedAt ??
          candidate?.targetMidlineReachedAt
      ),

    promotionTime:
      mergeEarliest(
        previous?.promotionTime,
        lifecycleUpdate?.promotionTime ??
          candidate?.promotionTime
      ),

    profitObjectiveReachedAt:
      mergeEarliest(
        previous?.profitObjectiveReachedAt,
        lifecycleUpdate?.profitObjectiveReachedAt ??
          candidate?.profitObjectiveReachedAt
      ),

    identityAdoptedFromLegacy:
      candidate?.identityAdoptedFromLegacy === true,

    identityAdoptedFromPreviousV2:
      candidate?.identityAdoptedFromPreviousV2 === true,

    legacyCandidateId:
      candidate?.legacyCandidateId ||
      previous?.legacyCandidateId ||
      null,

    adoptedAt:
      (
        candidate?.identityAdoptedFromLegacy === true ||
        candidate?.identityAdoptedFromPreviousV2 === true
      )
        ? previous?.adoptedAt || snapshotTime
        : previous?.adoptedAt || null,

    candidateFirstSeenAt:
      previous?.candidateFirstSeenAt || snapshotTime,

    firstInteractionAt:
      previous?.firstInteractionAt ||
      uniqueInteractionTimes[0] ||
      null,

    lastInteractionAt:
      uniqueInteractionTimes[
        uniqueInteractionTimes.length - 1
      ] ||
      previous?.lastInteractionAt ||
      null,

    lastSeenAt: snapshotTime,

    interactionTimes: uniqueInteractionTimes,
    interactionCount: uniqueInteractionTimes.length,

    sweepFacts: mergeLongFacts(
      previous?.sweepFacts,
      facts?.sweepFacts
    ),

    lowerWickFacts:
      mergeObject(
        previous?.lowerWickFacts,
        facts?.lowerWickFacts
      ),

    reclaimFacts: mergeLongFacts(
      previous?.reclaimFacts,
      facts?.reclaimFacts
    ),

    postReclaimFacts: mergeHoldFacts(
      previous?.postReclaimFacts,
      facts?.postReclaimFacts
    ),

    rejectionFacts: mergeShortFacts(
      previous?.rejectionFacts,
      facts?.rejectionFacts
    ),

    upperWickFacts:
      mergeObject(
        previous?.upperWickFacts,
        facts?.upperWickFacts
      ),

    failedAcceptanceFacts: mergeShortFacts(
      previous?.failedAcceptanceFacts,
      facts?.failedAcceptanceFacts
    ),

    failedReclaimFacts: mergeShortFacts(
      previous?.failedReclaimFacts,
      facts?.failedReclaimFacts
    ),

    postRejectionFacts: mergeHoldFacts(
      previous?.postRejectionFacts,
      facts?.postRejectionFacts
    ),

    invalidationFacts: mergedInvalidationFacts,

    lifecycleFacts: mergeLifecycleFacts(
      previous?.lifecycleFacts,
      facts?.lifecycleFacts
    ),

    locationEvent:
      resolvePersistedLocationEvent({
        previousEvent: previous?.locationEvent,
        candidate,
        currentEvent: candidate?.locationEvent,
      }),

    targetZone:
      clone(candidate?.targetZone) ||
      previous?.targetZone ||
      null,

    proposedEntryPrice:
      candidate?.entryZone?.midline ??
      previous?.proposedEntryPrice ??
      null,

    maximumFavorableExcursionPoints:
      firstNonNull(
        lifecycleUpdate
          ?.maximumFavorableExcursionPoints,
        previous
          ?.maximumFavorableExcursionPoints
      ),

    targetTouchedAt:
      lifecycleUpdate?.targetTouchedAt ||
      previous?.targetTouchedAt ||
      null,

    targetApproachAt:
      lifecycleUpdate?.targetApproachAt ||
      previous?.targetApproachAt ||
      null,

    objectiveCompletedAt:
      lifecycleUpdate?.objectiveCompletedAt ||
      previous?.objectiveCompletedAt ||
      null,

    lifecycleStatus:
      invalidated
        ? "INVALIDATED"
        : requestedLifecycleStatus ||
          (
            previous?.lifecycleStatus === "RETIRED"
              ? "RETIRED"
              : "ACTIVE"
          ),

    releaseReason:
      invalidated
        ? "COMPLETED_CLOSE_INVALIDATION"
        : releaseReason ||
          previous?.releaseReason ||
          null,

    invalidatedAt:
      invalidated
        ? mergedInvalidationFacts?.invalidationTime ||
          previous?.invalidatedAt ||
          snapshotTime
        : previous?.invalidatedAt || null,

    retiredAt:
      requestedLifecycleStatus === "RETIRED"
        ? lifecycleUpdate?.retiredAt ||
          previous?.retiredAt ||
          snapshotTime
        : previous?.retiredAt || null,
  };

  records[memoryKey] = record;

  return {
    store: {
      schema:
        store?.schema ||
        "engine26.negotiatedZoneMemory.v1",
      updatedAt: snapshotTime,
      records,
    },
    record,
  };
}

export function retirePriorMemoryRecord({
  store,
  priorMemoryKey,
  retiredAt,
  retirementReason,
} = {}) {
  if (
    !priorMemoryKey ||
    !store?.records?.[priorMemoryKey]
  ) {
    return store;
  }

  if (
    !ENGINE26_RETIREMENT_REASONS.includes(
      retirementReason
    )
  ) {
    return store;
  }

  const previous =
    store.records[priorMemoryKey];

  const alreadyInvalidated =
    previous.lifecycleStatus === "INVALIDATED" ||
    previous?.invalidationFacts
      ?.completedCloseInvalidationConfirmed === true;

  return {
    ...store,
    records: {
      ...store.records,
      [priorMemoryKey]: {
        ...previous,

        retiredAt:
          alreadyInvalidated
            ? previous.retiredAt || null
            : retiredAt,

        lifecycleStatus:
          alreadyInvalidated
            ? "INVALIDATED"
            : "RETIRED",

        releaseReason:
          alreadyInvalidated
            ? "COMPLETED_CLOSE_INVALIDATION"
            : retirementReason,
      },
    },
  };
}
