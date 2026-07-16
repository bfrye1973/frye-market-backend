// services/core/logic/engine3/engine26LocationReactionContext.js
//
// Engine 3 helper for reading the authorized Engine 26 location.
//
// Primary source:
//   engine26ReactionHandoff
//
// Legacy compatibility source:
//   engine26StructuralContext.locationContext
//
// Ownership:
//   Engine 3 answers:
//   "What did price do at the authorized Engine 26 location?"
//
// This helper:
// - preserves candidateId and zoneId
// - returns WAITING_FOR_ENGINE26_LOCATION when no authorized handoff exists
// - evaluates only the location authorized by Engine 26
// - preserves legacy Engine 26 structural-context behavior
// - does not create permission
// - does not create execution

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function validPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function validBoolean(value) {
  return value === true;
}

function normalizeExpectedReactions(value) {
  return Array.isArray(value)
    ? value
        .map((item) => safeUpper(item, ""))
        .filter(Boolean)
    : [];
}

function normalizeZoneFromHandoff(handoff) {
  const zone = handoff?.zone || null;

  if (!zone || typeof zone !== "object") {
    return null;
  }

  const lo = validPrice(zone.lo);
  const hi = validPrice(zone.hi);
  const mid =
    validPrice(zone.mid) ??
    (
      lo != null && hi != null
        ? Number(((lo + hi) / 2).toFixed(2))
        : null
    );

  return {
    source: zone.source || null,
    sourcePath: zone.sourcePath || null,
    type: zone.type || null,
    timeframe: zone.timeframe || null,
    lo,
    hi,
    mid,
    relation: zone.relation || null,
    distancePoints:
      Number.isFinite(Number(zone.distancePoints))
        ? Number(zone.distancePoints)
        : null,
  };
}

function buildWaitingContext({
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
} = {}) {
  const handoff = engine26ReactionHandoff || null;

  return {
    active: false,
    authorized: false,

    engine:
      "engine3.engine26LocationReactionContext.v2",

    source:
      handoff
        ? "engine26ReactionHandoff"
        : "engine26StructuralContext.locationContext",

    state: "WAITING_FOR_ENGINE26_LOCATION",
    quality: "WEAK",
    direction: "NEUTRAL",
    confirmed: false,

    candidateId:
      handoff?.candidateId ?? null,

    zoneId:
      handoff?.zoneId ?? null,

    strategyId:
      handoff?.strategyId ?? null,

    symbol:
      handoff?.symbol ?? null,

    setupType:
      handoff?.setupType ?? null,

    snapshotTime:
      handoff?.snapshotTime ?? null,

    timeframe:
      handoff?.timeframe ?? null,

    expectedReactions:
      normalizeExpectedReactions(
        handoff?.expectedReactions
      ),

    zone:
      normalizeZoneFromHandoff(handoff),

    triggerLevel:
      validPrice(handoff?.triggerLevel),

    acceptanceBoundary:
      validPrice(handoff?.acceptanceBoundary),

    reclaimBoundary:
      validPrice(handoff?.reclaimBoundary),

    invalidationLevel:
      validPrice(
        handoff?.locationInvalidationBoundary
      ),

    authorizeEngine3Evaluation: false,

    forceAllowedFalse: true,
    blocker: "WAITING_FOR_ENGINE26_LOCATION",

    interpretation:
      "Engine 3 is waiting for an active authorized Engine 26 reaction handoff.",

    reasonCodes: [
      "WAITING_FOR_ENGINE26_LOCATION",
      handoff
        ? `ENGINE26_HANDOFF_${safeUpper(
            handoff.status,
            "UNKNOWN"
          )}`
        : "ENGINE26_REACTION_HANDOFF_MISSING",
      engine26StructuralContext?.locationContext
        ? "LEGACY_ENGINE26_LOCATION_CONTEXT_AVAILABLE"
        : null,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ].filter(Boolean),

    noPermissionCreated: true,
    noExecution: true,
  };
}

const LONG_STATES = new Set([
  "HELD_LEVEL",
  "RECLAIMED_LEVEL",
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

const SHORT_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
  "FAILED_ACCEPTANCE_SHORT",
  "LOST_SHORT_TRIGGER_LEVEL",
]);

function isExpectedReaction({
  state,
  expectedReactions,
}) {
  if (!expectedReactions.length) {
    return true;
  }

  return expectedReactions.includes(state);
}

function buildAuthorizedBase({
  handoff,
  reactionInput,
}) {
  const state = safeUpper(
    reactionInput?.state,
    "NO_SIGNAL"
  );

  const direction = safeUpper(
    reactionInput?.direction,
    "NEUTRAL"
  );

  const quality = safeUpper(
    reactionInput?.quality,
    "WEAK"
  );

  const currentPrice =
    validPrice(reactionInput?.currentPrice) ??
    validPrice(reactionInput?.lastCandle?.close) ??
    validPrice(reactionInput?.price) ??
    validPrice(handoff?.zone?.currentPrice) ??
    null;

  const expectedReactions =
    normalizeExpectedReactions(
      handoff?.expectedReactions
    );

  const expected =
    isExpectedReaction({
      state,
      expectedReactions,
    });

  return {
    active: true,
    authorized: true,

    engine:
      "engine3.engine26LocationReactionContext.v2",

    source: "engine26ReactionHandoff",

    candidateId:
      handoff.candidateId,

    zoneId:
      handoff.zoneId,

    strategyId:
      handoff.strategyId ?? null,

    symbol:
      handoff.symbol ?? null,

    setupType:
      handoff.setupType ?? null,

    snapshotTime:
      handoff.snapshotTime ?? null,

    timeframe:
      handoff.timeframe ?? null,

    tradeDirectionBias:
      safeUpper(
        handoff.tradeDirectionBias,
        "NEUTRAL"
      ),

    expectedReactionDirection:
      safeUpper(
        handoff.expectedReactionDirection,
        "NEUTRAL"
      ),

    expectedReactions,

    state,
    rawState: state,
    quality,
    direction,

    currentPrice,

    confirmed:
      reactionInput?.confirmed === true,

    reactionExpected: expected,

    zone:
      normalizeZoneFromHandoff(handoff),

    triggerLevel:
      validPrice(handoff.triggerLevel),

    acceptanceBoundary:
      validPrice(handoff.acceptanceBoundary),

    reclaimBoundary:
      validPrice(handoff.reclaimBoundary),

    invalidationLevel:
      validPrice(
        handoff.locationInvalidationBoundary
      ),

    authorizeEngine3Evaluation: true,

    forceAllowedFalse: false,
    blocker: null,

    noPermissionCreated: true,
    noExecution: true,
  };
}

function evaluateAuthorizedHandoff({
  handoff,
  reactionInput,
}) {
  const base = buildAuthorizedBase({
    handoff,
    reactionInput,
  });

  const {
    state,
    direction,
    quality,
    currentPrice,
    expectedReactions,
    reactionExpected,
    tradeDirectionBias,
    triggerLevel,
    reclaimBoundary,
    invalidationLevel,
  } = base;

  if (
    state === "NO_SIGNAL" ||
    state === "UNKNOWN"
  ) {
    return {
      ...base,

      state: "WATCHING_AUTHORIZED_LOCATION",
      rawState: state,
      quality: "WEAK",
      direction: "NEUTRAL",
      confirmed: false,

      forceAllowedFalse: true,
      blocker: "AUTHORIZED_REACTION_NOT_PRESENT",

      interpretation:
        "Engine 3 has an authorized Engine 26 location and is waiting for a qualifying price reaction.",

      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "WATCHING_AUTHORIZED_LOCATION",
        "AUTHORIZED_REACTION_NOT_PRESENT",
        "CANDIDATE_ID_PRESERVED",
        "ZONE_ID_PRESERVED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  if (!reactionExpected) {
    return {
      ...base,

      state: "REACTION_FAILED",
      confirmed: false,

      forceAllowedFalse: true,
      blocker: "REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET",

      interpretation:
        "Price reacted at the authorized location, but the observed reaction was not one of Engine 26's expected reactions.",

      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET",
        `OBSERVED_${state}`,
        ...expectedReactions.map(
          (item) => `EXPECTED_${item}`
        ),
        "CANDIDATE_ID_PRESERVED",
        "ZONE_ID_PRESERVED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const invalidatedLong =
    tradeDirectionBias === "LONG" &&
    invalidationLevel != null &&
    currentPrice != null &&
    currentPrice < invalidationLevel;

  const invalidatedShort =
    tradeDirectionBias === "SHORT" &&
    invalidationLevel != null &&
    currentPrice != null &&
    currentPrice > invalidationLevel;

  if (invalidatedLong || invalidatedShort) {
    return {
      ...base,

      state: "REACTION_INVALIDATED",
      direction: "NEUTRAL",
      confirmed: false,

      forceAllowedFalse: true,
      blocker: "ENGINE26_LOCATION_INVALIDATED",

      interpretation:
        "Price breached the Engine 26 location invalidation boundary. The authorized reaction is invalidated.",

      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "ENGINE26_LOCATION_INVALIDATED",
        invalidatedLong
          ? "LONG_LOCATION_INVALIDATION_BREACHED"
          : "SHORT_LOCATION_INVALIDATION_BREACHED",
        "CANDIDATE_ID_PRESERVED",
        "ZONE_ID_PRESERVED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const longConfirmed =
    direction === "LONG" &&
    LONG_STATES.has(state);

  const shortConfirmed =
    direction === "SHORT" &&
    SHORT_STATES.has(state);

  const directionMatchesBias =
    tradeDirectionBias === "NEUTRAL" ||
    direction === tradeDirectionBias;

  const confirmed =
    reactionInput?.confirmed === true &&
    reactionExpected &&
    directionMatchesBias &&
    (
      longConfirmed ||
      shortConfirmed
    );

  if (confirmed) {
    return {
      ...base,

      state: "REACTION_CONFIRMED",
      rawState: state,
      confirmed: true,

      interpretation:
        "Price confirmed an expected reaction at the authorized Engine 26 location.",

      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "AUTHORIZED_REACTION_CONFIRMED",
        `REACTION_${state}`,
        `DIRECTION_${direction}`,
        `QUALITY_${quality}`,
        "CANDIDATE_ID_PRESERVED",
        "ZONE_ID_PRESERVED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const possibleLongReaction =
    direction === "LONG" &&
    LONG_STATES.has(state);

  const possibleShortReaction =
    direction === "SHORT" &&
    SHORT_STATES.has(state);

  if (
    possibleLongReaction ||
    possibleShortReaction
  ) {
    return {
      ...base,

      state: "WATCHING_AUTHORIZED_LOCATION",
      rawState: state,
      confirmed: false,

      forceAllowedFalse: true,
      blocker: "AUTHORIZED_REACTION_NOT_CONFIRMED",

      interpretation:
        "An expected reaction is developing at the authorized location, but it is not yet confirmed.",

      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "EXPECTED_REACTION_DEVELOPING",
        `REACTION_${state}`,
        `DIRECTION_${direction}`,
        `QUALITY_${quality}`,
        directionMatchesBias
          ? "REACTION_DIRECTION_MATCHES_CANDIDATE"
          : "REACTION_DIRECTION_CONFLICTS_WITH_CANDIDATE",
        "CANDIDATE_ID_PRESERVED",
        "ZONE_ID_PRESERVED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  return {
    ...base,

    state: "REACTION_FAILED",
    confirmed: false,

    forceAllowedFalse: true,
    blocker: "AUTHORIZED_REACTION_FAILED",

    interpretation:
      "Price tested the authorized Engine 26 location but did not produce a confirmed directional reaction.",

    reasonCodes: [
      "ENGINE26_REACTION_HANDOFF_CONSUMED",
      "AUTHORIZED_REACTION_FAILED",
      `REACTION_${state}`,
      `DIRECTION_${direction}`,
      "CANDIDATE_ID_PRESERVED",
      "ZONE_ID_PRESERVED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

function evaluateLegacyStructuralContext({
  engine26StructuralContext,
  reactionInput,
}) {
  const locationContext =
    engine26StructuralContext?.locationContext ||
    null;

  if (!locationContext?.active) {
    return buildWaitingContext({
      engine26StructuralContext,
    });
  }

  const state = safeUpper(
    reactionInput?.state,
    "NO_SIGNAL"
  );

  const direction = safeUpper(
    reactionInput?.direction,
    "NEUTRAL"
  );

  const currentPrice =
    validPrice(reactionInput?.currentPrice) ??
    validPrice(reactionInput?.lastCandle?.close) ??
    validPrice(locationContext?.currentPrice) ??
    null;

  const shortTriggerLevel =
    validPrice(
      locationContext?.shortTriggerLevel
    );

  const invalidationLevel =
    validPrice(
      locationContext?.invalidationLevel
    );

  const locationRead =
    safeUpper(locationContext.locationRead);

  const priceLocation =
    safeUpper(locationContext.priceLocation);

  const desiredTrigger =
    safeUpper(locationContext.desiredTrigger);

  const handoffRule =
    safeUpper(
      locationContext?.handoff
        ?.engine3ShouldTreatInsideShortZoneAs,
      "NONE"
    );

  const insideShortZoneAcceptanceTest =
    locationRead ===
      "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST" &&
    priceLocation === "INSIDE_ZONE";

  const longBounceInsideShortZone =
    insideShortZoneAcceptanceTest &&
    direction === "LONG" &&
    LONG_STATES.has(state) &&
    (
      handoffRule ===
        "ACCEPTANCE_TEST_NOT_LONG_PERMISSION" ||
      handoffRule === "NONE"
    );

  const lostShortTrigger =
    shortTriggerLevel != null &&
    currentPrice != null &&
    currentPrice < shortTriggerLevel &&
    direction === "SHORT" &&
    SHORT_STATES.has(state);

  const reclaimedAboveInvalidation =
    invalidationLevel != null &&
    currentPrice != null &&
    currentPrice > invalidationLevel &&
    direction === "LONG";

  const base = {
    active: true,
    authorized: false,

    engine:
      "engine3.engine26LocationReactionContext.v2",

    source:
      "engine26StructuralContext.locationContext",

    candidateId: null,
    zoneId: null,
    strategyId: null,
    symbol: null,
    setupType: null,
    snapshotTime: null,
    timeframe: null,

    currentPrice,

    locationRead,
    priceLocation,
    desiredTrigger,

    shortTriggerLevel,
    triggerLevel: shortTriggerLevel,

    invalidationLevel,

    expectedReactions: [],

    authorizeEngine3Evaluation: false,

    noPermissionCreated: true,
    noExecution: true,
  };

  if (longBounceInsideShortZone) {
    return {
      ...base,

      state:
        "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",

      quality: "MIXED",
      direction: "NEUTRAL",
      confirmed: false,

      forceAllowedFalse: true,
      blocker:
        "LONG_BOUNCE_NOT_CLEAN_PERMISSION",

      interpretation:
        "Bounce is real, but it is inside the legacy Engine 26 short-watch zone. Treat as an acceptance test, not clean long permission.",

      reasonCodes: [
        "LEGACY_ENGINE26_LOCATION_CONTEXT_CONSUMED",
        "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
        "LONG_BOUNCE_NOT_CLEAN_PERMISSION",
        "WAIT_FOR_FAILED_ACCEPTANCE_OR_RECLAIM",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  if (lostShortTrigger) {
    return {
      ...base,

      state:
        state === "LOST_LEVEL"
          ? "LOST_SHORT_TRIGGER_LEVEL"
          : "FAILED_ACCEPTANCE_SHORT",

      quality:
        safeUpper(
          reactionInput?.quality,
          "GOOD"
        ) === "STRONG"
          ? "STRONG"
          : "GOOD",

      direction: "SHORT",

      confirmed:
        reactionInput?.confirmed === true,

      forceAllowedFalse: false,
      blocker: null,

      interpretation:
        "Price lost the legacy Engine 26 short trigger level. Failed acceptance or level-loss is confirming.",

      reasonCodes: [
        "LEGACY_ENGINE26_LOCATION_CONTEXT_CONSUMED",
        "SHORT_TRIGGER_LEVEL_LOST",
        "FAILED_ACCEPTANCE_OR_LEVEL_LOSS",
        "ENGINE26_SHORT_WATCH_TRIGGER_CONFIRMING",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  if (reclaimedAboveInvalidation) {
    return {
      ...base,

      state:
        "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",

      quality: "MIXED",
      direction: "NEUTRAL",
      confirmed: false,

      forceAllowedFalse: true,
      blocker:
        "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",

      interpretation:
        "Price reclaimed above the legacy Engine 26 invalidation level. The short-watch location is weakening.",

      reasonCodes: [
        "LEGACY_ENGINE26_LOCATION_CONTEXT_CONSUMED",
        "RECLAIMED_ABOVE_SHORT_WATCH_INVALIDATION",
        "SHORT_WATCH_WEAKENING",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  return {
    ...base,

    state: null,
    quality: null,
    direction: null,
    confirmed: null,

    forceAllowedFalse: false,
    blocker: null,
    interpretation: null,

    reasonCodes: [
      "LEGACY_ENGINE26_LOCATION_CONTEXT_CONSUMED",
      locationRead,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ].filter(Boolean),
  };
}

export function buildEngine26LocationReactionContext({
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  reactionInput = null,
} = {}) {
  const handoff =
    engine26ReactionHandoff &&
    typeof engine26ReactionHandoff === "object"
      ? engine26ReactionHandoff
      : null;

  const handoffAuthorized =
    handoff?.active === true &&
    handoff?.authorizeEngine3Evaluation === true &&
    Boolean(handoff?.candidateId) &&
    Boolean(handoff?.zoneId);

  if (handoffAuthorized) {
    return evaluateAuthorizedHandoff({
      handoff,
      reactionInput,
    });
  }

  if (handoff) {
    return buildWaitingContext({
      engine26ReactionHandoff: handoff,
      engine26StructuralContext,
    });
  }

  if (
    engine26StructuralContext?.locationContext
  ) {
    return evaluateLegacyStructuralContext({
      engine26StructuralContext,
      reactionInput,
    });
  }

  return buildWaitingContext({
    engine26ReactionHandoff: null,
    engine26StructuralContext,
  });
}

export default buildEngine26LocationReactionContext;
