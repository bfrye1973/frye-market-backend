export function buildStrategy1MemoryKey({ laneId, symbol, strategyId, zoneId }) {
  return [laneId, symbol, strategyId, zoneId].join("::");
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function updateNegotiatedZoneMemory({
  store,
  memoryKey,
  candidate,
  facts,
  snapshotTime,
} = {}) {
  const records = { ...(store?.records || {}) };
  const previous = clone(records[memoryKey] || null);

  const interactionTimes = [
    ...(Array.isArray(previous?.interactionTimes) ? previous.interactionTimes : []),
    ...(Array.isArray(facts?.interactionFacts?.interactionTimes)
      ? facts.interactionFacts.interactionTimes
      : []),
  ];

  const uniqueInteractionTimes = [...new Set(interactionTimes)].sort();
  const invalidated = facts?.invalidationFacts?.completedCloseInvalidationConfirmed === true;

  const record = {
    memoryKey,
    laneId: candidate?.laneId || "minute",
    symbol: candidate?.symbol || "ES",
    strategyId: candidate?.strategyId || null,
    zoneId: candidate?.zoneId || null,

    originalCandidateId:
      previous?.originalCandidateId || candidate?.candidateId || null,
    currentCandidateId: candidate?.candidateId || null,
    candidateIdentityVersion: candidate?.candidateIdentityVersion || null,
    identityAdoptedFromLegacy: candidate?.identityAdoptedFromLegacy === true,
    legacyCandidateId: candidate?.legacyCandidateId || null,
    adoptedAt:
      candidate?.identityAdoptedFromLegacy === true
        ? previous?.adoptedAt || snapshotTime
        : previous?.adoptedAt || null,

    candidateFirstSeenAt: previous?.candidateFirstSeenAt || snapshotTime,
    firstInteractionAt:
      previous?.firstInteractionAt || uniqueInteractionTimes[0] || null,
    lastInteractionAt:
      uniqueInteractionTimes[uniqueInteractionTimes.length - 1] ||
      previous?.lastInteractionAt ||
      null,
    lastSeenAt: snapshotTime,

    interactionTimes: uniqueInteractionTimes,
    interactionCount: uniqueInteractionTimes.length,

    sweepFacts: clone(facts?.sweepFacts || {}),
    lowerWickFacts: clone(facts?.lowerWickFacts || {}),
    reclaimFacts: clone(facts?.reclaimFacts || {}),
    postReclaimFacts: clone(facts?.postReclaimFacts || {}),
    invalidationFacts: clone(facts?.invalidationFacts || {}),

    lifecycleStatus: invalidated ? "INVALIDATED" : "ACTIVE",
    invalidatedAt:
      invalidated
        ? facts?.invalidationFacts?.invalidationTime || snapshotTime
        : previous?.invalidatedAt || null,
    retiredAt: previous?.retiredAt || null,
  };

  records[memoryKey] = record;

  return {
    store: {
      schema: store?.schema || "engine26.negotiatedZoneMemory.v1",
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
} = {}) {
  if (!priorMemoryKey || !store?.records?.[priorMemoryKey]) return store;

  return {
    ...store,
    records: {
      ...store.records,
      [priorMemoryKey]: {
        ...store.records[priorMemoryKey],
        retiredAt,
        lifecycleStatus:
          store.records[priorMemoryKey].lifecycleStatus === "INVALIDATED"
            ? "INVALIDATED"
            : "RETIRED",
      },
    },
  };
}
