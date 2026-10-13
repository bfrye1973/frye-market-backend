// services/core/logic/engine22/wave/lifecycle/abcUpMarketContextRisk.js

import { toNum } from "./lifecycleUtils.js";

export function buildAbcUpMarketContextRisk({
  marketMeterContext = null,
  cUpProgress = null,
  currentPrice = null,
  originLow = null,
  bLow = null,
} = {}) {
  const masterScore =
    toNum(marketMeterContext?.masterScore) ??
    toNum(marketMeterContext?.scoreMaster) ??
    toNum(marketMeterContext?.master);

  const score30m = toNum(marketMeterContext?.score30m);
  const score4h = toNum(marketMeterContext?.score4h);
  const scoreEOD = toNum(marketMeterContext?.scoreEOD);

  const masterProxyValues = [score30m, score4h, scoreEOD].filter(
    (x) => x !== null
  );

  const masterProxyScore =
    masterScore !== null
      ? masterScore
      : masterProxyValues.length
      ? Number(
          (
            masterProxyValues.reduce((sum, x) => sum + x, 0) /
            masterProxyValues.length
          ).toFixed(2)
        )
      : null;

  const eodWeak = scoreEOD !== null && scoreEOD < 48;
  const masterWeak = masterProxyScore !== null && masterProxyScore < 48;

  const dashboardWeak = eodWeak && masterWeak;

  const extensionHit =
    cUpProgress?.reached618 === true ||
    cUpProgress?.reached100 === true ||
    ["c100", "c1272", "c1618", "c200", "c2618"].includes(
      String(cUpProgress?.highestTargetHit || "")
    );

  const fastSpike = cUpProgress?.fastUpsideMove?.active === true;
  const belowOrigin = cUpProgress?.belowOrigin === true;
  const belowStructuralB = cUpProgress?.belowStructuralB === true;

  let state = "NO_MARKET_CONTEXT_C_UP_RISK";
  let risk = "NONE";
  let read = "No weak-dashboard C-up risk is active.";

  if (dashboardWeak && fastSpike && extensionHit && belowStructuralB) {
    state = "WEAK_MARKET_FAST_C_UP_EXTENSION_W2_FAILED_POSSIBLE_W3_DOWN";
    risk = "HIGH";
    read =
      "Dashboard was weak while price spiked fast into C-up extension targets, then price failed below the structural B low. Treat this as possible Wave 2 completion into Wave 3 down risk.";
  } else if (dashboardWeak && extensionHit && belowStructuralB) {
    state = "WEAK_MARKET_C_UP_EXTENSION_W2_FAILED_POSSIBLE_W3_DOWN";
    risk = "HIGH";
    read =
      "Dashboard was weak while C-up reached extension targets, then price failed below structural B. Possible Wave 3 down risk is active.";
  } else if (dashboardWeak && fastSpike && extensionHit) {
    state = "WEAK_MARKET_FAST_C_UP_EXTENSION_MATURITY_RISK";
    risk = "ELEVATED";
    read =
      "Dashboard is weak while price is spiking fast into C-up extension targets. Treat the rally as countertrend Wave 2 / C-up maturity risk.";
  } else if (dashboardWeak && extensionHit) {
    state = "WEAK_MARKET_C_UP_EXTENSION_MATURITY_RISK";
    risk = "ELEVATED";
    read =
      "Dashboard is weak while C-up is reaching extension targets. Watch for Wave 2 completion / Wave 3 down risk.";
  } else if (dashboardWeak && belowOrigin) {
    state = "WEAK_MARKET_ORIGIN_LOST_AFTER_C_UP";
    risk = "ELEVATED";
    read =
      "Dashboard is weak and price is below origin after C-up progress. Watch for Wave 2 failure / Wave 3 down risk.";
  }

  return {
    active: state !== "NO_MARKET_CONTEXT_C_UP_RISK",
    state,
    risk,

    masterScore,
    masterProxyScore,
    score30m,
    score4h,
    scoreEOD,
    state30m: marketMeterContext?.state30m || null,
    state4h: marketMeterContext?.state4h || null,
    stateEOD: marketMeterContext?.stateEOD || null,

    dashboardWeak,
    eodWeak,
    masterWeak,
    extensionHit,
    fastSpike,
    belowOrigin,
    belowStructuralB,

    currentPrice: toNum(currentPrice),
    originLow: toNum(originLow),
    bLow: toNum(bLow),

    read,

    reasonCodes: [
      "ABC_UP_MARKET_CONTEXT_RISK_BUILT",
      dashboardWeak ? "DASHBOARD_WEAK_UNDER_48" : null,
      eodWeak ? "EOD_WEAK_UNDER_48" : null,
      masterWeak ? "MASTER_OR_PROXY_WEAK_UNDER_48" : null,
      fastSpike ? "FAST_C_UP_SPIKE_IN_WEAK_DASHBOARD" : null,
      extensionHit ? "C_UP_EXTENSION_HIT_IN_WEAK_DASHBOARD" : null,
      belowOrigin ? "PRICE_BELOW_ORIGIN_AFTER_C_UP" : null,
      belowStructuralB ? "PRICE_BELOW_STRUCTURAL_B_AFTER_C_UP" : null,
      state,
    ].filter(Boolean),
  };
}
