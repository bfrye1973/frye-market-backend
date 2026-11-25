import { pickFirst, safeUpper } from "./inputUtils.js";

export function resolveReactionState(reaction) {
  return safeUpper(
    reaction?.reactionState ||
      reaction?.authorizedReactionState ||
      reaction?.state ||
      reaction?.fastReactionState ||
      "NO_REACTION",
    "NO_REACTION"
  );
}

export function resolveEvaluationAuthorized(reaction) {
  return (
    reaction?.evaluationAuthorized === true ||
    reaction?.authorizeEngine3Evaluation === true ||
    reaction?.authorized === true ||
    false
  );
}

export function resolveReactionConfirmed(reaction) {
  return (
    reaction?.reactionConfirmed === true ||
    (
      reaction?.confirmed === true &&
      safeUpper(reaction?.authorizedReactionState || reaction?.reactionState || reaction?.state) === "REACTION_CONFIRMED"
    ) ||
    false
  );
}

export function resolveParticipationEvaluationEligibility(reaction) {
  const explicitlyPublished =
    reaction &&
    Object.prototype.hasOwnProperty.call(
      reaction,
      "participationEvaluationEligible"
    );

  return {
    explicitlyPublished,
    eligible:
      explicitlyPublished
        ? reaction?.participationEvaluationEligible === true
        : resolveReactionConfirmed(reaction),
  };
}

export function resolveDirection(reaction, tacticalParticipation) {
  return safeUpper(
    reaction?.direction ||
      reaction?.tradeDirectionBias ||
      tacticalParticipation?.intendedDirection ||
      tacticalParticipation?.direction ||
      "NEUTRAL",
    "NEUTRAL"
  );
}

export function resolveQuality(reaction, tacticalParticipation) {
  return safeUpper(
    reaction?.quality ||
      tacticalParticipation?.participationQuality ||
      tacticalParticipation?.quality ||
      "WEAK",
    "WEAK"
  );
}

export function resolvePromotedContactContext({
  reaction = null,
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  const reactionLocationContext = reaction?.engine26LocationContext || null;

  const contactState = pickFirst(
    reaction?.contactState,
    reactionLocationContext?.contactState,
    engine26ReactionHandoff?.contactState,
    engine26LocationCandidate?.contactState
  );

  const directionState = pickFirst(
    reaction?.directionState,
    reactionLocationContext?.directionState,
    engine26ReactionHandoff?.directionState,
    engine26LocationCandidate?.directionState
  );

  const chainArmed =
    reaction?.chainArmed === true ||
    reactionLocationContext?.chainArmed === true ||
    engine26ReactionHandoff?.chainArmed === true ||
    engine26LocationCandidate?.chainArmed === true;

  const armed =
    reaction?.armed === true ||
    reactionLocationContext?.armed === true ||
    engine26ReactionHandoff?.armed === true ||
    chainArmed === true;

  const expectedReactionDirection = safeUpper(
    pickFirst(
      reaction?.expectedReactionDirection,
      reactionLocationContext?.expectedReactionDirection,
      engine26ReactionHandoff?.expectedReactionDirection,
      engine26LocationCandidate?.expectedReactionDirection,
      engine26LocationCandidate?.expectedReversalDirection
    ),
    ""
  );

  const expectedParticipationDirection = safeUpper(
    pickFirst(
      reaction?.expectedParticipationDirection,
      reactionLocationContext?.expectedParticipationDirection,
      engine26ReactionHandoff?.expectedParticipationDirection,
      engine26LocationCandidate?.expectedParticipationDirection,
      expectedReactionDirection
    ),
    ""
  );

  const expectedReversalDirection = safeUpper(
    pickFirst(
      reaction?.expectedReversalDirection,
      reactionLocationContext?.expectedReversalDirection,
      engine26ReactionHandoff?.expectedReversalDirection,
      engine26LocationCandidate?.expectedReversalDirection
    ),
    ""
  );

  const promotedContactActive =
    contactState === "NEGOTIATED_LINE_CONTACT" &&
    chainArmed === true &&
    directionState === "SHORT_REVERSAL_WATCH";

  return {
    armed,
    chainArmed,
    contactState: contactState || null,
    directionState: directionState || null,
    expectedReactionDirection: expectedReactionDirection || null,
    expectedParticipationDirection:
      expectedParticipationDirection ||
      (promotedContactActive ? "SHORT" : null),
    expectedReversalDirection: expectedReversalDirection || null,
    promotedContactActive,

    priorCandidateId: pickFirst(
      reaction?.priorCandidateId,
      reactionLocationContext?.priorCandidateId,
      engine26ReactionHandoff?.priorCandidateId,
      engine26LocationCandidate?.priorCandidateId
    ),
    priorZoneId: pickFirst(
      reaction?.priorZoneId,
      reactionLocationContext?.priorZoneId,
      engine26ReactionHandoff?.priorZoneId,
      engine26LocationCandidate?.priorZoneId
    ),
    priorRotationDirection: pickFirst(
      reaction?.priorRotationDirection,
      reactionLocationContext?.priorRotationDirection,
      engine26ReactionHandoff?.priorRotationDirection,
      engine26LocationCandidate?.priorRotationDirection
    ),
    priorRotationCompletionState: pickFirst(
      reaction?.priorRotationCompletionState,
      reactionLocationContext?.priorRotationCompletionState,
      engine26ReactionHandoff?.priorRotationCompletionState,
      engine26LocationCandidate?.priorRotationCompletionState
    ),
    priorRotationFullyComplete:
      reaction?.priorRotationFullyComplete === true ||
      reactionLocationContext?.priorRotationFullyComplete === true ||
      engine26ReactionHandoff?.priorRotationFullyComplete === true ||
      engine26LocationCandidate?.priorRotationFullyComplete === true,
    promotedFromTargetCompletion:
      reaction?.promotedFromTargetCompletion === true ||
      reactionLocationContext?.promotedFromTargetCompletion === true ||
      engine26ReactionHandoff?.promotedFromTargetCompletion === true ||
      engine26LocationCandidate?.promotedFromTargetCompletion === true,
    promotionReason: pickFirst(
      reaction?.promotionReason,
      reactionLocationContext?.promotionReason,
      engine26ReactionHandoff?.promotionReason,
      engine26LocationCandidate?.promotionReason
    ),
  };
}

export function resolveParticipationEvaluationDirection({
  reaction,
  direction,
  promotedContext,
  participationEligibility,
}) {
  const reactionDirection = safeUpper(
    reaction?.direction,
    "NEUTRAL"
  );

  if (participationEligibility?.explicitlyPublished === true) {
    return (
      participationEligibility.eligible === true &&
      ["LONG", "SHORT"].includes(reactionDirection)
    )
      ? reactionDirection
      : "NEUTRAL";
  }

  // Legacy compatibility only for pre-D2 reaction objects that do not
  // publish participationEvaluationEligible.
  const expected = safeUpper(
    promotedContext?.expectedParticipationDirection,
    ""
  );

  if (["LONG", "SHORT"].includes(expected)) {
    return expected;
  }

  return safeUpper(direction, "NEUTRAL");
}
