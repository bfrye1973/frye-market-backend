// services/core/logic/engine3/v5/buildEngine3V5Shadow.js
//
// Engine 3 v5 — Top-level canonical builder.
//
// LOCKED AUTHORITY CONTRACT
// -------------------------
// Engine 26 -> WHERE / candidate / zone / lifecycle
// Engine 3  -> WHAT PRICE IS DOING THERE
// Engine 4  -> volume / participation
// Engine 6  -> final PAPER permission
//
// TIMEFRAME AUTHORITY
// -------------------
// 1m:
//   DISPLAY / DIAGNOSTIC ONLY
//   ZERO canonical weight
//   cannot create, hold, reverse, confirm, or reset direction
//
// completed 5m:
//   mature in-zone price-action/control evidence
//   may establish fresh BUYERS_CONTROL / SELLERS_CONTROL
//
// completed 10m:
//   cannot manufacture initial direction
//   confirms durable departure only after an already-established direction exists
//
// EMA10:
//   post-departure travel hold/reset only
//
// PRE-TRADE PERSISTENCE RULE
// --------------------------
// Before an actual OPEN PAPER trade exists:
// - completed 5m may establish LONG/SHORT
// - while there is NO confirmed 10m departure, that direction is NOT latched forever
// - if completed 5m no longer resolves the SAME-SIDE control, release prior direction
//   to NEUTRAL and let the SAME snapshot re-evaluate fresh control
// - once 10m departure is confirmed, 10m/EMA10 owns persistence
//
// POST-FILL RULE
// --------------
// Once an actual OPEN PAPER trade exists:
// - lock the trade direction
// - local 5m counter-noise cannot reverse the trade direction
// - Engine 26 FULL_TARGET_COMPLETION may still end the old trip
//
// No permission.
// No execution.

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
  const text =
    String(value || "")
      .trim()
      .toUpperCase();

  if (text === "LONG") return "LONG";
  if (text === "SHORT") return "SHORT";

  return "NEUTRAL";
}

function isDirectional(direction) {
  return (
    direction === "LONG" ||
    direction === "SHORT"
  );
}

function directionFromControl(controlState) {
  const control =
    String(controlState || "")
      .trim()
      .toUpperCase();

  if (control === "BUYERS_CONTROL") {
    return "LONG";
  }

  if (control === "SELLERS_CONTROL") {
    return "SHORT";
  }

  return "NEUTRAL";
}

function controlFromDirection(direction) {
  if (direction === "LONG") {
    return "BUYERS_CONTROL";
  }

  if (direction === "SHORT") {
    return "SELLERS_CONTROL";
  }

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
   * Supplied by buildStrategySnapshot.js.
   * Engine 3 must not query Engine 10 directly.
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
   * 1m = ZERO-WEIGHT DIAGNOSTIC ONLY.
   *
   * It is built for display/inspection, but is NEVER fed to canonical
   * price-action control or persistence decisions.
   */
  const oneMinuteEvidence =
    build1mEvidence({
      bars:
        bars1m,

      normalizedZoneInput,

      evaluationTimeMs,
    });

  /*
   * 5m separates forming diagnostics from COMPLETED mature evidence.
   */
  const fiveMinuteReaction =
    build5mReaction({
      bars:
        bars5m,

      normalizedZoneInput,

      evaluationTimeMs,
    });

  /*
   * Fresh canonical price-action control comes ONLY from the COMPLETED
   * 5m price-action stack.
   *
   * This is not "red 5m candle = SHORT / green 5m candle = LONG".
   * The stack resolves:
   *   approach
   *   contact
   *   reaction
   *   follow-through
   *   sequence
   *   buyer/seller control
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
   * 10m = broader context + durable departure.
   * It cannot create initial direction from NEUTRAL.
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
    priceActionControl
      ?.canonicalControlAuthority === true &&
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
   * Engine 26 FULL_TARGET_COMPLETION ends the old trip.
   */
  const engine26TripReset =
    engine26ReactionHandoff
      ?.priorRotationFullyComplete === true &&
    engine26ReactionHandoff
      ?.priorRotationCompletionState ===
        "FULL_TARGET_COMPLETION" &&
    (
      isDirectional(prior.direction) ||
      prior.travelModeActive === true ||
      tradeDirectionLockActive === true
    );

  /*
   * First establish the prior state that is allowed to participate in
   * departure analysis.
   *
   * OPEN trade lock wins over ordinary local 5m evidence.
   * Engine 26 full completion wins over everything.
   */
  const priorForDeparture =
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
      : prior;

  /*
   * Evaluate whether 10m has made the existing direction durable.
   *
   * IMPORTANT:
   * This can only happen for an already-established direction.
   */
  const preliminaryDepartureState =
    resolveDepartureState({
      establishedDirection:
        priorForDeparture.direction,

      zone:
        normalizedZoneInput?.zone,

      tenMinuteContext,

      previousTravelModeActive:
        priorForDeparture
          .travelModeActive === true,

      previousTravelDirection:
        priorForDeparture
          .travelDirection,
    });

  const tenMinuteDepartureOwnsPersistence =
    isDirectional(
      priorForDeparture.direction
    ) &&
    preliminaryDepartureState
      ?.departureConfirmed === true &&
    normalizeDirection(
      preliminaryDepartureState
        ?.departureDirection
    ) === priorForDeparture.direction;

  /*
   * PRE-TRADE RELEASE
   * -----------------
   *
   * This is the liquidity-raid fix.
   *
   * Before a trade actually opens, and BEFORE 10m confirms durable departure,
   * the prior 5m-established direction must continue to earn same-side mature
   * completed-5m support.
   *
   * If completed 5m becomes:
   *   CONTESTED
   *   ABSORPTION
   *   NO_CONTROL
   *   opposite directional control
   *   otherwise unresolved
   *
   * release the prior direction to NEUTRAL.
   *
   * We intentionally do NOT use forceReset here. Neutralizing previousCanonical
   * lets the SAME snapshot establish a fresh opposite direction if mature
   * completed-5m control has genuinely changed.
   */
  const preTradeDirectionReleased =
    tradeDirectionLockActive !== true &&
    engine26TripReset !== true &&
    tenMinuteDepartureOwnsPersistence !== true &&
    isDirectional(prior.direction) &&
    freshControlSupportsPrior !== true;

  const effectivePrior =
    preTradeDirectionReleased
      ? {
          ...priorForDeparture,
          direction: "NEUTRAL",
          travelModeActive: false,
          travelDirection: "NEUTRAL",
        }
      : priorForDeparture;

  /*
   * Rebuild departure after any pre-trade release so stale direction cannot
   * leak into travel logic.
   */
  const departureState =
    preTradeDirectionReleased
      ? resolveDepartureState({
          establishedDirection:
            "NEUTRAL",

          zone:
            normalizedZoneInput?.zone,

          tenMinuteContext,

          previousTravelModeActive:
            false,

          previousTravelDirection:
            "NEUTRAL",
        })
      : preliminaryDepartureState;

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
   * OPEN TRADE DIRECTION LOCK
   * -------------------------
   *
   * When Engine 10 says a PAPER trade is actually OPEN, local 5m evidence
   * remains visible, but cannot reverse the trade direction.
   *
   * We therefore give the state machine a same-side lock-preserving handoff.
   * The real observed priceActionControl is still published separately.
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

          tradeDirectionLockApplied:
            true,

          tradeDirectionLock:
            normalizedLockedTradeDirection,

          observedControlState:
            priceActionControl
              ?.controlState ??
            "NO_CONTROL",

          observedControlDirection:
            freshControlDirection,

          sourceResolution:
            "OPEN_TRADE_DIRECTION_LOCK",
        }
      : priceActionControl;

  /*
   * Sole canonical LONG / SHORT / NEUTRAL publisher.
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
       * Publish the ACTUAL observed 5m control, not the synthetic
       * open-trade lock handoff.
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

    persistence: {
      priorDirection:
        prior.direction,

      freshControlState:
        priceActionControl
          ?.controlState ??
        "NO_CONTROL",

      freshControlDirection,

      freshControlResolved,

      freshControlSupportsPrior,

      tenMinuteDepartureOwnsPersistence,

      preTradeDirectionReleased,

      effectivePriorDirection:
        effectivePrior.direction,
    },

    tradeLifecycle: {
      openTradeActive:
        openTradeActive === true,

      lockedTradeDirection:
        normalizedLockedTradeDirection,

      tradeDirectionLockActive,

      engine26TripReset,
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

      "ENGINE3_V5_1M_ZERO_WEIGHT_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_FORMING_5M_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_COMPLETED_5M_MATURE_IN_ZONE_CONTROL",
      "ENGINE3_V5_10M_CANNOT_CREATE_INITIAL_DIRECTION",
      "ENGINE3_V5_10M_DEPARTURE_OWNS_PRETRADE_PERSISTENCE_AFTER_CONFIRMATION",
      "ENGINE3_V5_EMA10_POST_DEPARTURE_HOLD_RESET_ONLY",

      freshControlSupportsPrior
        ? "ENGINE3_V5_COMPLETED_5M_REASSERTS_PRIOR_DIRECTION"
        : null,

      tenMinuteDepartureOwnsPersistence
        ? "ENGINE3_V5_10M_DEPARTURE_PERSISTENCE_ACTIVE"
        : null,

      preTradeDirectionReleased
        ? "ENGINE3_V5_PRETRADE_DIRECTION_RELEASED_WITHOUT_5M_SUPPORT"
        : null,

      tradeDirectionLockActive
        ? `ENGINE3_V5_OPEN_TRADE_DIRECTION_LOCK_${normalizedLockedTradeDirection}`
        : "ENGINE3_V5_NO_OPEN_TRADE_DIRECTION_LOCK",

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
