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

function isConstructiveParticipation({ direction, reactionState, quality, tacticalParticipation, volumeMeta }) {
  const supportiveTactical =
    tacticalParticipation?.hardBlocked !== true &&
    (
      tacticalParticipation?.allowed === true ||
      tacticalParticipation?.participationConfirmed === true ||
      ["GOOD", "STRONG", "CLEAN", "MIXED"].includes(
        safeUpper(tacticalParticipation?.participationQuality)
      )
    );

  const longState =
    direction === "LONG" &&
    (
      reactionState.includes("RECLAIM") ||
      reactionState.includes("HELD") ||
      reactionState.includes("ACCEPT") ||
      reactionState.includes("WICK") ||
      reactionState.includes("SELLER_FAILURE") ||
      reactionState.includes("SUPPORT") ||
      reactionState === "REACTION_CONFIRMED"
    );

  const shortState =
    direction === "SHORT" &&
    (
      reactionState.includes("REJECT") ||
      reactionState.includes("LOST") ||
      reactionState.includes("FAIL") ||
      reactionState === "REACTION_CONFIRMED"
    );

  const qualityOk = ["GOOD", "STRONG", "MIXED"].includes(quality);

  return (
    supportiveTactical ||
    ((longState || shortState) && qualityOk && volumeMeta.formingCandle !== true)
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

function completedAdverseEvidence({ reaction, direction, tacticalParticipation, volumeMeta }) {
  if (volumeMeta.currentCandleClosed !== true) return false;

  const current = volumeMeta.currentCandle;
  const prior = volumeMeta.priorCandle;

  const red =
    current.open != null &&
    current.close != null &&
    current.close < current.open;

  const green =
    current.open != null &&
    current.close != null &&
    current.close > current.open;

  const lowerClose =
    current.close != null &&
    prior.close != null &&
    current.close < prior.close;

  const higherClose =
    current.close != null &&
    prior.close != null &&
    current.close > prior.close;

  const volumeExpansion =
    tacticalParticipation?.volumeExpansion === true;

  const adverseAbsorption =
    (
      tacticalParticipation?.absorptionRisk === true ||
      tacticalParticipation?.absorptionHardBlock === true
    ) &&
    tacticalParticipation?.supportsDirection !== true;

  const highVolumeNoProgress =
    tacticalParticipation?.highVolumeNoProgress === true &&
    tacticalParticipation?.supportsDirection !== true;

  const participationState =
    safeUpper(tacticalParticipation?.participationState);

  /*
   * Directionally adverse completed evidence only.
   *
   * Weak participation, fading volume, or high-volume/no-progress alone
   * should prevent confirmation, but should not become an adverse hard block
   * unless completed price action is actually against the trade direction.
   */
  const bearishAgainstLong =
    red === true &&
    lowerClose === true &&
    volumeExpansion === true;

  const bullishAgainstShort =
    green === true &&
    higherClose === true &&
    volumeExpansion === true;

  const explicitDirectionalRiskAgainstLong =
    participationState.includes("BEARISH_AGAINST_LONG") ||
    participationState.includes("SELLING_AGAINST_LONG");

  const explicitDirectionalRiskAgainstShort =
    participationState.includes("BULLISH_AGAINST_SHORT") ||
    participationState.includes("BUYING_AGAINST_SHORT");

  if (direction === "LONG") {
    return (
      completedZoneLossAgainstLong({ reaction, volumeMeta }) ||
      bearishAgainstLong ||
      adverseAbsorption ||
      (
        highVolumeNoProgress === true &&
        bearishAgainstLong === true
      ) ||
      explicitDirectionalRiskAgainstLong
    );
  }

  if (direction === "SHORT") {
    return (
      bullishAgainstShort ||
      adverseAbsorption ||
      (
        highVolumeNoProgress === true &&
        bullishAgainstShort === true
      ) ||
      explicitDirectionalRiskAgainstShort
    );
  }

  return false;
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

  const candleContractPublished =
    volumeMeta.sourceTimeframe != null ||
    volumeMeta.currentCandleStatus != null ||
    reaction?.candleSourceFresh !== undefined;
  const currentCandlePresent =
    volumeMeta.currentCandle?.time != null &&
    volumeMeta.currentCandle?.close != null;

  if (
    candleContractPublished &&
    (volumeMeta.candleSourceFresh !== true || currentCandlePresent !== true)
  ) {
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
      direction: "NEUTRAL",
      blockers: [
        currentCandlePresent ? "CANDLE_SOURCE_NOT_FRESH" : "CURRENT_CANDLE_MISSING",
      ],
      reasonCodes: unique([
        ...result.reasonCodes,
        currentCandlePresent ? "CANDLE_SOURCE_NOT_FRESH" : "CURRENT_CANDLE_MISSING",
        "PARTICIPATION_WAITING",
      ]),
    });
  }

  const adverseCompleted = completedAdverseEvidence({ reaction, direction: participationEvaluationDirection, tacticalParticipation, volumeMeta });

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
    reactionState,
    quality,
    tacticalParticipation,
    volumeMeta,
  });

  if (volumeMeta.formingCandle === true) {
    const supportDefenseDeveloping =
      participationEvaluationDirection === "LONG" &&
      engine3GateSatisfied &&
      constructive === true;

    const sellerFailureDeveloping =
      participationEvaluationDirection === "LONG" &&
      engine3GateSatisfied &&
      reactionState.includes("SELLER_FAILURE");

    return finalizeResult({
      ...result,
      participationDeveloping:
        engine3GateSatisfied || constructive === true,
      participationConfirmed: false,
      participationState: STATES.FORMING,
      status: STATES.FORMING,
      participationQuality: "PROVISIONAL",
      supportDefenseDeveloping,
      sellerFailureParticipationDeveloping: sellerFailureDeveloping,
      hardBlocked: false,
      allowed: false,
      confirmed: false,
      direction: "NEUTRAL",
      reasonCodes: unique([
        ...result.reasonCodes,
        "FORMING_CANDLE_PARTICIPATION_DEVELOPING",
        "RAW_FORMING_VOLUME_RATIO_DIAGNOSTIC_ONLY",
        volumeMeta.rawCurrentVsPriorVolumeRatio != null ? "RAW_VOLUME_RATIO_RETAINED_DIAGNOSTIC" : null,
        "ENGINE6_FINAL_PERMISSION_REQUIRED",
      ]),
    });
  }

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
