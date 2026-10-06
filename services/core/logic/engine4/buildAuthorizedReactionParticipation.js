// services/core/logic/engine4/buildAuthorizedReactionParticipation.js
//
// Engine 4 Phase 3 canonical candidate-aware participation contract.
//
// Output path after attach:
// confluence.context.volume.engine4AuthorizedReactionParticipation
//
// Contract boundaries:
// - Engine 4 owns participation only.
// - It consumes Engine 3's candidate-aware paperScalpReaction.
// - It preserves candidate identity; it never generates candidateId or zoneId.
// - It does not create permission, sizing, management, orders, fills, execution, or journal entries.

import { resolveCandles } from "./candles/resolveCandles.js";
import { resolveIdentity } from "./identity/resolveIdentity.js";
import { safeUpper } from "./contracts/inputUtils.js";
import {
  resolveReactionState,
  resolveEvaluationAuthorized,
  resolveReactionConfirmed,
  resolveParticipationEvaluationEligibility,
  resolveDirection,
  resolveQuality,
  resolvePromotedContactContext,
  resolveParticipationEvaluationDirection,
} from "./contracts/resolveEngine3Input.js";
import { baseResult } from "./contracts/buildEngine4BaseResult.js";
import { finalizeResult } from "./diagnostics/buildPlainEnglish.js";
import { toNum, unique } from "./contracts/valueUtils.js";
import { computeVolumeMetadata } from "./participation/computeVolumeMetadata.js";

const ENGINE = "engine4.authorizedReactionParticipation.v1";
const PARTICIPATION_CONTRACT_VERSION = "engine4.strategy1.v1";

const STATES = {
  WAITING: "PARTICIPATION_WAITING",
  FORMING: "FORMING_CANDLE_PARTICIPATION_DEVELOPING",
  CONFIRMED: "PARTICIPATION_CONFIRMED",
  ADVERSE: "ADVERSE_PARTICIPATION_BLOCKED",
  INVALIDATED: "CANDIDATE_INVALIDATED",
  IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
};

function clonePlain(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  return JSON.parse(JSON.stringify(value));
}

function getNested(obj, path) {
  return path.reduce((cur, key) => (cur == null ? null : cur[key]), obj);
}

function getPaperScalpReaction(patchedConfluence) {
  return patchedConfluence?.context?.reaction?.paperScalpReaction || null;
}

function getFastParticipation(patchedConfluence) {
  return patchedConfluence?.context?.volume?.engine4FastImbalanceParticipation || null;
}

function getCurrentScalpParticipation(patchedConfluence) {
  return patchedConfluence?.context?.volume?.engine4CurrentScalpParticipation || null;
}

function isCandidateInvalidated(reaction) {
  const state = resolveReactionState(reaction);
  return (
    state === "REACTION_INVALIDATED" ||
    reaction?.invalidationFacts?.completedCloseInvalidated === true ||
    reaction?.candidateInvalidated === true
  );
}

function resolve5mParticipationAuthority({ direction, volumeMeta }) {
  const canonicalDirection = safeUpper(direction, "NEUTRAL");
  const validationDirection = safeUpper(volumeMeta?.validation5mDirection, "NEUTRAL");

  const validationUsable =
    volumeMeta?.validation5mActive === true &&
    volumeMeta?.validation5mStale !== true;

  if (
    validationUsable !== true ||
    !["LONG", "SHORT"].includes(canonicalDirection) ||
    !["LONG", "SHORT"].includes(validationDirection)
  ) {
    return "UNRESOLVED";
  }

  return validationDirection === canonicalDirection
    ? "SUPPORTIVE"
    : "ADVERSE";
}

function broader10mWeakensParticipation(volumeMeta) {
  return (
    volumeMeta?.broader10mActive === true &&
    safeUpper(volumeMeta?.broader10mVolumeTrend) === "FADING"
  );
}

function isConstructiveParticipation({ direction, volumeMeta }) {
  const participationAuthority = resolve5mParticipationAuthority({
    direction,
    volumeMeta,
  });

  return (
    participationAuthority === "SUPPORTIVE" &&
    broader10mWeakensParticipation(volumeMeta) !== true
  );
}

function completedZoneLossAgainstLong({ reaction, volumeMeta }) {
  const entryZone = reaction?.entryZone || reaction?.engine26LocationContext?.entryZone || null;
  const zoneLow = toNum(entryZone?.lo ?? entryZone?.low);
  const close = volumeMeta.currentCandle?.close;

  return (
    volumeMeta.currentCandleClosed === true &&
    zoneLow != null &&
    close != null &&
    close < zoneLow
  );
}

function completedAdverseEvidence({ reaction, direction, volumeMeta }) {
  if (
    direction === "LONG" &&
    completedZoneLossAgainstLong({ reaction, volumeMeta })
  ) {
    return true;
  }

  const participationAuthority = resolve5mParticipationAuthority({
    direction,
    volumeMeta,
  });

  return (
    participationAuthority === "ADVERSE" &&
    broader10mWeakensParticipation(volumeMeta) !== true
  );
}

export function buildEngine4AuthorizedReactionParticipation({
  patchedConfluence = null,
  paperScalpReaction = null,
  engine4FastImbalanceParticipation = null,
  engine4CurrentScalpParticipation = null,
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  const reaction = paperScalpReaction || getPaperScalpReaction(patchedConfluence);
  const fastParticipation = engine4FastImbalanceParticipation || getFastParticipation(patchedConfluence);
  const currentParticipation = engine4CurrentScalpParticipation || getCurrentScalpParticipation(patchedConfluence);
  const tacticalParticipation =
    fastParticipation?.active === true ? fastParticipation : currentParticipation?.active === true ? currentParticipation : null;

  if (!reaction || typeof reaction !== "object") {
    return finalizeResult({
      active: false,
      engine: ENGINE,
      canonical: true,
      mode: "PAPER_ONLY",
      participationContractVersion: PARTICIPATION_CONTRACT_VERSION,
      participationObservation: false,
      participationEvaluationEligible: false,
      participationEvaluationEligibilityPublished: false,
      qualifiedParticipationEvaluation: false,
      participationDeveloping: false,
      participationConfirmed: false,
      participationState: STATES.WAITING,
      participationQuality: "WEAK",
      status: STATES.WAITING,
      allowed: false,
      confirmed: false,
      hardBlocked: false,
      requiresEngine6Permission: true,
      noPermissionCreated: true,
      noExecution: true,
      blockers: ["ENGINE3_REACTION_MISSING"],
      reasonCodes: [
        "ENGINE4_AUTHORIZED_REACTION_PARTICIPATION",
        "ENGINE3_REACTION_MISSING",
        "PARTICIPATION_WAITING",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    });
  }

  const identity = resolveIdentity({ reaction, engine26LocationCandidate, engine26ReactionHandoff });
  const reactionState = resolveReactionState(reaction);
  const evaluationAuthorized = resolveEvaluationAuthorized(reaction);
  const reactionConfirmed = resolveReactionConfirmed(reaction);
  const participationEligibility =
    resolveParticipationEvaluationEligibility(reaction);
  const direction = resolveDirection(reaction, tacticalParticipation);
  const quality = resolveQuality(reaction, tacticalParticipation);
  const promotedContext = resolvePromotedContactContext({
    reaction,
    engine26LocationCandidate,
    engine26ReactionHandoff,
  });
  const participationEvaluationDirection = resolveParticipationEvaluationDirection({
    reaction,
    direction,
    promotedContext,
    participationEligibility,
  });
  const volumeMeta = computeVolumeMetadata({ reaction, tacticalParticipation });

  const result = baseResult({
    reaction,
    identity,
    volumeMeta,
    direction,
    quality,
    reactionState,
    evaluationAuthorized,
    reactionConfirmed,
    participationEligibility,
    promotedContext,
    participationEvaluationDirection,
  });

  result.relativeVolume = toNum(tacticalParticipation?.relativeVolume);
  result.volumeTrend = tacticalParticipation?.volumeTrend || null;
  result.volumeExpansion = tacticalParticipation?.volumeExpansion === true;
  result.volumeConfirmed = tacticalParticipation?.volumeConfirmed === true;

  if (identity.identityMismatch) {
    return finalizeResult({
      ...result,
      active: false,
      participationState: STATES.IDENTITY_MISMATCH,
      status: STATES.IDENTITY_MISMATCH,
      participationQuality: "RISK",
      hardBlocked: true,
      downgradeOnly: false,
      blockers: unique([...(result.blockers || []), ...identity.identityMismatchCodes]),
      reasonCodes: unique([
        ...result.reasonCodes,
        ...identity.identityMismatchCodes,
        "IDENTITY_MISMATCH",
      ]),
    });
  }

  if (identity.identityMissing) {
    return finalizeResult({
      ...result,
      active: false,
      participationState: STATES.IDENTITY_MISMATCH,
      status: STATES.IDENTITY_MISMATCH,
      participationQuality: "RISK",
      hardBlocked: true,
      downgradeOnly: false,
      blockers: unique([...(result.blockers || []), ...identity.identityMissingCodes]),
      reasonCodes: unique([
        ...result.reasonCodes,
        ...identity.identityMissingCodes,
        "IDENTITY_REQUIRED_FOR_PHASE3",
      ]),
    });
  }

  if (isCandidateInvalidated(reaction)) {
    return finalizeResult({
      ...result,
      participationState: STATES.INVALIDATED,
      status: STATES.INVALIDATED,
      participationQuality: "RISK",
      hardBlocked: true,
      downgradeOnly: false,
      blockers: ["CANDIDATE_INVALIDATED"],
      reasonCodes: unique([...result.reasonCodes, "CANDIDATE_INVALIDATED"]),
    });
  }

  if (evaluationAuthorized !== true) {
    return finalizeResult({
      ...result,
      participationState: STATES.WAITING,
      status: STATES.WAITING,
      participationQuality: "WEAK",
      blockers: ["ENGINE3_EVALUATION_NOT_AUTHORIZED"],
      reasonCodes: unique([...result.reasonCodes, "ENGINE3_EVALUATION_NOT_AUTHORIZED", "PARTICIPATION_WAITING"]),
    });
  }

  const adverseCompleted = completedAdverseEvidence({ reaction, direction: participationEvaluationDirection, volumeMeta });

  const qualifiedParticipationEvaluation =
    result.qualifiedParticipationEvaluation === true;

  const engine3GateSatisfied =
    participationEligibility.explicitlyPublished === true
      ? qualifiedParticipationEvaluation
      : reactionConfirmed === true;

  if (engine3GateSatisfied && adverseCompleted === true) {
    return finalizeResult({
      ...result,
      participationState: STATES.ADVERSE,
      status: STATES.ADVERSE,
      participationQuality: "RISK",
      hardBlocked: true,
      downgradeOnly: false,
      blockers: ["VALID_COMPLETED_ADVERSE_PARTICIPATION"],
      reasonCodes: unique([...result.reasonCodes, "VALID_COMPLETED_ADVERSE_PARTICIPATION", "ADVERSE_PARTICIPATION_BLOCKED"]),
    });
  }

  const constructive = isConstructiveParticipation({
    direction: participationEvaluationDirection,
    volumeMeta,
  });

  if (engine3GateSatisfied !== true) {
    const explicitEligibilityBlocked =
      participationEligibility.explicitlyPublished === true;

    return finalizeResult({
      ...result,
      participationDeveloping: constructive === true,
      participationConfirmed: false,
      participationState: constructive ? STATES.FORMING : STATES.WAITING,
      status: constructive ? STATES.FORMING : STATES.WAITING,
      participationQuality: constructive ? "PROVISIONAL" : "WEAK",
      allowed: false,
      confirmed: false,
      hardBlocked: false,
      direction: "NEUTRAL",
      blockers: constructive
        ? []
        : [
            explicitEligibilityBlocked
              ? "ENGINE3_PARTICIPATION_EVALUATION_NOT_ELIGIBLE"
              : "ENGINE3_REACTION_NOT_CONFIRMED",
          ],
      reasonCodes: unique([
        ...result.reasonCodes,
        explicitEligibilityBlocked
          ? (
              constructive
                ? "DEVELOPING_PARTICIPATION_ENGINE3_NOT_ELIGIBLE"
                : "ENGINE3_PARTICIPATION_EVALUATION_NOT_ELIGIBLE"
            )
          : (
              constructive
                ? "DEVELOPING_PARTICIPATION_REACTION_NOT_CONFIRMED"
                : "ENGINE3_REACTION_NOT_CONFIRMED"
            ),
      ]),
    });
  }

  if (constructive) {
    const supportDefenseConfirmed = participationEvaluationDirection === "LONG";
    const sellerFailureConfirmed = participationEvaluationDirection === "LONG" && reactionState.includes("SELLER_FAILURE");

    return finalizeResult({
      ...result,
      participationDeveloping: true,
      participationConfirmed: true,
      participationState: STATES.CONFIRMED,
      status: STATES.CONFIRMED,
      participationQuality: quality === "STRONG" ? "STRONG" : "GOOD",
      supportDefenseConfirmed,
      sellerFailureParticipationConfirmed: sellerFailureConfirmed,
      allowed: true,
      confirmed: true,
      hardBlocked: false,
      downgradeOnly: true,
      direction:
        participationEligibility.explicitlyPublished === true
          ? participationEvaluationDirection
          : (
              promotedContext.promotedContactActive
                ? "NEUTRAL"
                : direction
            ),
      reasonCodes: unique([
        ...result.reasonCodes,
        "PARTICIPATION_CONFIRMED",
        "ENGINE4_AUTHORIZED_PARTICIPATION_CONFIRMED",
        "ALLOWED_FOR_ENGINE6_REVIEW_ONLY",
      ]),
    });
  }

  return finalizeResult({
    ...result,
    participationDeveloping: false,
    participationConfirmed: false,
    participationState: STATES.WAITING,
    status: STATES.WAITING,
    participationQuality: "WEAK",
    allowed: false,
    confirmed: false,
    hardBlocked: false,
    blockers: ["PARTICIPATION_NOT_CONFIRMED"],
    reasonCodes: unique([...result.reasonCodes, "PARTICIPATION_NOT_CONFIRMED", "PARTICIPATION_WAITING"]),
  });
}

export function attachEngine4AuthorizedReactionParticipation({
  patchedConfluence,
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  if (!patchedConfluence || typeof patchedConfluence !== "object") return patchedConfluence;

  const engine4AuthorizedReactionParticipation = buildEngine4AuthorizedReactionParticipation({
    patchedConfluence,
    engine26LocationCandidate,
    engine26ReactionHandoff,
  });

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.volume = {
    ...(patchedConfluence.context.volume || {}),
    engine4AuthorizedReactionParticipation,
  };

  return patchedConfluence;
}
