// services/core/logic/engine3/v5/buildEngine3V5Shadow.js
//
// Engine 3 v5 — Top-level shadow/read-only builder.
//
// Contract:
// - Single orchestration point for Engine 3 v5.
// - Consumes Engine 26 exact negotiated-zone input plus 1m/5m/10m bars.
// - Builds:
//     normalized Engine 26 zone input
//     1m diagnostics
//     completed 5m canonical price-action/control evidence
//     10m broader context
//     departure state
//     EMA10 travel state
//     canonical state machine
//     canonical published contract
//     trace
//     contract validation
// - Runs in SHADOW_READ_ONLY by default.
// - Does not create Engine 4 authority.
// - Does not create Engine 6 authority.
// - Does not create permission.
// - Does not create execution.
//
// Frozen ownership:
// Engine 26 -> WHERE
// Engine 3 v5 -> WHAT PRICE IS DOING THERE
// Engine 4 -> volume/participation
// Engine 6 -> final paper permission
//
// Timeframe authority:
// 1m -> diagnostic only
// forming 5m -> diagnostic only
// completed 5m -> canonical price-action/control evidence
// 10m -> broader context
// completed 10m + EMA10 -> post-departure hold/reset only

import {
  normalizeNegotiatedZone,
} from "./zone/normalizeNegotiatedZone.js";

import {
  build1mEvidence,
} from "./timeframe/build1mEvidence.js";

import {
  build5mReaction,
} from "./timeframe/build5mReaction.js";

import {
  buildPriceActionControl,
} from "./priceAction/buildPriceActionControl.js";

import {
  build10mContext,
} from "./timeframe/build10mContext.js";

import {
  resolveDepartureState,
} from "./state/departureState.js";

import {
  resolveEma10TravelState,
} from "./state/ema10TravelState.js";

import {
  runDirectionStateMachine,
} from "./state/directionStateMachine.js";

import {
  buildCanonicalEngine3,
} from "./canonical/buildCanonicalEngine3.js";

import {
  buildEngine3Trace,
} from "./diagnostics/buildEngine3Trace.js";

import {
  validateEngine3Contract,
} from "./diagnostics/validateEngine3Contract.js";

const ENGINE = "engine3.v5.shadow.v1";
const SOURCE = "engine3.v5.buildEngine3V5Shadow";

function normalizePreviousCanonical(
  previousCanonical = null
) {
  return {
    direction:
      previousCanonical?.direction ||
      previousCanonical
        ?.canonical
        ?.direction ||
      "NEUTRAL",

    candidateId:
      previousCanonical?.candidateId ||
      previousCanonical
        ?.currentCandidateId ||
      null,

    travelModeActive:
      previousCanonical?.travelModeActive === true ||
      previousCanonical
        ?.canonical
        ?.travelModeActive === true,

    travelDirection:
      previousCanonical?.travelDirection ||
      previousCanonical
        ?.canonical
        ?.travelDirection ||
      "NEUTRAL",
  };
}

export function buildEngine3V5Shadow({
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,

  bars1m = [],
  bars5m = [],
  bars10m = [],

  evaluationTimeMs = null,

  tenMinuteEma10 = null,

  previousCanonical = null,

  forceReset = false,
  resetReason = null,

  shadowMode = true,
} = {}) {
  const normalizedZoneInput =
    normalizeNegotiatedZone({
      engine26LocationCandidate,
      engine26ReactionHandoff,
    });

  /*
   * 1m remains immediate diagnostic evidence only.
   * It is NEVER fed into canonical price-action control.
   */
  const oneMinuteEvidence =
    build1mEvidence({
      bars:
        bars1m,

      normalizedZoneInput,

      evaluationTimeMs,
    });

  /*
   * 5m separates forming/current diagnostics from completed mature evidence.
   */
  const fiveMinuteReaction =
    build5mReaction({
      bars:
        bars5m,

      normalizedZoneInput,

      evaluationTimeMs,
    });

  /*
   * CANONICAL PRICE-ACTION CONTROL
   *
   * IMPORTANT:
   * Canonical control is built ONLY from the COMPLETED 5m evidence stack.
   *
   * This prevents a forming 1m candle from establishing, flipping, or
   * withdrawing canonical Engine 3 direction.
   *
   * The state machine remains the sole LONG / SHORT / NEUTRAL publisher.
   */
  const priceActionControl =
    buildPriceActionControl({
      normalizedZoneInput,

      priceActionEvidence:
        fiveMinuteReaction?.completed ||
        null,

      sourceResolution:
        "COMPLETED_5M_PRICE_PATH",
    });

  /*
   * 10m is broader context only until a direction has already been
   * established and the post-zone travel lifecycle becomes active.
   */
  const tenMinuteContext =
    build10mContext({
      bars:
        bars10m,

      normalizedZoneInput,

      evaluationTimeMs,
    });

  const prior =
    normalizePreviousCanonical(
      previousCanonical
    );

  /*
   * Engine 26 owns trip lifecycle.
   *
   * FULL_TARGET_COMPLETION means the prior Engine 3 trip is finished,
   * even when candidateId / zoneId remain unchanged.
   */
  const engine26TripReset =
    engine26ReactionHandoff?.priorRotationFullyComplete === true &&
    engine26ReactionHandoff?.priorRotationCompletionState ===
      "FULL_TARGET_COMPLETION" &&
    (
      prior.direction === "LONG" ||
      prior.direction === "SHORT" ||
      prior.travelModeActive === true
    );

  /*
   * Reset must happen BEFORE departure / EMA10 travel evaluation.
   * The completed trip must not leak into the next cycle.
   */
  const effectivePrior =
    engine26TripReset
      ? {
          ...prior,
          direction: "NEUTRAL",
          travelModeActive: false,
          travelDirection: "NEUTRAL",
        }
      : prior;

  /*
   * Departure is evaluated from an already-established canonical direction.
   * It cannot manufacture initial direction from NEUTRAL.
   */
  const departureState =
    resolveDepartureState({
      establishedDirection:
        effectivePrior.direction,

      zone:
        normalizedZoneInput?.zone,

      tenMinuteContext,

      previousTravelModeActive:
        effectivePrior.travelModeActive === true,

      previousTravelDirection:
        effectivePrior.travelDirection,
    });

  /*
   * EMA10 travel state manages only an already-established trip.
   * EMA10 never creates initial Engine 3 direction.
   */
  const ema10TravelState =
    resolveEma10TravelState({
      establishedDirection:
        effectivePrior.direction,

      departureState,

      tenMinuteContext,

      ema10:
        tenMinuteEma10,
    });

  /*
   * Sole canonical direction authority.
   */
  const stateMachine =
    runDirectionStateMachine({
      normalizedZoneInput,

      priceActionHandoff:
        priceActionControl ||
        null,

      previousCanonical:
        effectivePrior,

      departureState,

      ema10TravelState,

      forceReset:
        forceReset === true ||
        engine26TripReset,

      resetReason:
        engine26TripReset
          ? "ENGINE26_FULL_TARGET_COMPLETION"
          : resetReason,
    });

  const canonical =
    buildCanonicalEngine3({
      normalizedZoneInput,

      oneMinuteEvidence,

      priceActionControl,

      fiveMinuteReaction,

      tenMinuteContext,

      departureState,

      ema10TravelState,

      stateMachine,

      shadowMode,
    });

  const trace =
    buildEngine3Trace({
      normalizedZoneInput,

      oneMinuteEvidence,

      priceActionControl,

      fiveMinuteReaction,

      tenMinuteContext,

      departureState,

      ema10TravelState,

      stateMachine,

      canonical,
    });

  const validation =
    validateEngine3Contract({
      normalizedZoneInput,

      oneMinuteEvidence,

      priceActionControl,

      fiveMinuteReaction,

      tenMinuteContext,

      departureState,

      ema10TravelState,

      stateMachine,

      canonical,

      shadowMode,
    });

  const failClosed =
    validation?.valid !== true;

  return {
    ok:
      validation?.valid === true,

    engine:
      ENGINE,

    source:
      SOURCE,

    version:
      "engine3.v5",

    mode:
      shadowMode === true
        ? "SHADOW_READ_ONLY"
        : "CANONICAL_ACTIVE",

    shadowMode:
      shadowMode === true,

    failClosed,

    normalizedZoneInput,

    evidence: {
      oneMinute:
        oneMinuteEvidence,

      priceAction:
        priceActionControl,

      fiveMinute:
        fiveMinuteReaction,

      tenMinute:
        tenMinuteContext,
    },

    travel: {
      departureState,
      ema10TravelState,
    },

    stateMachine,

    canonical:
      failClosed
        ? {
            ...canonical,

            authoritativeDownstream:
              false,

            contractInvalid:
              true,
          }
        : canonical,

    trace,

    validation,

    safety: {
      engine4Authority:
        false,

      engine6Authority:
        false,

      noPermissionCreated:
        true,

      noExecution:
        true,

      noSizing:
        true,

      noTicket:
        true,

      noOrder:
        true,
    },

    reasonCodes: [
      "ENGINE3_V5_SHADOW_BUILT",

      shadowMode === true
        ? "ENGINE3_V5_SHADOW_READ_ONLY"
        : "ENGINE3_V5_CANONICAL_ACTIVE",

      "ENGINE3_V5_1M_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_FORMING_5M_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_COMPLETED_5M_CANONICAL_PRICE_ACTION_EVIDENCE",
      "ENGINE3_V5_10M_BROADER_CONTEXT_ONLY",
      "ENGINE3_V5_EMA10_POST_DEPARTURE_HOLD_RESET_ONLY",

      engine26TripReset
        ? "ENGINE3_V5_ENGINE26_FULL_TARGET_COMPLETION_RESET_CONSUMED"
        : null,

      validation?.valid === true
        ? "ENGINE3_V5_CONTRACT_VALID"
        : "ENGINE3_V5_CONTRACT_INVALID_FAIL_CLOSED",

      "ENGINE3_V5_ENGINE4_AUTHORITY_FALSE",
      "ENGINE3_V5_ENGINE6_AUTHORITY_FALSE",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default buildEngine3V5Shadow;
