// services/core/logic/engine16/strategy.js
//
// Engine 16 strategy classifier
//
// Happy-medium design:
// - Keep strong exhaustion triggers alive
// - Do not over-promote early states
// - In high strictness / neutral / transition:
//   * keep early structure in WATCH longer
//   * do not kill good trigger states

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

  const breakdownSetup =
    hasPulledBack && breakdownReady && !continuationReady;

  const breakoutSetup =
    hasPulledBack && breakoutReady && !continuationReady;

  const primaryPullbackSetup =
    hasPulledBack && insidePrimaryZone;

  const secondaryPullbackSetup =
    hasPulledBack && insideSecondaryZone;

  const watchOnlyContext =
    exhaustionEarly === true ||
    continuationWatch === true ||
    primaryPullbackSetup ||
    secondaryPullbackSetup ||
    breakoutSetup ||
    breakdownSetup;

  // 1) Keep tested exhaustion trigger behavior alive
  if (exhaustionTrigger && exhaustionActive) {
    strategyType = "EXHAUSTION";
    readinessLabel = "EXHAUSTION_READY";
    return { strategyType, readinessLabel };
  }

  // 2) Reversal stays available, but in high strictness keep it WATCH
  if (reversalReady) {
    if (strictness === "HIGH" && (regime === "NEUTRAL" || regime === "TRANSITION")) {
      strategyType = "NONE";
      readinessLabel = "WATCH";
    } else {
      strategyType = "REVERSAL";
      readinessLabel = "REVERSAL_READY";
    }
    return { strategyType, readinessLabel };
  }

  // 3) Continuation trigger is strong enough to survive v1
  if (continuationReady) {
    strategyType = "CONTINUATION";
    readinessLabel = "CONTINUATION_READY";
    return { strategyType, readinessLabel };
  }

  // 4) Breakout / breakdown can be softened in high strictness
  if (breakdownSetup) {
    if (strictness === "HIGH" && (regime === "NEUTRAL" || regime === "TRANSITION")) {
      strategyType = "NONE";
      readinessLabel = "WATCH";
    } else {
      strategyType = "BREAKDOWN";
      readinessLabel = "BREAKDOWN_READY";
    }
    return { strategyType, readinessLabel };
  }

  if (breakoutSetup) {
    if (strictness === "HIGH" && (regime === "NEUTRAL" || regime === "TRANSITION")) {
      strategyType = "NONE";
      readinessLabel = "WATCH";
    } else {
      strategyType = "BREAKOUT";
      readinessLabel = "BREAKOUT_READY";
    }
    return { strategyType, readinessLabel };
  }

  // 5) Everything else that is forming stays WATCH, not NONE/NO_SETUP
  if (watchOnlyContext) {
    strategyType = "NONE";
    readinessLabel = "WATCH";
    return { strategyType, readinessLabel };
  }

  return {
    strategyType,
    readinessLabel,
  };
}
