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

  if (exhaustionTrigger && exhaustionActive) {
    strategyType = "EXHAUSTION";
    readinessLabel = "EXHAUSTION_READY";
  } else if (reversalDetected && (failedBreakout || failedBreakdown)) {
    strategyType = "REVERSAL";
    readinessLabel = "REVERSAL_READY";
  } else if (hasPulledBack && breakdownReady) {
    strategyType = "BREAKDOWN";
    readinessLabel = "BREAKDOWN_READY";
  } else if (hasPulledBack && breakoutReady) {
    strategyType = "BREAKOUT";
    readinessLabel = "BREAKOUT_READY";
  } else if (continuationTrigger) {
    strategyType = "CONTINUATION";
    readinessLabel = "CONTINUATION_READY";
  } else if (hasPulledBack && insidePrimaryZone) {
    strategyType = "PULLBACK_PRIMARY";
    readinessLabel = "PULLBACK_READY";
  } else if (hasPulledBack && insideSecondaryZone) {
    strategyType = "PULLBACK_SECONDARY";
    readinessLabel = "PULLBACK_READY";
  }

  return {
    strategyType,
    readinessLabel,
  };
}
