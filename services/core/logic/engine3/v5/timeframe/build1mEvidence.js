// services/core/logic/engine3/v5/timeframe/build1mEvidence.js
//
// Engine 3 v5 — 1m immediate diagnostic evidence.
//
// Contract:
// - Consumes raw 1m bars plus normalized Engine 26 negotiated-zone input.
// - Builds immediate price-action diagnostics only.
// - 1m NEVER creates canonical direction.
// - 1m NEVER flips canonical direction.
// - 1m NEVER resolves buyer/seller control for canonical use.
// - 1m NEVER creates confirmation.
// - 1m NEVER creates permission.
// - 1m NEVER creates execution.
//
// Frozen timeframe authority:
// 1m = immediate observation only.
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

const ENGINE = "engine3.v5.timeframe.build1mEvidence.v1";
const SOURCE = "engine3.v5.timeframe.build1mEvidence";

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
        "1m",

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

function buildDiagnosticStack({
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
          6,
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

export function build1mEvidence({
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

  const completedStack =
    buildDiagnosticStack({
      rawBars:
        completion.completedBars,

      zone,

      lookback,
    });

  const currentStack =
    buildDiagnosticStack({
      rawBars:
        bars,

      zone,

      lookback,
    });

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
      "1m",

    role:
      "IMMEDIATE_DIAGNOSTIC_ONLY",

    canonicalAuthority:
      false,

    canCreateCanonicalDirection:
      false,

    canFlipCanonicalDirection:
      false,

    canResolveCanonicalControl:
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
    },

    current: {
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
     * Convenience display summary only.
     *
     * These fields make dashboard/debug output easier to inspect,
     * but still have ZERO canonical authority.
     */
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

      currentSequencePhase:
        currentStack
          ?.sequenceMomentum
          ?.phase ??
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
      "ENGINE3_V5_1M_EVIDENCE_BUILT",
      "ENGINE3_V5_1M_IMMEDIATE_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_1M_CANNOT_CREATE_CANONICAL_DIRECTION",
      "ENGINE3_V5_1M_CANNOT_FLIP_CANONICAL_DIRECTION",
      "ENGINE3_V5_1M_CANNOT_RESOLVE_CANONICAL_CONTROL",
      "ENGINE3_V5_COMPLETED_AND_CURRENT_1M_SEPARATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default build1mEvidence;
