// services/core/logic/engine22/wave/lifecycle/wave3DownLifecycle.js
//
// Engine 22D — Wave 3 Down Lifecycle
//
// Purpose:
// Read-only classifier for possible Wave 3 down behavior after a completed
// ABC_UP / W2 bounce fails below origin and structural B.
//
// Safety:
// - Does not execute trades.
// - Does not create shorts.
// - Does not change Engine 6 permission.
// - Does not make anything tradeable.

import {
  toNum,
  roundToTick,
  tickSizeForSymbol,
} from "./lifecycleUtils.js";

export function buildWave3DownLifecycle({
  symbol = "ES",
  currentPrice = null,
  abcUp = null,
} = {}) {
  const tickSize = tickSizeForSymbol(symbol);

  const price = toNum(currentPrice);
  const originLow = toNum(abcUp?.originLow);
  const structuralBLow = toNum(abcUp?.effectiveWaveBLow);
  const waveCHigh = toNum(abcUp?.waveCHigh);

  const abcUpComplete = abcUp?.state === "ABC_UP_COMPLETE";
  const manualCMarked = waveCHigh !== null && waveCHigh > 0;

  const belowOrigin =
    price !== null &&
    originLow !== null &&
    price < originLow;

  const belowStructuralB =
    price !== null &&
    structuralBLow !== null &&
    price < structuralBLow;

  const marketContextRiskActive = abcUp?.marketContextRisk?.active === true;
  const marketContextRiskState = abcUp?.marketContextRisk?.state || null;

  const readyForWave3DownRead =
    abcUpComplete &&
    manualCMarked &&
    belowOrigin &&
    belowStructuralB;

  if (!readyForWave3DownRead) {
    return {
      active: false,
      state: "W3_DOWN_NOT_APPLICABLE",
      readOnly: true,
      direction: "NONE",
      tradeableOpportunityBlocked: true,
      noExecution: true,

      abcUpComplete,
      manualCMarked,
      belowOrigin,
      belowStructuralB,
      marketContextRiskActive,
      marketContextRiskState,

      originLow: originLow !== null ? roundToTick(originLow, tickSize) : null,
      structuralBLow:
        structuralBLow !== null ? roundToTick(structuralBLow, tickSize) : null,
      waveCHigh: waveCHigh !== null ? roundToTick(waveCHigh, tickSize) : null,
      cTime: abcUp?.cTime || null,
      currentPrice: price !== null ? roundToTick(price, tickSize) : null,

      read:
        "Wave 3 down lifecycle is not applicable yet. ABC_UP must be complete with manual C marked and price below origin / structural B.",
      reasonCodes: [
        "W3_DOWN_LIFECYCLE_BUILT",
        "W3_DOWN_NOT_APPLICABLE",
        abcUpComplete ? "ABC_UP_COMPLETE" : "ABC_UP_NOT_COMPLETE",
        manualCMarked ? "MANUAL_C_MARKED" : "MANUAL_C_NOT_MARKED",
        belowOrigin ? "PRICE_BELOW_ORIGIN" : "PRICE_NOT_BELOW_ORIGIN",
        belowStructuralB
          ? "PRICE_BELOW_STRUCTURAL_B"
          : "PRICE_NOT_BELOW_STRUCTURAL_B",
      ],
    };
  }

  const state = marketContextRiskActive
    ? "W3_DOWN_CONFIRMATION_WATCH"
    : "POSSIBLE_W3_DOWN_STARTED";

  return {
    active: false,
    state,
    readOnly: true,
    direction: "NONE",
    tradeableOpportunityBlocked: true,
    noExecution: true,

    abcUpComplete,
    manualCMarked,
    belowOrigin,
    belowStructuralB,
    marketContextRiskActive,
    marketContextRiskState,

    originLow: roundToTick(originLow, tickSize),
    structuralBLow: roundToTick(structuralBLow, tickSize),
    waveCHigh: roundToTick(waveCHigh, tickSize),
    cTime: abcUp?.cTime || null,
    currentPrice: price !== null ? roundToTick(price, tickSize) : null,

    read:
      state === "W3_DOWN_CONFIRMATION_WATCH"
        ? "ABC_UP completed at the marked C high, then price failed below origin and structural B while market context risk is active. Treat as Wave 3 down confirmation watch. Read-only only."
        : "ABC_UP completed at the marked C high, then price failed below origin and structural B. Treat as possible Wave 3 down started. Read-only only.",

    reasonCodes: [
      "W3_DOWN_LIFECYCLE_BUILT",
      "ABC_UP_COMPLETE",
      "MANUAL_C_MARKED",
      "PRICE_BELOW_ORIGIN",
      "PRICE_BELOW_STRUCTURAL_B",
      marketContextRiskActive ? "MARKET_CONTEXT_RISK_ACTIVE" : null,
      marketContextRiskState,
      state,
      "READ_ONLY",
      "NO_EXECUTION",
      "DIRECTION_NONE",
    ].filter(Boolean),
  };
}
