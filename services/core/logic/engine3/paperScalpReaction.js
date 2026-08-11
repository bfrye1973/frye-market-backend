// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 Strategy 1 canonical PAPER_ONLY reaction contract.
//
// Canonical Strategy 1 ownership:
// - Engine 26 owns location, candidate identity, lifecycle authorization,
//   authorized branch, trigger/reclaim/invalidation geometry.
// - 1m owns fresh immediate Engine 3 reaction direction.
// - 5m validates/supports/conflicts with the 1m reaction.
// - 10m remains broader context only.
// - 10m EMA10 only persists or resets an already-established direction.
// - This file publishes ONE canonical Engine 3 reaction object.
// - Engine 4 owns participation.
// - Engine 6 owns final permission.
//
// Safety:
// - PAPER_ONLY / RESEARCH_ONLY.
// - Does not create real permission.
// - Does not create execution.
// - Does not set executable.
// - Does not create orders, fills, sizing, management, or journal records.
//
// Output path:
// confluence.context.reaction.paperScalpReaction

import { buildEngine22DegreeWaveContext } from "./engine22DegreeWaveContext.js";
import { buildEngine26LocationReactionContext } from "./engine26LocationReactionContext.js";

const ENGINE = "engine3.paperScalpReaction.v3";
const SOURCE = "engine3.strategy1.canonicalReaction";

const TARGET_MODEL = {
  instrument: "ES",
  targetPoints: 10,
  exitModel: "THREE_BLOCKS",
};

const IDENTITY_FIELDS = [
  "symbol",
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "candidateIdentityVersion",
];

const QUALIFYING_QUALITY = new Set([
  "GOOD",
  "STRONG",
]);

function safeUpper(value, fallback = "NONE") {
  const text = String(value ?? "").trim();
  return text ? text.toUpperCase() : fallback;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getEngine22Direction(engine22WaveStrategy) {
  return safeUpper(
    engine22WaveStrategy
      ?.currentLifecycleState
      ?.confirmationContext
      ?.direction ||
      engine22WaveStrategy
        ?.currentLifecycleState
        ?.direction ||
      engine22WaveStrategy
        ?.waveOpportunity
        ?.direction ||
      engine22WaveStrategy
        ?.direction ||
      "NONE",
    "NONE"
  );
}

function identityAligned(observation1m, engine26ReactionHandoff) {
  if (
    !observation1m ||
    typeof observation1m !== "object" ||
    !engine26ReactionHandoff ||
    typeof engine26ReactionHandoff !== "object"
  ) {
    return false;
  }

  return IDENTITY_FIELDS.every((field) => {
    const observed = observation1m?.[field];
    const expected = engine26ReactionHandoff?.[field];

    return (
      observed != null &&
      observed !== "" &&
      expected != null &&
      expected !== "" &&
      observed === expected
    );
  });
}

function resolveBroaderReaction10m({
  fastImbalanceReaction = null,
  currentLevelAction = null,
} = {}) {
  if (
    fastImbalanceReaction &&
    typeof fastImbalanceReaction === "object"
  ) {
    return {
      ...fastImbalanceReaction,
      broaderContextOnly: true,
      canonicalDirectionAuthority: false,
      canonicalQualificationAuthority: false,
    };
  }

  if (
    currentLevelAction &&
    typeof currentLevelAction === "object"
  ) {
    return {
      ...currentLevelAction,
      broaderContextOnly: true,
      canonicalDirectionAuthority: false,
      canonicalQualificationAuthority: false,
    };
  }

  return null;
}

function resolveCanonicalDirection({
  observation1m = null,
  previousCanonicalDirection = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  engine26ReactionHandoff = null,
} = {}) {
  const observedState = safeUpper(
    observation1m?.state,
    "NO_SIGNAL"
  );

  const observedDirection = safeUpper(
    observation1m?.direction,
    "NEUTRAL"
  );

  const previousDirection = safeUpper(
    previousCanonicalDirection,
    "NEUTRAL"
  );

  const observationPresent =
    observation1m != null &&
    typeof observation1m === "object";

  const observationActive =
    observation1m?.active === true;

  const observationFresh =
    observation1m?.stale === false;

  const candleCompleted =
    observation1m?.currentCandleStatus === "COMPLETED" ||
    observation1m?.candleState === "COMPLETED";

  const aligned =
    identityAligned(
      observation1m,
      engine26ReactionHandoff
    );

  const observedDirectionUsable =
    ["LONG", "SHORT", "NEUTRAL"].includes(
      observedDirection
    );

  const observationUsable =
    observationPresent &&
    observationActive &&
    observationFresh &&
    candleCompleted &&
    aligned &&
    observedDirectionUsable;

  const completedClose =
    toNum(tenMinuteCompletedClose);

  const ema10 =
    toNum(tenMinuteEma10);

  const ema10DataAvailable =
    completedClose != null &&
    ema10 != null;

  const previousDirectional =
    previousDirection === "LONG" ||
    previousDirection === "SHORT";

  let ema10ResetTriggered = false;

  if (
    previousDirection === "SHORT" &&
    ema10DataAvailable &&
    completedClose > ema10
  ) {
    ema10ResetTriggered = true;
  }

  if (
    previousDirection === "LONG" &&
    ema10DataAvailable &&
    completedClose < ema10
  ) {
    ema10ResetTriggered = true;
  }

  let state = "NO_SIGNAL";
  let direction = "NEUTRAL";
  let sourceTimeframe = null;
  let reactionTimeframe = null;
  let resolutionStatus = "NO_USABLE_1M_CANONICAL_EVIDENCE";
  let resolutionReason = "ONE_MINUTE_EVIDENCE_UNUSABLE";
  let directionPersistenceActive = false;

  /*
   * Fresh completed 1m evidence owns NEW direction.
   *
   * This is checked before persistence so a fresh 1m directional
   * observation can establish the first LONG/SHORT after NEUTRAL.
   */
  if (
    observationUsable &&
    ["LONG", "SHORT"].includes(observedDirection) &&
    !(
      previousDirectional &&
      ema10ResetTriggered
    )
  ) {
    state = observedState;
    direction = observedDirection;
    sourceTimeframe = "1m";
    reactionTimeframe = "1m";
    resolutionStatus = "CANONICAL_1M_DIRECTIONAL";
    resolutionReason = "FRESH_COMPLETED_1M_CANDLE_DIRECTION";
  } else if (
    previousDirectional &&
    !ema10ResetTriggered
  ) {
    state =
      observationUsable
        ? observedState
        : "NO_SIGNAL";

    direction = previousDirection;
    sourceTimeframe = "1m";
    reactionTimeframe = "1m";
    directionPersistenceActive = true;
    resolutionStatus =
      `CANONICAL_${previousDirection}_PERSISTED`;

    resolutionReason =
      ema10DataAvailable
        ? `PREVIOUS_${previousDirection}_HELD_UNTIL_10M_EMA10_RESET`
        : `PREVIOUS_${previousDirection}_HELD_EMA10_RESET_DATA_UNAVAILABLE`;
  } else if (
    previousDirectional &&
    ema10ResetTriggered
  ) {
    state =
      observationUsable
        ? observedState
        : "NO_SIGNAL";

    direction = "NEUTRAL";
    sourceTimeframe = "10m";
    reactionTimeframe = "10m";
    resolutionStatus =
      "CANONICAL_DIRECTION_RESET_AT_10M_EMA10";

    resolutionReason =
      previousDirection === "SHORT"
        ? "COMPLETED_10M_CLOSE_ABOVE_EMA10_RESET_SHORT"
        : "COMPLETED_10M_CLOSE_BELOW_EMA10_RESET_LONG";
  } else if (observationUsable) {
    state = observedState;
    direction = observedDirection;
    sourceTimeframe = "1m";
    reactionTimeframe = "1m";
    resolutionStatus = "CANONICAL_1M_NEUTRAL";
    resolutionReason = "FRESH_COMPLETED_1M_NEUTRAL_REACTION";
  } else if (!observationPresent) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_MISSING";
  } else if (!aligned) {
    resolutionReason = "ONE_MINUTE_IDENTITY_MISMATCH";
  } else if (observation1m?.stale === true) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_STALE";
  } else if (!candleCompleted) {
    resolutionReason = "ONE_MINUTE_CANDLE_NOT_COMPLETED";
  } else if (!observationActive) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_INACTIVE";
  } else if (!observedDirectionUsable) {
    resolutionReason = "ONE_MINUTE_DIRECTION_NOT_USABLE";
  }

  return {
    state,
    direction,
    sourceTimeframe,
    reactionTimeframe,

    observationPresent,
    observationActive,
    observationFresh,
    candleCompleted,
    observationUsable,
    identityAligned: aligned,
    observedState,
    observedDirection,

    previousCanonicalDirection:
      previousDirectional
        ? previousDirection
        : "NEUTRAL",

    directionPersistenceActive,

    tenMinuteCompletedClose:
      completedClose,

    tenMinuteEma10:
      ema10,

    ema10ResetDataAvailable:
      ema10DataAvailable,

    ema10ResetTriggered,

    resolutionStatus,
    resolutionReason,
  };
}

function resolveCanonicalQuality({
  observation1m = null,
  validation5m = null,
  canonicalDirection = "NEUTRAL",
} = {}) {
  const oneMinuteQuality =
    safeUpper(
      observation1m?.quality,
      "WEAK"
    );

  const validationState =
    safeUpper(
      validation5m?.validationState,
      "UNRESOLVED"
    );

  const validationQuality =
    safeUpper(
      validation5m?.quality,
      "WEAK"
    );

  if (
    !["LONG", "SHORT"].includes(
      canonicalDirection
    )
  ) {
    return oneMinuteQuality;
  }

  if (
    validationState === "CONFLICT" ||
    validation5m?.conflictsWith1mDirection === true
  ) {
    return "MIXED";
  }

  if (
    validationState === "SUPPORT" ||
    validation5m?.supports1mDirection === true
  ) {
    if (oneMinuteQuality === "STRONG") {
      return "STRONG";
    }

    if (
      oneMinuteQuality === "GOOD" ||
      validationQuality === "GOOD" ||
      validationQuality === "STRONG"
    ) {
      return "GOOD";
    }

    return "MIXED";
  }

  return oneMinuteQuality;
}

function setupTypeForCanonical({
  state,
  direction,
} = {}) {
  const s = safeUpper(state, "NO_SIGNAL");
  const d = safeUpper(direction, "NEUTRAL");

  if (d === "SHORT") {
    if (s === "LOST_LEVEL") return "LOST_LEVEL_SHORT";
    if (s === "FAILED_RECLAIM") return "FAILED_RECLAIM_SHORT";
    if (s === "REJECTING_VALUE") return "REJECTING_VALUE_SHORT";
    if (s === "BREAKOUT_FAILING") return "BREAKOUT_FAILING_SHORT";
    if (s === "FAILED_ACCEPTANCE_SHORT") return "FAILED_ACCEPTANCE_SHORT";
    if (s === "LOST_SHORT_TRIGGER_LEVEL") return "LOST_SHORT_TRIGGER_LEVEL";
    return "CANONICAL_SHORT_REACTION";
  }

  if (d === "LONG") {
    if (s === "RECLAIMED_LEVEL") return "RECLAIMED_LEVEL_LONG";
    if (s === "WICK_BELOW_AND_RECLAIM") return "WICK_BELOW_AND_RECLAIM_LONG";
    if (s === "DIP_BOUGHT_FAST") return "DIP_BOUGHT_FAST_LONG";
    if (s === "SELLERS_TRAPPED") return "SELLERS_TRAPPED_LONG";
    if (s === "HELD_LEVEL") return "HELD_LEVEL_LONG";
    if (s === "ACCEPTING_VALUE") return "ACCEPTING_VALUE_LONG";
    if (s === "BREAKOUT_HOLDING") return "BREAKOUT_HOLDING_LONG";
    return "CANONICAL_LONG_REACTION";
  }

  return "CANONICAL_NEUTRAL_REACTION";
}

function resolveQualification({
  canonicalDirection,
  canonicalQuality,
  canonicalState,
  canonicalResolution,
  validation5m,
  engine26LocationContext,
} = {}) {
  const blockers = [];
  const reasonCodes = [];

  const direction =
    safeUpper(
      canonicalDirection,
      "NEUTRAL"
    );

  const quality =
    safeUpper(
      canonicalQuality,
      "WEAK"
    );

  const state =
    safeUpper(
      canonicalState,
      "NO_SIGNAL"
    );

  const validationState =
    safeUpper(
      validation5m?.validationState,
      "UNRESOLVED"
    );

  const validationPresent =
    validation5m != null &&
    typeof validation5m === "object" &&
    validation5m?.active === true;

  const validationFresh =
    validationPresent &&
    validation5m?.stale === false;

  const validationResolved =
    validation5m?.maturityResolved === true;

  const validationSupports =
    validation5m?.supports1mDirection === true ||
    validationState === "SUPPORT";

  const validationConflicts =
    validation5m?.conflictsWith1mDirection === true ||
    validationState === "CONFLICT";

  const authorizationActive =
    engine26LocationContext?.active === true &&
    engine26LocationContext?.authorized === true &&
    engine26LocationContext
      ?.authorizeEngine3Evaluation === true;

  const expectedDirection =
    safeUpper(
      engine26LocationContext
        ?.expectedReactionDirection,
      "NEUTRAL"
    );

  const directionAlignedWithEngine26 =
    ["LONG", "SHORT"].includes(direction) &&
    (
      !["LONG", "SHORT"].includes(expectedDirection) ||
      expectedDirection === direction
    );

  const authorizationState =
    safeUpper(
      engine26LocationContext?.state,
      "WAITING_FOR_ENGINE26_LOCATION"
    );

  const reactionConfirmed =
    authorizationActive &&
    directionAlignedWithEngine26 &&
    engine26LocationContext?.confirmed === true &&
    authorizationState === "REACTION_CONFIRMED";

  if (!authorizationActive) {
    blockers.push("ENGINE26_EVALUATION_NOT_AUTHORIZED");
  }

  if (
    canonicalResolution?.observationUsable !== true &&
    canonicalResolution?.directionPersistenceActive !== true
  ) {
    blockers.push("ONE_MINUTE_CANONICAL_EVIDENCE_NOT_USABLE");
  }

  if (!["LONG", "SHORT"].includes(direction)) {
    blockers.push("CANONICAL_DIRECTION_NOT_DIRECTIONAL");
  }

  if (!directionAlignedWithEngine26) {
    blockers.push("CANONICAL_DIRECTION_CONFLICTS_WITH_ENGINE26_AUTHORIZED_BRANCH");
  }

  if (!QUALIFYING_QUALITY.has(quality)) {
    blockers.push("ENGINE3_CANONICAL_QUALITY_NOT_GOOD_OR_STRONG");
  }

  if (!validationPresent) {
    blockers.push("FIVE_MINUTE_VALIDATION_MISSING");
  } else if (!validationFresh) {
    blockers.push("FIVE_MINUTE_VALIDATION_STALE");
  } else if (!validationResolved) {
    blockers.push("FIVE_MINUTE_VALIDATION_NOT_RESOLVED");
  } else if (validationConflicts) {
    blockers.push("FIVE_MINUTE_VALIDATION_CONFLICT");
  } else if (!validationSupports) {
    blockers.push("FIVE_MINUTE_VALIDATION_NOT_SUPPORTIVE");
  }

  if (!reactionConfirmed) {
    blockers.push("ENGINE26_AUTHORIZED_REACTION_NOT_CONFIRMED");
  }

  if (authorizationActive) {
    reasonCodes.push("ENGINE26_EVALUATION_AUTHORIZED");
  }

  if (directionAlignedWithEngine26) {
    reasonCodes.push("CANONICAL_DIRECTION_ALIGNED_WITH_ENGINE26_BRANCH");
  }

  if (QUALIFYING_QUALITY.has(quality)) {
    reasonCodes.push("ENGINE3_CANONICAL_QUALITY_GOOD_OR_STRONG");
  }

  if (validationSupports && validationResolved && validationFresh) {
    reasonCodes.push("FIVE_MINUTE_VALIDATION_SUPPORT");
  }

  if (reactionConfirmed) {
    reasonCodes.push("ENGINE3_AUTHORIZED_REACTION_CONFIRMED");
  }

  const qualified =
    blockers.length === 0;

  if (qualified) {
    reasonCodes.push("ENGINE3_STRATEGY1_QUALIFIED_FOR_ENGINE6");
  } else {
    reasonCodes.push("ENGINE3_STRATEGY1_NOT_QUALIFIED");
  }

  return {
    qualified,
    reactionConfirmed,
    authorizationState,
    validationState,
    validationPresent,
    validationFresh,
    validationResolved,
    validationSupports,
    validationConflicts,
    directionAlignedWithEngine26,
    blockers,
    reasonCodes,
  };
}

/*
 * Compatibility export.
 *
 * This function no longer owns Strategy 1 canonical direction.
 * It returns a broader diagnostic snapshot only.
 */
export function buildPaperScalpReaction({
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
} = {}) {
  const broaderReaction10m =
    resolveBroaderReaction10m({
      fastImbalanceReaction,
      currentLevelAction,
    });

  const diagnosticInput =
    broaderReaction10m ||
    currentLevelAction ||
    {};

  const engine26LocationContext =
    buildEngine26LocationReactionContext({
      engine26ReactionHandoff,
      engine26StructuralContext,
      reactionInput: {
        state:
          diagnosticInput?.state ||
          "NO_SIGNAL",
        quality:
          diagnosticInput?.quality ||
          "WEAK",
        direction:
          diagnosticInput?.direction ||
          "NEUTRAL",
        currentPrice:
          diagnosticInput?.currentPrice ??
          null,
        lastCandle:
          diagnosticInput?.lastCandle ??
          null,
        noPermissionCreated: true,
        noExecution: true,
      },
    });

  return {
    active: true,
    engine: ENGINE,
    source: SOURCE,
    mode: "PAPER_ONLY",
    researchOnly: true,

    state:
      diagnosticInput?.state ||
      "NO_SIGNAL",

    direction:
      diagnosticInput?.direction ||
      "NEUTRAL",

    quality:
      diagnosticInput?.quality ||
      "WEAK",

    allowed: false,
    engine3Strategy1QualifiedForEngine6: false,
    participationEvaluationEligible: false,
    reactionConfirmed: false,

    engine26LocationContext,
    broaderContextOnly: true,
    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,

    engine22Direction:
      getEngine22Direction(
        engine22WaveStrategy
      ),

    paperShortResearchEnabled:
      paperShortResearchEnabled === true,

    noPermissionCreated: true,
    noRealPermissionCreated: true,
    noExecution: true,
    realExecutionAuthority: false,

    blockers: [
      "BROADER_10M_CONTEXT_ONLY",
    ],

    reasonCodes: [
      "ENGINE3_BROADER_10M_CONTEXT_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export function attachPaperScalpReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
  previousCanonicalDirection = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
}) {
  const currentLevelAction =
    patchedConfluence
      ?.context
      ?.reaction
      ?.currentLevelAction ||
    null;

  const fastImbalanceReaction =
    patchedConfluence
      ?.context
      ?.reaction
      ?.engine3FastImbalanceReaction ||
    null;

  const observation1m =
    patchedConfluence
      ?.context
      ?.reaction
      ?.engine3ReactionObservation1m ||
    null;

  const validation5m =
    patchedConfluence
      ?.context
      ?.reaction
      ?.engine3ReactionValidation5m ||
    null;

  const broaderReaction10m =
    resolveBroaderReaction10m({
      fastImbalanceReaction,
      currentLevelAction,
    });

  const canonicalResolution =
    resolveCanonicalDirection({
      observation1m,
      previousCanonicalDirection,
      tenMinuteCompletedClose,
      tenMinuteEma10,
      engine26ReactionHandoff,
    });

  const canonicalQuality =
    resolveCanonicalQuality({
      observation1m,
      validation5m,
      canonicalDirection:
        canonicalResolution.direction,
    });

  const canonicalReactionInput = {
    state:
      canonicalResolution.state,

    quality:
      canonicalQuality,

    direction:
      canonicalResolution.direction,

    currentPrice:
      validPrice(observation1m?.currentPrice) ??
      validPrice(observation1m?.currentCandle?.close) ??
      validPrice(broaderReaction10m?.currentPrice) ??
      validPrice(currentLevelAction?.currentPrice) ??
      null,

    lastCandle:
      observation1m?.currentCandle ||
      broaderReaction10m?.lastCandle ||
      currentLevelAction?.lastCandle ||
      null,

    noPermissionCreated: true,
    noExecution: true,
  };

  /*
   * Engine 26 evaluates the ONE canonical Engine 3 reaction.
   * Engine 26 does not create direction here; it only checks whether
   * the observed reaction matches the authorized candidate branch.
   */
  const engine26LocationContext =
    buildEngine26LocationReactionContext({
      engine26ReactionHandoff,
      engine26StructuralContext,
      reactionInput:
        canonicalReactionInput,
    });

  const qualification =
    resolveQualification({
      canonicalDirection:
        canonicalResolution.direction,

      canonicalQuality,

      canonicalState:
        canonicalResolution.state,

      canonicalResolution,

      validation5m,

      engine26LocationContext,
    });

  const qualified =
    qualification.qualified === true;

  const setupType =
    setupTypeForCanonical({
      state:
        canonicalResolution.state,

      direction:
        canonicalResolution.direction,
    });

  const currentPrice =
    validPrice(canonicalReactionInput.currentPrice) ??
    validPrice(
      engine26LocationContext?.currentPrice
    ) ??
    null;

  const reactionState =
    engine26LocationContext?.state ||
    canonicalResolution.state;

  const paperScalpReaction = {
    active: true,
    engine: ENGINE,
    source: SOURCE,

    mode: "PAPER_ONLY",
    researchOnly: true,
    fastMode: false,

    /*
     * ONE canonical Engine 3 truth.
     */
    state:
      canonicalResolution.state,

    direction:
      canonicalResolution.direction,

    quality:
      canonicalQuality,

    setupType,

    reactionTimeframe:
      canonicalResolution.reactionTimeframe,

    sourceTimeframe:
      canonicalResolution.sourceTimeframe,

    canonicalResolutionStatus:
      canonicalResolution.resolutionStatus,

    canonicalResolutionReason:
      canonicalResolution.resolutionReason,

    canonicalObservationUsable:
      canonicalResolution.observationUsable,

    canonicalIdentityAligned:
      canonicalResolution.identityAligned,

    previousCanonicalDirection:
      canonicalResolution.previousCanonicalDirection,

    directionPersistenceActive:
      canonicalResolution.directionPersistenceActive,

    tenMinuteCompletedClose:
      canonicalResolution.tenMinuteCompletedClose,

    tenMinuteEma10:
      canonicalResolution.tenMinuteEma10,

    ema10ResetDataAvailable:
      canonicalResolution.ema10ResetDataAvailable,

    ema10ResetTriggered:
      canonicalResolution.ema10ResetTriggered,

    /*
     * Engine 26 authorization / identity transport.
     */
    authorized:
      engine26LocationContext?.authorized === true,

    evaluationAuthorized:
      engine26LocationContext
        ?.authorizeEngine3Evaluation === true,

    authorizeEngine3Evaluation:
      engine26LocationContext
        ?.authorizeEngine3Evaluation === true,

    authorizedReactionState:
      engine26LocationContext?.state ||
      null,

    authorizedReactionRawState:
      engine26LocationContext?.rawState ||
      canonicalResolution.state,

    reactionState,

    reactionConfirmed:
      qualification.reactionConfirmed === true,

    candidateId:
      engine26LocationContext?.candidateId ??
      engine26ReactionHandoff?.candidateId ??
      null,

    zoneId:
      engine26LocationContext?.zoneId ??
      engine26ReactionHandoff?.zoneId ??
      null,

    laneId:
      engine26LocationContext?.laneId ??
      engine26ReactionHandoff?.laneId ??
      null,

    strategyId:
      engine26LocationContext?.strategyId ??
      engine26ReactionHandoff?.strategyId ??
      null,

    symbol:
      engine26LocationContext?.symbol ??
      engine26ReactionHandoff?.symbol ??
      null,

    setupClass:
      engine26LocationContext?.setupClass ??
      engine26ReactionHandoff?.setupClass ??
      null,

    setupGrade:
      engine26LocationContext?.setupGrade ??
      engine26ReactionHandoff?.setupGrade ??
      null,

    identitySetupKey:
      engine26LocationContext
        ?.identitySetupKey ??
      engine26ReactionHandoff
        ?.identitySetupKey ??
      null,

    candidateIdentityVersion:
      engine26LocationContext
        ?.candidateIdentityVersion ??
      engine26ReactionHandoff
        ?.candidateIdentityVersion ??
      null,

    canonicalIdentity:
      engine26LocationContext
        ?.canonicalIdentity ||
      null,

    sourceIdentity:
      engine26LocationContext
        ?.sourceIdentity ||
      null,

    identityComparison:
      engine26LocationContext
        ?.identityComparison ||
      null,

    armed:
      engine26LocationContext?.armed === true,

    chainArmed:
      engine26LocationContext?.chainArmed === true,

    contactState:
      engine26LocationContext?.contactState ??
      null,

    directionState:
      engine26LocationContext?.directionState ??
      null,

    tradeDirectionBias:
      engine26LocationContext
        ?.tradeDirectionBias ??
      null,

    expectedReactionDirection:
      engine26LocationContext
        ?.expectedReactionDirection ??
      null,

    expectedReactions:
      Array.isArray(
        engine26LocationContext
          ?.expectedReactions
      )
        ? engine26LocationContext.expectedReactions
        : [],

    reactionExpected:
      engine26LocationContext
        ?.reactionExpected ??
      null,

    timeframe:
      engine26LocationContext?.timeframe ??
      null,

    snapshotTime:
      engine26LocationContext?.snapshotTime ??
      null,

    /*
     * Final Engine 3 gate fields.
     *
     * These three now come from the SAME canonical calculation.
     */
    allowed:
      qualified,

    engine3Strategy1QualifiedForEngine6:
      qualified,

    participationEvaluationEligible:
      qualified,

    qualificationExplicitlyPublished:
      true,

    targetModel:
      TARGET_MODEL,

    currentPrice,

    referenceLevel:
      toNum(observation1m?.referenceLevel),

    referenceType:
      observation1m?.referenceType ||
      null,

    referenceLabel:
      observation1m?.referenceLabel ||
      null,

    distancePts:
      toNum(observation1m?.distancePts),

    /*
     * Three-timeframe evidence remains visible and separate.
     */
    reactionObservation1m:
      observation1m,

    reactionValidation5m:
      validation5m,

    broaderReaction10m,

    currentLevelAction:
      currentLevelAction || null,

    fastImbalanceReaction:
      fastImbalanceReaction || null,

    engine26LocationContext:
      engine26LocationContext || null,

    validationState:
      qualification.validationState,

    validationSupports1m:
      qualification.validationSupports,

    validationConflictsWith1m:
      qualification.validationConflicts,

    validationResolved5m:
      qualification.validationResolved,

    validationTimeframe:
      validation5m?.sourceTimeframe ||
      null,

    broaderContextDirection:
      broaderReaction10m?.direction ||
      null,

    broaderContextState:
      broaderReaction10m?.state ||
      null,

    /*
     * Candle contract for Engine 4.
     */
    supportingBarTime:
      observation1m?.supportingBarTime ??
      null,

    evaluationTimeMs:
      observation1m?.evaluationTimeMs ??
      observation1m?.observedAt ??
      null,

    currentCandleStatus:
      observation1m?.currentCandleStatus ||
      null,

    priorCandleStatus:
      observation1m?.priorCandleStatus ||
      null,

    currentCandle:
      observation1m?.currentCandle ||
      null,

    priorCandle:
      observation1m?.priorCandle ||
      null,

    lastCandle:
      observation1m?.currentCandle ||
      broaderReaction10m?.lastCandle ||
      null,

    candleClosed:
      observation1m?.currentCandleStatus === "COMPLETED"
        ? true
        : observation1m?.currentCandleStatus === "FORMING"
        ? false
        : null,

    priorCandleCompleted:
      observation1m?.priorCandleStatus === "COMPLETED"
        ? true
        : observation1m?.priorCandleStatus === "FORMING"
        ? false
        : null,

    candleSourceFresh:
      observation1m?.stale === false &&
      (
        validation5m == null ||
        validation5m?.stale === false
      ),

    /*
     * Engine 22 remains diagnostic only.
     */
    lifecycleKey:
      engine22WaveStrategy
        ?.currentLifecycleState
        ?.key ||
      null,

    engine22Direction:
      getEngine22Direction(
        engine22WaveStrategy
      ),

    waveContext:
      buildEngine22DegreeWaveContext({
        engine22WaveStrategy,
        reactionState:
          canonicalResolution.state,
        reactionDirection:
          canonicalResolution.direction,
      }),

    /*
     * Safety / downstream contract.
     */
    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers:
      qualification.blockers,

    reasonCodes:
      unique([
        "PAPER_ONLY_RESEARCH_LANE",
        "ENGINE3_STRATEGY1_CANONICAL_REACTION_V3",
        "ONE_CANONICAL_ENGINE3_DIRECTION_OWNER",
        canonicalResolution.resolutionStatus,
        canonicalResolution.resolutionReason,

        canonicalResolution.directionPersistenceActive
          ? "ENGINE3_DIRECTION_PERSISTENCE_ACTIVE"
          : null,

        canonicalResolution.ema10ResetTriggered
          ? "ENGINE3_DIRECTION_RESET_BY_10M_EMA10"
          : null,

        engine26LocationContext?.active === true
          ? "ENGINE26_LOCATION_CONTEXT_CONSUMED"
          : null,

        engine26LocationContext?.authorized === true
          ? "ENGINE26_AUTHORIZED_LOCATION_CONSUMED"
          : null,

        engine26LocationContext?.candidateId
          ? "CANDIDATE_ID_PRESERVED"
          : null,

        engine26LocationContext?.zoneId
          ? "ZONE_ID_PRESERVED"
          : null,

        ...(engine26LocationContext?.reasonCodes || []),

        ...qualification.reasonCodes,

        qualified
          ? "ENGINE3_PAPER_SCALP_REACTION_ALLOWED"
          : "ENGINE3_PAPER_SCALP_REACTION_NOT_ALLOWED",

        "NO_REAL_PERMISSION_CREATED",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
        "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
      ]),
  };

  patchedConfluence.context =
    patchedConfluence.context || {};

  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    paperScalpReaction,
  };

  return patchedConfluence;
}

export default buildPaperScalpReaction;
