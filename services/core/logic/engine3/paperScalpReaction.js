// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 Strategy 1 canonical PAPER_ONLY reaction contract.
//
// Canonical Strategy 1 ownership:
// - Engine 26 owns location, candidate identity, lifecycle authorization,
//   authorized branch, trigger/reclaim/invalidation geometry.
// - 10m owns the primary Strategy 1 reaction direction/context.
// - 5m validates/supports/conflicts with the 10m directional read.
// - 1m is immediate timing evidence with the lowest directional influence.
// - 10m EMA10 persists or resets an already-established direction.
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
  validation5m = null,
  broaderReaction10m = null,
  previousCanonicalDirection = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  engine26ReactionHandoff = null,
} = {}) {
  const oneMinuteState = safeUpper(
    observation1m?.state,
    "NO_SIGNAL"
  );

  const oneMinuteDirection = safeUpper(
    observation1m?.direction,
    "NEUTRAL"
  );

  const fiveMinuteDirection = safeUpper(
    validation5m?.direction,
    "NEUTRAL"
  );

  const validationState = safeUpper(
    validation5m?.validationState,
    "UNRESOLVED"
  );

  const tenMinuteState = safeUpper(
    broaderReaction10m?.state,
    "NO_SIGNAL"
  );

  const tenMinuteDirection = safeUpper(
    broaderReaction10m?.direction,
    "NEUTRAL"
  );

  const previousDirection = safeUpper(
    previousCanonicalDirection,
    "NEUTRAL"
  );

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

  const tenMinuteDirectional =
    tenMinuteDirection === "LONG" ||
    tenMinuteDirection === "SHORT";

  const tenMinuteUsable =
    broaderReaction10m != null &&
    typeof broaderReaction10m === "object" &&
    broaderReaction10m?.active !== false &&
    tenMinuteDirectional;

  const observationPresent =
    observation1m != null &&
    typeof observation1m === "object";

  const observationActive =
    observation1m?.active === true;

  const observationFresh =
    observation1m?.stale === false;

  const observationCompleted =
    observation1m?.currentCandleStatus === "COMPLETED" ||
    observation1m?.candleState === "COMPLETED";

  const observationIdentityAligned =
    identityAligned(
      observation1m,
      engine26ReactionHandoff
    );

  const oneMinuteDirectional =
    oneMinuteDirection === "LONG" ||
    oneMinuteDirection === "SHORT";

  const observationUsable =
    observationPresent &&
    observationActive &&
    observationFresh &&
    observationCompleted &&
    observationIdentityAligned;

  const oneMinuteConflictsPrimary =
    observationUsable &&
    oneMinuteDirectional &&
    tenMinuteDirectional &&
    oneMinuteDirection !== tenMinuteDirection;

  const oneMinuteSupportsPrimary =
    observationUsable &&
    oneMinuteDirectional &&
    tenMinuteDirectional &&
    oneMinuteDirection === tenMinuteDirection;

  const validationPresent =
    validation5m != null &&
    typeof validation5m === "object" &&
    validation5m?.active === true;

  const validationFresh =
    validationPresent &&
    validation5m?.stale === false;

  const validationResolved =
    validation5m?.maturityResolved === true;

  const validationSupportsPrimary =
    validationFresh &&
    (
      validation5m?.supports1mDirection === true ||
      (
        validationResolved &&
        fiveMinuteDirection === tenMinuteDirection &&
        tenMinuteDirectional
      ) ||
      (
        validationState === "SUPPORT" &&
        fiveMinuteDirection === tenMinuteDirection
      )
    );

  const validationConflictsPrimary =
    validationFresh &&
    (
      validation5m?.conflictsWith1mDirection === true ||
      validationState === "CONFLICT" ||
      (
        validationResolved &&
        ["LONG", "SHORT"].includes(fiveMinuteDirection) &&
        tenMinuteDirectional &&
        fiveMinuteDirection !== tenMinuteDirection
      )
    );

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
  let resolutionStatus = "NO_USABLE_10M_DIRECTION";
  let resolutionReason = "TEN_MINUTE_DIRECTION_NOT_AVAILABLE";
  let directionPersistenceActive = false;

  /*
   * Primary Strategy 1 direction hierarchy:
   *
   * 1) Existing LONG/SHORT persists until its completed-10m EMA10 reset.
   * 2) If there is no persisted direction, the 10m reaction establishes
   *    the primary direction.
   * 3) 5m validates/supports/conflicts but does not independently reverse.
   * 4) 1m is immediate timing evidence only and cannot independently flip
   *    the canonical direction.
   */

  if (
    previousDirectional &&
    !ema10ResetTriggered
  ) {
    state = tenMinuteState;

    direction = previousDirection;
    sourceTimeframe = "10m";
    reactionTimeframe = "10m";
    directionPersistenceActive = true;

    resolutionStatus =
      `CANONICAL_${previousDirection}_PERSISTED`;

    resolutionReason =
      ema10DataAvailable
        ? `PREVIOUS_${previousDirection}_HELD_UNTIL_COMPLETED_10M_EMA10_RESET`
        : `PREVIOUS_${previousDirection}_HELD_EMA10_RESET_DATA_UNAVAILABLE`;
  } else if (
    previousDirectional &&
    ema10ResetTriggered
  ) {
    state = tenMinuteState;
    direction = "NEUTRAL";
    sourceTimeframe = "10m";
    reactionTimeframe = "10m";

    resolutionStatus =
      "CANONICAL_DIRECTION_RESET_AT_10M_EMA10";

    resolutionReason =
      previousDirection === "SHORT"
        ? "COMPLETED_10M_CLOSE_ABOVE_EMA10_RESET_SHORT"
        : "COMPLETED_10M_CLOSE_BELOW_EMA10_RESET_LONG";
  } else if (tenMinuteUsable) {
    state = tenMinuteState;
    direction = tenMinuteDirection;
    sourceTimeframe = "10m";
    reactionTimeframe = "10m";

    resolutionStatus =
      "CANONICAL_10M_DIRECTIONAL";

    resolutionReason =
      "TEN_MINUTE_PRIMARY_DIRECTION_ESTABLISHED";
  }

  return {
    state,
    direction,
    sourceTimeframe,
    reactionTimeframe,

    tenMinuteState,
    tenMinuteDirection,
    tenMinuteUsable,

    validationState,
    validationPresent,
    validationFresh,
    validationResolved,
    validationSupportsPrimary,
    validationConflictsPrimary,

    observationPresent,
    observationActive,
    observationFresh,
    observationCompleted,
    observationUsable,
    observationIdentityAligned,
    oneMinuteState,
    oneMinuteDirection,
    oneMinuteSupportsPrimary,
    oneMinuteConflictsPrimary,

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
  broaderReaction10m = null,
  canonicalDirection = "NEUTRAL",
  canonicalResolution = null,
} = {}) {
  const tenMinuteQuality =
    safeUpper(
      broaderReaction10m?.quality,
      "WEAK"
    );

  const oneMinuteQuality =
    safeUpper(
      observation1m?.quality,
      "WEAK"
    );

  const validationQuality =
    safeUpper(
      validation5m?.quality,
      "WEAK"
    );

  let quality = tenMinuteQuality;

  /*
   * 10m owns the base quality.
   * 5m can validate or downgrade it.
   * 1m has the least influence and only downgrades when it gives
   * a fresh completed directional conflict.
   */
  if (
    canonicalResolution?.validationConflictsPrimary === true
  ) {
    quality = "MIXED";
  } else if (
    canonicalResolution?.validationSupportsPrimary === true &&
    quality === "WEAK" &&
    ["GOOD", "STRONG"].includes(validationQuality)
  ) {
    quality = "MIXED";
  }

  if (
    canonicalResolution?.oneMinuteConflictsPrimary === true
  ) {
    if (quality === "STRONG" || quality === "GOOD") {
      quality = "MIXED";
    }
  }

  if (
    !["LONG", "SHORT"].includes(
      safeUpper(canonicalDirection, "NEUTRAL")
    )
  ) {
    return quality;
  }

  return quality;
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
    canonicalResolution?.validationSupportsPrimary === true;

  const validationConflicts =
    canonicalResolution?.validationConflictsPrimary === true;

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

  if (!["LONG", "SHORT"].includes(direction)) {
    blockers.push("CANONICAL_DIRECTION_NOT_DIRECTIONAL");
  }

  if (!directionAlignedWithEngine26) {
    blockers.push("CANONICAL_DIRECTION_CONFLICTS_WITH_ENGINE26_AUTHORIZED_BRANCH");
  }

  if (!QUALIFYING_QUALITY.has(quality)) {
    blockers.push("ENGINE3_CANONICAL_QUALITY_NOT_GOOD_OR_STRONG");
  }

  if (
    canonicalResolution?.oneMinuteConflictsPrimary === true
  ) {
    blockers.push("ONE_MINUTE_IMMEDIATE_DIRECTION_CONFLICT");
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

  if (
    canonicalResolution?.oneMinuteSupportsPrimary === true
  ) {
    reasonCodes.push("ONE_MINUTE_IMMEDIATE_SUPPORT");
  }

  if (
    canonicalResolution?.oneMinuteConflictsPrimary === true
  ) {
    reasonCodes.push("ONE_MINUTE_IMMEDIATE_CONFLICT");
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
      validation5m,
      broaderReaction10m,
      previousCanonicalDirection,
      tenMinuteCompletedClose,
      tenMinuteEma10,
      engine26ReactionHandoff,
    });

  const canonicalQuality =
    resolveCanonicalQuality({
      observation1m,
      validation5m,
      broaderReaction10m,
      canonicalDirection:
        canonicalResolution.direction,
      canonicalResolution,
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
      canonicalResolution.observationIdentityAligned,

    primaryDirectionTimeframe:
      "10m",

    validationDirectionTimeframe:
      "5m",

    immediateDirectionTimeframe:
      "1m",

    tenMinutePrimaryDirection:
      canonicalResolution.tenMinuteDirection,

    fiveMinuteValidationDirection:
      validation5m?.direction || "NEUTRAL",

    oneMinuteImmediateDirection:
      observation1m?.direction || "NEUTRAL",

    oneMinuteImmediateSupportsPrimary:
      canonicalResolution.oneMinuteSupportsPrimary,

    oneMinuteImmediateConflictsPrimary:
      canonicalResolution.oneMinuteConflictsPrimary,

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

    validationSupportsPrimary:
      qualification.validationSupports,

    validationConflictsPrimary:
      qualification.validationConflicts,

    // Compatibility aliases retained for current consumers.
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
        "TEN_MINUTE_PRIMARY_DIRECTION_5M_VALIDATION_1M_IMMEDIATE",
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
