import { toNum } from "../contracts/valueUtils.js";

export function buildBroader10mContext(tacticalParticipation) {
  // ---- D3 10m broader context --------------------------------------------
  // The fast/current tactical object carries broader Engine 4 10m volume
  // context fields such as relativeVolume and volumeTrend. Do not relabel its
  // fast currentBarVolume/priorBarVolume as 10m candles.
  const broader10mRelativeVolume = toNum(tacticalParticipation?.relativeVolume);
  const broader10mVolumeTrend = tacticalParticipation?.volumeTrend || null;
  const broader10mVolumeExpansion = tacticalParticipation?.volumeExpansion === true;
  const broader10mVolumeConfirmed = tacticalParticipation?.volumeConfirmed === true;
  const broader10mHighVolumeCandles = toNum(tacticalParticipation?.highVolumeCandles);
  const broader10mActive =
    tacticalParticipation?.active === true &&
    (
      broader10mRelativeVolume != null ||
      broader10mVolumeTrend != null ||
      broader10mVolumeExpansion === true ||
      broader10mVolumeConfirmed === true ||
      broader10mHighVolumeCandles != null
    );

  return {
    broader10mActive,
    broader10mTimeframe: broader10mActive ? "10m" : null,
    broader10mRelativeVolume,
    broader10mVolumeTrend,
    broader10mVolumeExpansion,
    broader10mVolumeConfirmed,
    broader10mHighVolumeCandles,
    // The current tactical object does not retain source-safe raw 10m
    // participationState/participationQuality separately from its fast state.
    // Publish null rather than mislabeling a fast tactical classification as 10m.
    broader10mParticipationState: null,
    broader10mParticipationQuality: null,
  };
}
