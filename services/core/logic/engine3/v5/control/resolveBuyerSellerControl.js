// services/core/logic/engine3/v5/control/resolveBuyerSellerControl.js
//
// Engine 3 v5 — Buyer / seller control resolver.
//
// Contract:
// - Consumes v5 price-action evidence:
//   approach, contact, reaction, follow-through, and sequence context.
// - Resolves CONTROL STATE only:
//     BUYERS_CONTROL
//     SELLERS_CONTROL
//     CONTESTED
//     ABSORPTION
//     NO_CONTROL
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// IMPORTANT:
// This is the only control resolver.
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.
//
// Design principle:
// Direction is an output of control analysis, not a separate candle guess.

const ENGINE = "engine3.v5.control.resolveBuyerSellerControl.v1";
const SOURCE = "engine3.v5.control.resolveBuyerSellerControl";

function safeUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function addEvidence(target, key, points, reason) {
  target.score += Number(points) || 0;

  if (reason) {
    target.reasons.push(reason);
  }

  target.components.push({
    key,
    points: Number(points) || 0,
    reason: reason || null,
  });
}

function buildScores({
  approach = null,
  contact = null,
  reaction = null,
  followThrough = null,
  sequenceMomentum = null,
} = {}) {
  const buyers = {
    score: 0,
    reasons: [],
    components: [],
  };

  const sellers = {
    score: 0,
    reasons: [],
    components: [],
  };

  const mixed = {
    score: 0,
    reasons: [],
    components: [],
  };

  const approachState =
    safeUpper(
      approach?.approachState,
      "NO_CLEAR_APPROACH"
    );

  const approachCharacter =
    safeUpper(
      approach?.approachCharacter,
      "UNKNOWN"
    );

  const contactState =
    safeUpper(
      contact?.contactState,
      "NO_VALID_CONTACT"
    );

  const contactCharacter =
    safeUpper(
      contact?.contactCharacter,
      "UNKNOWN"
    );

  const reactionState =
    safeUpper(
      reaction?.reactionState,
      "NO_CLEAR_REACTION"
    );

  const reactionBias =
    safeUpper(
      reaction?.reactionBias,
      "NONE"
    );

  const followState =
    safeUpper(
      followThrough?.followThroughState,
      "NO_CLEAR_FOLLOW_THROUGH"
    );

  const followBias =
    safeUpper(
      followThrough?.followThroughBias,
      "NONE"
    );

  const followStrength =
    safeUpper(
      followThrough?.followThroughStrength,
      "UNKNOWN"
    );

  const sequencePhase =
    safeUpper(
      sequenceMomentum?.phase,
      "NO_CLEAR_SEQUENCE"
    );

  const sequenceBias =
    safeUpper(
      sequenceMomentum?.evidenceBias,
      "NONE"
    );

  // -----------------------------
  // Reaction evidence
  // -----------------------------
  if (
    [
      "FAILED_BREAKDOWN",
      "RECLAIM",
      "REJECTION_LOW",
      "ACCEPTANCE_ABOVE",
    ].includes(reactionState)
  ) {
    addEvidence(
      buyers,
      `REACTION_${reactionState}`,
      30,
      `REACTION_${reactionState}_SUPPORTS_BUYERS`
    );
  }

  if (
    [
      "FAILED_BREAKOUT",
      "FAILED_RECLAIM",
      "REJECTION_HIGH",
      "ACCEPTANCE_BELOW",
      "LOST_ZONE",
    ].includes(reactionState)
  ) {
    addEvidence(
      sellers,
      `REACTION_${reactionState}`,
      30,
      `REACTION_${reactionState}_SUPPORTS_SELLERS`
    );
  }

  if (
    reactionState === "ABSORPTION"
  ) {
    addEvidence(
      mixed,
      "REACTION_ABSORPTION",
      35,
      "REACTION_ABSORPTION_PRESENT"
    );
  }

  if (
    reactionState === "CHOP"
  ) {
    addEvidence(
      mixed,
      "REACTION_CHOP",
      30,
      "REACTION_CHOP_PRESENT"
    );
  }

  if (reactionBias === "UP") {
    addEvidence(
      buyers,
      "REACTION_BIAS_UP",
      10,
      "REACTION_BIAS_UP"
    );
  }

  if (reactionBias === "DOWN") {
    addEvidence(
      sellers,
      "REACTION_BIAS_DOWN",
      10,
      "REACTION_BIAS_DOWN"
    );
  }

  if (
    reactionBias === "MIXED"
  ) {
    addEvidence(
      mixed,
      "REACTION_BIAS_MIXED",
      10,
      "REACTION_BIAS_MIXED"
    );
  }

  // -----------------------------
  // Follow-through evidence
  // -----------------------------
  if (
    [
      "CONTINUING_UP",
      "DEVELOPING_UP",
      "OPPOSITE_RESPONSE_UP",
    ].includes(followState)
  ) {
    const points =
      followStrength === "STRONG"
        ? 35
        : followStrength === "GOOD"
        ? 28
        : 18;

    addEvidence(
      buyers,
      `FOLLOW_${followState}`,
      points,
      `FOLLOW_THROUGH_${followState}`
    );
  }

  if (
    [
      "CONTINUING_DOWN",
      "DEVELOPING_DOWN",
      "OPPOSITE_RESPONSE_DOWN",
    ].includes(followState)
  ) {
    const points =
      followStrength === "STRONG"
        ? 35
        : followStrength === "GOOD"
        ? 28
        : 18;

    addEvidence(
      sellers,
      `FOLLOW_${followState}`,
      points,
      `FOLLOW_THROUGH_${followState}`
    );
  }

  if (
    followState === "SIGNAL_ERASED"
  ) {
    if (followBias === "UP") {
      addEvidence(
        buyers,
        "SIGNAL_ERASED_UP",
        35,
        "PRIOR_BEARISH_REACTION_ERASED"
      );
    } else if (followBias === "DOWN") {
      addEvidence(
        sellers,
        "SIGNAL_ERASED_DOWN",
        35,
        "PRIOR_BULLISH_REACTION_ERASED"
      );
    } else {
      addEvidence(
        mixed,
        "SIGNAL_ERASED_MIXED",
        20,
        "SIGNAL_ERASED_WITHOUT_CLEAR_BIAS"
      );
    }
  }

  if (
    followState === "NO_FOLLOW_THROUGH" ||
    followState === "NO_CLEAR_FOLLOW_THROUGH"
  ) {
    addEvidence(
      mixed,
      "FOLLOW_THROUGH_WEAK",
      20,
      "FOLLOW_THROUGH_WEAK_OR_UNCLEAR"
    );
  }

  // -----------------------------
  // Contact evidence
  // -----------------------------
  if (
    [
      "SWEPT_LOW_AND_RECLAIMED_ABOVE_ZONE",
      "SWEPT_LOW_AND_RECLAIMED_INSIDE_ZONE",
      "LOWER_REJECTION_AT_CONTACT",
      "ENTERED_ZONE_FROM_BELOW",
      "CROSSED_ENTIRE_ZONE_UP",
      "TESTED_HIGH_AND_HELD_ABOVE",
    ].includes(contactState)
  ) {
    addEvidence(
      buyers,
      `CONTACT_${contactState}`,
      15,
      `CONTACT_${contactState}_SUPPORTS_BUYERS`
    );
  }

  if (
    [
      "SWEPT_HIGH_AND_REJECTED_BELOW_ZONE",
      "SWEPT_HIGH_AND_REJECTED_INSIDE_ZONE",
      "UPPER_REJECTION_AT_CONTACT",
      "ENTERED_ZONE_FROM_ABOVE",
      "CROSSED_ENTIRE_ZONE_DOWN",
      "TESTED_LOW_AND_HELD_BELOW",
    ].includes(contactState)
  ) {
    addEvidence(
      sellers,
      `CONTACT_${contactState}`,
      15,
      `CONTACT_${contactState}_SUPPORTS_SELLERS`
    );
  }

  if (
    contactCharacter === "MIDLINE_INTERACTION" ||
    contactCharacter === "MIXED_CONTACT"
  ) {
    addEvidence(
      mixed,
      "CONTACT_MIXED",
      10,
      "CONTACT_MIXED_OR_MIDLINE_INTERACTION"
    );
  }

  // -----------------------------
  // Sequence evidence
  // -----------------------------
  if (
    sequenceBias === "UP" ||
    [
      "BUILDING_UP",
      "PROGRESSING_UP",
      "FADING_UP",
    ].includes(sequencePhase)
  ) {
    addEvidence(
      buyers,
      `SEQUENCE_${sequencePhase}`,
      12,
      `SEQUENCE_${sequencePhase}`
    );
  }

  if (
    sequenceBias === "DOWN" ||
    [
      "BUILDING_DOWN",
      "PROGRESSING_DOWN",
      "FADING_DOWN",
    ].includes(sequencePhase)
  ) {
    addEvidence(
      sellers,
      `SEQUENCE_${sequencePhase}`,
      12,
      `SEQUENCE_${sequencePhase}`
    );
  }

  if (
    sequenceBias === "MIXED" ||
    sequencePhase === "COMPRESSION" ||
    sequencePhase === "MIXED"
  ) {
    addEvidence(
      mixed,
      `SEQUENCE_${sequencePhase}`,
      12,
      `SEQUENCE_${sequencePhase}`
    );
  }

  // -----------------------------
  // Approach evidence
  // -----------------------------
  //
  // Approach is intentionally lower weight than reaction/follow-through.
  // It describes how price arrived, not who ultimately won.
  //
  if (
    approachState === "IMPULSE_UP" ||
    approachState === "PROGRESSING_UP_TOWARD_ZONE"
  ) {
    addEvidence(
      buyers,
      `APPROACH_${approachState}`,
      6,
      `APPROACH_${approachState}`
    );
  }

  if (
    approachState === "IMPULSE_DOWN" ||
    approachState === "PROGRESSING_DOWN_TOWARD_ZONE"
  ) {
    addEvidence(
      sellers,
      `APPROACH_${approachState}`,
      6,
      `APPROACH_${approachState}`
    );
  }

  if (
    approachState === "COMPRESSION" ||
    approachCharacter === "MIXED"
  ) {
    addEvidence(
      mixed,
      "APPROACH_MIXED",
      6,
      "APPROACH_COMPRESSION_OR_MIXED"
    );
  }

  return {
    buyers,
    sellers,
    mixed,
  };
}

function resolveControlState({
  buyers,
  sellers,
  mixed,
  reaction = null,
  followThrough = null,
} = {}) {
  const buyerScore =
    clampScore(
      buyers?.score
    );

  const sellerScore =
    clampScore(
      sellers?.score
    );

  const mixedScore =
    clampScore(
      mixed?.score
    );

  const reactionState =
    safeUpper(
      reaction?.reactionState,
      "NO_CLEAR_REACTION"
    );

  const followState =
    safeUpper(
      followThrough?.followThroughState,
      "NO_CLEAR_FOLLOW_THROUGH"
    );

  const spread =
    Math.abs(
      buyerScore -
      sellerScore
    );

  if (
    reactionState === "ABSORPTION" &&
    mixedScore >= 25
  ) {
    return {
      controlState:
        "ABSORPTION",

      controlConfidence:
        "MIXED",

      winnerScore:
        mixedScore,

      scoreSpread:
        spread,
    };
  }

  if (
    reactionState === "CHOP" ||
    (
      mixedScore >= 25 &&
      spread < 15
    )
  ) {
    return {
      controlState:
        "CONTESTED",

      controlConfidence:
        "MIXED",

      winnerScore:
        Math.max(
          buyerScore,
          sellerScore,
          mixedScore
        ),

      scoreSpread:
        spread,
    };
  }

  if (
    buyerScore >= 55 &&
    buyerScore >= sellerScore + 15
  ) {
    return {
      controlState:
        "BUYERS_CONTROL",

      controlConfidence:
        buyerScore >= 75
          ? "STRONG"
          : "GOOD",

      winnerScore:
        buyerScore,

      scoreSpread:
        spread,
    };
  }

  if (
    sellerScore >= 55 &&
    sellerScore >= buyerScore + 15
  ) {
    return {
      controlState:
        "SELLERS_CONTROL",

      controlConfidence:
        sellerScore >= 75
          ? "STRONG"
          : "GOOD",

      winnerScore:
        sellerScore,

      scoreSpread:
        spread,
    };
  }

  if (
    followState === "SIGNAL_ERASED" &&
    spread < 15
  ) {
    return {
      controlState:
        "CONTESTED",

      controlConfidence:
        "MIXED",

      winnerScore:
        Math.max(
          buyerScore,
          sellerScore,
          mixedScore
        ),

      scoreSpread:
        spread,
    };
  }

  return {
    controlState:
      "NO_CONTROL",

    controlConfidence:
      "WEAK",

    winnerScore:
      Math.max(
        buyerScore,
        sellerScore,
        mixedScore
      ),

    scoreSpread:
      spread,
  };
}

export function resolveBuyerSellerControl({
  approach = null,
  contact = null,
  reaction = null,
  followThrough = null,
  sequenceMomentum = null,
} = {}) {
  const scores =
    buildScores({
      approach,
      contact,
      reaction,
      followThrough,
      sequenceMomentum,
    });

  const resolution =
    resolveControlState({
      buyers:
        scores.buyers,

      sellers:
        scores.sellers,

      mixed:
        scores.mixed,

      reaction,

      followThrough,
    });

  const buyerScore =
    clampScore(
      scores.buyers.score
    );

  const sellerScore =
    clampScore(
      scores.sellers.score
    );

  const mixedScore =
    clampScore(
      scores.mixed.score
    );

  return {
    ok: true,

    engine:
      ENGINE,

    source:
      SOURCE,

    controlState:
      resolution.controlState,

    controlConfidence:
      resolution.controlConfidence,

    score: {
      buyers:
        buyerScore,

      sellers:
        sellerScore,

      mixed:
        mixedScore,

      winner:
        resolution.winnerScore,

      spread:
        resolution.scoreSpread,
    },

    evidence: {
      buyers:
        scores.buyers,

      sellers:
        scores.sellers,

      mixed:
        scores.mixed,
    },

    sourceStates: {
      approachState:
        approach?.approachState ??
        null,

      contactState:
        contact?.contactState ??
        null,

      reactionState:
        reaction?.reactionState ??
        null,

      reactionBias:
        reaction?.reactionBias ??
        null,

      followThroughState:
        followThrough?.followThroughState ??
        null,

      followThroughBias:
        followThrough?.followThroughBias ??
        null,

      sequencePhase:
        sequenceMomentum?.phase ??
        null,

      sequenceEvidenceBias:
        sequenceMomentum?.evidenceBias ??
        null,
    },

    reasonCodes: [
      "ENGINE3_V5_BUYER_SELLER_CONTROL_RESOLVED",
      `ENGINE3_V5_CONTROL_STATE_${resolution.controlState}`,
      `ENGINE3_V5_CONTROL_CONFIDENCE_${resolution.controlConfidence}`,
      "ENGINE3_V5_CONTROL_ONLY",
      "ENGINE3_V5_DIRECTION_STATE_MACHINE_NOT_RUN",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default resolveBuyerSellerControl;
