// services/core/logic/engine16/strategy.js

export function classifyEngine16Strategy({
  exhaustionTrigger,
  exhaustionActive,
  reversalDetected,
  failedBreakout,
  failedBreakdown,
  hasPulledBack,
  breakdownReady,
  breakoutReady,
  continuationTrigger,
  insidePrimaryZone,
  insideSecondaryZone,
}) {
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

  if (exhaustionTrigger && exhaustionActive) {
    strategyType = "EXHAUSTION";
    readinessLabel = "EXHAUSTION_READY";
  } else if (reversalReady) {
    strategyType = "REVERSAL";
    readinessLabel = "REVERSAL_READY";
  } else if (continuationReady) {
    strategyType = "CONTINUATION";
    readinessLabel = "CONTINUATION_READY";
  } else if (breakdownSetup) {
    strategyType = "BREAKDOWN";
    readinessLabel = "BREAKDOWN_READY";
  } else if (breakoutSetup) {
    strategyType = "BREAKOUT";
    readinessLabel = "BREAKOUT_READY";
  } else if (primaryPullbackSetup) {
    strategyType = "PULLBACK_PRIMARY";
    readinessLabel = "PULLBACK_READY";
  } else if (secondaryPullbackSetup) {
    strategyType = "PULLBACK_SECONDARY";
    readinessLabel = "PULLBACK_READY";
  }

  return {
    strategyType,
    readinessLabel,
  };
}
