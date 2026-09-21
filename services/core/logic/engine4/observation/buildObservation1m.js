import { safeUpper } from "../contracts/inputUtils.js";
import { toNum, round, unique } from "../contracts/valueUtils.js";

export function buildObservation1m(reaction) {
  // ---- D3 1m live observation --------------------------------------------
  // Engine 3 owns this diagnostic 1m observation. Engine 4 may classify the
  // immediate volume intensity, but this layer never creates confirmation.
  const observation1m =
    reaction?.reactionObservation1m && typeof reaction.reactionObservation1m === "object"
      ? reaction.reactionObservation1m
      : null;

  const observation1mTimeframe = observation1m?.sourceTimeframe || null;
  const observation1mStale = observation1m?.stale === true;
  const observation1mActive =
    observation1m?.active === true &&
    observation1mStale === false &&
    observation1mTimeframe === "1m";

  const observationStatus = observation1mActive
    ? "ACTIVE"
    : observation1mStale
      ? "STALE"
      : "UNAVAILABLE";

  const observation1mCurrentVolume = toNum(observation1m?.currentCandle?.volume);
  const observation1mPriorVolume = toNum(observation1m?.priorCandle?.volume);
  const observation1mVolumeRatio =
    observation1mCurrentVolume != null &&
    observation1mPriorVolume != null &&
    observation1mPriorVolume > 0
      ? round(observation1mCurrentVolume / observation1mPriorVolume, 2)
      : null;

  const observation1mCurrentCandleStatus =
    observation1m?.currentCandleStatus || observation1m?.candleState || null;
  const observation1mPriorCandleStatus =
    observation1m?.priorCandleStatus || null;

  let currentVolumeReaction = "VOLUME_DATA_UNAVAILABLE";
  if (observation1mActive && observation1mVolumeRatio != null) {
    const status = safeUpper(
      observation1mCurrentCandleStatus,
      "COMPLETION_UNKNOWN"
    );

    if (status === "FORMING") {
      if (observation1mVolumeRatio >= 1.25) {
        currentVolumeReaction = "FORMING_VOLUME_EXPANDING";
      } else if (observation1mVolumeRatio >= 0.9) {
        currentVolumeReaction = "FORMING_VOLUME_ACTIVE";
      } else {
        currentVolumeReaction = "FORMING_VOLUME_LIGHT";
      }
    } else if (observation1mVolumeRatio >= 1.5) {
      currentVolumeReaction = "VOLUME_EXPANDING_STRONG";
    } else if (observation1mVolumeRatio >= 1.1) {
      currentVolumeReaction = "VOLUME_EXPANDING";
    } else if (observation1mVolumeRatio >= 0.9) {
      currentVolumeReaction = "VOLUME_ACTIVE_NO_CLEAR_EDGE";
    } else if (observation1mVolumeRatio >= 0.65) {
      currentVolumeReaction = "VOLUME_SLIGHTLY_BELOW_PRIOR";
    } else {
      currentVolumeReaction = "VOLUME_LIGHT";
    }
  }

  const observationReasonCodes = unique([
    observation1mActive
      ? "ENGINE4_1M_LIVE_OBSERVATION_ACTIVE"
      : observation1mStale
        ? "ENGINE4_1M_LIVE_OBSERVATION_STALE"
        : "ENGINE4_1M_LIVE_OBSERVATION_UNAVAILABLE",
    observation1mActive ? currentVolumeReaction : null,
    observation1mCurrentCandleStatus === "FORMING"
      ? "RAW_FORMING_VOLUME_RATIO_DIAGNOSTIC_ONLY"
      : null,
  ]);

  return {
    observerActive: observation1mActive,
    observationStatus,
    observation1mActive,
    observation1mStale,
    observation1mTimeframe,
    observation1mState: observation1m?.state || null,
    observation1mDirection: observation1m?.direction || null,
    observation1mQuality: observation1m?.quality || null,
    observation1mCurrentVolume,
    observation1mPriorVolume,
    observation1mVolumeRatio,
    observation1mCurrentCandleStatus,
    observation1mPriorCandleStatus,
    observation1mSupportingBarTime: observation1m?.supportingBarTime ?? null,
    currentVolumeReaction,
    observationReasonCodes,
  };
}
