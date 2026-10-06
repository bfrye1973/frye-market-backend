// services/core/logic/engine3/v5/state/departureState.js
//
// Engine 3 v5 — Post-zone departure state.
//
// Contract:
// - Consumes an ALREADY-ESTABLISHED canonical direction,
//   exact Engine 26 negotiated zone, completed 10m travel evidence,
//   and prior travel-latch state.
// - Fresh departure confirms only after two consecutive COMPLETED 10m closes
//   outside the same side of the negotiated zone with directional progression.
// - Once departure is confirmed, travel mode is LATCHED for that established
//   direction and is not re-tested on every later 10m candle.
// - Departure must agree with the already-established canonical direction.
// - Departure can NEVER create direction from NEUTRAL.
// - Does not use forming 10m.
// - Does not use 1m or 5m.
// - Does not evaluate EMA10.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// Frozen rule:
// LONG departure:
//   two consecutive completed 10m closes ABOVE zone high
//   AND second close >= first close
//
// SHORT departure:
//   two consecutive completed 10m closes BELOW zone low
//   AND second close <= first close
//
// Once latched:
// - later 10m progression no longer has to re-prove departure
// - EMA10 travel state owns HOLD / RESET
// - lifecycle/candidate reset is handled downstream/upstream separately

const ENGINE = "engine3.v5.state.departureState.v2";
const SOURCE = "engine3.v5.state.departureState";

function normalizeDirection(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  if (text === "LONG") return "LONG";
  if (text === "SHORT") return "SHORT";

  return "NEUTRAL";
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n
    : null;
}

export function resolveDepartureState({
  establishedDirection = "NEUTRAL",
  zone = null,
  tenMinuteContext = null,

  previousTravelModeActive = false,
  previousTravelDirection = "NEUTRAL",
} = {}) {
  const direction =
    normalizeDirection(
      establishedDirection
    );

  const priorTravelDirection =
    normalizeDirection(
      previousTravelDirection
    );

  const low =
    toFiniteNumber(
      zone?.low
    );

  const high =
    toFiniteNumber(
      zone?.high
    );

  const latestCompletedClose =
    toFiniteNumber(
      tenMinuteContext
        ?.travelEvidence
        ?.latestCompletedClose
    );

  const priorCompletedClose =
    toFiniteNumber(
      tenMinuteContext
        ?.travelEvidence
        ?.priorCompletedClose
    );

  const twoAbove =
    tenMinuteContext
      ?.travelEvidence
      ?.twoCompletedClosesAboveZone === true;

  const twoBelow =
    tenMinuteContext
      ?.travelEvidence
      ?.twoCompletedClosesBelowZone === true;

  const validInputs =
    low != null &&
    high != null &&
    latestCompletedClose != null &&
    priorCompletedClose != null;

  const neutralBlocked =
    direction === "NEUTRAL";

  const priorTravelLatchMatches =
    previousTravelModeActive === true &&
    direction !== "NEUTRAL" &&
    priorTravelDirection === direction;

  const longProgressionValid =
    direction === "LONG" &&
    twoAbove === true &&
    latestCompletedClose >=
      priorCompletedClose;

  const shortProgressionValid =
    direction === "SHORT" &&
    twoBelow === true &&
    latestCompletedClose <=
      priorCompletedClose;

  const freshlyConfirmed =
    validInputs === true &&
    neutralBlocked !== true &&
    (
      longProgressionValid ||
      shortProgressionValid
    );

  const departureConfirmed =
    neutralBlocked !== true &&
    (
      priorTravelLatchMatches ||
      freshlyConfirmed
    );

  const departureLatched =
    priorTravelLatchMatches ||
    freshlyConfirmed;

  const departureDirection =
    departureConfirmed
      ? direction
      : "NEUTRAL";

  let status =
    "WAITING_FOR_DEPARTURE";

  if (neutralBlocked) {
    status =
      "NEUTRAL_CANNOT_DEPART";
  } else if (priorTravelLatchMatches) {
    status =
      `${direction}_DEPARTURE_LATCHED`;
  } else if (!validInputs) {
    status =
      "DEPARTURE_INPUT_INCOMPLETE";
  } else if (freshlyConfirmed) {
    status =
      `${direction}_DEPARTURE_CONFIRMED`;
  } else if (
    direction === "LONG" &&
    twoAbove === true
  ) {
    status =
      "LONG_TWO_CLOSES_OUTSIDE_BUT_NO_CONTINUATION";
  } else if (
    direction === "SHORT" &&
    twoBelow === true
  ) {
    status =
      "SHORT_TWO_CLOSES_OUTSIDE_BUT_NO_CONTINUATION";
  } else if (direction === "LONG") {
    status =
      "WAITING_FOR_TWO_COMPLETED_10M_CLOSES_ABOVE_ZONE";
  } else if (direction === "SHORT") {
    status =
      "WAITING_FOR_TWO_COMPLETED_10M_CLOSES_BELOW_ZONE";
  }

  return {
    ok:
      priorTravelLatchMatches ||
      validInputs,

    engine:
      ENGINE,

    source:
      SOURCE,

    status,

    establishedDirection:
      direction,

    departureConfirmed,

    departureDirection,

    departureLatched,

    freshlyConfirmed,

    priorTravelLatchMatches,

    previousTravelModeActive:
      previousTravelModeActive === true,

    previousTravelDirection:
      priorTravelDirection,

    validInputs,

    neutralBlocked,

    progression: {
      latestCompletedClose,
      priorCompletedClose,

      latestVsPrior:
        latestCompletedClose != null &&
        priorCompletedClose != null
          ? latestCompletedClose -
            priorCompletedClose
          : null,

      longProgressionValid,

      shortProgressionValid,
    },

    zone: {
      low,
      high,
      midline:
        toFiniteNumber(
          zone?.midline
        ),
    },

    evidence: {
      twoCompletedClosesAboveZone:
        twoAbove,

      twoCompletedClosesBelowZone:
        twoBelow,

      completedOnly:
        tenMinuteContext
          ?.travelEvidence
          ?.completedOnly === true,
    },

    canonicalDirectionPublisher:
      false,

    canCreateDirectionFromNeutral:
      false,

    ema10Authority:
      false,

    reasonCodes: [
      "ENGINE3_V5_DEPARTURE_STATE_EVALUATED",

      direction === "NEUTRAL"
        ? "ENGINE3_V5_DEPARTURE_NEUTRAL_BLOCKED"
        : `ENGINE3_V5_ESTABLISHED_DIRECTION_${direction}`,

      priorTravelLatchMatches
        ? "ENGINE3_V5_DEPARTURE_LATCH_REUSED"
        : null,

      freshlyConfirmed
        ? "ENGINE3_V5_DEPARTURE_FRESHLY_CONFIRMED"
        : null,

      twoAbove
        ? "ENGINE3_V5_TWO_COMPLETED_10M_CLOSES_ABOVE_ZONE"
        : null,

      twoBelow
        ? "ENGINE3_V5_TWO_COMPLETED_10M_CLOSES_BELOW_ZONE"
        : null,

      longProgressionValid
        ? "ENGINE3_V5_LONG_DEPARTURE_CONTINUATION_VALID"
        : null,

      shortProgressionValid
        ? "ENGINE3_V5_SHORT_DEPARTURE_CONTINUATION_VALID"
        : null,

      departureConfirmed
        ? `ENGINE3_V5_${direction}_DEPARTURE_CONFIRMED_OR_LATCHED`
        : "ENGINE3_V5_DEPARTURE_NOT_CONFIRMED",

      "ENGINE3_V5_COMPLETED_10M_ONLY",
      "ENGINE3_V5_DEPARTURE_LATCHED_UNTIL_TRAVEL_RESET_OR_LIFECYCLE_RESET",
      "ENGINE3_V5_DEPARTURE_CANNOT_CREATE_DIRECTION",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default resolveDepartureState;
