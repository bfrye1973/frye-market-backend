import { toNum } from "../contracts/valueUtils.js";

export function buildValidation5m(reaction) {
  // ---- D3 5m validation ---------------------------------------------------
  // Pass-through only. Engine 4 does not reinterpret Engine 3's 5m state.
  const validation5m =
    reaction?.reactionValidation5m && typeof reaction.reactionValidation5m === "object"
      ? reaction.reactionValidation5m
      : null;

  return {
    validation5mActive: validation5m?.active === true,
    validation5mState: validation5m?.validationState || null,
    validation5mDirection: validation5m?.direction || null,
    validation5mQuality: validation5m?.quality || null,
    validation5mTimeframe: validation5m?.sourceTimeframe || null,
    validation5mSupportingBarTime: validation5m?.supportingBarTime ?? null,
    validation5mCurrentVolume: toNum(validation5m?.currentCandle?.volume),
    validation5mPriorVolume: toNum(validation5m?.priorCandle?.volume),
    validation5mCurrentCandleStatus:
      validation5m?.currentCandleStatus || validation5m?.candleState || null,
    validation5mPriorCandleStatus: validation5m?.priorCandleStatus || null,
    validation5mStale: validation5m?.stale === true,
  };
}
