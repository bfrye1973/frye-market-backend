// services/core/logic/engine3/buildReactionReadiness.js
//
// Phase B additive diagnostic for Engine 3 paperScalpReaction.
//
// This helper:
// - reports the source production selected;
// - exposes raw selected-input facts;
// - exposes already-resolved canonical normalization facts;
// - copies final production blockers and reason codes exactly;
// - never recalculates allowed;
// - never calls Engine 26 normalization;
// - never creates permission or execution authority.

const VERSION = "engine3.reactionReadiness.phaseB.v1";

const SOURCE_FAST = "FAST_IMBALANCE";
const SOURCE_CURRENT = "CURRENT_LEVEL_ACTION";
const SOURCE_NONE = "NONE";

function hasObject(value) {
  return value != null && typeof value === "object";
}

function nullableUpper(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text = String(value).trim();
  return text ? text.toUpperCase() : null;
}

function nullableBoolean(value) {
  return value === true
    ? true
    : value === false
    ? false
    : null;
}

function copyArray(value) {
  return Array.isArray(value)
    ? [...value]
    : [];
}

function resolveAlternativeSource({
  selectedSource,
  currentLevelAction,
  fastImbalanceReaction,
}) {
  if (
    selectedSource === SOURCE_FAST &&
    hasObject(currentLevelAction)
  ) {
    return SOURCE_CURRENT;
  }

  if (
    selectedSource === SOURCE_CURRENT &&
    hasObject(fastImbalanceReaction)
  ) {
    return SOURCE_FAST;
  }

  return SOURCE_NONE;
}

function buildSummary({
  selectedSource,
  raw,
  normalized,
  authorization,
  productionAllowed,
  productionBlockers,
}) {
  if (selectedSource === SOURCE_NONE) {
    return "No Engine 3 reaction source was available. Production remains not allowed.";
  }

  const sourceLabel =
    selectedSource === SOURCE_FAST
      ? "Fast imbalance"
      : "Current-level action";

  const rawDirection = raw.direction;
  const normalizedDirection = normalized.direction;

  if (
    rawDirection &&
    normalizedDirection &&
    rawDirection !== normalizedDirection
  ) {
    return `${sourceLabel} was selected. Raw direction is ${rawDirection}, but canonical normalization produced ${normalizedDirection}. Production is ${
      productionAllowed ? "allowed" : "not allowed"
    }.`;
  }

  if (authorization.forceAllowedFalse === true) {
    const blocker =
      authorization.blocker ||
      "an Engine 26 forced-denial condition";

    return `${sourceLabel} was selected. An actionable reaction may be present, but production remains blocked by ${blocker}.`;
  }

  if (productionAllowed === true) {
    return `${sourceLabel} was selected. Raw and normalized production facts passed the current Engine 3 branch contract.`;
  }

  if (productionBlockers.length > 0) {
    return `${sourceLabel} was selected. Production remains blocked by ${productionBlockers.join(
      ", "
    )}.`;
  }

  return `${sourceLabel} was selected. Production remains not allowed.`;
}

export function buildReactionReadiness({
  selectedSource = SOURCE_NONE,
  reactionInput = null,
  currentLevelAction = null,
  fastImbalanceReaction = null,

  observedState = null,
  authorizationState = null,
  actionDirection = null,
  quality = null,

  engine26LocationContext = null,

  productionAllowed = false,
  productionBlockers = [],
  productionReasonCodes = [],
  sourceSelectionReason = null,
} = {}) {
  const normalizedSelectedSource =
    selectedSource === SOURCE_FAST ||
    selectedSource === SOURCE_CURRENT
      ? selectedSource
      : SOURCE_NONE;

  const raw = {
    state:
      normalizedSelectedSource === SOURCE_NONE
        ? null
        : nullableUpper(reactionInput?.state),

    direction:
      normalizedSelectedSource === SOURCE_NONE
        ? null
        : nullableUpper(reactionInput?.direction),

    quality:
      normalizedSelectedSource === SOURCE_NONE
        ? null
        : nullableUpper(reactionInput?.quality),

    confirmed:
      normalizedSelectedSource === SOURCE_NONE
        ? null
        : nullableBoolean(reactionInput?.confirmed),
  };

  const normalized = {
    observedState: nullableUpper(observedState),
    authorizationState: nullableUpper(authorizationState),
    direction: nullableUpper(actionDirection),
    quality: nullableUpper(quality),
    authorizationConfirmed:
      nullableBoolean(engine26LocationContext?.confirmed),
  };

  const authorization = {
    active:
      nullableBoolean(engine26LocationContext?.active),

    authorized:
      nullableBoolean(engine26LocationContext?.authorized),

    authorizeEngine3Evaluation:
      nullableBoolean(
        engine26LocationContext
          ?.authorizeEngine3Evaluation
      ),

    forceAllowedFalse:
      nullableBoolean(
        engine26LocationContext?.forceAllowedFalse
      ),

    blocker:
      engine26LocationContext?.blocker ?? null,

    contactState:
      engine26LocationContext?.contactState ?? null,

    chainArmed:
      nullableBoolean(engine26LocationContext?.chainArmed),

    directionState:
      engine26LocationContext?.directionState ?? null,
  };

  const identity = {
    laneId:
      engine26LocationContext?.laneId ?? null,

    strategyId:
      engine26LocationContext?.strategyId ?? null,

    candidateId:
      engine26LocationContext?.candidateId ?? null,

    zoneId:
      engine26LocationContext?.zoneId ?? null,

    symbol:
      engine26LocationContext?.symbol ?? null,

    setupClass:
      engine26LocationContext?.setupClass ?? null,

    setupGrade:
      engine26LocationContext?.setupGrade ?? null,

    identitySetupKey:
      engine26LocationContext?.identitySetupKey ?? null,

    candidateIdentityVersion:
      engine26LocationContext
        ?.candidateIdentityVersion ?? null,
  };

  const copiedBlockers =
    copyArray(productionBlockers);

  const copiedReasonCodes =
    copyArray(productionReasonCodes);

  const result = {
    version: VERSION,

    diagnosticOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    productionAllowed:
      productionAllowed === true,

    selectedSource:
      normalizedSelectedSource,

    alternativeSource:
      resolveAlternativeSource({
        selectedSource:
          normalizedSelectedSource,
        currentLevelAction,
        fastImbalanceReaction,
      }),

    sourceSelectionReason:
      sourceSelectionReason ?? null,

    raw,
    normalized,
    authorization,
    identity,

    productionBlockers:
      copiedBlockers,

    productionReasonCodes:
      copiedReasonCodes,

    summary: null,
  };

  result.summary = buildSummary({
    selectedSource:
      result.selectedSource,
    raw: result.raw,
    normalized: result.normalized,
    authorization: result.authorization,
    productionAllowed:
      result.productionAllowed,
    productionBlockers:
      result.productionBlockers,
  });

  return result;
}

export const REACTION_READINESS_SOURCES = {
  FAST_IMBALANCE: SOURCE_FAST,
  CURRENT_LEVEL_ACTION: SOURCE_CURRENT,
  NONE: SOURCE_NONE,
};

export default buildReactionReadiness;
