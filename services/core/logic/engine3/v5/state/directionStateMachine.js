// services/core/logic/engine3/v5/state/directionStateMachine.js
//
// Engine 3 v5 — Canonical direction state machine.
//
// THIS IS THE ONLY ENGINE 3 v5 MODULE ALLOWED TO PUBLISH:
//   LONG
//   SHORT
//   NEUTRAL
//
// Locked price-action contract:
// - Engine 26 owns WHERE: exact negotiated zone + candidate/lifecycle authorization.
// - Engine 3 owns WHAT PRICE IS DOING THERE.
// - Initial canonical direction comes from resolved PRICE-ACTION CONTROL,
//   not from a 1m/5m/10m timeframe label.
// - BUYERS_CONTROL may establish/reinforce/reverse to LONG.
// - SELLERS_CONTROL may establish/reinforce/reverse to SHORT.
// - CONTESTED / ABSORPTION / NO_CONTROL do not manufacture a direction.
// - 1m/5m/10m remain evidence/diagnostic views only for initial direction.
// - Post-zone departure/travel cannot create direction from NEUTRAL.
// - Departure + EMA10 travel manage an ALREADY-ESTABLISHED direction only.
// - EMA10 travel may HOLD or RESET an established direction.
// - Engine 26 directional opinion is never canonical authority.
// - No permission.
// - No execution.
//
// Expected upstream modules:
// priceAction/buildPriceActionControl.js
// state/departureState.js
// state/ema10TravelState.js

const ENGINE = "engine3.v5.state.directionStateMachine.v2";
const SOURCE = "engine3.v5.state.directionStateMachine";

const CANONICAL_DIRECTIONS = new Set([
  "LONG",
  "SHORT",
  "NEUTRAL",
]);

function normalizeDirection(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  return CANONICAL_DIRECTIONS.has(text)
    ? text
    : "NEUTRAL";
}

function normalizeControl(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  return [
    "BUYERS_CONTROL",
    "SELLERS_CONTROL",
    "CONTESTED",
    "ABSORPTION",
    "NO_CONTROL",
  ].includes(text)
    ? text
    : "NO_CONTROL";
}

function normalizeQuality(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  return [
    "STRONG",
    "GOOD",
    "MIXED",
    "WEAK",
  ].includes(text)
    ? text
    : "WEAK";
}

function directionFromControl(controlState) {
  if (controlState === "BUYERS_CONTROL") {
    return "LONG";
  }

  if (controlState === "SELLERS_CONTROL") {
    return "SHORT";
  }

  return "NEUTRAL";
}

function isDirectional(direction) {
  return direction === "LONG" || direction === "SHORT";
}

function oppositeDirection(direction) {
  if (direction === "LONG") return "SHORT";
  if (direction === "SHORT") return "LONG";
  return "NEUTRAL";
}

function buildBaseResult({
  previousDirection,
  previousCandidateId,
  currentCandidateId,
  controlState,
  quality,
  reasonCodes,
} = {}) {
  return {
    ok: true,

    engine: ENGINE,
    source: SOURCE,

    canonicalAuthority: true,
    soleCanonicalDirectionPublisher: true,

    previousDirection,
    direction: previousDirection,

    previousCandidateId:
      previousCandidateId || null,

    currentCandidateId:
      currentCandidateId || null,

    controlState,
    quality,

    mode: "ZONE_REACTION",

    stateTransition: "NO_CHANGE",

    establishedNow: false,
    reversedNow: false,
    resetNow: false,
    heldNow: false,

    canonicalSource:
      "PREVIOUS_CANONICAL_STATE",

    reasonCodes: [
      "ENGINE3_V5_DIRECTION_STATE_MACHINE_RAN",
      ...reasonCodes,
      "ENGINE3_V5_PRICE_ACTION_CONTROL_OWNS_INITIAL_DIRECTION_EVIDENCE",
      "ENGINE3_V5_TIMEFRAME_LABELS_HAVE_NO_INITIAL_DIRECTION_AUTHORITY",
      "ENGINE3_V5_SOLE_CANONICAL_DIRECTION_PUBLISHER",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export function runDirectionStateMachine({
  normalizedZoneInput = null,

  priceActionHandoff = null,

  previousCanonical = null,

  departureState = null,

  ema10TravelState = null,

  forceReset = false,

  resetReason = null,
} = {}) {
  const currentCandidateId =
    normalizedZoneInput
      ?.identity
      ?.candidateId ||
    null;

  const previousDirection =
    normalizeDirection(
      previousCanonical?.direction
    );

  const previousCandidateId =
    previousCanonical?.candidateId ||
    previousCanonical?.currentCandidateId ||
    null;

  const controlState =
    normalizeControl(
      priceActionHandoff
        ?.controlState
    );

  const quality =
    normalizeQuality(
      priceActionHandoff
        ?.quality
    );

  const candidateDirection =
    directionFromControl(
      controlState
    );

  const zoneEligible =
    normalizedZoneInput?.eligible === true;

  const priceActionEligible =
    priceActionHandoff?.eligible === true &&
    priceActionHandoff?.canonicalControlAuthority === true;

  const directionalControlResolved =
    priceActionEligible === true &&
    priceActionHandoff?.controlResolved === true &&
    isDirectional(candidateDirection);

  const candidateIdentityChanged =
    previousCandidateId != null &&
    currentCandidateId != null &&
    String(previousCandidateId) !==
      String(currentCandidateId);

  const departureConfirmed =
    departureState
      ?.departureConfirmed === true;

  const departureDirection =
    normalizeDirection(
      departureState
        ?.departureDirection
    );

  const travelActive =
    ema10TravelState
      ?.travelActive === true;

  const travelHold =
    ema10TravelState
      ?.holdEstablishedDirection === true;

  const travelReset =
    ema10TravelState
      ?.resetEstablishedDirection === true;

  const travelDirection =
    normalizeDirection(
      ema10TravelState
        ?.establishedDirection
    );

  const base =
    buildBaseResult({
      previousDirection,
      previousCandidateId,
      currentCandidateId,
      controlState,
      quality,
      reasonCodes: [
        zoneEligible
          ? "ENGINE3_V5_ZONE_INPUT_ELIGIBLE"
          : "ENGINE3_V5_ZONE_INPUT_NOT_ELIGIBLE",

        priceActionEligible
          ? "ENGINE3_V5_PRICE_ACTION_HANDOFF_ELIGIBLE"
          : "ENGINE3_V5_PRICE_ACTION_HANDOFF_NOT_ELIGIBLE",

        directionalControlResolved
          ? "ENGINE3_V5_DIRECTIONAL_PRICE_ACTION_CONTROL_RESOLVED"
          : "ENGINE3_V5_DIRECTIONAL_PRICE_ACTION_CONTROL_NOT_RESOLVED",

        candidateIdentityChanged
          ? "ENGINE3_V5_CANDIDATE_IDENTITY_CHANGED"
          : null,
      ],
    });

  // ------------------------------------------------------------
  // 1. Explicit lifecycle reset has highest authority.
  // ------------------------------------------------------------
  if (forceReset === true) {
    return {
      ...base,

      direction: "NEUTRAL",
      mode: "RESET",

      stateTransition:
        isDirectional(previousDirection)
          ? `${previousDirection}_TO_NEUTRAL`
          : "NEUTRAL_HELD",

      resetNow: true,
      heldNow:
        previousDirection === "NEUTRAL",

      canonicalSource:
        "EXPLICIT_LIFECYCLE_RESET",

      reasonCodes: [
        ...base.reasonCodes,
        "ENGINE3_V5_EXPLICIT_LIFECYCLE_RESET",
        resetReason
          ? `ENGINE3_V5_RESET_${String(resetReason).toUpperCase()}`
          : null,
        "ENGINE3_V5_CANONICAL_DIRECTION_NEUTRAL",
      ].filter(Boolean),
    };
  }

  // ------------------------------------------------------------
  // 2. Invalid / unauthorized current zone cannot create direction.
  //    Preserve prior established state unless lifecycle resets it.
  // ------------------------------------------------------------
  if (zoneEligible !== true) {
    return {
      ...base,

      direction:
        previousDirection,

      mode:
        "ZONE_NOT_ELIGIBLE",

      stateTransition:
        "NO_CHANGE",

      heldNow:
        isDirectional(previousDirection),

      canonicalSource:
        isDirectional(previousDirection)
          ? "PREVIOUS_CANONICAL_STATE"
          : "NO_AUTHORIZED_ZONE_REACTION",

      reasonCodes: [
        ...base.reasonCodes,
        "ENGINE3_V5_NO_NEW_DIRECTION_FROM_INELIGIBLE_ZONE",
        isDirectional(previousDirection)
          ? "ENGINE3_V5_PREVIOUS_DIRECTION_PRESERVED_PENDING_LIFECYCLE"
          : "ENGINE3_V5_CANONICAL_DIRECTION_NEUTRAL",
      ],
    };
  }

  // ------------------------------------------------------------
  // 3. Post-zone travel lifecycle.
  //
  // Travel is allowed ONLY for an already-established direction.
  // It can HOLD or RESET. It cannot create direction from NEUTRAL.
  // ------------------------------------------------------------
  if (
    isDirectional(previousDirection) &&
    departureConfirmed === true &&
    departureDirection === previousDirection
  ) {
    if (
      travelActive === true &&
      travelReset === true
    ) {
      return {
        ...base,

        direction: "NEUTRAL",
        mode: "TRAVEL",

        stateTransition:
          `${previousDirection}_TO_NEUTRAL`,

        resetNow: true,

        canonicalSource:
          "EMA10_TRAVEL_RESET",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_DEPARTURE_CONFIRMED",
          `ENGINE3_V5_DEPARTURE_${previousDirection}`,
          "ENGINE3_V5_EMA10_TRAVEL_RESET",
          "ENGINE3_V5_CANONICAL_DIRECTION_NEUTRAL",
        ],
      };
    }

    if (
      travelActive === true &&
      travelHold === true &&
      travelDirection === previousDirection
    ) {
      return {
        ...base,

        direction:
          previousDirection,

        mode:
          "TRAVEL",

        stateTransition:
          "NO_CHANGE",

        heldNow: true,

        canonicalSource:
          "EMA10_TRAVEL_HOLD",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_DEPARTURE_CONFIRMED",
          `ENGINE3_V5_DEPARTURE_${previousDirection}`,
          "ENGINE3_V5_EMA10_TRAVEL_HOLD",
          `ENGINE3_V5_CANONICAL_DIRECTION_${previousDirection}`,
        ],
      };
    }

    return {
      ...base,

      direction:
        previousDirection,

      mode:
        "TRAVEL_PENDING_EMA10",

      stateTransition:
        "NO_CHANGE",

      heldNow: true,

      canonicalSource:
        "ESTABLISHED_DIRECTION_PENDING_EMA10",

      reasonCodes: [
        ...base.reasonCodes,
        "ENGINE3_V5_DEPARTURE_CONFIRMED",
        "ENGINE3_V5_WAITING_FOR_EMA10_TRAVEL_STATE",
        `ENGINE3_V5_CANONICAL_DIRECTION_${previousDirection}`,
      ],
    };
  }

  // ------------------------------------------------------------
  // 4. Departure evidence can NEVER create initial direction.
  // ------------------------------------------------------------
  if (
    previousDirection === "NEUTRAL" &&
    departureConfirmed === true
  ) {
    return {
      ...base,

      direction: "NEUTRAL",
      mode: "ZONE_REACTION",

      stateTransition:
        "NEUTRAL_HELD",

      heldNow: true,

      canonicalSource:
        "NO_ESTABLISHED_DIRECTION_FOR_TRAVEL",

      reasonCodes: [
        ...base.reasonCodes,
        "ENGINE3_V5_DEPARTURE_CANNOT_CREATE_DIRECTION_FROM_NEUTRAL",
        "ENGINE3_V5_CANONICAL_DIRECTION_NEUTRAL",
      ],
    };
  }

  // ------------------------------------------------------------
  // 5. Core price-action authority.
  //
  // No timeframe label is consulted here. The state machine consumes
  // only resolved buyer/seller CONTROL from the price-action pipeline.
  // ------------------------------------------------------------
  if (
    priceActionEligible === true &&
    directionalControlResolved === true
  ) {
    if (previousDirection === "NEUTRAL") {
      return {
        ...base,

        direction:
          candidateDirection,

        mode:
          "PRICE_ACTION_CONTROL",

        stateTransition:
          `NEUTRAL_TO_${candidateDirection}`,

        establishedNow: true,

        canonicalSource:
          "PRICE_ACTION_CONTROL",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_PRICE_ACTION_CONTROL_ESTABLISHED_CANONICAL_DIRECTION",
          `ENGINE3_V5_CONTROL_${controlState}`,
          `ENGINE3_V5_CANONICAL_DIRECTION_${candidateDirection}`,
        ],
      };
    }

    if (
      isDirectional(previousDirection) &&
      candidateDirection ===
        oppositeDirection(previousDirection)
    ) {
      return {
        ...base,

        direction:
          candidateDirection,

        mode:
          "PRICE_ACTION_CONTROL",

        stateTransition:
          `${previousDirection}_TO_${candidateDirection}`,

        reversedNow: true,

        canonicalSource:
          "OPPOSITE_PRICE_ACTION_CONTROL",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_PRICE_ACTION_CONTROL_REVERSED_CANONICAL_DIRECTION",
          `ENGINE3_V5_CONTROL_${controlState}`,
          `ENGINE3_V5_CANONICAL_DIRECTION_${candidateDirection}`,
        ],
      };
    }

    if (
      isDirectional(previousDirection) &&
      candidateDirection === previousDirection
    ) {
      return {
        ...base,

        direction:
          previousDirection,

        mode:
          "PRICE_ACTION_CONTROL",

        stateTransition:
          "NO_CHANGE",

        heldNow: true,

        canonicalSource:
          "SAME_SIDE_PRICE_ACTION_CONTROL",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_PRICE_ACTION_CONTROL_REINFORCED_CANONICAL_DIRECTION",
          `ENGINE3_V5_CONTROL_${controlState}`,
          `ENGINE3_V5_CANONICAL_DIRECTION_${previousDirection}`,
        ],
      };
    }
  }

  // ------------------------------------------------------------
  // 6. Mixed / unresolved price-action control does not manufacture
  //    a new direction and does not flip an existing one.
  // ------------------------------------------------------------
  if (
    controlState === "CONTESTED" ||
    controlState === "ABSORPTION" ||
    controlState === "NO_CONTROL" ||
    directionalControlResolved !== true
  ) {
    return {
      ...base,

      direction:
        previousDirection,

      mode:
        "PRICE_ACTION_CONTROL",

      stateTransition:
        previousDirection === "NEUTRAL"
          ? "NEUTRAL_HELD"
          : "NO_CHANGE",

      heldNow: true,

      canonicalSource:
        isDirectional(previousDirection)
          ? "PREVIOUS_DIRECTION_NO_OPPOSITE_PRICE_ACTION_CONTROL"
          : "WAITING_FOR_PRICE_ACTION_CONTROL",

      reasonCodes: [
        ...base.reasonCodes,
        `ENGINE3_V5_CONTROL_${controlState}`,
        isDirectional(previousDirection)
          ? "ENGINE3_V5_PREVIOUS_DIRECTION_PRESERVED_WITHOUT_OPPOSITE_PRICE_ACTION_CONTROL"
          : "ENGINE3_V5_WAITING_FOR_RESOLVED_PRICE_ACTION_CONTROL",
        `ENGINE3_V5_CANONICAL_DIRECTION_${previousDirection}`,
      ],
    };
  }

  return {
    ...base,

    direction:
      previousDirection,

    mode:
      "PRICE_ACTION_CONTROL",

    stateTransition:
      "NO_CHANGE",

    heldNow: true,

    canonicalSource:
      "DEFENSIVE_STATE_PRESERVATION",

    reasonCodes: [
      ...base.reasonCodes,
      "ENGINE3_V5_DEFENSIVE_STATE_PRESERVATION",
      `ENGINE3_V5_CANONICAL_DIRECTION_${previousDirection}`,
    ],
  };
}

export default runDirectionStateMachine;
