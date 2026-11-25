// services/core/logic/engine3/v5/state/ema10TravelState.js
//
// Engine 3 v5 — Completed-10m EMA10 travel hold/reset state.
//
// Contract:
// - Consumes an ALREADY-ESTABLISHED canonical direction,
//   confirmed departure state, latest COMPLETED 10m close, and 10m EMA10.
// - EMA10 may HOLD or RESET an established travel direction.
// - EMA10 can NEVER create initial direction from NEUTRAL.
// - EMA10 can NEVER reverse LONG <-> SHORT.
// - EMA10 reset always returns established direction to NEUTRAL downstream
//   through state/directionStateMachine.js.
// - Forming 10m is ignored.
// - 1m / 5m are ignored.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// Frozen travel rule:
// LONG travel:
//   hold while completed 10m close >= EMA10
//   reset only when completed 10m close < EMA10
//
// SHORT travel:
//   hold while completed 10m close <= EMA10
//   reset only when completed 10m close > EMA10
//
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

const ENGINE = "engine3.v5.state.ema10TravelState.v1";
const SOURCE = "engine3.v5.state.ema10TravelState";

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

function round6(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Number(n.toFixed(6))
    : null;
}

export function resolveEma10TravelState({
  establishedDirection = "NEUTRAL",

  departureState = null,

  tenMinuteContext = null,

  ema10 = null,
} = {}) {
  const direction =
    normalizeDirection(
      establishedDirection
    );

  const departureConfirmed =
    departureState
      ?.departureConfirmed === true;

  const departureDirection =
    normalizeDirection(
      departureState
        ?.departureDirection
    );

  const latestCompletedClose =
    toFiniteNumber(
      tenMinuteContext
        ?.travelEvidence
        ?.latestCompletedClose
    );

  const resolvedEma10 =
    toFiniteNumber(
      ema10
    );

  const validInputs =
    direction !== "NEUTRAL" &&
    departureConfirmed === true &&
    departureDirection === direction &&
    latestCompletedClose != null &&
    resolvedEma10 != null;

  const neutralBlocked =
    direction === "NEUTRAL";

  let travelActive = false;

  let holdEstablishedDirection = false;

  let resetEstablishedDirection = false;

  let status =
    "TRAVEL_NOT_ACTIVE";

  if (neutralBlocked) {
    status =
      "NEUTRAL_CANNOT_ENTER_EMA10_TRAVEL";
  } else if (departureConfirmed !== true) {
    status =
      "WAITING_FOR_CONFIRMED_DEPARTURE";
  } else if (departureDirection !== direction) {
    status =
      "DEPARTURE_DIRECTION_MISMATCH";
  } else if (
    latestCompletedClose == null ||
    resolvedEma10 == null
  ) {
    status =
      "EMA10_TRAVEL_INPUT_INCOMPLETE";
  } else if (direction === "LONG") {
    travelActive = true;

    if (latestCompletedClose < resolvedEma10) {
      resetEstablishedDirection = true;
      status =
        "LONG_TRAVEL_RESET_BELOW_EMA10";
    } else {
      holdEstablishedDirection = true;
      status =
        "LONG_TRAVEL_HOLD_ABOVE_OR_AT_EMA10";
    }
  } else if (direction === "SHORT") {
    travelActive = true;

    if (latestCompletedClose > resolvedEma10) {
      resetEstablishedDirection = true;
      status =
        "SHORT_TRAVEL_RESET_ABOVE_EMA10";
    } else {
      holdEstablishedDirection = true;
      status =
        "SHORT_TRAVEL_HOLD_BELOW_OR_AT_EMA10";
    }
  }

  const distancePoints =
    latestCompletedClose != null &&
    resolvedEma10 != null
      ? round6(
          latestCompletedClose -
          resolvedEma10
        )
      : null;

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

    travelActive,

    holdEstablishedDirection,

    resetEstablishedDirection,

    neutralBlocked,

    completedOnly:
      true,

    latestCompletedClose,

    ema10:
      resolvedEma10,

    distancePoints,

    posture:
      latestCompletedClose != null &&
      resolvedEma10 != null
        ? latestCompletedClose > resolvedEma10
          ? "ABOVE_EMA10"
          : latestCompletedClose < resolvedEma10
          ? "BELOW_EMA10"
          : "AT_EMA10"
        : "UNKNOWN",

    canonicalDirectionPublisher:
      false,

    canCreateDirectionFromNeutral:
      false,

    canReverseDirection:
      false,

    reasonCodes: [
      "ENGINE3_V5_EMA10_TRAVEL_STATE_EVALUATED",

      direction === "NEUTRAL"
        ? "ENGINE3_V5_EMA10_TRAVEL_NEUTRAL_BLOCKED"
        : `ENGINE3_V5_ESTABLISHED_DIRECTION_${direction}`,

      departureConfirmed
        ? "ENGINE3_V5_DEPARTURE_CONFIRMED_FOR_EMA10"
        : "ENGINE3_V5_DEPARTURE_NOT_CONFIRMED_FOR_EMA10",

      departureDirection === direction &&
      direction !== "NEUTRAL"
        ? "ENGINE3_V5_DEPARTURE_DIRECTION_MATCH"
        : null,

      travelActive
        ? "ENGINE3_V5_EMA10_TRAVEL_ACTIVE"
        : "ENGINE3_V5_EMA10_TRAVEL_INACTIVE",

      holdEstablishedDirection
        ? `ENGINE3_V5_${direction}_EMA10_TRAVEL_HOLD`
        : null,

      resetEstablishedDirection
        ? `ENGINE3_V5_${direction}_EMA10_TRAVEL_RESET`
        : null,

      "ENGINE3_V5_COMPLETED_10M_ONLY",
      "ENGINE3_V5_EMA10_CANNOT_CREATE_DIRECTION",
      "ENGINE3_V5_EMA10_CANNOT_REVERSE_DIRECTION",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default resolveEma10TravelState;
