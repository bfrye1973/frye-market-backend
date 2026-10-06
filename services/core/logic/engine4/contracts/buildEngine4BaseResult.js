// Engine 4 canonical base output contract.
// Extracted without behavior changes in Phase B3.

import { safeUpper } from "./inputUtils.js";

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

export function baseResult({
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
}) {
  return {
    active: true,
    engine: ENGINE,
    source: "confluence.context.reaction.paperScalpReaction",
    canonical: true,
    mode: "PAPER_ONLY",
    paperOnly: true,
    researchOnly: true,

    laneId: identity.laneId,
    strategyId: identity.strategyId,
    candidateId: identity.candidateId,
    zoneId: identity.zoneId,
    symbol: identity.symbol,
    setupClass: identity.setupClass,
    setupGrade: identity.setupGrade,
    identitySetupKey: identity.identitySetupKey,
    candidateIdentityVersion: identity.candidateIdentityVersion,
    participationContractVersion: PARTICIPATION_CONTRACT_VERSION,

    armed: promotedContext?.armed === true,
    chainArmed: promotedContext?.chainArmed === true,
    contactState: promotedContext?.contactState || null,
    directionState: promotedContext?.directionState || null,
    expectedReactionDirection:
      promotedContext?.expectedReactionDirection || null,
    expectedParticipationDirection:
      promotedContext?.expectedParticipationDirection || null,
    expectedReversalDirection:
      promotedContext?.expectedReversalDirection || null,
    participationEvaluationDirection,
    promotedContactActive:
      promotedContext?.promotedContactActive === true,
    priorCandidateId: promotedContext?.priorCandidateId || null,
    priorZoneId: promotedContext?.priorZoneId || null,
    priorRotationDirection:
      promotedContext?.priorRotationDirection || null,
    priorRotationCompletionState:
      promotedContext?.priorRotationCompletionState || null,
    priorRotationFullyComplete:
      promotedContext?.priorRotationFullyComplete === true,
    promotedFromTargetCompletion:
      promotedContext?.promotedFromTargetCompletion === true,
    promotionReason: promotedContext?.promotionReason || null,

    evaluationAuthorized,
    reactionConfirmed,
    reactionState,

    participationEvaluationEligible:
      participationEligibility?.eligible === true,

    participationEvaluationEligibilityPublished:
      participationEligibility?.explicitlyPublished === true,

    qualifiedParticipationEvaluation:
      participationEligibility?.eligible === true &&
      ["LONG", "SHORT"].includes(
        safeUpper(participationEvaluationDirection, "NEUTRAL")
      ),

    observerActive: volumeMeta.observerActive,
    observationStatus: volumeMeta.observationStatus,
    participationObservation: volumeMeta.observerActive === true,
    observation1mActive: volumeMeta.observation1mActive,
    observation1mStale: volumeMeta.observation1mStale,
    observation1mTimeframe: volumeMeta.observation1mTimeframe,
    observation1mState: volumeMeta.observation1mState,
    observation1mDirection: volumeMeta.observation1mDirection,
    observation1mQuality: volumeMeta.observation1mQuality,
    observation1mCurrentVolume: volumeMeta.observation1mCurrentVolume,
    observation1mPriorVolume: volumeMeta.observation1mPriorVolume,
    observation1mVolumeRatio: volumeMeta.observation1mVolumeRatio,
    observation1mCurrentCandleStatus: volumeMeta.observation1mCurrentCandleStatus,
    observation1mPriorCandleStatus: volumeMeta.observation1mPriorCandleStatus,
    observation1mSupportingBarTime: volumeMeta.observation1mSupportingBarTime,
    currentVolumeReaction: volumeMeta.currentVolumeReaction,
    observationReasonCodes: clonePlain(volumeMeta.observationReasonCodes),

    validation5mActive: volumeMeta.validation5mActive,
    validation5mState: volumeMeta.validation5mState,
    validation5mDirection: volumeMeta.validation5mDirection,
    validation5mQuality: volumeMeta.validation5mQuality,
    validation5mTimeframe: volumeMeta.validation5mTimeframe,
    validation5mSupportingBarTime: volumeMeta.validation5mSupportingBarTime,
    validation5mCurrentVolume: volumeMeta.validation5mCurrentVolume,
    validation5mPriorVolume: volumeMeta.validation5mPriorVolume,
    validation5mCurrentCandleStatus: volumeMeta.validation5mCurrentCandleStatus,
    validation5mPriorCandleStatus: volumeMeta.validation5mPriorCandleStatus,
    validation5mStale: volumeMeta.validation5mStale,

    broader10mActive: volumeMeta.broader10mActive,
    broader10mTimeframe: volumeMeta.broader10mTimeframe,
    broader10mRelativeVolume: volumeMeta.broader10mRelativeVolume,
    broader10mVolumeTrend: volumeMeta.broader10mVolumeTrend,
    broader10mVolumeExpansion: volumeMeta.broader10mVolumeExpansion,
    broader10mVolumeConfirmed: volumeMeta.broader10mVolumeConfirmed,
    broader10mHighVolumeCandles: volumeMeta.broader10mHighVolumeCandles,
    broader10mParticipationState: volumeMeta.broader10mParticipationState,
    broader10mParticipationQuality: volumeMeta.broader10mParticipationQuality,

    participationDeveloping: false,
    participationConfirmed: false,
    participationState: STATES.WAITING,
    participationQuality: "WEAK",

    direction: "NEUTRAL",
    intendedDirection: direction,
    quality,

    formingCandle: volumeMeta.formingCandle,
    currentCandleClosed: volumeMeta.currentCandleClosed,
    currentBarCompleted: volumeMeta.currentBarCompleted,
    priorBarCompleted: volumeMeta.priorBarCompleted,
    completionKnown: volumeMeta.completionKnown,
    currentCandleElapsedSeconds: volumeMeta.currentCandleElapsedSeconds,
    reactionTimeframe: reaction?.reactionTimeframe || null,
    sourceTimeframe: volumeMeta.sourceTimeframe,
    volumeTimeframe: volumeMeta.volumeTimeframe,
    supportingBarTime: volumeMeta.supportingBarTime,
    evaluationTimeMs: volumeMeta.evaluationTimeMs,
    currentCandleStatus: volumeMeta.currentCandleStatus,
    priorCandleStatus: volumeMeta.priorCandleStatus,
    candleSourceFresh: volumeMeta.candleSourceFresh,

    currentBarVolume: volumeMeta.currentBarVolume,
    priorBarVolume: volumeMeta.priorBarVolume,
    currentVolume: volumeMeta.currentBarVolume,
    priorCompletedVolume: volumeMeta.priorBarVolume,
    rawCurrentVsPriorVolumeRatio: volumeMeta.rawCurrentVsPriorVolumeRatio,
    rawVolumeRatio: volumeMeta.rawCurrentVsPriorVolumeRatio,
    currentVsPriorVolumeRatio: volumeMeta.currentVsPriorVolumeRatio,
    normalizedVolumeRatio: volumeMeta.normalizedVolumeRatio,
    volumeComparisonMethod: volumeMeta.volumeComparisonMethod,
    formingCandleComparisonValid: volumeMeta.formingCandleComparisonValid,

    relativeVolume: null,
    volumeTrend: null,
    volumeExpansion: false,
    volumeConfirmed: false,

    supportDefenseDeveloping: false,
    supportDefenseConfirmed: false,
    sellerFailureParticipationDeveloping: false,
    sellerFailureParticipationConfirmed: false,

    allowed: false,
    confirmed: false,
    hardBlocked: false,
    downgradeOnly: true,
    status: STATES.WAITING,

    requiresEngine6Permission: true,
    requiresEngine6PaperApproval: true,
    noPermissionCreated: true,
    noRealPermissionCreated: true,
    noExecution: true,
    realExecutionAuthority: false,
    executable: false,

    entryZone: clonePlain(reaction?.entryZone || null),
    targetZone: clonePlain(reaction?.targetZone || null),
    sweepFacts: clonePlain(reaction?.sweepFacts || null),
    lowerWickFacts: clonePlain(reaction?.lowerWickFacts || null),
    reclaimFacts: clonePlain(reaction?.reclaimFacts || null),
    postReclaimFacts: clonePlain(reaction?.postReclaimFacts || null),
    invalidationFacts: clonePlain(reaction?.invalidationFacts || null),
    zoneMemorySummary: clonePlain(reaction?.zoneMemorySummary || null),

    lastCandle: clonePlain(volumeMeta.currentCandle),
    priorCandle: clonePlain(volumeMeta.priorCandle),

    blockers: [],
    reasonCodes: [
      "ENGINE4_AUTHORIZED_REACTION_PARTICIPATION",
      "PAPER_ONLY_RESEARCH_LANE",
      "ENGINE3_CANDIDATE_AWARE_REACTION_CONSUMED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ],
  };
}
