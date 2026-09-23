// services/core/logic/engine3/v5/buildEngine3V5Shadow.js
//
// Engine 3 v5 — Top-level canonical builder.
//
// Contract:
// - Engine 26 owns WHERE / zone / lifecycle.
// - Engine 3 owns WHAT PRICE IS DOING THERE.
// - 1m is diagnostic only.
// - completed 5m price-action evidence resolves fresh buyer/seller control.
// - 10m is broader context.
// - completed 10m + EMA10 manage post-departure travel only.
// - Before an actual OPEN PAPER trade exists, an old canonical LONG/SHORT is
//   reevaluable and must be released when fresh control no longer supports it.
// - After an actual OPEN PAPER trade exists, that trade direction is locked
//   until the trade is no longer open or Engine 26 reports full target completion.
// - No Engine 4 authority.
// - No Engine 6 authority.
// - No permission.
// - No execution.

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

function normalizeDirection(value) {
  const direction =
    String(value || "")
      .trim()
      .toUpperCase();

  if (direction === "LONG") return "LONG";
  if (direction === "SHORT") return "SHORT";

  return "NEUTRAL";
}

function isDirectional(direction) {
  return direction === "LONG" || direction === "SHORT";
}

function directionFromControl(controlState) {
  const control =
    String(controlState || "")
      .trim()
      .toUpperCase();

  if (control === "BUYERS_CONTROL") return "LONG";
  if (control === "SELLERS_CONTROL") return "SHORT";

  return "NEUTRAL";
}

function controlFromDirection(direction) {
  if (direction === "LONG") return "BUYERS_CONTROL";
  if (direction === "SHORT") return "SELLERS_CONTROL";

  return "NO_CONTROL";
}

function normalizePreviousCanonical(
  previousCanonical = null
) {
  const direction =
    normalizeDirection(
      previousCanonical?.direction ||
      previousCanonical
        ?.canonical
        ?.direction
    );

  const travelModeActive =
    previousCanonical?.travelModeActive === true ||
    previousCanonical
      ?.canonical
      ?.travelModeActive === true;

  return {
    direction,

    candidateId:
      previousCanonical?.candidateId ||
      previousCanonical
        ?.currentCandidateId ||
      null,

    travelModeActive,

    travelDirection:
      travelModeActive
        ? normalizeDirection(
            previousCanonical?.travelDirection ||
            previousCanonical
              ?.canonical
              ?.travelDirection ||
            direction
          )
        : "NEUTRAL",
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

  /*
   * Trade lifecycle truth is supplied by buildStrategySnapshot.js.
   *
   * Engine 3 does NOT query Engine 10 directly.
   */
  openTradeActive = false,
  lockedTradeDirection = "NEUTRAL",

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
   * Fresh canonical price-action control is resolved from the COMPLETED 5m
   * price-action stack:
   *
   * approach
   * contact
   * reaction
   * follow-through
   * sequence / momentum
   *
   * The 5m candle itself does not "vote" LONG or SHORT.
   * The completed 5m bars are simply the stable evidence window used by
   * the price-action control resolver.
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

  const normalizedLockedTradeDirection =
    normalizeDirection(
      lockedTradeDirection
    );

  const tradeDirectionLockActive =
    openTradeActive === true &&
    isDirectional(
      normalizedLockedTradeDirection
    );

  const freshControlDirection =
    directionFromControl(
      priceActionControl?.controlState
    );

  const freshControlResolved =
    priceActionControl?.eligible === true &&
    priceActionControl?.canonicalControlAuthority === true &&
    priceActionControl?.controlResolved === true &&
    isDirectional(
      freshControlDirection
    );

  const freshControlSupportsPrior =
    isDirectional(prior.direction) &&
    freshControlResolved === true &&
    freshControlDirection ===
      prior.direction;

  /*
   * Engine 26 owns trip lifecycle.
   *
   * FULL_TARGET_COMPLETION ends the old trip even if candidateId / zoneId
   * remain unchanged.
   */
  const engine26TripReset =
    engine26ReactionHandoff?.priorRotationFullyComplete === true &&
    engine26ReactionHandoff?.priorRotationCompletionState ===
      "FULL_TARGET_COMPLETION" &&
    (
      prior.direction === "LONG" ||
      prior.direction === "SHORT" ||
      prior.travelModeActive === true ||
      tradeDirectionLockActive === true
    );

  /*
   * PRE-TRADE RELEASE RULE
   * ----------------------
   *
   * If there is NO actual OPEN trade, an old canonical direction is not
   * protected just because it was previously persisted.
   *
   * The old direction may remain only while fresh resolved control still
   * supports the same side.
   *
   * If fresh control becomes opposite OR unresolved/mixed, release the old
   * direction back to NEUTRAL before running the state machine.
   *
   * This is NOT an explicit state-machine reset event. We intentionally
   * neutralize the previous input so the same snapshot may immediately
   * establish a fresh opposite direction when current control supports it.
   */
  const preTradeDirectionReleased =
    tradeDirectionLockActive !== true &&
    engine26TripReset !== true &&
    isDirectional(prior.direction) &&
    freshControlSupportsPrior !== true;

  /*
   * TRADE-DIRECTION LOCK RULE
   * -------------------------
   *
   * Once Engine 8 / Engine 10 truth says a PAPER trade is actually OPEN,
   * that trade direction becomes protected.
   *
   * Local opposite price action may remain visible diagnostically, but it
   * cannot reverse the canonical trade direction while the trade is OPEN.
   *
   * Engine 26 FULL_TARGET_COMPLETION still has higher lifecycle authority.
   */
  const effectivePrior =
    engine26TripReset
      ? {
          ...prior,
          direction: "NEUTRAL",
          travelModeActive: false,
          travelDirection: "NEUTRAL",
        }
      : tradeDirectionLockActive
      ? {
          ...prior,
          direction:
            normalizedLockedTradeDirection,
          travelDirection:
            prior.travelModeActive === true
              ? normalizedLockedTradeDirection
              : "NEUTRAL",
        }
      : preTradeDirectionReleased
      ? {
          ...prior,
          direction: "NEUTRAL",
          travelModeActive: false,
          travelDirection: "NEUTRAL",
        }
      : prior;

  /*
   * While a real OPEN trade is protected, the state machine receives a
   * lock-preserving control handoff so it cannot reverse the trade because
   * of local counter-price-action noise.
   *
   * IMPORTANT:
   * The real priceActionControl object above remains unchanged and is still
   * published for diagnostics.
   */
  const stateMachinePriceActionHandoff =
    tradeDirectionLockActive === true &&
    engine26TripReset !== true
      ? {
          ...(priceActionControl || {}),

          eligible: true,
          canonicalControlAuthority: true,
          controlResolved: true,

          controlState:
            controlFromDirection(
              normalizedLockedTradeDirection
            ),

          tradeDirectionLockApplied: true,
          tradeDirectionLock:
            normalizedLockedTradeDirection,

          actualObservedControlState:
            priceActionControl?.controlState ??
            "NO_CONTROL",

          actualObservedControlDirection:
            freshControlDirection,

          sourceResolution:
            "OPEN_TRADE_DIRECTION_LOCK",
        }
      : priceActionControl;

  /*
   * Departure is evaluated from the effective established direction.
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
        stateMachinePriceActionHandoff ||
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

      /*
       * Publish REAL observed price-action control, not the synthetic
       * lock-preserving handoff used internally by the state machine.
       */
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

    /*
     * Explicit diagnostics so we can see WHY a prior direction was held
     * or released on every snapshot.
     */
    tradeLifecycle: {
      openTradeActive:
        openTradeActive === true,

      lockedTradeDirection:
        normalizedLockedTradeDirection,

      tradeDirectionLockActive,

      priorDirection:
        prior.direction,

      freshControlState:
        priceActionControl?.controlState ??
        "NO_CONTROL",

      freshControlDirection,

      freshControlResolved,

      freshControlSupportsPrior,

      preTradeDirectionReleased,

      engine26TripReset,

      effectivePriorDirection:
        effectivePrior.direction,
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

      tradeDirectionLockActive
        ? `ENGINE3_V5_OPEN_TRADE_DIRECTION_LOCK_${normalizedLockedTradeDirection}`
        : "ENGINE3_V5_NO_OPEN_TRADE_DIRECTION_LOCK",

      preTradeDirectionReleased
        ? "ENGINE3_V5_PRETRADE_STALE_DIRECTION_RELEASED"
        : null,

      freshControlSupportsPrior
        ? "ENGINE3_V5_FRESH_CONTROL_SUPPORTS_PRIOR_DIRECTION"
        : null,

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
