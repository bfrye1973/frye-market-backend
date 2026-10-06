// services/core/logic/engine3/v5/timeframe/build10mContext.js
//
// Engine 3 v5 — 10m broader price-action context.
//
// Contract:
// - Consumes raw 10m bars plus normalized Engine 26 negotiated-zone input.
// - Separates broader 10m price-action context from canonical state authority.
// - 10m price action does NOT create initial canonical direction.
// - 10m price action does NOT flip canonical direction while zone-reaction mode is active.
// - Post-zone travel lifecycle is handled separately by:
//     state/departureState.js
//     state/ema10TravelState.js
// - Does not create permission.
// - Does not create execution.
//
// Frozen timeframe authority:
// 1m = diagnostic only.
// Forming 5m = diagnostic only.
// Completed 5m = primary mature zone-reaction/control evidence.
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
  deriveCandleCompletionTruth,
} from "../../candleCompletionTruth.js";

const ENGINE = "engine3.v5.timeframe.build10mContext.v1";
const SOURCE = "engine3.v5.timeframe.build10mContext";

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
        "10m",

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

function buildContextStack({
  rawBars,
  zone,
  lookback = 5,
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
  };
}

export function build10mContext({
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

  const currentStack =
    buildContextStack({
      rawBars:
        bars,

      zone,

      lookback,
    });

  const completedStack =
    buildContextStack({
      rawBars:
        completion.completedBars,

      zone,

      lookback,
    });

  const completedRelations =
    completedStack
      ?.zoneRelation
      ?.relations ||
    [];

  const lastTwoCompletedRelations =
    completedRelations.slice(-2);

  const twoCompletedClosesAbove =
    lastTwoCompletedRelations.length === 2 &&
    lastTwoCompletedRelations.every(
      (item) =>
        item?.priceRelation?.close ===
        "ABOVE_ZONE"
    );

  const twoCompletedClosesBelow =
    lastTwoCompletedRelations.length === 2 &&
    lastTwoCompletedRelations.every(
      (item) =>
        item?.priceRelation?.close ===
        "BELOW_ZONE"
    );

  const latestCompletedClose =
    completedStack
      ?.normalized
      ?.newestBar
      ?.close ??
    null;

  const priorCompletedClose =
    completedStack
      ?.normalized
      ?.bars
      ?.at(-2)
      ?.close ??
    null;

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
      "10m",

    role:
      "BROADER_PRICE_ACTION_CONTEXT",

    canonicalDirectionPublisher:
      false,

    canCreateInitialCanonicalDirection:
      false,

    canFlipCanonicalDirectionInZoneMode:
      false,

    postZoneTravelLifecycleOwnedElsewhere:
      true,

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

    current: {
      authority:
        "DIAGNOSTIC_ONLY",

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
    },

    completed: {
      authority:
        "BROADER_CONTEXT_ONLY",

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
    },

    /*
     * This handoff is intentionally limited to facts required
     * by the separate post-zone travel state modules.
     *
     * It does NOT create travel mode itself.
     */
    travelEvidence: {
      completedOnly:
        true,

      latestCompletedClose,

      priorCompletedClose,

      twoCompletedClosesAboveZone:
        twoCompletedClosesAbove,

      twoCompletedClosesBelowZone:
        twoCompletedClosesBelow,

      latestCompletedRelation:
        completedStack
          ?.zoneRelation
          ?.latestRelation
          ?.priceRelation
          ?.close ??
        null,

      priorCompletedRelation:
        completedStack
          ?.zoneRelation
          ?.priorRelation
          ?.priceRelation
          ?.close ??
        null,

      departureStatePublisher:
        false,

      ema10TravelStatePublisher:
        false,

      canonicalDirectionPublisher:
        false,
    },

    display: {
      currentReactionState:
        currentStack
          ?.reaction
          ?.reactionState ??
        null,

      currentReactionBias:
        currentStack
          ?.reaction
          ?.reactionBias ??
        null,

      currentFollowThroughState:
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

      completedSequencePhase:
        completedStack
          ?.sequenceMomentum
          ?.phase ??
        null,
    },

    upstreamExpectation:
      normalizedZoneInput
        ?.upstreamExpectation ||
      null,

    reasonCodes: [
      "ENGINE3_V5_10M_CONTEXT_BUILT",
      "ENGINE3_V5_10M_BROADER_CONTEXT_ONLY",
      "ENGINE3_V5_10M_CANNOT_CREATE_INITIAL_CANONICAL_DIRECTION",
      "ENGINE3_V5_10M_CANNOT_FLIP_CANONICAL_DIRECTION_IN_ZONE_MODE",
      "ENGINE3_V5_COMPLETED_10M_TRAVEL_EVIDENCE_EXPOSED",
      twoCompletedClosesAbove
        ? "ENGINE3_V5_TWO_COMPLETED_10M_CLOSES_ABOVE_ZONE_OBSERVED"
        : null,
      twoCompletedClosesBelow
        ? "ENGINE3_V5_TWO_COMPLETED_10M_CLOSES_BELOW_ZONE_OBSERVED"
        : null,
      "ENGINE3_V5_DEPARTURE_STATE_MODULE_REQUIRED",
      "ENGINE3_V5_EMA10_TRAVEL_STATE_MODULE_REQUIRED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default build10mContext;
