// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 Strategy 1 canonical PAPER_ONLY reaction contract.
//
// Canonical Strategy 1 ownership:
// - Engine 26 owns location, candidate identity, lifecycle authorization,
//   authorized branch, trigger/reclaim/invalidation geometry.
// - 1m proposes a reaction direction; it does NOT directly publish canonical LONG/SHORT.
// - 5m validates/supports/conflicts; canonical direction is published only after confirmation.
// - Before a paper trade is active, 1m/5m own reaction discovery/validation only.
// - After a paper trade is active, its direction persists through diagnostic flips.
// - Completed 10m close vs EMA10 is only the ACTIVE-TRADE hold/reset rule.
// - 10m EMA10 never creates initial direction or initial confirmation.
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

const ENGINE = "engine3.paperScalpReaction.v4";
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
  activePaperTradeDirection = null,
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

  const activeTradeDirection = safeUpper(
    activePaperTradeDirection,
    "NEUTRAL"
  );

  const activePaperTrade =
    activeTradeDirection === "LONG" ||
    activeTradeDirection === "SHORT";

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

  const aligned =
    identityAligned(
      observation1m,
      engine26ReactionHandoff
    );

  const observedDirectional =
    observedDirection === "LONG" ||
    observedDirection === "SHORT";

  const observationUsable =
    observationPresent &&
    observationActive &&
    observationFresh &&
    observationCompleted &&
    aligned;

  const freshDirectionalEvidence =
    observationUsable &&
    observedDirectional;

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

  /*
   * IMPORTANT:
   *
   * This function builds a REACTION CANDIDATE before a paper trade.
   * It does not publish the final Engine 3 direction by itself.
   *
   * 1m may propose LONG / SHORT.
   * 5m confirmation is evaluated later.
   *
   * The final Engine 3 direction stays NEUTRAL until the candidate
   * actually passes confirmation.
   *
   * Once an actual paper trade is active, activePaperTradeDirection
   * becomes the direction owner and completed 10m EMA10 becomes the
   * hold/reset rule.
   */
  let state =
    observationUsable
      ? observedState
      : "NO_SIGNAL";

  let candidateDirection =
    freshDirectionalEvidence
      ? observedDirection
      : "NEUTRAL";

  let sourceTimeframe =
    observationUsable
      ? "1m"
      : null;

  let reactionTimeframe =
    observationUsable
      ? "1m"
      : null;

  let resolutionStatus =
    freshDirectionalEvidence
      ? "REACTION_CANDIDATE_FROM_1M"
      : observationUsable
      ? "REACTION_CANDIDATE_NEUTRAL"
      : "NO_USABLE_1M_REACTION_CANDIDATE";

  let resolutionReason =
    freshDirectionalEvidence
      ? "FRESH_COMPLETED_1M_DIRECTIONAL_REACTION_CANDIDATE"
      : observationUsable
      ? "FRESH_COMPLETED_1M_NON_DIRECTIONAL_REACTION"
      : "ONE_MINUTE_EVIDENCE_UNUSABLE";

  if (!observationPresent) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_MISSING";
  } else if (!aligned) {
    resolutionReason = "ONE_MINUTE_IDENTITY_MISMATCH";
  } else if (observation1m?.stale === true) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_STALE";
  } else if (!observationCompleted) {
    resolutionReason = "ONE_MINUTE_CANDLE_NOT_COMPLETED";
  } else if (!observationActive) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_INACTIVE";
  }

  return {
    state,

    /*
     * Internal candidate direction only.
     * attachPaperScalpReactionToConfluence() resolves final canonical
     * direction after confirmation.
     */
    direction: candidateDirection,
    candidateDirection,

    sourceTimeframe,
    reactionTimeframe,

    observationPresent,
    observationActive,
    observationFresh,
    observationCompleted,
    observationUsable,
    identityAligned: aligned,

    observedState,
    observedDirection,
    freshDirectionalEvidence,

    previousCanonicalDirection:
      previousDirectional
        ? previousDirection
        : "NEUTRAL",

    activePaperTrade,
    activePaperTradeDirection:
      activePaperTrade
        ? activeTradeDirection
        : "NEUTRAL",

    directionPersistenceActive: false,
    directionEstablishedByFresh1m: false,

    tenMinuteCompletedClose:
      completedClose,

    tenMinuteEma10:
      ema10,

    ema10ResetDataAvailable:
      ema10DataAvailable,

    ema10ResetTriggered: false,

    resolutionStatus,
    resolutionReason,
  };
}

function resolveFinalCanonicalDirection({
  candidateResolution,
  candidateConfirmation,
} = {}) {
  const candidateDirection = safeUpper(
    candidateResolution?.candidateDirection ??
      candidateResolution?.direction,
    "NEUTRAL"
  );

  const activePaperTrade =
    candidateResolution?.activePaperTrade === true;

  const activeTradeDirection = safeUpper(
    candidateResolution?.activePaperTradeDirection,
    "NEUTRAL"
  );

  const completedClose =
    toNum(candidateResolution?.tenMinuteCompletedClose);

  const ema10 =
    toNum(candidateResolution?.tenMinuteEma10);

  const ema10DataAvailable =
    completedClose != null &&
    ema10 != null;

  let state =
    candidateResolution?.state ||
    "NO_SIGNAL";

  let direction = "NEUTRAL";
  let sourceTimeframe = null;
  let reactionTimeframe = null;
  let directionPersistenceActive = false;
  let directionEstablishedByFresh1m = false;
  let ema10ResetTriggered = false;
  let resolutionStatus =
    "REACTION_NOT_CONFIRMED_DIRECTION_NEUTRAL";
  let resolutionReason =
    "ENGINE3_DIRECTION_REQUIRES_CONFIRMED_REACTION";

  /*
   * ACTIVE PAPER TRADE:
   * The open trade direction owns Engine 3 direction.
   * 1m / 5m / broader 10m are diagnostics only.
   * Completed 10m EMA10 is the hold/reset rule only here.
   */
  if (activePaperTrade) {
    const resetShort =
      activeTradeDirection === "SHORT" &&
      ema10DataAvailable &&
      completedClose > ema10;

    const resetLong =
      activeTradeDirection === "LONG" &&
      ema10DataAvailable &&
      completedClose < ema10;

    ema10ResetTriggered =
      resetShort || resetLong;

    if (ema10ResetTriggered) {
      state = "ACTIVE_TRADE_DIRECTION_RESET";
      direction = "NEUTRAL";
      sourceTimeframe = "10m";
      reactionTimeframe = "10m";

      resolutionStatus =
        "ACTIVE_PAPER_TRADE_DIRECTION_RESET_AT_10M_EMA10";

      resolutionReason =
        activeTradeDirection === "SHORT"
          ? "ACTIVE_SHORT_RESET_BY_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ACTIVE_LONG_RESET_BY_COMPLETED_10M_CLOSE_BELOW_EMA10";
    } else {
      state = "ACTIVE_TRADE_DIRECTION_PERSISTED";
      direction = activeTradeDirection;
      sourceTimeframe = "ACTIVE_PAPER_TRADE";
      reactionTimeframe = "10m";
      directionPersistenceActive = true;

      resolutionStatus =
        `ACTIVE_PAPER_TRADE_${activeTradeDirection}_PERSISTED`;

      resolutionReason =
        ema10DataAvailable
          ? activeTradeDirection === "SHORT"
            ? "ACTIVE_SHORT_HELD_WHILE_COMPLETED_10M_CLOSE_NOT_ABOVE_EMA10"
            : "ACTIVE_LONG_HELD_WHILE_COMPLETED_10M_CLOSE_NOT_BELOW_EMA10"
          : `ACTIVE_${activeTradeDirection}_HELD_EMA10_DATA_UNAVAILABLE`;
    }
  } else if (
    candidateConfirmation?.reactionConfirmed === true &&
    (candidateDirection === "LONG" || candidateDirection === "SHORT")
  ) {
    /*
     * PRE-TRADE:
     * Engine 3 becomes directional only after the reaction candidate
     * actually passes confirmation. A single 1m flip cannot color or
     * flip canonical Engine 3.
     */
    direction = candidateDirection;
    sourceTimeframe = "1m+5m";
    reactionTimeframe = "1m+5m";
    directionEstablishedByFresh1m = true;

    resolutionStatus =
      `CANONICAL_${candidateDirection}_REACTION_CONFIRMED`;

    resolutionReason =
      "ENGINE3_DIRECTION_PUBLISHED_ONLY_AFTER_REACTION_CONFIRMATION";
  }

  return {
    ...candidateResolution,

    state,
    direction,

    sourceTimeframe,
    reactionTimeframe,

    directionPersistenceActive,
    directionEstablishedByFresh1m,

    ema10ResetTriggered,

    resolutionStatus,
    resolutionReason,
  };
}

function resolveFinalConfirmation({
  candidateConfirmation,
  canonicalResolution,
} = {}) {
  const activePaperTrade =
    canonicalResolution?.activePaperTrade === true;

  const activeTradeReset =
    canonicalResolution?.ema10ResetTriggered === true;

  if (activePaperTrade) {
    if (activeTradeReset) {
      return {
        ...candidateConfirmation,
        reactionConfirmed: false,
        persistedConfirmation: false,
        blockers: unique([
          "ACTIVE_PAPER_TRADE_DIRECTION_RESET_BY_10M_EMA10",
        ]),
        reasonCodes: unique([
          ...(candidateConfirmation?.reasonCodes || []),
          "ENGINE3_ACTIVE_PAPER_TRADE_DIRECTION_RESET",
          "ENGINE3_CANONICAL_REACTION_NOT_CONFIRMED",
        ]),
      };
    }

    /*
     * An actual open paper trade can only exist after the upstream
     * paper-entry chain already completed. While that trade is open,
     * reaction confirmation remains locked with the active trade.
     */
    return {
      ...candidateConfirmation,
      reactionConfirmed: true,
      persistedConfirmation: true,
      blockers: [],
      reasonCodes: unique([
        ...(candidateConfirmation?.reasonCodes || []),
        `ENGINE3_${canonicalResolution?.direction}_CONFIRMATION_LOCKED_TO_ACTIVE_PAPER_TRADE`,
        "ENGINE3_CANONICAL_REACTION_CONFIRMED",
      ]),
    };
  }

  /*
   * Before a trade is active, there is NO confirmation persistence.
   * Current reaction evidence must earn confirmation.
   */
  return {
    ...candidateConfirmation,
    persistedConfirmation: false,
  };
}

function resolveCanonicalQuality({
  observation1m = null,
  validation5m = null,
  canonicalResolution = null,
} = {}) {
  const canonicalDirection =
    safeUpper(
      canonicalResolution?.direction,
      "NEUTRAL"
    );

  const oneMinuteDirection =
    safeUpper(
      observation1m?.direction,
      "NEUTRAL"
    );

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

  const validationFresh =
    validation5m?.active === true &&
    validation5m?.stale === false;

  const validationResolved =
    validation5m?.maturityResolved === true;

  const validationSupports =
    validation5m?.supports1mDirection === true ||
    validationState === "SUPPORT";

  const validationConflicts =
    validation5m?.conflictsWith1mDirection === true ||
    validationState === "CONFLICT";

  const oneMinuteFreshAligned =
    canonicalResolution?.observationUsable === true &&
    ["LONG", "SHORT"].includes(canonicalDirection) &&
    oneMinuteDirection === canonicalDirection;

  /*
   * Canonical Engine 3 quality ownership:
   *
   * - Local 1m / 5m / 10m quality values remain diagnostic only.
   * - Final Engine 3 quality is calculated here from the combined
   *   Strategy 1 evidence.
   *
   * Rules:
   *   No canonical LONG/SHORT                 -> WEAK
   *   5m missing/stale/unresolved             -> WEAK
   *   5m conflict                             -> MIXED
   *   5m support                              -> GOOD
   *   5m support + fresh aligned 1m STRONG    -> STRONG
   */

  if (
    !["LONG", "SHORT"].includes(
      canonicalDirection
    )
  ) {
    return "WEAK";
  }

  if (
    !validationFresh ||
    !validationResolved
  ) {
    return "WEAK";
  }

  if (validationConflicts) {
    return "MIXED";
  }

  if (validationSupports) {
    if (
      oneMinuteFreshAligned &&
      oneMinuteQuality === "STRONG"
    ) {
      return "STRONG";
    }

    return "GOOD";
  }

  return "WEAK";
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

function buildAuthorizationContext({
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  canonicalResolution,
  canonicalQuality,
  currentPrice,
  lastCandle,
} = {}) {
  return buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput: {
      state:
        canonicalResolution?.state ||
        "NO_SIGNAL",
      quality:
        canonicalQuality ||
        "WEAK",
      direction:
        canonicalResolution?.direction ||
        "NEUTRAL",
      confirmed: false,
      currentPrice:
        currentPrice ?? null,
      lastCandle:
        lastCandle || null,
      noPermissionCreated: true,
      noExecution: true,
    },
  });
}

function resolveCanonicalConfirmation({
  canonicalResolution,
  canonicalQuality,
  observation1m = null,
  validation5m = null,
  authorizationContext = null,
  previousReactionConfirmed = false,
} = {}) {
  const blockers = [];
  const reasonCodes = [];

  const direction =
    safeUpper(
      canonicalResolution?.direction,
      "NEUTRAL"
    );

  const oneMinuteState =
    safeUpper(
      observation1m?.state,
      "NO_SIGNAL"
    );

  const oneMinuteDirection =
    safeUpper(
      observation1m?.direction,
      "NEUTRAL"
    );

  const oneMinuteQuality =
    safeUpper(
      observation1m?.quality,
      "WEAK"
    );

  const quality =
    safeUpper(
      canonicalQuality,
      "WEAK"
    );

  /*
   * Engine 26 structural expectation remains visible
   * for diagnostics only.
   *
   * It does NOT own Engine 3 reaction direction.
   */
  const expectedDirection =
    safeUpper(
      authorizationContext?.expectedReactionDirection,
      "NEUTRAL"
    );

  const expectedReactions =
    Array.isArray(
      authorizationContext?.expectedReactions
    )
      ? authorizationContext.expectedReactions.map(
          (state) => safeUpper(state, "")
        )
      : [];

  const authorizationValid =
    authorizationContext?.active === true &&
    authorizationContext?.authorized === true &&
    authorizationContext
      ?.authorizeEngine3Evaluation === true;

  /*
   * Strategy 1 requires exact Engine 26 identity.
   */
  const identityMatched =
    authorizationContext
      ?.identityComparison
      ?.matched === true;

  const chainArmed =
    authorizationContext?.chainArmed === true;

  const canonicalDirectional =
    direction === "LONG" ||
    direction === "SHORT";

  /*
   * Diagnostic only.
   *
   * Engine 26 expected direction no longer blocks or
   * creates canonical Engine 3 reaction direction.
   */
  const branchAligned =
    canonicalDirectional &&
    (
      !["LONG", "SHORT"].includes(expectedDirection) ||
      expectedDirection === direction
    );

  const oneMinuteAligned =
    canonicalResolution?.observationUsable === true &&
    oneMinuteDirection === direction &&
    canonicalDirectional;

  const oneMinuteQualityApproved =
    QUALIFYING_QUALITY.has(oneMinuteQuality);

  const qualityApproved =
    QUALIFYING_QUALITY.has(quality);

  /*
   * Fresh completed 1m candle must itself agree
   * with the canonical direction.
   */
  const candleOpen =
    toNum(observation1m?.currentCandle?.open);

  const candleClose =
    toNum(observation1m?.currentCandle?.close);

  const candleCompleted =
    observation1m?.currentCandleStatus === "COMPLETED" ||
    observation1m?.currentCandle?.completionState === "COMPLETED" ||
    observation1m?.candleState === "COMPLETED";

  const candleDirectionAligned =
    candleCompleted &&
    candleOpen != null &&
    candleClose != null &&
    (
      (
        direction === "SHORT" &&
        candleClose < candleOpen
      ) ||
      (
        direction === "LONG" &&
        candleClose > candleOpen
      )
    );

  /*
   * Local level-action state is now a contradiction
   * check — not a required confirmation whitelist.
   */
  const shortContradictionStates =
    new Set([
      "RECLAIMED_LEVEL",
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "BREAKOUT_HOLDING",
    ]);

  const longContradictionStates =
    new Set([
      "LOST_LEVEL",
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "BREAKOUT_FAILING",
      "FAILED_ACCEPTANCE_SHORT",
      "LOST_SHORT_TRIGGER_LEVEL",
    ]);

  const oneMinuteContradiction =
    direction === "SHORT"
      ? shortContradictionStates.has(oneMinuteState)
      : direction === "LONG"
      ? longContradictionStates.has(oneMinuteState)
      : true;

  /*
   * HELD_LEVEL / CHOP_INSIDE_VALUE / similar
   * non-contradictory states no longer automatically block.
   */
  const approvedReactionState =
    oneMinuteAligned &&
    !oneMinuteContradiction;

  const validationPresent =
    validation5m != null &&
    typeof validation5m === "object" &&
    validation5m?.active === true;

  const validationFresh =
    validationPresent &&
    validation5m?.stale === false;

  const validationState =
    safeUpper(
      validation5m?.validationState,
      "UNRESOLVED"
    );

  const validationResolved =
    validation5m?.maturityResolved === true;

  const validationSupports =
    validation5m?.supports1mDirection === true &&
    validationState === "SUPPORT";

  const validationConflicts =
    validation5m?.conflictsWith1mDirection === true ||
    validationState === "CONFLICT";

  if (!authorizationValid) {
    blockers.push(
      "ENGINE26_EVALUATION_NOT_AUTHORIZED"
    );
  }

  if (!identityMatched) {
    blockers.push(
      "ENGINE26_ENGINE3_IDENTITY_MISMATCH"
    );
  }

  if (!canonicalDirectional) {
    blockers.push(
      "CANONICAL_DIRECTION_NOT_DIRECTIONAL"
    );
  }

  if (!oneMinuteAligned) {
    blockers.push(
      "ONE_MINUTE_REACTION_NOT_ALIGNED_WITH_COMMITTED_DIRECTION"
    );
  }

  if (!oneMinuteQualityApproved) {
    blockers.push(
      "ONE_MINUTE_QUALITY_NOT_GOOD_OR_STRONG"
    );
  }

  if (!candleCompleted) {
    blockers.push(
      "ONE_MINUTE_CANDLE_NOT_COMPLETED"
    );
  } else if (!candleDirectionAligned) {
    blockers.push(
      "ONE_MINUTE_CANDLE_NOT_ALIGNED_WITH_DIRECTION"
    );
  }

  if (oneMinuteContradiction) {
    blockers.push(
      "ONE_MINUTE_REACTION_EXPLICITLY_CONTRADICTS_DIRECTION"
    );
  }

  if (!qualityApproved) {
    blockers.push(
      "ENGINE3_CANONICAL_QUALITY_NOT_GOOD_OR_STRONG"
    );
  }

  if (!validationPresent) {
    blockers.push(
      "FIVE_MINUTE_VALIDATION_MISSING"
    );
  } else if (!validationFresh) {
    blockers.push(
      "FIVE_MINUTE_VALIDATION_STALE"
    );
  } else if (validationConflicts) {
    blockers.push(
      "FIVE_MINUTE_VALIDATION_CONFLICT"
    );
  } else if (!validationResolved) {
    blockers.push(
      "FIVE_MINUTE_VALIDATION_NOT_RESOLVED"
    );
  } else if (!validationSupports) {
    blockers.push(
      "FIVE_MINUTE_VALIDATION_NOT_SUPPORTIVE"
    );
  }

  if (authorizationValid) {
    reasonCodes.push(
      "ENGINE26_EVALUATION_AUTHORIZED"
    );
  }

  if (identityMatched) {
    reasonCodes.push(
      "ENGINE26_ENGINE3_IDENTITY_ALIGNED"
    );
  }

  if (chainArmed) {
    reasonCodes.push(
      "ENGINE26_CHAIN_ARMED"
    );
  }

  /*
   * Keep structural branch alignment visible,
   * but do not use it as a confirmation gate.
   */
  if (branchAligned) {
    reasonCodes.push(
      "ENGINE26_STRUCTURAL_DIRECTION_ALIGNED_DIAGNOSTIC"
    );
  }

  if (oneMinuteAligned) {
    reasonCodes.push(
      "ONE_MINUTE_REACTION_ALIGNED_WITH_COMMITTED_DIRECTION"
    );
  }

  if (oneMinuteQualityApproved) {
    reasonCodes.push(
      "ONE_MINUTE_QUALITY_GOOD_OR_STRONG"
    );
  }

  if (candleDirectionAligned) {
    reasonCodes.push(
      "ONE_MINUTE_COMPLETED_CANDLE_ALIGNED"
    );
  }

  if (!oneMinuteContradiction) {
    reasonCodes.push(
      "ONE_MINUTE_STATE_NOT_DIRECTIONALLY_CONTRADICTORY"
    );
  }

  if (qualityApproved) {
    reasonCodes.push(
      "ENGINE3_CANONICAL_QUALITY_GOOD_OR_STRONG"
    );
  }

  if (
    validationPresent &&
    validationFresh &&
    validationResolved &&
    validationSupports &&
    !validationConflicts
  ) {
    reasonCodes.push(
      "FIVE_MINUTE_VALIDATION_SUPPORT"
    );
  }

/*
 * Confirmation persistence.
 *
 * BEFORE an active paper trade:
 * - confirmation must come from the normal Engine 3 reaction rules;
 * - EMA10 cannot create or preserve confirmation.
 *
 * AFTER an active paper trade exists:
 * - prior confirmation may persist while the active trade direction
 *   remains inside its completed-10m EMA10 hold lifecycle;
 * - EMA10 still cannot create confirmation from scratch.
 */
const previousConfirmed =
  previousReactionConfirmed === true;

/*
 * BEFORE a paper trade is active, confirmation is earned from
 * current reaction evidence only.
 *
 * No previous-confirmation persistence is allowed here.
 * Active-trade confirmation persistence is applied later by
 * resolveFinalConfirmation(), after the actual open-trade direction
 * is known.
 */
const persistedConfirmation = false;

const reactionConfirmed =
  blockers.length === 0;

reasonCodes.push(
  reactionConfirmed
    ? "ENGINE3_CANONICAL_REACTION_CONFIRMED"
    : "ENGINE3_CANONICAL_REACTION_NOT_CONFIRMED"
);

  
  return {
    reactionConfirmed,

    previousReactionConfirmed:
      previousConfirmed,

    persistedConfirmation,

    blockers,
    reasonCodes,
    authorizationValid,
    identityMatched,
    chainArmed,

    canonicalDirectional,
    branchAligned,

    oneMinuteAligned,
    oneMinuteState,
    oneMinuteDirection,
    oneMinuteQuality,
    oneMinuteQualityApproved,

    candleCompleted,
    candleDirectionAligned,

    oneMinuteContradiction,
    approvedReactionState,

    validationPresent,
    validationFresh,
    validationResolved,
    validationSupports,
    validationConflicts,

    qualityApproved,

    expectedDirection,
    expectedReactions,
  };
}
function resolveStrategy1Qualification({
  confirmation,
  finalEngine26LocationContext,
  canonicalResolution,
} = {}) {
  const blockers = [];
  const reasonCodes = [];

  const reactionConfirmed =
    confirmation?.reactionConfirmed === true;

  const activePaperTradeLocked =
    canonicalResolution?.activePaperTrade === true &&
    canonicalResolution?.directionPersistenceActive === true &&
    canonicalResolution?.ema10ResetTriggered !== true &&
    ["LONG", "SHORT"].includes(
      safeUpper(
        canonicalResolution?.direction,
        "NEUTRAL"
      )
    );

  /*
   * Once an actual paper trade is already active, Engine 3 is no longer
   * re-qualifying a fresh entry from 1m/5m. The open trade direction is
   * already authoritative for the trade lifecycle.
   */
  if (activePaperTradeLocked) {
    reasonCodes.push(
      "ENGINE3_ACTIVE_PAPER_TRADE_DIRECTION_LOCKED"
    );
    reasonCodes.push(
      "ENGINE3_STRATEGY1_QUALIFIED_FOR_ENGINE6"
    );

    return {
      qualified: true,
      blockers: [],
      reasonCodes,
    };
  }

  const engine26Verified =
    finalEngine26LocationContext?.confirmed === true &&
    finalEngine26LocationContext?.state === "REACTION_CONFIRMED";

  if (!reactionConfirmed) {
    blockers.push(
      "ENGINE3_REACTION_NOT_CONFIRMED"
    );
  }

  if (!engine26Verified) {
    blockers.push(
      "ENGINE26_AUTHORIZED_REACTION_NOT_CONFIRMED"
    );
  }

  const qualified =
    blockers.length === 0;

  reasonCodes.push(
    qualified
      ? "ENGINE3_STRATEGY1_QUALIFIED_FOR_ENGINE6"
      : "ENGINE3_STRATEGY1_NOT_QUALIFIED_FOR_ENGINE6"
  );

  return {
    qualified,
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
  previousReactionConfirmed = false,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  activePaperTradeDirection = null,
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

  /*
   * STEP 1 — build the current reaction candidate.
   *
   * A 1m candle may propose LONG / SHORT, but it does NOT publish
   * canonical Engine 3 direction yet.
   */
  const candidateResolution =
    resolveCanonicalDirection({
      observation1m,
      previousCanonicalDirection,
      tenMinuteCompletedClose,
      tenMinuteEma10,
      engine26ReactionHandoff,
      activePaperTradeDirection,
    });

  /*
   * STEP 2 — score the candidate with the 5m validation layer.
   */
  const candidateQuality =
    resolveCanonicalQuality({
      observation1m,
      validation5m,
      canonicalResolution:
        candidateResolution,
    });

  const currentPrice =
    validPrice(observation1m?.currentPrice) ??
    validPrice(observation1m?.currentCandle?.close) ??
    validPrice(broaderReaction10m?.currentPrice) ??
    validPrice(currentLevelAction?.currentPrice) ??
    null;

  const lastCandle =
    observation1m?.currentCandle ||
    broaderReaction10m?.lastCandle ||
    currentLevelAction?.lastCandle ||
    null;

  /*
   * STEP 3 — Engine 26 authorization/identity remains required for
   * candidate confirmation.
   */
  const authorizationContext =
    buildAuthorizationContext({
      engine26ReactionHandoff,
      engine26StructuralContext,
      canonicalResolution:
        candidateResolution,
      canonicalQuality:
        candidateQuality,
      currentPrice,
      lastCandle,
    });

  /*
   * STEP 4 — earn reaction confirmation.
   *
   * BEFORE a trade is open:
   * 1m + 5m + Engine 26 authorization/identity must pass.
   *
   * This is the point that prevents a single 1m candle from flipping
   * the canonical Engine 3 card.
   */
  const candidateConfirmation =
    resolveCanonicalConfirmation({
      canonicalResolution:
        candidateResolution,
      canonicalQuality:
        candidateQuality,
      observation1m,
      validation5m,
      authorizationContext,
      previousReactionConfirmed,
    });

  /*
   * STEP 5 — publish the FINAL canonical direction.
   *
   * No active paper trade:
   *   confirmed candidate -> LONG / SHORT
   *   unconfirmed candidate -> NEUTRAL
   *
   * Active paper trade:
   *   open-trade direction owns Engine 3;
   *   completed 10m EMA10 is only the hold/reset rule.
   */
  const canonicalResolution =
    resolveFinalCanonicalDirection({
      candidateResolution,
      candidateConfirmation,
    });

  const confirmation =
    resolveFinalConfirmation({
      candidateConfirmation,
      canonicalResolution,
    });

  const canonicalQuality =
    ["LONG", "SHORT"].includes(
      safeUpper(
        canonicalResolution?.direction,
        "NEUTRAL"
      )
    )
      ? candidateQuality
      : "WEAK";

  const engine26LocationContext =
    buildEngine26LocationReactionContext({
      engine26ReactionHandoff,
      engine26StructuralContext,
      reactionInput: {
        state:
          confirmation.oneMinuteAligned
            ? confirmation.oneMinuteState
            : canonicalResolution.state,
        quality:
          canonicalQuality,
        direction:
          canonicalResolution.direction,
        confirmed:
          confirmation.reactionConfirmed === true,
        currentPrice,
        lastCandle,
        noPermissionCreated: true,
        noExecution: true,
      },
    });

  const qualification =
    resolveStrategy1Qualification({
      confirmation,
      finalEngine26LocationContext:
        engine26LocationContext,
      canonicalResolution,
    });


  const qualified =
    qualification.qualified === true;

  const participationEvaluationEligible =
    qualified;

  const setupType =
    setupTypeForCanonical({
      state:
        canonicalResolution.state,

      direction:
        canonicalResolution.direction,
    });

  const reactionState =
    engine26LocationContext?.state ||
    canonicalResolution.state;

  const activePaperTradeLocked =
    canonicalResolution?.activePaperTrade === true &&
    canonicalResolution?.directionPersistenceActive === true &&
    canonicalResolution?.ema10ResetTriggered !== true &&
    ["LONG", "SHORT"].includes(
      safeUpper(
        canonicalResolution?.direction,
        "NEUTRAL"
      )
    );

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

    directionEstablishmentTimeframe:
      "1m+5m_CONFIRMATION",

    validationTimeframe:
      "5m",

    directionResetTimeframe:
      "10m_ACTIVE_PAPER_TRADE_ONLY",

    oneMinuteImmediateDirection:
      observation1m?.direction || "NEUTRAL",

    fiveMinuteValidationDirection:
      validation5m?.direction || "NEUTRAL",

    broaderTenMinuteDirection:
      broaderReaction10m?.direction || "NEUTRAL",

    reactionCandidateDirection:
      candidateResolution?.candidateDirection ||
      "NEUTRAL",

    reactionCandidateState:
      candidateResolution?.state ||
      "NO_SIGNAL",

    reactionCandidateQuality:
      candidateQuality,

    reactionCandidateConfirmed:
      candidateConfirmation?.reactionConfirmed === true,

    directionEstablishedByFresh1m:
      canonicalResolution.directionEstablishedByFresh1m,

    previousCanonicalDirection:
      canonicalResolution.previousCanonicalDirection,

    activePaperTrade:
      canonicalResolution.activePaperTrade,

    activePaperTradeDirection:
      canonicalResolution.activePaperTradeDirection,

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
      activePaperTradeLocked
        ? "REACTION_CONFIRMED"
        : engine26LocationContext?.state ||
          null,

    authorizedReactionRawState:
      engine26LocationContext?.rawState ||
      canonicalResolution.state,

    reactionState:
      activePaperTradeLocked
        ? "REACTION_CONFIRMED"
        : reactionState,

    reactionConfirmed:
      confirmation.reactionConfirmed === true,

    engine26ReactionVerified:
      activePaperTradeLocked ||
      (
        engine26LocationContext?.confirmed === true &&
        engine26LocationContext?.state === "REACTION_CONFIRMED"
      ),

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
      participationEvaluationEligible,

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

    confirmationDiagnostics: {
      previousReactionConfirmed:
        confirmation.previousReactionConfirmed,

      persistedConfirmation:
        confirmation.persistedConfirmation,

      activePaperTradeLocked,

      authorizationValid:
        confirmation.authorizationValid,
      identityMatched:
        confirmation.identityMatched,
      canonicalDirectional:
        confirmation.canonicalDirectional,
      branchAligned:
        confirmation.branchAligned,
      oneMinuteAligned:
        confirmation.oneMinuteAligned,
      approvedReactionState:
        confirmation.approvedReactionState,
      qualityApproved:
        confirmation.qualityApproved,
      validationPresent:
        confirmation.validationPresent,
      validationFresh:
        confirmation.validationFresh,
      validationResolved:
        confirmation.validationResolved,
      validationSupports:
        confirmation.validationSupports,
      validationConflicts:
        confirmation.validationConflicts,
      expectedDirection:
        confirmation.expectedDirection,
      expectedReactions:
        confirmation.expectedReactions,
    },

    validationState:
      validation5m?.validationState || null,

    validationSupports1m:
      validation5m?.supports1mDirection === true,

    validationConflictsWith1m:
      validation5m?.conflictsWith1mDirection === true,

    validationResolved5m:
      validation5m?.maturityResolved === true,

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
      unique([
        ...(confirmation.blockers || []),
        ...(qualification.blockers || []),
      ]),

    reasonCodes:
      unique([
        "PAPER_ONLY_RESEARCH_LANE",
        "ENGINE3_STRATEGY1_CANONICAL_REACTION_V3",
        "ONE_CANONICAL_ENGINE3_DIRECTION_OWNER",
        "MANAGER_APPROVED_STRATEGY1_DIRECTION_CONTRACT",
        "ONE_MINUTE_PROPOSES_REACTION_DIRECTION",
        "FIVE_MINUTE_VALIDATES_REACTION_DIRECTION",
        "CANONICAL_DIRECTION_REQUIRES_REACTION_CONFIRMATION",
        "TEN_MINUTE_EMA10_ACTIVE_TRADE_HOLD_RESET_ONLY",
        canonicalResolution.resolutionStatus,
        canonicalResolution.resolutionReason,

        canonicalResolution.directionPersistenceActive
          ? "ENGINE3_DIRECTION_PERSISTENCE_ACTIVE"
          : null,

        activePaperTradeLocked
          ? "ENGINE3_ACTIVE_PAPER_TRADE_DIRECTION_LOCKED"
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

        ...(confirmation.reasonCodes || []),

        ...(engine26LocationContext?.reasonCodes || []),

        ...qualification.reasonCodes,

        qualified
          ? "ENGINE3_PAPER_SCALP_REACTION_ALLOWED"
          : "ENGINE3_PAPER_SCALP_REACTION_NOT_ALLOWED",

        participationEvaluationEligible
          ? "ENGINE4_PARTICIPATION_EVALUATION_ELIGIBLE"
          : "ENGINE4_PARTICIPATION_EVALUATION_NOT_ELIGIBLE",

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
