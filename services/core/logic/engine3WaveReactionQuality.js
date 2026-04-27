// services/core/logic/engine3WaveReactionQuality.js

function clampScore(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function safeUpper(value, fallback = "") {
  return String(value ?? fallback).toUpperCase();
}

function getNumericReactionScore(reactionScore) {
  if (typeof reactionScore === "number") return reactionScore;
  if (reactionScore && typeof reactionScore.reactionScore === "number") {
    return reactionScore.reactionScore;
  }
  return null;
}

export function computeEngine3WaveReactionQuality({
  engine16,
  reactionScore,
  structureState,
  reasonCodes = [],
} = {}) {
  if (!engine16 || engine16.unavailable) {
    return {
      reactionState: "UNKNOWN",
      reactionQualityScore: null,
      unavailable: true,
      buyerAbsorption: false,
      sellerAbsorption: false,
      distributionWarning: false,
      accumulationWarning: false,
      momentumFading: false,
      extensionRisk: false,
      failedContinuation: false,
      acceptedAtHighs: false,
      acceptedAtLows: false,
      traderMessage: "Engine 16 context is unavailable, so wave reaction quality cannot be scored.",
      evidence: ["ENGINE16_UNAVAILABLE"],
      waveContextUsed: null,
    };
  }

  const waveContext = engine16.waveContext || {};

  const strategyType = safeUpper(engine16.strategyType);
  const executionBias = safeUpper(engine16.executionBias);
  const trendState1h = safeUpper(engine16.trendState_1h);
  const trendState4h = safeUpper(engine16.trendState_4h);
  const wave3Status = safeUpper(engine16.wave3Status);
  const waveState = safeUpper(waveContext.waveState);
  const minorPhase = safeUpper(waveContext.minorPhase);
  const primaryPhase = safeUpper(waveContext.primaryPhase);
  const intermediatePhase = safeUpper(waveContext.intermediatePhase);

  const numericReactionScore = getNumericReactionScore(reactionScore);

  const evidence = [];

  let score = 70;

  if (strategyType === "EXHAUSTION") {
    score -= 20;
    evidence.push("ENGINE16_EXHAUSTION");
  }

  if (executionBias === "SHORT_ONLY" && waveState === "TRENDING_IMPULSE") {
    score -= 15;
    evidence.push("SHORT_TIMING_AGAINST_ACTIVE_IMPULSE");
  }

  if (trendState1h && trendState4h && trendState1h !== trendState4h) {
    score -= 15;
    evidence.push("ONE_HOUR_FOUR_HOUR_CONFLICT");
  }

  if (
    minorPhase === "IN_W3" &&
    (primaryPhase === "IN_W5" || intermediatePhase === "IN_W5")
  ) {
    score -= 10;
    evidence.push("LATE_WAVE_EXTENSION_RISK");
  }

  if (numericReactionScore != null && numericReactionScore < 4) {
    score -= 10;
    evidence.push("LOW_ENGINE3_REACTION_SCORE");
  }

  const reactionQualityScore = clampScore(score);

  const momentumFading =
    strategyType === "EXHAUSTION" ||
    trendState1h === "SHORT_ONLY" ||
    wave3Status === "FIRST_WARNING";

  const extensionRisk =
    minorPhase === "IN_W3" &&
    (primaryPhase === "IN_W5" || intermediatePhase === "IN_W5");

  const distributionWarning =
    (momentumFading && extensionRisk) ||
    (strategyType === "EXHAUSTION" && trendState4h === "LONG_ONLY");

  const failedContinuation =
    strategyType === "EXHAUSTION" &&
    trendState1h === "SHORT_ONLY" &&
    trendState4h === "SHORT_ONLY";

  const buyerAbsorption =
    distributionWarning ||
    (strategyType === "EXHAUSTION" && executionBias === "SHORT_ONLY");

  const sellerAbsorption = false;

  const accumulationWarning = false;

  const acceptedAtHighs =
    distributionWarning && waveState === "TRENDING_IMPULSE";

  const acceptedAtLows = false;

  let reactionState = "HEALTHY_PULLBACK";

  if (failedContinuation) {
    reactionState = "FAILED_CONTINUATION";
  } else if (strategyType === "EXHAUSTION" && executionBias === "SHORT_ONLY") {
    reactionState = "REVERSAL_PRESSURE";
  } else if (
    waveState === "TRENDING_IMPULSE" &&
    minorPhase === "IN_W3" &&
    trendState1h === "SHORT_ONLY" &&
    trendState4h === "LONG_ONLY"
  ) {
    reactionState = "DISTRIBUTION_WARNING";
  } else if (distributionWarning) {
    reactionState = "DISTRIBUTION_WARNING";
  } else if (momentumFading) {
    reactionState = "WEAKENING_REACTION";
  } else if (reactionQualityScore >= 70) {
    reactionState = "STRONG_REACTION";
  }

  let traderMessage = "Reaction remains healthy. Trend and timing are aligned; continuation quality is acceptable.";

  if (reactionState === "REVERSAL_PRESSURE") {
    traderMessage =
      "Short-term momentum is fading inside a larger active impulse. 4H trend may still be intact, but late-wave extension risk is elevated. Do not chase longs; shorts need stronger confirmation.";
  } else if (reactionState === "DISTRIBUTION_WARNING") {
    traderMessage =
      "Price is showing distribution risk near late-wave structure. Momentum is weakening, but this is not yet a full failed continuation.";
  } else if (reactionState === "FAILED_CONTINUATION") {
    traderMessage =
      "Continuation has failed across timing and structure. Reversal pressure is active.";
  } else if (reactionState === "WEAKENING_REACTION") {
    traderMessage =
      "Reaction quality is weakening. Continuation may still be possible, but momentum is no longer clean.";
  }

  return {
    reactionState,
    reactionQualityScore,
    unavailable: false,

    buyerAbsorption,
    sellerAbsorption,

    distributionWarning,
    accumulationWarning,

    momentumFading,
    extensionRisk,
    failedContinuation,

    acceptedAtHighs,
    acceptedAtLows,

    traderMessage,
    evidence,
    waveContextUsed: {
      wave3Status: engine16.wave3Status ?? null,
      waveState: waveContext.waveState ?? null,
      minorPhase: waveContext.minorPhase ?? null,
      primaryPhase: waveContext.primaryPhase ?? null,
      intermediatePhase: waveContext.intermediatePhase ?? null,
      strategyType: engine16.strategyType ?? null,
      executionBias: engine16.executionBias ?? null,
      trendState_1h: engine16.trendState_1h ?? null,
      trendState_4h: engine16.trendState_4h ?? null,
      structureState: structureState ?? null,
      reasonCodes,
    },
  };
}
