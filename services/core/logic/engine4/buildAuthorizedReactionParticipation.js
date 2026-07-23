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

  // Prior candle is normally completed when Engine 3 sends a current/prior pair.
  // Preserve this as a conservative factual default for ratio diagnostics.
  return true;
}

function resolveCandles(reaction, tacticalParticipation) {
  const currentRaw =
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

function baseResult({ reaction, identity, volumeMeta, direction, quality, reactionState, evaluationAuthorized, reactionConfirmed }) {
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

    evaluationAuthorized,
    reactionConfirmed,
    reactionState,

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
    return {
      active: false,
      engine: ENGINE,
      canonical: true,
      mode: "PAPER_ONLY",
      participationContractVersion: PARTICIPATION_CONTRACT_VERSION,
      participationObservation: false,
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
    };
  }

  const identity = resolveIdentity({ reaction, engine26LocationCandidate, engine26ReactionHandoff });
  const reactionState = resolveReactionState(reaction);
  const evaluationAuthorized = resolveEvaluationAuthorized(reaction);
  const reactionConfirmed = resolveReactionConfirmed(reaction);
  const direction = resolveDirection(reaction, tacticalParticipation);
  const quality = resolveQuality(reaction, tacticalParticipation);
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
  });

  result.relativeVolume = toNum(tacticalParticipation?.relativeVolume);
  result.volumeTrend = tacticalParticipation?.volumeTrend || null;
  result.volumeExpansion = tacticalParticipation?.volumeExpansion === true;
  result.volumeConfirmed = tacticalParticipation?.volumeConfirmed === true;

  if (identity.identityMismatch) {
    return {
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
    };
  }

  if (identity.identityMissing) {
    return {
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
    };
  }

  if (isCandidateInvalidated(reaction)) {
    return {
      ...result,
      participationState: STATES.INVALIDATED,
      status: STATES.INVALIDATED,
      participationQuality: "RISK",
      hardBlocked: true,
      downgradeOnly: false,
      blockers: ["CANDIDATE_INVALIDATED"],
      reasonCodes: unique([...result.reasonCodes, "CANDIDATE_INVALIDATED"]),
    };
  }

  if (evaluationAuthorized !== true) {
    return {
      ...result,
      participationState: STATES.WAITING,
      status: STATES.WAITING,
      participationQuality: "WEAK",
      blockers: ["ENGINE3_EVALUATION_NOT_AUTHORIZED"],
      reasonCodes: unique([...result.reasonCodes, "ENGINE3_EVALUATION_NOT_AUTHORIZED", "PARTICIPATION_WAITING"]),
    };
  }

  const adverseCompleted = completedAdverseEvidence({ reaction, direction, tacticalParticipation, volumeMeta });

  if (reactionConfirmed === true && adverseCompleted === true) {
    return {
      ...result,
      participationState: STATES.ADVERSE,
      status: STATES.ADVERSE,
      participationQuality: "RISK",
      hardBlocked: true,
      downgradeOnly: false,
      blockers: ["VALID_COMPLETED_ADVERSE_PARTICIPATION"],
      reasonCodes: unique([...result.reasonCodes, "VALID_COMPLETED_ADVERSE_PARTICIPATION", "ADVERSE_PARTICIPATION_BLOCKED"]),
    };
  }

  const constructive = isConstructiveParticipation({
    direction,
    reactionState,
    quality,
    tacticalParticipation,
    volumeMeta,
  });

  if (volumeMeta.formingCandle === true) {
    const supportDefenseDeveloping = direction === "LONG" && reactionConfirmed === true && constructive === true;
    const sellerFailureDeveloping = direction === "LONG" && reactionConfirmed === true && reactionState.includes("SELLER_FAILURE");

    return {
      ...result,
      participationDeveloping: reactionConfirmed === true || constructive === true,
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
    };
  }

  if (reactionConfirmed !== true) {
    return {
      ...result,
      participationDeveloping: constructive === true,
      participationConfirmed: false,
      participationState: constructive ? STATES.FORMING : STATES.WAITING,
      status: constructive ? STATES.FORMING : STATES.WAITING,
      participationQuality: constructive ? "PROVISIONAL" : "WEAK",
      allowed: false,
      confirmed: false,
      hardBlocked: false,
      blockers: constructive ? [] : ["ENGINE3_REACTION_NOT_CONFIRMED"],
      reasonCodes: unique([
        ...result.reasonCodes,
        constructive ? "DEVELOPING_PARTICIPATION_REACTION_NOT_CONFIRMED" : "ENGINE3_REACTION_NOT_CONFIRMED",
      ]),
    };
  }

  if (constructive) {
    const supportDefenseConfirmed = direction === "LONG";
    const sellerFailureConfirmed = direction === "LONG" && reactionState.includes("SELLER_FAILURE");

    return {
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
      direction,
      reasonCodes: unique([
        ...result.reasonCodes,
        "PARTICIPATION_CONFIRMED",
        "ENGINE4_AUTHORIZED_PARTICIPATION_CONFIRMED",
        "ALLOWED_FOR_ENGINE6_REVIEW_ONLY",
      ]),
    };
  }

  return {
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
  };
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
