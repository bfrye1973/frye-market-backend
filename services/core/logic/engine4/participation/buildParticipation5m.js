import { safeUpper } from "../contracts/inputUtils.js";
import { toNum, round, unique } from "../contracts/valueUtils.js";

const STATES = {
  SUPPORTIVE: "SUPPORTIVE",
  UNRESOLVED: "UNRESOLVED",
  ADVERSE: "ADVERSE",
};

function candleDirection(candle) {
  const open = toNum(candle?.open ?? candle?.o);
  const close = toNum(candle?.close ?? candle?.c);

  if (open == null || close == null) return "NEUTRAL";
  if (close > open) return "LONG";
  if (close < open) return "SHORT";
  return "NEUTRAL";
}

function progressDirection(currentCandle, priorCandle) {
  const currentClose = toNum(currentCandle?.close ?? currentCandle?.c);
  const priorClose = toNum(priorCandle?.close ?? priorCandle?.c);

  if (currentClose == null || priorClose == null) return "NEUTRAL";
  if (currentClose > priorClose) return "LONG";
  if (currentClose < priorClose) return "SHORT";
  return "NEUTRAL";
}

function oppositeDirection(direction) {
  if (direction === "LONG") return "SHORT";
  if (direction === "SHORT") return "LONG";
  return "NEUTRAL";
}

export function buildParticipation5m(reaction) {
  const source =
    reaction?.reactionValidation5m &&
    typeof reaction.reactionValidation5m === "object"
      ? reaction.reactionValidation5m
      : null;

  const canonicalDirection = safeUpper(reaction?.direction, "NEUTRAL");
  const sourceTimeframe = source?.sourceTimeframe || null;
  const stale = source?.stale === true;
  const active = source?.active === true;

  const candidateMismatch =
    reaction?.candidateId != null &&
    source?.candidateId != null &&
    reaction.candidateId !== source.candidateId;

  const zoneMismatch =
    reaction?.zoneId != null &&
    source?.zoneId != null &&
    reaction.zoneId !== source.zoneId;

  const sourceValid =
    active === true &&
    stale !== true &&
    sourceTimeframe === "5m" &&
    candidateMismatch !== true &&
    zoneMismatch !== true;

  const currentCandle = source?.currentCandle || null;
  const priorCandle = source?.priorCandle || null;

  const currentCandleStatus = safeUpper(
    source?.currentCandleStatus || source?.candleState,
    "COMPLETION_UNKNOWN"
  );

  const priorCandleStatus = safeUpper(
    source?.priorCandleStatus,
    priorCandle ? "COMPLETED" : "COMPLETION_UNKNOWN"
  );

  const completed =
    sourceValid === true &&
    currentCandleStatus === "COMPLETED" &&
    priorCandleStatus === "COMPLETED";

  const currentVolume = toNum(currentCandle?.volume);
  const priorVolume = toNum(priorCandle?.volume);

  const currentVsPriorVolumeRatio =
    currentVolume != null &&
    priorVolume != null &&
    priorVolume > 0
      ? round(currentVolume / priorVolume, 2)
      : null;

  const currentDirection = candleDirection(currentCandle);
  const priceProgressDirection = progressDirection(currentCandle, priorCandle);
  const opposite = oppositeDirection(canonicalDirection);

  // Reuse established Engine 4 volume thresholds rather than inventing a
  // second scale: <0.90 is weak, >=1.15 improving, >=1.25 expanding,
  // >=1.50 strong expansion.
  const volumeWeak =
    currentVsPriorVolumeRatio != null &&
    currentVsPriorVolumeRatio < 0.9;

  const participationImproving =
    currentVsPriorVolumeRatio != null &&
    currentVsPriorVolumeRatio >= 1.15;

  const volumeExpansion =
    currentVsPriorVolumeRatio != null &&
    currentVsPriorVolumeRatio >= 1.25;

  const strongVolumeExpansion =
    currentVsPriorVolumeRatio != null &&
    currentVsPriorVolumeRatio >= 1.5;

  const participationFading = volumeWeak;

  const supportsCanonicalDirection =
    completed === true &&
    ["LONG", "SHORT"].includes(canonicalDirection) &&
    currentDirection === canonicalDirection &&
    priceProgressDirection === canonicalDirection &&
    volumeWeak !== true;

  const adverseToCanonicalDirection =
    completed === true &&
    ["LONG", "SHORT"].includes(canonicalDirection) &&
    currentDirection === opposite &&
    priceProgressDirection === opposite &&
    volumeExpansion === true;

  const highVolumeNoProgress =
    completed === true &&
    volumeExpansion === true &&
    priceProgressDirection === "NEUTRAL";

  // These legacy concepts are intentionally not borrowed from mixed-timeframe
  // fast/current objects. They remain false until a source-clean 5m detector
  // owns them.
  const absorptionRisk = false;
  const climacticRisk = false;

  let state = STATES.UNRESOLVED;
  let quality = "WEAK";

  if (adverseToCanonicalDirection) {
    state = STATES.ADVERSE;
    quality = strongVolumeExpansion ? "RISK" : "GOOD";
  } else if (supportsCanonicalDirection) {
    state = STATES.SUPPORTIVE;
    quality = strongVolumeExpansion
      ? "STRONG"
      : participationImproving
        ? "GOOD"
        : "MIXED";
  }

  const reasonCodes = unique([
    "ENGINE4_5M_PARTICIPATION_INDEPENDENT",
    sourceValid ? "ENGINE4_5M_SOURCE_VALID" : "ENGINE4_5M_SOURCE_INVALID",
    stale ? "ENGINE4_5M_SOURCE_STALE" : null,
    candidateMismatch ? "ENGINE4_5M_CANDIDATE_MISMATCH" : null,
    zoneMismatch ? "ENGINE4_5M_ZONE_MISMATCH" : null,
    currentCandleStatus !== "COMPLETED"
      ? "ENGINE4_5M_CURRENT_CANDLE_NOT_COMPLETED"
      : null,
    priorCandleStatus !== "COMPLETED"
      ? "ENGINE4_5M_PRIOR_CANDLE_NOT_COMPLETED"
      : null,
    currentVsPriorVolumeRatio == null
      ? "ENGINE4_5M_VOLUME_RATIO_UNAVAILABLE"
      : null,
    volumeWeak ? "ENGINE4_5M_VOLUME_WEAK" : null,
    participationImproving ? "ENGINE4_5M_PARTICIPATION_IMPROVING" : null,
    volumeExpansion ? "ENGINE4_5M_VOLUME_EXPANSION" : null,
    supportsCanonicalDirection
      ? "ENGINE4_5M_PARTICIPATION_SUPPORTS_CANONICAL_DIRECTION"
      : null,
    adverseToCanonicalDirection
      ? "ENGINE4_5M_PARTICIPATION_ADVERSE_TO_CANONICAL_DIRECTION"
      : null,
    highVolumeNoProgress ? "ENGINE4_5M_HIGH_VOLUME_NO_PROGRESS" : null,
    state === STATES.UNRESOLVED ? "ENGINE4_5M_PARTICIPATION_UNRESOLVED" : null,
  ]);

  return {
    active: sourceValid,
    source: "reaction.reactionValidation5m.rawCandles",
    sourceTimeframe: sourceTimeframe === "5m" ? "5m" : null,

    state,
    quality,
    canonicalDirection,

    fresh: stale !== true,
    stale,
    sourceValid,
    completed,

    candidateMismatch,
    zoneMismatch,

    supportingBarTime: source?.supportingBarTime ?? null,
    currentCandleStatus,
    priorCandleStatus,
    currentCandle,
    priorCandle,

    currentVolume,
    priorVolume,
    currentVsPriorVolumeRatio,

    candleDirection: currentDirection,
    priceProgressDirection,

    supportsCanonicalDirection,
    adverseToCanonicalDirection,

    volumeWeak,
    volumeExpansion,
    strongVolumeExpansion,
    participationImproving,
    participationFading,

    highVolumeNoProgress,
    absorptionRisk,
    climacticRisk,

    // Engine 3's 5m derived direction/state remain visible only as diagnostics.
    engine3ValidationState: source?.validationState || null,
    engine3ValidationDirection: source?.direction || null,
    engine3ValidationQuality: source?.quality || null,

    noPermissionCreated: true,
    noExecution: true,
    reasonCodes,
  };
}
