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
//     5m mature reaction/control
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

  const oneMinuteEvidence =
    build1mEvidence({
      bars:
        bars1m,

      normalizedZoneInput,

      evaluationTimeMs,
    });

  const fiveMinuteReaction =
    build5mReaction({
      bars:
        bars5m,

      normalizedZoneInput,

      evaluationTimeMs,
    });

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
   * Departure is evaluated from the PREVIOUS established canonical
   * direction only.
   *
   * This prevents 10m departure evidence from manufacturing a fresh
   * direction in the same snapshot.
   */
  const departureState =
    resolveDepartureState({
      establishedDirection:
        prior.direction,

      zone:
        normalizedZoneInput?.zone,

      tenMinuteContext,
    });

  const ema10TravelState =
    resolveEma10TravelState({
      establishedDirection:
        prior.direction,

      departureState,

      tenMinuteContext,

      ema10:
        tenMinuteEma10,
    });

  const stateMachine =
    runDirectionStateMachine({
      normalizedZoneInput,

      completed5mHandoff:
        fiveMinuteReaction
          ?.stateMachineHandoff ||
        null,

      previousCanonical:
        prior,

      departureState,

      ema10TravelState,

      forceReset,

      resetReason,
    });

  const canonical =
    buildCanonicalEngine3({
      normalizedZoneInput,

      oneMinuteEvidence,

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

      validation?.valid === true
        ? "ENGINE3_V5_CONTRACT_VALID"
        : "ENGINE3_V5_CONTRACT_INVALID_FAIL_CLOSED",

      "ENGINE3_V5_ENGINE4_AUTHORITY_FALSE",
      "ENGINE3_V5_ENGINE6_AUTHORITY_FALSE",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default buildEngine3V5Shadow;
