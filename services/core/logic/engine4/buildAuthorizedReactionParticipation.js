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

const ENGINE = "engine4.authorizedReactionParticipation.v1";
const PARTICIPATION_CONTRACT_VERSION = "engine4.strategy1.v1";
const STRATEGY_1_SETUP_CLASS = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

const STATES = {
  WAITING: "PARTICIPATION_WAITING",
  FORMING: "FORMING_CANDLE_PARTICIPATION_DEVELOPING",
  CONFIRMED: "PARTICIPATION_CONFIRMED",
  ADVERSE: "ADVERSE_PARTICIPATION_BLOCKED",
  INVALIDATED: "CANDIDATE_INVALIDATED",
  IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
};

function safeUpper(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text ? text.toUpperCase() : fallback;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function clonePlain(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  return JSON.parse(JSON.stringify(value));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
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

function normalizeCandle(bar = null) {
  if (!bar || typeof bar !== "object") {
    return {
      open: null,
      high: null,
      low: null,
      close: null,
      volume: null,
      time: null,
      completed: null,
      isClosed: null,
      candleClosed: null,
    };
  }

  const completed =
    bar.completed === true ||
    bar.isClosed === true ||
    bar.candleClosed === true ||
    bar.closed === true;

  const explicitOpen =
    bar.completed === false ||
    bar.isClosed === false ||
    bar.candleClosed === false ||
    bar.closed === false;

  return {
    open: toNum(bar.open ?? bar.o),
    high: toNum(bar.high ?? bar.h),
    low: toNum(bar.low ?? bar.l),
    close: toNum(bar.close ?? bar.c),
    volume: toNum(bar.volume ?? bar.v),
    time: bar.time ?? bar.t ?? bar.tSec ?? null,
    completed: explicitOpen ? false : completed ? true : null,
    isClosed: explicitOpen ? false : completed ? true : null,
    candleClosed: explicitOpen ? false : completed ? true : null,
  };
}

function resolveCurrentCandleClosed({ reaction, tacticalParticipation, currentCandle }) {
  if (reaction?.candleClosed === true || reaction?.currentCandleClosed === true) return true;
  if (reaction?.candleClosed === false || reaction?.currentCandleClosed === false) return false;
  if (reaction?.earlySignal === true) return false;

  if (tacticalParticipation?.currentCandleClosed === true) return true;
  if (tacticalParticipation?.currentCandleClosed === false) return false;

  if (currentCandle?.candleClosed === true) return true;
  if (currentCandle?.candleClosed === false) return false;

  return null;
}

function resolvePriorBarCompleted({ reaction, priorCandle }) {
  if (reaction?.priorCandleCompleted === true) return true;
  if (reaction?.priorCandleCompleted === false) return false;
  if (priorCandle?.candleClosed === true || priorCandle?.completed === true || priorCandle?.isClosed === true) return true;
  if (priorCandle?.candleClosed === false || priorCandle?.completed === false || priorCandle?.isClosed === false) return false;

  return null;
}

function resolveCandles(reaction, tacticalParticipation) {
  const currentRaw =
    reaction?.currentCandle ||
    reaction?.lastCandle ||
    reaction?.currentLevelAction?.lastCandle ||
    reaction?.fastImbalanceReaction?.lastCandle ||
    tacticalParticipation?.lastCandle ||
    null;

  const priorRaw =
    reaction?.priorCandle ||
    reaction?.currentLevelAction?.priorCandle ||
    reaction?.fastImbalanceReaction?.priorCandle ||
    tacticalParticipation?.priorCandle ||
    null;

  const currentCandle = normalizeCandle(currentRaw);
  const priorCandle = normalizeCandle(priorRaw);

  const currentCandleClosed = resolveCurrentCandleClosed({
    reaction,
    tacticalParticipation,
    currentCandle,
  });

  const priorBarCompleted = resolvePriorBarCompleted({
    reaction,
    priorCandle,
  });

  return {
    currentCandle,
    priorCandle,
    currentCandleClosed,
    priorBarCompleted,
    formingCandle: currentCandleClosed === false,
    completionKnown: currentCandleClosed !== null,
  };
}

function computeVolumeMetadata({ reaction, tacticalParticipation }) {
  const { currentCandle, priorCandle, currentCandleClosed, priorBarCompleted, formingCandle, completionKnown } =
    resolveCandles(reaction, tacticalParticipation);

  const currentBarVolume =
    toNum(tacticalParticipation?.currentBarVolume) ?? currentCandle.volume;

  const priorBarVolume =
    toNum(tacticalParticipation?.priorBarVolume) ?? priorCandle.volume;

  const rawCurrentVsPriorVolumeRatio =
    currentBarVolume != null && priorBarVolume != null && priorBarVolume > 0
      ? round(currentBarVolume / priorBarVolume, 2)
      : null;

  const formingCandleComparisonValid =
    currentCandleClosed === true && priorBarCompleted === true;

  return {
    currentCandle,
    priorCandle,
    currentCandleClosed,
    currentBarCompleted: currentCandleClosed,
    priorBarCompleted,
    formingCandle,
    completionKnown,
    sourceTimeframe: reaction?.sourceTimeframe || reaction?.reactionTimeframe || null,
    volumeTimeframe: reaction?.sourceTimeframe || reaction?.reactionTimeframe || null,
    supportingBarTime: reaction?.supportingBarTime ?? currentCandle?.time ?? null,
    evaluationTimeMs: reaction?.evaluationTimeMs ?? null,
    currentCandleStatus: reaction?.currentCandleStatus || null,
    priorCandleStatus: reaction?.priorCandleStatus || null,
    candleSourceFresh: reaction?.candleSourceFresh === true,
    currentCandleElapsedSeconds: null,
    currentBarVolume,
    priorBarVolume,
    rawCurrentVsPriorVolumeRatio,
    currentVsPriorVolumeRatio: rawCurrentVsPriorVolumeRatio,
    normalizedVolumeRatio: null,
    volumeComparisonMethod: formingCandle
      ? "FORMING_CURRENT_TO_COMPLETED_PRIOR_RAW_DIAGNOSTIC_ONLY"
      : formingCandleComparisonValid
      ? "COMPLETED_CURRENT_TO_COMPLETED_PRIOR_RAW_RATIO"
      : "COMPLETION_UNKNOWN_RAW_DIAGNOSTIC_ONLY",
    formingCandleComparisonValid,
  };
}

function resolveIdentity({ reaction, engine26LocationCandidate = null, engine26ReactionHandoff = null }) {
  const candidateId = pickFirst(
    reaction?.candidateId,
    reaction?.engine26LocationContext?.candidateId,
    engine26ReactionHandoff?.candidateId,
    engine26LocationCandidate?.candidateId
  );

  const zoneId = pickFirst(
    reaction?.zoneId,
    reaction?.engine26LocationContext?.zoneId,
    engine26ReactionHandoff?.zoneId,
    engine26LocationCandidate?.zoneId
  );

  const laneId = pickFirst(
    reaction?.laneId,
    reaction?.engine26LocationContext?.laneId,
    engine26ReactionHandoff?.laneId,
    engine26LocationCandidate?.laneId,
    "minute"
  );

  const strategyId = pickFirst(
    reaction?.strategyId,
    reaction?.engine26LocationContext?.strategyId,
    engine26ReactionHandoff?.strategyId,
    engine26LocationCandidate?.strategyId,
    "intraday_scalp@10m"
  );

  const symbol = pickFirst(
    reaction?.symbol,
    reaction?.engine26LocationContext?.symbol,
    engine26ReactionHandoff?.symbol,
    engine26LocationCandidate?.symbol,
    "ES"
  );

  const setupClass = pickFirst(
    reaction?.setupClass,
    reaction?.engine26LocationContext?.setupClass,
    engine26ReactionHandoff?.setupClass,
    engine26LocationCandidate?.setupClass,
    STRATEGY_1_SETUP_CLASS
  );

  const setupGrade = pickFirst(
    reaction?.setupGrade,
    reaction?.engine26LocationContext?.setupGrade,
    engine26ReactionHandoff?.setupGrade,
    engine26LocationCandidate?.setupGrade,
    "A+++"
  );

  const identitySetupKey = pickFirst(
    reaction?.identitySetupKey,
    reaction?.engine26LocationContext?.identitySetupKey,
    engine26ReactionHandoff?.identitySetupKey,
    engine26LocationCandidate?.identitySetupKey,
    setupClass
  );

  const candidateIdentityVersion = pickFirst(
    reaction?.candidateIdentityVersion,
    reaction?.engine26LocationContext?.candidateIdentityVersion,
    engine26ReactionHandoff?.candidateIdentityVersion,
    engine26LocationCandidate?.candidateIdentityVersion,
    "engine26.strategy1.v1"
  );

  const comparedCandidateId = engine26LocationCandidate?.candidateId || engine26ReactionHandoff?.candidateId || null;
  const comparedZoneId = engine26LocationCandidate?.zoneId || engine26ReactionHandoff?.zoneId || null;

  const missing = [];
  if (!candidateId) missing.push("CANDIDATE_ID_MISSING");
  if (!zoneId) missing.push("ZONE_ID_MISSING");
  if (!laneId) missing.push("LANE_ID_MISSING");
  if (!strategyId) missing.push("STRATEGY_ID_MISSING");

  const mismatches = [];
  if (comparedCandidateId && candidateId && comparedCandidateId !== candidateId) {
    mismatches.push("CANDIDATE_ID_MISMATCH");
  }
  if (comparedZoneId && zoneId && comparedZoneId !== zoneId) {
    mismatches.push("ZONE_ID_MISMATCH");
  }
  if (laneId && laneId !== "minute") mismatches.push("LANE_ID_MISMATCH");
  if (strategyId && strategyId !== "intraday_scalp@10m") mismatches.push("STRATEGY_ID_MISMATCH");

  return {
    laneId,
    strategyId,
    candidateId,
    zoneId,
    symbol,
    setupClass,
    setupGrade,
    identitySetupKey,
    candidateIdentityVersion,
    identityMissing: missing.length > 0,
    identityMismatch: mismatches.length > 0,
    identityMissingCodes: missing,
    identityMismatchCodes: mismatches,
  };
}

function resolveReactionState(reaction) {
  return safeUpper(
    reaction?.reactionState ||
      reaction?.authorizedReactionState ||
      reaction?.state ||
      reaction?.fastReactionState ||
      "NO_REACTION",
    "NO_REACTION"
  );
}

function resolveEvaluationAuthorized(reaction) {
  return (
    reaction?.evaluationAuthorized === true ||
    reaction?.authorizeEngine3Evaluation === true ||
    reaction?.authorized === true ||
    false
  );
}

function resolveReactionConfirmed(reaction) {
  return (
    reaction?.reactionConfirmed === true ||
    (
      reaction?.confirmed === true &&
      safeUpper(reaction?.authorizedReactionState || reaction?.reactionState || reaction?.state) === "REACTION_CONFIRMED"
    ) ||
    false
  );
}

function resolveParticipationEvaluationEligibility(reaction) {
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

function resolveDirection(reaction, tacticalParticipation) {
  return safeUpper(
    reaction?.direction ||
      reaction?.tradeDirectionBias ||
      tacticalParticipation?.intendedDirection ||
      tacticalParticipation?.direction ||
      "NEUTRAL",
    "NEUTRAL"
  );
}

function resolveQuality(reaction, tacticalParticipation) {
  return safeUpper(
    reaction?.quality ||
      tacticalParticipation?.participationQuality ||
      tacticalParticipation?.quality ||
      "WEAK",
    "WEAK"
  );
}


function resolvePromotedContactContext({
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

function resolveParticipationEvaluationDirection({
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

function buildPlainEnglishLines(result) {
  const lines = [];
  const state = safeUpper(result?.participationState, STATES.WAITING);
  const quality = safeUpper(result?.participationQuality, "WEAK");
  const expectedParticipationDirection = safeUpper(
    result?.expectedParticipationDirection,
    ""
  );

  lines.push("Engine 4 is watching volume.");

  if (quality === "RISK" || result?.hardBlocked === true) {
    lines.push("Volume participation is adverse enough to block the setup.");
  } else if (quality === "PROVISIONAL" || state === STATES.FORMING) {
    lines.push("Volume participation is developing, but it is not confirmed yet.");
  } else if (["GOOD", "STRONG"].includes(quality) || result?.participationConfirmed === true) {
    lines.push("Volume participation is confirmed for Engine 6 review.");
  } else {
    lines.push("Volume is weak right now.");
  }

  if (result?.hardBlocked === true) {
    lines.push("Engine 4 is blocking only because valid adverse evidence is present.");
  } else {
    lines.push("Engine 4 is not killing the setup.");
  }

  if (
    result?.participationEvaluationEligible !== true &&
    result?.reactionConfirmed !== true
  ) {
    // Preserve the established Phase 3 timeline wording for compatibility.
    lines.push("Engine 4 is waiting because Engine 3 reaction is not confirmed.");
  } else if (result?.participationConfirmed !== true) {
    lines.push("Engine 4 is waiting for participation to confirm.");
  } else if (result?.allowed === true) {
    lines.push("Engine 4 participation is acceptable for Engine 6 review only.");
  }

  if (
    result?.contactState === "NEGOTIATED_LINE_CONTACT" &&
    expectedParticipationDirection === "SHORT"
  ) {
    lines.push("Strategy 1 remains neutral while Engine 4 watches SHORT-side seller participation.");
  }

  lines.push("No permission. No execution.");

  return lines;
}

function finalizeResult(result) {
  const plainEnglishLines = buildPlainEnglishLines(result);

  return {
    ...result,
    plainEnglishLines,
    timelinePlainEnglish: plainEnglishLines.join(" "),
  };
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

  const red = current.open != null && current.close != null && current.close < current.open;
  const green = current.open != null && current.close != null && current.close > current.open;
  const lowerClose = current.close != null && prior.close != null && current.close < prior.close;
  const higherClose = current.close != null && prior.close != null && current.close > prior.close;

  const volumeExpansion = tacticalParticipation?.volumeExpansion === true;
  const adverseAbsorption =
    (tacticalParticipation?.absorptionRisk === true || tacticalParticipation?.absorptionHardBlock === true) &&
    tacticalParticipation?.supportsDirection !== true;

  const highVolumeNoProgress =
    tacticalParticipation?.highVolumeNoProgress === true &&
    tacticalParticipation?.supportsDirection !== true;

  if (direction === "LONG") {
    return (
      completedZoneLossAgainstLong({ reaction, volumeMeta }) ||
      (red && lowerClose && volumeExpansion) ||
      adverseAbsorption ||
      highVolumeNoProgress ||
      safeUpper(tacticalParticipation?.participationState).includes("VOLUME_RISK")
    );
  }

  if (direction === "SHORT") {
    return (
      (green && higherClose && volumeExpansion) ||
      adverseAbsorption ||
      highVolumeNoProgress ||
      safeUpper(tacticalParticipation?.participationState).includes("VOLUME_RISK")
    );
  }

  return false;
}

function baseResult({
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

    participationObservation: true,
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
