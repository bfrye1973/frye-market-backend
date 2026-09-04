// services/core/logic/engine3/v5/state/directionStateMachine.js
//
// Engine 3 v5 — Canonical direction state machine.
//
// THIS IS THE ONLY ENGINE 3 v5 MODULE ALLOWED TO PUBLISH:
//   LONG
//   SHORT
//   NEUTRAL
//
// Frozen contract:
// - 1m cannot create or flip canonical direction.
// - Forming 5m cannot create or flip canonical direction.
// - COMPLETED 5m control is the primary mature authority while
//   price is working the negotiated zone.
// - Completed 5m may establish LONG/SHORT from NEUTRAL.
// - Completed 5m may reverse LONG <-> SHORT when genuine opposite
//   buyer/seller control is resolved.
// - CONTESTED / ABSORPTION / NO_CONTROL do not manufacture a flip.
// - 10m price action cannot create initial direction.
// - Post-zone departure/travel cannot create direction from NEUTRAL.
// - Departure state and EMA10 travel state manage an ALREADY-ESTABLISHED
//   direction only.
// - EMA10 travel may HOLD or RESET an established direction.
// - Engine 26 directional opinion is never canonical authority.
// - No permission.
// - No execution.
//
// Expected upstream modules:
// timeframe/build5mReaction.js
// state/departureState.js
// state/ema10TravelState.js

const ENGINE = "engine3.v5.state.directionStateMachine.v1";
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

    stateTransition:
      "NO_CHANGE",

    establishedNow:
      false,

    reversedNow:
      false,

    resetNow:
      false,

    heldNow:
      false,

    canonicalSource:
      "PREVIOUS_CANONICAL_STATE",

    reasonCodes: [
      "ENGINE3_V5_DIRECTION_STATE_MACHINE_RAN",
      ...reasonCodes,
      "ENGINE3_V5_SOLE_CANONICAL_DIRECTION_PUBLISHER",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export function runDirectionStateMachine({
  normalizedZoneInput = null,

  completed5mHandoff = null,

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
      completed5mHandoff
        ?.controlState
    );

  const quality =
    normalizeQuality(
      completed5mHandoff
        ?.quality
    );

  const candidateDirection =
    directionFromControl(
      controlState
    );

  const zoneEligible =
    normalizedZoneInput?.eligible === true;

  const completed5mEligible =
    completed5mHandoff?.eligible === true &&
    completed5mHandoff?.completedOnly === true;

  const matureControlResolved =
    completed5mHandoff
      ?.matureControlResolved === true &&
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

        completed5mEligible
          ? "ENGINE3_V5_COMPLETED_5M_HANDOFF_ELIGIBLE"
          : "ENGINE3_V5_COMPLETED_5M_HANDOFF_NOT_ELIGIBLE",

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

      direction:
        "NEUTRAL",

      mode:
        "RESET",

      stateTransition:
        isDirectional(previousDirection)
          ? `${previousDirection}_TO_NEUTRAL`
          : "NEUTRAL_HELD",

      resetNow:
        true,

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
  //    Preserve prior established state unless downstream lifecycle
  //    explicitly tells us to reset.
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
  // It can HOLD or RESET. It cannot create a direction from NEUTRAL.
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

        direction:
          "NEUTRAL",

        mode:
          "TRAVEL",

        stateTransition:
          `${previousDirection}_TO_NEUTRAL`,

        resetNow:
          true,

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

        heldNow:
          true,

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

    /*
     * Departure is confirmed but EMA travel state has not yet resolved.
     * Preserve established direction. Do not let diagnostic 5m/10m
     * create a new travel decision.
     */
    return {
      ...base,

      direction:
        previousDirection,

      mode:
        "TRAVEL_PENDING_EMA10",

      stateTransition:
        "NO_CHANGE",

      heldNow:
        true,

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

      direction:
        "NEUTRAL",

      mode:
        "ZONE_REACTION",

      stateTransition:
        "NEUTRAL_HELD",

      heldNow:
        true,

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
  // 5. Inside-zone / zone-reaction authority:
  //    COMPLETED 5m control only.
  // ------------------------------------------------------------
  if (
    completed5mEligible === true &&
    matureControlResolved === true
  ) {
    // Fresh establishment from NEUTRAL.
    if (previousDirection === "NEUTRAL") {
      return {
        ...base,

        direction:
          candidateDirection,

        mode:
          "ZONE_REACTION",

        stateTransition:
          `NEUTRAL_TO_${candidateDirection}`,

        establishedNow:
          true,

        canonicalSource:
          "COMPLETED_5M_CONTROL",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_COMPLETED_5M_ESTABLISHED_CANONICAL_DIRECTION",
          `ENGINE3_V5_CONTROL_${controlState}`,
          `ENGINE3_V5_CANONICAL_DIRECTION_${candidateDirection}`,
        ],
      };
    }

    // Opposite completed-5m control may reverse established direction.
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
          "ZONE_REACTION",

        stateTransition:
          `${previousDirection}_TO_${candidateDirection}`,

        reversedNow:
          true,

        canonicalSource:
          "COMPLETED_5M_OPPOSITE_CONTROL",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_COMPLETED_5M_REVERSED_CANONICAL_DIRECTION",
          `ENGINE3_V5_CONTROL_${controlState}`,
          `ENGINE3_V5_CANONICAL_DIRECTION_${candidateDirection}`,
        ],
      };
    }

    // Same-side mature control reinforces existing direction.
    if (
      isDirectional(previousDirection) &&
      candidateDirection === previousDirection
    ) {
      return {
        ...base,

        direction:
          previousDirection,

        mode:
          "ZONE_REACTION",

        stateTransition:
          "NO_CHANGE",

        heldNow:
          true,

        canonicalSource:
          "COMPLETED_5M_SAME_SIDE_CONTROL",

        reasonCodes: [
          ...base.reasonCodes,
          "ENGINE3_V5_COMPLETED_5M_REINFORCED_CANONICAL_DIRECTION",
          `ENGINE3_V5_CONTROL_${controlState}`,
          `ENGINE3_V5_CANONICAL_DIRECTION_${previousDirection}`,
        ],
      };
    }
  }

  // ------------------------------------------------------------
  // 6. Mixed / unresolved completed-5m control does not manufacture
  //    a new direction and does not flip an existing one.
  // ------------------------------------------------------------
  if (
    controlState === "CONTESTED" ||
    controlState === "ABSORPTION" ||
    controlState === "NO_CONTROL" ||
    matureControlResolved !== true
  ) {
    return {
      ...base,

      direction:
        previousDirection,

      mode:
        "ZONE_REACTION",

      stateTransition:
        previousDirection === "NEUTRAL"
          ? "NEUTRAL_HELD"
          : "NO_CHANGE",

      heldNow:
        true,

      canonicalSource:
        isDirectional(previousDirection)
          ? "PREVIOUS_DIRECTION_NO_OPPOSITE_COMPLETED_5M_CONTROL"
          : "WAITING_FOR_COMPLETED_5M_CONTROL",

      reasonCodes: [
        ...base.reasonCodes,
        `ENGINE3_V5_CONTROL_${controlState}`,
        isDirectional(previousDirection)
          ? "ENGINE3_V5_PREVIOUS_DIRECTION_PRESERVED_WITHOUT_OPPOSITE_COMPLETED_5M_CONTROL"
          : "ENGINE3_V5_WAITING_FOR_MATURE_COMPLETED_5M_CONTROL",
        `ENGINE3_V5_CANONICAL_DIRECTION_${previousDirection}`,
      ],
    };
  }

  // Defensive fallback.
  return {
    ...base,

    direction:
      previousDirection,

    mode:
      "ZONE_REACTION",

    stateTransition:
      "NO_CHANGE",

    heldNow:
      true,

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
