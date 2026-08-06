// services/core/logic/engine3/engine26LocationReactionContext.js
//
// Canonical Engine 26 location/identity normalization for Engine 3.
// Phase C contract:
// - Engine 26 owns canonical Minute Strategy 1 identity.
// - Missing selected-source identity inherits and is diagnostic only.
// - Present conflicting selected-source identity hard blocks.
// - Confirmation is branch-specific; it is not a universal authorization gate.
// - Legacy structural-context safety behavior remains isolated.
// - No permission or execution authority is created.

function safeUpper(value, fallback = "NONE") {
  const text = String(value ?? "").trim();
  return text ? text.toUpperCase() : fallback;
}

function validPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeExpectedReactions(value) {
  return Array.isArray(value)
    ? value.map((item) => safeUpper(item, "")).filter(Boolean)
    : [];
}

function normalizeZoneFromHandoff(handoff) {
  const zone = handoff?.zone;
  if (!zone || typeof zone !== "object") return null;

  const lo = validPrice(zone.lo);
  const hi = validPrice(zone.hi);
  const mid = validPrice(zone.mid) ??
    (lo != null && hi != null ? Number(((lo + hi) / 2).toFixed(2)) : null);

  return {
    source: zone.source ?? null,
    sourcePath: zone.sourcePath ?? null,
    type: zone.type ?? null,
    timeframe: zone.timeframe ?? null,
    lo,
    hi,
    mid,
    relation: zone.relation ?? null,
    distancePoints: Number.isFinite(Number(zone.distancePoints))
      ? Number(zone.distancePoints)
      : null,
  };
}

const IDENTITY_FIELDS = [
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "symbol",
  "setupClass",
  "setupGrade",
  "identitySetupKey",
  "candidateIdentityVersion",
];

const HARD_IDENTITY_BLOCKERS = {
  laneId: "ENGINE3_LANE_ID_MISMATCH",
  strategyId: "ENGINE3_STRATEGY_ID_MISMATCH",
  candidateId: "ENGINE3_CANDIDATE_ID_MISMATCH",
  zoneId: "ENGINE3_ZONE_ID_MISMATCH",
  symbol: "ENGINE3_SYMBOL_MISMATCH",
  setupClass: "ENGINE3_SETUP_CLASS_MISMATCH",
  identitySetupKey: "ENGINE3_IDENTITY_SETUP_KEY_MISMATCH",
  candidateIdentityVersion: "ENGINE3_CANDIDATE_IDENTITY_VERSION_MISMATCH",
};

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function copyCanonicalIdentity(handoff) {
  return {
    laneId: handoff?.laneId ?? null,
    strategyId: handoff?.strategyId ?? null,
    candidateId: handoff?.candidateId ?? null,
    zoneId: handoff?.zoneId ?? null,
    symbol: handoff?.symbol ?? null,
    setupClass: handoff?.setupClass ?? null,
    setupGrade: handoff?.setupGrade ?? null,
    identitySetupKey: handoff?.identitySetupKey ?? null,
    candidateIdentityVersion: handoff?.candidateIdentityVersion ?? null,
  };
}

function copySourceIdentity(reactionInput) {
  const source = reactionInput && typeof reactionInput === "object"
    ? reactionInput
    : {};

  return Object.fromEntries(
    IDENTITY_FIELDS.map((field) => [field, present(source[field]) ? source[field] : null])
  );
}

function compareIdentity({ handoff, reactionInput }) {
  const canonicalIdentity = copyCanonicalIdentity(handoff);
  const sourceIdentity = copySourceIdentity(reactionInput);
  const canonicalComparable = Boolean(
    handoff &&
    present(canonicalIdentity.candidateId) &&
    present(canonicalIdentity.zoneId)
  );

  const mismatches = [];
  const missingSourceFields = [];
  const diagnostics = [];

  for (const field of IDENTITY_FIELDS) {
    const sourceValue = sourceIdentity[field];
    const canonicalValue = canonicalIdentity[field];

    if (!present(sourceValue)) {
      missingSourceFields.push(field);
      diagnostics.push(`SOURCE_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_NOT_PUBLISHED`);
      continue;
    }

    if (!present(canonicalValue)) continue;

    if (String(sourceValue) !== String(canonicalValue)) {
      if (field === "setupGrade") {
        diagnostics.push("SOURCE_SETUP_GRADE_DIFFERS_FROM_HANDOFF");
      } else {
        const blocker = HARD_IDENTITY_BLOCKERS[field];
        if (blocker) mismatches.push(blocker);
      }
    }
  }

  return {
    canonicalIdentity,
    sourceIdentity,
    identityComparison: {
      comparable: canonicalComparable,
      matched: canonicalComparable && mismatches.length === 0,
      mismatches,
      missingSourceFields,
      diagnostics,
    },
  };
}

function copyHandoffMetadata(handoff) {
  return {
    laneId: handoff?.laneId ?? null,
    strategyId: handoff?.strategyId ?? null,
    candidateId: handoff?.candidateId ?? null,
    zoneId: handoff?.zoneId ?? null,
    symbol: handoff?.symbol ?? null,
    setupClass: handoff?.setupClass ?? null,
    setupGrade: handoff?.setupGrade ?? null,
    identitySetupKey: handoff?.identitySetupKey ?? null,
    candidateIdentityVersion: handoff?.candidateIdentityVersion ?? null,
    snapshotTime: handoff?.snapshotTime ?? null,
    timeframe: handoff?.timeframe ?? null,

    handoffActive: handoff?.active === true,
    armed: handoff?.armed === true,
    chainArmed: handoff?.chainArmed === true,
    contactState: handoff?.contactState ?? null,
    directionState: handoff?.directionState ?? null,
    authorizeEngine3Evaluation: handoff?.authorizeEngine3Evaluation === true,
    authorizationDirection: handoff?.direction ?? null,
    tradeDirectionBias: handoff?.tradeDirectionBias ?? null,
    expectedReactionDirection: handoff?.expectedReactionDirection ?? null,
    expectedReactions: normalizeExpectedReactions(handoff?.expectedReactions),
    handoffReactionExpected: handoff?.reactionExpected ?? null,
  };
}

function buildWaitingContext({
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  reactionInput = null,
} = {}) {
  const handoff = engine26ReactionHandoff || null;
  const identity = compareIdentity({ handoff, reactionInput });
  const metadata = copyHandoffMetadata(handoff);

  return {
    active: false,
    authorized: false,
    engine: "engine3.engine26LocationReactionContext.v3",
    source: handoff
      ? "engine26ReactionHandoff"
      : "engine26StructuralContext.locationContext",

    ...metadata,
    ...identity,

    state: "WAITING_FOR_ENGINE26_LOCATION",
    rawState: safeUpper(reactionInput?.state, "NO_SIGNAL"),
    quality: safeUpper(reactionInput?.quality, "WEAK"),
    reactionQuality: safeUpper(reactionInput?.quality, "WEAK"),
    authorizationQuality: "WEAK",
    direction: safeUpper(reactionInput?.direction, "NEUTRAL"),
    reactionDirection: safeUpper(reactionInput?.direction, "NEUTRAL"),
    confirmed: reactionInput?.confirmed === true,
    reactionExpected: handoff?.reactionExpected ?? null,

    zone: normalizeZoneFromHandoff(handoff),
    triggerLevel: validPrice(handoff?.triggerLevel),
    acceptanceBoundary: validPrice(handoff?.acceptanceBoundary),
    reclaimBoundary: validPrice(handoff?.reclaimBoundary),
    invalidationLevel: validPrice(handoff?.locationInvalidationBoundary),

    forceAllowedFalse: true,
    blocker: "WAITING_FOR_ENGINE26_LOCATION",
    interpretation: "Engine 3 is waiting for a complete, active, armed canonical Engine 26 reaction handoff.",
    reasonCodes: [
      "WAITING_FOR_ENGINE26_LOCATION",
      handoff ? `ENGINE26_HANDOFF_${safeUpper(handoff.status, "UNKNOWN")}` : "ENGINE26_REACTION_HANDOFF_MISSING",
      engine26StructuralContext?.locationContext ? "LEGACY_ENGINE26_LOCATION_CONTEXT_AVAILABLE" : null,
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

function buildAuthorizedBase({ handoff, reactionInput }) {
  const state = safeUpper(reactionInput?.state, "NO_SIGNAL");
  const direction = safeUpper(reactionInput?.direction, "NEUTRAL");
  const quality = safeUpper(reactionInput?.quality, "WEAK");
  const expectedReactions = normalizeExpectedReactions(handoff?.expectedReactions);
  const identity = compareIdentity({ handoff, reactionInput });

  const currentPrice =
    validPrice(reactionInput?.currentPrice) ??
    validPrice(reactionInput?.lastCandle?.close) ??
    validPrice(reactionInput?.price) ??
    validPrice(handoff?.zone?.currentPrice) ??
    null;

  return {
    active: true,
    authorized: true,
    engine: "engine3.engine26LocationReactionContext.v3",
    source: "engine26ReactionHandoff",

    ...copyHandoffMetadata(handoff),
    ...identity,

    state,
    rawState: state,
    quality,
    reactionQuality: quality,
    authorizationQuality: null,
    direction,
    reactionDirection: direction,
    confirmed: reactionInput?.confirmed === true,
    reactionExpected: expectedReactions.length === 0
      ? true
      : expectedReactions.includes(state),

    currentPrice,
    zone: normalizeZoneFromHandoff(handoff),
    triggerLevel: validPrice(handoff?.triggerLevel),
    acceptanceBoundary: validPrice(handoff?.acceptanceBoundary),
    reclaimBoundary: validPrice(handoff?.reclaimBoundary),
    invalidationLevel: validPrice(handoff?.locationInvalidationBoundary),

    forceAllowedFalse: identity.identityComparison.mismatches.length > 0,
    blocker: identity.identityComparison.mismatches[0] ?? null,
    noPermissionCreated: true,
    noExecution: true,
  };
}

function evaluateAuthorizedHandoff({ handoff, reactionInput }) {
  const base = buildAuthorizedBase({ handoff, reactionInput });
  const {
    state,
    direction,
    quality,
    currentPrice,
    expectedReactions,
    reactionExpected,
    tradeDirectionBias,
    invalidationLevel,
    identityComparison,
  } = base;

  if (identityComparison.mismatches.length > 0) {
    return {
      ...base,
      state: "WATCHING_AUTHORIZED_LOCATION",
      forceAllowedFalse: true,
      blocker: identityComparison.mismatches[0],
      interpretation: "The selected Engine 3 source conflicts with canonical Engine 26 Strategy 1 identity.",
      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        ...identityComparison.mismatches,
        "ENGINE3_SELECTED_SOURCE_IDENTITY_MISMATCH",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  if (state === "NO_SIGNAL" || state === "UNKNOWN") {
    return {
      ...base,
      state: "WATCHING_AUTHORIZED_LOCATION",
      rawState: state,
      confirmed: false,
      forceAllowedFalse: false,
      blocker: null,
      interpretation: "Engine 26 authorized the location; Engine 3 has not observed an actionable reaction branch yet.",
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

  if (expectedReactions.length > 0 && reactionExpected !== true) {
    return {
      ...base,
      state: "REACTION_FAILED",
      confirmed: false,
      forceAllowedFalse: true,
      blocker: "REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET",
      interpretation: "The observed reaction is outside the canonical nonempty Engine 26 expected-reaction contract.",
      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET",
        `OBSERVED_${state}`,
        ...expectedReactions.map((item) => `EXPECTED_${item}`),
        "CANDIDATE_ID_PRESERVED",
        "ZONE_ID_PRESERVED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const bias = safeUpper(tradeDirectionBias, "NEUTRAL");
  const invalidatedLong = bias === "LONG" && invalidationLevel != null && currentPrice != null && currentPrice < invalidationLevel;
  const invalidatedShort = bias === "SHORT" && invalidationLevel != null && currentPrice != null && currentPrice > invalidationLevel;

  if (invalidatedLong || invalidatedShort) {
    return {
      ...base,
      state: "REACTION_INVALIDATED",
      direction: "NEUTRAL",
      reactionDirection: direction,
      confirmed: false,
      forceAllowedFalse: true,
      blocker: "ENGINE26_LOCATION_INVALIDATED",
      interpretation: "Price breached the canonical Engine 26 location invalidation boundary.",
      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "ENGINE26_LOCATION_INVALIDATED",
        invalidatedLong ? "LONG_LOCATION_INVALIDATION_BREACHED" : "SHORT_LOCATION_INVALIDATION_BREACHED",
        "CANDIDATE_ID_PRESERVED",
        "ZONE_ID_PRESERVED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const longReaction = direction === "LONG" && LONG_STATES.has(state);
  const shortReaction = direction === "SHORT" && SHORT_STATES.has(state);
  const directionMatchesBias = bias === "NEUTRAL" || direction === bias;

  if ((longReaction || shortReaction) && !directionMatchesBias) {
    return {
      ...base,
      state: "REACTION_FAILED",
      confirmed: false,
      forceAllowedFalse: true,
      blocker: "REACTION_DIRECTION_CONFLICTS_WITH_CANDIDATE",
      interpretation: "The selected reaction conflicts with the canonical directional constraint.",
      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "REACTION_DIRECTION_CONFLICTS_WITH_CANDIDATE",
        `REACTION_${state}`,
        `DIRECTION_${direction}`,
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  if (reactionInput?.confirmed === true && (longReaction || shortReaction)) {
    return {
      ...base,
      state: "REACTION_CONFIRMED",
      rawState: state,
      confirmed: true,
      forceAllowedFalse: false,
      blocker: null,
      interpretation: "The authorization lifecycle recognizes confirmed Engine 3 reaction evidence.",
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

  if (longReaction || shortReaction) {
    return {
      ...base,
      state: "WATCHING_AUTHORIZED_LOCATION",
      rawState: state,
      confirmed: false,
      forceAllowedFalse: false,
      blocker: null,
      interpretation: "The canonical location is authorized and Engine 3 has actionable branch evidence; branch-specific requirements decide qualification.",
      reasonCodes: [
        "ENGINE26_REACTION_HANDOFF_CONSUMED",
        "EXPECTED_REACTION_DEVELOPING",
        `REACTION_${state}`,
        `DIRECTION_${direction}`,
        `QUALITY_${quality}`,
        "REACTION_DIRECTION_MATCHES_CANDIDATE",
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
    interpretation: "The selected source did not produce a recognized directional Engine 3 reaction.",
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

function evaluateLegacyStructuralContext({ engine26StructuralContext, reactionInput }) {
  const locationContext = engine26StructuralContext?.locationContext || null;
  if (!locationContext?.active) {
    return buildWaitingContext({ engine26StructuralContext, reactionInput });
  }

  const state = safeUpper(reactionInput?.state, "NO_SIGNAL");
  const direction = safeUpper(reactionInput?.direction, "NEUTRAL");
  const quality = safeUpper(reactionInput?.quality, "WEAK");
  const currentPrice = validPrice(reactionInput?.currentPrice) ?? validPrice(reactionInput?.lastCandle?.close) ?? validPrice(locationContext?.currentPrice) ?? null;
  const shortTriggerLevel = validPrice(locationContext?.shortTriggerLevel);
  const invalidationLevel = validPrice(locationContext?.invalidationLevel);
  const locationRead = safeUpper(locationContext?.locationRead);
  const priceLocation = safeUpper(locationContext?.priceLocation);
  const desiredTrigger = safeUpper(locationContext?.desiredTrigger);
  const handoffRule = safeUpper(locationContext?.handoff?.engine3ShouldTreatInsideShortZoneAs, "NONE");

  const insideShortZoneAcceptanceTest = locationRead === "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST" && priceLocation === "INSIDE_ZONE";
  const longBounceInsideShortZone = insideShortZoneAcceptanceTest && direction === "LONG" && LONG_STATES.has(state) && (handoffRule === "ACCEPTANCE_TEST_NOT_LONG_PERMISSION" || handoffRule === "NONE");
  const lostShortTrigger = shortTriggerLevel != null && currentPrice != null && currentPrice < shortTriggerLevel && direction === "SHORT" && SHORT_STATES.has(state);
  const reclaimedAboveInvalidation = invalidationLevel != null && currentPrice != null && currentPrice > invalidationLevel && direction === "LONG";

  const emptyIdentity = compareIdentity({ handoff: null, reactionInput });
  const base = {
    active: true,
    authorized: false,
    engine: "engine3.engine26LocationReactionContext.v3",
    source: "engine26StructuralContext.locationContext",
    ...copyHandoffMetadata(null),
    ...emptyIdentity,
    currentPrice,
    locationRead,
    priceLocation,
    desiredTrigger,
    shortTriggerLevel,
    triggerLevel: shortTriggerLevel,
    invalidationLevel,
    expectedReactions: [],
    authorizeEngine3Evaluation: false,
    reactionQuality: quality,
    reactionDirection: direction,
    noPermissionCreated: true,
    noExecution: true,
  };

  if (longBounceInsideShortZone) {
    return {
      ...base,
      state: "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
      rawState: state,
      quality: "MIXED",
      authorizationQuality: "MIXED",
      direction: "NEUTRAL",
      confirmed: false,
      forceAllowedFalse: true,
      blocker: "LONG_BOUNCE_NOT_CLEAN_PERMISSION",
      interpretation: "Legacy short-watch acceptance-test safety remains blocked.",
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
    const legacyQuality = quality === "STRONG" ? "STRONG" : "GOOD";
    return {
      ...base,
      state: state === "LOST_LEVEL" ? "LOST_SHORT_TRIGGER_LEVEL" : "FAILED_ACCEPTANCE_SHORT",
      rawState: state,
      quality: legacyQuality,
      authorizationQuality: legacyQuality,
      direction: "SHORT",
      confirmed: reactionInput?.confirmed === true,
      forceAllowedFalse: false,
      blocker: null,
      interpretation: "Price lost the legacy Engine 26 short trigger level.",
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
      state: "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",
      rawState: state,
      quality: "MIXED",
      authorizationQuality: "MIXED",
      direction: "NEUTRAL",
      confirmed: false,
      forceAllowedFalse: true,
      blocker: "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",
      interpretation: "Legacy short-watch reclaim invalidation risk remains blocked.",
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
    rawState: state,
    quality: null,
    authorizationQuality: null,
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
  const handoff = engine26ReactionHandoff && typeof engine26ReactionHandoff === "object"
    ? engine26ReactionHandoff
    : null;

  const canonicalV2Authorized =
    handoff?.active === true &&
    handoff?.authorizeEngine3Evaluation === true &&
    Boolean(handoff?.candidateId) &&
    Boolean(handoff?.zoneId) &&
    handoff?.laneId === "minute" &&
    handoff?.strategyId === "intraday_scalp@10m";

  if (canonicalV2Authorized) {
    return evaluateAuthorizedHandoff({ handoff, reactionInput });
  }

  if (handoff) {
    return buildWaitingContext({
      engine26ReactionHandoff: handoff,
      engine26StructuralContext,
      reactionInput,
    });
  }

  if (engine26StructuralContext?.locationContext) {
    return evaluateLegacyStructuralContext({ engine26StructuralContext, reactionInput });
  }

  return buildWaitingContext({ engine26ReactionHandoff: null, engine26StructuralContext, reactionInput });
}

export default buildEngine26LocationReactionContext;
