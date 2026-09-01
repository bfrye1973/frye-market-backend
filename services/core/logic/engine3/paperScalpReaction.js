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

  "PUSHING_HIGHER",
]);

const BEARISH_REACTION_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
  "FAILED_ACCEPTANCE_SHORT",
  "LOST_SHORT_TRIGGER_LEVEL",

  "PUSHING_LOWER",
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
 * If geometry is incomplete, position is UNKNOWN and Engine 3 must not
 * invent a fresh canonical direction.
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
function resolveCleanTenMinuteDeparture({
  priorCompletedClose = null,
  completedClose = null,
  zoneLo = null,
  zoneHi = null,
} = {}) {
  const priorClose =
    toNum(priorCompletedClose);

  const currentClose =
    toNum(completedClose);

  const rawLo =
    validPrice(zoneLo);

  const rawHi =
    validPrice(zoneHi);

  if (
    priorClose == null ||
    currentClose == null ||
    rawLo == null ||
    rawHi == null
  ) {
    return {
      active: false,
      direction: "NEUTRAL",
      priorCompletedClose: priorClose,
      completedClose: currentClose,
      zoneLo: rawLo,
      zoneHi: rawHi,
      reason:
        "TWO_COMPLETED_10M_CLOSES_OR_ZONE_UNAVAILABLE",
    };
  }

  const lo =
    Math.min(rawLo, rawHi);

  const hi =
    Math.max(rawLo, rawHi);

  /*
   * Diagnostic two-candle departure read only.
   *
   * This object has no canonical direction or qualification authority.
   *
   * SHORT:
   * - two consecutive completed 10m closes below zone low
   * - second close <= first close
   *
   * LONG:
   * - two consecutive completed 10m closes above zone high
   * - second close >= first close
   */
  const cleanShortDeparture =
    priorClose < lo &&
    currentClose < lo &&
    currentClose <= priorClose;

  const cleanLongDeparture =
    priorClose > hi &&
    currentClose > hi &&
    currentClose >= priorClose;

  if (cleanShortDeparture) {
    return {
      active: true,
      direction: "SHORT",
      priorCompletedClose: priorClose,
      completedClose: currentClose,
      zoneLo: lo,
      zoneHi: hi,
      reason:
        "TWO_COMPLETED_10M_CLOSES_CLEANLY_BELOW_NEGOTIATED_ZONE",
    };
  }

  if (cleanLongDeparture) {
    return {
      active: true,
      direction: "LONG",
      priorCompletedClose: priorClose,
      completedClose: currentClose,
      zoneLo: lo,
      zoneHi: hi,
      reason:
        "TWO_COMPLETED_10M_CLOSES_CLEANLY_ABOVE_NEGOTIATED_ZONE",
    };
  }

  return {
    active: false,
    direction: "NEUTRAL",
    priorCompletedClose: priorClose,
    completedClose: currentClose,
    zoneLo: lo,
    zoneHi: hi,
    reason:
      "TWO_COMPLETED_10M_CLEAN_DEPARTURE_NOT_CONFIRMED",
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
  observation1m = null,
  validation5m = null,
  previousCanonicalDirection = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  engine26ReactionHandoff = null,
  activePaperTradeDirection = null,
} = {}) {
  /*
   * Strategy 1 canonical reaction discovery.
   *
   * Only COMPLETED 1m price-action evidence may establish a fresh
   * canonical LONG / SHORT at the negotiated zone.
   *
   * Forming 1m, semantic level-action labels, 5m, 10m, Engine 26 bias,
   * and EMA10 do not create canonical direction here.
   */
const completedState = safeUpper(
  validation5m?.completedPriceActionState,
  "NO_CLEAR_DIRECTION"
);

const completedDirection = safeUpper(
  validation5m?.completedPriceActionDirection,
  "NEUTRAL"
);

const completedQuality = safeUpper(
  validation5m?.completedPriceActionQuality,
  "WEAK"
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

  const previousDirectional =
    previousDirection === "LONG" ||
    previousDirection === "SHORT";

  const completedClose = toNum(tenMinuteCompletedClose);
  const ema10 = toNum(tenMinuteEma10);

  const ema10DataAvailable =
    completedClose != null &&
    ema10 != null;

  const observationPresent =
    observation1m != null &&
    typeof observation1m === "object";

  const observationActive =
    observation1m?.active === true;

  const observationFresh =
    observation1m?.stale !== true;

  const oneMinuteIdentityAligned =
    identityAligned(
      observation1m,
      engine26ReactionHandoff
    );

  const reactionDirectional =
    completedDirection === "LONG" ||
    completedDirection === "SHORT";

  const reactionQualityApproved =
    QUALIFYING_QUALITY.has(completedQuality);

  const observationUsable =
    observationPresent &&
    observationActive &&
    observationFresh &&
    oneMinuteIdentityAligned &&
    reactionDirectional &&
    reactionQualityApproved;

  const candidateDirection =
    observationUsable
      ? completedDirection
      : "NEUTRAL";

  let resolutionStatus =
    "NO_USABLE_COMPLETED_1M_REACTION_CANDIDATE";

  let resolutionReason =
    "COMPLETED_1M_REACTION_NOT_USABLE";

  if (!observationPresent) {
    resolutionReason =
      "COMPLETED_1M_REACTION_MISSING";
  } else if (!oneMinuteIdentityAligned) {
    resolutionReason =
      "ONE_MINUTE_ENGINE26_IDENTITY_MISMATCH";
  } else if (!observationActive) {
    resolutionReason =
      "ONE_MINUTE_REACTION_INACTIVE";
  } else if (!observationFresh) {
    resolutionReason =
      "ONE_MINUTE_REACTION_STALE";
  } else if (!reactionDirectional) {
    resolutionStatus =
      "REACTION_CANDIDATE_NEUTRAL_FROM_COMPLETED_1M";
    resolutionReason =
      "COMPLETED_1M_PRICE_ACTION_NOT_DIRECTIONAL";
  } else if (!reactionQualityApproved) {
    resolutionStatus =
      `REACTION_CANDIDATE_${completedDirection}_QUALITY_NOT_APPROVED`;
    resolutionReason =
      `COMPLETED_1M_${completedDirection}_${completedQuality}_NOT_QUALIFIED`;
  } else {
    resolutionStatus =
      `REACTION_CANDIDATE_${candidateDirection}_FROM_COMPLETED_1M`;
    resolutionReason =
      `COMPLETED_1M_PRICE_ACTION_${candidateDirection}_${completedQuality}`;
  }

  return {
    state:
      observationUsable
        ? completedState
        : "NO_SIGNAL",

    direction: candidateDirection,
    candidateDirection,
    candidateQuality: completedQuality,

    sourceTimeframe:
      observationUsable
        ? "1m"
        : null,

    reactionTimeframe:
      observationUsable
        ? "1m"
        : null,

    reactionPresent: observationPresent,
    reactionActive: observationActive,
    reactionUsable: observationUsable,
    reactionDirectional,
    reactionQualityApproved,

    observationPresent,
    observationActive,
    observationFresh,
    observationCompleted: reactionDirectional,
    observationUsable,
    identityAligned: oneMinuteIdentityAligned,

    observedState: completedState,
    observedDirection: completedDirection,
    freshDirectionalEvidence: observationUsable,

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
    directionEstablishedByFresh1m: observationUsable,

    tenMinuteCompletedClose: completedClose,
    tenMinuteEma10: ema10,
    ema10ResetDataAvailable: ema10DataAvailable,
    ema10ResetTriggered: false,

    resolutionStatus,
    resolutionReason,
  };
}

function resolveFinalCanonicalDirection({
  candidateResolution,
  candidateConfirmation,

  establishedTripDirection = null,
  engine26MidpointReset = false,

  insideNegotiatedZone = false,
  negotiatedZonePositionKnown = false,

  cleanTenMinuteDeparture = null,
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

  const previousReactionConfirmed =
    candidateConfirmation?.previousReactionConfirmed === true;

  const lockedTripDirection = safeUpper(
    establishedTripDirection,
    "NEUTRAL"
  );

  const lockedTripDirectional =
    lockedTripDirection === "LONG" ||
    lockedTripDirection === "SHORT";

  const previousDirectional =
    previousDirection === "LONG" ||
    previousDirection === "SHORT";
/*
 * Once Engine 3 has already confirmed a directional reaction
 * for this negotiated-zone cycle, later 1m candles remain
 * diagnostic and may NOT reverse that established direction.
 *
 * Engine 26 midpoint completion is handled before this lock,
 * so a completed trip still resets Engine 3 to NEUTRAL.
 */
const previousConfirmedDirectional =
  previousReactionConfirmed === true &&
  previousDirectional;

  /*
   * First snapshot after a qualified negotiated-zone direction leaves
   * the zone: seed persistence from the previously confirmed canonical
   * direction. Once seeded, establishedTripDirection carries it forward.
   */
  const persistedDirection =
    lockedTripDirectional
      ? lockedTripDirection
      : previousReactionConfirmed && previousDirectional
      ? previousDirection
      : "NEUTRAL";

  const persistedDirectional =
    persistedDirection === "LONG" ||
    persistedDirection === "SHORT";

  const completedClose = toNum(
    candidateResolution?.tenMinuteCompletedClose
  );

  const ema10 = toNum(
    candidateResolution?.tenMinuteEma10
  );

  const ema10DataAvailable =
    completedClose != null &&
    ema10 != null;

  const reactionConfirmed =
    candidateConfirmation?.reactionConfirmed === true;

  const candidateDirectional =
    candidateDirection === "LONG" ||
    candidateDirection === "SHORT";

  let state =
    candidateResolution?.state ||
    "NO_SIGNAL";

  let direction = "NEUTRAL";
  let sourceTimeframe = null;
  let reactionTimeframe = null;
  let directionPersistenceActive = false;
  let directionEstablishedByFresh1m = false;

  /*
   * Inside-zone lock:
   * the previously confirmed Engine 3 reaction remains authoritative.
   * Current 1m evidence continues to update diagnostics only.
   */
  let insideZoneDirectionLocked = false;

  let ema10ResetTriggered = false;
  let travelModeActive = false;
  const travelModeActivated = false;

  let resolutionStatus =
    "REACTION_NOT_CONFIRMED_DIRECTION_NEUTRAL";

  let resolutionReason =
    "ENGINE3_REACTION_NOT_CONFIRMED";

  /* 1 — Engine 26 completed the prior trip. */
  if (engine26MidpointReset === true) {
    state = "ENGINE26_MIDPOINT_TRIP_RESET";
    direction = "NEUTRAL";
    sourceTimeframe = "ENGINE26_MIDPOINT_RESET";
    reactionTimeframe = null;
    resolutionStatus =
      "ENGINE26_MIDPOINT_COMPLETION_RESET_TO_NEUTRAL";
    resolutionReason =
      "ENGINE26_FULL_TARGET_COMPLETION_START_FRESH_ENGINE3_REACTION";
  }

/*
 * 2 — Negotiated-zone reaction mode.
 *
 * FIRST ESTABLISHMENT:
 * A qualified completed 1m reaction may establish LONG / SHORT
 * while Engine 3 is still NEUTRAL.
 *
 * AFTER ESTABLISHMENT:
 * Once a previous Engine 3 reaction is already confirmed,
 * later 1m candles remain diagnostic only.
 *
 * An opposite 1m candle may NOT flip the established
 * canonical reaction LONG <-> SHORT.
 *
 * Engine 26 midpoint completion above this branch remains
 * the lifecycle reset that starts a fresh reaction cycle.
 */
else if (insideNegotiatedZone === true) {
  /*
   * Existing confirmed reaction owns the remainder
   * of this negotiated-zone reaction cycle.
   */
  if (previousConfirmedDirectional) {
    direction = previousDirection;

    sourceTimeframe =
      "ESTABLISHED_NEGOTIATED_ZONE_REACTION";

    reactionTimeframe = "1m";

    insideZoneDirectionLocked = true;

    directionEstablishedByFresh1m = false;

    resolutionStatus =
      `NEGOTIATED_ZONE_REACTION_${previousDirection}_PERSISTED`;

    resolutionReason =
      "PREVIOUS_CONFIRMED_NEGOTIATED_ZONE_REACTION_CANNOT_BE_REVERSED_BY_1M_ALONE";
  }

  /*
   * No established reaction yet:
   * completed qualified 1m may establish the FIRST direction.
   */
  else if (
    reactionConfirmed &&
    candidateDirectional
  ) {
    /*
     * Completed 1m remains diagnostic reaction evidence only.
     * It may NOT establish or flip canonical Engine 3 direction.
     */
    direction = "NEUTRAL";

    sourceTimeframe =
      "NEGOTIATED_ZONE_REACTION";

    reactionTimeframe = "1m";

    directionEstablishedByFresh1m = false;

    resolutionStatus =
      "NEGOTIATED_ZONE_REACTION_WAITING_FOR_CANONICAL_DIRECTION";

    resolutionReason =
      "COMPLETED_1M_REACTION_DIAGNOSTIC_ONLY_CANNOT_ESTABLISH_CANONICAL_DIRECTION";
  }

  /*
   * Still no qualified reaction.
   */
  else {
    direction = "NEUTRAL";

    sourceTimeframe =
      "NEGOTIATED_ZONE_REACTION";

    reactionTimeframe = "1m";

    resolutionStatus =
      "NEGOTIATED_ZONE_REACTION_WAITING";

    resolutionReason =
      "WAITING_FOR_QUALIFIED_COMPLETED_1M_NEGOTIATED_ZONE_REACTION";
  }
}
  /*
   * 3 — Outside the zone with an already-established direction.
   * Completed 10m close vs EMA10 owns HOLD / RESET only.
   */
  else if (
    negotiatedZonePositionKnown === true &&
    persistedDirectional
  ) {
    travelModeActive = true;

    const resetShort =
      persistedDirection === "SHORT" &&
      ema10DataAvailable &&
      completedClose > ema10;

    const resetLong =
      persistedDirection === "LONG" &&
      ema10DataAvailable &&
      completedClose < ema10;

    ema10ResetTriggered = resetShort || resetLong;

    if (ema10ResetTriggered) {
      state = "ESTABLISHED_TRIP_DIRECTION_RESET";
      direction = "NEUTRAL";
      sourceTimeframe = "10m";
      reactionTimeframe = "10m";
      directionPersistenceActive = false;
      travelModeActive = false;
      resolutionStatus =
        `ESTABLISHED_TRIP_${persistedDirection}_RESET_AT_10M_EMA10`;
      resolutionReason =
        persistedDirection === "SHORT"
          ? "ESTABLISHED_SHORT_RESET_BY_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ESTABLISHED_LONG_RESET_BY_COMPLETED_10M_CLOSE_BELOW_EMA10";
    } else {
      state = "ESTABLISHED_TRIP_DIRECTION_PERSISTED";
      direction = persistedDirection;
      sourceTimeframe = "10m_EMA10_HOLD";
      reactionTimeframe = "10m";
      directionPersistenceActive = true;
      resolutionStatus =
        `ESTABLISHED_TRIP_${persistedDirection}_PERSISTED`;
      resolutionReason =
        persistedDirection === "SHORT"
          ? "ESTABLISHED_SHORT_HELD_UNTIL_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ESTABLISHED_LONG_HELD_UNTIL_COMPLETED_10M_CLOSE_BELOW_EMA10";
    }
  }

  /*
   * 4 — Outside the zone from NEUTRAL.
   * No 1m/5m/10m/EMA10/departure relationship may manufacture direction.
   */
  else if (negotiatedZonePositionKnown === true) {
    state = "WAITING_FOR_NEGOTIATED_ZONE_REACTION";
    direction = "NEUTRAL";
    sourceTimeframe = "NEGOTIATED_ZONE_REACTION_REQUIRED";
    reactionTimeframe = null;
    resolutionStatus = "OUTSIDE_ZONE_NEUTRAL_WAITING_FOR_NEW_REACTION";
    resolutionReason = "EMA10_CANNOT_CREATE_INITIAL_DIRECTION";
  }

  /* 5 — Unknown zone geometry: do not invent a fresh direction. */
  else {
    state = "ZONE_POSITION_UNKNOWN";
    direction = "NEUTRAL";
    sourceTimeframe = null;
    reactionTimeframe = null;
    resolutionStatus = "ZONE_POSITION_UNKNOWN_REACTION_WAITING";
    resolutionReason =
      "NO_NEW_CANONICAL_DIRECTION_WITHOUT_NEGOTIATED_ZONE_POSITION";
  }

  return {
    ...candidateResolution,

    state,
    direction,
    sourceTimeframe,
    reactionTimeframe,
    directionPersistenceActive,
    directionEstablishedByFresh1m,
    insideZoneDirectionLocked,
    ema10ResetTriggered,
    travelModeActive,
    travelModeActivated,

    cleanDepartureDirection:
      cleanTenMinuteDeparture?.active === true
        ? safeUpper(cleanTenMinuteDeparture?.direction, "NEUTRAL")
        : "NEUTRAL",

    /* Diagnostic only. Never canonical authority. */
    cleanTenMinuteDeparture:
      cleanTenMinuteDeparture &&
      typeof cleanTenMinuteDeparture === "object"
        ? {
            ...cleanTenMinuteDeparture,
            canonicalDirectionAuthority: false,
            canonicalQualificationAuthority: false,
          }
        : cleanTenMinuteDeparture,

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

  const insideZoneDirectionLocked =
  canonicalResolution?.insideZoneDirectionLocked === true;

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
    directionPersistenceActive ||
    insideZoneDirectionLocked
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
        insideZoneDirectionLocked
          ? `ENGINE3_${canonicalResolution?.direction}_CONFIRMATION_LOCKED_TO_ESTABLISHED_ZONE_REACTION`
          : directionPersistenceActive
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
} = {}) {
  return safeUpper(
    observation1m?.completedPriceActionQuality,
    "WEAK"
  );
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
  authorizationContext = null,
  previousReactionConfirmed = false,
} = {}) {
  const blockers = [];
  const reasonCodes = [];

  const candidateDirection = safeUpper(
    canonicalResolution?.candidateDirection ??
      canonicalResolution?.direction,
    "NEUTRAL"
  );

  const candidateQuality = safeUpper(
    canonicalResolution?.candidateQuality,
    "WEAK"
  );

  const authorizationValid =
    authorizationContext?.active === true &&
    authorizationContext?.authorized === true &&
    authorizationContext?.authorizeEngine3Evaluation === true;

  const identityMatched =
    authorizationContext
      ?.identityComparison
      ?.matched === true;

  const candidateDirectional =
    candidateDirection === "LONG" ||
    candidateDirection === "SHORT";

  const qualityApproved =
    QUALIFYING_QUALITY.has(candidateQuality);

  if (!authorizationValid) {
    blockers.push("ENGINE26_EVALUATION_NOT_AUTHORIZED");
  }

  if (!identityMatched) {
    blockers.push("ENGINE26_ENGINE3_IDENTITY_MISMATCH");
  }

  if (!candidateDirectional) {
    blockers.push("ENGINE3_COMPLETED_1M_REACTION_NOT_DIRECTIONAL");
  }

  if (!qualityApproved) {
    blockers.push("ENGINE3_COMPLETED_1M_REACTION_NOT_GOOD_OR_STRONG");
  }

  if (authorizationValid) {
    reasonCodes.push("ENGINE26_EVALUATION_AUTHORIZED");
  }

  if (identityMatched) {
    reasonCodes.push("ENGINE26_ENGINE3_IDENTITY_ALIGNED");
  }

  if (candidateDirectional && qualityApproved) {
    reasonCodes.push(
      `ENGINE3_COMPLETED_1M_${candidateDirection}_${candidateQuality}_REACTION`
    );
  }

  const reactionConfirmed =
    blockers.length === 0;

  reasonCodes.push(
    reactionConfirmed
      ? "ENGINE3_COMPLETED_1M_REACTION_CONFIRMED"
      : "ENGINE3_COMPLETED_1M_REACTION_NOT_CONFIRMED"
  );

  return {
    reactionConfirmed,

    previousReactionConfirmed:
      previousReactionConfirmed === true,

    persistedConfirmation: false,

    blockers,
    reasonCodes,

    authorizationValid,
    identityMatched,
    canonicalDirectional: candidateDirectional,

    oneMinuteAligned:
      candidateDirectional &&
      qualityApproved,

    oneMinuteState:
      canonicalResolution?.observedState ||
      "NO_SIGNAL",

    oneMinuteDirection:
      candidateDirection,

    oneMinuteQuality:
      candidateQuality,

    oneMinuteQualityApproved:
      qualityApproved,

    candleCompleted:
      canonicalResolution?.observationUsable === true,

    candleDirectionAligned:
      candidateDirectional,

    oneMinuteContradiction: false,
    approvedReactionState: reactionConfirmed,

    validationPresent: false,
    validationFresh: false,
    validationResolved: false,
    validationSupports: false,
    validationConflicts: false,

    qualityApproved,
    fiveMinuteValidationRequired: false,

    expectedDirection:
      safeUpper(
        authorizationContext?.expectedReactionDirection,
        "NEUTRAL"
      ),

    expectedReactions:
      Array.isArray(authorizationContext?.expectedReactions)
        ? authorizationContext.expectedReactions
        : [],
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

  previousEstablishedTripDirection = null,
  previousEstablishedTripCandidateId = null,

  tenMinutePriorCompletedClose = null,
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

const confirmation10m =
  patchedConfluence
    ?.context
    ?.reaction
    ?.engine3ReactionConfirmation10m ||
  null;

const broaderConfirmation10m = {
  active:
    confirmation10m?.active === true,

  state:
    safeUpper(
      confirmation10m?.currentPriceActionState,
      "NO_CLEAR_DIRECTION"
    ),

  direction:
    safeUpper(
      confirmation10m?.currentPriceActionDirection,
      "NEUTRAL"
    ),

  quality:
    safeUpper(
      confirmation10m?.currentPriceActionQuality,
      "WEAK"
    ),

  role:
    "CURRENT_10M_PRICE_ACTION",

  referenceType:
    confirmation10m?.referenceType ||
    null,

  referenceLabel:
    confirmation10m?.referenceLabel ||
    null,

  referenceLevel:
    toNum(
      confirmation10m?.referenceLevel
    ),

  sourceTimeframe:
    "10m",

  canonicalDirectionAuthority: false,
};
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
    validation5m?.active === true,

  state:
    safeUpper(
      validation5m?.completedPriceActionState,
      "NO_CLEAR_DIRECTION"
    ),

  direction:
    safeUpper(
      validation5m?.completedPriceActionDirection,
      "NEUTRAL"
    ),

  quality:
    safeUpper(
      validation5m?.completedPriceActionQuality,
      "WEAK"
    ),

  role:
    "COMPLETED_5M_PRICE_ACTION",

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
    validation5m?.levelAction ||
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
      observation1m,
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
  const cleanTenMinuteDeparture =
    resolveCleanTenMinuteDeparture({
      priorCompletedClose:
        tenMinutePriorCompletedClose,

      completedClose:
        tenMinuteCompletedClose,

      zoneLo:
        negotiatedZonePosition.lo,

      zoneHi:
        negotiatedZonePosition.hi,
    });

/*
 * Strategy 1 established-trip memory.
 *
 * This is completely separate from the current 1m / 5m / 10m
 * reaction diagnostics.
 */
const priorEstablishedTripDirection =
  ["LONG", "SHORT"].includes(
    safeUpper(
      previousEstablishedTripDirection,
      "NEUTRAL"
    )
  )
    ? safeUpper(
        previousEstablishedTripDirection,
        "NEUTRAL"
      )
    : "NEUTRAL";

const currentCandidateId =
  engine26ReactionHandoff?.candidateId ??
  null;

/*
 * Engine 26 midpoint completion starts a brand-new trip.
 *
 * These fields are real Engine 26 handoff fields in the current
 * backend:
 *   priorRotationCompletionState
 *   priorRotationFullyComplete
 *   promotedFromTargetCompletion
 *
 * Candidate-ID change makes this a one-time reset instead of
 * repeatedly resetting the new trip.
 */
const engine26MidpointReset =
  currentCandidateId != null &&
  previousEstablishedTripCandidateId != null &&
  currentCandidateId !== previousEstablishedTripCandidateId &&
  (
    engine26ReactionHandoff?.priorRotationFullyComplete === true ||
    engine26ReactionHandoff?.promotedFromTargetCompletion === true ||
    safeUpper(
      engine26ReactionHandoff?.priorRotationCompletionState,
      "NONE"
    ) === "FULL_TARGET_COMPLETION"
  );

  /*
   * STEP 2 — score the candidate.
   *
   * Canonical candidate quality comes only from completed 1m price action.
   * Outside the zone, fresh 1m/5m quality is diagnostic and cannot create
   * a new canonical direction.
   */
  const candidateQuality =
    resolveCanonicalQuality({
      observation1m,
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
   * STEP 4 — earn fresh reaction confirmation.
   *
   * Completed qualified 1m + Engine 26 authorization/identity must pass.
   * 5m and 10m remain diagnostic only and cannot create, flip, veto, or
   * delay canonical Strategy 1 direction.
   */
  const candidateConfirmation =
    resolveCanonicalConfirmation({
      canonicalResolution:
        candidateResolution,
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

      establishedTripDirection:
        priorEstablishedTripDirection,

      engine26MidpointReset,

      insideNegotiatedZone,

      negotiatedZonePositionKnown:
        negotiatedZonePosition.known === true,

      cleanTenMinuteDeparture,
    });

  const confirmation =
    resolveFinalConfirmation({
      candidateConfirmation,
      canonicalResolution,
    });

/*
 * Persist the Strategy 1 trip direction inside Engine 3.
 *
 * Reaction diagnostics may continue changing.
 * This direction does not.
 */
const canonicalDirectionNow =
  safeUpper(
    canonicalResolution?.direction,
    "NEUTRAL"
  );

/*
 * Engine 3 post-zone direction memory.
 *
 * Only a direction already established from a qualified negotiated-zone
 * completed-1m reaction may seed this memory. Two completed 10m departure
 * candles are diagnostic only and never seed canonical direction.
 *
 * Re-entering a negotiated zone returns Engine 3 to fresh reaction mode.
 */
const establishedTripDirection =
  engine26MidpointReset === true ||
  insideNegotiatedZone === true ||
  canonicalResolution?.ema10ResetTriggered === true
    ? "NEUTRAL"
    : canonicalResolution?.travelModeActive === true &&
      (
        canonicalDirectionNow === "LONG" ||
        canonicalDirectionNow === "SHORT"
      )
    ? canonicalDirectionNow
    : "NEUTRAL";

const establishedTripCandidateId =
  establishedTripDirection === "LONG" ||
  establishedTripDirection === "SHORT"
    ? previousEstablishedTripCandidateId ??
      currentCandidateId
    : null;

const establishedTripDirectionLocked =
  establishedTripDirection === "LONG" ||
  establishedTripDirection === "SHORT";

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

    insideZoneDirectionLocked:
      canonicalResolution.insideZoneDirectionLocked === true,

    previousCanonicalDirection:
      canonicalResolution.previousCanonicalDirection,

    /*
     * Engine 3 Strategy 1 travel-direction memory.
     *
     * This is the direction protected by completed 10m EMA10.
     * It is separate from live 1m / 5m / 10m reaction diagnostics.
     */
    establishedTripDirection,

    establishedTripCandidateId,

    establishedTripDirectionLocked,

    engine26MidpointReset,

    travelModeActive:
      canonicalResolution.travelModeActive === true,

    travelModeActivated:
      canonicalResolution.travelModeActivated === true,

    engine3Mode:
      canonicalResolution.travelModeActive === true
        ? "TRAVEL_MODE"
        : "REACTION_MODE",

    tenMinutePriorCompletedClose:
      tenMinutePriorCompletedClose,

    cleanDepartureDirection:
      canonicalResolution.cleanDepartureDirection,

    cleanTenMinuteDeparture:
      canonicalResolution.cleanTenMinuteDeparture,

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

        canonicalResolution.insideZoneDirectionLocked
          ? "ENGINE3_ESTABLISHED_ZONE_REACTION_DIRECTION_LOCKED"
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
