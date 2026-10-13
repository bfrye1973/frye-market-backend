// services/core/logic/engine3/v5/control/resolveReactionQuality.js
//
// Engine 3 v5 — Reaction/control quality resolver.
//
// Contract:
// - Consumes v5 evidence and control state.
// - Resolves quality only:
//     STRONG
//     GOOD
//     MIXED
//     WEAK
// - Quality is evidence-based, not hard-coded from a single reaction label.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// IMPORTANT:
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

const ENGINE = "engine3.v5.control.resolveReactionQuality.v1";
const SOURCE = "engine3.v5.control.resolveReactionQuality";

function safeUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function push(points, reasons, value, reason) {
  points.value += Number(value) || 0;
  if (reason) reasons.push(reason);
}

export function resolveReactionQuality({
  approach = null,
  contact = null,
  reaction = null,
  followThrough = null,
  sequenceMomentum = null,
  control = null,
} = {}) {
  const points = { value: 0 };
  const reasons = [];

  const controlState =
    safeUpper(
      control?.controlState,
      "NO_CONTROL"
    );

  const controlConfidence =
    safeUpper(
      control?.controlConfidence,
      "WEAK"
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

  const approachCharacter =
    safeUpper(
      approach?.approachCharacter,
      "UNKNOWN"
    );

  const contactCharacter =
    safeUpper(
      contact?.contactCharacter,
      "UNKNOWN"
    );

  // Control clarity is the strongest quality ingredient.
  if (
    controlState === "BUYERS_CONTROL" ||
    controlState === "SELLERS_CONTROL"
  ) {
    push(
      points,
      reasons,
      controlConfidence === "STRONG" ? 35 : 28,
      `CONTROL_${controlState}_${controlConfidence}`
    );
  } else if (
    controlState === "CONTESTED" ||
    controlState === "ABSORPTION"
  ) {
    push(
      points,
      reasons,
      10,
      `CONTROL_${controlState}`
    );
  } else {
    push(
      points,
      reasons,
      0,
      "CONTROL_NO_CONTROL"
    );
  }

  // Reaction clarity.
  if (
    [
      "FAILED_BREAKOUT",
      "FAILED_BREAKDOWN",
      "FAILED_RECLAIM",
      "RECLAIM",
      "REJECTION_HIGH",
      "REJECTION_LOW",
      "ACCEPTANCE_ABOVE",
      "ACCEPTANCE_BELOW",
      "LOST_ZONE",
    ].includes(reactionState)
  ) {
    push(
      points,
      reasons,
      22,
      `REACTION_CLEAR_${reactionState}`
    );
  } else if (
    reactionState === "ABSORPTION" ||
    reactionState === "CHOP"
  ) {
    push(
      points,
      reasons,
      6,
      `REACTION_MIXED_${reactionState}`
    );
  }

  // Follow-through is essential.
  if (
    followState === "CONTINUING_UP" ||
    followState === "CONTINUING_DOWN"
  ) {
    push(
      points,
      reasons,
      followStrength === "STRONG" ? 25 : 20,
      `FOLLOW_THROUGH_${followState}_${followStrength}`
    );
  } else if (
    followState === "DEVELOPING_UP" ||
    followState === "DEVELOPING_DOWN"
  ) {
    push(
      points,
      reasons,
      12,
      `FOLLOW_THROUGH_${followState}`
    );
  } else if (
    followState === "SIGNAL_ERASED" ||
    followState.startsWith("OPPOSITE_RESPONSE_")
  ) {
    push(
      points,
      reasons,
      18,
      `FOLLOW_THROUGH_${followState}`
    );
  } else if (
    followState === "NO_FOLLOW_THROUGH"
  ) {
    push(
      points,
      reasons,
      -12,
      "FOLLOW_THROUGH_MISSING"
    );
  }

  // Sequence consistency.
  if (
    sequencePhase === "BUILDING_UP" ||
    sequencePhase === "BUILDING_DOWN"
  ) {
    push(
      points,
      reasons,
      12,
      `SEQUENCE_${sequencePhase}`
    );
  } else if (
    sequencePhase === "PROGRESSING_UP" ||
    sequencePhase === "PROGRESSING_DOWN"
  ) {
    push(
      points,
      reasons,
      8,
      `SEQUENCE_${sequencePhase}`
    );
  } else if (
    sequencePhase === "COMPRESSION" ||
    sequencePhase === "MIXED"
  ) {
    push(
      points,
      reasons,
      -6,
      `SEQUENCE_${sequencePhase}`
    );
  }

  // Approach/contact context is lower weight.
  if (approachCharacter === "IMPULSE") {
    push(
      points,
      reasons,
      4,
      "APPROACH_IMPULSE"
    );
  } else if (approachCharacter === "CORRECTION") {
    push(
      points,
      reasons,
      2,
      "APPROACH_CORRECTION"
    );
  } else if (
    approachCharacter === "COMPRESSION" ||
    approachCharacter === "MIXED"
  ) {
    push(
      points,
      reasons,
      -3,
      `APPROACH_${approachCharacter}`
    );
  }

  if (
    contactCharacter === "HIGH_SIDE_REJECTION" ||
    contactCharacter === "LOW_SIDE_REJECTION" ||
    contactCharacter === "BULLISH_TRAVERSE" ||
    contactCharacter === "BEARISH_TRAVERSE" ||
    contactCharacter === "HIGH_SIDE_HOLD" ||
    contactCharacter === "LOW_SIDE_HOLD"
  ) {
    push(
      points,
      reasons,
      4,
      `CONTACT_${contactCharacter}`
    );
  } else if (
    contactCharacter === "MIXED_CONTACT" ||
    contactCharacter === "MIDLINE_INTERACTION"
  ) {
    push(
      points,
      reasons,
      -2,
      `CONTACT_${contactCharacter}`
    );
  }

  const score =
    clampScore(points.value);

  let quality = "WEAK";

  if (
    controlState === "CONTESTED" ||
    controlState === "ABSORPTION"
  ) {
    quality = "MIXED";
  } else if (
    controlState === "NO_CONTROL"
  ) {
    quality = "WEAK";
  } else if (score >= 80) {
    quality = "STRONG";
  } else if (score >= 55) {
    quality = "GOOD";
  } else if (score >= 35) {
    quality = "MIXED";
  } else {
    quality = "WEAK";
  }

  return {
    ok: true,

    engine:
      ENGINE,

    source:
      SOURCE,

    quality,

    qualityScore:
      score,

    controlState,

    controlConfidence,

    sourceStates: {
      approachCharacter:
        approach?.approachCharacter ??
        null,

      contactCharacter:
        contact?.contactCharacter ??
        null,

      reactionState:
        reaction?.reactionState ??
        null,

      followThroughState:
        followThrough?.followThroughState ??
        null,

      followThroughStrength:
        followThrough?.followThroughStrength ??
        null,

      sequencePhase:
        sequenceMomentum?.phase ??
        null,
    },

    scoring: {
      rawScore:
        points.value,

      clampedScore:
        score,

      reasons,
    },

    reasonCodes: [
      "ENGINE3_V5_REACTION_QUALITY_RESOLVED",
      `ENGINE3_V5_QUALITY_${quality}`,
      `ENGINE3_V5_QUALITY_SCORE_${score}`,
      "ENGINE3_V5_QUALITY_EVIDENCE_BASED",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_DIRECTION_STATE_MACHINE_NOT_RUN",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default resolveReactionQuality;
