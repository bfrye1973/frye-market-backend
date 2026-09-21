import { resolveCandles } from "../candles/resolveCandles.js";
import { toNum, round } from "../contracts/valueUtils.js";
import { buildObservation1m } from "../observation/buildObservation1m.js";
import { buildValidation5m } from "../validation/buildValidation5m.js";
import { buildBroader10mContext } from "../context/buildBroader10mContext.js";

export function computeVolumeMetadata({ reaction, tacticalParticipation }) {
  const { currentCandle, priorCandle, currentCandleClosed, priorBarCompleted, formingCandle, completionKnown } =
    resolveCandles(reaction, tacticalParticipation);

  // Compatibility fields remain unchanged: the existing tactical participation
  // source still owns these top-level raw values. D3 adds source-specific fields
  // below so consumers no longer have to infer what these mixed compatibility
  // fields represent.
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

  const observation1m = buildObservation1m(reaction);
  const validation5m = buildValidation5m(reaction);
  const broader10m = buildBroader10mContext(tacticalParticipation);

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

    ...observation1m,
    ...validation5m,
    ...broader10m,
  };
}
