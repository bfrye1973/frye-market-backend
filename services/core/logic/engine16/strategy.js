// services/core/logic/engine16/strategy.js
//
// Final Engine 16 strategy classifier
//
// DESIGN GOALS
// - Protect pullback / continuation trades as priority setups
// - Keep tested exhaustion trigger behavior alive
// - In TRANSITION / NEUTRAL:
//   * do NOT bury valid pullbacks
//   * do NOT bury valid continuation triggers
//   * be stricter mainly on reversal / breakout / breakdown promotion
//
// PHILOSOPHY
// - Be aggressive with pullbacks
// - Be cautious with reversals
//
// IMPORTANT
// - Exhaustion TRIGGER still stays valid when truly confirmed
// - Pullback setups remain visible and tradeable
// - Continuation trigger remains valid
// - Breakout / breakdown / reversal can be softened in high strictness regimes

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

export function classifyEngine16Strategy({
  exhaustionTrigger,
  exhaustionActive,
  exhaustionEarly,
  reversalDetected,
  failedBreakout,
  failedBreakdown,
  hasPulledBack,
  breakdownReady,
  breakoutReady,
  continuationWatch,
  continuationTrigger,
  insidePrimaryZone,
  insideSecondaryZone,
  marketRegime = null,
}) {
  const regime = safeUpper(marketRegime?.regime, "UNKNOWN");
  const strictness = safeUpper(marketRegime?.strictness, "MEDIUM");

  let strategyType = "NONE";
  let readinessLabel = "NO_SETUP";

  const reversalReady =
    reversalDetected && (failedBreakout || failedBreakdown);

  const continuationReady =
    continuationTrigger === true;

  const continuationBuilding =
    continuationWatch === true && !continuationReady;

  const breakdownSetup =
    hasPulledBack && breakdownReady && !continuationReady;

  const breakoutSetup =
    hasPulledBack && breakoutReady && !continuationReady;

  const primaryPullbackSetup =
    hasPulledBack && insidePrimaryZone;

  const secondaryPullbackSetup =
    hasPulledBack && insideSecondaryZone;

  const highStrictnessTransition =
    strictness === "HIGH" &&
    (regime === "NEUTRAL" || regime === "TRANSITION");

  // --------------------------------------------------
  // 1) Confirmed exhaustion stays alive
  // --------------------------------------------------
  // Keep your proven exhaustion trigger behavior intact.
  if (exhaustionTrigger && exhaustionActive) {
    strategyType = "EXHAUSTION";
    readinessLabel = "EXHAUSTION_READY";
    return { strategyType, readinessLabel };
  }

  // --------------------------------------------------
  // 2) Continuation trigger is priority
  // --------------------------------------------------
  // Do not bury continuation triggers in transition.
  if (continuationReady) {
    strategyType = "CONTINUATION";
    readinessLabel = "CONTINUATION_READY";
    return { strategyType, readinessLabel };
  }

  // --------------------------------------------------
  // 3) Pullbacks are priority setups
  // --------------------------------------------------
  // Protect your bread-and-butter:
  // trend -> pullback into EMA zone -> continuation opportunity
  if (primaryPullbackSetup) {
    strategyType = "PULLBACK_PRIMARY";
    readinessLabel = "PULLBACK_READY";
    return { strategyType, readinessLabel };
  }

  if (secondaryPullbackSetup) {
    strategyType = "PULLBACK_SECONDARY";
    readinessLabel = "PULLBACK_READY";
    return { strategyType, readinessLabel };
  }

  // --------------------------------------------------
  // 4) Continuation watch stays visible
  // --------------------------------------------------
  // This helps surface "building" continuation without forcing READY.
  if (continuationBuilding) {
    strategyType = "NONE";
    readinessLabel = "WATCH";
    return { strategyType, readinessLabel };
  }

  // --------------------------------------------------
  // 5) Reversal / breakout / breakdown stricter in transition
  // --------------------------------------------------
  // These are the ones we soften when the market is messy.
  if (reversalReady) {
    if (highStrictnessTransition) {
      strategyType = "NONE";
      readinessLabel = "WATCH";
    } else {
      strategyType = "REVERSAL";
      readinessLabel = "REVERSAL_READY";
    }
    return { strategyType, readinessLabel };
  }

  if (breakdownSetup) {
    if (highStrictnessTransition) {
      strategyType = "NONE";
      readinessLabel = "WATCH";
    } else {
      strategyType = "BREAKDOWN";
      readinessLabel = "BREAKDOWN_READY";
    }
    return { strategyType, readinessLabel };
  }

  if (breakoutSetup) {
    if (highStrictnessTransition) {
      strategyType = "NONE";
      readinessLabel = "WATCH";
    } else {
      strategyType = "BREAKOUT";
      readinessLabel = "BREAKOUT_READY";
    }
    return { strategyType, readinessLabel };
  }

  // --------------------------------------------------
  // 6) Early exhaustion stays watch-only
  // --------------------------------------------------
  // Price stretch / early sequence should not auto-promote.
  if (exhaustionEarly === true) {
    strategyType = "NONE";
    readinessLabel = "WATCH";
    return { strategyType, readinessLabel };
  }

  return {
    strategyType,
    readinessLabel,
  };
}
