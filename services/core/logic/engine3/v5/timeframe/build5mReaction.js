// services/core/logic/engine3/v5/timeframe/build5mReaction.js
//
// Engine 3 v5 — 5m mature negotiated-zone reaction.
//
// Contract:
// - Consumes raw 5m bars plus normalized Engine 26 negotiated-zone input.
// - Separates FORMING 5m diagnostics from COMPLETED 5m authority.
// - Completed 5m is the primary mature reaction/control authority
//   while price is working the Engine 26 negotiated zone.
// - Forming 5m is diagnostic only.
// - Completed 5m may establish or reverse canonical Engine 3 direction,
//   but ONLY downstream through state/directionStateMachine.js.
// - This module itself never publishes canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// Frozen timeframe authority:
// 1m = diagnostic only.
// Forming 5m = diagnostic only.
// Completed 5m = mature zone-reaction/control evidence.
// 10m = broader context until travel lifecycle takes over.
//
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

import {
  normalizePriceBars,
} from "../evidence/normalizePriceBars.js";

import {
  buildCandleFacts,
} from "../evidence/candleFacts.js";

import {
  buildSequenceMomentum,
} from "../evidence/sequenceMomentum.js";

import {
  buildWickBehavior,
} from "../evidence/wickBehavior.js";

import {
  buildZoneRelationStack,
} from "../zone/zoneRelation.js";

import {
  evaluateApproach,
} from "../zone/evaluateApproach.js";

import {
  evaluateContact,
} from "../zone/evaluateContact.js";

import {
  evaluateReaction,
} from "../zone/evaluateReaction.js";

import {
  evaluateFollowThrough,
} from "../zone/evaluateFollowThrough.js";

import {
  resolveBuyerSellerControl,
} from "../control/resolveBuyerSellerControl.js";

import {
  resolveReactionQuality,
} from "../control/resolveReactionQuality.js";

import {
  deriveCandleCompletionTruth,
} from "../../candleCompletionTruth.js";

const ENGINE = "engine3.v5.timeframe.build5mReaction.v1";
const SOURCE = "engine3.v5.timeframe.build5mReaction";

function normalizeCompletionBars(
  rawBars = [],
  evaluationTimeMs = null
) {
  const truth =
    deriveCandleCompletionTruth({
      bars:
        Array.isArray(rawBars)
          ? rawBars
          : [],

      timeframe:
        "5m",

      evaluationTimeMs,
    });

  return {
    truth,

    completedBars:
      Array.isArray(
        truth?.completedBars
      )
        ? truth.completedBars
        : [],

    formingBar:
      truth?.formingBar ||
      null,

    latestBarCompletionState:
      truth?.latestBarCompletionState ||
      "UNKNOWN",
  };
}

function buildReactionStack({
  rawBars,
  zone,
  lookback = 5,
  allowControlResolution = false,
} = {}) {
  const normalized =
    normalizePriceBars(
      rawBars
    );

  const bars =
    normalized?.bars || [];

  const candleFacts =
    buildCandleFacts(
      bars
    );

  const sequenceMomentum =
    buildSequenceMomentum(
      bars,
      {
        lookback,
      }
    );

  const wickBehavior =
    buildWickBehavior(
      bars,
      {
        lookback,
      }
    );

  const zoneRelation =
    buildZoneRelationStack(
      bars,
      zone
    );

  const approach =
    evaluateApproach({
      normalizedBars:
        bars,

      zone,

      sequenceMomentum,

      lookback,
    });

  const contact =
    evaluateContact({
      normalizedBars:
        bars,

      zone,

      zoneRelation,

      wickBehavior,

      lookback:
        Math.max(
          8,
          lookback
        ),
    });

  const reaction =
    evaluateReaction({
      normalizedBars:
        bars,

      zone,

      contact,

      wickBehavior,

      sequenceMomentum,

      lookback,
    });

  const followThrough =
    evaluateFollowThrough({
      normalizedBars:
        bars,

      zone,

      contact,

      reaction,

      lookback:
        Math.max(
          4,
          Math.min(
            lookback,
            6
          )
        ),
    });

  const control =
    allowControlResolution === true
      ? resolveBuyerSellerControl({
          approach,
          contact,
          reaction,
          followThrough,
          sequenceMomentum,
        })
      : {
          ok: false,
          controlState:
            "FORMING_5M_CONTROL_NOT_AUTHORIZED",
          controlConfidence:
            "UNKNOWN",
          canonicalAuthority:
            false,
          reasonCodes: [
            "ENGINE3_V5_FORMING_5M_DIAGNOSTIC_ONLY",
            "ENGINE3_V5_FORMING_5M_CONTROL_NOT_CANONICAL",
          ],
        };

  const quality =
    allowControlResolution === true
      ? resolveReactionQuality({
          approach,
          contact,
          reaction,
          followThrough,
          sequenceMomentum,
          control,
        })
      : {
          ok: false,
          quality:
            "WEAK",
          qualityScore:
            null,
          canonicalAuthority:
            false,
          reasonCodes: [
            "ENGINE3_V5_FORMING_5M_QUALITY_DIAGNOSTIC_ONLY",
          ],
        };

  return {
    normalized,
    candleFacts,
    sequenceMomentum,
    wickBehavior,
    zoneRelation,
    approach,
    contact,
    reaction,
    followThrough,
    control,
    quality,
  };
}

export function build5mReaction({
  bars = [],
  normalizedZoneInput = null,
  evaluationTimeMs = null,
  lookback = 5,
} = {}) {
  const zone =
    normalizedZoneInput?.zone ||
    null;

  const completion =
    normalizeCompletionBars(
      bars,
      evaluationTimeMs
    );

  /*
   * Current/forming stack:
   * useful for dashboard diagnostics only.
   *
   * IMPORTANT:
   * Even if the current bar makes the price action look dramatically
   * different, this stack is never allowed to resolve canonical control.
   */
  const currentStack =
    buildReactionStack({
      rawBars:
        bars,

      zone,

      lookback,

      allowControlResolution:
        false,
    });

  /*
   * Completed stack:
   * primary mature Engine 3 zone-reaction/control evidence.
   *
   * Only completed 5m bars are allowed into this control resolution.
   */
  const completedStack =
    buildReactionStack({
      rawBars:
        completion.completedBars,

      zone,

      lookback,

      allowControlResolution:
        true,
    });

  const completedControlState =
    completedStack
      ?.control
      ?.controlState ||
    "NO_CONTROL";

  const completedControlConfidence =
    completedStack
      ?.control
      ?.controlConfidence ||
    "WEAK";

  const completedQuality =
    completedStack
      ?.quality
      ?.quality ||
    "WEAK";

  const completedQualityScore =
    completedStack
      ?.quality
      ?.qualityScore ??
    null;

  const matureControlResolved =
    [
      "BUYERS_CONTROL",
      "SELLERS_CONTROL",
    ].includes(
      String(
        completedControlState ||
        ""
      ).toUpperCase()
    );

  const mixedControlResolved =
    [
      "CONTESTED",
      "ABSORPTION",
    ].includes(
      String(
        completedControlState ||
        ""
      ).toUpperCase()
    );

  return {
    ok:
      normalizedZoneInput?.eligible === true &&
      (
        currentStack
          ?.normalized
          ?.validBarCount || 0
      ) > 0,

    engine:
      ENGINE,

    source:
      SOURCE,

    timeframe:
      "5m",

    role:
      "PRIMARY_MATURE_ZONE_REACTION_AUTHORITY",

    canonicalDirectionPublisher:
      false,

    /*
     * Important distinction:
     *
     * Completed 5m IS authorized evidence for the canonical state machine,
     * but this builder itself is NOT allowed to publish LONG/SHORT/NEUTRAL.
     */
    completed5mAuthorizedForStateMachine:
      true,

    forming5mAuthorizedForStateMachine:
      false,

    canCreateCanonicalDirectionDirectly:
      false,

    canFlipCanonicalDirectionDirectly:
      false,

    zoneEligibility:
      normalizedZoneInput?.eligible === true,

    identity:
      normalizedZoneInput?.identity ||
      null,

    zone:
      normalizedZoneInput?.zone ||
      null,

    completion: {
      latestBarCompletionState:
        completion.latestBarCompletionState,

      evaluationTimeMs:
        completion.truth
          ?.evaluationTimeMs ??
        evaluationTimeMs ??
        null,

      completedBarCount:
        completion.completedBars.length,

      formingBarPresent:
        completion.formingBar != null,

      formingBar:
        completion.formingBar ||
        null,
    },

    /*
     * FORMING/CURRENT 5m:
     * rich diagnostics, zero canonical control authority.
     */
    current: {
      authority:
        "DIAGNOSTIC_ONLY",

      canonicalAuthority:
        false,

      normalized:
        currentStack.normalized,

      candleFacts:
        currentStack.candleFacts,

      sequenceMomentum:
        currentStack.sequenceMomentum,

      wickBehavior:
        currentStack.wickBehavior,

      zoneRelation:
        currentStack.zoneRelation,

      approach:
        currentStack.approach,

      contact:
        currentStack.contact,

      reaction:
        currentStack.reaction,

      followThrough:
        currentStack.followThrough,

      control:
        currentStack.control,

      quality:
        currentStack.quality,
    },

    /*
     * COMPLETED 5m:
     * mature price-action/control evidence for directionStateMachine.js.
     */
    completed: {
      authority:
        "MATURE_ZONE_REACTION_CONTROL",

      canonicalEvidenceAuthority:
        true,

      normalized:
        completedStack.normalized,

      candleFacts:
        completedStack.candleFacts,

      sequenceMomentum:
        completedStack.sequenceMomentum,

      wickBehavior:
        completedStack.wickBehavior,

      zoneRelation:
        completedStack.zoneRelation,

      approach:
        completedStack.approach,

      contact:
        completedStack.contact,

      reaction:
        completedStack.reaction,

      followThrough:
        completedStack.followThrough,

      control:
        completedStack.control,

      quality:
        completedStack.quality,
    },

    /*
     * State-machine handoff:
     *
     * This is the ONLY 5m object that directionStateMachine.js
     * should consume as mature inside-zone reaction/control evidence.
     *
     * It intentionally contains CONTROL, not canonical direction.
     */
    stateMachineHandoff: {
      eligible:
        normalizedZoneInput?.eligible === true,

      source:
        "COMPLETED_5M_ZONE_REACTION_CONTROL",

      timeframe:
        "5m",

      completedOnly:
        true,

      controlState:
        completedControlState,

      controlConfidence:
        completedControlConfidence,

      quality:
        completedQuality,

      qualityScore:
        completedQualityScore,

      reactionState:
        completedStack
          ?.reaction
          ?.reactionState ??
        null,

      reactionBias:
        completedStack
          ?.reaction
          ?.reactionBias ??
        null,

      followThroughState:
        completedStack
          ?.followThrough
          ?.followThroughState ??
        null,

      followThroughBias:
        completedStack
          ?.followThrough
          ?.followThroughBias ??
        null,

      sequencePhase:
        completedStack
          ?.sequenceMomentum
          ?.phase ??
        null,

      matureControlResolved,

      mixedControlResolved,

      canonicalDirection:
        null,

      canonicalDirectionPublisher:
        false,
    },

    display: {
      formingReactionState:
        currentStack
          ?.reaction
          ?.reactionState ??
        null,

      formingReactionBias:
        currentStack
          ?.reaction
          ?.reactionBias ??
        null,

      formingFollowThroughState:
        currentStack
          ?.followThrough
          ?.followThroughState ??
        null,

      completedReactionState:
        completedStack
          ?.reaction
          ?.reactionState ??
        null,

      completedReactionBias:
        completedStack
          ?.reaction
          ?.reactionBias ??
        null,

      completedFollowThroughState:
        completedStack
          ?.followThrough
          ?.followThroughState ??
        null,

      completedControlState,

      completedControlConfidence,

      completedQuality,

      completedQualityScore,
    },

    upstreamExpectation:
      normalizedZoneInput
        ?.upstreamExpectation ||
      null,

    reasonCodes: [
      "ENGINE3_V5_5M_REACTION_BUILT",
      "ENGINE3_V5_FORMING_5M_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_COMPLETED_5M_PRIMARY_MATURE_REACTION_AUTHORITY",
      "ENGINE3_V5_COMPLETED_5M_CONTROL_AUTHORIZED_FOR_STATE_MACHINE",
      "ENGINE3_V5_5M_BUILDER_CANNOT_PUBLISH_CANONICAL_DIRECTION",
      matureControlResolved
        ? "ENGINE3_V5_COMPLETED_5M_DIRECTIONAL_CONTROL_RESOLVED"
        : null,
      mixedControlResolved
        ? "ENGINE3_V5_COMPLETED_5M_MIXED_CONTROL_RESOLVED"
        : null,
      "ENGINE3_V5_DIRECTION_STATE_MACHINE_REQUIRED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default build5mReaction;
