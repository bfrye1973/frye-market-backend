// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 Strategy 1 canonical PAPER_ONLY reaction contract.
//
// Canonical Strategy 1 ownership:
// - Engine 26 owns location, candidate identity, lifecycle authorization,
//   authorized branch, trigger/reclaim/invalidation geometry.
// - 1m proposes a reaction direction; it does NOT directly publish canonical LONG/SHORT.
// - INSIDE the negotiated zone, completed 1m reaction evidence may confirm without
//   waiting for a completed 5m validation candle.
// - Once price leaves the negotiated zone, the established direction is held
//   by completed 10m close vs EMA10; 1m/5m become diagnostic only.
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

/*
 * Strategy 1 book-based reaction language.
 *
 * These states describe the developing PRICE REACTION.
 * They are not legacy contradiction/veto lists.
 *
 * 5m completed reaction evidence uses these states to propose
 * the current Engine 3 reaction direction.
 */
const BULLISH_REACTION_STATES = new Set([
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "RECLAIMED_LEVEL",
  "HELD_LEVEL",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

const BEARISH_REACTION_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
  "FAILED_ACCEPTANCE_SHORT",
  "LOST_SHORT_TRIGGER_LEVEL",
]);

function directionFromReactionState(state) {
  const normalized =
    safeUpper(state, "NO_SIGNAL");

  if (BULLISH_REACTION_STATES.has(normalized)) {
    return "LONG";
  }

  if (BEARISH_REACTION_STATES.has(normalized)) {
    return "SHORT";
  }

  return "NEUTRAL";
}
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

/*
 * Exact negotiated-zone position from Engine 26 handoff geometry.
 *
 * No guessed relation labels are required here.
 * If price and lo/hi are available:
 *   lo <= price <= hi  -> INSIDE_ZONE
 *   price < lo         -> BELOW_ZONE
 *   price > hi         -> ABOVE_ZONE
 *
 * If geometry is incomplete, position is UNKNOWN and the safer
 * outside-zone 5m validation contract remains in force.
 */
function resolveNegotiatedZonePosition({
  currentPrice = null,
  zone = null,
} = {}) {
  const price = validPrice(currentPrice);
  const rawLo = validPrice(zone?.lo);
  const rawHi = validPrice(zone?.hi);

  if (
    price == null ||
    rawLo == null ||
    rawHi == null
  ) {
    return {
      known: false,
      inside: false,
      position: "UNKNOWN",
      currentPrice: price,
      lo: rawLo,
      hi: rawHi,
    };
  }

  const lo = Math.min(rawLo, rawHi);
  const hi = Math.max(rawLo, rawHi);

  if (price >= lo && price <= hi) {
    return {
      known: true,
      inside: true,
      position: "INSIDE_ZONE",
      currentPrice: price,
      lo,
      hi,
    };
  }

  return {
    known: true,
    inside: false,
    position:
      price < lo
        ? "BELOW_ZONE"
        : "ABOVE_ZONE",
    currentPrice: price,
    lo,
    hi,
  };
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
  matureReaction5m = null,
  validation5m = null,
  previousCanonicalDirection = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  engine26ReactionHandoff = null,
  activePaperTradeDirection = null,
} = {}) {
  /*
   * Strategy 1 reaction discovery:
   *
   * 1m has NO canonical direction authority here.
   *
   * Completed 5m book-based price-reaction evidence proposes
   * the developing reaction direction.
   *
   * 10m confirmation is intentionally handled later.
   */
  const reactionState =
    safeUpper(
      matureReaction5m?.state,
      "NO_SIGNAL"
    );

  const reactionQuality =
    safeUpper(
      matureReaction5m?.quality,
      "WEAK"
    );

  const stateDirection =
    directionFromReactionState(
      reactionState
    );

  /*
   * The 5m sensor also publishes a direction.
   *
   * For the book-based reaction candidate, the reaction STATE is
   * authoritative. The sensor direction remains diagnostic and must
   * not override the book-state interpretation.
   */
  const observedFiveMinuteDirection =
    safeUpper(
      matureReaction5m?.direction,
      "NEUTRAL"
    );

  const previousDirection =
    safeUpper(
      previousCanonicalDirection,
      "NEUTRAL"
    );

  const activeTradeDirection =
    safeUpper(
      activePaperTradeDirection,
      "NEUTRAL"
    );

  const activePaperTrade =
    activeTradeDirection === "LONG" ||
    activeTradeDirection === "SHORT";

  const previousDirectional =
    previousDirection === "LONG" ||
    previousDirection === "SHORT";

  const completedClose =
    toNum(tenMinuteCompletedClose);

  const ema10 =
    toNum(tenMinuteEma10);

  const ema10DataAvailable =
    completedClose != null &&
    ema10 != null;

  /*
   * Exact Engine 26 identity remains mandatory.
   *
   * The 5m validation object carries the same candidate identity
   * supplied by Engine 26.
   */
  const fiveMinuteIdentityAligned =
    identityAligned(
      validation5m,
      engine26ReactionHandoff
    );

  const reactionPresent =
    matureReaction5m != null &&
    typeof matureReaction5m === "object";

  const reactionActive =
    matureReaction5m?.active === true;

  const reactionDirectional =
    stateDirection === "LONG" ||
    stateDirection === "SHORT";

  const reactionQualityApproved =
    QUALIFYING_QUALITY.has(
      reactionQuality
    );

  const reactionUsable =
    reactionPresent &&
    reactionActive &&
    fiveMinuteIdentityAligned;

  const candidateDirection =
    reactionUsable &&
    reactionDirectional
      ? stateDirection
      : "NEUTRAL";

  let resolutionStatus =
    "NO_USABLE_5M_BOOK_REACTION_CANDIDATE";

  let resolutionReason =
    "COMPLETED_5M_BOOK_REACTION_NOT_USABLE";

  if (!reactionPresent) {
    resolutionReason =
      "COMPLETED_5M_BOOK_REACTION_MISSING";
  } else if (!fiveMinuteIdentityAligned) {
    resolutionReason =
      "FIVE_MINUTE_ENGINE26_IDENTITY_MISMATCH";
  } else if (!reactionActive) {
    resolutionReason =
      "COMPLETED_5M_BOOK_REACTION_INACTIVE";
  } else if (!reactionDirectional) {
    resolutionStatus =
      "REACTION_CANDIDATE_NEUTRAL_FROM_5M_BOOK_STATE";

    resolutionReason =
      `COMPLETED_5M_BOOK_REACTION_${reactionState}_IS_NOT_DIRECTIONAL`;
  } else {
    resolutionStatus =
      `REACTION_CANDIDATE_${candidateDirection}_FROM_5M_BOOK_REACTION`;

    resolutionReason =
      `COMPLETED_5M_BOOK_REACTION_${reactionState}_PROPOSES_${candidateDirection}`;
  }

  return {
    /*
     * Book-based reaction state is now the reaction candidate state.
     */
    state:
      reactionUsable
        ? reactionState
        : "NO_SIGNAL",

    direction:
      candidateDirection,

    candidateDirection,

    candidateQuality:
      reactionQuality,

    sourceTimeframe:
      reactionUsable
        ? "5m"
        : null,

    reactionTimeframe:
      reactionUsable
        ? "5m"
        : null,

    /*
     * New canonical reaction-candidate diagnostics.
     */
    reactionPresent,
    reactionActive,
    reactionUsable,
    reactionDirectional,
    reactionQualityApproved,

    fiveMinuteIdentityAligned,

    fiveMinuteBookState:
      reactionState,

    fiveMinuteBookDirection:
      stateDirection,

    fiveMinuteObservedDirection:
      observedFiveMinuteDirection,

    fiveMinuteBookQuality:
      reactionQuality,

    /*
     * 1m no longer participates in canonical candidate ownership.
     */
    observationPresent: false,
    observationActive: false,
    observationFresh: false,
    observationCompleted: false,
    observationUsable: false,
    identityAligned:
      fiveMinuteIdentityAligned,

    observedState:
      reactionState,

    observedDirection:
      stateDirection,

    freshDirectionalEvidence:
      reactionUsable &&
      reactionDirectional,

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

    /*
     * Preserve this legacy output field temporarily for schema
     * compatibility, but it must now always be false.
     */
    directionEstablishedByFresh1m:
      false,

    tenMinuteCompletedClose:
      completedClose,

    tenMinuteEma10:
      ema10,

    ema10ResetDataAvailable:
      ema10DataAvailable,

    ema10ResetTriggered:
      false,

    resolutionStatus,
    resolutionReason,
  };
}
function resolveFinalCanonicalDirection({
  candidateResolution,
  candidateConfirmation,
  insideNegotiatedZone = false,
  negotiatedZonePositionKnown = false,
} = {}) {
  const candidateDirection = safeUpper(
    candidateResolution?.candidateDirection ??
      candidateResolution?.direction,
    "NEUTRAL"
  );

  const previousDirection = safeUpper(
    candidateResolution?.previousCanonicalDirection,
    "NEUTRAL"
  );

  const previousDirectional =
    previousDirection === "LONG" ||
    previousDirection === "SHORT";

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
    "ENGINE3_DIRECTION_REQUIRES_NEGOTIATED_ZONE_REACTION";

  /*
   * ACTIVE PAPER TRADE:
   * Existing contract remains unchanged.
   * The open trade direction owns Engine 3 direction.
   * Only a completed 10m close across EMA10 resets it.
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
          : `ACTIVE_${activeTradeDirection}_HELD_UNTIL_COMPLETED_10M_EMA10_RESET`;
    }
  } else if (
    previousDirectional
  ) {
    /*
     * AFTER PRICE LEAVES THE NEGOTIATED ZONE:
     *
     * The direction that was established in the negotiated zone stays
     * locked. 1m and 5m are diagnostics only and cannot flip it.
     *
     * SHORT:
     *   stay SHORT until a COMPLETED 10m candle closes ABOVE EMA10.
     *
     * LONG:
     *   stay LONG until a COMPLETED 10m candle closes BELOW EMA10.
     *
     * EMA10 never creates the initial direction. It only holds/resets
     * the already-established negotiated-zone direction.
     */
    const resetShort =
      previousDirection === "SHORT" &&
      ema10DataAvailable &&
      completedClose > ema10;

    const resetLong =
      previousDirection === "LONG" &&
      ema10DataAvailable &&
      completedClose < ema10;

    ema10ResetTriggered =
      resetShort || resetLong;

    if (ema10ResetTriggered) {
      state = "ZONE_EXIT_DIRECTION_RESET";
      direction = "NEUTRAL";
      sourceTimeframe = "10m";
      reactionTimeframe = "10m";

      resolutionStatus =
        `ZONE_EXIT_${previousDirection}_RESET_AT_10M_EMA10`;

      resolutionReason =
        previousDirection === "SHORT"
          ? "ZONE_EXIT_SHORT_RESET_BY_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ZONE_EXIT_LONG_RESET_BY_COMPLETED_10M_CLOSE_BELOW_EMA10";
    } else {
      state = "ZONE_EXIT_DIRECTION_PERSISTED";
      direction = previousDirection;
      sourceTimeframe = "10m_EMA10_HOLD";
      reactionTimeframe = "10m";
      directionPersistenceActive = true;

      resolutionStatus =
        `ZONE_EXIT_${previousDirection}_PERSISTED_BY_10M_EMA10`;

      resolutionReason =
        previousDirection === "SHORT"
          ? "ZONE_EXIT_SHORT_HELD_UNTIL_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ZONE_EXIT_LONG_HELD_UNTIL_COMPLETED_10M_CLOSE_BELOW_EMA10";
    }
  } else if (
    insideNegotiatedZone &&
    candidateConfirmation?.reactionConfirmed === true &&
    (candidateDirection === "LONG" || candidateDirection === "SHORT")
  ) {
    /*
     * INSIDE NEGOTIATED ZONE:
     * The completed qualified 1m reaction establishes direction.
     * 5m does not own confirmation and does not delay the reaction.
     */
    direction = candidateDirection;
    sourceTimeframe = "1m";
    reactionTimeframe = "1m";
    directionEstablishedByFresh1m = true;

    resolutionStatus =
      `CANONICAL_${candidateDirection}_NEGOTIATED_ZONE_REACTION_CONFIRMED`;

    resolutionReason =
      "ENGINE3_DIRECTION_ESTABLISHED_BY_COMPLETED_1M_REACTION_INSIDE_NEGOTIATED_ZONE";
  } else if (
    negotiatedZonePositionKnown &&
    !insideNegotiatedZone
  ) {
    /*
     * Price is outside the negotiated zone but no prior canonical
     * LONG/SHORT exists to hold.
     *
     * Do not manufacture a new direction from 1m, 5m, or EMA10.
     * A fresh direction must first be established by reaction in a
     * negotiated zone.
     */
    state = "WAITING_FOR_NEGOTIATED_ZONE_DIRECTION";
    direction = "NEUTRAL";
    sourceTimeframe = null;
    reactionTimeframe = null;

    resolutionStatus =
      "OUTSIDE_ZONE_WITHOUT_ESTABLISHED_DIRECTION";

    resolutionReason =
      "EMA10_CANNOT_CREATE_INITIAL_DIRECTION";
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

  const directionPersistenceActive =
    canonicalResolution?.directionPersistenceActive === true;

  const ema10ResetTriggered =
    canonicalResolution?.ema10ResetTriggered === true;

  if (ema10ResetTriggered) {
    return {
      ...candidateConfirmation,
      reactionConfirmed: false,
      persistedConfirmation: false,
      blockers: unique([
        "ENGINE3_DIRECTION_RESET_BY_COMPLETED_10M_EMA10",
      ]),
      reasonCodes: unique([
        ...(candidateConfirmation?.reasonCodes || []),
        "ENGINE3_DIRECTION_RESET_BY_10M_EMA10",
        "ENGINE3_CANONICAL_REACTION_NOT_CONFIRMED",
      ]),
    };
  }

  if (
    activePaperTrade ||
    directionPersistenceActive
  ) {
    /*
     * Once direction is locked to either:
     * - an actual active paper trade, or
     * - the post-negotiated-zone 10m EMA10 hold,
     *
     * 1m/5m diagnostic flips cannot remove confirmation.
     */
    return {
      ...candidateConfirmation,
      reactionConfirmed: true,
      persistedConfirmation: true,
      blockers: [],
      reasonCodes: unique([
        ...(candidateConfirmation?.reasonCodes || []),
        directionPersistenceActive
          ? `ENGINE3_${canonicalResolution?.direction}_CONFIRMATION_PERSISTED_BY_10M_EMA10`
          : `ENGINE3_${canonicalResolution?.direction}_CONFIRMATION_LOCKED_TO_ACTIVE_PAPER_TRADE`,
        "ENGINE3_CANONICAL_REACTION_CONFIRMED",
      ]),
    };
  }

  /*
   * Before a direction is established/locked, there is no persistence.
   * Current negotiated-zone reaction evidence must earn confirmation.
   */
  return {
    ...candidateConfirmation,
    persistedConfirmation: false,
  };
}
function resolveCanonicalQuality({
  observation1m = null,
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

  const oneMinuteFreshAligned =
    canonicalResolution?.observationUsable === true &&
    ["LONG", "SHORT"].includes(canonicalDirection) &&
    oneMinuteDirection === canonicalDirection;

  /*
   * 1m owns the immediate reaction candidate inside the negotiated zone.
   * 5m remains diagnostic and does not own direction confirmation.
   */
  if (
    !["LONG", "SHORT"].includes(
      canonicalDirection
    )
  ) {
    return "WEAK";
  }

  if (
    oneMinuteFreshAligned &&
    QUALIFYING_QUALITY.has(oneMinuteQuality)
  ) {
    return oneMinuteQuality;
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
  insideNegotiatedZone = false,
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

  /*
   * 5m remains diagnostic only.
   * It does not create, flip, hold, or reset canonical Engine 3 direction.
   */
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

  if (insideNegotiatedZone) {
    reasonCodes.push(
      "ENGINE3_NEGOTIATED_ZONE_REACTION_MODE"
    );
    reasonCodes.push(
      "FIVE_MINUTE_DIAGNOSTIC_ONLY"
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

    insideNegotiatedZone,
    fiveMinuteValidationRequired:
      false,

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

  const zoneExitDirectionLocked =
    canonicalResolution?.activePaperTrade !== true &&
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
  if (
    activePaperTradeLocked ||
    zoneExitDirectionLocked
  ) {
    reasonCodes.push(
      activePaperTradeLocked
        ? "ENGINE3_ACTIVE_PAPER_TRADE_DIRECTION_LOCKED"
        : "ENGINE3_ZONE_EXIT_DIRECTION_LOCKED_BY_10M_EMA10"
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

/*
 * Strategy 1 mature 5m price-reaction evidence.
 *
 * This comes from COMPLETED 5m candles only.
 * It is separate from the legacy SUPPORT / CONFLICT-with-1m fields.
 *
 * IMPORTANT:
 * This is being transported into paperScalpReaction first.
 * It does NOT own canonical Engine 3 direction yet.
 */
const matureReaction5m = {
  active:
    validation5m?.completedZoneReactionActive === true,

  state:
    safeUpper(
      validation5m?.completedZoneReactionState,
      "NO_SIGNAL"
    ),

  direction:
    safeUpper(
      validation5m?.completedZoneReactionDirection,
      "NEUTRAL"
    ),

  quality:
    safeUpper(
      validation5m?.completedZoneReactionQuality,
      "WEAK"
    ),

  role:
    validation5m?.completedZoneReactionRole ||
    "MATURE_ENGINE3_REACTION_EVIDENCE",

  referenceType:
    validation5m?.referenceType ||
    null,

  referenceLabel:
    validation5m?.referenceLabel ||
    null,

  referenceLevel:
    toNum(
      validation5m?.referenceLevel
    ),

  negotiatedZone:
    validation5m?.negotiatedZone ||
    null,

  levelAction:
    validation5m?.completedLevelAction ||
    null,

  sourceTimeframe:
    "5m",

  canonicalDirectionAuthority:
    false,

  canonicalQualificationAuthority:
    false,
};

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
      matureReaction5m,
      validation5m,
      previousCanonicalDirection,
      tenMinuteCompletedClose,
      tenMinuteEma10,
      engine26ReactionHandoff,
      activePaperTradeDirection,
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
   * Exact Engine 26 negotiated-zone mode.
   *
   * We intentionally calculate this from currentPrice + handoff.zone lo/hi
   * instead of guessing text relation semantics.
   */
  const negotiatedZonePosition =
    resolveNegotiatedZonePosition({
      currentPrice,
      zone:
        engine26ReactionHandoff?.zone ||
        null,
    });

  const insideNegotiatedZone =
    negotiatedZonePosition.inside === true;

  /*
   * STEP 2 — score the candidate.
   *
   * INSIDE zone:
   *   1m quality owns immediate reaction quality.
   *
   * OUTSIDE zone:
   *   existing 5m validation quality remains in force.
   */
  const candidateQuality =
    resolveCanonicalQuality({
      observation1m,
      canonicalResolution:
        candidateResolution,
    });

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
   *
   * INSIDE negotiated zone:
   *   completed qualified 1m + Engine 26 authorization/identity must pass.
   *   5m remains diagnostic only; no completed-5m wait is required.
   *
   * OUTSIDE negotiated zone:
   *   1m + completed/fresh/resolved/supportive 5m +
   *   Engine 26 authorization/identity must pass.
   *
   * This preserves the 5m anti-flip filter during clear directional travel
   * without slowing the actual negotiated-zone reaction.
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
      insideNegotiatedZone,
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
      insideNegotiatedZone,
      negotiatedZonePositionKnown:
        negotiatedZonePosition.known === true,
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

    /*
     * Zone-aware direction establishment contract.
     */
    directionEstablishmentTimeframe:
      insideNegotiatedZone
        ? "1m_NEGOTIATED_ZONE_REACTION"
        : canonicalResolution.directionPersistenceActive
        ? "10m_EMA10_POST_ZONE_HOLD"
        : "NEGOTIATED_ZONE_REACTION_REQUIRED",

    validationTimeframe:
      "5m_DIAGNOSTIC_ONLY",

    directionResetTimeframe:
      "10m_ACTIVE_PAPER_TRADE_ONLY",

    insideNegotiatedZone,

    negotiatedZonePosition:
      negotiatedZonePosition.position,

    negotiatedZonePositionKnown:
      negotiatedZonePosition.known,

    negotiatedZoneLo:
      negotiatedZonePosition.lo,

    negotiatedZoneHi:
      negotiatedZonePosition.hi,

    fiveMinuteValidationRequired:
      false,

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

    /*
     * Completed 5m book-based price-reaction evidence.
     *
     * This is the future reaction-phase input.
     * Canonical authority is NOT enabled in this edit.
     */
    matureReaction5m,

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
      insideNegotiatedZone:
        confirmation.insideNegotiatedZone,
      fiveMinuteValidationRequired:
        false,
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
      "5m_DIAGNOSTIC_ONLY",

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
        "ENGINE3_5M_MATURE_REACTION_EVIDENCE_AVAILABLE",

        matureReaction5m?.active === true
          ? "ENGINE3_COMPLETED_5M_REACTION_ACTIVE"
          : "ENGINE3_COMPLETED_5M_REACTION_NOT_ACTIVE",
        "ONE_MINUTE_PROPOSES_REACTION_DIRECTION",

        insideNegotiatedZone
          ? "NEGOTIATED_ZONE_1M_REACTION_MODE"
          : canonicalResolution.directionPersistenceActive
          ? "POST_ZONE_10M_EMA10_DIRECTION_HOLD"
          : "OUTSIDE_ZONE_WAITING_FOR_ESTABLISHED_DIRECTION",

        "FIVE_MINUTE_DIAGNOSTIC_ONLY",

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
