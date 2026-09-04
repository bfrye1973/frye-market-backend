// services/core/logic/engine3/v5/state/departureState.js
//
// Engine 3 v5 — Post-zone departure state.
//
// Contract:
// - Consumes an ALREADY-ESTABLISHED canonical direction,
//   exact Engine 26 negotiated zone, and completed 10m travel evidence.
// - Confirms departure only after two consecutive COMPLETED 10m closes
//   outside the same side of the negotiated zone.
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
// This module only confirms whether established zone-reaction state
// has transitioned into post-zone travel eligibility.

const ENGINE = "engine3.v5.state.departureState.v1";
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
} = {}) {
  const direction =
    normalizeDirection(
      establishedDirection
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

  const departureConfirmed =
    validInputs === true &&
    neutralBlocked !== true &&
    (
      longProgressionValid ||
      shortProgressionValid
    );

  const departureDirection =
    departureConfirmed
      ? direction
      : "NEUTRAL";

  let status =
    "WAITING_FOR_DEPARTURE";

  if (!validInputs) {
    status =
      "DEPARTURE_INPUT_INCOMPLETE";
  } else if (neutralBlocked) {
    status =
      "NEUTRAL_CANNOT_DEPART";
  } else if (departureConfirmed) {
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
        ? `ENGINE3_V5_${direction}_DEPARTURE_CONFIRMED`
        : "ENGINE3_V5_DEPARTURE_NOT_CONFIRMED",

      "ENGINE3_V5_COMPLETED_10M_ONLY",
      "ENGINE3_V5_DEPARTURE_CANNOT_CREATE_DIRECTION",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default resolveDepartureState;
